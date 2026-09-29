// [LOCAL] 补回上游 v1.5.8.2 新增的 Repository.SystemSettingOptional。
//
// 背景：三方合并 internal/repository/repository.go 时，我方对该文件的重度改动
// 使该新增方法在合并结果中丢失，而 internal/platform/runtime_policy.go（上游新文件）
// 依赖它。此处按上游语义等价补回，避免整文件回退我方改动。
package repository

import "infinite-canvas/backend/internal/model"

// SystemSettingOptional 读取系统设置；不存在时返回 (nil, nil)。
func (r *Repository) SystemSettingOptional(key string) (*model.SystemSetting, error) {
	var setting model.SystemSetting
	if err := r.db.Where("key = ?", key).Limit(1).Find(&setting).Error; err != nil {
		return nil, err
	}
	if setting.Key == "" {
		return nil, nil
	}
	return &setting, nil
}
