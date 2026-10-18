// Package ecommerce 平台规范字典：6 大电商平台的分屏模板与强制规范（阶段 5）。
//
// 用途：
//   - 前端平台选择卡与后端槽位重建共用同一份权威定义（平台 key 即唯一契约）；
//   - AI 策划 Prompt 自动注入平台强制视觉与文案规范；
//   - 导入商品/切换平台时按平台模板预建槽位（title/sceneType/aspect/copy 引导词）。
//
// 纪律：平台 key 一旦发布不改语义；新增平台只追加，不修改已有平台的规格矩阵。
package ecommerce

import "strings"

// 平台 key（前端 platforms.ts 必须逐字一致）。
const (
	PlatformTaobao      = "taobao"
	PlatformDouyin      = "douyin"
	PlatformPinduoduo   = "pinduoduo"
	PlatformJD          = "jd"
	PlatformAmazon      = "amazon"
	PlatformXiaohongshu = "xiaohongshu"
)

// PlatformSpec 单个平台的规范矩阵。
type PlatformSpec struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	// Tagline 适用标签（平台卡片副标题，如「首图纯白底」）。
	Tagline string `json:"tagline"`
	// HeroCount / DetailCount 主图与详情页张数；HeroRatio / DetailRatio 比例。
	HeroCount   int    `json:"heroCount"`
	HeroRatio   string `json:"heroRatio"`
	DetailCount int    `json:"detailCount"`
	DetailRatio string `json:"detailRatio"`
	// Language 平台语言：zh（中文）| en（英文）。
	Language string `json:"language"`
	// Rules 平台强制视觉与文案规范（注入 AI 策划 Prompt 与默认槽位）。
	Rules string `json:"rules"`
	// WhiteBackgroundFirst 首屏强制纯白底（京东 / 亚马逊）。
	WhiteBackgroundFirst bool `json:"whiteBackgroundFirst"`
}

// PlatformSpecs 返回全部内置平台（顺序即前端展示顺序）。
func PlatformSpecs() []PlatformSpec {
	return []PlatformSpec{
		{
			Key: PlatformTaobao, Name: "淘宝 / 天猫", Tagline: "首屏高点击率焦点",
			HeroCount: 3, HeroRatio: "1:1", DetailCount: 4, DetailRatio: "3:4", Language: "zh",
			Rules: "首屏突出高点击率视觉焦点与核心利益点；第 3 张主图兼顾干净背景；" +
				"详情页按「痛点引入→核心材质/科技→场景体验→规格清单」递进；整体符合天猫淘宝主图规范，无牛皮癣。",
		},
		{
			Key: PlatformDouyin, Name: "抖音 / 视频号", Tagline: "3:4 竖屏冲击",
			HeroCount: 3, HeroRatio: "3:4", DetailCount: 4, DetailRatio: "3:4", Language: "zh",
			Rules: "竖屏信息流满屏构图，前 3 秒强视觉冲击；每屏画面大字文案必须极简短促（≤8 个字），" +
				"强痛点对比与直播级利益点表达；避免静态平铺，多用动态感构图。",
		},
		{
			Key: PlatformPinduoduo, Name: "拼多多", Tagline: "高饱和高对比",
			HeroCount: 3, HeroRatio: "1:1", DetailCount: 4, DetailRatio: "3:4", Language: "zh",
			Rules: "高饱和度高对比度；首屏直接放大核心功能、分量或性价比卖点；" +
				"画面真实直观，拒绝虚无缥缈的意识流留白；信息密度可以更高。",
		},
		{
			Key: PlatformJD, Name: "京东 (JD)", Tagline: "首图纯白底规范",
			HeroCount: 3, HeroRatio: "1:1", DetailCount: 4, DetailRatio: "3:4", Language: "zh",
			Rules: "主图第 1 张强制纯白底规范（RGB 255,255,255），商品主体居中占比 75%~85%，纯图无促销文字；" +
				"附图与详情偏重品质感、参数拆解与安全背书；整体干净专业。",
			WhiteBackgroundFirst: true,
		},
		{
			Key: PlatformAmazon, Name: "亚马逊 Amazon", Tagline: "纯白底 + 英文信息图",
			HeroCount: 3, HeroRatio: "1:1", DetailCount: 4, DetailRatio: "4:3", Language: "en",
			Rules: "Main Hero（第 1 张主图）强制 Pure White Background, No Text, Product occupies 85% frame；" +
				"其余主图为英文 Infographic（痛点图标 + 尺寸标注 + 生活场景）；全部文案使用英文输出。",
			WhiteBackgroundFirst: true,
		},
		{
			Key: PlatformXiaohongshu, Name: "小红书种草", Tagline: "真实生活化实拍",
			HeroCount: 3, HeroRatio: "3:4", DetailCount: 4, DetailRatio: "3:4", Language: "zh",
			Rules: "真实生活化场景实拍质感（自然光/居家或户外手持氛围），杂志感轻量排版，" +
				"弱化硬广推销感；文案口语化、有场景代入感，避免促销腔。",
		},
	}
}

