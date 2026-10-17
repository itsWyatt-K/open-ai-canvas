// 电商工坊 M3 编排器：把「商品任务」编排为一组普通画布子任务。
//
// 设计要点（对应《全栈完美修复方案》Milestone 2）：
//   - 消灭 POST /ecommerce/products/:id/start 的 501 占位，改由服务端统一编排；
//   - 上游 54 号表「供料」：按确定性 tool/preset UUID 取内置预设的三段式铁律段，
//     与本地 nxf（:8823）合成的品牌提示词融合；
//   - nxf 不可用时降级为「上游预设模板直接作为正向提示词」，并如实标记 degraded，
//     不伪造提示词；
//   - 负向词（nxf 负向词 + 独乐岛防封词库）经 M1.1 的 negativePrompt 字段下发，
//     不再丢弃；
//   - 商品主图作为 referenceImages[0]（role=subject / strength=0.85 / controlMode=canny）
//     锁定主体一致性；
//   - 槽位与版本落 55 号表（含 dispatch_snapshot_json 与 child_task_id），
//     子任务结果通过对账（reconcile）回写 resource_id 与状态。

package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/workbench"
)

// ecommerceDefaultNXFBase 是酿笑坊视觉 DNA 引擎的默认地址。
const ecommerceDefaultNXFBase = "http://127.0.0.1:8823"

// ecommerceNXFTimeout nxf 合成调用超时（本地引擎，短超时快速降级）。
const ecommerceNXFTimeout = 20 * time.Second

// EcommerceStartOptions 启动参数。channelId + model 为必填（写路径强校验，
// 服务端不猜测模型）。
type EcommerceStartOptions struct {
	PresetID  string   `json:"presetId"`
	ChannelID string   `json:"channelId"`
	Model     string   `json:"model"`
	Size      string   `json:"size"`
	Quality   string   `json:"quality"`
	Count     int      `json:"count"`
	SlotKeys  []string `json:"slotKeys"`
	// ProjectID 子任务归属的画布项目（可空）。
	ProjectID string `json:"projectId"`
	// WithSubjectLayer 是否额外派发「商品透明主体层」任务（三层 PSD 用），默认 true。
	WithSubjectLayer *bool `json:"withSubjectLayer"`
	// SellingPoints / ExtraRequirements：前端产品库的卖点与视觉锚点，
	// 启动时同步落库（导入接口只带名称，卖点需在编排前补齐）。
	SellingPoints     string `json:"sellingPoints"`
	ExtraRequirements string `json:"extraRequirements"`
}

// EcommerceSlotDispatch 单个槽位的派发结果（前端展示编排概览）。
type EcommerceSlotDispatch struct {
	SlotID      string `json:"slotId"`
	SlotKey     string `json:"slotKey"`
	Title       string `json:"title"`
	Kind        string `json:"kind"`
	SlotNo      int    `json:"slotNo"`
	Version     int    `json:"version"`
	VersionID   string `json:"versionId"`
	ChildTaskID string `json:"childTaskId,omitempty"`
	Status      string `json:"status"`
	Prompt      string `json:"prompt"`
	Negative    string `json:"negative,omitempty"`
	// GateHits S5 门禁命中清单（剥离的规则 ID / 改写的红线词；空 = 未触发）。
	GateHits []string `json:"gateHits,omitempty"`
	Error    string   `json:"error,omitempty"`
}

// EcommerceStartResult 启动结果。
type EcommerceStartResult struct {
	ProductID  string                  `json:"productId"`
	Status     string                  `json:"status"`
	PresetKey  string                  `json:"presetKey,omitempty"`
	PresetName string                  `json:"presetName,omitempty"`
	AnchorCard string                  `json:"anchorCard,omitempty"`
	Degraded   []string                `json:"degraded,omitempty"`
	Slots      []EcommerceSlotDispatch `json:"slots"`
	Dispatched int                     `json:"dispatched"`
	Failed     int                     `json:"failed"`
}

// ecommercePlanSnapshot 落 product.plan_json 的编排快照。
type ecommercePlanSnapshot struct {
	PresetKey              string                  `json:"presetKey,omitempty"`
	PresetName             string                  `json:"presetName,omitempty"`
	AnchorCard             string                  `json:"anchorCard,omitempty"`
	Degraded               []string                `json:"degraded,omitempty"`
	SubjectLayerResourceID string                  `json:"subjectLayerResourceId,omitempty"`
	Slots                  []EcommerceSlotDispatch `json:"slots"`
	GeneratedAt            string                  `json:"generatedAt"`
}

