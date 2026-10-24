package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/ecommerce"
)

// L1 保存 → L2 自动重编译（双层解耦核心合同）。
func TestUpdateEcommerceSlotBriefRecompilesPrompt(t *testing.T) {
	s, _ := newEcommerceLifecycleService(t)
	productID := importLifecycleProduct(t, s, "双层企划商品.png")
	detail, err := s.EcommerceProductDetail("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Slots) == 0 {
		t.Fatal("应预建槽位")
	}
	slot := detail.Slots[0]

	title := "38dB 深度静音"
	sub := "图书馆级安静，宝宝哄睡不吵人"
	scene := "暖色儿童房，婴儿床边，柔光台灯"
	preserve := true
	updated, brief, err := s.UpdateEcommerceSlotBrief(context.Background(), "user", slot.ID, EcommerceBriefPatch{
		ScreenTitle:          &title,
		SubTitle:             &sub,
		SceneDesc:            &scene,
		LayoutType:           strPtr("center-closeup"),
		PreserveProductExact: &preserve,
	})
	if err != nil {
		t.Fatal(err)
	}
	if brief.ScreenTitle != title || !brief.PreserveProductExact {
		t.Fatalf("brief 落库不符: %#v", brief)
	}
	// L2 重编译：GenerationPrompt 必须包含 L1 全部语义。
	prompt := updated.GenerationPrompt
	for _, want := range []string{"主标题：38dB 深度静音", "副标题：图书馆级安静", "居中特写", "暖色儿童房", "锁主体合成管线"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("L2 编译缺少 %q:\n%s", want, prompt)
		}
	}
	// 槽位展示字段同步。
	if updated.Title != title || updated.SceneType != "居中特写" {
		t.Fatalf("title/sceneType 未同步: %q / %q", updated.Title, updated.SceneType)
	}
	// 详情视图透出 L1。
	reloaded, err := s.EcommerceProductDetail("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Slots[0].Brief == nil || reloaded.Slots[0].Brief.ScreenTitle != title {
		t.Fatal("详情未透出 L1 企划卡")
	}
}

// L1 校验：非法版式与超长字段被拒。
func TestEcommerceBriefValidation(t *testing.T) {
	brief := EcommerceUserBrief{ScreenTitle: strings.Repeat("长", 81)}
	if err := brief.Validate(); err == nil {
		t.Fatal("超长主标题应被拒")
	}
	brief = EcommerceUserBrief{LayoutType: "diagonal-fancy"}
	if err := brief.Validate(); err == nil {
		t.Fatal("未知版式应被拒")
	}
	brief = EcommerceUserBrief{LayoutType: "contrast-split", SceneDesc: "正常", PreserveProductExact: true}
	if err := brief.Validate(); err != nil {
		t.Fatal(err)
	}
}

// AI 换个思路：确定性变体器（轮换版式 + 融合 hint，保留主副标题）。
func TestReworkEcommerceBriefWithHint(t *testing.T) {
	brief := EcommerceUserBrief{
		ScreenTitle: "不变的主标题", SubTitle: "不变的副标题",
		SceneDesc: "原有场景", LayoutType: "center-closeup",
	}
	reworked := reworkEcommerceBriefWithHint(&brief, "改成户外露营草地背景", 2)
	if reworked.ScreenTitle != brief.ScreenTitle || reworked.SubTitle != brief.SubTitle {
		t.Fatal("变体不得改用户已确认的主副标题")
	}
	if reworked.LayoutType == brief.LayoutType || reworked.LayoutType == "" {
		t.Fatalf("版式应轮换: %s -> %s", brief.LayoutType, reworked.LayoutType)
	}
	if !strings.Contains(reworked.SceneDesc, "户外露营草地背景") || !strings.Contains(reworked.SceneDesc, "原有场景") {
		t.Fatalf("hint 应融合而非替换场景: %q", reworked.SceneDesc)
	}
	if brief.SceneDesc != "原有场景" {
		t.Fatal("原 brief 不得被就地修改")
	}
	// 同输入同输出（确定性，可测试）。
	again := reworkEcommerceBriefWithHint(&brief, "改成户外露营草地背景", 2)
	if again != reworked {
		t.Fatal("变体器必须确定性")
	}
}