// PlatformByKey 按 key 取平台规范；未知 key 返回 nil（调用方决定兜底）。
func PlatformByKey(key string) *PlatformSpec {
	trimmed := strings.ToLower(strings.TrimSpace(key))
	if trimmed == "" {
		return nil
	}
	specs := PlatformSpecs()
	for index := range specs {
		if specs[index].Key == trimmed {
			return &specs[index]
		}
	}
	return nil
}

// PlatformSpecOrDefault 按 key 取平台规范；未知/空 key 回落淘宝天猫（默认）。
func PlatformSpecOrDefault(key string) PlatformSpec {
	if spec := PlatformByKey(key); spec != nil {
		return *spec
	}
	specs := PlatformSpecs()
	return specs[0] // 淘宝 / 天猫为默认平台
}

// 平台槽位的规范键（与通用预设 GeneralSlots 逐字一致）。
//
// 纪律：平台只改「标题/场景/比例/文案/基底」，**不改槽位键**——Start/confirm/
// regenerate 全程按 SlotKey 匹配槽位，键不一致会重复建槽（阶段 5 实测的坑：
// 平台模板用 hero_1 之类新键 → 预建 7 张与预设 7 张并存成 14 张）。
var (
	platformHeroKeys   = []string{"hero_main", "hero_benefit", "hero_scene"}
	platformDetailKeys = []string{"detail_hero", "detail_macro", "detail_spec", "detail_package"}
)

// platformSlotKey 平台槽位唯一键（越界时按 kind_no 递补，保证未来平台加屏也有稳定键）。
func platformSlotKey(kind string, no int) string {
	keys := platformHeroKeys
	if kind == SlotKindDetail {
		keys = platformDetailKeys
	}
	if no >= 1 && no <= len(keys) {
		return keys[no-1]
	}
	return kind + "_" + itoa(no)
}

// PlatformSlotKey 导出版槽位键（app 包平台重建按同一口径匹配存量槽位）。
func PlatformSlotKey(kind string, no int) string {
	return platformSlotKey(kind, no)
}

// PlatformSlotPlans 按平台规范生成槽位计划（主图在前、详情页在后）。
//
// 每个平台 3 主图 + 4 详情页（共 7 屏）；标题/场景/比例/文案引导词全部平台定制。
// 上游 54 号表工具 key 沿用通用预设的映射（供料段与平台无关）。
func PlatformSlotPlans(spec PlatformSpec) []SlotPlan {
	heroTitles := platformHeroTitles(spec)
	detailTitles := platformDetailTitles(spec)
	heroScenes := platformHeroScenes(spec)
	detailScenes := platformDetailScenes(spec)
	heroKeys := []string{"product-white-hero", "listing-benefit-layout", "appliance-in-use"}
	heroVariants := []string{UpstreamVariantStandard, UpstreamVariantComposition, UpstreamVariantStandard}
	detailKeys := []string{"campaign-key-visual", "product-macro-detail", "vertical-product-page", "packaging-lineup"}
	detailVariants := []string{UpstreamVariantStandard, UpstreamVariantDetail, UpstreamVariantDetail, UpstreamVariantStandard}
	plans := make([]SlotPlan, 0, spec.HeroCount+spec.DetailCount)
	for index := 0; index < spec.HeroCount; index++ {
		title, scene := platformSlotCopy(heroTitles, heroScenes, index, spec)
		plans = append(plans, SlotPlan{
			SlotKey: platformSlotKey(SlotKindHero, index+1), Kind: SlotKindHero, SlotNo: index + 1,
			Title: title, Scene: "ecom_set", Variant: scene, Aspect: spec.HeroRatio,
			UpstreamToolKey: heroKeys[index%len(heroKeys)], UpstreamVariant: heroVariants[index%len(heroVariants)],
		})
	}
	for index := 0; index < spec.DetailCount; index++ {
		title, scene := platformSlotCopy(detailTitles, detailScenes, index, spec)
		plans = append(plans, SlotPlan{
			SlotKey: platformSlotKey(SlotKindDetail, index+1), Kind: SlotKindDetail, SlotNo: index + 1,
			Title: title, Scene: "ecom_set", Variant: scene, Aspect: spec.DetailRatio,
			UpstreamToolKey: detailKeys[index%len(detailKeys)], UpstreamVariant: detailVariants[index%len(detailVariants)],
		})
	}
	return plans
}

// platformSlotCopy 取第 index 屏的标题与场景（越界时按末位样式递补）。
func platformSlotCopy(titles, scenes []string, index int, spec PlatformSpec) (string, string) {
	title := "第 " + itoa(index+1) + " 屏"
	if index < len(titles) {
		title = titles[index]
	} else if len(titles) > 0 {
		title = titles[len(titles)-1] + " " + itoa(index+1)
	}
	scene := "产品展示"
	if index < len(scenes) {
		scene = scenes[index]
	} else if len(scenes) > 0 {
		scene = scenes[len(scenes)-1]
	}
	if spec.WhiteBackgroundFirst && index == 0 {
		scene = "纯白底合规首图"
	}
	return title, scene
}

