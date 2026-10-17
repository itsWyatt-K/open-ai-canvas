// Package ecommerce 电商工坊域的编排计划与预设契约。
//
// 本文件承载「上游供料、本地编排」的纯逻辑部分：
//   - 内置【独乐岛 SOLO ISLAND】7 屏预设（槽位计划 + 品牌视觉 DNA + 防封负向词）；
//   - 上游 54 号表预设铁律段的提取与融合（按确定性 tool/preset UUID 引用）；
//   - 子任务状态 → 槽位状态的映射。
//
// 纪律：不臆造上游工具 key——所有 UpstreamToolKey 取值均来自
// backend/internal/workbench/seed/catalog.json 实测；纯函数，无 IO，便于单测。
package ecommerce

import (
	"encoding/json"
	"strings"
)

// SoloIslandPresetKey 内置【独乐岛】预设标识（落 config_json.key）。
const SoloIslandPresetKey = "solo_island_aesop"

// SoloIslandSlogan 品牌主张（用于文案槽位与烧入文字）。
const SoloIslandSlogan = "众乐乐，不如独乐乐"

// 上游预设变体 key（builtinPromptVariants 固化值，不可臆造）。
const (
	UpstreamVariantStandard    = "standard"
	UpstreamVariantComposition = "composition"
	UpstreamVariantDetail      = "detail"
)

// SoloIslandNegative 独乐岛防封负向词库（成人用品品类专用）。
// 进入生图/生视频队列前与 nxf 负向词合并，经 negativePrompt 字段下发。
const SoloIslandNegative = "露骨色情暗示、敏感生理器官形态、廉价塑料反光、商品形变、真人裸露、" +
	"低俗场景、劣质胶体质感、文字、水印、logo 乱入、低质量、模糊、变形的产品"

// SlotPlan 单个槽位的编排定义（纯数据，可直接落 dispatch_snapshot_json）。
type SlotPlan struct {
	// SlotKey 槽位唯一键（如 hero_emotion / detail_silence）。
	SlotKey string `json:"slotKey"`
	// Kind 槽位类型：hero（主图）/ detail（详情页）。
	Kind string `json:"kind"`
	// SlotNo 槽位序号（同 kind 内递增，从 1 开始）。
	SlotNo int `json:"slotNo"`
	// Title 槽位中文标题（前端展示 + PSD 图层名素材）。
	Title string `json:"title"`
	// Copy 该屏文案（可含 slogan 变体；文案层由前端渲染，不烧入图内）。
	Copy string `json:"copy,omitempty"`
	// Scene nxf 场景标识（ecom_set 等）。
	Scene string `json:"scene"`
	// Variant nxf 电商七件套变体名（白底主图/卖点主图/…）。
	Variant string `json:"variant"`
	// Aspect 画面比例。
	Aspect string `json:"aspect"`
	// Transparent 是否产出透明主体层（走 transparentBackground，供三层 PSD 的商品主体层）。
	Transparent bool `json:"transparent,omitempty"`
	// UpstreamToolKey 上游 54 号表工具 key（供料三段式铁律段）。
	UpstreamToolKey string `json:"upstreamToolKey,omitempty"`
	// UpstreamVariant 上游预设变体 key。
	UpstreamVariant string `json:"upstreamVariant,omitempty"`
}

// PresetConfig 电商预设配置（序列化落 ecommerce_presets.config_json）。
type PresetConfig struct {
	Version  int            `json:"version"`
	Key      string         `json:"key,omitempty"`
	Name     string         `json:"name,omitempty"`
	Slogan   string         `json:"slogan,omitempty"`
	DNA      map[string]any `json:"dna,omitempty"`
	Negative string         `json:"negativeExtra,omitempty"`
	Slots    []SlotPlan     `json:"slots,omitempty"`
	// 生图默认参数（编排器派发子任务时使用）。
	Model     string `json:"model,omitempty"`
	ChannelID string `json:"channelId,omitempty"`
	Size      string `json:"size,omitempty"`
	Quality   string `json:"quality,omitempty"`
	// Mode 执行模式：auto（全自动，默认）| review（先审方案，确认后才派发生图）。
	Mode string `json:"mode,omitempty"`
}

// ExecutionMode 常量（先审方案 / 全自动）。
const (
	ExecutionModeAuto   = "auto"
	ExecutionModeReview = "review"
)

// StatusReasonAwaitPlanConfirm 先审方案的商品状态原因（前端据此渲染审核横幅）。
const StatusReasonAwaitPlanConfirm = "AWAITING_USER_PLAN_CONFIRMATION"

// SnapshotMode 从预设配置 JSON 读取执行模式；缺省/非法值一律回落 auto（全自动）。
// 用于派发时冻结语义：配置事后被改，不影响已派发商品的模式判定。
func SnapshotMode(configJSON string) string {
	if strings.TrimSpace(configJSON) == "" {
		return ExecutionModeAuto
	}
	var config PresetConfig
	if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
		return ExecutionModeAuto
	}
	mode := strings.ToLower(strings.TrimSpace(config.Mode))
	if mode == ExecutionModeReview {
		return ExecutionModeReview
	}
	return ExecutionModeAuto
}

