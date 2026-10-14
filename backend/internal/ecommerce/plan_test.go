package ecommerce

import (
	"strings"
	"testing"
)

func TestDefaultSoloIslandPresetShape(t *testing.T) {
	preset := DefaultSoloIslandPreset()
	if preset.Key != SoloIslandPresetKey {
		t.Fatalf("预设 key 应为 %s，得到 %s", SoloIslandPresetKey, preset.Key)
	}
	if preset.Slogan != SoloIslandSlogan {
		t.Fatalf("slogan 不符：%s", preset.Slogan)
	}
	if len(preset.Slots) != 7 {
		t.Fatalf("独乐岛应为 7 屏，得到 %d", len(preset.Slots))
	}
	heroCount, detailCount := 0, 0
	seenKeys := map[string]bool{}
	for _, slot := range preset.Slots {
		if seenKeys[slot.SlotKey] {
			t.Fatalf("槽位 key 重复：%s", slot.SlotKey)
		}
		seenKeys[slot.SlotKey] = true
		switch slot.Kind {
		case SlotKindHero:
			heroCount++
		case SlotKindDetail:
			detailCount++
		default:
			t.Fatalf("非法槽位类型：%s", slot.Kind)
		}
		if strings.TrimSpace(slot.UpstreamToolKey) == "" {
			t.Fatalf("槽位 %s 缺少上游工具 key（必须供料）", slot.SlotKey)
		}
		if strings.TrimSpace(slot.Variant) == "" || strings.TrimSpace(slot.Scene) == "" {
			t.Fatalf("槽位 %s 缺少 nxf 场景/变体", slot.SlotKey)
		}
	}
	if heroCount != 2 || detailCount != 5 {
		t.Fatalf("主图/详情页数量应为 2/5，得到 %d/%d", heroCount, detailCount)
	}
	// 详情页序号必须从 1 连续递增（编排与前端展示依赖）。
	for index, slot := range SlotPlansForKind(preset.Slots, SlotKindDetail) {
		if slot.SlotNo != index+1 {
			t.Fatalf("详情页序号不连续：第 %d 个为 %d", index+1, slot.SlotNo)
		}
	}
}

func TestSoloIslandDNAContract(t *testing.T) {
	dna := SoloIslandDNA()
	for _, key := range []string{"layout", "color", "lighting", "typography", "texture", "mood", "model", "props", "brand"} {
		if _, ok := dna[key]; !ok {
			t.Fatalf("DNA 缺少九维度之一：%s", key)
		}
	}
	color, ok := dna["color"].(map[string]any)
	if !ok {
		t.Fatal("color 维度结构错误")
	}
	palette, ok := color["palette"].([]map[string]any)
	if !ok || len(palette) == 0 {
		t.Fatal("调色板缺失")
	}
	total := 0.0
	for _, entry := range palette {
		if strings.TrimSpace(entry["hex"].(string)) == "" {
			t.Fatal("调色板色值缺失")
		}
		total += entry["ratio"].(float64)
	}
	if total < 0.99 || total > 1.01 {
		t.Fatalf("调色板比例之和应约为 1，得到 %.3f", total)
	}
	model, ok := dna["model"].(map[string]any)
	if !ok || model["present"] != false {
		t.Fatal("独乐岛预设应为无人物（model.present=false）")
	}
}

// upstreamImageTemplate 复刻 backend/internal/workbench 的 builtinPromptVariants
// 图像模板拼接结果（standard 变体），用于验证铁律段提取。
func upstreamImageTemplate() string {
	anchor := "以参考图1为主体外观与身份的唯一依据，"
	focus := "把商品置于纯白无缝背景中央，完整呈现轮廓、真实颜色、材质和包装细节，使用柔和棚拍光与克制自然投影"
	return anchor + focus + "。保持主体结构、颜色、比例、材质和可见细节稳定；辅助参考仅用于其对应的场景、姿态或风格，" +
		"不得覆盖主体特征。采用清晰的主体层级、可信透视、自然光影与真实接触关系。" +
		"画面不生成文字、价格、水印、虚构品牌或未提供的产品信息；输出干净、可用于商业创作的视觉画面。"
}

func TestUpstreamRuleSegmentExtractsIronRule(t *testing.T) {
	rule := UpstreamRuleSegment(upstreamImageTemplate())
	if !strings.HasPrefix(rule, "保持主体结构、颜色、比例、材质和可见细节稳定") {
		t.Fatalf("铁律段起始不符：%q", rule)
	}
	if !strings.HasSuffix(rule, "输出干净、可用于商业创作的视觉画面。") {
		t.Fatalf("铁律段结尾不符：%q", rule)
	}
	if strings.Contains(rule, "以参考图1为") {
		t.Fatal("铁律段不应包含锚定段")
	}
}

func TestUpstreamRuleSegmentOnForeignTemplate(t *testing.T) {
	if got := UpstreamRuleSegment("这是一段普通提示词，没有铁律段。"); got != "" {
		t.Fatalf("非上游模板应返回空串，得到 %q", got)
	}
	if got := UpstreamRuleSegment("   "); got != "" {
		t.Fatalf("空白模板应返回空串，得到 %q", got)
	}
}

