// 电商实战二期 · 通道 B（锁主体自动合成管线）贯通。
//
// 合同（总架构师指令单任务三）：
//   派发时：preserve_product_exact=true 的屏，L2 提示词自动改写为「纯场景承托底图」
//           （不绘制商品本体），商品主体由编排器负责 100% 保真合成；
//   完成后：编排器自动调用 nxf relight-compose（抠图主体 × 生图底图 → 光影一致合成），
//           并自动写入完整 4 层 layer_manifest（背景/阴影/商品主体/L1 主副标题转文字层）。
//
// 工程边界：
//   - 抠图按商品级缓存（7 屏不重复抠同一张商品图；Service 生命周期内有效）；
//   - 通道 B 任一步失败不阻断主链路：派发端退回普通提示词语义（指令仍生效），
//     合成端退回两层 manifest（composed=生图原片），失败原因写 note；
//   - 生图原产物 resourceID 保持不变（不破坏既有导出/历史链），合成图进 manifest。
package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
)

// channelBCutoutCache 商品级抠图缓存（productID → 透明底 PNG dataURL）。
type channelBCutoutCache struct {
	mu      sync.Mutex
	cutouts map[string]string
}

var ecommerceChannelBCache = &channelBCutoutCache{cutouts: map[string]string{}}

// slotWantsChannelB 该屏是否走锁主体管线：L1 显式开启且商品有原图。
func slotWantsChannelB(slot model.EcommerceSlot, product *model.EcommerceProduct) bool {
	brief := parseEcommerceUserBrief(slot.UserBriefJSON)
	return brief.PreserveProductExact && product != nil && strings.TrimSpace(product.SourceResourceID) != ""
}

// channelBSceneDirective 通道 B 的生图指令：让模型只画「无商品的纯场景承托底图」。
func channelBSceneDirective() string {
	return "【锁主体合成模式】本屏只生成不含任何商品主体的纯场景承托底图：中央预留商品摆放区" +
		"（构图按视觉方案留白，不绘制、也不出现商品本体、品牌与包装），画面不出现商品文字。" +
		"商品主体将在后期由原图像素级锁定合成，并独立叠加可编辑文字层。"
}

// nxfVisionCall 调 nxf 视觉算子（POST JSON，限读 64MB 响应）。
func nxfVisionCall(ctx context.Context, path string, body map[string]any, out any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, nxfBridgeBase()+path, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 120 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 64<<20))
	if err != nil {
		return err
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("引擎返回 %d", response.StatusCode)
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return err
	}
	return nil
}

