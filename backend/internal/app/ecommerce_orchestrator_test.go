package app

// M2 编排器核心逻辑单测：全部为纯函数 / 内存逻辑，不依赖数据库（无 CGO 依赖），
// 保证在 CGO_ENABLED=0 的本机环境也能 100% 绿灯。

import (
	"errors"
	"os"
	"strings"
	"testing"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
)

func TestSelectSlotPlans(t *testing.T) {
	plans := ecommerce.SoloIslandSlots()
	if got := selectSlotPlans(plans, nil); len(got) != len(plans) {
		t.Fatalf("空过滤应返回全部槽位，得到 %d", len(got))
	}
	got := selectSlotPlans(plans, []string{"hero_emotion", " detail_macro_ripple ", "不存在"})
	if len(got) != 2 {
		t.Fatalf("应命中 2 个槽位，得到 %d", len(got))
	}
	if got[0].SlotKey != "hero_emotion" || got[1].SlotKey != "detail_macro_ripple" {
		t.Fatalf("命中顺序应保持计划顺序：%v", []string{got[0].SlotKey, got[1].SlotKey})
	}
}

func TestEcommercePromptForMatchesVariantThenFallsBack(t *testing.T) {
	synth := &nxfBatchResult{
		AnchorCard: "【公共锚点卡】",
		Prompts: []nxfPromptItem{
			{Scene: "ecom_set", Variant: "白底主图", Prompt: "白底提示词", Negative: "文字、水印"},
			{Scene: "ecom_set", Variant: "细节微距", Prompt: "微距提示词", Negative: "模糊"},
		},
	}
	prompt, negative := ecommercePromptFor(ecommerce.SlotPlan{Scene: "ecom_set", Variant: "细节微距"}, synth)
	if prompt != "微距提示词" || negative != "模糊" {
		t.Fatalf("变体精确匹配失败：%q / %q", prompt, negative)
	}
	// 变体名未命中 → 退回该场景首条（不返回空）。
	prompt, _ = ecommercePromptFor(ecommerce.SlotPlan{Scene: "ecom_set", Variant: "不存在的变体"}, synth)
	if prompt == "" {
		t.Fatal("变体未命中应退回场景首条")
	}
	// 无合成结果 → 空。
	if prompt, negative := ecommercePromptFor(ecommerce.SlotPlan{Scene: "ecom_set"}, nil); prompt != "" || negative != "" {
		t.Fatal("无合成结果应返回空")
	}
}

func TestEcommerceProductPayloadSplitsSellingPoints(t *testing.T) {
	product := &model.EcommerceProduct{
		Name:              "潮汐",
		ExtraRequirements: "鼠尾草绿哑光硅胶",
		SellingPoints:     "38dB静音、IPX7防水\n40°C恒温,医用级硅胶；静音\n第六条应被截断\n第七条应被截断",
	}
	payload := ecommerceProductPayload(product)
	if payload["name"] != "潮汐" {
		t.Fatalf("产品名不符：%v", payload["name"])
	}
	points, ok := payload["selling_points"].([]string)
	if !ok {
		t.Fatal("卖点应为字符串数组")
	}
	if len(points) != 5 {
		t.Fatalf("卖点上限 5 条，得到 %d：%v", len(points), points)
	}
	if points[0] != "38dB静音" || points[1] != "IPX7防水" {
		t.Fatalf("卖点切分错误：%v", points)
	}
}

func TestFirstImageResourceID(t *testing.T) {
	// 顶层 resourceId 优先。
	if got := firstImageResourceID(map[string]interface{}{"resourceId": "res-top"}); got != "res-top" {
		t.Fatalf("顶层应直接命中，得到 %q", got)
	}
	// 嵌套 images 数组（真实任务结果形态）。
	result := map[string]interface{}{
		"mode": "image",
		"images": []interface{}{
			map[string]interface{}{"dataUrl": "http://x/1.png", "resourceId": "res-nested"},
		},
	}
	if got := firstImageResourceID(result); got != "res-nested" {
		t.Fatalf("嵌套应命中，得到 %q", got)
	}
	// 无资源 → 空。
	if got := firstImageResourceID(map[string]interface{}{"mode": "image"}); got != "" {
		t.Fatalf("无资源应返回空，得到 %q", got)
	}
	if got := firstImageResourceID(nil); got != "" {
		t.Fatalf("nil 应返回空，得到 %q", got)
	}
}

func TestNxfBridgeBaseEnvOverride(t *testing.T) {
	original, had := os.LookupEnv("CANVAS_NXF_BRIDGE_BASE")
	defer func() {
		if had {
			_ = os.Setenv("CANVAS_NXF_BRIDGE_BASE", original)
		} else {
			_ = os.Unsetenv("CANVAS_NXF_BRIDGE_BASE")
		}
	}()
	_ = os.Unsetenv("CANVAS_NXF_BRIDGE_BASE")
	if got := nxfBridgeBase(); got != ecommerceDefaultNXFBase {
		t.Fatalf("默认应为 %s，得到 %s", ecommerceDefaultNXFBase, got)
	}
	_ = os.Setenv("CANVAS_NXF_BRIDGE_BASE", "http://127.0.0.1:9999/")
	if got := nxfBridgeBase(); got != "http://127.0.0.1:9999" {
		t.Fatalf("环境变量覆盖并去尾斜杠失败：%s", got)
	}
}

func TestTaskStatusIsTerminal(t *testing.T) {
	if !taskStatusIsTerminal(model.TaskStatusSucceeded) || !taskStatusIsTerminal(model.TaskStatusFailed) || !taskStatusIsTerminal(model.TaskStatusCancelled) {
		t.Fatal("succeeded/failed/cancelled 应为终态")
	}
	if taskStatusIsTerminal(model.TaskStatusQueued) || taskStatusIsTerminal(model.TaskStatusRunning) {
		t.Fatal("queued/running 不应为终态")
	}
}

func TestTruncateError(t *testing.T) {
	if got := truncateError(nil); got != "" {
		t.Fatalf("nil 应返回空串，得到 %q", got)
	}
	long := strings.Repeat("错", 500)
	if got := truncateError(errors.New(long)); len([]rune(got)) != 400 {
		t.Fatalf("超长错误应截断到 400 字符，得到 %d", len([]rune(got)))
	}
	if got := truncateError(errors.New("短错误")); got != "短错误" {
		t.Fatalf("短错误应原样返回，得到 %q", got)
	}
}

func TestUniqueStrings(t *testing.T) {
	got := uniqueStrings([]string{"a", " a ", "", "b", "a", "c"})
	want := []string{"a", "b", "c"}
	if len(got) != len(want) {
		t.Fatalf("去重失败：%v", got)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("顺序或内容不符：%v", got)
		}
	}
}

func TestSlotViewsCarriesStatus(t *testing.T) {
	views := slotViews([]model.EcommerceSlot{
		{ID: "1", Status: ecommerce.SlotStatusCompleted},
		{ID: "2", Status: ecommerce.SlotStatusRunning},
	})
	if len(views) != 2 || views[0].Status != ecommerce.SlotStatusCompleted || views[1].Status != ecommerce.SlotStatusRunning {
		t.Fatalf("槽位状态映射失败：%+v", views)
	}
}
