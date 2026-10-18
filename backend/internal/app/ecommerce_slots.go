// 电商工坊单屏操作与方案审核 service：编辑提示词（仅保存）、单屏重生成、确认方案、暂停/恢复。
//
// 硬约束（继承 10-11 设计文档与 pr(1) 纪律）：
//  1. uncertain / running 状态的槽位禁止覆写 —— 防止状态错乱与重复计费；
//  2. 重生成必须显式 confirmCost=true —— 收费动作不可静默触发；
//  3. PromptOverride 非空时最高优先 —— 人工完整提示词覆盖不被自动组装覆盖；
//  4. confirm-plan 只接受 review 状态商品，且做余额预检。
package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// EcommerceSlotPromptPatch 单屏可编辑字段（分屏编辑器保存体）。
type EcommerceSlotPromptPatch struct {
	Title          string   `json:"title"`
	Copy           string   `json:"copy"`
	SceneType      string   `json:"sceneType"`
	SellingPoints  string   `json:"sellingPoints"`
	AspectRatio    string   `json:"aspectRatio"`
	Prompt         string   `json:"prompt"`
	PromptOverride string   `json:"promptOverride"`
	ReferenceIDs   []string `json:"referenceIds"`
}

// ownedEcommerceSlot 取槽位并校验其商品属于该用户（他人 404，不泄露存在性）。
func (s *Service) ownedEcommerceSlot(ctx context.Context, userID, slotID string) (*model.EcommerceSlot, *model.EcommerceProduct, error) {
	slot, err := s.repo.EcommerceSlotByID(slotID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, kernel.NotFound("槽位不存在")
		}
		return nil, nil, err
	}
	product, err := s.repo.GetEcommerceProduct(userID, slot.ProductID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, kernel.NotFound("商品任务不存在")
		}
		return nil, nil, err
	}
	return slot, product, nil
}

// UpdateEcommerceSlotPrompt 仅保存单屏文案与提示词（不派发子任务、不动已生成图）。
//
// 写路径强校验：running / uncertain 状态拒绝覆写（等当前请求收尾）。
func (s *Service) UpdateEcommerceSlotPrompt(ctx context.Context, userID, slotID string, patch EcommerceSlotPromptPatch) (*model.EcommerceSlot, error) {
	slot, _, err := s.ownedEcommerceSlot(ctx, userID, slotID)
	if err != nil {
		return nil, err
	}
	if slot.Status == ecommerce.SlotStatusRunning || slot.Status == ecommerce.SlotStatusUncertain {
		return nil, NewAppError(http.StatusConflict, "该屏正在生成或结果待确认，请等当前请求收尾后再修改")
	}
	if len([]rune(patch.PromptOverride)) > 16000 {
		return nil, NewAppError(http.StatusBadRequest, "完整提示词覆盖超过 16000 字符上限")
	}
	referenceJSON := ""
	if patch.ReferenceIDs != nil {
		encoded, err := json.Marshal(patch.ReferenceIDs)
		if err != nil {
			return nil, err
		}
		referenceJSON = string(encoded)
	}
	updates := map[string]any{
		"title":             strings.TrimSpace(patch.Title),
		"copy":              patch.Copy,
		"scene_type":        patch.SceneType,
		"selling_points":    patch.SellingPoints,
		"aspect_ratio":      patch.AspectRatio,
		"generation_prompt": patch.Prompt,
		"prompt_override":   patch.PromptOverride,
	}
	if referenceJSON != "" {
		updates["reference_ids_json"] = referenceJSON
	}
	if err := s.repo.UpdateEcommerceSlotPlan(slotID, updates); err != nil {
		return nil, err
	}
	return s.repo.EcommerceSlotByID(slotID)
}