// 四层交付清单：保存 → slot 最新态 + 当前版本历史态 → 详情透出。
func TestSaveEcommerceSlotLayersRoundtrip(t *testing.T) {
	s, _ := newEcommerceLifecycleService(t)
	productID := importLifecycleProduct(t, s, "分层交付商品.png")
	detail, err := s.EcommerceProductDetail("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	slot := detail.Slots[0]
	manifest := EcommerceLayerManifest{
		BackgroundLayer: "resource:bg-1",
		ShadowLayer:     "data:image/png;base64,AAA",
		ProductCutout:   "resource:cutout-1",
		ProductRect:     [4]float64{0.3, 0.25, 0.4, 0.5},
		TextLayers:      []EcommerceTextLayer{{Text: "限时直降", Color: "#E02020", X: 0.5, Y: 0.12, Size: 64}},
		ComposedImage:   "resource:composed-1",
	}
	if _, err := s.SaveEcommerceSlotLayers(context.Background(), "user", slot.ID, manifest); err != nil {
		t.Fatal(err)
	}
	reloaded, err := s.EcommerceProductDetail("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	got := reloaded.Slots[0].LayerManifest
	if got == nil {
		t.Fatal("详情未透出 layer_manifest")
	}
	if got.ProductCutout != manifest.ProductCutout || len(got.TextLayers) != 1 || got.TextLayers[0].Text != "限时直降" {
		t.Fatalf("manifest 往返不符: %#v", got)
	}
	if got.UpdatedAt == "" {
		t.Fatal("manifest 应带 updated_at")
	}
	// 非法坐标拒绝。
	bad := manifest
	bad.TextLayers = []EcommerceTextLayer{{Text: "x", X: 1.5, Y: 0.5}}
	if _, err := s.SaveEcommerceSlotLayers(context.Background(), "user", slot.ID, bad); err == nil {
		t.Fatal("越界坐标应被拒绝")
	}
}

// JSON 序列化契约：snake_case 字段名与指令单 schema 一致。
func TestEcommerceBriefJsonContract(t *testing.T) {
	brief := EcommerceUserBrief{ScreenTitle: "t", SubTitle: "s", SceneDesc: "d", LayoutType: "contrast-split", PreserveProductExact: true}
	encoded, err := json.Marshal(brief)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"screen_title"`, `"sub_title"`, `"scene_desc"`, `"layout_type"`, `"preserve_product_exact"`} {
		if !strings.Contains(string(encoded), key) {
			t.Fatalf("L1 JSON 契约缺字段 %s: %s", key, encoded)
		}
	}
	manifest := EcommerceLayerManifest{BackgroundLayer: "b", ShadowLayer: "sh", ProductCutout: "p", TextLayers: []EcommerceTextLayer{{Text: "x", X: 0, Y: 0}}}
	encoded, err = json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{`"background_layer_url"`, `"shadow_layer_url"`, `"product_cutout_url"`, `"text_layers"`} {
		if !strings.Contains(string(encoded), key) {
			t.Fatalf("manifest JSON 契约缺字段 %s: %s", key, encoded)
		}
	}
}

// 生成中槽位禁止改企划（与 prompt 编辑同守卫）。
func TestUpdateEcommerceSlotBriefBlockedWhileRunning(t *testing.T) {
	s, _ := newEcommerceLifecycleService(t)
	productID := importLifecycleProduct(t, s, "运行中商品.png")
	detail, err := s.EcommerceProductDetail("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	slot := detail.Slots[0]
	if err := s.repo.UpdateEcommerceSlotStatus(slot.ID, ecommerce.SlotStatusRunning); err != nil {
		t.Fatal(err)
	}
	title := "不该生效"
	if _, _, err := s.UpdateEcommerceSlotBrief(context.Background(), "user", slot.ID, EcommerceBriefPatch{ScreenTitle: &title}); err == nil {
		t.Fatal("生成中应拒绝改企划")
	}
}

func strPtr(value string) *string { return &value }
