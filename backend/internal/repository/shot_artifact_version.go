package repository

import (
	"gorm.io/gorm"

	"infinite-canvas/backend/internal/model"
)

// nextShotArtifactVersion 取 (shot_id, type) 的下一个版本号，
// 保证同类型产物版本递增不撞唯一约束。
//
// 历史位置：原在 internal/repository/comfy_bridge.go，该文件随上游删除
// Comfy Bridge 一并移除；W1-01 的产物版本逻辑仍依赖它，故单独保留在此。
func nextShotArtifactVersion(tx *gorm.DB, shotID string, artifactType string) (int, error) {
	var current int
	if err := tx.Model(&model.ShotArtifact{}).
		Where("shot_id = ? AND type = ?", shotID, artifactType).
		Select("COALESCE(MAX(version), 0)").Scan(&current).Error; err != nil {
		return 0, err
	}
	return current + 1, nil
}
