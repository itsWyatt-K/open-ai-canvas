package ecommerce

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ConfigView 电商工坊统一配置（与桌面版 renderer/index.html 面板逐项对应；
// 字段名以合作方 API 合同为准）。经 JSON 序列化后存入 ecommerce_user_configs。
type ConfigView struct {
	TaskConcurrency   int           `json:"taskConcurrency"`
	Platform          string        `json:"platform"`
	Market            string        `json:"market"`
	Language          string        `json:"language"`
	TitleLanguage     string        `json:"titleLanguage"`
	ModelMode         string        `json:"modelMode"`
	Font              string        `json:"font"`
	ColorRhythm       string        `json:"colorRhythm"`
	PlannerModelID    string        `json:"plannerModelId"`
	ImageModelID      string        `json:"imageModelId"`
	TitleModelID      string        `json:"titleModelId"`
	Style             string        `json:"style"`
	SellingPoints     string        `json:"sellingPoints"`
	Requirements      string        `json:"requirements"`
	Forbidden         string        `json:"forbidden"`
	Hero              ImageSpecView `json:"hero"`
	Detail            ImageSpecView `json:"detail"`
	TitleInstruction  string        `json:"titleInstruction"`
	TitlePrompt       string        `json:"titlePrompt"`
	TitleCount        int           `json:"titleCount"`
	TitleMaxLength    int           `json:"titleMaxLength"`
	Mode              string        `json:"mode"`
	Quality           string        `json:"quality"`
	MaxRetries        int           `json:"maxRetries"`
	TimeoutSeconds    int           `json:"timeoutSeconds"`
	TextTimeoutSeconds int           `json:"textTimeoutSeconds"`
	PromptSets        PromptSets    `json:"promptSets"`
}

