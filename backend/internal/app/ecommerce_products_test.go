package app

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// B4 商品任务 service 测试（SQLite 内存库；Task 7 规格逐条）。

func newEcommerceProductsTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Resource{},
		&model.EcommerceProduct{},
		&model.EcommerceSlot{},
		&model.EcommerceSlotVersion{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}
}

func seedEcommerceResource(t *testing.T, svc *Service, userID, name string) string {
	t.Helper()
	resource := &model.Resource{ID: kernel.NewID(), UserID: userID, Kind: "image", Status: "ready"}
	if err := svc.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	return resource.ID
}

// importItem 构造导入项（名称走前端传入的文件名）。
func importItem(resourceID, name string) ImportItem {
	return ImportItem{ResourceID: resourceID, Name: name}
}

func TestImportEcommerceProducts_新建与跳过(t *testing.T) {
	svc := newEcommerceProductsTestService(t)
	resourceA := seedEcommerceResource(t, svc, "user-a", "水杯主图.png")
	resourceB := seedEcommerceResource(t, svc, "user-a", "蓝牙耳机.png")
	resourceC := seedEcommerceResource(t, svc, "user-b", "他人商品图.png")

	// 首次导入两条
	created, skipped, err := svc.ImportEcommerceProducts("user-a", []ImportItem{importItem(resourceA, "水杯主图.png"), importItem(resourceB, "蓝牙耳机.png")})
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 2 || len(skipped) != 0 {
		t.Fatalf("首次应全建: created=%d skipped=%d", len(created), len(skipped))
	}
	if created[0].Name != "水杯主图" {
		t.Fatalf("名称应取前端传入文件名（去扩展名）: %q", created[0].Name)
	}
	// 重复导入同源 → 跳过
	created, skipped, err = svc.ImportEcommerceProducts("user-a", []ImportItem{importItem(resourceA, "水杯主图.png")})
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 0 || len(skipped) != 1 {
		t.Fatalf("重复应跳过: created=%d skipped=%d", len(created), len(skipped))
	}
	// 他人资源 → 跳过（无权限）
	created, skipped, err = svc.ImportEcommerceProducts("user-a", []ImportItem{importItem(resourceC, "他人商品图.png")})
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 0 || len(skipped) != 1 {
		t.Fatalf("他人资源应跳过: created=%d skipped=%d", len(created), len(skipped))
	}
	// 空入参 → 400
	if _, _, err := svc.ImportEcommerceProducts("user-a", nil); err == nil {
		t.Fatal("空入参应报错")
	}
}

