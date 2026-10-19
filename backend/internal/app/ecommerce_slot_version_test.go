package app

// 槽位版本号回归测试（返工令 B 验收现场暴露的 500）。
//
// 现场：bc33eb98… 的 7 个槽位库里已存在 v1 失败版本行，但 slot.current_version 仍为 0
// （早期失败路径只写版本表、不推进 current_version）。重派按 current_version+1 算出
// next=1，插入时撞唯一约束 (slot_id, version) → 整条 regenerate 返回 500，
// 用户看到的是「系统处理失败」而不是可行动的原因。

import (
	"testing"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// TestNextEcommerceSlotVersionSkipsExistingRows 版本号必须同时认「版本表已有行」，
// 不能只看 current_version。
func TestNextEcommerceSlotVersionSkipsExistingRows(t *testing.T) {
	svc := newAgentEcommerceService(t)
	product := &model.EcommerceProduct{
		ID: kernel.NewID(), UserID: "u-version", Name: "版本号回归",
		Status: ecommerce.ProductStatusFailed,
	}
	if err := svc.repo.CreateEcommerceProduct(product); err != nil {
		t.Fatal(err)
	}
	slot := &model.EcommerceSlot{
		ID: kernel.NewID(), ProductID: product.ID, Kind: ecommerce.SlotKindHero, SlotNo: 1,
		SlotKey: "hero_main", Title: "首屏", Status: ecommerce.SlotStatusFailed,
		CurrentVersion: 0,
	}
	if err := svc.repo.CreateEcommerceSlots([]model.EcommerceSlot{*slot}); err != nil {
		t.Fatal(err)
	}

	// 没有任何版本行时：基线就是 current_version。
	if got := svc.nextEcommerceSlotVersion(slot.ID, 0); got != 1 {
		t.Fatalf("无版本行时应为 1，实际 %d", got)
	}
	// 历史失败态：v1 行已在库里，但 current_version 还是 0。
	if err := svc.repo.CreateEcommerceSlotVersion(&model.EcommerceSlotVersion{
		ID: kernel.NewID(), SlotID: slot.ID, Version: 1,
		Status: ecommerce.SlotStatusFailed, Prompt: "旧提示词",
	}); err != nil {
		t.Fatal(err)
	}
	max, err := svc.repo.MaxEcommerceSlotVersion(slot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if max != 1 {
		t.Fatalf("MaxEcommerceSlotVersion 应为 1，实际 %d", max)
	}
	if got := svc.nextEcommerceSlotVersion(slot.ID, slot.CurrentVersion); got != 2 {
		t.Fatalf("已有 v1 行时应取 2（撞唯一约束的回归点），实际 %d", got)
	}
	// current_version 已追上版本表时，仍以 current_version 为基线。
	if got := svc.nextEcommerceSlotVersion(slot.ID, 1); got != 2 {
		t.Fatalf("current_version=1 时应为 2，实际 %d", got)
	}
}
