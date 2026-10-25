package app

// Agent 电商产线工具测试（拍板令阶段四）：切平台 / AI 策划 / 确认派发。
// 重点守三条纪律：
//  1. 三工具只在下发条件内出现（只读模式一律不下发——confirm_plan 是计费动作）；
//  2. confirm_plan 同时进 cloudAgentWrite 与 cloudAgentAlwaysApprove（强制审批门）；
//  3. 状态门禁：仅「待确认方案/未开始」可确认派发，running 等状态拒绝。

import (
	"strings"
	"testing"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// 声明与门控：auto 全发、read_only 全隐；confirm_plan 必须双门俱达。
func TestAgentEcommercePhase4ToolsDeclared(t *testing.T) {
	names := toolNames(compileCloudAgentTools(CloudAgentRequest{PermissionMode: "auto"}, true))
	for _, want := range []string{"ecommerce_apply_platform", "ecommerce_plan_product", "ecommerce_confirm_plan"} {
		if !containsName(names, want) {
			t.Fatalf("auto 模式缺少工具 %s", want)
		}
	}
	readOnly := toolNames(compileCloudAgentTools(CloudAgentRequest{PermissionMode: "read_only"}, true))
	for _, hidden := range []string{"ecommerce_apply_platform", "ecommerce_plan_product", "ecommerce_confirm_plan"} {
		if containsName(readOnly, hidden) {
			t.Fatalf("只读模式不得下发声计费/写工具 %s", hidden)
		}
	}
	// 强制审批门：无论权限模式，confirm_plan 都要过审批。
	if !cloudAgentWrite("ecommerce_confirm_plan") {
		t.Fatal("ecommerce_confirm_plan 必须登记为写操作（审批链判定）")
	}
	if !cloudAgentAlwaysApprove("ecommerce_confirm_plan") {
		t.Fatal("ecommerce_confirm_plan 必须进入强制审批集合（计费动作）")
	}
	if cloudAgentAlwaysApprove("ecommerce_apply_platform") {
		t.Fatal("ecommerce_apply_platform 不扣费，不应强制审批")
	}
	// 只读白名单不得漏进计费工具。
	for _, name := range []string{"ecommerce_apply_platform", "ecommerce_plan_product", "ecommerce_confirm_plan"} {
		if cloudAgentReadToolReadOnly(name) {
			t.Fatalf("%s 不是只读工具", name)
		}
	}
}

// 切平台真实执行：不扣费、槽位数随平台重建。
func TestAgentEcommerceApplyPlatform(t *testing.T) {
	svc := newAgentEcommerceService(t)
	product := &model.EcommerceProduct{
		ID: kernel.NewID(), UserID: "user-a", Name: "深睡被", Status: ecommerce.ProductStatusDraft,
		ExecutionMode: "review", TitleStatus: "pending",
	}
	if err := svc.repo.CreateEcommerceProduct(product); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.CreateEcommerceSlots([]model.EcommerceSlot{{
		ID: kernel.NewID(), ProductID: product.ID, Kind: ecommerce.SlotKindHero, SlotNo: 1,
		SlotKey: "hero_main", Title: "首屏", Status: ecommerce.SlotStatusQueued,
	}}); err != nil {
		t.Fatal(err)
	}
	args := `{"productId":"` + product.ID + `","platform":"pinduoduo"}`
	result, err := cloudAgentEcommerceApplyPlatform([]*Service{svc}, "user-a", newEcommerceToolCall("ecommerce_apply_platform", args))
	if err != nil {
		t.Fatalf("切平台失败：%v", err)
	}
	payload := result.(map[string]any)
	if payload["applied"] != "pinduoduo" {
		t.Fatalf("applied = %v，want pinduoduo", payload["applied"])
	}
	if payload["charged"] != false {
		t.Fatal("切平台不得计费")
	}
	updated, err := svc.repo.GetEcommerceProduct("user-a", product.ID)
	if err != nil {
		t.Fatal(err)
	}
	// 平台落在配置快照（cfg.Platform = spec.Key），不在商品直属字段。
	if !strings.Contains(updated.ConfigSnapshotJSON, "pinduoduo") {
		t.Fatalf("平台未落配置快照：%s", updated.ConfigSnapshotJSON)
	}
}

// 越权：他人商品不可切平台。
func TestAgentEcommerceApplyPlatformRejectsOtherUser(t *testing.T) {
	svc := newAgentEcommerceService(t)
	product := &model.EcommerceProduct{ID: kernel.NewID(), UserID: "user-a", Name: "他人商品", Status: ecommerce.ProductStatusDraft}
	if err := svc.repo.CreateEcommerceProduct(product); err != nil {
		t.Fatal(err)
	}
	args := `{"productId":"` + product.ID + `","platform":"pinduoduo"}`
	if _, err := cloudAgentEcommerceApplyPlatform([]*Service{svc}, "user-b", newEcommerceToolCall("ecommerce_apply_platform", args)); err == nil {
		t.Fatal("跨用户切平台应失败")
	}
}

// 状态门禁：running 商品不可确认派发；draft 可过门禁（到达派发层因无渠道模型报错）。
func TestAgentEcommerceConfirmPlanRejectsWrongStatus(t *testing.T) {
	svc := newAgentEcommerceService(t)
	running := &model.EcommerceProduct{
		ID: kernel.NewID(), UserID: "user-a", Name: "在途商品", Status: ecommerce.ProductStatusRunning,
		ExecutionMode: "review", TitleStatus: "pending",
	}
	if err := svc.repo.CreateEcommerceProduct(running); err != nil {
		t.Fatal(err)
	}
	args := `{"productId":"` + running.ID + `","channelId":"CHANNEL_X","model":"m"}`
	_, err := cloudAgentEcommerceConfirmPlan([]*Service{svc}, "user-a", newEcommerceToolCall("ecommerce_confirm_plan", args))
	if err == nil {
		t.Fatal("running 状态应拒绝确认派发")
	}
	if !strings.Contains(err.Error(), "仅「待确认方案/未开始」可确认派发") {
		t.Fatalf("错误文案不准确：%v", err)
	}
}

// 缺渠道模型且无派发快照时，确认派发必须在审批预演前明确报错（不带病进审批）。
func TestAgentEcommerceConfirmPlanRequiresChannelModel(t *testing.T) {
	svc := newAgentEcommerceService(t)
	draft := &model.EcommerceProduct{
		ID: kernel.NewID(), UserID: "user-a", Name: "草稿商品", Status: ecommerce.ProductStatusDraft,
		ExecutionMode: "review", TitleStatus: "pending",
	}
	if err := svc.repo.CreateEcommerceProduct(draft); err != nil {
		t.Fatal(err)
	}
	args := `{"productId":"` + draft.ID + `"}`
	_, err := cloudAgentEcommerceConfirmPlan([]*Service{svc}, "user-a", newEcommerceToolCall("ecommerce_confirm_plan", args))
	if err == nil {
		t.Fatal("缺渠道模型应报错")
	}
	if !strings.Contains(err.Error(), "缺少生图渠道与模型") {
		t.Fatalf("错误文案不准确：%v", err)
	}
}