// RegenerateEcommerceSlot 保存单屏修改并重新生成（version+1，单卡独立派发）。
//
// 收费硬约束：confirmCost 必须为 true；余额不足返回 insufficient_credits。
func (s *Service) RegenerateEcommerceSlot(ctx context.Context, userID, slotID string, patch EcommerceSlotPromptPatch, confirmCost bool) (*model.EcommerceSlot, error) {
	if !confirmCost {
		return nil, NewAppError(http.StatusBadRequest, "重新生成该屏需确认计费（confirmCost=true）")
	}
	slot, product, err := s.ownedEcommerceSlot(ctx, userID, slotID)
	if err != nil {
		return nil, err
	}
	if slot.Status == ecommerce.SlotStatusRunning {
		return nil, NewAppError(http.StatusConflict, "该屏正在生成中，请等当前请求收尾后再重试")
	}
	saved, err := s.UpdateEcommerceSlotPrompt(ctx, userID, slotID, patch)
	if err != nil {
		return nil, err
	}
	// 最终提示词：PromptOverride 优先，否则 GenerationPrompt。
	effective := strings.TrimSpace(saved.PromptOverride)
	if effective == "" {
		effective = strings.TrimSpace(saved.GenerationPrompt)
	}
	if effective == "" {
		return nil, NewAppError(http.StatusBadRequest, "生图提示词为空：请先填写画面描述或完整提示词覆盖")
	}
	// S5 出口门禁：重生成同样过检。
	gate := ecommerce.ComplianceGate(effective)
	if gate.Rejected {
		return nil, NewAppError(http.StatusBadRequest, "S5 门禁拒绝："+gate.RejectReason)
	}

	versionNo := saved.CurrentVersion + 1
	version := model.EcommerceSlotVersion{
		ID: kernel.NewID(), SlotID: slotID, Version: versionNo,
		Prompt: gate.Filtered, Status: ecommerce.SlotStatusQueued, CreatedAt: time.Now(),
	}
	task, taskErr := s.CreateTask(userID, CreateTaskRequest{
		ProjectID: "",
		Type:      "canvas_image",
		Operation: "image",
		Prompt:    gate.Filtered,
		Input: map[string]any{
			"mode":           "image",
			"prompt":         gate.Filtered,
			"negativePrompt": ecommerce.MergeNegative(ecommerce.SoloIslandNegative),
			"config": map[string]any{
				"size":    firstNonEmpty(saved.AspectRatio, "1:1"),
				"quality": "auto",
				"count":   "1",
			},
			"referenceImages": []map[string]any{{
				"storageKey":  "resource:" + product.SourceResourceID,
				"role":        "subject",
				"slotKey":     "reference-main",
				"strength":    0.85,
				"controlMode": "canny",
			}},
			"metadata": map[string]any{
				"source":                 "ecommerce-slot-regenerate",
				"ecommerceProductId":     product.ID,
				"ecommerceSlotId":        slotID,
				"ecommerceSlotVersionId": version.ID,
			},
		},
	})
	if taskErr != nil {
		version.Status = ecommerce.SlotStatusFailed
		version.ErrorMessage = truncateError(taskErr)
		if writeErr := s.repo.CreateEcommerceSlotVersion(&version); writeErr != nil {
			return nil, writeErr
		}
		_ = s.repo.UpdateEcommerceSlotStatus(slotID, ecommerce.SlotStatusFailed)
		return nil, taskErr
	}
	version.ChildTaskID = task.ID
	snapshotJSON, _ := json.Marshal(map[string]any{"slotKey": saved.SlotKey, "version": versionNo})
	version.DispatchSnapshotJSON = string(snapshotJSON)
	if err := s.repo.CreateEcommerceSlotVersion(&version); err != nil {
		return nil, err
	}
	if err := s.repo.UpdateEcommerceSlotDispatch(slotID, ecommerce.SlotStatusQueued, gate.Filtered, version.DispatchSnapshotJSON, versionNo); err != nil {
		return nil, err
	}
	return s.repo.EcommerceSlotByID(slotID)
}