// DefaultSoloIslandPreset 返回内置【独乐岛 SOLO ISLAND｜众乐乐不如独乐乐】7 屏预设。
//
// 7 屏顺序与语义（主人 2026-10-14 定稿）：
//  1. 蓝调时刻情绪首屏   2. 勿扰模式三宫格共鸣   3. 微距金色水波纹气旋科技
//  4. 羽毛静水 38dB 静音与 40°C 恒温   5. 清澈水流冲刷 IPX7 防水硅胶
//  6. 梳妆台香水旁艺术伪装   7. 牛皮纸盒与请勿打扰门牌绝密发货
func DefaultSoloIslandPreset() PresetConfig {
	return PresetConfig{
		Version:  1,
		Key:      SoloIslandPresetKey,
		Name:     "独乐岛 SOLO ISLAND｜Aesop 极简",
		Slogan:   SoloIslandSlogan,
		DNA:      SoloIslandDNA(),
		Negative: SoloIslandNegative,
		Slots:    SoloIslandSlots(),
	}
}

// SoloIslandSlots 返回 7 屏槽位计划（上游 key 均为 catalog.json 实测值）。
func SoloIslandSlots() []SlotPlan {
	return []SlotPlan{
		{
			SlotKey: "hero_emotion", Kind: SlotKindHero, SlotNo: 1,
			Title: "蓝调时刻情绪首屏", Copy: SoloIslandSlogan,
			Scene: "ecom_set", Variant: "场景生活", Aspect: "3:4",
			UpstreamToolKey: "campaign-key-visual", UpstreamVariant: UpstreamVariantStandard,
		},
		{
			SlotKey: "hero_benefit_grid", Kind: SlotKindHero, SlotNo: 2,
			Title: "勿扰模式三宫格共鸣", Copy: "勿扰模式 · 三格共鸣",
			Scene: "ecom_set", Variant: "卖点主图", Aspect: "1:1",
			UpstreamToolKey: "listing-benefit-layout", UpstreamVariant: UpstreamVariantComposition,
		},
		{
			SlotKey: "detail_macro_ripple", Kind: SlotKindDetail, SlotNo: 1,
			Title: "微距金色水波纹气旋科技", Copy: "金色水波纹 · 气旋科技",
			Scene: "ecom_set", Variant: "细节微距", Aspect: "1:1",
			UpstreamToolKey: "product-macro-detail", UpstreamVariant: UpstreamVariantDetail,
		},
		{
			SlotKey: "detail_silence_thermal", Kind: SlotKindDetail, SlotNo: 2,
			Title: "羽毛静水 38dB 静音与 40°C 恒温", Copy: "38dB 羽毛静水 · 40°C 恒温",
			Scene: "ecom_set", Variant: "结构标注", Aspect: "1:1",
			UpstreamToolKey: "vertical-product-page", UpstreamVariant: UpstreamVariantStandard,
		},
		{
			SlotKey: "detail_waterproof", Kind: SlotKindDetail, SlotNo: 3,
			Title: "清澈水流冲刷 IPX7 防水硅胶", Copy: "IPX7 全身防水 · 医用级硅胶",
			Scene: "ecom_set", Variant: "场景使用", Aspect: "3:4",
			UpstreamToolKey: "appliance-in-use", UpstreamVariant: UpstreamVariantStandard,
		},
		{
			SlotKey: "detail_disguise", Kind: SlotKindDetail, SlotNo: 4,
			Title: "梳妆台香水旁艺术伪装", Copy: "梳妆台一隅 · 与香水为邻",
			Scene: "ecom_set", Variant: "场景生活", Aspect: "3:4",
			UpstreamToolKey: "perfume-still-life", UpstreamVariant: UpstreamVariantStandard,
		},
		{
			SlotKey: "detail_discreet_shipping", Kind: SlotKindDetail, SlotNo: 5,
			Title: "牛皮纸盒与请勿打扰门牌绝密发货", Copy: "牛皮纸盒 · 绝密发货",
			Scene: "ecom_set", Variant: "白底主图", Aspect: "1:1",
			UpstreamToolKey: "packaging-lineup", UpstreamVariant: UpstreamVariantStandard,
		},
	}
}