// ImageSpecView 主图/详情页规格卡（hero/detail 同构）。
type ImageSpecView struct {
	Count       int    `json:"count"`
	SizePreset  string `json:"sizePreset"`
	Resolution  string `json:"resolution"`
	Ratio       string `json:"ratio"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	TextMode    string `json:"textMode"`
	Instruction string `json:"instruction"`
}

// PromptSets 六个可编辑提示词字段（与桌面版一一对应，支持 @任务名）。
type PromptSets struct {
	PlanningPrompt   string `json:"planningPrompt"`
	PlanningRules    string `json:"planningRules"`
	RefinementPrompt string `json:"refinementPrompt"`
	GenerationPrompt string `json:"generationPrompt"`
	GenerationRules  string `json:"generationRules"`
	TitlePrompt      string `json:"titlePrompt"`
}

// [待规范源] 桌面版默认值（prompt-defaults.mjs / 面板默认态）未随合作方文档固化，
// 下列默认取「最小可运行保守集」：不影响派发正确性，规范源补齐后由比对测试接管。
func DefaultConfigView() ConfigView {
	return ConfigView{
		TaskConcurrency:   2,
		Mode:              ModeReview, // 阶段 4：默认先审方案，未确认前不扣费
		Quality:           QualityAuto,
		MaxRetries:        1,
		TimeoutSeconds:    600,
		TextTimeoutSeconds: 300,
		TitleCount:        3,
		TitleMaxLength:   60,
		Hero: ImageSpecView{
			Count:    1, // [待规范源] 桌面默认数量（示例进度摘要"主图 3/6"暗示 6，未固化不臆造）
			Ratio:    "1:1",
			TextMode: TextModeTypeset,
		},
		Detail: ImageSpecView{
			Count:    1, // [待规范源] 同上（示例"详情页 1/5"暗示 5，未固化不臆造）
			Ratio:    "3:4",
			TextMode: TextModeTypeset,
		},
	}
}

const customOptionMaxChars = 500

// ValidateConfig 保存前校验（桌面版同款语义）：
//   - taskConcurrency ∈ [1,5]；
//   - 平台/市场/语言等下拉项：常量候选内，或自定义任意字符串 ≤500 字符（桌面允许"自定义…"）；
//   - mode ∈ {auto,review}；quality ∈ {"",auto,high,medium,low}；
//   - hero/detail textMode ∈ {none,typeset}；ratio 为预设值或自定义（自定义须 width×height>0）；
//   - count ≥ 1；标题数量/字数 ≥1。
func ValidateConfig(cfg ConfigView) error {
	if cfg.TaskConcurrency < 1 || cfg.TaskConcurrency > 5 {
		return fmt.Errorf("同时处理的商品任务数需在 1~5 之间")
	}
	if cfg.Mode != ModeAuto && cfg.Mode != ModeReview {
		return fmt.Errorf("执行模式需为 auto 或 review")
	}
	switch cfg.Quality {
	case "", QualityAuto, QualityHigh, QualityMedium, QualityLow:
	default:
		return fmt.Errorf("图片质量档位无效")
	}
	for _, item := range []struct{ name, value string }{
		{"平台", cfg.Platform},
		{"目标市场", cfg.Market},
		{"图片文案语言", cfg.Language},
		{"标题语言", cfg.TitleLanguage},
		{"模特风格", cfg.ModelMode},
		{"字体风格", cfg.Font},
		{"色彩节奏", cfg.ColorRhythm},
	} {
		if err := validateOption(item.name, item.value); err != nil {
			return err
		}
	}
	if err := validateImageSpec("主图", cfg.Hero); err != nil {
		return err
	}
	if err := validateImageSpec("详情页", cfg.Detail); err != nil {
		return err
	}
	if cfg.TitleCount < 1 {
		return fmt.Errorf("标题数量需 ≥1")
	}
	if cfg.TitleMaxLength < 1 {
		return fmt.Errorf("标题最多字符需 ≥1")
	}
	if cfg.MaxRetries < 0 {
		return fmt.Errorf("自动重试次数不能为负")
	}
	if cfg.TimeoutSeconds < 0 || cfg.TextTimeoutSeconds < 0 {
		return fmt.Errorf("超时时间不能为负")
	}
	return nil
}

func validateOption(name, value string) error {
	if value == "" {
		return nil // 留空由缺省补齐（桌面"缺失补默认、显式空串保持为空"）
	}
	if len([]rune(value)) > customOptionMaxChars {
		return fmt.Errorf("%s自定义值过长（≤%d 字符）", name, customOptionMaxChars)
	}
	return nil
}

func validateImageSpec(name string, spec ImageSpecView) error {
	if spec.Count < 1 {
		return fmt.Errorf("%s生成数量需 ≥1", name)
	}
	if spec.TextMode != TextModeNone && spec.TextMode != TextModeTypeset {
		return fmt.Errorf("%s文字模式需为 none 或 typeset", name)
	}
	if spec.Ratio == "" {
		return nil
	}
	for _, preset := range ImageRatioValues {
		if spec.Ratio == preset {
			return nil
		}
	}
	// 自定义比例：必须给合法宽高（桌面"自定义"走宽×高）
	if spec.Width <= 0 || spec.Height <= 0 {
		return fmt.Errorf("%s自定义比例需提供合法的宽×高", name)
	}
	return nil
}

// MergeWithDefault 缺省补齐语义：缺省字段补默认；显式空串保持为空（桌面同款）。
// 入参为已反序列化的用户配置（来自 DB 的 ConfigJSON）。
func MergeWithDefault(stored ConfigView) ConfigView {
	merged := DefaultConfigView()
	if stored.TaskConcurrency != 0 {
		merged.TaskConcurrency = stored.TaskConcurrency
	}
	if stored.Platform != "" {
		merged.Platform = stored.Platform
	}
	if stored.Market != "" {
		merged.Market = stored.Market
	}
	if stored.Language != "" {
		merged.Language = stored.Language
	}
	if stored.TitleLanguage != "" {
		merged.TitleLanguage = stored.TitleLanguage
	}
	if stored.ModelMode != "" {
		merged.ModelMode = stored.ModelMode
	}
	if stored.Font != "" {
		merged.Font = stored.Font
	}
	if stored.ColorRhythm != "" {
		merged.ColorRhythm = stored.ColorRhythm
	}
	if stored.PlannerModelID != "" {
		merged.PlannerModelID = stored.PlannerModelID
	}
	if stored.ImageModelID != "" {
		merged.ImageModelID = stored.ImageModelID
	}
	if stored.TitleModelID != "" {
		merged.TitleModelID = stored.TitleModelID
	}
	if stored.Style != "" {
		merged.Style = stored.Style
	}
	if stored.SellingPoints != "" {
		merged.SellingPoints = stored.SellingPoints
	}
	if stored.Requirements != "" {
		merged.Requirements = stored.Requirements
	}
	if stored.Forbidden != "" {
		merged.Forbidden = stored.Forbidden
	}
	if stored.TitleInstruction != "" {
		merged.TitleInstruction = stored.TitleInstruction
	}
	if stored.TitlePrompt != "" {
		merged.TitlePrompt = stored.TitlePrompt
	}
	if stored.TitleCount != 0 {
		merged.TitleCount = stored.TitleCount
	}
	if stored.TitleMaxLength != 0 {
		merged.TitleMaxLength = stored.TitleMaxLength
	}
	if stored.Mode != "" {
		merged.Mode = stored.Mode
	}
	if stored.Quality != "" {
		merged.Quality = stored.Quality
	}
	if stored.MaxRetries != 0 {
		merged.MaxRetries = stored.MaxRetries
	}
	if stored.TimeoutSeconds != 0 {
		merged.TimeoutSeconds = stored.TimeoutSeconds
	}
	if stored.TextTimeoutSeconds != 0 {
		merged.TextTimeoutSeconds = stored.TextTimeoutSeconds
	}
	merged.Hero = mergeImageSpec(merged.Hero, stored.Hero)
	merged.Detail = mergeImageSpec(merged.Detail, stored.Detail)
	merged.PromptSets = mergePromptSets(merged.PromptSets, stored.PromptSets)
	return merged
}

func mergeImageSpec(base, stored ImageSpecView) ImageSpecView {
	if stored.Count != 0 {
		base.Count = stored.Count
	}
	if stored.SizePreset != "" {
		base.SizePreset = stored.SizePreset
	}
	if stored.Resolution != "" {
		base.Resolution = stored.Resolution
	}
	if stored.Ratio != "" {
		base.Ratio = stored.Ratio
	}
	if stored.Width != 0 {
		base.Width = stored.Width
	}
	if stored.Height != 0 {
		base.Height = stored.Height
	}
	if stored.TextMode != "" {
		base.TextMode = stored.TextMode
	}
	if stored.Instruction != "" {
		base.Instruction = stored.Instruction
	}
	return base
}

func mergePromptSets(base, stored PromptSets) PromptSets {
	if stored.PlanningPrompt != "" {
		base.PlanningPrompt = stored.PlanningPrompt
	}
	if stored.PlanningRules != "" {
		base.PlanningRules = stored.PlanningRules
	}
	if stored.RefinementPrompt != "" {
		base.RefinementPrompt = stored.RefinementPrompt
	}
	if stored.GenerationPrompt != "" {
		base.GenerationPrompt = stored.GenerationPrompt
	}
	if stored.GenerationRules != "" {
		base.GenerationRules = stored.GenerationRules
	}
	if stored.TitlePrompt != "" {
		base.TitlePrompt = stored.TitlePrompt
	}
	return base
}

// ErrInvalidConfig 配置校验失败（handler 转 400）。
var ErrInvalidConfig = errors.New("电商工坊配置无效")

// NormalizeConfigJSON 反序列化 + 校验 + 缺省补齐的统一入口。
func NormalizeConfigJSON(raw string) (ConfigView, error) {
	var stored ConfigView
	if strings.TrimSpace(raw) != "" {
		if err := json.Unmarshal([]byte(raw), &stored); err != nil {
			return ConfigView{}, fmt.Errorf("配置解析失败：%w", err)
		}
	}
	merged := MergeWithDefault(stored)
	if err := ValidateConfig(merged); err != nil {
		return ConfigView{}, err
	}
	return merged, nil
}
