package app

// Agent 电商改稿工具测试：
//  1. 工具声明（正常权限下发两个、只读模式只下发只读）；
//  2. 只读工具真实执行（读商品与槽位）；
//  3. 改稿工具真实执行（复用 UpdateEcommerceSlotPrompt，不扣费）+ running 禁改纪律；
//  4. 越权保护（他人商品不可读/不可改）。

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func newAgentEcommerceService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.EcommerceUserConfig{}, &model.EcommercePreset{}, &model.EcommerceProduct{},
		&model.EcommerceSlot{}, &model.EcommerceSlotVersion{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}
}

func toolNames(tools []map[string]any) []string {
	names := make([]string, 0, len(tools))
	for _, tool := range tools {
		if fn, ok := tool["function"].(map[string]any); ok {
			names = append(names, stringValue(fn["name"]))
		}
	}
	return names
}

func containsName(names []string, want string) bool {
	for _, name := range names {
		if name == want {
			return true
		}
	}
	return false
}

// 正常权限：两个电商工具都下发。
func TestAgentEcommerceToolsDeclared(t *testing.T) {
	names := toolNames(compileCloudAgentTools(CloudAgentRequest{PermissionMode: "full"}, true))
	if !containsName(names, "ecommerce_get_product_detail") {
		t.Fatal("缺少只读工具 ecommerce_get_product_detail")
	}
	if !containsName(names, "ecommerce_update_slot_prompt") {
		t.Fatal("缺少改稿工具 ecommerce_update_slot_prompt")
	}
}

// 只读模式：只下发只读工具，改稿工具必须缺席。
func TestAgentEcommerceWriteToolHiddenInReadOnly(t *testing.T) {
	names := toolNames(compileCloudAgentTools(CloudAgentRequest{PermissionMode: "read_only"}, true))
	if !containsName(names, "ecommerce_get_product_detail") {
		t.Fatal("只读模式下仍应下发只读工具")
	}
	if containsName(names, "ecommerce_update_slot_prompt") {
		t.Fatal("只读模式不得下发改稿工具")
	}
}

// 只读工具执行：返回商品与槽位。
func TestAgentEcommerceGetProductDetail(t *testing.T) {
	svc := newAgentEcommerceService(t)
	product := &model.EcommerceProduct{
		ID: kernel.NewID(), UserID: "user-a", Name: "云感深睡被", Round: 1,
		Status: ecommerce.ProductStatusReview, SellingPoints: "抗菌",
		ExecutionMode: "review", TitleStatus: "pending",
	}
	if err := svc.repo.CreateEcommerceProduct(product); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.CreateEcommerceSlots([]model.EcommerceSlot{{
		ID: kernel.NewID(), ProductID: product.ID, Kind: ecommerce.SlotKindHero, SlotNo: 1,
		SlotKey: "hero_main", Title: "首屏", Copy: "文案", Status: ecommerce.SlotStatusQueued,
	}}); err != nil {
		t.Fatal(err)
	}
	result, err := cloudAgentEcommerceGetProductDetail([]*Service{svc}, "user-a", newEcommerceToolCall("ecommerce_get_product_detail", `{"productId":"`+product.ID+`"}`))
	if err != nil {
		t.Fatalf("只读工具执行失败：%v", err)
	}
	encoded, _ := json.Marshal(result)
	text := string(encoded)
	if !strings.Contains(text, "云感深睡被") || !strings.Contains(text, "hero_main") {
		t.Fatalf("返回内容不完整：%s", text)
	}
}

// 越权：他人商品必须读不到。
func TestAgentEcommerceGetProductDetailRejectsOtherUser(t *testing.T) {
	svc := newAgentEcommerceService(t)
	product := &model.EcommerceProduct{ID: kernel.NewID(), UserID: "user-a", Name: "他人商品", Status: ecommerce.ProductStatusDraft}
	if err := svc.repo.CreateEcommerceProduct(product); err != nil {
		t.Fatal(err)
	}
	if _, err := cloudAgentEcommerceGetProductDetail([]*Service{svc}, "user-b", newEcommerceToolCall("ecommerce_get_product_detail", `{"productId":"`+product.ID+`"}`)); err == nil {
		t.Fatal("跨用户读取应失败")
	}
}

// 改稿工具：成功改文案，且不改状态、不扣费。
func TestAgentEcommerceUpdateSlotPrompt(t *testing.T) {
	svc := newAgentEcommerceService(t)
	product := &model.EcommerceProduct{ID: kernel.NewID(), UserID: "user-a", Name: "被子", Status: ecommerce.ProductStatusDraft}
	if err := svc.repo.CreateEcommerceProduct(product); err != nil {
		t.Fatal(err)
	}
	slot := model.EcommerceSlot{
		ID: kernel.NewID(), ProductID: product.ID, Kind: ecommerce.SlotKindHero, SlotNo: 1,
		SlotKey: "hero_main", Title: "旧标题", Copy: "旧文案", Status: ecommerce.SlotStatusQueued,
		GenerationPrompt: "旧提示词",
	}
	if err := svc.repo.CreateEcommerceSlots([]model.EcommerceSlot{slot}); err != nil {
		t.Fatal(err)
	}
	args := `{"productId":"` + product.ID + `","slotId":"` + slot.ID + `","title":"新标题","copy":"新文案","prompt":"新提示词","promptOverride":""}`
	if _, err := cloudAgentEcommerceUpdateSlotPrompt([]*Service{svc}, "user-a", newEcommerceToolCall("ecommerce_update_slot_prompt", args)); err != nil {
		t.Fatalf("改稿失败：%v", err)
	}
	updated, err := svc.repo.EcommerceSlotByID(slot.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != "新标题" || updated.Copy != "新文案" || updated.GenerationPrompt != "新提示词" {
		t.Fatalf("改稿未落库：%+v", updated)
	}
	if updated.Status != ecommerce.SlotStatusQueued {
		t.Fatalf("改稿不应改变槽位状态，实际 %s", updated.Status)
	}
}

// running / uncertain 禁改纪律必须由 Agent 工具继承。
func TestAgentEcommerceUpdateSlotPromptRejectsRunning(t *testing.T) {
	svc := newAgentEcommerceService(t)
	product := &model.EcommerceProduct{ID: kernel.NewID(), UserID: "user-a", Name: "被子", Status: ecommerce.ProductStatusDraft}
	if err := svc.repo.CreateEcommerceProduct(product); err != nil {
		t.Fatal(err)
	}
	for _, status := range []string{ecommerce.SlotStatusRunning, ecommerce.SlotStatusUncertain} {
		slot := model.EcommerceSlot{
			ID: kernel.NewID(), ProductID: product.ID, Kind: ecommerce.SlotKindHero, SlotNo: 1,
			SlotKey: "hero_" + status, Title: "标题", Status: status,
		}
		if err := svc.repo.CreateEcommerceSlots([]model.EcommerceSlot{slot}); err != nil {
			t.Fatal(err)
		}
		args := `{"slotId":"` + slot.ID + `","copy":"尝试改写"}`
		if _, err := cloudAgentEcommerceUpdateSlotPrompt([]*Service{svc}, "user-a", newEcommerceToolCall("ecommerce_update_slot_prompt", args)); err == nil {
			t.Fatalf("状态 %s 应拒绝改稿", status)
		}
	}
}

// newEcommerceToolCall 构造一次工具调用（匿名函数结构体无法直接字面量初始化）。
func newEcommerceToolCall(name, arguments string) cloudAgentCall {
	call := cloudAgentCall{ID: kernel.NewID()}
	call.Function.Name = name
	call.Function.Arguments = arguments
	return call
}
