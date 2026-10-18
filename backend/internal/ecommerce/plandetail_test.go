package ecommerce

// 策划编译器行为测试：严格校验 / 指纹去重 / 超长不截断 / 12 段顺序。

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func validPlanJSON(screenCount int, mutate func(*DetailPlan)) string {
	plan := DetailPlan{
		ProductAnalysis: map[string]any{
			"identity":               "磨砂玻璃香薰瓶，木质瓶盖",
			"visibleFeatures":        []any{"圆柱瓶身", "哑光标签"},
			"confirmedSellingPoints": []any{"容量 200ml"},
			"unknowns":               []any{"留香时长"},
		},
		StyleAnalysis: map[string]string{
			"palette": "米白与浅木色", "composition": "居中留白", "lighting": "侧逆光",
			"typography": "无字", "transferableElements": "低饱和配色", "excludedElements": "参考图人物",
		},
		VisualSystem: map[string]string{
			"artDirection": "安静的居家香氛场景", "palette": "米白/浅木/鼠尾草绿",
			"lighting": "柔光侧逆", "typography": "现代无衬线，标题细体",
		},
	}
	for index := 0; index < screenCount; index++ {
		// 每屏视觉方案必须互不相同（指纹去重会拒绝雷同方案）。
		marker := string(rune('A' + index))
		plan.Screens = append(plan.Screens, DetailPlanScreen{
			Title: "第" + string(rune('一'+index)) + "屏主题", SceneType: "产品特写", SellingPoints: "",
			Copy: "",
			VisualPlan: map[string]string{
				"subject": "瓶身占画面 60%，微俯视（" + marker + "）", "composition": "中心构图，右侧留白（" + marker + "）",
				"environment": "浅木台面与亚麻布（" + marker + "）", "lighting": "左前主光加右侧轮廓光（" + marker + "）",
				"colorAndMaterials": "米白背景衬托玻璃通透感（" + marker + "）", "typography": "本屏无文字（" + marker + "）",
				"visualEvidence": "瓶身磨砂质感与木盖纹理可见（" + marker + "）", "variation": "本屏为" + marker + "视角，与相邻屏景别不同",
			},
		})
	}
	if mutate != nil {
		mutate(&plan)
	}
	encoded := mustMarshal(plan)
	return encoded
}

func mustMarshal(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(data)
}

func TestCompileDetailPlanHappyPath(t *testing.T) {
	compiled, err := CompileDetailPlan(validPlanJSON(3, nil), 3)
	if err != nil {
		t.Fatalf("合法策划应通过：%v", err)
	}
	if len(compiled) != 3 {
		t.Fatalf("应编译 3 屏，实际 %d", len(compiled))
	}
	// 12 段必须齐全且顺序正确。
	for _, label := range []string{"整组视觉方向：", "统一配色：", "统一光影：", "统一字体：", "产品与主体：", "镜头与构图：", "环境与道具：", "光线与质感：", "色彩与材质：", "文字与留白：", "卖点的视觉表达：", "本屏差异与连续性："} {
		if !strings.Contains(compiled[0].Prompt, label) {
			t.Fatalf("编译结果缺少段 %q：%s", label, compiled[0].Prompt)
		}
	}
	if compiled[0].Fingerprint == "" {
		t.Fatal("应产出视觉指纹")
	}
}

// 阶段 5：任务结果包装解包（canvas_text 成功后 resultJson 是 {"mode":"text","text":...}）。
func TestUnwrapPlanText(t *testing.T) {
	wrapped := "{\"mode\":\"text\",\"text\":\"```json\\n{\\\"screens\\\": []}\\n```\"}"
	want := "```json\n{\"screens\": []}\n```"
	if got := UnwrapPlanText(wrapped); got != want {
		t.Fatalf("包装体应解包出 text 原文，得到 %q", got)
	}
	// 合法策划 JSON（无 mode/text）原样返回。
	plan := `{"screens":[{"title":"首屏"}]}`
	if got := UnwrapPlanText(plan); got != plan {
		t.Fatalf("策划 JSON 不应被改写，得到 %q", got)
	}
	// 非 JSON / 空 / 坏 JSON / text 为空 原样返回。
	for _, raw := range []string{"", "not json", `{"mode":"text"}`, `{"text":""}`, "{\"mode\":\"text\",\"text\":"} {
		if got := UnwrapPlanText(raw); got != raw {
			t.Fatalf("输入 %q 应原样返回，得到 %q", raw, got)
		}
	}
}

