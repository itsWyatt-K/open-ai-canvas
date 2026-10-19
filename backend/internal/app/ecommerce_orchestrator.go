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
	"log"
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
	// 派发参数（阶段 4 修复）：确认/恢复派发与 Sync 顺延补派时复用，
	// 避免「确认时传了模型、Sync 补派时取不到」的断链。
	ChannelID string `json:"channelId,omitempty"`
	Model     string `json:"model,omitempty"`
	Size      string `json:"size,omitempty"`
	Quality   string `json:"quality,omitempty"`
}

// ecommerceDispatchCapacity 返回该用户当前还能派发几条画布子任务。
//
// 平台运行策略限制同时在途（排队+运行）任务数（默认 5），电商 7 屏一次确认
// 必然超出。编排器按容量派发，超出的槽位顺延为 pending/draft，由 Sync 对账
// 时在容量释放后自动补派——不把「排队已满」伪装成「该屏生成失败」。
func (s *Service) ecommerceDispatchCapacity(userID string) (int, error) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return 0, err
	}
	active, err := s.repo.ActiveTaskCountForUser(userID)
	if err != nil {
		return 0, err
	}
	remaining := int(policy.Task.ActiveTaskLimit) - int(active)
	if remaining < 0 {
		remaining = 0
	}
	return remaining, nil
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

	// 1) 取上游 54 号表铁律段（供料）。
	upstreamRules := s.upstreamRuleSegments(plans)
	degraded := make([]string, 0, 2)
	// 先读库内槽位：既用于判断「是否还需要 nxf 合成」，也用于按 SlotKey 复用槽位。
	existingSlots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	slotIndex := map[string]*model.EcommerceSlot{}
	for index := range existingSlots {
		slotIndex[existingSlots[index].SlotKey] = &existingSlots[index]
	}
	// 2) nxf 合成：**仅当库里确实没有提示词时才调用**（阶段 5 返工铁律）。
	//    库里已有 apply-platform / AI 策划 / 编辑器写好的提示词时，直接使用，
	//    不调已经连不上的 nxf，更不被空模板覆盖。
	var synth *nxfBatchResult
	if ecommerceSlotsNeedSynthesis(plans, slotIndex) {
		var synthErr error
		synth, synthErr = s.synthesizeEcommercePrompts(preset, product, plans)
		if synthErr != nil {
			degraded = append(degraded, "nxf 视觉DNA 引擎不可用（"+synthErr.Error()+"），已改用库内提示词/平台模板兜底")
		}
	} else {
		degraded = append(degraded, "库内已有各屏提示词，直接使用（未调用 nxf 引擎）")
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
			ChannelID: channelID, Model: modelName, Size: size, Quality: quality,
		}
		// 阶段 5 返工：编排摘要只写 diag_json，**不污染 plan_json**（plan_json 只存 AI 策划）。
		s.writeEcommerceDiag(userID, productID, snapshot)
		if err := s.repo.UpdateEcommerceProductRun(userID, productID, status, titleStatus, "", 0); err != nil {
			return nil, err
		}
		s.surfaceEcommerceDispatchError(userID, productID, result.Slots)
		result.Status = status
		result.Degraded = append(degraded, "先审方案：已生成各屏方案，确认后才派发生图任务")
		return result, nil
	}

	deferred := make([]string, 0, len(plans))
	for _, plan := range plans {
		// 容量预检（阶段 4 修复）：在途任务已满时槽位顺延为 pending，
		// 由 Sync 对账在容量释放后补派；不计失败、不计费。
		if remaining, capErr := s.ecommerceDispatchCapacity(userID); capErr == nil && remaining <= 0 {
			existing := slotIndex[plan.SlotKey]
			slotID := ""
			if existing != nil {
				slotID = existing.ID
				if existing.Status != ecommerce.SlotStatusPending {
					_ = s.repo.UpdateEcommerceSlotStatus(existing.ID, ecommerce.SlotStatusPending)
				}
			}
			result.Slots = append(result.Slots, EcommerceSlotDispatch{
				SlotID: slotID, SlotKey: plan.SlotKey, Title: plan.Title,
				Kind: plan.Kind, SlotNo: plan.SlotNo, Status: ecommerce.SlotStatusPending,
			})
			deferred = append(deferred, plan.SlotKey)
			continue
		}
		dispatch, dispatchErr := s.dispatchEcommerceSlot(userID, product, preset, plan, ecommerceSlotDispatchInput{
			ChannelID: channelID, Model: modelName, Size: size, Quality: quality,
			Count: options.Count, ProjectID: options.ProjectID,
			Synthesized: synth, UpstreamRule: upstreamRules[plan.SlotKey], Existing: slotIndex[plan.SlotKey],
		})
		if dispatchErr != nil {
			// 容量竞态：预检后名额被占 → 计顺延不计失败。
			if errors.Is(dispatchErr, errEcommerceQueueFull) {
				dispatch.Status = ecommerce.SlotStatusPending
				dispatch.Error = dispatchErr.Error()
				deferred = append(deferred, plan.SlotKey)
				result.Slots = append(result.Slots, dispatch)
				continue
			}
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

	// 商品状态与编排诊断（写 diag_json，不动 plan_json）。
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	status, titleStatus := ecommerce.ComputeProductStatus(slotViews(slots))
	snapshot := ecommercePlanSnapshot{
		PresetKey: preset.Key, PresetName: preset.Name, AnchorCard: anchorCard, Degraded: degraded,
		SubjectLayerResourceID: subjectResourceID, Slots: result.Slots,
		GeneratedAt: time.Now().Format(time.RFC3339),
		ChannelID:   channelID, Model: modelName, Size: size, Quality: quality,
	}
	s.writeEcommerceDiag(userID, productID, snapshot)
	if err := s.repo.UpdateEcommerceProductRun(userID, productID, status, titleStatus, "", 0); err != nil {
		return nil, err
	}
	s.surfaceEcommerceDispatchError(userID, productID, result.Slots)
	result.Status = status
	if len(deferred) > 0 {
		degraded = append(degraded, fmt.Sprintf("%d 屏因同时在途任务已达上限顺延派发，容量释放后自动继续", len(deferred)))
	}
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

// ecommerceSlotDraft 槽位草稿。
//
// 【返工铁律】两个提示词严格分离：
//   - prompt：落库/展示用（generation_prompt、版本快照、前端「画面构图简述」与
//     「画面描述」）——只含本屏专属的产品视角/场景道具/光影色调/构图描述；
//   - dispatch：真正发往生图模型的提示词 = prompt + 文字排版后缀 + 内部防走形护栏。
//
// 通用护栏与排版指令绝不进 generation_prompt（主人返工令）。
type ecommerceSlotDraft struct {
	slot     *model.EcommerceSlot
	prompt   string
	dispatch string
	negative string
	gateHits []string
}

// buildEcommerceDispatchPrompt 组装「真正发往模型」的提示词。
//
// 结构：本屏场景描述（= 落库那一段） → 文字排版后缀 → 内部防走形护栏（含上游铁律段）。
// 上游铁律段为空时跳过，不注入空段、不重复注入。
func buildEcommerceDispatchPrompt(prompt string, slotCopy string, textMode string, upstreamRule string) string {
	parts := make([]string, 0, 3)
	if base := strings.TrimSpace(prompt); base != "" {
		parts = append(parts, base)
	}
	parts = append(parts, ecommerce.SlotCopyDirective(slotCopy, textMode))
	guardrail := ecommerce.SlotDispatchGuardrail()
	if rule := ecommerce.UpstreamRuleSegment(upstreamRule); rule != "" {
		guardrail = guardrail + "\n主体一致性铁律（上游预设）：" + rule
	}
	parts = append(parts, guardrail)
	return strings.Join(parts, "\n")
}

// ecommerceSlotTextMode 取本屏对应的文字排版模式（主图/详情页各自的 textMode）。
// 读不到用户配置时回落 typeset（有文案就排版、无文案纯图），不阻断派发。
func (s *Service) ecommerceSlotTextMode(userID string, kind string) string {
	config, err := s.EcommerceConfig(userID)
	if err != nil || config == nil {
		return ecommerce.TextModeTypeset
	}
	if strings.TrimSpace(kind) == ecommerce.SlotKindDetail {
		return config.Detail.TextMode
	}
	return config.Hero.TextMode
}

// prepareEcommerceSlot 建/复用槽位并算出最终提示词（不派发子任务）。
//
// 提示词优先级（阶段 5 返工 · 主人铁律）：
//  1. `slot.PromptOverride`（人工完整覆盖，最高）；
//  2. `slot.GenerationPrompt`（**数据库已有方案**：apply-platform / AI 策划 /
//     编辑器 / Agent 写入的提示词，直接使用，绝不重新合成、绝不洗成空串）；
//  3. nxf 合成结果（仅当库里确实没有提示词时才尝试）；
//  4. 平台模板兜底（platforms.PlatformSlotBasePrompt + 商品名称/卖点/附加要求 +
//     本屏 Title/SceneType 组装）——**保证 prompt 永不为空**。
//
// 阶段 5 实测教训：旧逻辑先跑 nxf/上游再回退，nxf 连不上时若上游模板缺失，
// 会把库里有方案的槽位判成「提示词为空」并直接失败；主人要求「严禁用空模板洗掉已有方案」。
//
// 【返工铁律】本函数产出的 draft.prompt **只含本屏场景与构图描述**（落 generation_prompt
// 给用户看的那一段），通用防走形护栏与文字排版指令一律不进这里，只在
// draft.dispatch 里作为发往模型的内部后缀拼接。
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
	slotCopy := firstNonEmpty(slot.Copy, plan.Copy)
	textMode := s.ecommerceSlotTextMode(userID, firstNonEmpty(slot.Kind, plan.Kind))
	// 收口：落库用纯净提示词，派发用「纯净 + 排版后缀 + 内部护栏」。
	finish := func(prompt string, negative string, gateHits []string) ecommerceSlotDraft {
		draft.prompt = prompt
		draft.negative = negative
		draft.gateHits = gateHits
		draft.dispatch = buildEcommerceDispatchPrompt(prompt, slotCopy, textMode, input.UpstreamRule)
		return draft
	}
	negative := ecommerce.MergeNegative(preset.Negative)

	// 1) 人工完整覆盖最高优先（pr(1) 纪律：AI 重策划不覆盖该字段）。
	if override := strings.TrimSpace(slot.PromptOverride); override != "" {
		gate := ecommerce.ComplianceGate(override)
		if gate.Rejected {
			return draft, errors.New("S5 门禁拒绝：" + gate.RejectReason)
		}
		return finish(gate.Filtered, negative, gate.Hits), nil
	}

	// 2) 数据库已有提示词：直接使用（这是 apply-platform/AI 策划/编辑器的成果，
	//    不重新合成、不调 nxf、不被空模板覆盖）。
	if staged := strings.TrimSpace(slot.GenerationPrompt); staged != "" {
		gate := ecommerce.ComplianceGate(staged)
		if gate.Rejected {
			return draft, errors.New("S5 门禁拒绝：" + gate.RejectReason)
		}
		return finish(gate.Filtered, negative, gate.Hits), nil
	}

	// 3) 库里没有提示词才尝试 nxf 合成（nxf 不可用时 input.Synthesized 为 nil）。
	prompt, synthNegative := ecommercePromptFor(plan, input.Synthesized)
	if strings.TrimSpace(prompt) == "" {
		// 4) 平台模板兜底：用商品事实 + 本屏信息组装，绝不让 prompt 为空。
		prompt = ecommerce.ComposeSlotFallbackPrompt(ecommerce.SlotPromptContext{
			ProductName:       product.Name,
			SellingPoints:     product.SellingPoints,
			ExtraRequirements: product.ExtraRequirements,
			SlotTitle:         firstNonEmpty(slot.Title, plan.Title),
			SlotSceneType:     firstNonEmpty(slot.SceneType, plan.Variant),
			PlatformKey:       s.ecommercePlatformKey(userID),
			Aspect:            firstNonEmpty(plan.Aspect, slot.AspectRatio, "1:1"),
		})
	}
	if strings.TrimSpace(prompt) == "" {
		// 理论上兜底函数永不为空；真为空说明平台字典被清空，仍要给出可读原因。
		return draft, errors.New("无法为该屏组装生图提示词：商品名称与平台模板均为空，请先填写商品名称或切换平台")
	}
	gate := ecommerce.ComplianceGate(prompt)
	if gate.Rejected {
		return draft, errors.New("S5 门禁拒绝：" + gate.RejectReason)
	}
	return finish(gate.Filtered, ecommerce.MergeNegative(synthNegative, preset.Negative), gate.Hits), nil
}

// stageEcommerceSlot 只建槽位与方案（不派发 canvas_image 子任务）——先审方案用。
//
// 槽位落 draft（而非 queued）：queued 的语义是"已派发、等子任务执行"，
// 会被 ComputeProductStatus 判为在途 → 推导成 running → 把 review 覆盖掉，
// 最终 confirm-plan 又因 status!=review 被拒 → 死锁。
// draft 表示"方案已备、未派发"，既让前端看到卡片与提示词，又不冒充在途。
func (s *Service) stageEcommerceSlot(userID string, product *model.EcommerceProduct, preset ecommerce.PresetConfig, plan ecommerce.SlotPlan, input ecommerceSlotDispatchInput) (EcommerceSlotDispatch, error) {
	dispatch := EcommerceSlotDispatch{
		SlotKey: plan.SlotKey, Title: plan.Title, Kind: plan.Kind, SlotNo: plan.SlotNo,
		Status: ecommerce.SlotStatusDraft,
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
	if err := s.repo.UpdateEcommerceSlotDispatch(slot.ID, ecommerce.SlotStatusDraft, draft.prompt, "", slot.CurrentVersion); err != nil {
		return dispatch, err
	}
	return dispatch, nil
}

// errEcommerceQueueFull 顺延派发哨兵：CreateTask 因平台在途任务上限被拒时包装返回，
// 调用方据此计「顺延」而非「失败」（阶段 4 容量修复）。
var errEcommerceQueueFull = errors.New("同时在途任务已达上限，顺延派发")

// isQueueFullError 识别平台在途任务上限错误。CreateTask 把
// repository.ErrActiveTaskLimit 包装成了 400 文案（哨兵在包装层丢失），
// 这里按 task_creation.go 的稳定格式化口径匹配。
func isQueueFullError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "同时排队或运行的任务最多")
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
	// prompt：落库/展示用（只含本屏场景与构图）；dispatchPrompt：真正发往模型的完整提示词。
	prompt := draft.prompt
	dispatchPrompt := draft.dispatch
	negative := draft.negative
	dispatch.SlotID = slot.ID
	dispatch.Prompt = prompt
	dispatch.Negative = negative
	if len(draft.gateHits) > 0 {
		dispatch.GateHits = draft.gateHits
	}

	// 版本号取「current_version 与版本表最大值」的较大者 +1：历史失败态下
	// current_version 可能没随版本行推进，只取前者会撞唯一约束 (slot_id, version)。
	versionNo := s.nextEcommerceSlotVersion(slot.ID, slot.CurrentVersion)
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
		Prompt:    dispatchPrompt,
		Model:     input.Model,
		Input: map[string]any{
			"mode":           "image",
			"prompt":         dispatchPrompt,
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
		// 容量竞态：预检通过、但落库前名额被该用户其他任务占掉 → 不计失败，
		// 槽位留待派发态，等下次对账补派；也未产生任何计费。
		if isQueueFullError(err) {
			_ = s.repo.UpdateEcommerceSlotStatus(slot.ID, ecommerce.SlotStatusPending)
			return dispatch, fmt.Errorf("%w：%s", errEcommerceQueueFull, err.Error())
		}
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

// dispatchSnapshotFor 取本商品「派发口径快照」（渠道/模型/尺寸/质量）。
//
// 阶段 5 返工：编排摘要已从 plan_json 迁到 diag_json（plan_json 只存 AI 策划方案，
// 主人要求严禁用诊断覆盖它）。补派必须优先读 diag_json；
// 但老数据（返工前确认的商品）只有 plan_json 带派发快照，故保留只读回退，
// 命中条件是必须真的能解出 ChannelID+Model，否则视为无快照（不盲派）。
func dispatchSnapshotFor(product *model.EcommerceProduct) (ecommercePlanSnapshot, bool) {
	for _, raw := range []string{product.DiagJSON, product.PlanJSON} {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		var snapshot ecommercePlanSnapshot
		if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
			continue
		}
		if strings.TrimSpace(snapshot.ChannelID) == "" || strings.TrimSpace(snapshot.Model) == "" {
			continue
		}
		return snapshot, true
	}
	return ecommercePlanSnapshot{}, false
}

// continueEcommerceDispatch 顺延补派：对「已确认（running/queued）但仍有
// draft/pending 屏未派发」的商品，按当前容量继续派发。
//
// 背景（阶段 4 容量修复）：平台默认同时在途任务上限 5，而一组方案通常 7 屏，
// 一次确认必然有屏派不出去。超出的屏顺延为 draft/pending，由本函数在
// SyncEcommerceProduct（前端轮询详情即隐式对账）中按容量补派。
//
// 安全边界：
//   - 只补派 running/queued 商品（用户已确认，非 review/draft 待确认态）；
//   - 槽位必须带 stage 落库的提示词（generation_prompt），否则跳过等用户编辑；
//   - 渠道/模型取自确认时写入的方案快照（plan_json），缺参即跳过不盲派；
//   - 每屏仅派发一次：成功即转 queued 并落带 child_task_id 的版本，幂等。
func (s *Service) continueEcommerceDispatch(userID string, product *model.EcommerceProduct) (int, error) {
	if product.Status != ecommerce.ProductStatusRunning && product.Status != ecommerce.ProductStatusQueued {
		return 0, nil
	}
	snapshot, ok := dispatchSnapshotFor(product)
	if !ok {
		return 0, nil // 无派发快照（渠道/模型不可知）不盲派，等下轮或等用户确认
	}
	preset, err := s.resolveEcommercePreset(userID, "")
	if err != nil {
		return 0, err
	}
	slots, err := s.repo.ListEcommerceSlots(product.ID)
	if err != nil {
		return 0, err
	}
	dispatched := 0
	for index := range slots {
		slot := slots[index]
		if slot.Status != ecommerce.SlotStatusDraft && slot.Status != ecommerce.SlotStatusPending {
			continue
		}
		if strings.TrimSpace(slot.GenerationPrompt) == "" {
			continue // 无方案提示词（裸卡），补派必失败，等用户编辑
		}
		versions, versionErr := s.repo.ListEcommerceSlotVersions(slot.ID)
		if versionErr != nil {
			return dispatched, versionErr
		}
		if len(versions) > 0 && strings.TrimSpace(versions[0].ChildTaskID) != "" &&
			!ecommerce.IsTerminalSlotStatus(versions[0].Status) {
			continue // 已有在途版本（对账尚未收尾），不重复派发
		}
		remaining, capErr := s.ecommerceDispatchCapacity(userID)
		if capErr != nil || remaining <= 0 {
			break // 容量再满即停，下次对账继续
		}
		plan := ecommerce.SlotPlan{
			SlotKey: slot.SlotKey, Kind: slot.Kind, SlotNo: slot.SlotNo,
			Title: slot.Title, Copy: slot.Copy,
			Aspect: firstNonEmpty(strings.TrimSpace(slot.AspectRatio), snapshot.Size),
		}
		if _, dispatchErr := s.dispatchEcommerceSlot(userID, product, preset, plan, ecommerceSlotDispatchInput{
			Existing: &slots[index], ChannelID: snapshot.ChannelID, Model: snapshot.Model,
			Size: snapshot.Size, Quality: snapshot.Quality, Count: 1,
		}); dispatchErr != nil {
			// 容量竞态：名额又没了，停止本轮补派（槽位已被 dispatch 留为 pending）。
			// 真实失败：dispatchEcommerceSlot 已落失败态与原因，继续试下一屏。
			if errors.Is(dispatchErr, errEcommerceQueueFull) {
				break
			}
			continue
		}
		dispatched++
	}
	return dispatched, nil
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
	// 顺延补派（阶段 4 容量修复）：已确认商品中因在途满额而顺延的屏，
	// 在容量释放后自动继续派发（幂等，仅在 running/queued 且快照带参数时生效）。
	if product.Status == ecommerce.ProductStatusRunning || product.Status == ecommerce.ProductStatusQueued {
		if _, contErr := s.continueEcommerceDispatch(userID, product); contErr != nil {
			return nil, contErr
		}
	}
	// 重新读取槽位后推导商品状态。
	slots, err = s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	// 死锁自愈（阶段 4 修复）：先审方案态下槽位是 draft/queued 但**从未派发**
	// （无 slot_versions），旧版 ComputeProductStatus 会把 queued 当在途，
	// 把 review 覆盖成 running，而 confirm-plan 又要求 status==review → 用户被锁死。
	// 这里显式识别「没有任何子任务在途」的待确认态，回落到 review。
	if product.Status == ecommerce.ProductStatusReview ||
		(product.StatusReason == ecommerce.StatusReasonAwaitPlanConfirm && !s.hasInFlightSlotVersion(slots)) {
		if !s.hasInFlightSlotVersion(slots) {
			if err := s.repo.UpdateEcommerceProductStatus(userID, productID,
				ecommerce.ProductStatusReview, product.TitleStatus, ecommerce.StatusReasonAwaitPlanConfirm); err != nil {
				return nil, err
			}
			product.Status = ecommerce.ProductStatusReview
			product.StatusReason = ecommerce.StatusReasonAwaitPlanConfirm
			return s.EcommerceProductDetail(userID, productID)
		}
	}
	status, titleStatus := ecommerce.ComputeProductStatus(slotViews(slots))
	// queued 保持：已确认但全部屏都还在顺延（容量未释放）时，ComputeProductStatus
	// 会把「全 draft/pending」推导成 draft——那等于悄悄撤销用户的确认。这里显式
	// 保持 queued（"已确认、等容量"的诚实中间态），等补派成功后再自然转 running。
	if product.Status == ecommerce.ProductStatusQueued && status == ecommerce.ProductStatusDraft {
		status = ecommerce.ProductStatusQueued
	}
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

// resolveEcommercePreset 取预设：指定 ID 则按 ID；未指定则用**通用电商标准**预设。
//
// 阶段 2 修复：默认不再是独乐岛（成人用品品类专用），避免普通商品被套上
// 情趣用品文案。独乐岛改为**显式选择**（presetID = solo_island_aesop）。
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
	// 未指定 → 确保内置预设已落库，优先取通用预设；缺失则直接返回内存默认值。
	if err := s.ensureBuiltinEcommercePresets(userID); err != nil {
		return ecommerce.DefaultGeneralPreset(), nil
	}
	presets, err := s.repo.ListEcommercePresets(userID)
	if err != nil {
		return ecommerce.DefaultGeneralPreset(), nil
	}
	for _, preset := range presets {
		config, err := ecommerce.NormalizePresetConfig(preset.ConfigJSON)
		if err != nil {
			continue
		}
		if config.Key == ecommerce.GeneralPresetKey {
			return config, nil
		}
	}
	return ecommerce.DefaultGeneralPreset(), nil
}

// ensureBuiltinEcommercePresets 幂等确保两个内置预设已写入用户预设表：
//  1. 通用电商标准（general_ecommerce_standard）—— 系统默认，品类中性；
//  2. 独乐岛（solo_island_aesop）—— 成人用品/私享器物品类专用，需显式选择。
//
// 阶段 0 修复：原逻辑只在 start 编排时才落库，导致首次打开「生成配置」栏时预设列表为空。
// 阶段 2 修复：默认预设改为通用，独乐岛不再作为兜底（根治硬套情趣用品文案）。
func (s *Service) ensureBuiltinEcommercePresets(userID string) error {
	presets, err := s.repo.ListEcommercePresets(userID)
	if err != nil {
		return err
	}
	existing := make(map[string]bool, len(presets))
	for _, preset := range presets {
		config, err := ecommerce.NormalizePresetConfig(preset.ConfigJSON)
		if err != nil {
			continue
		}
		existing[config.Key] = true
	}
	for _, builtin := range []ecommerce.PresetConfig{
		ecommerce.DefaultGeneralPreset(),
		ecommerce.DefaultSoloIslandPreset(),
	} {
		if existing[builtin.Key] {
			continue
		}
		raw, err := json.Marshal(builtin)
		if err != nil {
			return err
		}
		if err := s.repo.UpsertEcommercePreset(&model.EcommercePreset{
			UserID: userID, Name: builtin.Name, ConfigJSON: string(raw),
		}); err != nil {
			return err
		}
	}
	return nil
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

// ecommerceSlotsNeedSynthesis 判断是否还需要调用 nxf 合成：
// 只要任一目标槽位在库里既没有 PromptOverride 也没有 GenerationPrompt，才需要。
// 全部槽位都已有提示词时直接复用，不再调已经连不上的 nxf（阶段 5 返工铁律）。
func ecommerceSlotsNeedSynthesis(plans []ecommerce.SlotPlan, slotIndex map[string]*model.EcommerceSlot) bool {
	for _, plan := range plans {
		slot := slotIndex[plan.SlotKey]
		if slot == nil {
			return true
		}
		if strings.TrimSpace(slot.PromptOverride) == "" && strings.TrimSpace(slot.GenerationPrompt) == "" {
			return true
		}
	}
	return false
}

// writeEcommerceDiag 把编排摘要写进 diag_json（失败只记日志，不阻断主流程）。
func (s *Service) writeEcommerceDiag(userID, productID string, snapshot ecommercePlanSnapshot) {
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return
	}
	if err := s.repo.UpdateEcommerceProductDiag(userID, productID, string(encoded)); err != nil {
		log.Printf("[ecommerce] write diag failed product=%s: %v", productID, err)
	}
}

// surfaceEcommerceDispatchError 把派发失败的真实原因写到商品级 error_message。
//
// 阶段 5 返工：主人要求「下游渠道报错必须把人话原因写进 slot.ErrorMessage 和
// product.ErrorMessage」。这里取第一条失败原因聚合展示；全部成功则清空。
func (s *Service) surfaceEcommerceDispatchError(userID, productID string, dispatches []EcommerceSlotDispatch) {
	failed := make([]string, 0, 2)
	for _, dispatch := range dispatches {
		if dispatch.Status != ecommerce.SlotStatusFailed || strings.TrimSpace(dispatch.Error) == "" {
			continue
		}
		failed = append(failed, fmt.Sprintf("%s：%s", firstNonEmpty(dispatch.Title, dispatch.SlotKey), truncateError(errors.New(dispatch.Error))))
	}
	message := ""
	if len(failed) > 0 {
		message = "生图失败：" + strings.Join(failed, "；")
		if len(failed) > 1 {
			message = fmt.Sprintf("生图失败（%d 屏）：%s", len(failed), strings.Join(failed, "；"))
		}
	}
	if err := s.repo.UpdateEcommerceProductError(userID, productID, message); err != nil {
		log.Printf("[ecommerce] write product error failed product=%s: %v", productID, err)
	}
}

// hasInFlightSlotVersion 判断是否存在"已派发且未终态"的槽位版本。
//
// 判据：任一槽位的最新版本带 child_task_id 且状态非终态 → 有子任务在途。
// paused（用户主动停止）**不算在途**——阶段 4 明确"状态立即不再冒充在途"，
// 否则停止生成后 ComputeProductStatus 会把「3 完成 + 4 paused」推导成
// completed，对用户谎报全部生成完毕。
// draft 态槽位（先审方案暂存）没有任何版本，因此返回 false。
func (s *Service) hasInFlightSlotVersion(slots []model.EcommerceSlot) bool {
	for index := range slots {
		versions, err := s.repo.ListEcommerceSlotVersions(slots[index].ID)
		if err != nil || len(versions) == 0 {
			continue
		}
		current := versions[0]
		if current.Status == ecommerce.SlotStatusPaused {
			continue
		}
		if strings.TrimSpace(current.ChildTaskID) != "" && !ecommerce.IsTerminalSlotStatus(current.Status) {
			return true
		}
	}
	return false
}
