package ecommerce

// 平台规范字典测试（阶段 5）：6 平台矩阵、槽位模板、键稳定性、Prompt 注入。

import (
	"strings"
	"testing"
)

func TestPlatformSpecsCoverSixPlatforms(t *testing.T) {
	specs := PlatformSpecs()
	if len(specs) != 6 {
		t.Fatalf("应有 6 大平台，实际 %d", len(specs))
	}
	want := map[string]bool{
		PlatformTaobao: false, PlatformDouyin: false, PlatformPinduoduo: false,
		PlatformJD: false, PlatformAmazon: false, PlatformXiaohongshu: false,
	}
	for _, spec := range specs {
		want[spec.Key] = true
		if spec.HeroCount != 3 || spec.DetailCount != 4 {
			t.Fatalf("%s 应为 3 主图 + 4 详情页，实际 %d+%d", spec.Key, spec.HeroCount, spec.DetailCount)
		}
		if spec.HeroRatio == "" || spec.DetailRatio == "" || spec.Language == "" || spec.Rules == "" {
			t.Fatalf("%s 规格矩阵不完整：%+v", spec.Key, spec)
		}
	}
	for key, seen := range want {
		if !seen {
			t.Fatalf("缺少平台 %s", key)
		}
	}
	// 亚马逊必须是英文 + 4:3 详情页 + 首屏白底。
	amazon := PlatformSpecOrDefault(PlatformAmazon)
	if amazon.Language != "en" || amazon.DetailRatio != "4:3" || !amazon.WhiteBackgroundFirst {
		t.Fatalf("亚马逊规范不符：%+v", amazon)
	}
	// 京东首屏白底。
	if !PlatformSpecOrDefault(PlatformJD).WhiteBackgroundFirst {
		t.Fatal("京东应标记首屏纯白底")
	}
	// 抖音竖屏 3:4。
	if PlatformSpecOrDefault(PlatformDouyin).HeroRatio != "3:4" {
		t.Fatal("抖音主图应为 3:4 竖屏")
	}
}

func TestPlatformSlotKeysMatchGeneralPreset(t *testing.T) {
	// 平台模板槽位键必须与通用预设逐字一致（否则 Start/confirm 匹配不到存量槽位，
	// 会重复建槽——阶段 5 实测坑）。
	general := map[string]bool{}
	for _, plan := range GeneralSlots() {
		general[plan.SlotKey] = true
	}
	for _, spec := range PlatformSpecs() {
		plans := PlatformSlotPlans(spec)
		if len(plans) != 7 {
			t.Fatalf("%s 应产出 7 屏，实际 %d", spec.Key, len(plans))
		}
		heroSeen, detailSeen := 0, 0
		for _, plan := range plans {
			if !general[plan.SlotKey] {
				t.Fatalf("%s 槽位键 %s 不在通用预设键集合内", spec.Key, plan.SlotKey)
			}
			if plan.Kind == SlotKindHero {
				heroSeen++
			}
			if plan.Kind == SlotKindDetail {
				detailSeen++
			}
			if plan.Aspect == "" || plan.Title == "" {
				t.Fatalf("%s 槽位 %s 缺少比例或标题", spec.Key, plan.SlotKey)
			}
		}
		if heroSeen != 3 || detailSeen != 4 {
			t.Fatalf("%s 应 3 主图 + 4 详情页，实际 %d+%d", spec.Key, heroSeen, detailSeen)
		}
		// 比例必须跟随平台矩阵。
		for _, plan := range plans {
			want := spec.HeroRatio
			if plan.Kind == SlotKindDetail {
				want = spec.DetailRatio
			}
			if plan.Aspect != want {
				t.Fatalf("%s 槽位 %s 比例应为 %s，实际 %s", spec.Key, plan.SlotKey, want, plan.Aspect)
			}
		}
	}
	// 主图必须排在详情页前（策划屏序）。
	for _, spec := range PlatformSpecs() {
		plans := PlatformSlotPlans(spec)
		seenDetail := false
		for _, plan := range plans {
			if plan.Kind == SlotKindDetail {
				seenDetail = true
			}
			if plan.Kind == SlotKindHero && seenDetail {
				t.Fatalf("%s 主图排在详情页之后", spec.Key)
			}
		}
	}
}

// 返工令 B 二：槽位基底只准写「本屏专属的产品视角 / 场景道具 / 光影色调 / 构图描述」，
// 严禁把平台规范套话、通用防走形护栏、文字排版指令写进 generation_prompt。
func TestPlatformSlotBasePromptIsSceneOnly(t *testing.T) {
	spec := PlatformSpecOrDefault(PlatformJD)
	plans := PlatformSlotPlans(spec)
	first := PlatformSlotBasePrompt(plans[0], spec)
	for _, want := range []string{"【本屏主题】", "【场景与道具】", "【视角与构图】", "【光影与色调】"} {
		if !strings.Contains(first, want) {
			t.Fatalf("基底应含本屏描述字段 %s：%s", want, first)
		}
	}
	// 京东白底首图：背景规范属于本屏描述，应予保留。
	if !strings.Contains(first, "纯白背景") {
		t.Fatalf("京东首屏基底应含白底背景规范：%s", first)
	}
	// 通用护栏与文字排版指令属于派发后缀，绝不能出现在落库基底里。
	for _, forbidden := range []string{
		"保持主体结构、颜色、比例、材质和可见细节稳定",
		"画面不生成文字",
		"画面预留干净排版区",
		"画面纯图无文字",
	} {
		if strings.Contains(first, forbidden) {
			t.Fatalf("基底严禁包含系统套话 %q：%s", forbidden, first)
		}
	}
	amazon := PlatformSpecOrDefault(PlatformAmazon)
	amazonFirst := PlatformSlotBasePrompt(PlatformSlotPlans(amazon)[0], amazon)
	if !strings.Contains(amazonFirst, "85%") {
		t.Fatalf("亚马逊首屏基底应含 85%% 画幅规范：%s", amazonFirst)
	}
}

func TestPlatformPromptRulesAndSeed(t *testing.T) {
	rules := PlatformPromptRules(PlatformAmazon)
	if !strings.Contains(rules, "Pure White Background") || !strings.Contains(rules, "英文") {
		t.Fatalf("亚马逊 Prompt 规则段不完整：%s", rules)
	}
	if PlatformPromptRules("不存在的平台") != "" {
		t.Fatal("未知平台应返回空规则段")
	}
	if !strings.Contains(PlatformStyleSeed(PlatformSpecOrDefault(PlatformDouyin)), "抖音") {
		t.Fatal("风格种子应含平台名")
	}
	// 未知 key 回落默认（淘宝天猫），不返回 nil 激进崩溃。
	if PlatformSpecOrDefault("").Key != PlatformTaobao {
		t.Fatal("空 key 应回落淘宝天猫")
	}
	if PlatformByKey("nope") != nil {
		t.Fatal("未知 key 的 PlatformByKey 应返回 nil")
	}
}