func TestFusePromptWithUpstreamRule(t *testing.T) {
	template := upstreamImageTemplate()
	local := "【公共锚点卡】产品：潮汐，鼠尾草绿哑光硅胶；本张任务（细节微距）：微距特写。"
	fused := FusePromptWithUpstreamRule(local, template)
	if !strings.HasPrefix(fused, local) {
		t.Fatal("融合后本地提示词应保持在前")
	}
	if !strings.Contains(fused, "保持主体结构、颜色、比例、材质和可见细节稳定") {
		t.Fatal("融合后应含上游铁律段")
	}
	// 幂等：重复融合不叠加。
	if again := FusePromptWithUpstreamRule(fused, template); again != fused {
		t.Fatal("重复融合应幂等")
	}
	// 空铁律段 → 原样返回。
	if got := FusePromptWithUpstreamRule(local, ""); got != local {
		t.Fatalf("上游模板为空时应原样返回，得到 %q", got)
	}
	// 本地为空 → 只返回铁律段。
	if got := FusePromptWithUpstreamRule("", template); !strings.HasPrefix(got, "保持主体结构") {
		t.Fatalf("本地为空时应返回铁律段，得到 %q", got)
	}
}

func TestMergeNegativeDedupesAndKeepsOrder(t *testing.T) {
	merged := MergeNegative("文字、水印、变形的产品", SoloIslandNegative, "水印、低质量")
	parts := strings.Split(merged, "、")
	seen := map[string]bool{}
	for _, part := range parts {
		if seen[part] {
			t.Fatalf("负向词重复：%s", part)
		}
		seen[part] = true
	}
	if parts[0] != "文字" || parts[1] != "水印" {
		t.Fatalf("应保持首次出现顺序，得到 %v", parts)
	}
	if !seen["露骨色情暗示"] {
		t.Fatal("应含独乐岛防封词")
	}
	if got := MergeNegative("", "  ", "，,"); got != "" {
		t.Fatalf("空输入应返回空串，得到 %q", got)
	}
}

func TestSlotStatusFromTaskStatus(t *testing.T) {
	cases := map[string]string{
		"queued":    SlotStatusQueued,
		"running":   SlotStatusRunning,
		"succeeded": SlotStatusCompleted,
		"failed":    SlotStatusFailed,
		"cancelled": SlotStatusFailed,
		"weird":     SlotStatusUncertain,
	}
	for input, want := range cases {
		if got := SlotStatusFromTaskStatus(input); got != want {
			t.Fatalf("SlotStatusFromTaskStatus(%q) = %q, want %q", input, got, want)
		}
	}
	if !IsSlotStatusTerminal(SlotStatusCompleted) || !IsSlotStatusTerminal(SlotStatusFailed) {
		t.Fatal("completed/failed 应判定为终态")
	}
	if IsSlotStatusTerminal(SlotStatusRunning) || IsSlotStatusTerminal(SlotStatusQueued) {
		t.Fatal("running/queued 不应判定为终态")
	}
}

func TestNormalizePresetConfig(t *testing.T) {
	// 空串 → 内置独乐岛预设。
	config, err := NormalizePresetConfig("  ")
	if err != nil {
		t.Fatalf("空串不应报错：%v", err)
	}
	if config.Key != SoloIslandPresetKey || len(config.Slots) != 7 {
		t.Fatalf("空串应回落内置独乐岛预设：%+v", config)
	}
	// 非法 JSON → 报错（写路径不静默回落）。
	if _, err := NormalizePresetConfig("{not json"); err == nil {
		t.Fatal("非法 JSON 应报错")
	}
	// 缺槽位/负向词 → 补默认。
	config, err = NormalizePresetConfig(`{"version":1,"name":"自定义"}`)
	if err != nil {
		t.Fatalf("合法 JSON 不应报错：%v", err)
	}
	if len(config.Slots) != 7 || strings.TrimSpace(config.Negative) == "" {
		t.Fatal("缺失槽位与负向词应补默认")
	}
}

func TestComputeProductStatusWithReconciledSlots(t *testing.T) {
	// 全完成 → completed
	status, _ := ComputeProductStatus([]SlotView{
		{Status: SlotStatusCompleted}, {Status: SlotStatusCompleted},
	})
	if status != ProductStatusCompleted {
		t.Fatalf("全完成应为 completed，得到 %s", status)
	}
	// 有在途 → running
	status, _ = ComputeProductStatus([]SlotView{{Status: SlotStatusCompleted}, {Status: SlotStatusRunning}})
	if status != ProductStatusRunning {
		t.Fatalf("有在途应为 running，得到 %s", status)
	}
	// 任一失败 → failed
	status, _ = ComputeProductStatus([]SlotView{{Status: SlotStatusCompleted}, {Status: SlotStatusFailed}})
	if status != ProductStatusFailed {
		t.Fatalf("有失败应为 failed，得到 %s", status)
	}
	// 任一 uncertain → uncertain（不自动重发）
	status, _ = ComputeProductStatus([]SlotView{{Status: SlotStatusUncertain}})
	if status != ProductStatusUncertain {
		t.Fatalf("有待确认应为 uncertain，得到 %s", status)
	}
}
