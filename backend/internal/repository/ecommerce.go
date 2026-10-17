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

// ---------------------------------------------------------------- 编排器写路径
//
// 纪律：编排器是写路径，所有更新都带主键或归属条件；批量插入走事务，
// 避免「槽位已建、版本未建」的半成品状态。

// CreateEcommerceSlots 批量建槽位（同商品同 kind+slot_no 幂等跳过由调用方保证）。
func (r *Repository) CreateEcommerceSlots(slots []model.EcommerceSlot) error {
	if len(slots) == 0 {
		return nil
	}
	for index := range slots {
		if slots[index].ID == "" {
			slots[index].ID = kernel.NewID()
		}
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		return tx.CreateInBatches(&slots, 50).Error
	})
}

// CreateEcommerceSlotVersion 新建槽位版本快照（唯一 (slot_id, version)）。
func (r *Repository) CreateEcommerceSlotVersion(version *model.EcommerceSlotVersion) error {
	if version.ID == "" {
		version.ID = kernel.NewID()
	}
	return r.db.Create(version).Error
}

// EcommerceSlotVersionByID 按主键取版本（编排器回写用，无归属条件——
// 调用方已通过商品归属校验，版本表无 user_id 列）。
func (r *Repository) EcommerceSlotVersionByID(id string) (*model.EcommerceSlotVersion, error) {
	var version model.EcommerceSlotVersion
	if err := r.db.Where("id = ?", id).First(&version).Error; err != nil {
		return nil, err
	}
	return &version, nil
}

// ListEcommerceSlotVersionsByChildTaskIDs 按子任务 ID 批量取版本
// （对账时一次查完，避免 N+1）。
func (r *Repository) ListEcommerceSlotVersionsByChildTaskIDs(taskIDs []string) ([]model.EcommerceSlotVersion, error) {
	ids := make([]string, 0, len(taskIDs))
	for _, id := range taskIDs {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			ids = append(ids, trimmed)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	var versions []model.EcommerceSlotVersion
	if err := r.db.Where("child_task_id IN ?", ids).Find(&versions).Error; err != nil {
		return nil, err
	}
	return versions, nil
}

// UpdateEcommerceSlotVersionResult 回写版本终态：状态 + 产物资源 + 失败原因。
func (r *Repository) UpdateEcommerceSlotVersionResult(versionID, status, resourceID, errorMessage string) error {
	updates := map[string]any{"status": status}
	if strings.TrimSpace(resourceID) != "" {
		updates["resource_id"] = resourceID
	}
	if strings.TrimSpace(errorMessage) != "" {
		updates["error_message"] = errorMessage
	}
	return r.db.Model(&model.EcommerceSlotVersion{}).Where("id = ?", versionID).Updates(updates).Error
}

// UpdateEcommerceSlotDispatch 写槽位派发态：状态 + 生成提示词 + 视觉方案快照。
func (r *Repository) UpdateEcommerceSlotDispatch(slotID, status, generationPrompt, visualPlanJSON string, currentVersion int) error {
	updates := map[string]any{"status": status, "updated_at": time.Now()}
	if strings.TrimSpace(generationPrompt) != "" {
		updates["generation_prompt"] = generationPrompt
	}
	if strings.TrimSpace(visualPlanJSON) != "" {
		updates["visual_plan_json"] = visualPlanJSON
	}
	if currentVersion > 0 {
		updates["current_version"] = currentVersion
	}
	return r.db.Model(&model.EcommerceSlot{}).Where("id = ?", slotID).Updates(updates).Error
}

// UpdateEcommerceSlotStatus 只更新槽位状态（对账回写用）。
func (r *Repository) UpdateEcommerceSlotStatus(slotID, status string) error {
	return r.db.Model(&model.EcommerceSlot{}).Where("id = ?", slotID).
		Updates(map[string]any{"status": status, "updated_at": time.Now()}).Error
}

// EcommerceSlotByID 按主键取槽位（跨用户校验由 service 层做：先取商品验属主）。
func (r *Repository) EcommerceSlotByID(slotID string) (*model.EcommerceSlot, error) {
	var slot model.EcommerceSlot
	if err := r.db.Where("id = ?", slotID).First(&slot).Error; err != nil {
		return nil, err
	}
	return &slot, nil
}

// SetEcommerceProductExecutionMode 写执行模式与状态原因（先审方案断点 / 确认时用）。
func (r *Repository) SetEcommerceProductExecutionMode(userID, productID, mode, statusReason string) error {
	return r.db.Model(&model.EcommerceProduct{}).Where("id = ? AND user_id = ?", productID, userID).
		Updates(map[string]any{
			"execution_mode": mode,
			"status_reason":  statusReason,
			"updated_at":     time.Now(),
		}).Error
}

// UpdateEcommerceSlotPlan 更新单屏可编辑字段（分屏编辑器「仅保存参数」）。
// 空 promptOverride 表示清除覆盖（回落自动组装）；其余字段按传入值整体覆盖。
func (r *Repository) UpdateEcommerceSlotPlan(slotID string, patch map[string]any) error {
	if len(patch) == 0 {
		return nil
	}
	patch["updated_at"] = time.Now()
	return r.db.Model(&model.EcommerceSlot{}).Where("id = ?", slotID).Updates(patch).Error
}

// UpdateEcommerceProductPlanJSON 只写方案原文（人工修正稿暂存，不改状态）。
func (r *Repository) UpdateEcommerceProductPlanJSON(userID, productID, planJSON string) error {
	return r.db.Model(&model.EcommerceProduct{}).Where("id = ? AND user_id = ?", productID, userID).
		Updates(map[string]any{"plan_json": planJSON, "updated_at": time.Now()}).Error
}

// ResetEcommerceProductForRetry 整组重试：round+1、清空编排态、槽位回到待生成。
//
// 不物理删除历史：槽位与版本行保留（旧轮次的图仍在），只把编排视图重置，
// 以便重新按最新配置派发。CurrentVersion 保留，新版本号在其上继续递增。
func (r *Repository) ResetEcommerceProductForRetry(userID, productID string, nextRound int) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.EcommerceProduct{}).
			Where("id = ? AND user_id = ?", productID, userID).
			Updates(map[string]any{
				"round":         nextRound,
				"status":        "draft",
				"status_reason": "",
				"error_message": "",
				"plan_json":     "",
				"paused":        false,
				"updated_at":    time.Now(),
			}).Error; err != nil {
			return err
		}
		return tx.Model(&model.EcommerceSlot{}).
			Where("product_id = ?", productID).
			Updates(map[string]any{
				"status":     "pending",
				"updated_at": time.Now(),
			}).Error
	})
}

