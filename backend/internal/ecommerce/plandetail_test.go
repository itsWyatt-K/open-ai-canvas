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

func TestCompileDetailPlanRejectsWrongScreenCount(t *testing.T) {
	_, err := CompileDetailPlan(validPlanJSON(3, nil), 5)
	if !errors.Is(err, ErrPlanInvalid) {
		t.Fatalf("屏数不符应返回 ErrPlanInvalid，得到 %v", err)
	}
	if !strings.Contains(err.Error(), "须包含 5 屏") {
		t.Fatalf("错误信息应说明期望屏数：%v", err)
	}
}

func TestCompileDetailPlanRejectsDuplicateVisualPlan(t *testing.T) {
	raw := validPlanJSON(2, func(plan *DetailPlan) {
		// 第二屏复制第一屏的视觉方案 → 必须拒绝
		plan.Screens[1].VisualPlan = plan.Screens[0].VisualPlan
	})
	_, err := CompileDetailPlan(raw, 2)
	if !errors.Is(err, ErrPlanInvalid) {
		t.Fatalf("重复视觉方案应拒绝，得到 %v", err)
	}
	if !strings.Contains(err.Error(), "视觉方案重复") {
		t.Fatalf("错误信息应指出重复：%v", err)
	}
}

func TestCompileDetailPlanRejectsMissingField(t *testing.T) {
	raw := validPlanJSON(1, func(plan *DetailPlan) {
		plan.Screens[0].VisualPlan["variation"] = ""
	})
	if _, err := CompileDetailPlan(raw, 1); !errors.Is(err, ErrPlanInvalid) {
		t.Fatalf("缺字段应拒绝，得到 %v", err)
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