func platformHeroTitles(spec PlatformSpec) []string {
	switch spec.Key {
	case PlatformJD:
		return []string{"白底合规首图", "卖点附图", "场景附图"}
	case PlatformAmazon:
		return []string{"Main Hero (Pure White)", "Infographic Benefit", "Lifestyle Scene"}
	case PlatformDouyin:
		return []string{"首屏视觉冲击", "痛点强对比", "直播利益点"}
	case PlatformPinduoduo:
		return []string{"首屏性价比暴击", "核心功能放大", "真实使用场景"}
	case PlatformXiaohongshu:
		return []string{"封面种草图", "细节特写", "生活场景氛围"}
	default: // taobao
		return []string{"首屏主视觉", "核心卖点", "使用场景"}
	}
}

func platformDetailTitles(spec PlatformSpec) []string {
	switch spec.Key {
	case PlatformAmazon:
		return []string{"Pain Point & Solution", "Material & Craft", "Scenario Experience", "Specification"}
	case PlatformDouyin:
		return []string{"痛点引入", "核心材质/科技", "场景体验", "规格清单"}
	case PlatformXiaohongshu:
		return []string{"使用心得引入", "材质细节", "场景代入", "规格与清单"}
	default: // taobao / jd / pinduoduo
		return []string{"详情首屏", "细节与工艺", "规格与结构", "包装与清单"}
	}
}

func platformHeroScenes(spec PlatformSpec) []string {
	switch spec.Key {
	case PlatformAmazon:
		return []string{"纯白底产品主图", "信息图解说", "生活场景"}
	case PlatformDouyin:
		return []string{"强冲击竖构图", "前后对比", "促销氛围"}
	case PlatformPinduoduo:
		return []string{"高饱和卖点堆叠", "功能微距演示", "真实场景直拍"}
	case PlatformXiaohongshu:
		return []string{"自然光封面实拍", "微距质感特写", "居家/户外氛围"}
	default:
		return []string{"白底主图", "卖点主图", "场景使用"}
	}
}

func platformDetailScenes(spec PlatformSpec) []string {
	switch spec.Key {
	case PlatformAmazon:
		return []string{"痛点图标图解", "材质微距", "英式生活场景", "参数标注"}
	case PlatformXiaohongshu:
		return []string{"生活化场景", "细节微距", "手持/使用氛围", "清单排版"}
	default:
		return []string{"场景生活", "细节微距", "结构标注", "场景生活"}
	}
}

// PlatformStyleSeed 平台风格种子（AI 策划 styleAnalysis 兜底与风格胶囊共用）。
func PlatformStyleSeed(spec PlatformSpec) string {
	return spec.Name + "（" + spec.Tagline + "）：" + spec.Rules
}

// PlatformSlotBasePrompt 平台槽位的初始 generation_prompt 基底（阶段 5 预建缺省）。
//
// 目的：用户导入商品/切换平台后，点开卡片编辑或看分镜卡就有完整的初始方案，
// 不再是空壳。AI 策划或人工编辑会覆盖它。
func PlatformSlotBasePrompt(plan SlotPlan, spec PlatformSpec) string {
	dna := GeneralDNA()
	dnaText := func(key string) string {
		value, _ := dna[key].(string)
		return value
	}
	lines := []string{
		"【平台】" + spec.Name + " · " + plan.Aspect + " · " + plan.Title,
		"【本屏任务】" + plan.Title + "（" + plan.Variant + "）",
	}
	if spec.WhiteBackgroundFirst && plan.SlotNo == 1 && plan.Kind == SlotKindHero {
		lines = append(lines, "【硬性规范】首屏强制纯白底（RGB 255,255,255），商品主体居中占比 75%~85%，画面无促销文字")
	}
	lines = append(lines,
		"【视觉方向】"+firstNonEmptyString(dnaText("artDirection"), "干净现代的商业摄影，主体清晰、背景克制"),
		"【光影】"+firstNonEmptyString(dnaText("lighting"), "柔和主光加轻微侧逆光勾勒轮廓，阴影干净"),
		"【排版】"+firstNonEmptyString(dnaText("typography"), "现代无衬线，层级分明；纯图屏不排字"),
		"【平台规范】"+spec.Rules,
	)
	return strings.Join(lines, "\n")
}

// PlatformPromptRules 注入 AI 策划 Prompt 的平台规范段（空 key 返回空串）。
func PlatformPromptRules(platformKey string) string {
	spec := PlatformByKey(platformKey)
	if spec == nil {
		return ""
	}
	return "【平台规范 · " + spec.Name + "】" + spec.Rules +
		" 主图 " + itoa(spec.HeroCount) + " 张（" + spec.HeroRatio + "），详情页 " +
		itoa(spec.DetailCount) + " 张（" + spec.DetailRatio + "）；" +
		"输出语言：" + platformLanguageLabel(spec.Language) + "。所有画面与文案必须符合该平台规范。"
}

func platformLanguageLabel(language string) string {
	if strings.EqualFold(strings.TrimSpace(language), "en") {
		return "英文（English）"
	}
	return "中文"
}
