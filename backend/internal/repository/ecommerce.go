// 电商工坊域的持久化：用户统一配置与创作预设。
//
// 归属纪律：所有读写带 userID 条件，预设删除校验归属防越权。

package repository

import (
	"errors"

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
