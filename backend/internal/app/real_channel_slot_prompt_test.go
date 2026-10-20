package app

// 阶段 5 整改 · 真实库验收：用 bc33eb98…（抖音 3:4）7 个槽位的**真实数据**，
// 跑整改后的提示词链路，产出两份对照：
//   - 落库版（generation_prompt：12 段视觉方案或降级场景描述，不含任何排版/禁字指令）；
//   - 派发版（PR 合同：制作说明 + 参考图用途 + 产品/卖点 + 12 段方案 + 本屏场景/卖点
//     + 【画面文字与海报排版硬性要求】 + 收口约束）。
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
	platformKey := svc.ecommercePlatformKey(product.UserID)
	spec := ecommerce.PlatformSpecOrDefault(platformKey)
	t.Logf("商品：%s（平台=%s）", product.Name, platformKey)

	for index := range slots {
		slot := slots[index]
		plan := ecommerce.SlotPlan{
			SlotKey: slot.SlotKey, Kind: slot.Kind, SlotNo: slot.SlotNo,
			Title: slot.Title, Scene: slot.SceneType, Variant: slot.SceneType,
			Aspect: firstNonEmpty(strings.TrimSpace(slot.AspectRatio), spec.HeroRatio),
			Copy:   slot.Copy,
		}
		// 落库版：库里已有 12 段方案就用它；否则走平台兜底（等价于「库里没有提示词」）。
		clean := strings.TrimSpace(slot.GenerationPrompt)
		if clean == "" {
			clean = ecommerce.ComposeSlotFallbackPrompt(ecommerce.SlotPromptContext{
				ProductName:       product.Name,
				SellingPoints:     product.SellingPoints,
				ExtraRequirements: product.ExtraRequirements,
				SlotTitle:         firstNonEmpty(slot.Title, plan.Title),
				SlotSceneType:     firstNonEmpty(slot.SceneType, plan.Variant),
				PlatformKey:       spec.Key,
				Aspect:            plan.Aspect,
			})
		}
		textMode := svc.ecommerceSlotTextMode(product.UserID, firstNonEmpty(slot.Kind, plan.Kind))
		dispatch := buildEcommerceSlotPrompt(ecommerceSlotPromptInput{
			PlatformName:      spec.Name,
			SlotTitle:         firstNonEmpty(slot.Title, plan.Title, "商品展示"),
			SlotNo:            slot.SlotNo,
			Kind:              firstNonEmpty(slot.Kind, plan.Kind),
			ProductName:       product.Name,
			ProductSelling:    product.SellingPoints,
			VisualPlan:        clean,
			SceneType:         firstNonEmpty(slot.SceneType, plan.Variant),
			SlotSellingPoints: slot.SellingPoints,
			CopyText:          firstNonEmpty(slot.Copy, plan.Copy),
			TextMode:          textMode,
		})

		t.Logf("\n=== %s（%s %d，比例 %s，textMode=%s）落库版 ===\n%s",
			slot.SlotKey, slot.Kind, slot.SlotNo, plan.Aspect, textMode, clean)
		t.Logf("--- %s 派发版（发往模型）---\n%s", slot.SlotKey, dispatch)

		// 落库版禁含任何「排版指令 / 禁字套话」。
		for _, forbidden := range []string{
			"保持主体结构、颜色、比例、材质和可见细节稳定",
			"画面不生成文字",
			"画面纯图无文字",
			"不要添加任何排版文字",
			"画面文字必须逐字使用",
			"【画面文字与海报排版硬性要求】",
		} {
			if strings.Contains(clean, forbidden) {
				t.Errorf("%s 落库版严禁包含 %q", slot.SlotKey, forbidden)
			}
		}
		// 派发版必须满足 PR 合同的关键块。
		for _, want := range []string{
			"制作" + spec.Name + " 电商详情页单屏：" + firstNonEmpty(slot.Title, plan.Title, "商品展示"),
			"前 1 张参考图是产品",
			"不是原产品照片的背景、机位和构图模板",
			"产品：" + product.Name,
			"【画面文字与海报排版硬性要求】：",
			"只制作本屏方案，不扩展为整页或多屏拼图",
			"不得虚构产品功效、认证或数据",
		} {
			if !strings.Contains(dispatch, want) {
				t.Errorf("%s 派发版缺少合同段 %q", slot.SlotKey, want)
			}
		}
		// 派发版严禁出现任何「不许出字」字样（这是本次事故根因）。
		for _, forbidden := range []string{"保持主体结构、颜色、比例、材质和可见细节稳定", "画面不生成文字"} {
			if strings.Contains(dispatch, forbidden) {
				t.Errorf("%s 派发版严禁包含 %q", slot.SlotKey, forbidden)
			}
		}
		// 文案非空且非 none → 必须要求中文商业海报排版并逐字排版文案。
		if strings.TrimSpace(firstNonEmpty(slot.Copy, plan.Copy)) != "" && !strings.EqualFold(textMode, ecommerce.TextModeNone) {
			if !strings.Contains(dispatch, "带中文商业海报排版") {
				t.Errorf("%s 有文案时必须要求中文商业海报排版", slot.SlotKey)
			}
		}
	}
}
