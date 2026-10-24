package app

import (
	"context"
	"strings"
	"testing"

	"gorm.io/gorm"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/workbench"
)

// 电商工坊离线全链路状态机回归（阶段 4 验收第三条的离线可复现版本）。
//
// 本机没有可用的生图模型，真实 HTTP 取证只能走到「确认 → 派发前」。
// 这里改用「受控注入画布子任务终态」的方式，把对账（reconcile）之后的
// 整条状态流转跑通，覆盖：
//   导入 → 预建 7 张 draft 卡（不计费）
//        → 确认方案 → 7 条 canvas_image 子任务派发 → running
//        → 子任务陆续成功 → 对账回写槽位 → 进度/完成态
//        → 中途「停止生成」→ 在途槽位 paused + 商品退回 review（强制脱困）
//        → 重新确认 → 仅重新派发未完成槽位（已完成不重复计费）
//        → 单屏失败 → 失败原因带到详情（不再假装"排队中"）
//
// 断言口径全部基于「落库后的真实状态」，不 mock 编排器本身。

// newEcommerceLifecycleService 在 creationTestService 的全量迁移库上，
// 补一个受控的图片能力系统渠道（grok-image，价格 1 微积分），
// 让编排器能真实走到 CreateTask 而不需要任何外部网络。
func newEcommerceLifecycleService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	// 电商表不在 database.Models() 里（55 号表走独立迁移），这里按 DDL 补齐。
	if err := db.AutoMigrate(
		&model.EcommerceProduct{},
		&model.EcommerceSlot{},
		&model.EcommerceSlotVersion{},
		&model.EcommerceUserConfig{},
		&model.EcommercePreset{},
	); err != nil {
		t.Fatal(err)
	}
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	for _, row := range []any{
		&model.ChannelModel{
			ID: "ecom-image-cm", ChannelID: "channel", ModelKey: "grok-image", DisplayName: "电商生图",
			Capability: "image", Protocol: model.ChannelInterfaceGrokImage,
			CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability),
			BillingMode:          "fixed_request", PriceConfigured: true, Enabled: true,
		},
		&model.ChannelModelPriceTier{
			ID: "ecom-image-tier", ChannelModelID: "ecom-image-cm",
			SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request",
			UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true,
		},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 上游 54 号表（内置电商工具/预设铁律段）：生产由 EnsureBuiltinCatalog 播种。
	// 这里播同一份种子，否则 nxf 不可用时编排器拿不到降级模板，槽位只能失败。
	if err := workbench.New(s.repo, nil, nil).EnsureBuiltinCatalog(); err != nil {
		t.Fatalf("播种上游内置工作台目录失败: %v", err)
	}
	return s, db
}

// markLifecyclePlanned 把商品标记为「已跑过 AI 视觉策划」。
//
// 阶段 5 整改后，ConfirmEcommercePlan / StartEcommerceProduct 有前置守卫：没策划过的
// 空壳槽位不许直接生图。这三个生命周期测试关心的是派发/对账/停止恢复，不是策划本身，
// 所以在这里按「已策划」前置，让守卫放行（守卫自身有专项测试覆盖）。
func markLifecyclePlanned(t *testing.T, s *Service, productID string) {
	t.Helper()
	product, err := s.repo.GetEcommerceProduct("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.repo.UpdateEcommerceProductRun("user", productID, product.Status, product.TitleStatus, "", product.PlanRevision+1); err != nil {
		t.Fatal(err)
	}
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		t.Fatal(err)
	}
	planned := "整组视觉方向：测试用极简科技风\n\n统一配色：白 + 冰川蓝\n\n统一光影：柔光箱冷白光\n\n" +
		"统一字体：无衬线粗体\n\n产品与主体：产品居中\n\n镜头与构图：特写竖构图\n\n环境与道具：纯色背景\n\n" +
		"光线与质感：干净高光\n\n色彩与材质：磨砂白\n\n文字与留白：顶部标题区\n\n卖点的视觉表达：结构可见\n\n本屏差异与连续性：本屏独立景别"
	for _, slot := range slots {
		if err := s.repo.UpdateEcommerceSlotPlan(slot.ID, map[string]any{"generation_prompt": planned}); err != nil {
			t.Fatal(err)
		}
	}
}