// ConfirmEcommercePlan 审核模式确认整组方案 → 商品转 running 并派发所有待生成槽位。
//
// 只接受 review 状态；余额预检失败返回 insufficient_credits（与 start 同语义）。
// ConfirmEcommercePlan 确认方案并派发生图（阶段 4 新动线主按钮）。
//
// 接受 draft 与 review 两种来源：
//   - review：槽位已 stage（提示词已合成），直接派发；
//   - draft：导入后预建的裸卡片（无提示词）。此时要求调用方带模型参数
//     （options），先复用 StartEcommerceProduct 的完整合成链路把槽位 stage 好，
//     再统一派发——「确认各屏参数并开始生图」一步到位。
//
// 计费纪律：只有走到这里才真正派发 canvas_image 子任务；未确认前商品停在
// draft/review，不产生任何生图费用。
func (s *Service) ConfirmEcommercePlan(ctx context.Context, userID, productID string, options EcommerceStartOptions) (*ProductDetail, error) {
	product, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("商品任务不存在")
		}
		return nil, err
	}
	if product.Status != ecommerce.ProductStatusReview && product.Status != ecommerce.ProductStatusDraft {
		return nil, NewAppError(http.StatusConflict, "当前状态为 "+product.Status+"，仅「待确认方案/未开始」可执行确认")
	}
	// 写路径强校验：确认即派发即收费，渠道与模型必须显式到位（draft 路径进
	// StartEcommerceProduct 也会校验，这里提前挡住 review 直确认的漏传）。
	channelID := strings.TrimSpace(options.ChannelID)
	modelName := strings.TrimSpace(options.Model)
	if channelID == "" || modelName == "" {
		return nil, NewAppError(http.StatusBadRequest, "请先选择生图模型与渠道")
	}
	// draft 态：先走完整编排合成各屏方案（stage 槽位 + 商品转 review）。
	if product.Status == ecommerce.ProductStatusDraft {
		if _, err := s.StartEcommerceProduct(userID, productID, options); err != nil {
			return nil, err
		}
		product, err = s.repo.GetEcommerceProduct(userID, productID)
		if err != nil {
			return nil, err
		}
	}
	preset, err := s.resolveEcommercePreset(userID, options.PresetID)
	if err != nil {
		return nil, err
	}
	// 派发默认参数与 StartEcommerceProduct 同口径（options > 预设 > 1:1）。
	size := firstNonEmpty(strings.TrimSpace(options.Size), preset.Size, "1:1")
	quality := firstNonEmpty(strings.TrimSpace(options.Quality), preset.Quality)
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	slots = sortEcommerceSlotsForPlan(slots)
	if err := s.repo.UpdateEcommerceProductRun(userID, productID, ecommerce.ProductStatusRunning, product.TitleStatus, "", 0); err != nil {
		return nil, err
	}
	if err := s.repo.SetEcommerceProductExecutionMode(userID, productID, ecommerce.ExecutionModeReview, ""); err != nil {
		return nil, err
	}
	// 逐槽派发：仅对尚未派发过子任务的槽位（已有 ChildTaskID 的跳过，避免重复计费）。
	dispatched, deferred := 0, 0
	for index := range slots {
		slot := slots[index]
		if slot.Status == ecommerce.SlotStatusCompleted || slot.Status == ecommerce.SlotStatusFailed {
			continue
		}
		// 容量预检（阶段 4 修复）：在途已满 → 槽位保持 draft/pending 顺延，
		// 由 Sync 对账补派；不判失败、不计费。
		if remaining, capErr := s.ecommerceDispatchCapacity(userID); capErr == nil && remaining <= 0 {
			deferred++
			continue
		}
		plan := ecommerce.SlotPlan{
			SlotKey: slot.SlotKey, Kind: slot.Kind, SlotNo: slot.SlotNo,
			Title: slot.Title, Copy: slot.Copy,
			// 单屏比例覆盖（v56 分屏编辑器）优先于整组默认。
			Aspect: firstNonEmpty(strings.TrimSpace(slot.AspectRatio), size),
		}
		// 阶段 4 修复：渠道/模型/比例/质量必须随行传入——此前整组漏传，
		// 即使提示词兜底成功，CreateTask 也会因空模型失败。
		if _, dispatchErr := s.dispatchEcommerceSlot(userID, product, preset, plan, ecommerceSlotDispatchInput{
			Existing: &slots[index], ProjectID: options.ProjectID,
			ChannelID: channelID, Model: modelName, Size: size, Quality: quality,
			Count: options.Count,
		}); dispatchErr != nil {
			// 容量竞态（预检后、落库前被别的任务占了名额）：同样算顺延，不判失败。
			if errors.Is(dispatchErr, errEcommerceQueueFull) {
				deferred++
				continue
			}
			_ = s.repo.UpdateEcommerceSlotStatus(slot.ID, ecommerce.SlotStatusFailed)
		} else {
			dispatched++
		}
	}
	// 终态一次算清：全部顺延（在途已满）时商品落 queued 而不是 running。
	// ComputeProductStatus 会把「全 draft/pending」推导成 draft，那等于把用户
	// 的确认悄悄撤销；queued 是「已确认、等容量」的诚实中间态，Sync 会继续补派。
	finalStatus := ecommerce.ProductStatusRunning
	statusReason := ""
	if deferred > 0 {
		statusReason = fmt.Sprintf("%d 屏顺延派发：同时在途任务已达上限，容量释放后自动继续", deferred)
		if dispatched == 0 {
			finalStatus = ecommerce.ProductStatusQueued
		}
	}
	// 用确认时的参数重写方案快照：Sync 顺延补派据此取渠道/模型，
	// 断链即补派失败（空模型 CreateTask 必错）。保留原快照的降级说明。
	snapshot := ecommercePlanSnapshot{ChannelID: channelID, Model: modelName, Size: size, Quality: quality}
	if existing := strings.TrimSpace(product.PlanJSON); existing != "" {
		_ = json.Unmarshal([]byte(existing), &snapshot)
		snapshot.ChannelID, snapshot.Model = channelID, modelName
		snapshot.Size, snapshot.Quality = size, quality
	}
	snapshot.GeneratedAt = time.Now().Format(time.RFC3339)
	if refreshed, listErr := s.repo.ListEcommerceSlots(productID); listErr == nil {
		views := make([]EcommerceSlotDispatch, 0, len(refreshed))
		for _, slot := range refreshed {
			views = append(views, EcommerceSlotDispatch{
				SlotID: slot.ID, SlotKey: slot.SlotKey, Title: slot.Title,
				Kind: slot.Kind, SlotNo: slot.SlotNo, Status: slot.Status,
			})
		}
		snapshot.Slots = views
	}
	planJSON, _ := json.Marshal(snapshot)
	if err := s.repo.UpdateEcommerceProductRun(userID, productID, finalStatus, product.TitleStatus, string(planJSON), 0); err != nil {
		return nil, err
	}
	if statusReason != "" {
		if err := s.repo.UpdateEcommerceProductStatus(userID, productID, finalStatus, product.TitleStatus, statusReason); err != nil {
			return nil, err
		}
	}
	return s.EcommerceProductDetail(userID, productID)
}