// 阶段 5 容错语义：屏数不符不再拒绝——少于 wantCount 按模板补齐，多于截断。
func TestCompileDetailPlanPadsAndTruncatesScreens(t *testing.T) {
	padded, err := CompileDetailPlan(validPlanJSON(3, nil), 5)
	if err != nil {
		t.Fatalf("屏数不足应补齐而非拒绝：%v", err)
	}
	if len(padded) != 5 {
		t.Fatalf("应补齐到 5 屏，实际 %d", len(padded))
	}
	// 补齐屏必须有模板标题且编译出 12 段。
	if !strings.Contains(padded[4].Prompt, "整组视觉方向：") {
		t.Fatal("补齐屏应编译完整 12 段提示词")
	}
	truncated, err := CompileDetailPlan(validPlanJSON(3, nil), 2)
	if err != nil {
		t.Fatalf("屏数超出应截断而非拒绝：%v", err)
	}
	if len(truncated) != 2 {
		t.Fatalf("应截断到 2 屏，实际 %d", len(truncated))
	}
}

// 阶段 5 容错语义：指纹相撞不再拒绝——自动追加差异化机位描述。
func TestCompileDetailPlanAutoDifferentiatesDuplicateFingerprint(t *testing.T) {
	raw := validPlanJSON(2, func(plan *DetailPlan) {
		// 第二屏复制第一屏的视觉方案 → 旧版拒绝，现在自动差异化
		plan.Screens[1].VisualPlan = plan.Screens[0].VisualPlan
	})
	compiled, err := CompileDetailPlan(raw, 2)
	if err != nil {
		t.Fatalf("指纹相撞应自动差异化而非拒绝：%v", err)
	}
	if compiled[0].Fingerprint == compiled[1].Fingerprint {
		t.Fatal("差异化后两屏指纹必须不同")
	}
	if !strings.Contains(compiled[1].Prompt, "切换为微距特写视角") {
		t.Fatalf("后一屏应追加差异化机位描述：%s", compiled[1].Prompt)
	}
}

// 阶段 5 容错语义：visualPlan 子字段缺失 → 模板兜底，不拒绝。
func TestCompileDetailPlanFillsMissingVisualPlanFields(t *testing.T) {
	raw := validPlanJSON(1, func(plan *DetailPlan) {
		plan.Screens[0].VisualPlan["variation"] = ""
	})
	compiled, err := CompileDetailPlan(raw, 1)
	if err != nil {
		t.Fatalf("缺 visualPlan 字段应兜底而非拒绝：%v", err)
	}
	if !strings.Contains(compiled[0].Prompt, "本屏差异与连续性：") {
		t.Fatal("兜底后仍须编译完整 12 段")
	}
}

// 阶段 5 容错语义：Markdown 外壳 + snake_case 键名差异必须能编译。
func TestCompileDetailPlanStripsMarkdownAndSnakeCase(t *testing.T) {
	raw := "模型说明文字如下：\n```json\n" + validPlanJSON(2, func(plan *DetailPlan) {
		// 模拟 snake_case：直接把 JSON 文本的 camelCase 键替换成下划线形式。
	}) + "\n```\n以上是结果。"
	snake := strings.NewReplacer(
		"productAnalysis", "product_analysis",
		"styleAnalysis", "style_analysis",
		"visualSystem", "visual_system",
		"sceneType", "scene_type",
		"sellingPoints", "selling_points",
		"visualPlan", "visual_plan",
		"colorAndMaterials", "color_and_materials",
		"visualEvidence", "visual_evidence",
		"visibleFeatures", "visible_features",
		"confirmedSellingPoints", "confirmed_selling_points",
		"transferableElements", "transferable_elements",
		"excludedElements", "excluded_elements",
		"artDirection", "art_direction",
	).Replace(raw)
	compiled, err := CompileDetailPlan(snake, 2)
	if err != nil {
		t.Fatalf("Markdown 外壳 + snake_case 应容错编译：%v", err)
	}
	if len(compiled) != 2 {
		t.Fatalf("应编译 2 屏，实际 %d", len(compiled))
	}
}

// 阶段 5 容错语义：styleAnalysis 整体缺失 → 智能缺省，不报错。
func TestCompileDetailPlanDefaultsMissingStyleAnalysis(t *testing.T) {
	raw := validPlanJSON(2, func(plan *DetailPlan) {
		plan.StyleAnalysis = nil
	})
	compiled, err := CompileDetailPlan(raw, 2)
	if err != nil {
		t.Fatalf("styleAnalysis 缺失应兜底而非拒绝：%v", err)
	}
	if !strings.Contains(compiled[0].Prompt, "统一配色：") {
		t.Fatal("兜底后仍须编译整组视觉段")
	}
}

