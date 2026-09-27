package repository

import "gorm.io/gorm"

// InspirationDB 暴露底层 *gorm.DB 供灵感库领域查询。
// 灵感库是自包含的只读为主数据集，不走完整 repository 方法族。
func (r *Repository) InspirationDB() *gorm.DB {
	return r.db
}
