package ecommerce

import "testing"

// 已固化选项（前端配置面板/合作方文档逐字）；[待规范源] 列表不在此断言——
// 规范源补齐后由桌面版比对测试接管（见 impl-log 验证债务）。

func TestQualityValues(t *testing.T) {
	want := []string{QualityAuto, QualityHigh, QualityMedium, QualityLow}
	if len(QualityValues) != len(want) {
		t.Fatalf("QualityValues 长度 = %d, want %d", len(QualityValues), len(want))
	}
	for i := range want {
		if QualityValues[i] != want[i] {
			t.Fatalf("QualityValues[%d] = %q, want %q", i, QualityValues[i], want[i])
		}
	}
}

func TestImageRatioValues(t *testing.T) {
	want := []string{"1:1", "2:3", "3:2", "3:4", "9:16"}
	if len(ImageRatioValues) != len(want) {
		t.Fatalf("ImageRatioValues 长度 = %d, want %d", len(ImageRatioValues), len(want))
	}
	for i := range want {
		if ImageRatioValues[i] != want[i] {
			t.Fatalf("ImageRatioValues[%d] = %q, want %q", i, ImageRatioValues[i], want[i])
		}
	}
}

func TestSlotKindAndTextModeConstants(t *testing.T) {
	if SlotKindHero != "hero" || SlotKindDetail != "detail" {
		t.Fatal("槽位类型常量与桌面版 hero/detail 不符")
	}
	if TextModeNone != "none" || TextModeTypeset != "typeset" {
		t.Fatal("文字模式常量与桌面版 none/typeset 不符")
	}
	if ModeAuto != "auto" || ModeReview != "review" {
		t.Fatal("执行模式常量与桌面版 auto/review 不符")
	}
}