// 阶段 5 容错语义：productAnalysis 整体缺失 → 商品事实兜底，不报错。
func TestCompileDetailPlanDefaultsMissingProductAnalysis(t *testing.T) {
	raw := validPlanJSON(2, func(plan *DetailPlan) {
		plan.ProductAnalysis = nil
	})
	compiled, err := CompileDetailPlanWithFallback(raw, 2, PlanFallback{
		ProductName: "海尔双子冰盒", SellingPoints: "一级能效、双温区独立控温",
	})
	if err != nil {
		t.Fatalf("productAnalysis 缺失应兜底而非拒绝：%v", err)
	}
	if len(compiled) != 2 {
		t.Fatalf("应编译 2 屏，实际 %d", len(compiled))
	}
}

// 仍然硬失败的只有：空响应、非法 JSON、screens 为空、单屏超长。
func TestCompileDetailPlanStillRejectsEmptyScreensAndGarbage(t *testing.T) {
	empty := validPlanJSON(1, func(plan *DetailPlan) { plan.Screens = nil })
	if _, err := CompileDetailPlan(empty, 1); !errors.Is(err, ErrPlanInvalid) {
		t.Fatal("screens 为空必须拒绝")
	}
	if _, err := CompileDetailPlan("", 1); !errors.Is(err, ErrPlanInvalid) {
		t.Fatal("空返回必须拒绝")
	}
	if _, err := CompileDetailPlan("{not json}", 1); !errors.Is(err, ErrPlanInvalid) {
		t.Fatal("非法 JSON 必须拒绝")
	}
	if _, err := CompileDetailPlan("完全不是 JSON 的一段话", 1); !errors.Is(err, ErrPlanInvalid) {
		t.Fatal("无 JSON 结构必须拒绝")
	}
}

func TestCompileDetailPlanRejectsOverlongPrompt(t *testing.T) {
	long := strings.Repeat("细节", 2000) // 4000 字 × 12 段 > 12000
	raw := validPlanJSON(1, func(plan *DetailPlan) {
		for key := range plan.Screens[0].VisualPlan {
			plan.Screens[0].VisualPlan[key] = long
		}
	})
	_, err := CompileDetailPlan(raw, 1)
	if !errors.Is(err, ErrPlanInvalid) {
		t.Fatalf("超长应拒绝，得到 %v", err)
	}
	if !strings.Contains(err.Error(), "不会截断执行") {
		t.Fatalf("错误信息应说明不截断：%v", err)
	}
}

func TestCompileDetailPlanRejectsEmptyAndInvalidJSON(t *testing.T) {
	if _, err := CompileDetailPlan("", 1); !errors.Is(err, ErrPlanInvalid) {
		t.Fatal("空返回应拒绝")
	}
	if _, err := CompileDetailPlan("{not json}", 1); !errors.Is(err, ErrPlanInvalid) {
		t.Fatal("非法 JSON 应拒绝")
	}
}

// 通用预设必须品类中性：不含独乐岛专属主张与成人用品负向词。
func TestGeneralPresetIsCategoryNeutral(t *testing.T) {
	preset := DefaultGeneralPreset()
	if preset.Key != GeneralPresetKey {
		t.Fatalf("通用预设 key 错误：%s", preset.Key)
	}
	if len(preset.Slots) != 7 {
		t.Fatalf("通用预设应为 7 屏，实际 %d", len(preset.Slots))
	}
	// 只禁「品类专属主张/文案」词；安全类负向词（如"真人裸露"）属于通用合规要求，允许保留。
	blocked := []string{"独乐", "情趣", "成人用品", "私享", "情色", "性暗示", "性器官"}
	haystack := preset.Name + preset.Slogan
	for _, slot := range preset.Slots {
		haystack += slot.Title + slot.Copy + slot.Variant
	}
	for _, word := range blocked {
		if strings.Contains(haystack, word) {
			t.Fatalf("通用预设不应含品类专属词 %q：%s", word, haystack)
		}
	}
	// 独乐岛仍保留为可选预设。
	if DefaultSoloIslandPreset().Key != SoloIslandPresetKey {
		t.Fatal("独乐岛预设应保留")
	}
}