func TestListEcommerceProducts_过滤与聚合(t *testing.T) {
	svc := newEcommerceProductsTestService(t)
	resourceA := seedEcommerceResource(t, svc, "user-a", "商品A.png")
	resourceB := seedEcommerceResource(t, svc, "user-a", "商品B.png")
	if _, _, err := svc.ImportEcommerceProducts("user-a", []ImportItem{importItem(resourceA, "商品A.png"), importItem(resourceB, "商品B.png")}); err != nil {
		t.Fatal(err)
	}
	// 建两个槽位（一完成一在途）验证进度聚合
	productA, err := svc.repo.FindEcommerceProductBySource("user-a", resourceA)
	if err != nil {
		t.Fatal(err)
	}
	now := productA.CreatedAt
	if err := svc.repo.DB().Create(&model.EcommerceSlot{ID: kernel.NewID(), ProductID: productA.ID, Kind: "hero", SlotNo: 1, SlotKey: "hero-01", Status: "completed", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.DB().Create(&model.EcommerceSlot{ID: kernel.NewID(), ProductID: productA.ID, Kind: "hero", SlotNo: 2, SlotKey: "hero-02", Status: "running", CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}

	items, total, err := svc.ListEcommerceProducts("user-a", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if total != 2 || len(items) != 2 {
		t.Fatalf("列表应 2 条: %d", total)
	}
	var summary *ProductSummary
	for i := range items {
		if items[i].ID == productA.ID {
			summary = &items[i]
		}
	}
	if summary == nil {
		t.Fatal("未找到商品A")
	}
	if summary.HeroTotal != 2 || summary.HeroDone != 1 {
		t.Fatalf("进度聚合错误: %d/%d", summary.HeroDone, summary.HeroTotal)
	}
	// 状态过滤：全部是 draft
	items, _, err = svc.ListEcommerceProducts("user-a", "", "draft")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 {
		t.Fatalf("draft 过滤应 2 条: %d", len(items))
	}
	// 搜索过滤
	items, _, err = svc.ListEcommerceProducts("user-a", "商品B", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Name != "商品B" {
		t.Fatalf("搜索过滤错误: %+v", items)
	}
	// 他人不可见
	items, total, err = svc.ListEcommerceProducts("user-b", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if total != 0 {
		t.Fatalf("他人应不可见: %d", total)
	}
}

func TestEcommerceProductDetail_他人NotFound(t *testing.T) {
	svc := newEcommerceProductsTestService(t)
	resourceA := seedEcommerceResource(t, svc, "user-a", "商品A.png")
	if _, _, err := svc.ImportEcommerceProducts("user-a", []ImportItem{importItem(resourceA, "商品A.png")}); err != nil {
		t.Fatal(err)
	}
	product, err := svc.repo.FindEcommerceProductBySource("user-a", resourceA)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EcommerceProductDetail("user-a", product.ID); err != nil {
		t.Fatalf("本人详情应可读: %v", err)
	}
	if _, err := svc.EcommerceProductDetail("user-b", product.ID); err == nil {
		t.Fatal("他人详情应 NotFound")
	}
}

func TestRenameEcommerceProduct_已开始禁止改名(t *testing.T) {
	svc := newEcommerceProductsTestService(t)
	resourceA := seedEcommerceResource(t, svc, "user-a", "商品A.png")
	if _, _, err := svc.ImportEcommerceProducts("user-a", []ImportItem{importItem(resourceA, "商品A.png")}); err != nil {
		t.Fatal(err)
	}
	product, err := svc.repo.FindEcommerceProductBySource("user-a", resourceA)
	if err != nil {
		t.Fatal(err)
	}
	// draft 可改
	if err := svc.RenameEcommerceProduct("user-a", product.ID, "新名字"); err != nil {
		t.Fatal(err)
	}
	// 改为 running 后禁止
	if err := svc.repo.DB().Model(&model.EcommerceProduct{}).Where("id = ?", product.ID).Update("status", "running").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.RenameEcommerceProduct("user-a", product.ID, "又改"); err == nil {
		t.Fatal("已开始任务应禁止改名")
	}
}

func TestDeleteEcommerceProducts_在途拒绝(t *testing.T) {
	svc := newEcommerceProductsTestService(t)
	resourceA := seedEcommerceResource(t, svc, "user-a", "商品A.png")
	resourceB := seedEcommerceResource(t, svc, "user-a", "商品B.png")
	if _, _, err := svc.ImportEcommerceProducts("user-a", []ImportItem{importItem(resourceA, "商品A.png"), importItem(resourceB, "商品B.png")}); err != nil {
		t.Fatal(err)
	}
	productA, _ := svc.repo.FindEcommerceProductBySource("user-a", resourceA)
	productB, _ := svc.repo.FindEcommerceProductBySource("user-a", resourceB)
	// A 设 running（在途）→ 拒绝；B 保持 draft → 可删
	if err := svc.repo.DB().Model(&model.EcommerceProduct{}).Where("id = ?", productA.ID).Update("status", "running").Error; err != nil {
		t.Fatal(err)
	}
	refused, err := svc.DeleteEcommerceProducts("user-a", []string{productA.ID, productB.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := refused[productA.ID]; !ok {
		t.Fatal("在途任务应被拒绝")
	}
	if _, ok := refused[productB.ID]; ok {
		t.Fatal("draft 任务不应被拒绝")
	}
	_, total, _ := svc.ListEcommerceProducts("user-a", "", "")
	if total != 1 {
		t.Fatalf("删除后应剩 1 条: %d", total)
	}
}
