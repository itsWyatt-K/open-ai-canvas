package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

// 通道 B：preserve_product_exact=true 时，派发提示词自动追加「纯场景承托底图」指令。
func TestChannelBSceneDirectiveInDispatchPrompt(t *testing.T) {
	withDirective := buildEcommerceSlotPrompt(ecommerceSlotPromptInput{
		PlatformName: "拼多多", SlotTitle: "主图", SlotNo: 1, Kind: "hero",
		ProductName: "潮汐", PreserveProductExact: true,
	})
	if !strings.Contains(withDirective, "锁主体合成模式") || !strings.Contains(withDirective, "不绘制") {
		t.Fatalf("通道 B 指令未注入:\n%s", withDirective)
	}
	without := buildEcommerceSlotPrompt(ecommerceSlotPromptInput{
		PlatformName: "拼多多", SlotTitle: "主图", SlotNo: 1, Kind: "hero",
		ProductName: "潮汐",
	})
	if strings.Contains(without, "锁主体合成模式") {
		t.Fatal("未开启锁主体的屏不得注入通道 B 指令")
	}
}

// slotWantsChannelB：L1 显式开启 + 商品有原图才走通道 B。
func TestSlotWantsChannelB(t *testing.T) {
	briefOn, _ := json.Marshal(EcommerceUserBrief{PreserveProductExact: true})
	briefOff, _ := json.Marshal(EcommerceUserBrief{PreserveProductExact: false})
	product := &model.EcommerceProduct{ID: "p1", SourceResourceID: "res-1"}
	if !slotWantsChannelB(model.EcommerceSlot{UserBriefJSON: string(briefOn)}, product) {
		t.Fatal("开启且有原图应走通道 B")
	}
	if slotWantsChannelB(model.EcommerceSlot{UserBriefJSON: string(briefOff)}, product) {
		t.Fatal("未开启不应走通道 B")
	}
	if slotWantsChannelB(model.EcommerceSlot{UserBriefJSON: string(briefOn)}, &model.EcommerceProduct{ID: "p1"}) {
		t.Fatal("无原图不应走通道 B")
	}
}

// 通道 B 合成降级：nxf 不可达时 manifest 兜底两层 + L1 文字层仍在（不 panic 不报错）。
func TestComposeChannelBDegradesGracefully(t *testing.T) {
	s, _ := newEcommerceLifecycleService(t)
	productID := importLifecycleProduct(t, s, "降级商品.png")
	detail, err := s.EcommerceProductDetail("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	slot := detail.Slots[0]
	// 直接给不存在的 nxf 地址：compose 应静默降级。
	t.Setenv("CANVAS_NXF_BRIDGE_BASE", "http://127.0.0.1:1")
	brief := EcommerceUserBrief{ScreenTitle: "主标题X", SubTitle: "副标题Y", PreserveProductExact: true}
	slotRaw := model.EcommerceSlot{ID: slot.ID, UserBriefJSON: mustJSONString(brief)}
	manifest := s.composeEcommerceChannelBLayers("user", &model.EcommerceProduct{ID: productID, SourceResourceID: "missing"}, slotRaw, "data:image/png;base64,AAA", "data:image/png;base64,BBB")
	if manifest.ComposedImage == "" {
		t.Fatal("降级态也应有合成图（=生图原片）")
	}
	if len(manifest.TextLayers) != 2 || manifest.TextLayers[0].Text != "主标题X" {
		t.Fatalf("L1 主副标题应转默认文字层: %#v", manifest.TextLayers)
	}
}

// LLM 重写：配置可用通道时走真重写，system prompt 挂载技能规范。
func TestBriefLLMReworkAndFallback(t *testing.T) {
	var servedSystemPrompt string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		for _, message := range body.Messages {
			if message.Role == "system" {
				servedSystemPrompt = message.Content
			}
		}
		reply := `{"choices":[{"message":{"content":"{\"screen_title\":\"露营风静音扇\",\"sub_title\":\"户外露营草地背景\",\"scene_desc\":\"户外露营草地背景，午后阳光斜洒，野餐垫与背包道具\",\"layout_type\":\"scene-interspersed\"}"}}]}`
		_, _ = w.Write([]byte(reply))
	}))
	defer server.Close()
	t.Setenv("CANVAS_ECOMMERCE_BRIEF_LLM_BASE", server.URL+"/v1")
	t.Setenv("CANVAS_ECOMMERCE_BRIEF_LLM_KEY", "test-key")

	brief := EcommerceUserBrief{ScreenTitle: "旧标题", SceneDesc: "旧场景", LayoutType: "center-closeup"}
	var out EcommerceUserBrief
	if !ecommerceBriefLLMRework(context.Background(), brief, "改成户外露营", "第1屏", &out) {
		t.Fatal("LLM 重写应成功")
	}
	if out.ScreenTitle != "露营风静音扇" || out.LayoutType != "scene-interspersed" {
		t.Fatalf("LLM 重写结果不符: %#v", out)
	}
	if !strings.Contains(servedSystemPrompt, "layout_type") || !strings.Contains(servedSystemPrompt, "电商套图视觉导演") {
		t.Fatal("system prompt 应挂载技能规范")
	}
}

func TestBriefLLMFallsBackOnBadJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"这不是JSON"}}]}`))
	}))
	defer server.Close()
	t.Setenv("CANVAS_ECOMMERCE_BRIEF_LLM_BASE", server.URL+"/v1")
	t.Setenv("CANVAS_ECOMMERCE_BRIEF_LLM_KEY", "test-key")

	var out EcommerceUserBrief
	if ecommerceBriefLLMRework(context.Background(), EcommerceUserBrief{}, "hint", "屏", &out) {
		t.Fatal("坏 JSON 应判定失败（调用方回退变体器）")
	}
}

func TestBriefLLMSkipsWhenUnconfigured(t *testing.T) {
	t.Setenv("CANVAS_ECOMMERCE_BRIEF_LLM_KEY", "")
	var out EcommerceUserBrief
	if ecommerceBriefLLMRework(context.Background(), EcommerceUserBrief{}, "hint", "屏", &out) {
		t.Fatal("未配置 key 应直接回退")
	}
}

func mustJSONString(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}
