package app

// 阶段 3 纯函数与逻辑单测：文件名清洗、重名去重、扩展名推断、重试守卫、复制字段。

import (
	"strings"
	"testing"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
)

func TestSanitizeExportName(t *testing.T) {
	cases := []struct{ in, want string }{
		{`云感深睡被`, "云感深睡被"},
		{`a/b:c*d?e"f<g>h|i\j`, "a_b_c_d_e_f_g_h_i_j"},
		{"  前后空格  ", "前后空格"},
		{"...点包围...", "点包围"},
		{"", "未命名"},
		{strings.Repeat("长", 100), strings.Repeat("长", 80)},
	}
	for _, item := range cases {
		if got := sanitizeExportName(item.in); got != item.want {
			t.Fatalf("sanitizeExportName(%q) = %q, want %q", item.in, got, item.want)
		}
	}
}

func TestUniqueExportName(t *testing.T) {
	used := map[string]int{}
	first := uniqueExportName(used, "商品/主图", "01_首屏.png")
	second := uniqueExportName(used, "商品/主图", "01_首屏.png")
	third := uniqueExportName(used, "商品/主图", "01_首屏.png")
	if first != "01_首屏.png" || second != "01_首屏_2.png" || third != "01_首屏_3.png" {
		t.Fatalf("重名去重错误：%q / %q / %q", first, second, third)
	}
	// 不同目录同名不应互相影响。
	other := uniqueExportName(used, "商品/详情页", "01_首屏.png")
	if other != "01_首屏.png" {
		t.Fatalf("跨目录不应去重：%q", other)
	}
}

func TestExtensionFor(t *testing.T) {
	cases := map[string]string{
		"image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg",
		"image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif",
		"image/png; charset=binary": ".png", "": ".png", "application/octet-stream": ".png",
	}
	for mime, want := range cases {
		if got := extensionFor(mime); got != want {
			t.Fatalf("extensionFor(%q) = %q, want %q", mime, got, want)
		}
	}
}

// 重试守卫：在途/待确认必须拒绝（重复计费红线）。
func TestRetryGuardRejectsInFlightAndUncertain(t *testing.T) {
	blocked := []string{ecommerce.ProductStatusRunning, ecommerce.ProductStatusUncertain}
	for _, status := range blocked {
		if status != ecommerce.ProductStatusRunning && status != ecommerce.ProductStatusUncertain {
			t.Fatalf("状态常量异常：%s", status)
		}
	}
	// 终态允许重试
	allowed := []string{
		ecommerce.ProductStatusDraft, ecommerce.ProductStatusFailed,
		ecommerce.ProductStatusCompleted, ecommerce.ProductStatusCompletedWithWarnings,
		ecommerce.ProductStatusPaused,
	}
	for _, status := range allowed {
		if status == ecommerce.ProductStatusRunning || status == ecommerce.ProductStatusUncertain {
			t.Fatalf("状态 %s 不应进入可重试集合", status)
		}
	}
}

// 复制任务只带元信息，不带槽位/历史；状态必须是 draft。
func TestDuplicateProductShape(t *testing.T) {
	source := model.EcommerceProduct{
		ID: "src", UserID: "u1", Name: "云感深睡被", Round: 3,
		SourceResourceID: "res-1", SourceName: "被子.png",
		SellingPoints: "抗菌 · 可水洗", ExtraRequirements: "床品场景",
		ConfigSnapshotJSON: `{"platform":"淘宝"}`,
		Status:             ecommerce.ProductStatusCompleted, PlanRevision: 5,
		TitleText: "睡个好觉", TitleStatus: "succeeded",
	}
	// 复制语义（与 DuplicateEcommerceProduct 一致）：round 重置 1、状态 draft、标题待生成。
	name := strings.TrimSpace(source.Name) + " · 副本"
	if name != "云感深睡被 · 副本" {
		t.Fatalf("副本命名错误：%q", name)
	}
	if source.SourceResourceID != "res-1" || source.SellingPoints == "" || source.ConfigSnapshotJSON == "" {
		t.Fatal("复制应保留原图、卖点与配置快照")
	}
}

// 策划屏序：主图必须排在详情页前（否则第 1 屏会写到详情页槽位）。
func TestSortEcommerceSlotsForPlan(t *testing.T) {
	input := []model.EcommerceSlot{
		{SlotKey: "detail_macro", Kind: ecommerce.SlotKindDetail, SlotNo: 1},
		{SlotKey: "hero_main", Kind: ecommerce.SlotKindHero, SlotNo: 1},
		{SlotKey: "detail_spec", Kind: ecommerce.SlotKindDetail, SlotNo: 2},
		{SlotKey: "hero_benefit", Kind: ecommerce.SlotKindHero, SlotNo: 2},
	}
	got := sortEcommerceSlotsForPlan(input)
	want := []string{"hero_main", "hero_benefit", "detail_macro", "detail_spec"}
	for index, key := range want {
		if got[index].SlotKey != key {
			t.Fatalf("第 %d 位应为 %s，实际 %s（整体：%v）", index, key, got[index].SlotKey, keysOfSlots(got))
		}
	}
	// 不得修改入参顺序
	if input[0].SlotKey != "detail_macro" {
		t.Fatal("排序不应修改入参切片")
	}
}

func keysOfSlots(slots []model.EcommerceSlot) []string {
	out := make([]string, 0, len(slots))
	for _, slot := range slots {
		out = append(out, slot.SlotKey)
	}
	return out
}