// SoloIslandDNA 返回独乐岛品牌视觉 DNA（nxf 九维度结构）。
//
// 视觉基调：Aesop 极简风 × 王家卫暖黄壁灯；鼠尾草绿 / 米白亚麻低饱和配色。
func SoloIslandDNA() map[string]any {
	return map[string]any{
		"source_summary": "Aesop 极简主义 × 王家卫暖黄壁灯氛围，低饱和高级质感",
		"layout":         map[string]any{"summary": "大量留白、单一视觉重心、居中或三分法构图、克制的细体排版"},
		"color": map[string]any{
			"summary": "鼠尾草绿与米白亚麻为主，暖黄壁灯点缀，整体低饱和",
			"palette": []map[string]any{
				{"role": "主色-鼠尾草绿", "hex": "#8A9A7B", "ratio": 0.40},
				{"role": "底色-米白亚麻", "hex": "#EFE9DE", "ratio": 0.35},
				{"role": "点缀-暖黄壁灯", "hex": "#E8B96A", "ratio": 0.15},
				{"role": "暗部-深灰蓝", "hex": "#3A4148", "ratio": 0.10},
			},
		},
		"lighting":   map[string]any{"summary": "单一暖黄壁灯侧逆光，蓝调时刻的冷背景与暖主体对比，柔和过渡无硬阴影"},
		"typography": map[string]any{"summary": "细体无衬线，字距舒展，米白或深灰蓝单色，不做特效"},
		"texture":    map[string]any{"summary": "哑光亲肤硅胶、亚麻织物、粗陶与牛皮纸的自然纹理"},
		"mood":       map[string]any{"summary": "静谧、私密、从容独处的自我关怀感"},
		"model":      map[string]any{"present": false},
		"props":      map[string]any{"summary": "梳妆台、亚麻方巾、玻璃水杯、干花与牛皮纸盒"},
		"brand":      map[string]any{"summary": "独乐岛 SOLO ISLAND｜众乐乐，不如独乐乐；包装与画面不出现任何可读品牌文字"},
	}
}

// UpstreamRuleSegment 从上游预设模板中提取「主体稳定铁律段」。
//
// 上游内置预设（builtinPromptVariants）的图像模板结构为：
//
//	以参考图1为主体外观与身份的唯一依据，{focus}。{铁律段}
//
// 本函数返回 `保持主体结构…视觉画面。` 这一段；若模板不符合该结构则返回空串
// （调用方保持原 prompt，不臆造拼接）。
func UpstreamRuleSegment(promptTemplate string) string {
	template := strings.TrimSpace(promptTemplate)
	if template == "" {
		return ""
	}
	const marker = "保持主体结构、颜色、比例、材质和可见细节稳定"
	index := strings.Index(template, marker)
	if index < 0 {
		return ""
	}
	return strings.TrimSpace(template[index:])
}

// FusePromptWithUpstreamRule 把上游铁律段追加到本地 nxf 合成的提示词之后。
// 上游段为空时原样返回本地提示词（不注入空段、不重复注入）。
func FusePromptWithUpstreamRule(localPrompt, upstreamTemplate string) string {
	local := strings.TrimSpace(localPrompt)
	rule := UpstreamRuleSegment(upstreamTemplate)
	if rule == "" || strings.Contains(local, rule) {
		return local
	}
	if local == "" {
		return rule
	}
	return local + "\n主体一致性铁律（上游预设）：" + rule
}

// MergeNegative 合并本地 nxf 负向词与预设负向词库（去重、保序）。
func MergeNegative(parts ...string) string {
	seen := map[string]bool{}
	merged := make([]string, 0, len(parts))
	for _, part := range parts {
		for _, item := range strings.Split(part, "、") {
			token := strings.TrimSpace(strings.Trim(item, "，,。;；"))
			if token == "" || seen[token] {
				continue
			}
			seen[token] = true
			merged = append(merged, token)
		}
	}
	return strings.Join(merged, "、")
}

// SlotStatusFromTaskStatus 子任务状态 → 槽位状态。
// 取消视为失败（用户主动停止，不再自动重发）。
func SlotStatusFromTaskStatus(taskStatus string) string {
	switch strings.TrimSpace(taskStatus) {
	case "queued":
		return SlotStatusQueued
	case "running":
		return SlotStatusRunning
	case "succeeded":
		return SlotStatusCompleted
	case "failed", "cancelled":
		return SlotStatusFailed
	default:
		return SlotStatusUncertain
	}
}

// IsSlotStatusTerminal 槽位是否已到终态（编排器回写时用于跳过已收尾槽位）。
func IsSlotStatusTerminal(status string) bool {
	switch strings.TrimSpace(status) {
	case SlotStatusCompleted, SlotStatusFailed:
		return true
	default:
		return false
	}
}

// NormalizePresetConfig 反序列化预设配置：空串返回内置独乐岛预设；
// 非法 JSON 返回错误（写路径必须强校验，不静默回落）。
func NormalizePresetConfig(raw string) (PresetConfig, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return DefaultSoloIslandPreset(), nil
	}
	var config PresetConfig
	if err := json.Unmarshal([]byte(trimmed), &config); err != nil {
		return PresetConfig{}, err
	}
	if len(config.Slots) == 0 {
		config.Slots = SoloIslandSlots()
	}
	if strings.TrimSpace(config.Negative) == "" {
		config.Negative = SoloIslandNegative
	}
	return config, nil
}

// SlotPlansForKind 过滤指定类型的槽位计划（保持 SlotNo 升序）。
func SlotPlansForKind(plans []SlotPlan, kind string) []SlotPlan {
	result := make([]SlotPlan, 0, len(plans))
	for _, plan := range plans {
		if plan.Kind == kind {
			result = append(result, plan)
		}
	}
	return result
}
