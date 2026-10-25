// 电商实战升级 · 双层企划解耦与四层交付清单（2026-10-24 指令单阶段二）。
//
// 产品合同（总架构师+产品经理联合定调）：
//  1. L1 人话企划卡（user_brief）给小白看/改：主副标题、场景大白话、构图版式胶囊、
//     是否锁定商品原图合成；小白绝不看生图 Prompt。
//  2. L2 底层提示词（compiled_prompt）给机器：改 L1 自动触发重编译（本文件），
//     与派发时的 12 段拼装（buildEcommerceSlotPrompt）分层——这里维护的是
//     槽位级「本屏视觉方案」段。PromptOverride 铁律不变：人工完整覆盖最高优先，
//     L1 重编译只写 GenerationPrompt，永不触碰 PromptOverride。
//  3. layer_manifest 四层交付清单：背景/阴影/商品主体/文字层，落 slot（最新态）
//     与 slot_version（历史态），对接 PSD 导出与前端图层精修台。
package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
)

// ecommerceLayoutTypes 构图版式枚举（L1 胶囊；中文标签给前端直接展示）。
var ecommerceLayoutTypes = map[string]string{
	"center-closeup":        "居中特写",
	"left-image-right-text": "左图右文",
	"top-text-bottom-image": "上文下图",
	"scene-interspersed":    "场景穿插",
	"contrast-split":        "对比分屏",
}

// EcommerceUserBrief L1 人话企划卡（小白可读可改的全部内容）。
type EcommerceUserBrief struct {
	ScreenTitle          string `json:"screen_title"`            // 主标题（卖点结论）
	SubTitle             string `json:"sub_title"`               // 副标题（支撑卖点）
	SceneDesc            string `json:"scene_desc"`              // 场景与摆位大白话
	LayoutType           string `json:"layout_type"`             // 构图版式枚举 key
	PreserveProductExact bool   `json:"preserve_product_exact"`  // true=锁定商品原图合成（默认）
}

// Validate 校验并归一 L1 字段（长度上限与派发合同一致）。
func (b *EcommerceUserBrief) Validate() error {
	if b == nil {
		return nil
	}
	b.ScreenTitle = strings.TrimSpace(b.ScreenTitle)
	b.SubTitle = strings.TrimSpace(b.SubTitle)
	b.SceneDesc = strings.TrimSpace(b.SceneDesc)
	b.LayoutType = strings.TrimSpace(b.LayoutType)
	if len([]rune(b.ScreenTitle)) > 80 {
		return NewAppError(http.StatusBadRequest, "企划主标题超过 80 字上限")
	}
	if len([]rune(b.SubTitle)) > 120 {
		return NewAppError(http.StatusBadRequest, "企划副标题超过 120 字上限")
	}
	if len([]rune(b.SceneDesc)) > 600 {
		return NewAppError(http.StatusBadRequest, "场景描述超过 600 字上限（说清场景与摆位即可）")
	}
	if b.LayoutType != "" {
		if _, ok := ecommerceLayoutTypes[b.LayoutType]; !ok {
			return NewAppError(http.StatusBadRequest,
				"构图版式不支持: "+b.LayoutType+"（可选 "+strings.Join(ecommerceLayoutTypeKeys(), "/")+"）")
		}
	}
	return nil
}

func ecommerceLayoutTypeKeys() []string {
	keys := make([]string, 0, len(ecommerceLayoutTypes))
	for key := range ecommerceLayoutTypes {
		keys = append(keys, key)
	}
	return keys
}

// CompileToPrompt 把 L1 企划编译为 L2「本屏视觉方案」段（中文基底，
// 派发时再由 buildEcommerceSlotPrompt 拼装 12 段结构出网）。
func (b *EcommerceUserBrief) CompileToPrompt() string {
	if b == nil {
		return ""
	}
	blocks := make([]string, 0, 5)
	if b.ScreenTitle != "" {
		blocks = append(blocks, "主标题："+b.ScreenTitle)
	}
	if b.SubTitle != "" {
		blocks = append(blocks, "副标题："+b.SubTitle)
	}
	if label, ok := ecommerceLayoutTypes[b.LayoutType]; ok {
		blocks = append(blocks, "构图版式："+label)
	}
	if b.SceneDesc != "" {
		blocks = append(blocks, "场景与摆位："+b.SceneDesc)
	}
	if b.PreserveProductExact {
		blocks = append(blocks, "商品保真：本屏使用锁主体合成管线，商品原图像素保持不变，仅按场景重打光融合")
	}
	return strings.Join(blocks, "\n")
}

// parseEcommerceUserBrief 从槽位恢复 L1 企划（空/损坏时返回零值，不阻断主链路）。
func parseEcommerceUserBrief(raw string) EcommerceUserBrief {
	var brief EcommerceUserBrief
	if strings.TrimSpace(raw) == "" {
		return brief
	}
	_ = json.Unmarshal([]byte(raw), &brief)
	return brief
}

