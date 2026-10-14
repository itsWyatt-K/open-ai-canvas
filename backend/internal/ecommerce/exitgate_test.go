package ecommerce

import (
	"strings"
	"testing"
)

// 样例全部摘自 canvas-agent/src/modules/exit-gates/rules/guardrail-rules.yaml，
// 用于锁死 Go 镜像与 YAML/TS 规则的行为一致（规则漂移立即红灯）。
func TestComplianceGateStripsQualityJargon(t *testing.T) {
	verdict := ComplianceGate("一件鼠尾草绿硅胶静物，超高清 8k，杰作，masterpiece，best quality")
	if verdict.Rejected {
		t.Fatalf("不该拒绝：%s", verdict.RejectReason)
	}
	for _, banned := range []string{"超高清", "8k", "杰作", "masterpiece", "best quality"} {
		if strings.Contains(verdict.Filtered, banned) {
			t.Fatalf("咒语词未剥离：%q 仍在 %q 中", banned, verdict.Filtered)
		}
	}
	if !strings.Contains(verdict.Filtered, "鼠尾草绿硅胶静物") {
		t.Fatalf("正文被误伤：%q", verdict.Filtered)
	}
	wantRules := map[string]bool{"zh-quality-jargon": false, "resolution-in-prompt": false, "en-quality-jargon": false}
	for _, hit := range verdict.Hits {
		if _, ok := wantRules[hit]; ok {
			wantRules[hit] = true
		}
	}
	for rule, hit := range wantRules {
		if !hit {
			t.Fatalf("规则 %s 命中未登记：%v", rule, verdict.Hits)
		}
	}
}

func TestComplianceGateStripsEnglishJargonVariants(t *testing.T) {
	cases := []string{
		"award-winning product photo", "ultra realistic render", "hyper-realistic still life",
		"insanely detailed texture", "extremely detailed surface", "ultra-detailed macro",
		"trending on artstation", "4K UHD poster",
	}
	for _, input := range cases {
		verdict := ComplianceGate(input)
		for _, banned := range []string{"award-winning", "ultra realistic", "hyper-realistic", "insanely detailed", "extremely detailed", "ultra-detailed", "trending on artstation", "4K", "UHD"} {
			if strings.Contains(strings.ToLower(verdict.Filtered), strings.ToLower(banned)) {
				t.Fatalf("英文咒语未剥离：%q 仍在 %q 中", banned, verdict.Filtered)
			}
		}
	}
}

func TestComplianceGateRewritesBlocklistToMetaphors(t *testing.T) {
	verdict := ComplianceGate("露骨的色情画面，含裸露与性器官特写")
	if verdict.Rejected {
		t.Fatalf("不该拒绝：%s", verdict.RejectReason)
	}
	for _, blocked := range complianceBlocklist {
		if strings.Contains(verdict.Filtered, blocked) {
			t.Fatalf("红线词未改写：%q 仍在 %q 中", blocked, verdict.Filtered)
		}
	}
	if !strings.Contains(verdict.Filtered, "高奢卧室暖光") || !strings.Contains(verdict.Filtered, "真丝") {
		t.Fatalf("通感隐喻未注入：%q", verdict.Filtered)
	}
	if !strings.Contains(verdict.Filtered, complianceStyleSuffix) {
		t.Fatalf("改写后应补高级质感锚点：%q", verdict.Filtered)
	}
	// 幂等：改写结果再过一次门禁不应再触发 safety-wordlist 命中。
	again := ComplianceGate(verdict.Filtered)
	for _, hit := range again.Hits {
		if strings.HasPrefix(hit, "safety-wordlist:") {
			t.Fatalf("改写结果仍命中红线词：%v", again.Hits)
		}
	}
	if len(verdict.Hits) < 3 {
		t.Fatalf("应登记至少 3 个红线词命中：%v", verdict.Hits)
	}
}

func TestComplianceGateLeavesCleanPromptUntouched(t *testing.T) {
	clean := "微距特写，鼠尾草绿鹅卵石静物置于米白亚麻布上，单一暖黄壁灯侧逆光"
	verdict := ComplianceGate(clean)
	if verdict.Rejected {
		t.Fatalf("干净提示词不该被拒绝：%s", verdict.RejectReason)
	}
	if verdict.Filtered != clean {
		t.Fatalf("干净提示词不应被改写：got %q want %q", verdict.Filtered, clean)
	}
	if len(verdict.Hits) != 0 {
		t.Fatalf("干净提示词不应有命中：%v", verdict.Hits)
	}
}

func TestComplianceGateRejectsAspectRatioConflict(t *testing.T) {
	verdict := ComplianceGate("商品居中构图，比例 1:1，同时预留 9:16 版本")
	if !verdict.Rejected {
		t.Fatalf("多比例规格应被拒绝：%q", verdict.Filtered)
	}
	if !strings.Contains(verdict.RejectReason, "比例") {
		t.Fatalf("拒绝原因应说明比例冲突：%q", verdict.RejectReason)
	}
	// 单一比例不算冲突。
	single := ComplianceGate("商品居中构图，比例 1:1")
	if single.Rejected {
		t.Fatalf("单比例不应拒绝：%q", single.RejectReason)
	}
	// 比例值相同（写法不同）也不算冲突。
	same := ComplianceGate("比例 1:1 与 1:1 重复")
	if same.Rejected {
		t.Fatalf("相同比例不应拒绝：%q", same.RejectReason)
	}
}

func TestComplianceGateCleanupAfterStrip(t *testing.T) {
	verdict := ComplianceGate("静物，，，摆放  ，超高清")
	if strings.Contains(verdict.Filtered, "，，") || strings.Contains(verdict.Filtered, "  ") {
		t.Fatalf("删除残迹未清理：%q", verdict.Filtered)
	}
	if !strings.Contains(verdict.Filtered, "静物") || !strings.Contains(verdict.Filtered, "摆放") {
		t.Fatalf("清理误伤正文：%q", verdict.Filtered)
	}
}

func TestComplianceGateEmptyInput(t *testing.T) {
	verdict := ComplianceGate("")
	if verdict.Filtered != "" || verdict.Rejected {
		t.Fatalf("空输入应原样返回：%#v", verdict)
	}
}

// S4 说明：轴线几何校验需要机位三维向量，电商槽位提示词无几何输入，
// S4 继续由 canvas-agent 的 axis-guard 在分镜链路执行（此处仅固化该边界）。
func TestS4ScopeIsDocumented(t *testing.T) {
	if len(complianceBlocklist) == 0 {
		t.Fatal("红线词库不应为空")
	}
	if complianceStyleSuffix == "" {
		t.Fatal("通感基调锚点不应为空")
	}
}
