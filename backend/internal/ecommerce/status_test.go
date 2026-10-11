package ecommerce

import "testing"

// 桌面版真值表：ComputeProductStatus 规则锚点（Task 5）。
func TestComputeProductStatus(t *testing.T) {
	cases := []struct {
		name        string
		slots       []SlotView
		wantStatus  string
		wantTitle   string
	}{
		{
			name:       "空槽位=未开始",
			slots:      nil,
			wantStatus: ProductStatusDraft,
			wantTitle:  TitleStatusPending,
		},
		{
			name: "图片标题全成功=已完成",
			slots: []SlotView{
				{Status: SlotStatusCompleted, TitleStatus: TitleStatusCompleted},
				{Status: SlotStatusCompleted, TitleStatus: TitleStatusCompleted},
			},
			wantStatus: ProductStatusCompleted,
			wantTitle:  TitleStatusCompleted,
		},
		{
			name: "图片全成功仅标题失败=图片已完成(warnings)",
			slots: []SlotView{
				{Status: SlotStatusCompleted, TitleStatus: TitleStatusCompleted},
				{Status: SlotStatusCompleted, TitleStatus: TitleStatusFailed},
			},
			wantStatus: ProductStatusCompletedWithWarnings,
			wantTitle:  TitleStatusFailed,
		},
		{
			name: "图片全成功仅标题待确认=图片已完成(warnings)",
			slots: []SlotView{
				{Status: SlotStatusCompleted, TitleStatus: TitleStatusUncertain},
			},
			wantStatus: ProductStatusCompletedWithWarnings,
			wantTitle:  TitleStatusUncertain,
		},
		{
			name: "任一图片失败=失败",
			slots: []SlotView{
				{Status: SlotStatusCompleted, TitleStatus: TitleStatusCompleted},
				{Status: SlotStatusFailed, TitleStatus: TitleStatusCompleted},
			},
			wantStatus: ProductStatusFailed,
			wantTitle:  TitleStatusCompleted,
		},
		{
			name: "任一图片待确认=uncertain不自动重发",
			slots: []SlotView{
				{Status: SlotStatusUncertain, TitleStatus: TitleStatusCompleted},
				{Status: SlotStatusCompleted, TitleStatus: TitleStatusCompleted},
			},
			wantStatus: ProductStatusUncertain,
			wantTitle:  TitleStatusCompleted,
		},
		{
			name: "有图在途=进行中",
			slots: []SlotView{
				{Status: SlotStatusCompleted, TitleStatus: TitleStatusCompleted},
				{Status: SlotStatusRefining, TitleStatus: TitleStatusPending},
			},
			wantStatus: ProductStatusRunning,
			wantTitle:  TitleStatusPending,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotStatus, gotTitle := ComputeProductStatus(tc.slots)
			if gotStatus != tc.wantStatus {
				t.Fatalf("status = %q, want %q", gotStatus, tc.wantStatus)
			}
			if gotTitle != tc.wantTitle {
				t.Fatalf("titleStatus = %q, want %q", gotTitle, tc.wantTitle)
			}
		})
	}
}

func TestIsTerminalProductStatus(t *testing.T) {
	terminal := []string{ProductStatusCompleted, ProductStatusCompletedWithWarnings, ProductStatusFailed, ProductStatusPaused}
	for _, s := range terminal {
		if !IsTerminalProductStatus(s) {
			t.Errorf("%q 应为终态", s)
		}
	}
	nonTerminal := []string{ProductStatusDraft, ProductStatusQueued, ProductStatusRunning, ProductStatusReview, ProductStatusUncertain}
	for _, s := range nonTerminal {
		if IsTerminalProductStatus(s) {
			t.Errorf("%q 应为非终态", s)
		}
	}
}

func TestCountsAsCompletedForFilter(t *testing.T) {
	if !CountsAsCompletedForFilter(ProductStatusCompleted) {
		t.Error("completed 应计入已完成筛选")
	}
	if !CountsAsCompletedForFilter(ProductStatusCompletedWithWarnings) {
		t.Error("completed_with_warnings 应计入已完成筛选")
	}
	if CountsAsCompletedForFilter(ProductStatusFailed) {
		t.Error("failed 不应计入已完成筛选")
	}
}