// importLifecycleProduct 建一张源图并导入商品（导入即应预建槽位卡）。
func importLifecycleProduct(t *testing.T, s *Service, name string) string {
	t.Helper()
	resource := &model.Resource{
		ID: kernel.NewID(), UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png",
	}
	if err := s.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	created, _, err := s.ImportEcommerceProducts("user", []ImportItem{{ResourceID: resource.ID, Name: name}})
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 1 {
		t.Fatalf("导入应建 1 件商品，实际 %d", len(created))
	}
	markLifecyclePlanned(t, s, created[0].ID)
	return created[0].ID
}

// confirmLifecycleProduct 走「确认各屏参数并开始生图」主按钮。
func confirmLifecycleProduct(t *testing.T, s *Service, productID string) *ProductDetail {
	t.Helper()
	detail, err := s.ConfirmEcommercePlan(context.Background(), "user", productID, EcommerceStartOptions{
		ChannelID: "channel", Model: "grok-image",
	})
	if err != nil {
		t.Fatalf("确认方案应成功: %v", err)
	}
	return detail
}

// lifecycleChildTasks 取该商品当前版本实际派发出去的画布子任务。
func lifecycleChildTasks(t *testing.T, s *Service, productID string) []model.Task {
	t.Helper()
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		t.Fatal(err)
	}
	tasks := make([]model.Task, 0, len(slots))
	for _, slot := range slots {
		versions, err := s.repo.ListEcommerceSlotVersions(slot.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(versions) == 0 || strings.TrimSpace(versions[0].ChildTaskID) == "" {
			continue
		}
		task, err := s.repo.TaskForUser("user", versions[0].ChildTaskID)
		if err != nil {
			t.Fatalf("取子任务失败: %v", err)
		}
		tasks = append(tasks, *task)
	}
	return tasks
}

// countLifecycleImageTasks 统计库中 canvas_image 子任务总数（计费口径代理指标）。
func countLifecycleImageTasks(t *testing.T, db *gorm.DB) int64 {
	t.Helper()
	var total int64
	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&total).Error; err != nil {
		t.Fatal(err)
	}
	return total
}

// settleLifecycleChildTask 注入子任务终态（模拟云端回执）。
func settleLifecycleChildTask(t *testing.T, db *gorm.DB, taskID string, succeeded bool, resourceID, stage string) {
	t.Helper()
	updates := map[string]any{"progress": 100}
	if succeeded {
		updates["status"] = string(model.TaskStatusSucceeded)
		updates["result_json"] = `{"images":[{"resourceId":"` + resourceID + `"}]}`
	} else {
		updates["status"] = string(model.TaskStatusFailed)
		updates["stage"] = stage
	}
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(updates).Error; err != nil {
		t.Fatal(err)
	}
}

// seedLifecycleGeneratedResource 为成功子任务落一条产物资源（更贴近真实对账）。
func seedLifecycleGeneratedResource(t *testing.T, s *Service, resourceID string) {
	t.Helper()
	if err := s.repo.CreateResource(&model.Resource{
		ID: resourceID, UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png",
	}); err != nil {
		t.Fatal(err)
	}
}

// lifecycleActiveTaskLimit 取平台在途任务上限（派发波次口径）。
// 不写死 5：跟随运行策略，策略变更时测试自动适配。
func lifecycleActiveTaskLimit(t *testing.T, s *Service) int {
	t.Helper()
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatalf("读取运行策略失败: %v", err)
	}
	return int(policy.Task.ActiveTaskLimit)
}

