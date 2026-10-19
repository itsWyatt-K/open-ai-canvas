package app

// 返工令 B 二 真实库验收：用 bc33eb98…（抖音 3:4）7 个槽位的**真实数据**，
// 跑修复后的提示词链路，产出两份对照：
//   - 落库版（generation_prompt，只准写本屏专属描述）；
//   - 派发版（真正发往生图模型，才拼文字排版后缀 + 内部防走形护栏）。
//
// 该商品现存 generation_prompt 是返工前旧代码写的污染文本（prepareEcommerceSlot 第 2 条
// 纪律「库内已有提示词直接沿用」决定了旧数据不会被自动覆盖），所以这里演示的是
// 「同一批真实槽位在新代码下会写成什么样」，作为修复生效的证据。
//
// 默认跳过：ECOMMERCE_REAL_DB=<sqlite 路径> 时才运行，CI 不依赖本机数据。
import (
	"os"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestRealChannelSlotPromptChannelsOnRealDB(t *testing.T) {
	dbPath := os.Getenv("ECOMMERCE_REAL_DB")
	if dbPath == "" {
		t.Skip("未设置 ECOMMERCE_REAL_DB，跳过真实数据库验证")
	}
	if _, err := os.Stat(dbPath); err != nil {
		t.Skipf("真实数据库不存在：%v", err)
	}
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("打开真实数据库失败：%v", err)
	}
	svc := &Service{repo: repository.New(db)}

	var product model.EcommerceProduct
	if err := db.Where("id = ?", "bc33eb98160120b8abfb37db531ef7cb").First(&product).Error; err != nil {
		t.Skipf("真实数据库中没有目标商品：%v", err)
	}
	var slots []model.EcommerceSlot
	if err := db.Where("product_id = ?", product.ID).Order("kind DESC, slot_no").Find(&slots).Error; err != nil {
		t.Fatal(err)
	}
	if len(slots) == 0 {
		t.Skip("目标商品没有槽位")
	}
	t.Logf("商品：%s（user=%s，平台=%s）", product.Name, product.UserID, svc.ecommercePlatformKey(product.UserID))

	const guardrail = "保持主体结构、颜色、比例、材质和可见细节稳定"
	const copyTypeset = "画面预留干净排版区"
	const pureImage = "画面纯图无文字"

	for index := range slots {
		slot := slots[index]
		spec := ecommerce.PlatformSpecOrDefault(svc.ecommercePlatformKey(product.UserID))
		plan := ecommerce.SlotPlan{
			SlotKey: slot.SlotKey, Kind: slot.Kind, SlotNo: slot.SlotNo,
			Title: slot.Title, Scene: slot.SceneType, Variant: slot.SceneType,
			Aspect: firstNonEmpty(strings.TrimSpace(slot.AspectRatio), spec.HeroRatio),
			Copy:   slot.Copy,
		}
		// 落库版：只准有本屏专属描述（平台模板兜底线，等价于「库里没有提示词」时的产物）。
		clean := ecommerce.ComposeSlotFallbackPrompt(ecommerce.SlotPromptContext{
			ProductName:       product.Name,
			SellingPoints:     product.SellingPoints,
			ExtraRequirements: product.ExtraRequirements,
			SlotTitle:         firstNonEmpty(slot.Title, plan.Title),
			SlotSceneType:     firstNonEmpty(slot.SceneType, plan.Variant),
			PlatformKey:       spec.Key,
			Aspect:            plan.Aspect,
		})
		// 派发版：纯净 + 文案排版后缀 + 内部护栏（只走模型，不落库）。
		textMode := svc.ecommerceSlotTextMode(product.UserID, firstNonEmpty(slot.Kind, plan.Kind))
		dispatch := buildEcommerceDispatchPrompt(clean, firstNonEmpty(slot.Copy, plan.Copy), textMode, "")

		t.Logf("\n=== %s（%s %d/%d，比例 %s，textMode=%s）落库版 ===\n%s",
			slot.SlotKey, slot.Kind, slot.SlotNo, len(slots), plan.Aspect, textMode, clean)
		t.Logf("--- %s 派发版（发往模型，含护栏与排版后缀）---\n%s", slot.SlotKey, dispatch)

		for _, forbidden := range []string{guardrail, copyTypeset, pureImage} {
			if strings.Contains(clean, forbidden) {
				t.Errorf("%s 落库版严禁包含 %q", slot.SlotKey, forbidden)
			}
		}
		if !strings.Contains(dispatch, guardrail) {
			t.Errorf("%s 派发版必须带内部防走形护栏", slot.SlotKey)
		}
		if slot.Copy == "" || strings.EqualFold(textMode, ecommerce.TextModeNone) {
			if !strings.Contains(dispatch, pureImage) {
				t.Errorf("%s 空文案/none 模式应走「%s」", slot.SlotKey, pureImage)
			}
		} else if !strings.Contains(dispatch, copyTypeset) {
			t.Errorf("%s 有文案且非 none 应走「%s」", slot.SlotKey, copyTypeset)
		}
	}
}
