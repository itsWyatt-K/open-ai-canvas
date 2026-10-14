package workbench

import "testing"

// 确定性 UUID 是「上游供料」桥接的契约：电商编排器按 key 复算 ID 取预设铁律段，
// 一旦算法漂移就会静默取不到模板（融合段为空），因此必须锁死。
func TestBuiltinCatalogIDDeterministic(t *testing.T) {
	first := BuiltinToolID("product-white-hero")
	second := BuiltinToolID("product-white-hero")
	if first != second {
		t.Fatalf("同一 key 必须得到同一 UUID：%s vs %s", first, second)
	}
	if first == BuiltinToolID("skincare-packshot") {
		t.Fatal("不同 key 不应得到同一 UUID")
	}
	if BuiltinToolID(" product-white-hero ") != first {
		t.Fatal("key 两端空白应被归一化")
	}
}

func TestBuiltinPresetIDDistinguishesVariant(t *testing.T) {
	standard := BuiltinPresetID("product-white-hero", "standard")
	composition := BuiltinPresetID("product-white-hero", "composition")
	if standard == composition {
		t.Fatal("不同变体 key 应得到不同 UUID")
	}
	if standard == BuiltinToolID("product-white-hero") {
		t.Fatal("预设 ID 不应与工具 ID 相同")
	}
	// 与 builtinCatalog 内部算法一致（回归锁：改算法会同时打破两处）。
	if want := builtinCatalogID("preset/product-white-hero/standard"); standard != want {
		t.Fatalf("预设 ID 算法漂移：%s vs %s", standard, want)
	}
	if want := builtinCatalogID("tool/product-white-hero"); BuiltinToolID("product-white-hero") != want {
		t.Fatal("工具 ID 算法漂移")
	}
}

// 编排器按 key 引用的上游工具必须真实存在于内置目录（防臆造 key）。
func TestOrchestratorReferencedToolsExist(t *testing.T) {
	tools, presets, err := builtinCatalog()
	if err != nil {
		t.Fatalf("读取内置目录失败：%v", err)
	}
	toolByID := map[string]bool{}
	for _, tool := range tools {
		toolByID[tool.ID] = true
	}
	presetByID := map[string]bool{}
	for _, preset := range presets {
		presetByID[preset.ID] = true
	}
	// 电商编排器 7 屏 + 透明主体层引用的上游 key。
	referenced := []struct{ toolKey, variantKey string }{
		{"campaign-key-visual", "standard"},
		{"listing-benefit-layout", "composition"},
		{"product-macro-detail", "detail"},
		{"vertical-product-page", "standard"},
		{"appliance-in-use", "standard"},
		{"perfume-still-life", "standard"},
		{"packaging-lineup", "standard"},
		{"product-white-hero", "standard"},
	}
	for _, ref := range referenced {
		toolID := BuiltinToolID(ref.toolKey)
		if !toolByID[toolID] {
			t.Fatalf("上游工具 key 不存在于内置目录：%s（ID %s）", ref.toolKey, toolID)
		}
		presetID := BuiltinPresetID(ref.toolKey, ref.variantKey)
		if !presetByID[presetID] {
			t.Fatalf("上游预设不存在：%s/%s（ID %s）", ref.toolKey, ref.variantKey, presetID)
		}
	}
}