// TestEcommerceLifecycle_导入到全部完成 覆盖动线主路径：
// 导入后 7 张 draft 卡且**零计费**；确认后按在途上限（默认 5）派发首波，
// 其余屏顺延；对账（Sync）在容量释放后自动补派；全部成功后商品 completed。
func TestEcommerceLifecycle_导入到全部完成(t *testing.T) {
	s, db := newEcommerceLifecycleService(t)
	limit := lifecycleActiveTaskLimit(t, s)
	productID := importLifecycleProduct(t, s, "夏季纯棉T恤.png")

	// 1) 导入即预建槽位卡：draft 态、无子任务、无计费。
	detail, err := s.EcommerceProductDetail("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if detail.Product.Status != ecommerce.ProductStatusDraft {
		t.Fatalf("导入后商品应为 draft，实际 %s", detail.Product.Status)
	}
	if len(detail.Slots) != 7 {
		t.Fatalf("导入应预建 7 张槽位卡，实际 %d", len(detail.Slots))
	}
	for _, slot := range detail.Slots {
		if slot.Status != ecommerce.SlotStatusDraft {
			t.Fatalf("槽位 %s 导入后应为 draft，实际 %s", slot.SlotKey, slot.Status)
		}
	}
	if got := countLifecycleImageTasks(t, db); got != 0 {
		t.Fatalf("未确认前不应派发任何子任务，实际 %d 条", got)
	}

	// 2) 确认方案 → 首波按在途上限派发，超出屏顺延（不判失败）。
	confirmed := confirmLifecycleProduct(t, s, productID)
	if confirmed.Product.Status != ecommerce.ProductStatusRunning {
		t.Fatalf("确认后商品应为 running，实际 %s", confirmed.Product.Status)
	}
	firstWave := lifecycleChildTasks(t, s, productID)
	if len(firstWave) != limit {
		t.Fatalf("首波应按在途上限派发 %d 条子任务，实际 %d", limit, len(firstWave))
	}
	for _, task := range firstWave {
		if task.Type != "canvas_image" {
			t.Fatalf("子任务类型应为 canvas_image，实际 %s", task.Type)
		}
	}
	if got := countLifecycleImageTasks(t, db); got != int64(limit) {
		t.Fatalf("确认后库中应有 %d 条 canvas_image 任务，实际 %d", limit, got)
	}
	// 顺延屏保持 draft/pending 且无版本——「排队已满」不是「生成失败」。
	deferred := 0
	for _, slot := range confirmed.Slots {
		switch slot.Status {
		case ecommerce.SlotStatusQueued:
		case ecommerce.SlotStatusDraft, ecommerce.SlotStatusPending:
			deferred++
			if slot.CurrentVersion != 0 {
				t.Fatalf("顺延屏 %s 不应有派发版本，实际 %d", slot.SlotKey, slot.CurrentVersion)
			}
		default:
			t.Fatalf("顺延屏 %s 状态应为 draft/pending，实际 %s", slot.SlotKey, slot.Status)
		}
	}
	if deferred != 7-limit {
		t.Fatalf("应有 %d 屏顺延，实际 %d", 7-limit, deferred)
	}

	// 3) 首波全部成功 → 对账 → 容量释放 → 自动补派剩余屏。
	for _, task := range firstWave {
		resourceID := kernel.NewID()
		seedLifecycleGeneratedResource(t, s, resourceID)
		settleLifecycleChildTask(t, db, task.ID, true, resourceID, "")
	}
	mid, err := s.SyncEcommerceProduct("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	secondWave := lifecycleChildTasks(t, s, productID)
	if len(secondWave) != 7 {
		t.Fatalf("对账后应补派至 7 条子任务，实际 %d", len(secondWave))
	}
	if got := countLifecycleImageTasks(t, db); got != 7 {
		t.Fatalf("补派后库中应有 7 条 canvas_image 任务，实际 %d", got)
	}
	if mid.Product.Status != ecommerce.ProductStatusRunning {
		t.Fatalf("补派后商品应仍为 running，实际 %s", mid.Product.Status)
	}

	// 4) 第二波全部成功 → 对账 → 商品 completed。
	dispatched := map[string]bool{}
	for _, task := range firstWave {
		dispatched[task.ID] = true
	}
	for _, task := range secondWave {
		if dispatched[task.ID] {
			continue
		}
		resourceID := kernel.NewID()
		seedLifecycleGeneratedResource(t, s, resourceID)
		settleLifecycleChildTask(t, db, task.ID, true, resourceID, "")
	}
	final, err := s.SyncEcommerceProduct("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if final.Product.Status != ecommerce.ProductStatusCompleted {
		t.Fatalf("全部成功后商品应为 completed，实际 %s", final.Product.Status)
	}
	for _, slot := range final.Slots {
		if slot.Status != ecommerce.SlotStatusCompleted {
			t.Fatalf("槽位 %s 应为 completed，实际 %s", slot.SlotKey, slot.Status)
		}
		if slot.ResourceID == "" {
			t.Fatalf("已完成槽位 %s 应回写产物资源", slot.SlotKey)
		}
		if slot.ErrorMessage != "" {
			t.Fatalf("成功槽位 %s 不应带错误信息: %s", slot.SlotKey, slot.ErrorMessage)
		}
	}
}

// TestEcommerceLifecycle_停止脱困与恢复派发 覆盖阶段 4 的「停止生成」：
// 在途槽位 → paused、商品退回 review（可改参数）；再次确认只补派未完成屏。
func TestEcommerceLifecycle_停止脱困与恢复派发(t *testing.T) {
	s, db := newEcommerceLifecycleService(t)
	productID := importLifecycleProduct(t, s, "便携保温杯.png")
	confirmLifecycleProduct(t, s, productID)

	// 首波 = 在途上限；其余屏顺延。
	tasks := lifecycleChildTasks(t, s, productID)
	if len(tasks) == 0 {
		t.Fatal("应已派发首波子任务")
	}
	// 前 3 条成功，其余仍在途。
	for _, task := range tasks[:3] {
		resourceID := kernel.NewID()
		seedLifecycleGeneratedResource(t, s, resourceID)
		settleLifecycleChildTask(t, db, task.ID, true, resourceID, "")
	}
	mid, err := s.SyncEcommerceProduct("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if mid.Product.Status != ecommerce.ProductStatusRunning {
		t.Fatalf("部分完成时商品应仍为 running，实际 %s", mid.Product.Status)
	}
	// 对账后顺延屏已自动补派：累计 7 条。
	if got := countLifecycleImageTasks(t, db); got != 7 {
		t.Fatalf("对账补派后应累计 7 条子任务，实际 %d", got)
	}

	// 停止生成：在途槽位 → paused，商品退回 review（前端解锁）。
	if _, err := s.PauseEcommerceProduct(context.Background(), "user", productID); err != nil {
		t.Fatal(err)
	}
	paused, err := s.EcommerceProductDetail("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if paused.Product.Status != ecommerce.ProductStatusReview {
		t.Fatalf("停止后商品应退回 review，实际 %s", paused.Product.Status)
	}
	completedCount, pausedCount := 0, 0
	for _, slot := range paused.Slots {
		switch slot.Status {
		case ecommerce.SlotStatusCompleted:
			completedCount++
		case ecommerce.SlotStatusPaused:
			pausedCount++
		default:
			t.Fatalf("停止后槽位 %s 状态异常: %s", slot.SlotKey, slot.Status)
		}
	}
	if completedCount != 3 || pausedCount != 4 {
		t.Fatalf("停止后应 3 完成 + 4 暂停，实际 %d + %d", completedCount, pausedCount)
	}
	// 记录已完成的 3 屏产物，恢复派发后必须原样保留（不重复计费、不覆盖产物）。
	preserved := map[string]string{}
	for _, slot := range paused.Slots {
		if slot.Status == ecommerce.SlotStatusCompleted {
			preserved[slot.SlotKey] = slot.ResourceID
		}
	}
	// 停止后对账不得把商品推回 running（paused 不算在途）。
	afterStop, err := s.SyncEcommerceProduct("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if afterStop.Product.Status != ecommerce.ProductStatusReview {
		t.Fatalf("停止后对账不应把商品推回运行态，实际 %s", afterStop.Product.Status)
	}

	// 重新确认：只补派未完成屏，已完成屏不重复计费。
	// 容量口径：停止时 4 条旧任务未取消（云端已收费请求正常收尾），仍占在途
	// 名额 → 剩余容量 1，本轮只补派 1 条；其余屏等旧任务对账收尾后自动补派
	// 或直接采用旧任务产物（不为同一屏重复计费）。
	before := countLifecycleImageTasks(t, db)
	resumed := confirmLifecycleProduct(t, s, productID)
	if resumed.Product.Status != ecommerce.ProductStatusRunning {
		t.Fatalf("恢复派发后商品应为 running，实际 %s", resumed.Product.Status)
	}
	if got := countLifecycleImageTasks(t, db) - before; got != 1 {
		t.Fatalf("恢复派发应按剩余容量补派 1 条，实际 %d", got)
	}
	for _, slot := range resumed.Slots {
		expected, ok := preserved[slot.SlotKey]
		if !ok {
			continue
		}
		if slot.ResourceID != expected {
			t.Fatalf("已完成屏 %s 的产物被恢复派发覆盖：%s → %s", slot.SlotKey, expected, slot.ResourceID)
		}
	}

	// 收尾：把「当前版本」的子任务全部置终态（新补派的 + 旧任务正常收尾），
	// 对账后全部屏 completed，商品 completed。旧 paused 任务的产物同样被对账
	// 采纳——已付费请求的结果不丢弃、不重买。
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		t.Fatal(err)
	}
	for _, slot := range slots {
		if slot.Status == ecommerce.SlotStatusCompleted {
			continue
		}
		versions, err := s.repo.ListEcommerceSlotVersions(slot.ID)
		if err != nil {
			t.Fatal(err)
		}
		if len(versions) == 0 {
			continue
		}
		resourceID := kernel.NewID()
		seedLifecycleGeneratedResource(t, s, resourceID)
		settleLifecycleChildTask(t, db, versions[0].ChildTaskID, true, resourceID, "")
	}
	final, err := s.SyncEcommerceProduct("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if final.Product.Status != ecommerce.ProductStatusCompleted {
		t.Fatalf("恢复后全部成功应为 completed，实际 %s", final.Product.Status)
	}
	for _, slot := range final.Slots {
		if slot.Status != ecommerce.SlotStatusCompleted {
			t.Fatalf("槽位 %s 最终应为 completed，实际 %s", slot.SlotKey, slot.Status)
		}
		if slot.ResourceID == "" {
			t.Fatalf("最终槽位 %s 应有产物资源", slot.SlotKey)
		}
	}
	// 恢复后不再产生新的重派：库内 canvas_image 任务数仍是 8 条
	//（7 首发 + 1 容量内补派；其余 3 屏直接采纳旧任务产物，未重复计费）。
	if got := countLifecycleImageTasks(t, db); got != 8 {
		t.Fatalf("整轮结束应累计 8 条 canvas_image 子任务（7 首发 + 1 补派），实际 %d", got)
	}
}

