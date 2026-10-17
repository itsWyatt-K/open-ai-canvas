package ecommerce

// 阶段 4 死锁修复测试：
// review 态下槽位是 draft（未派发），ComputeProductStatus **不得**推导成 running，
// 否则 confirm-plan 又要求 status==review → 用户被锁死。

import "testing"

func TestDraftSlotsDoNotCountAsInFlight(t *testing.T) {
	// 全部 draft（先审方案暂存）→ 不应是 running
	status, _ := ComputeProductStatus([]SlotView{
		{Status: SlotStatusDraft}, {Status: SlotStatusDraft},
		{Status: SlotStatusDraft}, {Status: SlotStatusDraft},
	})
	if status == ProductStatusRunning {
		t.Fatal("draft 槽位不应被判为在途（这正是 review 被覆盖成 running 的根因）")
	}
	if status != ProductStatusDraft {
		t.Fatalf("全 draft 应为 draft，实际 %s", status)
	}
	// queued（真派发）→ running
	status, _ = ComputeProductStatus([]SlotView{{Status: SlotStatusQueued}})
	if status != ProductStatusRunning {
		t.Fatalf("queued 应判为 running，实际 %s", status)
	}
	// draft + completed 混合 → 仍非在途
	status, _ = ComputeProductStatus([]SlotView{
		{Status: SlotStatusDraft}, {Status: SlotStatusCompleted},
	})
	if status == ProductStatusRunning {
		t.Fatal("draft+completed 不应判为在途")
	}
	// 全 completed → completed
	status, _ = ComputeProductStatus([]SlotView{
		{Status: SlotStatusCompleted}, {Status: SlotStatusCompleted},
	})
	if status != ProductStatusCompleted {
		t.Fatalf("全 completed 应为 completed，实际 %s", status)
	}
}

// 默认配置必须是 review（未确认前不扣费）。
func TestDefaultModeIsReview(t *testing.T) {
	config := DefaultConfigView()
	if config.Mode != ModeReview {
		t.Fatalf("默认执行模式应为 review（阶段 4：先审方案），实际 %s", config.Mode)
	}
}

// 停止生成后槽位为 paused，不得再算在途。
func TestPausedSlotsAreNotInFlight(t *testing.T) {
	status, _ := ComputeProductStatus([]SlotView{
		{Status: SlotStatusPaused}, {Status: SlotStatusCompleted},
	})
	if status == ProductStatusRunning {
		t.Fatal("paused 槽位不应判为在途（否则停止后又被推回 running）")
	}
}
