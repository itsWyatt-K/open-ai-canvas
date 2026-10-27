// 电商工坊平台切换 service（阶段 5 · 三步向导第 1 步）。
//
// 动线：用户在中间区点平台卡片 → 本服务一次性完成两件事——
//  1. 更新用户配置（platform + 主图/详情张数与比例 + 语言），保存即生效；
//  2. 按平台模板重建当前商品「未派发」的槽位（title/sceneType/aspectRatio/
//     copy 引导词/generationPrompt 基底全部平台定制）。
//
// 纪律：
//   - 只重建没有任何派发版本的槽位；已派发/已完成的屏原样保留（不破坏在途计费）；
//   - 平台 key 未知即 400（不静默回落，避免用户以为切了平台其实没切）；
//   - 配置写入走 SaveEcommerceConfig 的既有校验链，不绕开。
package app

import (
	"encoding/json"
	"context"
	"errors"

	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// ApplyEcommercePlatform 切换上架平台并重建当前商品的待派发槽位。
//
// 返回最新商品详情与生效后的配置，前端据此一次性同步「中间分镜卡 + 右侧配置面板」。
func (s *Service) ApplyEcommercePlatform(ctx context.Context, userID, productID, platformKey string) (*ProductDetail, *ecommerce.ConfigView, error) {
	spec := ecommerce.PlatformByKey(platformKey)
	if spec == nil {
		return nil, nil, NewAppError(http.StatusBadRequest, "未知平台：请从内置 6 大平台中选择")
	}
	product, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, kernel.NotFound("商品任务不存在")
		}
		return nil, nil, err
	}
	// 1) 配置：平台 + 主图/详情张数比例 + 语言（一次落库，前端无需再各自保存）。
	cfg, err := s.EcommerceConfig(userID)
	if err != nil {
		return nil, nil, err
	}
	cfg.Platform = spec.Key
	cfg.Hero.Count = spec.HeroCount
	cfg.Hero.Ratio = spec.HeroRatio
	cfg.Detail.Count = spec.DetailCount
	cfg.Detail.Ratio = spec.DetailRatio
	if strings.EqualFold(spec.Language, "en") {
		cfg.Language = "en"
		if strings.TrimSpace(cfg.TitleLanguage) == "" {
			cfg.TitleLanguage = "en"
		}
	} else if strings.TrimSpace(cfg.Language) == "" || strings.EqualFold(cfg.Language, "en") {
		cfg.Language = "zh"
	}
	saved, err := s.SaveEcommerceConfig(userID, *cfg)
	if err != nil {
		return nil, nil, err
	}
	// 产品侧落配置快照（2026-10-27 修复 TestAgentEcommerceApplyPlatform）：
	// 平台切换生效的配置必须落到商品的 config_snapshot_json——此前只写了用户配置，
	// 商品快照全代码库无写入者，导致「 applied 成功但快照查无此平台」。
	if encoded, encErr := json.Marshal(saved); encErr == nil {
		if updErr := s.repo.UpdateEcommerceProductFields(userID, productID, map[string]any{"config_snapshot_json": string(encoded)}); updErr != nil {
			return nil, nil, updErr
		}
	}
	// 2) 槽位：仅 draft/review 商品可重建（running/queued 等在途任务不打断）。
	if product.Status == ecommerce.ProductStatusDraft || product.Status == ecommerce.ProductStatusReview {
		if err := s.rebuildEcommerceSlotsForPlatform(userID, product, *spec); err != nil {
			return nil, nil, err
		}
	}
	detail, err := s.EcommerceProductDetail(userID, productID)
	if err != nil {
		return nil, nil, err
	}
	return detail, saved, nil
}

// rebuildEcommerceSlotsForPlatform 按平台模板刷新「未派发」槽位。
//
// 匹配键（kind, slotNo）跨平台稳定（hero_N / detail_N）；已有任何派发版本的
// 槽位整体跳过（在途/已收尾，不能被平台切换清掉）。模板多出的屏补建为 draft。
func (s *Service) rebuildEcommerceSlotsForPlatform(userID string, product *model.EcommerceProduct, spec ecommerce.PlatformSpec) error {
	slots, err := s.repo.ListEcommerceSlots(product.ID)
	if err != nil {
		return err
	}
	existing := map[string]*model.EcommerceSlot{}
	for index := range slots {
		// 与平台模板同一套规范键（PlatformSlotKey），保证存量槽位能被匹配刷新。
		existing[ecommerce.PlatformSlotKey(slots[index].Kind, slots[index].SlotNo)] = &slots[index]
	}
	now := time.Now()
	for _, plan := range ecommerce.PlatformSlotPlans(spec) {
		key := ecommerce.PlatformSlotKey(plan.Kind, plan.SlotNo)
		current, ok := existing[key]
		if !ok {
			// 模板多出的屏：补建 draft 卡（带平台基底）。
			if err := s.repo.CreateEcommerceSlots([]model.EcommerceSlot{{
				ID: kernel.NewID(), ProductID: product.ID,
				Kind: plan.Kind, SlotNo: plan.SlotNo, SlotKey: plan.SlotKey,
				Title: plan.Title, SceneType: plan.Variant, AspectRatio: plan.Aspect,
				GenerationPrompt: ecommerce.PlatformSlotBasePrompt(plan, spec),
				Status:           ecommerce.SlotStatusDraft,
				CreatedAt:        now, UpdatedAt: now, ReferenceIDsJSON: "[]",
			}}); err != nil {
				return err
			}
			continue
		}
		// 已派发/已收尾的屏：整体跳过（不破坏在途计费与已完成产物）。
		versions, versionErr := s.repo.ListEcommerceSlotVersions(current.ID)
		if versionErr != nil {
			return versionErr
		}
		if len(versions) > 0 {
			continue
		}
		updates := map[string]any{
			"slot_key":          plan.SlotKey,
			"title":             plan.Title,
			"scene_type":        plan.Variant,
			"aspect_ratio":      plan.Aspect,
			"generation_prompt": ecommerce.PlatformSlotBasePrompt(plan, spec),
			"updated_at":        now,
		}
		if strings.TrimSpace(current.Copy) == "" && strings.TrimSpace(plan.Copy) != "" {
			updates["copy"] = plan.Copy
		}
		if err := s.repo.UpdateEcommerceSlotPlan(current.ID, updates); err != nil {
			return err
		}
	}
	return nil
}