// resolveExecutionMode 决定本次编排的执行模式。
//
// 优先级：用户配置栏显式选择（auto|review）> 预设自带 Mode > 兜底 auto。
// 用户配置里是空串/未知值时视为"未选择"，回落预设，避免把用户的配置误判为全自动。
func resolveExecutionMode(userMode, presetMode string) string {
	normalize := func(value string) string {
		mode := strings.ToLower(strings.TrimSpace(value))
		if mode == ecommerce.ExecutionModeReview || mode == ecommerce.ExecutionModeAuto {
			return mode
		}
		return ""
	}
	if mode := normalize(userMode); mode != "" {
		return mode
	}
	if mode := normalize(presetMode); mode != "" {
		return mode
	}
	return ecommerce.ExecutionModeAuto
}

// StartEcommerceProduct 启动商品任务编排（消灭 501）。
func (s *Service) StartEcommerceProduct(userID, productID string, options EcommerceStartOptions) (*EcommerceStartResult, error) {
	product, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("商品任务不存在")
		}
		return nil, err
	}
	if !ecommerce.IsTerminalProductStatus(product.Status) && product.Status != ecommerce.ProductStatusDraft {
		return nil, NewAppError(http.StatusBadRequest, "任务已在运行中，请等待完成或先停止")
	}
	channelID := strings.TrimSpace(options.ChannelID)
	modelName := strings.TrimSpace(options.Model)
	if channelID == "" || modelName == "" {
		return nil, NewAppError(http.StatusBadRequest, "请先选择生图模型与渠道")
	}
	if strings.TrimSpace(product.SourceResourceID) == "" {
		return nil, NewAppError(http.StatusBadRequest, "商品缺少实拍原图，无法锁定主体一致性")
	}

	preset, err := s.resolveEcommercePreset(userID, options.PresetID)
	if err != nil {
		return nil, err
	}
	// 执行模式以「用户配置栏」为准（配置栏 mode: auto|review），覆盖预设默认。
	// 预设自带 Mode 仅作为兜底；用户显式选择优先，避免"选了先审方案却不生效"。
	if userConfig, cfgErr := s.EcommerceConfig(userID); cfgErr == nil && userConfig != nil {
		preset.Mode = resolveExecutionMode(userConfig.Mode, preset.Mode)
	}
	// 卖点/锚点随启动同步（导入接口只带名称；编排前必须补齐，否则提示词缺卖点）。
	if strings.TrimSpace(options.SellingPoints) != "" || strings.TrimSpace(options.ExtraRequirements) != "" {
		if err := s.repo.UpdateEcommerceProductBrief(userID, productID, options.SellingPoints, options.ExtraRequirements); err != nil {
			return nil, err
		}
		product.SellingPoints = options.SellingPoints
		product.ExtraRequirements = options.ExtraRequirements
	}
	plans := selectSlotPlans(preset.Slots, options.SlotKeys)
	if len(plans) == 0 {
		return nil, NewAppError(http.StatusBadRequest, "预设没有可用槽位")
	}

	// 1) 取上游 54 号表铁律段（供料），2) 调 nxf 合成（不可用则降级）。
	upstreamRules := s.upstreamRuleSegments(plans)
	degraded := make([]string, 0, 2)
	synth, synthErr := s.synthesizeEcommercePrompts(preset, product, plans)
	if synthErr != nil {
		degraded = append(degraded, "nxf 视觉DNA 引擎不可用（"+synthErr.Error()+"），已降级为上游预设模板")
	}
	anchorCard := ""
	if synth != nil {
		anchorCard = synth.AnchorCard
	}

	size := firstNonEmpty(strings.TrimSpace(options.Size), preset.Size, "1:1")
	quality := firstNonEmpty(strings.TrimSpace(options.Quality), preset.Quality)
	withSubject := options.WithSubjectLayer == nil || *options.WithSubjectLayer
	// 执行模式从配置取（缺省 auto）：先审方案时槽位建好后停在 review，不派发生图任务。
	executionMode := ecommerce.ExecutionModeAuto
	if preset.Mode == ecommerce.ExecutionModeReview {
		executionMode = ecommerce.ExecutionModeReview
	}

	// 落商品为排队中（写路径先置态，派发失败再回落）。
	if err := s.repo.UpdateEcommerceProductRun(userID, productID, ecommerce.ProductStatusQueued, product.TitleStatus, "", 0); err != nil {
		return nil, err
	}

	result := &EcommerceStartResult{
		ProductID: productID, Status: ecommerce.ProductStatusQueued,
		PresetKey: preset.Key, PresetName: preset.Name, AnchorCard: anchorCard, Degraded: degraded,
	}
	existingSlots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	slotIndex := map[string]*model.EcommerceSlot{}
	for index := range existingSlots {
		slotIndex[existingSlots[index].SlotKey] = &existingSlots[index]
	}

	// 先审方案：槽位先落库（带提示词与方案摘要供人工审阅），但**不派发生图子任务**，
	// 商品转 review 等确认；用户确认后由 ConfirmEcommercePlan 继续派发。
	if executionMode == "review" {
		for _, plan := range plans {
			dispatch, dispatchErr := s.stageEcommerceSlot(userID, product, preset, plan, ecommerceSlotDispatchInput{
				ChannelID: channelID, Model: modelName, Size: size, Quality: quality,
				Count: options.Count, ProjectID: options.ProjectID,
				Synthesized: synth, UpstreamRule: upstreamRules[plan.SlotKey], Existing: slotIndex[plan.SlotKey],
			})
			if dispatchErr != nil {
				dispatch.Status = ecommerce.SlotStatusFailed
				dispatch.Error = dispatchErr.Error()
				result.Failed++
			} else {
				result.Dispatched++
			}
			result.Slots = append(result.Slots, dispatch)
		}
		if err := s.repo.UpdateEcommerceProductRun(userID, productID, ecommerce.ProductStatusReview, product.TitleStatus,
			"", product.PlanRevision); err != nil {
			return nil, err
		}
		if err := s.repo.SetEcommerceProductExecutionMode(userID, productID, "review", ecommerce.StatusReasonAwaitPlanConfirm); err != nil {
			return nil, err
		}
		slots, listErr := s.repo.ListEcommerceSlots(productID)
		if listErr != nil {
			return nil, listErr
		}
		status, titleStatus := ecommerce.ComputeProductStatus(slotViews(slots))
		snapshot := ecommercePlanSnapshot{
			PresetKey: preset.Key, PresetName: preset.Name, AnchorCard: anchorCard, Degraded: degraded,
			Slots: result.Slots, GeneratedAt: time.Now().Format(time.RFC3339),
		}
		planJSON, _ := json.Marshal(snapshot)
		if err := s.repo.UpdateEcommerceProductRun(userID, productID, status, titleStatus, string(planJSON), product.PlanRevision+1); err != nil {
			return nil, err
		}
		result.Status = status
		result.Degraded = append(degraded, "先审方案：已生成各屏方案，确认后才派发生图任务")
		return result, nil
	}

	for _, plan := range plans {
		dispatch, dispatchErr := s.dispatchEcommerceSlot(userID, product, preset, plan, ecommerceSlotDispatchInput{
			ChannelID: channelID, Model: modelName, Size: size, Quality: quality,
			Count: options.Count, ProjectID: options.ProjectID,
			Synthesized: synth, UpstreamRule: upstreamRules[plan.SlotKey], Existing: slotIndex[plan.SlotKey],
		})
		if dispatchErr != nil {
			dispatch.Status = ecommerce.SlotStatusFailed
			dispatch.Error = dispatchErr.Error()
			result.Failed++
		} else {
			result.Dispatched++
		}
		result.Slots = append(result.Slots, dispatch)
	}

	// 商品透明主体层（三层 PSD 的商品主体层通道）。
	subjectResourceID := ""
	if withSubject {
		resourceID, subjectErr := s.dispatchEcommerceSubjectLayer(userID, product, ecommerceSlotDispatchInput{
			ChannelID: channelID, Model: modelName, Size: size, Quality: quality,
			Count: 1, ProjectID: options.ProjectID,
		})
		if subjectErr != nil {
			degraded = append(degraded, "商品透明主体层派发失败（"+subjectErr.Error()+"），三层 PSD 将回退为两层")
		} else {
			subjectResourceID = resourceID
		}
	}

	// 商品状态与方案快照。
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	status, titleStatus := ecommerce.ComputeProductStatus(slotViews(slots))
	snapshot := ecommercePlanSnapshot{
		PresetKey: preset.Key, PresetName: preset.Name, AnchorCard: anchorCard, Degraded: degraded,
		SubjectLayerResourceID: subjectResourceID, Slots: result.Slots,
		GeneratedAt: time.Now().Format(time.RFC3339),
	}
	planJSON, _ := json.Marshal(snapshot)
	if err := s.repo.UpdateEcommerceProductRun(userID, productID, status, titleStatus, string(planJSON), product.PlanRevision+1); err != nil {
		return nil, err
	}
	result.Status = status
	result.Degraded = degraded
	return result, nil
}

