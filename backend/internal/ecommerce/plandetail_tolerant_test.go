package ecommerce

// 策划容错整形回归测试。
//
// 现场：gemini-3.8-flash-high 把 styleAnalysis 返回成字符串数组，严格按
// map[string]string 解码直接让整个策划失败（用户看到「策划结构不完整」）。
// 容错哲学是「能编译成功就绝不中断用户流程」。

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNormalizePlanBlocksFlattensArrayFields(t *testing.T) {
	raw := `{
      "productAnalysis": {"identity": "海尔双子冰盒", "visibleFeatures": ["扁平长条", "双笔仓"], "confirmedSellingPoints": [], "unknowns": []},
      "styleAnalysis": ["冷调科技感", "中性背景"],
      "visualSystem": {"artDirection": "科技冷调", "palette": ["冷灰", "白"], "lighting": "柔光", "typography": "无衬线"},
      "screens": [
        {"title": ["首屏视觉冲击"], "copy": "控糖出行", "sceneType": "强冲击竖构图", "sellingPoints": "2℃~28℃",
         "visualPlan": {"subject": "产品居中", "composition": ["三分法", "留白"], "environment": "纯色背景",
            "lighting": "柔光", "colorAndMaterials": "冷灰", "typography": "顶部标题区", "visualEvidence": "锁温结构", "variation": "满幅"}},
        {"title": "痛点强对比", "copy": "", "sceneType": "前后对比", "sellingPoints": "",
         "visualPlan": {"subject": "产品特写", "composition": "左右分栏", "environment": "生活台面",
            "lighting": "侧逆光", "colorAndMaterials": "暖白", "typography": "左图右文", "visualEvidence": "厚度对比", "variation": "分栏"}}
      ]
    }`

	compiled, err := CompileDetailPlan(raw, 2)
	if err != nil {
		t.Fatalf("容错整形后仍编译失败：%v", err)
	}
	if len(compiled) != 2 {
		t.Fatalf("应编译出 2 屏，实际 %d", len(compiled))
	}
	first := compiled[0]
	if first.Title != "首屏视觉冲击" {
		t.Fatalf("title 数组应被压平，得到 %q", first.Title)
	}
	for _, want := range []string{"整组视觉方向：科技冷调", "统一配色：冷灰；白", "镜头与构图：三分法；留白", "本屏差异与连续性：满幅"} {
		if !strings.Contains(first.Prompt, want) {
			t.Fatalf("编译提示词缺少 %q：\n%s", want, first.Prompt)
		}
	}
	// 相邻屏景别必须确实不同（指纹不重复）。
	if compiled[0].Fingerprint == compiled[1].Fingerprint {
		t.Fatal("相邻屏指纹不应相同")
	}
}

func TestNormalizePlanBlocksKeepsWellFormedPlanUntouched(t *testing.T) {
	raw := `{
      "styleAnalysis": {"palette": "冷灰", "composition": "三分法", "lighting": "柔光", "typography": "无衬线",
        "transferableElements": "留白", "excludedElements": "品牌文字"},
      "visualSystem": {"artDirection": "科技冷调", "palette": "冷灰", "lighting": "柔光", "typography": "无衬线"},
      "screens": [
        {"title": "首屏", "copy": "控糖出行", "sceneType": "竖构图", "sellingPoints": "锁温",
         "visualPlan": {"subject": "产品居中", "composition": "三分法", "environment": "纯色背景", "lighting": "柔光",
            "colorAndMaterials": "冷灰", "typography": "顶部标题区", "visualEvidence": "锁温结构", "variation": "满幅"}},
        {"title": "对比", "copy": "", "sceneType": "对比", "sellingPoints": "",
         "visualPlan": {"subject": "产品特写", "composition": "左右分栏", "environment": "生活台面", "lighting": "侧逆光",
            "colorAndMaterials": "暖白", "typography": "左图右文", "visualEvidence": "厚度对比", "variation": "分栏"}}
      ]
    }`
	before, err := CompileDetailPlan(raw, 2)
	if err != nil {
		t.Fatalf("规整策划不应失败：%v", err)
	}
	if !strings.Contains(before[0].Prompt, "统一配色：冷灰") {
		t.Fatalf("规整策划的配色段应原样保留：\n%s", before[0].Prompt)
	}
	// 幂等：再跑一次结果一致。
	again, err := CompileDetailPlan(raw, 2)
	if err != nil {
		t.Fatalf("二次编译失败：%v", err)
	}
	if again[0].Prompt != before[0].Prompt {
		t.Fatal("容错整形应幂等")
	}
}

func TestFlattenPlanTextJoinsNestedStructures(t *testing.T) {
	var value any
	if err := json.Unmarshal([]byte(`{"a": ["x", {"b": "y"}], "c": 3}`), &value); err != nil {
		t.Fatal(err)
	}
	text, ok := flattenPlanText(value)
	if !ok {
		t.Fatal("应能压平")
	}
	for _, want := range []string{"a：x；b：y", "c：3"} {
		if !strings.Contains(text, want) {
			t.Fatalf("压平结果缺少 %q：%s", want, text)
		}
	}
}
