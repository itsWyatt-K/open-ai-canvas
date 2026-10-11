package repository

import (
	"errors"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

// [LOCAL] SaveShotArtifactForTask（D-055 乙案）：无工作流步骤语境的镜头产物登记。
//
// 上游 v1.6.0 的产物登记统一走 RegisterWorkflowTaskOutput（步骤语境，含
// workflow 实例与项目 revision 推进）。本地 D-055 乙案需要「无步骤但有镜头」
// 的落产物路径，因此按上游同语义在本文件落地一个只写 shot_artifacts 单表的
// 幂等方法：
//   - 按 (task_id, shot_id, type) 去重，已登记则幂等返回；
//   - 版本号取同 (shot_id, type) 当前 MAX(version)+1；
//   - selected 为真时先把同 (shot_id, type) 旧行 selected 清零。
//
// 不触碰 workflow 步骤/实例、ProductionTaskLink、资产库与项目 revision——
// 那些语义都属于步骤语境。
func (r *Repository) SaveShotArtifactForTask(artifact *model.ShotArtifact) error {
	if artifact == nil {
		return nil
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing model.ShotArtifact
		if err := tx.Where("task_id = ? AND shot_id = ? AND type = ?", artifact.TaskID, artifact.ShotID, artifact.Type).First(&existing).Error; err == nil {
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var currentVersion int
		if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Select("COALESCE(MAX(version), 0)").Scan(&currentVersion).Error; err != nil {
			return err
		}
		artifact.Version = currentVersion + 1
		if artifact.Selected {
			if err := tx.Model(&model.ShotArtifact{}).Where("shot_id = ? AND type = ?", artifact.ShotID, artifact.Type).Updates(map[string]any{"selected": false, "updated_at": artifact.UpdatedAt}).Error; err != nil {
				return err
			}
		}
		return tx.Create(artifact).Error
	})
}