// ecommerceSlotDispatchInput 单槽位派发入参。
type ecommerceSlotDispatchInput struct {
	ChannelID    string
	Model        string
	Size         string
	Quality      string
	Count        int
	ProjectID    string
	Synthesized  *nxfBatchResult
	UpstreamRule string
	Existing     *model.EcommerceSlot
}

// ecommerceSlotDraft 槽位草稿：建/复用的槽位 + 已过 S5 门禁的最终提示词与负向词。
type ecommerceSlotDraft struct {
	slot     *model.EcommerceSlot
	prompt   string
	negative string
	gateHits []string
}

// prepareEcommerceSlot 建/复用槽位并算出最终提示词（不派发子任务）。
//
// 提示词优先级：slot.PromptOverride（用户完整覆盖，最高）> nxf 合成/上游模板。
// S5 出口门禁在派发前强制执行；比例冲突直接返回错误。
func (s *Service) prepareEcommerceSlot(userID string, product *model.EcommerceProduct, preset ecommerce.PresetConfig, plan ecommerce.SlotPlan, input ecommerceSlotDispatchInput) (ecommerceSlotDraft, error) {
	draft := ecommerceSlotDraft{}
	slot := input.Existing
	if slot == nil {
		created := model.EcommerceSlot{
			ID: kernel.NewID(), ProductID: product.ID, Kind: plan.Kind, SlotNo: plan.SlotNo,
			SlotKey: plan.SlotKey, Title: plan.Title, Copy: plan.Copy,
			Status: ecommerce.SlotStatusPending, CurrentVersion: 0,
			CreatedAt: time.Now(), UpdatedAt: time.Now(),
		}
		if err := s.repo.CreateEcommerceSlots([]model.EcommerceSlot{created}); err != nil {
			return draft, err
		}
		slot = &created
	}
	draft.slot = slot

	// 用户完整提示词覆盖优先（阶段 1：pr(1) 纪律 —— AI 重策划不覆盖该字段）。
	if override := strings.TrimSpace(slot.PromptOverride); override != "" {
		gate := ecommerce.ComplianceGate(override)
		if gate.Rejected {
			return draft, errors.New("S5 门禁拒绝：" + gate.RejectReason)
		}
		draft.prompt = gate.Filtered
		draft.gateHits = gate.Hits
		draft.negative = ecommerce.MergeNegative(preset.Negative)
		return draft, nil
	}

	prompt, negative := ecommercePromptFor(plan, input.Synthesized)
	prompt = ecommerce.FusePromptWithUpstreamRule(prompt, input.UpstreamRule)
	if strings.TrimSpace(prompt) == "" {
		return draft, errors.New("槽位提示词为空：nxf 与上游预设均不可用")
	}
	gate := ecommerce.ComplianceGate(prompt)
	if gate.Rejected {
		return draft, errors.New("S5 门禁拒绝：" + gate.RejectReason)
	}
	draft.prompt = gate.Filtered
	draft.gateHits = gate.Hits
	draft.negative = ecommerce.MergeNegative(negative, preset.Negative)
	return draft, nil
}