// TestEcommerceLifecycle_单屏失败暴露原因 覆盖阶段 4「失败槽位显示 errorMessage」：
// 失败原因必须落到详情，商品如实转 failed，不假装"排队中"；
// 同时验证顺延屏不被误判失败，且对账后按容量自动补派。
func TestEcommerceLifecycle_单屏失败暴露原因(t *testing.T) {
	s, db := newEcommerceLifecycleService(t)
	limit := lifecycleActiveTaskLimit(t, s)
	productID := importLifecycleProduct(t, s, "无线蓝牙耳机.png")
	confirmLifecycleProduct(t, s, productID)

	tasks := lifecycleChildTasks(t, s, productID)
	if len(tasks) != limit {
		t.Fatalf("首波应派发 %d 条子任务，实际 %d", limit, len(tasks))
	}
	settleLifecycleChildTask(t, db, tasks[0].ID, false, "", "上游返回 429 限流，请稍后重试")

	failed, err := s.SyncEcommerceProduct("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if failed.Product.Status != ecommerce.ProductStatusFailed {
		t.Fatalf("存在失败屏时商品应为 failed，实际 %s", failed.Product.Status)
	}
	failedSlots, queued, deferred := 0, 0, 0
	for _, slot := range failed.Slots {
		switch slot.Status {
		case ecommerce.SlotStatusFailed:
			failedSlots++
			if !strings.Contains(slot.ErrorMessage, "429") {
				t.Fatalf("失败屏 %s 应带回真实失败原因，实际 %q", slot.SlotKey, slot.ErrorMessage)
			}
		case ecommerce.SlotStatusQueued:
			queued++
		case ecommerce.SlotStatusDraft, ecommerce.SlotStatusPending:
			deferred++
		default:
			t.Fatalf("槽位 %s 状态异常: %s", slot.SlotKey, slot.Status)
		}
	}
	if failedSlots != 1 {
		t.Fatalf("应恰好 1 屏失败，实际 %d", failedSlots)
	}
	// 对账后按容量补派了 1 屏（在途 limit-1 → 空出 1 名额），其余仍顺延。
	if queued != limit {
		t.Fatalf("在途+补派后应有 %d 屏 queued，实际 %d", limit, queued)
	}
	if deferred != 7-limit-1 {
		t.Fatalf("应剩余 %d 屏顺延（draft/pending），实际 %d", 7-limit-1, deferred)
	}
}