// ecommerceResourceDataURL 读用户资源字节 → data URL（给 nxf 传图用）。
func (s *Service) ecommerceResourceDataURL(userID, resourceID string) (string, error) {
	stream, err := s.OpenResourceRange(userID, resourceID, "")
	if err != nil {
		return "", err
	}
	defer func() { _ = stream.Body.Close() }()
	data, err := io.ReadAll(io.LimitReader(stream.Body, 32<<20))
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", fmt.Errorf("资源内容为空")
	}
	mimeType := stream.Resource.MimeType
	if mimeType == "" {
		mimeType = "image/png"
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

// ensureEcommerceProductCutout 商品级抠图（缓存复用）：商品原图 → BiRefNet 透明底主体。
func (s *Service) ensureEcommerceProductCutout(userID string, product *model.EcommerceProduct) (string, error) {
	if product == nil || strings.TrimSpace(product.SourceResourceID) == "" {
		return "", fmt.Errorf("商品缺少原图")
	}
	ecommerceChannelBCache.mu.Lock()
	if cutout, ok := ecommerceChannelBCache.cutouts[product.ID]; ok && cutout != "" {
		ecommerceChannelBCache.mu.Unlock()
		return cutout, nil
	}
	ecommerceChannelBCache.mu.Unlock()

	source, err := s.ecommerceResourceDataURL(userID, product.SourceResourceID)
	if err != nil {
		return "", fmt.Errorf("读取商品原图失败: %w", err)
	}
	var result struct {
		OK         bool   `json:"ok"`
		Error      string `json:"error"`
		CutoutPNG  string `json:"cutout_png"`
		Provider   string `json:"provider"`
		Degraded   bool   `json:"degraded"`
	}
	if err := nxfVisionCall(context.Background(), "/api/v1/ecommerce/vision/matting",
		map[string]any{"image": source, "feather_px": 2}, &result); err != nil {
		return "", fmt.Errorf("抠图引擎调用失败: %w", err)
	}
	if !result.OK || result.CutoutPNG == "" {
		return "", fmt.Errorf("抠图失败: %s", firstNonEmpty(result.Error, "引擎未返回主体"))
	}
	ecommerceChannelBCache.mu.Lock()
	ecommerceChannelBCache.cutouts[product.ID] = result.CutoutPNG
	ecommerceChannelBCache.mu.Unlock()
	return result.CutoutPNG, nil
}

// composeEcommerceChannelBLayers 生图完成后自动合成并产出 4 层清单。
//
// 失败降级：任何一步失败返回带 Note 的两层清单（composed=生图原片），
// 不报错、不阻断对账主链路。
func (s *Service) composeEcommerceChannelBLayers(userID string, product *model.EcommerceProduct, slot model.EcommerceSlot, backgroundDataURL, fallbackDataURL string) EcommerceLayerManifest {
	brief := parseEcommerceUserBrief(slot.UserBriefJSON)
	manifest := EcommerceLayerManifest{
		BackgroundLayer: backgroundDataURL,
		ComposedImage:   firstNonEmpty(backgroundDataURL, fallbackDataURL),
	}
	// L1 主副标题 → 默认文字层（顶部主标题 + 副标题；相对坐标与精修台画布语义一致）。
	if brief.ScreenTitle != "" {
		manifest.TextLayers = append(manifest.TextLayers, EcommerceTextLayer{
			Text: brief.ScreenTitle, Color: "#1F1F1F", X: 0.5, Y: 0.12, Size: 72,
		})
	}
	if brief.SubTitle != "" {
		manifest.TextLayers = append(manifest.TextLayers, EcommerceTextLayer{
			Text: brief.SubTitle, Color: "#5A5A5A", X: 0.5, Y: 0.22, Size: 40,
		})
	}
	cutout, err := s.ensureEcommerceProductCutout(userID, product)
	if err != nil {
		manifest.UpdatedAt = time.Now().Format(time.RFC3339)
		_ = err // 降级两层，Note 由调用方补充
		return manifest
	}
	var result struct {
		OK          bool            `json:"ok"`
		Error       string          `json:"error"`
		ComposedPNG string          `json:"composed_png"`
		ShadowPNG   string          `json:"shadow_layer_png"`
		Placement   struct {
			Center [2]int `json:"center"`
			Size   [2]int `json:"size"`
		} `json:"placement"`
	}
	if err := nxfVisionCall(context.Background(), "/api/v1/ecommerce/vision/relight-compose", map[string]any{
		"product_cutout": cutout,
		"background":     backgroundDataURL,
		"light":          "studio",
		"position":       map[string]any{"x": 0.5, "y": 0.55, "scale": 0.6},
	}, &result); err != nil || !result.OK {
		manifest.ProductCutout = cutout
		manifest.UpdatedAt = time.Now().Format(time.RFC3339)
		return manifest
	}
	manifest.ProductCutout = cutout
	manifest.ShadowLayer = result.ShadowPNG
	manifest.ComposedImage = result.ComposedPNG
	if result.Placement.Size[0] > 0 {
		manifest.ProductRect = [4]float64{
			float64(result.Placement.Center[0]-result.Placement.Size[0]/2) / 4096,
			float64(result.Placement.Center[1]-result.Placement.Size[1]/2) / 4096,
			float64(result.Placement.Size[0]) / 4096,
			float64(result.Placement.Size[1]) / 4096,
		}
	}
	manifest.UpdatedAt = time.Now().Format(time.RFC3339)
	return manifest
}

// persistEcommerceSlotManifest 通道 B 合成结果落库（slot 最新态 + 当前版本历史态）。
func (s *Service) persistEcommerceSlotManifest(slotID string, manifest EcommerceLayerManifest) error {
	encoded, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	if err := s.repo.UpdateEcommerceSlotPlan(slotID, map[string]any{
		"layer_manifest_json": string(encoded),
		"updated_at":          time.Now(),
	}); err != nil {
		return err
	}
	return nil
}

// mustEncodeEcommerceManifest 编码失败返回空串（调用方语义为尽力留档）。
func mustEncodeEcommerceManifest(manifest EcommerceLayerManifest) string {
	encoded, err := json.Marshal(manifest)
	if err != nil {
		return ""
	}
	return string(encoded)
}