// stageEcommerceSlot 只建槽位与方案（不派发 canvas_image 子任务）——先审方案用。
// 槽位落 queued 等待人工确认；提示词已写入，前端可逐屏审阅/编辑。
func (s *Service) stageEcommerceSlot(userID string, product *model.EcommerceProduct, preset ecommerce.PresetConfig, plan ecommerce.SlotPlan, input ecommerceSlotDispatchInput) (EcommerceSlotDispatch, error) {
	dispatch := EcommerceSlotDispatch{
		SlotKey: plan.SlotKey, Title: plan.Title, Kind: plan.Kind, SlotNo: plan.SlotNo,
		Status: ecommerce.SlotStatusQueued,
	}
	draft, err := s.prepareEcommerceSlot(userID, product, preset, plan, input)
	if err != nil {
		return dispatch, err
	}
	slot := draft.slot
	dispatch.SlotID = slot.ID
	dispatch.Prompt = draft.prompt
	dispatch.Negative = draft.negative
	if len(draft.gateHits) > 0 {
		dispatch.GateHits = draft.gateHits
	}
	if err := s.repo.UpdateEcommerceSlotDispatch(slot.ID, ecommerce.SlotStatusQueued, draft.prompt, "", slot.CurrentVersion); err != nil {
		return dispatch, err
	}
	return dispatch, nil
}