// UpdateEcommerceProductRun 写商品编排态：状态 + 标题状态 + 方案快照与修订号。
func (r *Repository) UpdateEcommerceProductRun(userID, productID, status, titleStatus, planJSON string, planRevision int) error {
	updates := map[string]any{"status": status, "updated_at": time.Now()}
	if strings.TrimSpace(titleStatus) != "" {
		updates["title_status"] = titleStatus
	}
	if strings.TrimSpace(planJSON) != "" {
		updates["plan_json"] = planJSON
	}
	if planRevision > 0 {
		updates["plan_revision"] = planRevision
	}
	return r.db.Model(&model.EcommerceProduct{}).Where("user_id = ? AND id = ?", userID, productID).
		Updates(updates).Error
}

// UpdateEcommerceProductStatus 只更新商品状态与原因（对账回写用）。
func (r *Repository) UpdateEcommerceProductStatus(userID, productID, status, titleStatus, statusReason string) error {
	updates := map[string]any{"status": status, "updated_at": time.Now()}
	if strings.TrimSpace(titleStatus) != "" {
		updates["title_status"] = titleStatus
	}
	updates["status_reason"] = statusReason
	return r.db.Model(&model.EcommerceProduct{}).Where("user_id = ? AND id = ?", userID, productID).
		Updates(updates).Error
}

// UpdateEcommerceProductBrief 编排前同步卖点与视觉锚点（导入接口只带名称）。
func (r *Repository) UpdateEcommerceProductBrief(userID, productID, sellingPoints, extraRequirements string) error {
	updates := map[string]any{"updated_at": time.Now()}
	if strings.TrimSpace(sellingPoints) != "" {
		updates["selling_points"] = sellingPoints
	}
	if strings.TrimSpace(extraRequirements) != "" {
		updates["extra_requirements"] = extraRequirements
	}
	return r.db.Model(&model.EcommerceProduct{}).Where("user_id = ? AND id = ?", userID, productID).
		Updates(updates).Error
}

// UpsertEcommercePreset 预设写入（按 user+id 幂等；无 id 时新建）。
func (r *Repository) UpsertEcommercePreset(preset *model.EcommercePreset) error {
	if strings.TrimSpace(preset.ID) == "" {
		preset.ID = kernel.NewID()
		preset.CreatedAt = time.Now()
	}
	preset.UpdatedAt = time.Now()
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing model.EcommercePreset
		err := tx.Where("user_id = ? AND id = ?", preset.UserID, preset.ID).First(&existing).Error
		if err == nil {
			return tx.Model(&model.EcommercePreset{}).Where("user_id = ? AND id = ?", preset.UserID, preset.ID).
				Updates(map[string]any{"name": preset.Name, "config_json": preset.ConfigJSON, "updated_at": preset.UpdatedAt}).Error
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Create(preset).Error
	})
}

// UpdateEcommerceSlotVersionStatus 更新槽位版本状态（停止生成时中止未终态版本）。
func (r *Repository) UpdateEcommerceSlotVersionStatus(versionID, status, errorMessage string) error {
	updates := map[string]any{"status": status, "error_message": errorMessage}
	return r.db.Model(&model.EcommerceSlotVersion{}).Where("id = ?", versionID).Updates(updates).Error
}

// UpdateEcommerceProductFields 通用商品字段更新（调用方负责组装白名单字段）。
func (r *Repository) UpdateEcommerceProductFields(userID, productID string, updates map[string]any) error {
	if len(updates) == 0 {
		return nil
	}
	return r.db.Model(&model.EcommerceProduct{}).Where("id = ? AND user_id = ?", productID, userID).Updates(updates).Error
}