// EcommerceBriefPatch L1 编辑补丁（指针语义：nil=不改）+ AI 换思路提示。
type EcommerceBriefPatch struct {
	ScreenTitle          *string `json:"screen_title"`
	SubTitle             *string `json:"sub_title"`
	SceneDesc            *string `json:"scene_desc"`
	LayoutType           *string `json:"layout_type"`
	PreserveProductExact *bool   `json:"preserve_product_exact"`
	// AIHint 非空 = 「✨让 AI 换个思路」：以 hint 为方向生成确定性企划变体
	// （轮换构图版式 + 融合 hint 的场景描述），不调用外部模型、秒级返回。
	AIHint string `json:"ai_hint"`
}

// UpdateEcommerceSlotBrief 保存 L1 企划并自动重编译 L2（GenerationPrompt）。
//
// 铁律：PromptOverride 非空时仍会重编译 GenerationPrompt（保持 L1/L2 一致），
// 但派发层永远 PromptOverride 优先——人工完整覆盖不被自动编译覆盖。
func (s *Service) UpdateEcommerceSlotBrief(ctx context.Context, userID, slotID string, patch EcommerceBriefPatch) (*model.EcommerceSlot, EcommerceUserBrief, error) {
	slot, _, err := s.ownedEcommerceSlot(ctx, userID, slotID)
	if err != nil {
		return nil, EcommerceUserBrief{}, err
	}
	if slot.Status == ecommerce.SlotStatusRunning || slot.Status == ecommerce.SlotStatusUncertain {
		return nil, EcommerceUserBrief{}, NewAppError(http.StatusConflict, "该屏正在生成或结果待确认，请等当前请求收尾后再修改企划")
	}
	brief := parseEcommerceUserBrief(slot.UserBriefJSON)
	hint := strings.TrimSpace(patch.AIHint)
	if len([]rune(hint)) > 200 {
		return nil, EcommerceUserBrief{}, NewAppError(http.StatusBadRequest, "AI 换思路提示超过 200 字上限")
	}
	if hint != "" {
		// 优先真 LLM（挂 ecommerce-visual-director 技能规范）；未配置/失败回退确定性变体器。
		var reworked EcommerceUserBrief
		if ecommerceBriefLLMRework(ctx, brief, hint, firstNonEmpty(slot.Title, slot.SlotKey), &reworked) {
			brief = reworked
		} else {
			brief = reworkEcommerceBriefWithHint(&brief, hint, slot.SlotNo)
		}
	}
	if patch.ScreenTitle != nil {
		brief.ScreenTitle = *patch.ScreenTitle
	}
	if patch.SubTitle != nil {
		brief.SubTitle = *patch.SubTitle
	}
	if patch.SceneDesc != nil {
		brief.SceneDesc = *patch.SceneDesc
	}
	if patch.LayoutType != nil {
		brief.LayoutType = *patch.LayoutType
	}
	if patch.PreserveProductExact != nil {
		brief.PreserveProductExact = *patch.PreserveProductExact
	}
	if err := brief.Validate(); err != nil {
		return nil, EcommerceUserBrief{}, err
	}
	encoded, err := json.Marshal(brief)
	if err != nil {
		return nil, EcommerceUserBrief{}, err
	}
	compiled := brief.CompileToPrompt()
	updates := map[string]any{
		"user_brief_json":   string(encoded),
		"generation_prompt": compiled,
		"updated_at":        time.Now(),
	}
	// L1 主标题同步槽位展示标题；版式同步场景类型（编辑器与卡片口径一致）。
	if brief.ScreenTitle != "" {
		updates["title"] = brief.ScreenTitle
	}
	if label, ok := ecommerceLayoutTypes[brief.LayoutType]; ok {
		updates["scene_type"] = label
	}
	if err := s.repo.UpdateEcommerceSlotPlan(slotID, updates); err != nil {
		return nil, EcommerceUserBrief{}, err
	}
	updated, err := s.repo.EcommerceSlotByID(slotID)
	if err != nil {
		return nil, EcommerceUserBrief{}, err
	}
	return updated, brief, nil
}

// reworkEcommerceBriefWithHint 「AI 换个思路」确定性变体器：
// 轮换构图版式 + 把 hint 融进场景描述（不清空用户已确认的主副标题）。
// 不调外部模型（秒级、可测试）；接入电商 Agent 的 LLM 重写时替换本函数即可。
func reworkEcommerceBriefWithHint(brief *EcommerceUserBrief, hint string, slotNo int) EcommerceUserBrief {
	reworked := *brief
	keys := ecommerceLayoutTypeKeys()
	if len(keys) == 0 {
		return reworked
	}
	index := slotNo % len(keys)
	if reworked.LayoutType != "" {
		for i, key := range keys {
			if key == reworked.LayoutType {
				index = (i + 1 + slotNo%max(1, len(keys)-1)) % len(keys)
				break
			}
		}
	}
	reworked.LayoutType = keys[index]
	hintText := strings.TrimSuffix(hint, "。")
	if reworked.SceneDesc == "" {
		reworked.SceneDesc = hintText
	} else {
		reworked.SceneDesc = hintText + "；" + reworked.SceneDesc
	}
	if len([]rune(reworked.SceneDesc)) > 600 {
		reworked.SceneDesc = string([]rune(reworked.SceneDesc)[:600])
	}
	return reworked
}