// dispatchEcommerceSlot 建槽位/版本并派发一条 canvas_image 子任务。
func (s *Service) dispatchEcommerceSlot(userID string, product *model.EcommerceProduct, preset ecommerce.PresetConfig, plan ecommerce.SlotPlan, input ecommerceSlotDispatchInput) (EcommerceSlotDispatch, error) {
	dispatch := EcommerceSlotDispatch{
		SlotKey: plan.SlotKey, Title: plan.Title, Kind: plan.Kind, SlotNo: plan.SlotNo,
		Status: ecommerce.SlotStatusQueued,
	}

	draft, err := s.prepareEcommerceSlot(userID, product, preset, plan, input)
	if err != nil {
		return dispatch, err
	}
	slot := draft.slot
	prompt := draft.prompt
	negative := draft.negative
	dispatch.SlotID = slot.ID
	dispatch.Prompt = prompt
	dispatch.Negative = negative
	if len(draft.gateHits) > 0 {
		dispatch.GateHits = draft.gateHits
	}

	versionNo := slot.CurrentVersion + 1
	dispatch.Version = versionNo
	version := model.EcommerceSlotVersion{
		ID: kernel.NewID(), SlotID: slot.ID, Version: versionNo,
		Prompt: prompt, Status: ecommerce.SlotStatusQueued, CreatedAt: time.Now(),
	}

	// 派发子任务（负向词 + 商品主体参考强控）。
	task, err := s.CreateTask(userID, CreateTaskRequest{
		ProjectID: input.ProjectID,
		Type:      "canvas_image",
		Operation: "image",
		Prompt:    prompt,
		Model:     input.Model,
		Input: map[string]any{
			"mode":           "image",
			"prompt":         prompt,
			"negativePrompt": negative,
			"config": map[string]any{
				"channelId": input.ChannelID,
				"model":     input.Model,
				"size":      firstNonEmpty(plan.Aspect, input.Size),
				"quality":   input.Quality,
				"count":     "1",
			},
			"referenceImages": []map[string]any{{
				"storageKey":  "resource:" + product.SourceResourceID,
				"role":        "subject",
				"slotKey":     "reference-main",
				"strength":    0.85,
				"controlMode": "canny",
			}},
			"metadata": map[string]any{
				"source":                   "ecommerce-orchestrator",
				"ecommerceProductId":       product.ID,
				"ecommerceSlotId":          slot.ID,
				"ecommerceSlotKey":         plan.SlotKey,
				"ecommerceSlotVersionId":   version.ID,
				"ecommerceUpstreamToolKey": plan.UpstreamToolKey,
			},
		},
	})
	if err != nil {
		version.Status = ecommerce.SlotStatusFailed
		version.ErrorMessage = truncateError(err)
		if writeErr := s.repo.CreateEcommerceSlotVersion(&version); writeErr != nil {
			return dispatch, writeErr
		}
		_ = s.repo.UpdateEcommerceSlotStatus(slot.ID, ecommerce.SlotStatusFailed)
		return dispatch, err
	}

	version.ChildTaskID = task.ID
	snapshotJSON, _ := json.Marshal(map[string]any{
		"channelId": input.ChannelID, "model": input.Model, "size": plan.Aspect,
		"negativePrompt": negative, "slotKey": plan.SlotKey, "variant": plan.Variant,
		"upstreamToolKey": plan.UpstreamToolKey, "upstreamVariant": plan.UpstreamVariant,
	})
	version.DispatchSnapshotJSON = string(snapshotJSON)
	if err := s.repo.CreateEcommerceSlotVersion(&version); err != nil {
		return dispatch, err
	}
	if err := s.repo.UpdateEcommerceSlotDispatch(slot.ID, ecommerce.SlotStatusQueued, prompt, version.DispatchSnapshotJSON, versionNo); err != nil {
		return dispatch, err
	}
	dispatch.VersionID = version.ID
	dispatch.ChildTaskID = task.ID
	return dispatch, nil
}

// dispatchEcommerceSubjectLayer 派发「商品透明主体层」任务（三层 PSD 用）。
//
// 用上游 product-white-hero 的白底棚拍铁律 + transparentBackground=true，
// 产出可直接作为 PSD「商品主体」层的透明 PNG。返回子任务 ID（对账后即为资源 ID）。
func (s *Service) dispatchEcommerceSubjectLayer(userID string, product *model.EcommerceProduct, input ecommerceSlotDispatchInput) (string, error) {
	prompt := ecommerce.FusePromptWithUpstreamRule(
		"商品实拍图去背景：保留商品本体的轮廓、颜色、材质与可见细节，纯净棚拍光，边缘干净无白边。",
		s.upstreamTemplateFor("product-white-hero", ecommerce.UpstreamVariantStandard),
	)
	// S5 出口门禁：主体层任务同样过检（拒绝时不上传无背景图）。
	gate := ecommerce.ComplianceGate(prompt)
	if gate.Rejected {
		return "", errors.New("S5 门禁拒绝：" + gate.RejectReason)
	}
	prompt = gate.Filtered
	negative := ecommerce.MergeNegative(ecommerce.SoloIslandNegative)
	task, err := s.CreateTask(userID, CreateTaskRequest{
		ProjectID: input.ProjectID,
		Type:      "canvas_image",
		Operation: "image",
		Prompt:    prompt,
		Model:     input.Model,
		Input: map[string]any{
			"mode":           "image",
			"prompt":         prompt,
			"negativePrompt": negative,
			"config": map[string]any{
				"channelId":             input.ChannelID,
				"model":                 input.Model,
				"size":                  "1:1",
				"quality":               input.Quality,
				"count":                 "1",
				"transparentBackground": "true",
			},
			"referenceImages": []map[string]any{{
				"storageKey":  "resource:" + product.SourceResourceID,
				"role":        "subject",
				"slotKey":     "reference-main",
				"strength":    0.9,
				"controlMode": "canny",
			}},
			"metadata": map[string]any{
				"source":             "ecommerce-orchestrator",
				"ecommerceProductId": product.ID,
				"ecommerceRole":      "subject-layer",
			},
		},
	})
	if err != nil {
		return "", err
	}
	return task.ID, nil
}