// PauseEcommerceProduct 暂停派发（在途子任务不取消，按派发时参数收尾）。
// PauseEcommerceProduct 停止生成（强制脱困）。
//
// 阶段 4 修复：旧版只置 product.paused/status=paused，槽位仍留 queued/running，
// 前端按钮依旧被「编排生成中」锁死，用户无法改参数也无法重开。
// 现在：
//  1. 把所有 queued/running/refining 的槽位中止为 paused（连同未终态版本）；
//  2. 商品退回 review（待确认方案），解除前端锁定，允许改参数或重新开始；
//  3. 真正在途的画布子任务不取消（云端已收费的请求正常收尾），但状态立即不再
//     冒充"在途"，对账不会把商品重新推回 running。
func (s *Service) PauseEcommerceProduct(ctx context.Context, userID, productID string) (*model.EcommerceProduct, error) {
	product, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("商品任务不存在")
		}
		return nil, err
	}
	// 中止在途槽位（queued/running/refining → paused），未终态版本一并标记。
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	for index := range slots {
		switch slots[index].Status {
		case ecommerce.SlotStatusQueued, ecommerce.SlotStatusRunning, ecommerce.SlotStatusRefining:
			if err := s.repo.UpdateEcommerceSlotStatus(slots[index].ID, ecommerce.SlotStatusPaused); err != nil {
				return nil, err
			}
			versions, versionErr := s.repo.ListEcommerceSlotVersions(slots[index].ID)
			if versionErr != nil {
				return nil, versionErr
			}
			for _, version := range versions {
				if ecommerce.IsTerminalSlotStatus(version.Status) {
					continue
				}
				if err := s.repo.UpdateEcommerceSlotVersionStatus(version.ID, ecommerce.SlotStatusPaused, "STOPPED_BY_USER"); err != nil {
					return nil, err
				}
			}
		}
	}
	// 退回 review：用户可以改文案/参数后重新确认派发。
	if err := s.repo.UpdateEcommerceProductStatus(userID, productID,
		ecommerce.ProductStatusReview, product.TitleStatus, "STOPPED_BY_USER: 已停止生成，可修改参数后重新开始"); err != nil {
		return nil, err
	}
	return s.repo.GetEcommerceProduct(userID, productID)
}