// ---------------- 四层交付清单（layer_manifest） ----------------

// EcommerceTextLayer 文字层（独立于背景像素，双击改字的基础）。
type EcommerceTextLayer struct {
	Text  string  `json:"text"`
	Color string  `json:"color,omitempty"`
	Font  string  `json:"font,omitempty"`
	Size  int     `json:"size,omitempty"`
	X     float64 `json:"x"` // 0-1 相对坐标
	Y     float64 `json:"y"`
}

// EcommerceLayerManifest 四层交付清单（对接 PSD 导出与图层精修台）。
type EcommerceLayerManifest struct {
	BackgroundLayer string               `json:"background_layer_url"` // 纯背景层（AI 场景图）
	ShadowLayer     string               `json:"shadow_layer_url"`     // 接触阴影层
	ProductCutout   string               `json:"product_cutout_url"`   // 商品主体层（透明底）
	ProductRect     [4]float64           `json:"product_rect"`         // x,y,w,h（0-1 相对）
	TextLayers      []EcommerceTextLayer `json:"text_layers"`
	ComposedImage   string               `json:"composed_image_url"` // 合成成品（兜底两层导出时用）
	UpdatedAt       string               `json:"updated_at"`
}

// Validate 校验清单结构（url 可为空=该层未产出；坐标必须 0-1）。
func (m *EcommerceLayerManifest) Validate() error {
	if m == nil {
		return nil
	}
	for i, layer := range m.TextLayers {
		if len([]rune(layer.Text)) > 2000 {
			return NewAppError(http.StatusBadRequest, fmt.Sprintf("文字层 %d 文案超过 2000 字", i))
		}
		if layer.X < 0 || layer.X > 1 || layer.Y < 0 || layer.Y > 1 {
			return NewAppError(http.StatusBadRequest, fmt.Sprintf("文字层 %d 坐标须为 0-1 相对值", i))
		}
	}
	rect := m.ProductRect
	if rect != [4]float64{} {
		for _, v := range rect {
			if v < 0 || v > 1 {
				return NewAppError(http.StatusBadRequest, "商品主体矩形坐标须为 0-1 相对值")
			}
		}
	}
	return nil
}

// SaveEcommerceSlotLayers 精修台回写四层清单：slot 存最新态，当前版本存历史态。
func (s *Service) SaveEcommerceSlotLayers(ctx context.Context, userID, slotID string, manifest EcommerceLayerManifest) (*model.EcommerceSlot, error) {
	slot, _, err := s.ownedEcommerceSlot(ctx, userID, slotID)
	if err != nil {
		return nil, err
	}
	if err := manifest.Validate(); err != nil {
		return nil, err
	}
	manifest.UpdatedAt = time.Now().Format(time.RFC3339)
	encoded, err := json.Marshal(manifest)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateEcommerceSlotPlan(slotID, map[string]any{
		"layer_manifest_json": string(encoded),
		"updated_at":          time.Now(),
	}); err != nil {
		return nil, err
	}
	// 同步到当前版本（历史态留档）。
	versions, err := s.repo.ListEcommerceSlotVersions(slotID)
	if err != nil {
		return nil, err
	}
	for index := range versions {
		if versions[index].Version == slot.CurrentVersion {
			if err := s.repo.UpdateEcommerceSlotVersionManifest(versions[index].ID, string(encoded)); err != nil {
				return nil, err
			}
			break
		}
	}
	return s.repo.EcommerceSlotByID(slotID)
}

// ecommerceSlotExtras 详情视图的 L1/分层透出（products.go SlotSummary 用）。
type ecommerceSlotExtrasView struct {
	Brief     *EcommerceUserBrief     `json:"brief,omitempty"`
	Manifest  *EcommerceLayerManifest `json:"layerManifest,omitempty"`
}

func ecommerceSlotExtras(slot model.EcommerceSlot) ecommerceSlotExtrasView {
	view := ecommerceSlotExtrasView{}
	if strings.TrimSpace(slot.UserBriefJSON) != "" {
		brief := parseEcommerceUserBrief(slot.UserBriefJSON)
		view.Brief = &brief
	}
	if strings.TrimSpace(slot.LayerManifestJSON) != "" {
		var manifest EcommerceLayerManifest
		if err := json.Unmarshal([]byte(slot.LayerManifestJSON), &manifest); err == nil {
			view.Manifest = &manifest
		}
	}
	return view
}