// SyncEcommerceProduct 对账：把子任务终态回写到槽位版本与商品状态。
// 幂等：已终态的版本不再重复写；仅处理有 child_task_id 且未收尾的版本。
func (s *Service) SyncEcommerceProduct(userID, productID string) (*ProductDetail, error) {
	product, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("商品任务不存在")
		}
		return nil, err
	}
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	pendingTaskIDs := make([]string, 0, len(slots))
	slotByID := map[string]*model.EcommerceSlot{}
	for index := range slots {
		slotByID[slots[index].ID] = &slots[index]
		versions, err := s.repo.ListEcommerceSlotVersions(slots[index].ID)
		if err != nil {
			return nil, err
		}
		if len(versions) == 0 {
			continue
		}
		current := versions[0]
		if strings.TrimSpace(current.ChildTaskID) != "" && !ecommerce.IsSlotStatusTerminal(current.Status) {
			pendingTaskIDs = append(pendingTaskIDs, current.ChildTaskID)
		}
	}
	if len(pendingTaskIDs) > 0 {
		if err := s.reconcileEcommerceSlotVersions(userID, pendingTaskIDs, slotByID); err != nil {
			return nil, err
		}
	}
	// 重新读取槽位后推导商品状态。
	slots, err = s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	status, titleStatus := ecommerce.ComputeProductStatus(slotViews(slots))
	if status != product.Status || titleStatus != product.TitleStatus {
		if err := s.repo.UpdateEcommerceProductStatus(userID, productID, status, titleStatus, product.StatusReason); err != nil {
			return nil, err
		}
		product.Status = status
		product.TitleStatus = titleStatus
	}
	return s.EcommerceProductDetail(userID, productID)
}

// reconcileEcommerceSlotVersions 读取子任务结果并回写版本与槽位。
func (s *Service) reconcileEcommerceSlotVersions(userID string, taskIDs []string, slotByID map[string]*model.EcommerceSlot) error {
	versions, err := s.repo.ListEcommerceSlotVersionsByChildTaskIDs(taskIDs)
	if err != nil {
		return err
	}
	for index := range versions {
		version := versions[index]
		task, err := s.repo.TaskForUser(userID, version.ChildTaskID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return err
		}
		if !taskStatusIsTerminal(task.Status) {
			continue
		}
		slotStatus := ecommerce.SlotStatusFromTaskStatus(string(task.Status))
		resourceID := ""
		errorMessage := ""
		if slotStatus == ecommerce.SlotStatusCompleted {
			resourceID = s.generatedResourceIDFromTask(userID, task)
			if resourceID == "" {
				slotStatus = ecommerce.SlotStatusUncertain
				errorMessage = "子任务已完成但未取到产物资源"
			}
		} else {
			errorMessage = truncateError(errors.New(firstNonEmpty(task.Stage, "生图失败")))
		}
		if err := s.repo.UpdateEcommerceSlotVersionResult(version.ID, slotStatus, resourceID, errorMessage); err != nil {
			return err
		}
		if slot, ok := slotByID[version.SlotID]; ok {
			if err := s.repo.UpdateEcommerceSlotStatus(slot.ID, slotStatus); err != nil {
				return err
			}
			slot.Status = slotStatus
		}
	}
	return nil
}

// generatedResourceIDFromTask 从子任务结果中取首个产物资源 ID。
// 结果里的 data URL 由 persistGeneratedMediaResult 落盘后带 resourceId。
func (s *Service) generatedResourceIDFromTask(userID string, task *model.Task) string {
	if task == nil || strings.TrimSpace(task.ResultJSON) == "" {
		return ""
	}
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
		return ""
	}
	if resourceID := firstImageResourceID(result); resourceID != "" {
		return resourceID
	}
	// 结果尚未持久化（历史任务）→ 走一次持久化再取。
	persisted, err := s.persistGeneratedMediaResult(userID, result)
	if err != nil {
		return ""
	}
	return firstImageResourceID(persisted)
}

// firstImageResourceID 深度优先找结果里第一个 resourceId。
func firstImageResourceID(value interface{}) string {
	switch item := value.(type) {
	case map[string]interface{}:
		if resourceID, ok := item["resourceId"].(string); ok && strings.TrimSpace(resourceID) != "" {
			return strings.TrimSpace(resourceID)
		}
		for _, key := range []string{"images", "data", "output", "result"} {
			if child, ok := item[key]; ok {
				if found := firstImageResourceID(child); found != "" {
					return found
				}
			}
		}
	case []interface{}:
		for _, child := range item {
			if found := firstImageResourceID(child); found != "" {
				return found
			}
		}
	}
	return ""
}

