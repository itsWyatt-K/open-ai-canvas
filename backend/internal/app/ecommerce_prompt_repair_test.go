package app

// 历史脏提示词清洗回归测试（阶段 5 整改）。
//
// 现场：旧 M2 模板把「保持主体结构…画面不生成文字…」写进了 generation_prompt，
// 模型严格照做 → 详情页全无文字、整组构图雷同。启动自检必须能把这批存量洗干净，
// 且只清洗「两个标记同时命中」的槽位，不能误伤正常人工描述。

import (
	"strings"
	"testing"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

const legacyDirtyPrompt = "保持主体结构、颜色、比例、材质和可见细节稳定；辅助参考仅用于其对应的场景、姿态或风格，" +
	"不得覆盖主体特征。采用清晰的主体层级、可信透视、自然光影与真实接触关系。" +
	"画面不生成文字、价格、水印、虚构品牌或未提供的产品信息；输出干净、可用于商业创作的视觉画面。"

func TestRepairLegacyEcommerceSlotPromptsCleansDirtyAndIsIdempotent(t *testing.T) {
	svc := newAgentEcommerceService(t)
	product := &model.EcommerceProduct{
		ID: kernel.NewID(), UserID: "u-repair", Name: "海尔双子冰盒",
		SellingPoints: "2℃~28℃ 物理锁温", Status: ecommerce.ProductStatusFailed,
	}
	if err := svc.repo.CreateEcommerceProduct(product); err != nil {
		t.Fatal(err)
	}
	dirty := model.EcommerceSlot{
		ID: kernel.NewID(), ProductID: product.ID, Kind: ecommerce.SlotKindHero, SlotNo: 1,
		SlotKey: "hero_main", Title: "首屏视觉冲击", SceneType: "强冲击竖构图",
		AspectRatio: "3:4", Status: ecommerce.SlotStatusFailed,
		GenerationPrompt: legacyDirtyPrompt,
	}
	// 只含其中一句的人工描述：不应被判脏。
	manual := model.EcommerceSlot{
		ID: kernel.NewID(), ProductID: product.ID, Kind: ecommerce.SlotKindHero, SlotNo: 2,
		SlotKey: "hero_benefit", Title: "痛点强对比", SceneType: "前后对比",
		AspectRatio: "3:4", Status: ecommerce.SlotStatusDraft,
		GenerationPrompt: "整组视觉方向：冷调科技感\n\n文字与留白：顶部标题区留白充足，画面不生成文字的位置已预留",
	}
	if err := svc.repo.CreateEcommerceSlots([]model.EcommerceSlot{dirty, manual}); err != nil {
		t.Fatal(err)
	}

	repaired, err := svc.RepairLegacyEcommerceSlotPrompts()
	if err != nil {
		t.Fatalf("清洗失败：%v", err)
	}
	if repaired != 1 {
		t.Fatalf("应只清洗 1 个脏槽位，实际 %d", repaired)
	}

	slots, err := svc.repo.ListEcommerceSlots(product.ID)
	if err != nil {
		t.Fatal(err)
	}
	byKey := map[string]model.EcommerceSlot{}
	for _, slot := range slots {
		byKey[slot.SlotKey] = slot
	}
	cleaned := byKey["hero_main"].GenerationPrompt
	if cleaned == "" {
		t.Fatal("清洗后 generation_prompt 不应为空")
	}
	for _, forbidden := range []string{
		"保持主体结构、颜色、比例、材质和可见细节稳定",
		"画面不生成文字",
	} {
		if strings.Contains(cleaned, forbidden) {
			t.Fatalf("清洗后仍含旧套话 %q：%s", forbidden, cleaned)
		}
	}
	for _, want := range []string{"【本屏主题】", "【海报版式】", "【场景与道具】", "【视角与构图】"} {
		if !strings.Contains(cleaned, want) {
			t.Fatalf("清洗后应含 %s：%s", want, cleaned)
		}
	}
	if got := byKey["hero_benefit"].GenerationPrompt; got != manual.GenerationPrompt {
		t.Fatal("只命中一个标记的人工描述不应被改写")
	}

	// 幂等：再跑一次不应重复清洗。
	again, err := svc.RepairLegacyEcommerceSlotPrompts()
	if err != nil {
		t.Fatalf("二次清洗失败：%v", err)
	}
	if again != 0 {
		t.Fatalf("二次清洗应为 0，实际 %d", again)
	}
}
