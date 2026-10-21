package app

// 历史脏提示词启动自检（阶段 5 整改）。
//
// 背景：旧 M2 模板把「保持主体结构、颜色、比例、材质和可见细节稳定…画面不生成文字…」
// 直接写进了 ecommerce_slots.generation_prompt。生图模型严格照做 →
// 详情页全无文字、整组多屏构图雷同（连产品品类都会被认错）。
//
// 这里在服务启动时做一次**幂等**清洗：凡是同时命中两个旧标记的槽位，
// 按「平台规范 + 屏位」重新生成「海报版式 + 场景描述」，替换掉脏文本。
// 判定用「同时命中」而不是「包含任一」，避免误伤只提到其中一句的正常人工描述。

import (
	"log"
	"strings"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
)

// legacyEcommercePromptMarkers 判定「旧 M2 脏提示词」的联合标记（必须同时命中）。
var legacyEcommercePromptMarkers = []string{
	"保持主体结构、颜色、比例、材质和可见细节稳定",
	"画面不生成文字",
}

// RepairLegacyEcommerceSlotPrompts 清洗历史脏提示词，返回修复条数。幂等，可每次启动执行。
func (s *Service) RepairLegacyEcommerceSlotPrompts() (int, error) {
	slots, err := s.repo.LegacyDirtyEcommerceSlots(legacyEcommercePromptMarkers)
	if err != nil {
		return 0, err
	}
	if len(slots) == 0 {
		return 0, nil
	}
	products := make(map[string]*model.EcommerceProduct, 4)
	repaired := 0
	for index := range slots {
		slot := slots[index]
		product, ok := products[slot.ProductID]
		if !ok {
			loaded, loadErr := s.repo.EcommerceProductByID(slot.ProductID)
			if loadErr != nil || loaded == nil {
				log.Printf("ecommerce legacy prompt repair skip: slot_id=%s product_id=%s error=%v", slot.ID, slot.ProductID, loadErr)
				continue
			}
			products[slot.ProductID] = loaded
			product = loaded
		}
		clean := ecommerce.ComposeSlotFallbackPrompt(ecommerce.SlotPromptContext{
			ProductName:       product.Name,
			SellingPoints:     product.SellingPoints,
			ExtraRequirements: product.ExtraRequirements,
			SlotTitle:         slot.Title,
			SlotSceneType:     slot.SceneType,
			PlatformKey:       s.ecommercePlatformKey(product.UserID),
			Aspect:            slot.AspectRatio,
			Kind:              slot.Kind,
			SlotNo:            slot.SlotNo,
		})
		if strings.TrimSpace(clean) == "" {
			continue
		}
		if err := s.repo.UpdateEcommerceSlotPlan(slot.ID, map[string]any{"generation_prompt": clean}); err != nil {
			log.Printf("ecommerce legacy prompt repair failed: slot_id=%s error=%v", slot.ID, err)
			continue
		}
		repaired++
	}
	return repaired, nil
}
