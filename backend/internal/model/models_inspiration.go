package model

import "time"

// 灵感库（AI 视频/图像/UI/文案案例库）数据模型。
// 数据源：awesome-seedance GitHub 仓库（Seedance 视频子集）+ goodcase.ai 母库（全媒介）。
// 设计原则：原始提示词多版本存档（Prompts JSON 数组），复现结论独立成表（GoodCase 跨模型复测本土化）。

// MediaType 媒介类型（一级分流）。
const (
	InspirationMediaVideo = "video"
	InspirationMediaImage = "image"
	InspirationMediaUI    = "ui"
	InspirationMediaCopy  = "copy"
)

// ReproStatus 复现状态。ui/copy 恒为 na。
const (
	InspirationReproNA      = "na"
	InspirationReproPending = "pending"
	InspirationReproRunning = "running"
	InspirationReproDone    = "done"
	InspirationReproFailed  = "failed"
	InspirationReproSkipped = "skipped"
)

// BatchStatus 复现批次状态。
const (
	InspirationBatchDraft   = "draft"
	InspirationBatchRunning = "running"
	InspirationBatchPaused  = "paused"
	InspirationBatchDone    = "done"
)

// InspirationCase 一条灵感库案例。
type InspirationCase struct {
	ID           uint    `gorm:"primaryKey" json:"id"`
	SourceRepo   string  `gorm:"index;size:32" json:"sourceRepo"` // awesome-seedance | goodcase
	SourceID     string  `gorm:"index;size:128" json:"sourceId"`  // 源案例 slug
	Title        string  `gorm:"index;size:512" json:"title"`
	Summary      string  `gorm:"type:text" json:"summary"`
	TitleEN      string  `gorm:"size:512" json:"titleEn"`
	SummaryEN    string  `gorm:"type:text" json:"summaryEn"`
	MediaType    string  `gorm:"index;size:16" json:"mediaType"`   // video | image | ui | copy
	Category     string  `gorm:"index;size:64" json:"category"`    // 模板类（handheld-ugc-vlog 等）
	CategoryName string  `gorm:"size:128" json:"categoryName"`     // 模板类中文名
	Tags         string  `gorm:"type:text" json:"-"`               // JSON array
	ModelFamily  string  `gorm:"index;size:64" json:"modelFamily"` // Seedance 2.5 / MiniMax H3 / GPT Image ...
	Models       string  `gorm:"type:text" json:"-"`               // JSON array（源 models 字段）
	Creator      string  `gorm:"size:128" json:"creator"`
	CoverPath    string  `gorm:"size:512" json:"-"`  // 本地封面相对路径
	VideoPath    string  `gorm:"size:512" json:"-"`  // 本地视频相对路径（仅 video）
	MediaPaths   string  `gorm:"type:text" json:"-"` // 多媒体 JSON 数组（image/ui 多图）
	MediaURL     string  `gorm:"size:1024" json:"-"` // 远端原地址（本地缺失时回退）
	PosterURL    string  `gorm:"size:1024" json:"posterUrl"`
	Prompts      string  `gorm:"type:text" json:"-"` // 多版本提示词 JSON 数组
	SourceURL    string  `gorm:"size:1024" json:"sourceUrl"`
	GoodcaseURL  string  `gorm:"size:1024" json:"goodcaseUrl"`
	Score        float64 `json:"score"`
	Stability    float64 `json:"stability"`
	Evidence     string  `gorm:"index;size:8" json:"evidence"` // L0/L1/L2（源 evidenceLevel）
	ReproStatus  string  `gorm:"index;size:16" json:"reproStatus"`
	BatchID      uint    `gorm:"index" json:"batchId"` // 所属复现批次（0 = 未入批）
	Process      string  `gorm:"type:text" json:"-"`   // 创作过程 JSON
	License      string  `gorm:"size:128" json:"license"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (InspirationCase) TableName() string { return "inspiration_cases" }

// InspirationPrompt 一条案例的单个提示词版本（Prompts 数组元素）。
type InspirationPrompt struct {
	Version string `json:"version"` // sd-2.5 | h3-native | h3-adapted | gpt-image | nano-banana | canvas-revised | other
	Text    string `json:"text"`
	Note    string `json:"note"` // 适配说明：改了什么、为什么
}

// InspirationRetest 一次复现记录（含 GoodCase 官方复测基线）。
type InspirationRetest struct {
	ID           uint      `gorm:"primaryKey" json:"id"`
	CaseID       uint      `gorm:"index" json:"caseId"`
	Origin       string    `gorm:"index;size:16" json:"origin"` // goodcase（官方基线）| local（我们自己的复现）
	Model        string    `gorm:"index;size:64" json:"model"`  // MiniMax H3 Max 768p / minimax-h3 等
	ModelVersion string    `gorm:"size:32" json:"modelVersion"` // 768p / 480p / 10s / 15s
	TaskID       string    `gorm:"index;size:128" json:"taskId"`
	VideoPath    string    `gorm:"size:512" json:"videoPath"` // 本地复现产物相对路径
	VideoURL     string    `gorm:"size:1024" json:"videoUrl"`
	Score        float64   `json:"score"`
	Conclusion   string    `gorm:"index;size:16" json:"conclusion"` // reproduced | degraded | failed | inconclusive
	Notes        string    `gorm:"type:text" json:"notes"`
	TestedAt     time.Time `json:"testedAt"`
	CreatedAt    time.Time `json:"createdAt"`
}

func (InspirationRetest) TableName() string { return "inspiration_retests" }

// InspirationFavorite 用户收藏（按 UserID 隔离，UserID 为 users 主键字符串）。
type InspirationFavorite struct {
	ID        uint   `gorm:"primaryKey"`
	UserID    string `gorm:"size:36;uniqueIndex:idx_insp_user_case"`
	CaseID    uint   `gorm:"uniqueIndex:idx_insp_user_case"`
	CreatedAt time.Time
}

func (InspirationFavorite) TableName() string { return "inspiration_favorites" }

// InspirationBatch 复现批次（10 条一批，最小管理单元）。
type InspirationBatch struct {
	ID           uint   `gorm:"primaryKey"`
	Name         string `gorm:"size:128"` // 灵感库复现-B01-0925
	Status       string `gorm:"index;size:16"`
	CaseIDs      string `gorm:"type:text"` // JSON array
	Total        int
	Succeeded    int
	Failed       int
	DailyQuota   int // 每日复现上限（0 = 不限）
	SpentCredits float64
	Notes        string `gorm:"type:text"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (InspirationBatch) TableName() string { return "inspiration_batches" }
