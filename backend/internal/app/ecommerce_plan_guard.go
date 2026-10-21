package app

// 「直接生图」前置守卫：没跑过 AI 视觉策划就不允许派发生图任务。
//
// 对齐 pr(1) 的 direct 模式：用户点「直接生成详情页」时，PR 是先调视觉文本模型
// 跑完 12 段策划、再自动提交生图；绝不会拿没策划过的空模板去生图。
//
// 现场事故：/ecommerce 之前允许空壳槽位直接生图 → 提示词里只有平台套话，
// 模型不知道产品是胰岛素冷藏盒，把白盒子在桌上复制了 6 遍，且全组没有文字。
// 这里补上守卫：先同步跑一次策划（看图 + 卖点 → 7 屏差异化场景与海报版式），
// 编译写入 7 个槽位后再继续派发。

import (
	"context"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

const (
	// ecommercePlanWaitTimeout 同步等待策划任务的上限（视觉模型看图通常 20~90 秒）。
	ecommercePlanWaitTimeout = 4 * time.Minute
	// ecommercePlanPollInterval 策划任务轮询间隔。
	ecommercePlanPollInterval = 1200 * time.Millisecond
)

// ecommerceNeedsVisualPlan 判断「直接生图」前是否必须先补一次 AI 视觉策划。
//
// 满足任一即**不**需要策划（避免覆盖人工成果）：
//   - 商品已跑过策划（PlanRevision > 0）；
//   - 任一槽位带人工完整覆盖（promptOverride）；
//   - 任一槽位已经是 12 段视觉方案。
func ecommerceNeedsVisualPlan(product *model.EcommerceProduct, slots []model.EcommerceSlot) bool {
	if product == nil || product.PlanRevision > 0 {
		return false
	}
	for _, slot := range slots {
		if strings.TrimSpace(slot.PromptOverride) != "" {
			return false
		}
		if isTwelveSegmentVisualPlan(slot.GenerationPrompt) {
			return false
		}
	}
	return true
}

// isTwelveSegmentVisualPlan 判断落库提示词是否已是 12 段视觉方案。
func isTwelveSegmentVisualPlan(prompt string) bool {
	return strings.Contains(prompt, "整组视觉方向：") &&
		strings.Contains(prompt, "本屏差异与连续性：")
}

// ensureEcommerceVisualPlan 在派发生图前**同步**跑完一次 AI 视觉策划并写入各屏。
//
// 策划模型取参顺序：options.PlannerModel → 用户配置的 plannerModelId；
// 渠道取 options.PlannerChannelID → options.ChannelID。都取不到就明确报错，
// 不静默拿生图模型当文本模型用。
func (s *Service) ensureEcommerceVisualPlan(ctx context.Context, userID string, product *model.EcommerceProduct, options EcommerceStartOptions) error {
	planOptions := EcommercePlanOptions{
		ChannelID: strings.TrimSpace(options.PlannerChannelID),
		Model:     strings.TrimSpace(options.PlannerModel),
	}
	if planOptions.Model == "" || planOptions.ChannelID == "" {
		if cfg, err := s.EcommerceConfig(userID); err == nil && cfg != nil {
			if planOptions.Model == "" {
				planOptions.Model = strings.TrimSpace(cfg.PlannerModelID)
			}
			if planOptions.ChannelID == "" {
				planOptions.ChannelID = strings.TrimSpace(options.ChannelID)
			}
		}
	}
	if planOptions.Model == "" {
		return NewAppError(http.StatusBadRequest,
			"首次生图前必须先做一次 AI 视觉策划：请在「② 商品卖点与 AI 策划」选择策划模型（需支持看图）并点「AI 策划」")
	}
	started, err := s.StartEcommercePlanning(ctx, userID, product.ID, planOptions)
	if err != nil {
		return err
	}
	raw, err := s.waitEcommercePlanTask(ctx, started.TaskID)
	if err != nil {
		return err
	}
	if _, err := s.ApplyEcommercePlan(ctx, userID, product.ID, raw); err != nil {
		return err
	}
	return nil
}

// waitEcommercePlanTask 同步等待策划文本任务完成，返回原始结果文本（含任务包装，编译时会剥）。
func (s *Service) waitEcommercePlanTask(ctx context.Context, taskID string) (string, error) {
	deadline := time.Now().Add(ecommercePlanWaitTimeout)
	for {
		task, err := s.repo.Task(taskID)
		if err != nil {
			return "", err
		}
		switch task.Status {
		case model.TaskStatusSucceeded:
			if strings.TrimSpace(task.ResultJSON) == "" {
				return "", NewAppError(http.StatusBadGateway, "AI 策划返回为空，已停止出图")
			}
			return task.ResultJSON, nil
		case model.TaskStatusFailed, model.TaskStatusCancelled:
			reason := strings.TrimSpace(task.Error)
			if reason == "" {
				reason = "策划任务未完成"
			}
			return "", NewAppError(http.StatusBadGateway, "AI 策划失败，已停止出图："+reason)
		}
		if time.Now().After(deadline) {
			return "", NewAppError(http.StatusGatewayTimeout, "AI 策划超时，已停止出图；请稍后重试或先手动点「AI 策划」")
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(ecommercePlanPollInterval):
		}
	}
}