// TestEcommerceLifecycle_失败态顺延补派 覆盖返工令 B 遗留 3：
// failed 商品落库后的**下一次对账**仍须为顺延屏补派。
// 此前的守卫只放行 running/queued——第一次对账时 DB 商品态还是 running 能侥幸
// 补派一轮；状态落库为 failed 后，后续对账全部被拦，顺延屏永远卡在 draft。
func TestEcommerceLifecycle_失败态顺延补派(t *testing.T) {
	s, db := newEcommerceLifecycleService(t)
	limit := lifecycleActiveTaskLimit(t, s)
	productID := importLifecycleProduct(t, s, "智能恒温壶.png")
	confirmLifecycleProduct(t, s, productID)

	tasks := lifecycleChildTasks(t, s, productID)
	if len(tasks) != limit {
		t.Fatalf("首波应派发 %d 条子任务，实际 %d", limit, len(tasks))
	}
	// 第一次对账：只释放 1 个名额（1 屏失败）→ 补派 1 屏，商品转 failed 落库，
	// 仍剩 1 屏顺延（7-limit>1 时）或恰好补完（7-limit==1 时）。
	settleLifecycleChildTask(t, db, tasks[0].ID, false, "", "上游返回 429 限流")
	first, err := s.SyncEcommerceProduct("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if first.Product.Status != ecommerce.ProductStatusFailed {
		t.Fatalf("存在失败屏时商品应为 failed，实际 %s", first.Product.Status)
	}
	afterFirst := countLifecycleImageTasks(t, db)
	if afterFirst <= int64(limit) {
		t.Fatalf("第一次对账应按释放的名额补派（任务数 %d → 应大于 %d）", limit, limit)
	}

	// 第二次对账前的准备：再释放 2 个名额（2 屏成功）。
	// 此时商品在 DB 中已是 failed——这正是旧守卫的盲区：
	// 若仍有顺延屏，必须继续被补派。
	inFlight := make([]model.Task, 0)
	for _, task := range tasks[1:] {
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			inFlight = append(inFlight, task)
		}
	}
	settleCount := 2
	if len(inFlight) < settleCount {
		settleCount = len(inFlight)
	}
	for _, task := range inFlight[:settleCount] {
		resourceID := kernel.NewID()
		seedLifecycleGeneratedResource(t, s, resourceID)
		settleLifecycleChildTask(t, db, task.ID, true, resourceID, "")
	}
	before := countLifecycleImageTasks(t, db)
	second, err := s.SyncEcommerceProduct("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	after := countLifecycleImageTasks(t, db)
	// 失败屏保持 failed（不自动重发）；对账后不应再有卡死的 draft/pending 顺延屏。
	failedSlots, stuck := 0, 0
	for _, slot := range second.Slots {
		switch slot.Status {
		case ecommerce.SlotStatusFailed:
			failedSlots++
		case ecommerce.SlotStatusDraft, ecommerce.SlotStatusPending:
			stuck++
		}
	}
	if failedSlots != 1 {
		t.Fatalf("失败屏应保持 1 屏（不自动重发），实际 %d", failedSlots)
	}
	if stuck != 0 && after <= before {
		t.Fatalf("仍有 %d 屏卡在 draft/pending 且未发生补派（任务数 %d → %d）", stuck, before, after)
	}
}