// resolveEcommercePreset 取预设：指定 ID 则按 ID，否则确保内置独乐岛预设存在。
func (s *Service) resolveEcommercePreset(userID, presetID string) (ecommerce.PresetConfig, error) {
	if trimmed := strings.TrimSpace(presetID); trimmed != "" {
		preset, err := s.repo.EcommercePresetByID(userID, trimmed)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ecommerce.PresetConfig{}, kernel.NotFound("预设不存在")
			}
			return ecommerce.PresetConfig{}, err
		}
		config, err := ecommerce.NormalizePresetConfig(preset.ConfigJSON)
		if err != nil {
			return ecommerce.PresetConfig{}, NewAppError(http.StatusBadRequest, "预设配置无效："+err.Error())
		}
		return config, nil
	}
	// 未指定 → 确保内置独乐岛预设已落库，再读取。
	if err := s.ensureBuiltinEcommercePresets(userID); err != nil {
		return ecommerce.PresetConfig{}, err
	}
	presets, err := s.repo.ListEcommercePresets(userID)
	if err != nil {
		return ecommerce.PresetConfig{}, err
	}
	for _, preset := range presets {
		config, err := ecommerce.NormalizePresetConfig(preset.ConfigJSON)
		if err != nil {
			continue
		}
		if config.Key == ecommerce.SoloIslandPresetKey {
			return config, nil
		}
	}
	// 落库后仍未找到（写入竞态等极端情况）→ 直接返回默认预设，不阻断编排。
	return ecommerce.DefaultSoloIslandPreset(), nil
}

// ensureBuiltinEcommercePresets 幂等确保内置预设（独乐岛 7 屏）已写入用户预设表。
//
// 阶段 0 修复：原逻辑只在 start 编排时才落库，导致用户首次打开「生成配置」栏时
// 预设列表为空。现在 ListEcommercePresets 读取前也调用本函数，保证入口可见。
// 幂等：已存在（按 config_json.key 匹配）则跳过，不重复写入。
func (s *Service) ensureBuiltinEcommercePresets(userID string) error {
	presets, err := s.repo.ListEcommercePresets(userID)
	if err != nil {
		return err
	}
	for _, preset := range presets {
		config, err := ecommerce.NormalizePresetConfig(preset.ConfigJSON)
		if err != nil {
			continue
		}
		if config.Key == ecommerce.SoloIslandPresetKey {
			return nil // 已存在
		}
	}
	defaults := ecommerce.DefaultSoloIslandPreset()
	raw, _ := json.Marshal(defaults)
	return s.repo.UpsertEcommercePreset(&model.EcommercePreset{
		UserID: userID, Name: defaults.Name, ConfigJSON: string(raw),
	})
}

// upstreamRuleSegments 取各槽位对应的上游预设铁律段（供料）。
// 上游表未写入时返回空串（不阻断编排，融合函数会跳过空段）。
func (s *Service) upstreamRuleSegments(plans []ecommerce.SlotPlan) map[string]string {
	rules := make(map[string]string, len(plans))
	for _, plan := range plans {
		rules[plan.SlotKey] = s.upstreamTemplateFor(plan.UpstreamToolKey, plan.UpstreamVariant)
	}
	return rules
}

// upstreamTemplateFor 按确定性 UUID 取上游内置预设模板全文。
func (s *Service) upstreamTemplateFor(toolKey, variantKey string) string {
	toolKey = strings.TrimSpace(toolKey)
	if toolKey == "" {
		return ""
	}
	if variantKey == "" {
		variantKey = ecommerce.UpstreamVariantStandard
	}
	preset, err := s.repo.WorkbenchPreset(workbench.BuiltinPresetID(toolKey, variantKey))
	if err != nil || preset == nil {
		return ""
	}
	return preset.PromptTemplate
}

// ecommercePromptFor 从 nxf 合成结果中挑出该槽位（scene+variant）的提示词与负向词。
func ecommercePromptFor(plan ecommerce.SlotPlan, synth *nxfBatchResult) (string, string) {
	if synth == nil {
		return "", ""
	}
	for _, prompt := range synth.Prompts {
		if prompt.Variant == plan.Variant && (plan.Scene == "" || prompt.Scene == plan.Scene) {
			return prompt.Prompt, prompt.Negative
		}
	}
	// 变体名未命中时退回该场景首条（nxf 模板变化时的兜底）。
	for _, prompt := range synth.Prompts {
		if plan.Scene == "" || prompt.Scene == plan.Scene {
			return prompt.Prompt, prompt.Negative
		}
	}
	return "", ""
}

// selectSlotPlans 按 slotKeys 过滤槽位计划（空 = 全部）。
func selectSlotPlans(plans []ecommerce.SlotPlan, slotKeys []string) []ecommerce.SlotPlan {
	if len(slotKeys) == 0 {
		return plans
	}
	wanted := map[string]bool{}
	for _, key := range slotKeys {
		if trimmed := strings.TrimSpace(key); trimmed != "" {
			wanted[trimmed] = true
		}
	}
	result := make([]ecommerce.SlotPlan, 0, len(plans))
	for _, plan := range plans {
		if wanted[plan.SlotKey] {
			result = append(result, plan)
		}
	}
	return result
}

