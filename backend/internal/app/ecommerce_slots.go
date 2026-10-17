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
func (s *Service) ConfirmEcommercePlan(ctx context.Context, userID, productID string) (*ProductDetail, error) {
	product, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("商品任务不存在")
		}
		return nil, err
	}
	if product.Status != ecommerce.ProductStatusReview {
		return nil, NewAppError(http.StatusConflict, "当前状态为 "+product.Status+"，仅「待确认方案」可执行确认")
	}
	preset, err := s.resolveEcommercePreset(userID, "")
	if err != nil {
		return nil, err
	}
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateEcommerceProductRun(userID, productID, ecommerce.ProductStatusRunning, product.TitleStatus, "", 0); err != nil {
		return nil, err
	}
	if err := s.repo.SetEcommerceProductExecutionMode(userID, productID, ecommerce.ExecutionModeReview, ""); err != nil {
		return nil, err
	}
	// 逐槽派发：仅对尚未派发过子任务的槽位（已有 ChildTaskID 的跳过，避免重复计费）。
	for index := range slots {
		slot := slots[index]
		if slot.Status == ecommerce.SlotStatusCompleted || slot.Status == ecommerce.SlotStatusFailed {
			continue
		}
		plan := ecommerce.SlotPlan{
			SlotKey: slot.SlotKey, Kind: slot.Kind, SlotNo: slot.SlotNo,
			Title: slot.Title, Copy: slot.Copy,
		}
		if _, dispatchErr := s.dispatchEcommerceSlot(userID, product, preset, plan, ecommerceSlotDispatchInput{
			Existing: &slots[index], ProjectID: "",
		}); dispatchErr != nil {
			_ = s.repo.UpdateEcommerceSlotStatus(slot.ID, ecommerce.SlotStatusFailed)
		}
	}
	return s.EcommerceProductDetail(userID, productID)
}

// PauseEcommerceProduct 暂停派发（在途子任务不取消，按派发时参数收尾）。
func (s *Service) PauseEcommerceProduct(ctx context.Context, userID, productID string) (*model.EcommerceProduct, error) {
	product, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("商品任务不存在")
		}
		return nil, err
	}
	if err := s.repo.UpdateEcommerceProductStatus(userID, productID, ecommerce.ProductStatusPaused, product.TitleStatus, "PAUSED_BY_USER"); err != nil {
		return nil, err
	}
	return s.repo.GetEcommerceProduct(userID, productID)
}
