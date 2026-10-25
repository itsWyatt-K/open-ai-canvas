// Agent 电商产线工具执行器（拍板令阶段四）：切平台 / AI 策划 / 确认派发。
//
// 计费与安全边界：
//   - ecommerce_apply_platform：只改平台模板与未派发槽位，不派发生图、不扣费；
//   - ecommerce_plan_product：派发一次视觉文本策划任务（text 计费，走既有模型计费）；
//   - ecommerce_confirm_plan：**强制审批门**（加入 cloudAgentWrite + always-approve 集合），
//     确认即按平台规范派发全部待生成槽位并真实计费；执行前复用 ConfirmEcommercePlan
//     的余额预检（insufficient_credits），预算不足在审批预演阶段即失败。
//   - 三者都先过 ownedEcommerceSlot/GetEcommerceProduct 归属校验，防越权。
package app

import (
	"context"
	"encoding/json"
	"strings"
)

// cloudAgentEcommerceApplyPlatform 切换目标平台（规格/槽位模板随平台重建，未派发才允许）。
func cloudAgentEcommerceApplyPlatform(services []*Service, userID string, call cloudAgentCall) (any, error) {
	var args struct {
		ProductID string `json:"productId"`
		Platform  string `json:"platform"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	productID := strings.TrimSpace(args.ProductID)
	platform := strings.TrimSpace(args.Platform)
	if productID == "" || platform == "" {
		return nil, BadAuthRequest("缺少 productId 或 platform")
	}
	svc := cloudAgentService(services)
	if svc == nil {
		return nil, BadAuthRequest("电商服务不可用")
	}
	detail, _, err := svc.ApplyEcommercePlatform(context.Background(), userID, productID, platform)
	if err != nil {
		return nil, err
	}
	slots := make([]map[string]any, 0, len(detail.Slots))
	for _, slot := range detail.Slots {
		slots = append(slots, map[string]any{
			"id": slot.ID, "slotKey": slot.SlotKey, "kind": slot.Kind, "slotNo": slot.SlotNo,
			"title": slot.Title, "status": slot.Status, "aspectRatio": slot.AspectRatio,
		})
	}
	return map[string]any{
		"applied":     platform,
		"productName": detail.Product.Name,
		"status":      detail.Product.Status,
		"slotCount":   len(detail.Slots),
		"slots":       slots,
		"charged":     false,
		"note":        "平台规格已切换；确认生图前不产生任何费用。生图确认请用 ecommerce_confirm_plan（需用户审批）。",
	}, nil
}

// cloudAgentEcommercePlanProduct 派发 AI 视觉策划（text 计费；生图仍需 confirm_plan 审批）。
func cloudAgentEcommercePlanProduct(services []*Service, userID string, call cloudAgentCall) (any, error) {
	var args struct {
		ProductID         string   `json:"productId"`
		ChannelID         string   `json:"channelId"`
		Model             string   `json:"model"`
		StyleReferenceIDs []string `json:"styleReferenceIds"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	productID := strings.TrimSpace(args.ProductID)
	if productID == "" {
		return nil, BadAuthRequest("缺少 productId")
	}
	svc := cloudAgentService(services)
	if svc == nil {
		return nil, BadAuthRequest("电商服务不可用")
	}
	// 归属校验 + 模型兜底：模型未传时回退商品派发快照（与前端口径一致）。
	if _, err := svc.repo.GetEcommerceProduct(userID, productID); err != nil {
		return nil, err
	}
	channelID, model := strings.TrimSpace(args.ChannelID), strings.TrimSpace(args.Model)
	if channelID == "" || model == "" {
		product, err := svc.repo.GetEcommerceProduct(userID, productID)
		if err != nil {
			return nil, err
		}
		if snapshot, ok := dispatchSnapshotFor(product); ok {
			channelID = firstNonEmpty(channelID, snapshot.ChannelID)
			model = firstNonEmpty(model, snapshot.Model)
		}
	}
	if channelID == "" || model == "" {
		return nil, BadAuthRequest("缺少可用的视觉文本模型与渠道：请显式传入 channelId/model，或先为该商品确认过一次方案")
	}
	result, err := svc.StartEcommercePlanning(context.Background(), userID, productID, EcommercePlanOptions{
		ChannelID:         channelID,
		Model:             model,
		StyleReferenceIDs: args.StyleReferenceIDs,
	})
	if err != nil {
		return nil, err
	}
	encoded, _ := json.Marshal(map[string]any{
		"productId": result.ProductID, "taskId": result.TaskID, "screens": result.Screens,
		"message":     firstNonEmpty(result.Message, "AI 策划任务已派发；完成后用 ecommerce_get_product_detail 查看各屏企划"),
		"charged":     false,
		"chargedNote": "策划任务按文本模型计费；生图确认另走 ecommerce_confirm_plan 审批",
	})
	return json.RawMessage(encoded), nil
}

// cloudAgentEcommerceConfirmPlan 确认企划并派发生图（**计费动作**，强制审批）。
func cloudAgentEcommerceConfirmPlan(services []*Service, userID string, call cloudAgentCall) (any, error) {
	var args struct {
		ProductID string `json:"productId"`
		ChannelID string `json:"channelId"`
		Model     string `json:"model"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	productID := strings.TrimSpace(args.ProductID)
	if productID == "" {
		return nil, BadAuthRequest("缺少 productId")
	}
	svc := cloudAgentService(services)
	if svc == nil {
		return nil, BadAuthRequest("电商服务不可用")
	}
	product, err := svc.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		return nil, err
	}
	// 预算校验前置：余额不足在审批预演阶段就报出来，不进了队列才发现。
	if product.Status != "review" && product.Status != "draft" {
		return nil, BadAuthRequest("当前状态为 " + product.Status + "，仅「待确认方案/未开始」可确认派发")
	}
	channelID, model := strings.TrimSpace(args.ChannelID), strings.TrimSpace(args.Model)
	if channelID == "" || model == "" {
		if snapshot, ok := dispatchSnapshotFor(product); ok {
			channelID = firstNonEmpty(channelID, snapshot.ChannelID)
			model = firstNonEmpty(model, snapshot.Model)
		}
	}
	if channelID == "" || model == "" {
		return nil, BadAuthRequest("缺少生图渠道与模型：请显式传入 channelId/model")
	}
	detail, err := svc.ConfirmEcommercePlan(context.Background(), userID, productID, EcommerceStartOptions{
		ChannelID: channelID, Model: model,
	})
	if err != nil {
		return nil, err
	}
	dispatched := 0
	deferred := 0
	for _, slot := range detail.Slots {
		switch slot.Status {
		case "queued", "running":
			dispatched++
		case "pending", "draft":
			deferred++
		}
	}
	encoded, _ := json.Marshal(map[string]any{
		"productId": productID, "status": detail.Product.Status,
		"dispatched": dispatched, "deferred": deferred,
		"charged":     true,
		"chargedNote": "已按平台规范真实派发生图任务并计费；超出并发上限的屏自动排队顺延，不视为失败",
		"note":        "在途满额的屏自动排队顺延；失败屏用 ecommerce_get_product_detail 查看原因后可再生成",
	})
	return json.RawMessage(encoded), nil
}