// slotViews 把槽位行转为状态推导输入。
func slotViews(slots []model.EcommerceSlot) []ecommerce.SlotView {
	views := make([]ecommerce.SlotView, 0, len(slots))
	for _, slot := range slots {
		views = append(views, ecommerce.SlotView{Status: slot.Status})
	}
	return views
}

func taskStatusIsTerminal(status model.TaskStatus) bool {
	switch status {
	case model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled:
		return true
	default:
		return false
	}
}

func truncateError(err error) string {
	if err == nil {
		return ""
	}
	message := strings.TrimSpace(err.Error())
	if len([]rune(message)) > 400 {
		return string([]rune(message)[:400])
	}
	return message
}

// ---------------------------------------------------------------- nxf 视觉DNA 客户端

// nxfBatchResult 是 :8823 /api/nxf/visual-dna/batch 的响应子集。
type nxfBatchResult struct {
	AnchorCard string          `json:"anchor_card"`
	Prompts    []nxfPromptItem `json:"prompts"`
	Groups     []struct {
		Scene string `json:"scene"`
		Label string `json:"label"`
		Count int    `json:"count"`
	} `json:"groups"`
}

type nxfPromptItem struct {
	Index    int    `json:"index"`
	Scene    string `json:"scene"`
	Variant  string `json:"variant"`
	Aspect   string `json:"aspect"`
	Prompt   string `json:"prompt"`
	Negative string `json:"negative"`
}

// nxfBridgeBase 解析 nxf 引擎地址（可用 CANVAS_NXF_BRIDGE_BASE 覆盖）。
func nxfBridgeBase() string {
	if configured := strings.TrimSpace(os.Getenv("CANVAS_NXF_BRIDGE_BASE")); configured != "" {
		return strings.TrimRight(configured, "/")
	}
	return ecommerceDefaultNXFBase
}

// synthesizeEcommercePrompts 调 nxf 合成各槽位提示词。
func (s *Service) synthesizeEcommercePrompts(preset ecommerce.PresetConfig, product *model.EcommerceProduct, plans []ecommerce.SlotPlan) (*nxfBatchResult, error) {
	scenes := make([]string, 0, len(plans))
	sceneParams := map[string]any{}
	for _, plan := range plans {
		if plan.Scene == "" {
			continue
		}
		variants, _ := sceneParams[plan.Scene].(map[string]any)
		if variants == nil {
			variants = map[string]any{}
			sceneParams[plan.Scene] = variants
		}
		existing, _ := variants["variants"].([]string)
		variants["variants"] = append(existing, plan.Variant)
		scenes = append(scenes, plan.Scene)
	}
	scenes = uniqueStrings(scenes)
	if len(scenes) == 0 {
		return nil, errors.New("槽位未定义 nxf 场景")
	}
	body := map[string]any{
		"dna":          preset.DNA,
		"product":      ecommerceProductPayload(product),
		"scenes":       scenes,
		"scene_params": sceneParams,
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), ecommerceNXFTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, nxfBridgeBase()+"/api/nxf/visual-dna/batch", bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: ecommerceNXFTimeout}
	response, err := client.Do(request)
	if err != nil {
		return nil, errors.New("连接失败")
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("引擎返回 %d", response.StatusCode)
	}
	var decoded struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
		nxfBatchResult
	}
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil, errors.New("响应解析失败")
	}
	if !decoded.OK {
		return nil, errors.New(firstNonEmpty(decoded.Error, "引擎拒绝合成请求"))
	}
	if len(decoded.Prompts) == 0 {
		return nil, errors.New("引擎未返回提示词")
	}
	result := decoded.nxfBatchResult
	return &result, nil
}

// ecommerceProductPayload 组装 nxf product 入参（卖点解析为数组）。
func ecommerceProductPayload(product *model.EcommerceProduct) map[string]any {
	sellingPoints := make([]string, 0, 5)
	for _, line := range strings.FieldsFunc(product.SellingPoints, func(r rune) bool {
		return r == '\n' || r == '、' || r == ',' || r == '，' || r == ';' || r == '；'
	}) {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			sellingPoints = append(sellingPoints, trimmed)
		}
		if len(sellingPoints) >= 5 {
			break
		}
	}
	return map[string]any{
		"name":           product.Name,
		"anchors":        product.ExtraRequirements,
		"selling_points": sellingPoints,
	}
}

func uniqueStrings(values []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" && !seen[trimmed] {
			seen[trimmed] = true
			result = append(result, trimmed)
		}
	}
	return result
}
