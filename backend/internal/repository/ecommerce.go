// 电商工坊域的持久化：用户统一配置与创作预设。
//
// 归属纪律：所有读写带 userID 条件，预设删除校验归属防越权。

package repository

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func (r *Repository) GetEcommerceUserConfig(userID string) (*model.EcommerceUserConfig, error) {
	var config model.EcommerceUserConfig
	if err := r.db.Where("user_id = ?", userID).First(&config).Error; err != nil {
		return nil, err
	}
	return &config, nil
}

func (r *Repository) UpsertEcommerceUserConfig(config *model.EcommerceUserConfig) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing model.EcommerceUserConfig
		err := tx.Where("user_id = ?", config.UserID).First(&existing).Error
		if err == nil {
			return tx.Model(&model.EcommerceUserConfig{}).Where("user_id = ?", config.UserID).
				Updates(map[string]any{"config_json": config.ConfigJSON, "updated_at": config.UpdatedAt}).Error
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Create(config).Error
	})
}

func (r *Repository) ListEcommercePresets(userID string) ([]model.EcommercePreset, error) {
	var presets []model.EcommercePreset
	if err := r.db.Where("user_id = ?", userID).Order("created_at DESC").Find(&presets).Error; err != nil {
		return nil, err
	}
	return presets, nil
}

func (r *Repository) CreateEcommercePreset(preset *model.EcommercePreset) error {
	if preset.ID == "" {
		preset.ID = kernel.NewID()
	}
	return r.db.Create(preset).Error
}

func (r *Repository) DeleteEcommercePreset(userID, presetID string) error {
	return r.db.Where("user_id = ? AND id = ?", userID, presetID).Delete(&model.EcommercePreset{}).Error
}

func (r *Repository) EcommercePresetByID(userID, presetID string) (*model.EcommercePreset, error) {
	var preset model.EcommercePreset
	if err := r.db.Where("user_id = ? AND id = ?", userID, presetID).First(&preset).Error; err != nil {
		return nil, err
	}
	return &preset, nil
}

// ---------------------------------------------------------------- 商品任务

func (r *Repository) CreateEcommerceProduct(product *model.EcommerceProduct) error {
	if product.ID == "" {
		product.ID = kernel.NewID()
	}
	return r.db.Create(product).Error
}

func (r *Repository) GetEcommerceProduct(userID, productID string) (*model.EcommerceProduct, error) {
	var product model.EcommerceProduct
	if err := r.db.Where("user_id = ? AND id = ?", userID, productID).First(&product).Error; err != nil {
		return nil, err
	}
	return &product, nil
}

// FindEcommerceProductBySource 同源查重（同一用户同一原图只建一个任务）。
func (r *Repository) FindEcommerceProductBySource(userID, resourceID string) (*model.EcommerceProduct, error) {
	var product model.EcommerceProduct
	if err := r.db.Where("user_id = ? AND source_resource_id = ?", userID, resourceID).
		Order("created_at DESC").First(&product).Error; err != nil {
		return nil, err
	}
	return &product, nil
}

// ListEcommerceProducts 列表（query 模糊匹配名称；status 过滤下推 SQL，
// completed 语义含 completed_with_warnings——由调用方展开为 IN）。
func (r *Repository) ListEcommerceProducts(userID, query string, statuses []string) ([]model.EcommerceProduct, error) {
	db := r.db.Where("user_id = ?", userID)
	if trimmed := strings.TrimSpace(query); trimmed != "" {
		db = db.Where("name LIKE ?", "%"+trimmed+"%")
	}
	if len(statuses) > 0 {
		db = db.Where("status IN ?", statuses)
	}
	var products []model.EcommerceProduct
	if err := db.Order("created_at DESC").Find(&products).Error; err != nil {
		return nil, err
	}
	return products, nil
}

func (r *Repository) RenameEcommerceProduct(userID, productID, name string) error {
	return r.db.Model(&model.EcommerceProduct{}).Where("user_id = ? AND id = ?", userID, productID).
		Updates(map[string]any{"name": name, "updated_at": time.Now()}).Error
}

// DeleteEcommerceProducts 批量删除（仅电商表行，不删 Resource 与云对象）。
// 归属校验下推 SQL；调用方负责在途预检。
func (r *Repository) DeleteEcommerceProducts(userID string, ids []string) error {
	return r.db.Where("user_id = ? AND id IN ?", userID, ids).Delete(&model.EcommerceProduct{}).Error
}

func (r *Repository) ListEcommerceSlots(productID string) ([]model.EcommerceSlot, error) {
	var slots []model.EcommerceSlot
	if err := r.db.Where("product_id = ?", productID).Order("kind, slot_no").Find(&slots).Error; err != nil {
		return nil, err
	}
	return slots, nil
}

// ListEcommerceSlotsByProductIDs 批量取槽位（列表页进度聚合，避免 N+1）。
func (r *Repository) ListEcommerceSlotsByProductIDs(productIDs []string) ([]model.EcommerceSlot, error) {
	if len(productIDs) == 0 {
		return nil, nil
	}
	var slots []model.EcommerceSlot
	if err := r.db.Where("product_id IN ?", productIDs).Order("product_id, kind, slot_no").Find(&slots).Error; err != nil {
		return nil, err
	}
	return slots, nil
}

func (r *Repository) ListEcommerceSlotVersions(slotID string) ([]model.EcommerceSlotVersion, error) {
	var versions []model.EcommerceSlotVersion
	if err := r.db.Where("slot_id = ?", slotID).Order("version DESC").Find(&versions).Error; err != nil {
		return nil, err
	}
	return versions, nil
}
