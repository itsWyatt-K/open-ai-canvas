package model

import "time"

// 电商工坊（Ecommerce Workshop）域数据模型。
//
// 依据合作方《电商工坊后端实现计划》Task 1（2026-10-11）落地；
// 编排语义：商品任务是编排实体，不直接调模型——各阶段派发为普通画布
// 子任务（Service.CreateTask），复用逻辑模型路由/能力校验/三段式计费。
// 状态语义硬约束（桌面版同款）：
//   - uncertain（结果待确认）不自动重发；
//   - 已发请求按派发时参数收尾；
//   - 成功成品不因改配置自动重做。

// EcommerceProduct 商品任务（编排实体，表 ecommerce_products）。
type EcommerceProduct struct {
	ID                 string    `json:"id" gorm:"primaryKey;size:36"`
	UserID             string    `json:"userId" gorm:"size:36;index;index:idx_ecommerce_products_user_created,priority:1"`
	Name               string    `json:"name" gorm:"size:200"`
	Round              int       `json:"round" gorm:"index"`
	SourceResourceID   string    `json:"sourceResourceId" gorm:"size:36;index"`
	SourceName         string    `json:"sourceName" gorm:"size:200"`
	SellingPoints      string    `json:"sellingPoints" gorm:"size:2000"`
	ExtraRequirements  string    `json:"extraRequirements" gorm:"size:2000"`
	Status             string    `json:"status" gorm:"size:40;index"`
	StatusReason       string    `json:"statusReason,omitempty" gorm:"size:500"`
	ConfigSnapshotJSON string    `json:"-" gorm:"type:text"`
	PlanJSON           string    `json:"-" gorm:"type:text"`
	PlanRevision       int       `json:"planRevision"`
	TitleStatus        string    `json:"titleStatus" gorm:"size:40"`
	TitleText          string    `json:"titleText,omitempty" gorm:"type:text"`
	TitleChildTaskID   string    `json:"titleChildTaskId,omitempty" gorm:"size:36;index"`
	Paused             bool      `json:"paused"`
	ErrorMessage       string    `json:"errorMessage,omitempty" gorm:"size:1000"`
	DiagJSON           string    `json:"-" gorm:"type:text"`
	CreatedAt          time.Time `json:"createdAt" gorm:"index:idx_ecommerce_products_user_created,priority:2"`
	UpdatedAt          time.Time `json:"updatedAt"`

	// ---- v56：执行模式快照（先审方案 / 全自动）----
	// 派发时从 ConfigSnapshot 冻结，确认方案与恢复派发时据此判定，避免配置被改后语义漂移。
	ExecutionMode string `json:"executionMode,omitempty" gorm:"size:32"`
}

func (EcommerceProduct) TableName() string { return "ecommerce_products" }

// EcommerceSlot 槽位（主图 hero / 详情页 detail，表 ecommerce_slots）。
type EcommerceSlot struct {
	ID               string    `json:"id" gorm:"primaryKey;size:36"`
	ProductID        string    `json:"productId" gorm:"size:36;index:idx_ecommerce_slots_product_kind_no,priority:1"`
	Kind             string    `json:"kind" gorm:"size:20;index:idx_ecommerce_slots_product_kind_no,priority:2"`
	SlotNo           int       `json:"slotNo" gorm:"index:idx_ecommerce_slots_product_kind_no,priority:3"`
	SlotKey          string    `json:"slotKey" gorm:"size:40"`
	Title            string    `json:"title,omitempty" gorm:"size:200"`
	Copy             string    `json:"copy,omitempty" gorm:"size:2000"`
	Status           string    `json:"status" gorm:"size:40;index"`
	PlanRevision     int       `json:"planRevision"`
	GenerationPrompt string    `json:"generationPrompt,omitempty" gorm:"type:text"`
	VisualPlanJSON   string    `json:"-" gorm:"type:text"`
	CurrentVersion   int       `json:"currentVersion"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`

	// ---- v56：分屏编辑器（对齐 pr(1) CommerceScreen 字段）----
	// PromptOverride 完整提示词覆盖：非空时最高优先，AI 重策划不得覆盖（pr(1) 纪律）。
	PromptOverride string `json:"promptOverride,omitempty" gorm:"type:text"`
	// SceneType 本屏场景类型（产品特写 / 使用场景 / 参数说明）。
	SceneType string `json:"sceneType,omitempty" gorm:"size:200"`
	// SellingPoints 本屏绑定的已确认卖点事实。
	SellingPoints string `json:"sellingPoints,omitempty" gorm:"type:text"`
	// AspectRatio 单屏比例覆盖（空 = 跟随本组）。
	AspectRatio string `json:"aspectRatio,omitempty" gorm:"size:32"`
	// ReferenceIDsJSON 单屏风格参考图 ResourceID 数组（JSON 字符串，仅参与策划）。
	ReferenceIDsJSON string `json:"referenceIdsJson,omitempty" gorm:"type:text"`
	// PlanFingerprint 视觉方案去重指纹（防 7 屏雷同，对齐 pr(1) compileCommerceDetailPlan）。
	PlanFingerprint string `json:"planFingerprint,omitempty" gorm:"size:128"`
}

func (EcommerceSlot) TableName() string { return "ecommerce_slots" }

// EcommerceSlotVersion 槽位版本（表 ecommerce_slot_versions，唯一 (slot_id,version)）。
type EcommerceSlotVersion struct {
	ID                   string    `json:"id" gorm:"primaryKey;size:36"`
	SlotID               string    `json:"slotId" gorm:"size:36;uniqueIndex:idx_ecommerce_slot_versions_slot_version,priority:1"`
	Version              int       `json:"version" gorm:"uniqueIndex:idx_ecommerce_slot_versions_slot_version,priority:2"`
	Prompt               string    `json:"prompt,omitempty" gorm:"type:text"`
	DispatchSnapshotJSON string    `json:"-" gorm:"type:text"`
	ChildTaskID          string    `json:"childTaskId,omitempty" gorm:"size:36;index"`
	Status               string    `json:"status" gorm:"size:40;index"`
	ResourceID           string    `json:"resourceId,omitempty" gorm:"size:36;index"`
	ErrorMessage         string    `json:"errorMessage,omitempty" gorm:"size:1000"`
	DiagJSON             string    `json:"-" gorm:"type:text"`
	CreatedAt            time.Time `json:"createdAt"`
}

func (EcommerceSlotVersion) TableName() string { return "ecommerce_slot_versions" }

// EcommerceUserConfig 用户统一配置（每用户一行，表 ecommerce_user_configs）。
type EcommerceUserConfig struct {
	UserID     string    `json:"userId" gorm:"primaryKey;size:36"`
	ConfigJSON string    `json:"-" gorm:"type:text"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

func (EcommerceUserConfig) TableName() string { return "ecommerce_user_configs" }

// EcommercePreset 创作预设（表 ecommerce_presets）。
type EcommercePreset struct {
	ID         string    `json:"id" gorm:"primaryKey;size:36"`
	UserID     string    `json:"userId" gorm:"size:36;index"`
	Name       string    `json:"name" gorm:"size:120"`
	ConfigJSON string    `json:"-" gorm:"type:text"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

func (EcommercePreset) TableName() string { return "ecommerce_presets" }
