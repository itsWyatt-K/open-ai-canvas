// 电商工坊商品任务 service：导入、列表、详情、改名、删除。
//
// 语义（桌面版同款）：
//   - 同一原图重复导入默认跳过（防误建收费任务）；
//   - status=completed 筛选含 completed_with_warnings；
//   - 已开始任务禁止改名（name_locked）；
//   - 删除仅移除电商表行，不删 Resource 与云对象；在途整项拒绝。

package app

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// ProductSummary 列表行（含进度摘要，前端任务卡直接渲染）。
type ProductSummary struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Status       string    `json:"status"`
	StatusReason string    `json:"statusReason,omitempty"`
	Round        int       `json:"round"`
	SourceName   string    `json:"sourceName,omitempty"`
	ThumbnailURL string    `json:"thumbnailUrl,omitempty"`
	TitleStatus  string    `json:"titleStatus"`
	HeroDone     int       `json:"heroDone"`
	HeroTotal    int       `json:"heroTotal"`
	DetailDone   int       `json:"detailDone"`
	DetailTotal  int       `json:"detailTotal"`
	CreatedAt    time.Time `json:"createdAt"`
}

// SlotSummary 详情页槽位（含当前版本与最新产物）。
type SlotSummary struct {
	ID             string    `json:"id"`
	Kind           string    `json:"kind"`
	SlotNo         int       `json:"slotNo"`
	SlotKey        string    `json:"slotKey"`
	Title          string    `json:"title,omitempty"`
	Copy           string    `json:"copy,omitempty"`
	Status         string    `json:"status"`
	CurrentVersion int       `json:"currentVersion"`
	ResourceID     string    `json:"resourceId,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// ProductDetail 详情聚合。
type ProductDetail struct {
	Product *model.EcommerceProduct `json:"product"`
	Slots   []SlotSummary           `json:"slots"`
}

// ImportItem 导入项（前端上传时知道文件名，随 resourceId 一起传——
// model.Resource 无名称字段，桌面版"名称取原图名"在本地以前端传入名为准）。
type ImportItem struct {
	ResourceID string `json:"resourceId"`
	Name       string `json:"name"`
}

// ImportEcommerceProducts 批量导入建任务。同一 ResourceID 已存在则跳过（skipped 返回）。
func (s *Service) ImportEcommerceProducts(userID string, items []ImportItem) ([]*model.EcommerceProduct, []string, error) {
	if len(items) == 0 {
		return nil, nil, NewAppError(http.StatusBadRequest, "请先选择要导入的商品图")
	}
	created := make([]*model.EcommerceProduct, 0, len(items))
	skipped := make([]string, 0)
	for _, item := range items {
		resourceID := strings.TrimSpace(item.ResourceID)
		if resourceID == "" {
			continue
		}
		if _, err := s.repo.FindEcommerceProductBySource(userID, resourceID); err == nil {
			skipped = append(skipped, resourceID) // 已导入过：默认跳过
			continue
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, err
		}
		resource, err := s.repo.ResourceForUser(userID, resourceID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				skipped = append(skipped, resourceID) // 无权限或不存在：跳过并反馈
				continue
			}
			return nil, nil, err
		}
		sourceName := sanitizeProductName(item.Name) // 空名清洗为「未命名商品」
		now := time.Now()
		product := &model.EcommerceProduct{
			UserID:           userID,
			Name:             sourceName,
			Round:            1,
			SourceResourceID: resource.ID,
			SourceName:       sourceName,
			Status:           ecommerce.ProductStatusDraft,
			TitleStatus:      ecommerce.TitleStatusPending,
			CreatedAt:        now,
			UpdatedAt:        now,
		}
		if err := s.repo.CreateEcommerceProduct(product); err != nil {
			return nil, nil, err
		}
		created = append(created, product)
	}
	return created, skipped, nil
}

// ListEcommerceProducts 列表（status 过滤含 completed_with_warnings 展开）。
func (s *Service) ListEcommerceProducts(userID, query, status string) ([]ProductSummary, int, error) {
	statuses := expandStatusFilter(status)
	products, err := s.repo.ListEcommerceProducts(userID, query, statuses)
	if err != nil {
		return nil, 0, err
	}
	// 批量取槽位做进度聚合（一次查询，避免 N+1）。
	ids := make([]string, 0, len(products))
	for _, product := range products {
		ids = append(ids, product.ID)
	}
	slots, err := s.repo.ListEcommerceSlotsByProductIDs(ids)
	if err != nil {
		return nil, 0, err
	}
	progress := map[string]*[4]int{} // heroDone, heroTotal, detailDone, detailTotal
	for _, slot := range slots {
		counter, ok := progress[slot.ProductID]
		if !ok {
			counter = &[4]int{}
			progress[slot.ProductID] = counter
		}
		if slot.Kind == ecommerce.SlotKindHero {
			counter[1]++
			if ecommerce.IsTerminalSlotStatus(slot.Status) && slot.Status == ecommerce.SlotStatusCompleted {
				counter[0]++
			}
		} else {
			counter[3]++
			if ecommerce.IsTerminalSlotStatus(slot.Status) && slot.Status == ecommerce.SlotStatusCompleted {
				counter[2]++
			}
		}
	}
	summaries := make([]ProductSummary, 0, len(products))
	for _, product := range products {
		counter := progress[product.ID]
		if counter == nil {
			counter = &[4]int{}
		}
		summaries = append(summaries, ProductSummary{
			ID:            product.ID,
			Name:          product.Name,
			Status:        product.Status,
			StatusReason:  product.StatusReason,
			Round:         product.Round,
			SourceName:    product.SourceName,
			ThumbnailURL:  resourceFileURL(product.SourceResourceID),
			TitleStatus:   product.TitleStatus,
			HeroDone:      counter[0],
			HeroTotal:     counter[1],
			DetailDone:    counter[2],
			DetailTotal:   counter[3],
			CreatedAt:     product.CreatedAt,
		})
	}
	return summaries, len(summaries), nil
}

// EcommerceProductDetail 详情聚合（product + slots + 各槽最新版本产物）。
func (s *Service) EcommerceProductDetail(userID, productID string) (*ProductDetail, error) {
	product, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("商品任务不存在")
		}
		return nil, err
	}
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, err
	}
	summaries := make([]SlotSummary, 0, len(slots))
	for _, slot := range slots {
		summary := SlotSummary{
			ID:             slot.ID,
			Kind:           slot.Kind,
			SlotNo:         slot.SlotNo,
			SlotKey:        slot.SlotKey,
			Title:          slot.Title,
			Copy:           slot.Copy,
			Status:         slot.Status,
			CurrentVersion: slot.CurrentVersion,
			UpdatedAt:      slot.UpdatedAt,
		}
		versions, err := s.repo.ListEcommerceSlotVersions(slot.ID)
		if err != nil {
			return nil, err
		}
		if len(versions) > 0 {
			summary.ResourceID = versions[0].ResourceID // 已按 version DESC 排序
		}
		summaries = append(summaries, summary)
	}
	return &ProductDetail{Product: product, Slots: summaries}, nil
}

// RenameEcommerceProduct 改名（已开始任务禁止改名，返回 400 name_locked）。
func (s *Service) RenameEcommerceProduct(userID, productID, name string) error {
	product, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("商品任务不存在")
		}
		return err
	}
	if product.Status != ecommerce.ProductStatusDraft && product.Status != ecommerce.ProductStatusPaused {
		return NewAppError(http.StatusBadRequest, "任务已开始，不能改名")
	}
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return NewAppError(http.StatusBadRequest, "名称不能为空")
	}
	return s.repo.RenameEcommerceProduct(userID, productID, trimmed)
}

// DeleteEcommerceProducts 批量删除（在途整项拒绝；仅删电商表行）。
func (s *Service) DeleteEcommerceProducts(userID string, ids []string) (map[string]string, error) {
	if len(ids) == 0 {
		return nil, NewAppError(http.StatusBadRequest, "请先勾选要删除的任务")
	}
	refused := map[string]string{}
	deletable := make([]string, 0, len(ids))
	for _, id := range ids {
		product, err := s.repo.GetEcommerceProduct(userID, id)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				refused[id] = "任务不存在"
				continue
			}
			return nil, err
		}
		if !ecommerce.IsTerminalProductStatus(product.Status) && product.Status != ecommerce.ProductStatusDraft {
			refused[id] = inFlightReason(product.Status)
			continue
		}
		deletable = append(deletable, id)
	}
	if len(deletable) > 0 {
		if err := s.repo.DeleteEcommerceProducts(userID, deletable); err != nil {
			return nil, err
		}
	}
	return refused, nil
}

func expandStatusFilter(status string) []string {
	switch strings.TrimSpace(status) {
	case "", "all":
		return nil
	case ecommerce.ProductStatusCompleted:
		// 「已完成」筛选含图片已完成（标题异常）——桌面版同款语义。
		return []string{ecommerce.ProductStatusCompleted, ecommerce.ProductStatusCompletedWithWarnings}
	default:
		return []string{status}
	}
}

func inFlightReason(status string) string {
	switch status {
	case ecommerce.ProductStatusQueued, ecommerce.ProductStatusRunning:
		return "任务进行中，停止或等待完成后再删除"
	case ecommerce.ProductStatusReview:
		return "方案待确认，确认或停止后再删除"
	case ecommerce.ProductStatusUncertain:
		return "结果待确认，处理后后再删除"
	default:
		return "任务尚未结束，暂不能删除"
	}
}

// sanitizeProductName 清洗 Windows 保留字符（桌面版导出与完成标准同规则）。
func sanitizeProductName(name string) string {
	replacer := strings.NewReplacer(`\`, "_", `/`, "_", `:`, "_", `*`, "_", `?`, "_", `"`, "_", `<`, "_", `>`, "_", `|`, "_")
	cleaned := strings.TrimSpace(replacer.Replace(name))
	if cleaned == "" {
		return "未命名商品"
	}
	if len([]rune(cleaned)) > 120 {
		cleaned = string([]rune(cleaned)[:120])
	}
	return cleaned
}

// resourceFileURL 原图缩略图 URL（与前端资源文件路由一致）。
func resourceFileURL(resourceID string) string {
	if resourceID == "" {
		return ""
	}
	return "/api/resources/" + resourceID + "/file"
}
