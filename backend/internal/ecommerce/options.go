// Package ecommerce 电商工坊域：桌面版 product-studio 合同的 Go 落地。
//
// 纪律（桌面版同款硬约束）：
//   - 只放文档/桌面版已固化的常量；规范源缺失项留空并标 [待规范源]，绝不臆造；
//   - uncertain（结果待确认）不自动重发；
//   - 已发请求按派发时参数收尾；
//   - 成功成品不因改配置自动重做。
package ecommerce

// 槽位类型（桌面版 hero/detail 两类）。
const (
	SlotKindHero   = "hero"
	SlotKindDetail = "detail"
)

// 文字排版模式（前端配置面板固化值）。
const (
	TextModeNone    = "none"    // 纯图不排字
	TextModeTypeset = "typeset" // 按需排版
)

// 执行模式（config.mode）。
const (
	ModeAuto   = "auto"   // 全自动
	ModeReview = "review" // 先审方案再生成
)

// 图片质量档位（"不传 quality" 由空串表示，见 QualityValues 注释）。
const (
	QualityAuto   = "auto"
	QualityHigh   = "high"
	QualityMedium = "medium"
	QualityLow    = "low"
)

// QualityValues 质量档位候选（不含"不传 quality"——该选项以空串下发）。
var QualityValues = []string{QualityAuto, QualityHigh, QualityMedium, QualityLow}

// ImageRatioValues 图片比例候选（前端配置面板固化值；自定义走 width×height）。
var ImageRatioValues = []string{"1:1", "2:3", "3:2", "3:4", "9:16"}

// [待规范源] 以下选项列表桌面版 core/commerce-options.mjs 逐字固化于合作方文档之外，
// 本机无规范源（C:\Users\PC\Desktop\电商\product-studio\ 不存在），
// 按施工案纪律留空待补——空列表时 API 校验一律拒绝非空自定义值，防止臆造常量流入生产。

// Platforms 平台候选（桌面版 14 项，顺序照抄规范源）。
var Platforms []string // [待规范源]

// Markets 目标市场候选。
var Markets []string // [待规范源]

// Languages 图片文案语言候选（桌面版 15 项，顺序照抄规范源）。
var Languages []string // [待规范源]

// TitleLanguages 标题语言候选。
var TitleLanguages []string // [待规范源]

// ModelModes 模特风格候选（含"自动判断"等，顺序照抄规范源）。
var ModelModes []string // [待规范源]

// FontStyles 字体风格候选。
var FontStyles []string // [待规范源]

// ColorRhythms 色彩节奏候选。
var ColorRhythms []string // [待规范源]
