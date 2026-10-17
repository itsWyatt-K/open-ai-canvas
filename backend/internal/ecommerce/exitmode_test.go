package ecommerce

import (
	"encoding/json"
	"testing"
)

// 执行模式解析：缺省/非法值一律回落 auto；只有显式 review 才走先审方案。
func TestSnapshotModeDefaultsToAuto(t *testing.T) {
	cases := []struct {
		raw  string
		want string
	}{
		{"", ExecutionModeAuto},
		{"not-json", ExecutionModeAuto},
		{`{"mode":""}`, ExecutionModeAuto},
		{`{"mode":"AUTO"}`, ExecutionModeAuto},
		{`{"mode":" review "}`, ExecutionModeReview},
		{`{"mode":"review"}`, ExecutionModeReview},
		{`{"mode":"unknown"}`, ExecutionModeAuto},
	}
	for _, item := range cases {
		if got := SnapshotMode(item.raw); got != item.want {
			t.Fatalf("SnapshotMode(%q) = %q, want %q", item.raw, got, item.want)
		}
	}
}

// 预设 Mode 字段参与序列化（前端配置栏可读可写）。
func TestPresetConfigModeRoundTrip(t *testing.T) {
	preset := DefaultSoloIslandPreset()
	preset.Mode = ExecutionModeReview
	raw, err := json.Marshal(preset)
	if err != nil {
		t.Fatal(err)
	}
	if got := SnapshotMode(string(raw)); got != ExecutionModeReview {
		t.Fatalf("预设 Mode 未参与序列化：%s", raw)
	}
	normalized, err := NormalizePresetConfig(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Mode != ExecutionModeReview {
		t.Fatalf("归一化丢失 Mode：%q", normalized.Mode)
	}
}

// 审核原因常量保持稳定（前端据此渲染审核横幅）。
func TestAwaitPlanConfirmReason(t *testing.T) {
	if StatusReasonAwaitPlanConfirm != "AWAITING_USER_PLAN_CONFIRMATION" {
		t.Fatalf("审核原因常量被改动：%q", StatusReasonAwaitPlanConfirm)
	}
}
