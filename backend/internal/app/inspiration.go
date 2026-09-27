package app

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// 灵感库（AI 视频/图像/UI/文案案例库）领域服务。
// 与既有 domain 委托模式一致：handler → Service 方法 → 本结构直接查库。

// InspirationListQuery 灵感库案例列表查询参数。
type InspirationListQuery struct {
	MediaType   string
	Category    string
	ModelFamily string
	ReproStatus string
	Keyword     string
	Sort        string
	Page        int
	Size        int
	UserID      string
}

// InspirationCasePage 灵感库案例分页结果。
type InspirationCasePage struct {
	Items []InspirationCaseView `json:"items"`
	Total int64                 `json:"total"`
	Page  int                   `json:"page"`
	Size  int                   `json:"size"`
}

// InspirationCaseView 案例对外视图（含收藏状态）。
type InspirationCaseView struct {
	model.InspirationCase
	Tags       []string                `json:"tags"`
	Models     []string                `json:"models"`
	Prompts    []model.InspirationPrompt `json:"prompts"`
	MediaPaths []string                `json:"mediaPaths"`
	MediaURL   string                  `json:"mediaUrl"`
	CoverURL   string                  `json:"coverUrl"`
	Favorited  bool                    `json:"favorited"`
}

// InspirationStats 灵感库统计。
type InspirationStats struct {
	Total        int64 `json:"total"`
	Video        int64 `json:"video"`
	Image        int64 `json:"image"`
	UI           int64 `json:"ui"`
	Copy         int64 `json:"copy"`
	Retests      int64 `json:"retests"`
	LocalRetests int64 `json:"localRetests"`
}

func (s *Service) inspirationDB() *gorm.DB {
	return s.repo.InspirationDB()
}

// ListInspirationCases 分页 + 筛选查询灵感库案例。
func (s *Service) ListInspirationCases(q InspirationListQuery) (*InspirationCasePage, error) {
	db := s.inspirationDB()
	if q.Page < 1 {
		q.Page = 1
	}
	if q.Size < 1 || q.Size > 100 {
		q.Size = 24
	}
	tx := db.Model(&model.InspirationCase{})
	if v := strings.TrimSpace(q.MediaType); v != "" && v != "all" {
		tx = tx.Where("media_type = ?", v)
	}
	if v := strings.TrimSpace(q.Category); v != "" {
		tx = tx.Where("category = ?", v)
	}
	if v := strings.TrimSpace(q.ModelFamily); v != "" {
		tx = tx.Where("model_family = ?", v)
	}
	if v := strings.TrimSpace(q.ReproStatus); v != "" {
		tx = tx.Where("repro_status = ?", v)
	}
	if v := strings.TrimSpace(q.Keyword); v != "" {
		like := "%" + v + "%"
		tx = tx.Where("title LIKE ? OR summary LIKE ? OR prompts LIKE ?", like, like, like)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, err
	}
	order := "score DESC"
	if q.Sort == "newest" {
		order = "created_at DESC"
	}
	var cases []model.InspirationCase
	if err := tx.Order(order).Offset((q.Page - 1) * q.Size).Limit(q.Size).Find(&cases).Error; err != nil {
		return nil, err
	}
	favSet := s.inspirationFavSet(q.UserID, cases)
	items := make([]InspirationCaseView, 0, len(cases))
	for i := range cases {
		items = append(items, buildInspirationView(&cases[i], favSet))
	}
	return &InspirationCasePage{Items: items, Total: total, Page: q.Page, Size: q.Size}, nil
}

// GetInspirationCase 查询单条案例详情（含复现记录）。
func (s *Service) GetInspirationCase(id uint, userID string) (*InspirationCaseView, []model.InspirationRetest, error) {
	db := s.inspirationDB()
	var cs model.InspirationCase
	if err := db.First(&cs, id).Error; err != nil {
		return nil, nil, err
	}
	var retests []model.InspirationRetest
	if err := db.Where("case_id = ?", id).Order("tested_at DESC").Find(&retests).Error; err != nil {
		return nil, nil, err
	}
	favSet := map[uint]bool{}
	if strings.TrimSpace(userID) != "" {
		var cnt int64
		db.Model(&model.InspirationFavorite{}).Where("user_id = ? AND case_id = ?", userID, id).Count(&cnt)
		favSet[id] = cnt > 0
	}
	view := buildInspirationView(&cs, favSet)
	return &view, retests, nil
}

// ListFavoriteInspirationCases 当前用户收藏列表。
func (s *Service) ListFavoriteInspirationCases(userID string) (*InspirationCasePage, error) {
	db := s.inspirationDB()
	var favs []model.InspirationFavorite
	if err := db.Where("user_id = ?", userID).Order("created_at DESC").Find(&favs).Error; err != nil {
		return nil, err
	}
	ids := make([]uint, 0, len(favs))
	favSet := map[uint]bool{}
	for _, f := range favs {
		ids = append(ids, f.CaseID)
		favSet[f.CaseID] = true
	}
	var cases []model.InspirationCase
	if len(ids) > 0 {
		if err := db.Where("id IN ?", ids).Find(&cases).Error; err != nil {
			return nil, err
		}
	}
	items := make([]InspirationCaseView, 0, len(cases))
	for i := range cases {
		items = append(items, buildInspirationView(&cases[i], favSet))
	}
	return &InspirationCasePage{Items: items, Total: int64(len(items)), Page: 1, Size: len(items)}, nil
}

// ToggleInspirationFavorite 收藏/取消收藏（幂等）。
func (s *Service) ToggleInspirationFavorite(userID string, caseID uint) (bool, error) {
	db := s.inspirationDB()
	var cnt int64
	db.Model(&model.InspirationFavorite{}).Where("user_id = ? AND case_id = ?", userID, caseID).Count(&cnt)
	if cnt > 0 {
		if err := db.Where("user_id = ? AND case_id = ?", userID, caseID).Delete(&model.InspirationFavorite{}).Error; err != nil {
			return false, err
		}
		return false, nil
	}
	fav := model.InspirationFavorite{UserID: userID, CaseID: caseID, CreatedAt: time.Now()}
	if err := db.Create(&fav).Error; err != nil {
		return false, err
	}
	return true, nil
}

// InspirationStats 汇总统计。
func (s *Service) InspirationStatsSnapshot() (*InspirationStats, error) {
	db := s.inspirationDB()
	st := &InspirationStats{}
	count := func(dst *int64, mediaType string) error {
		return db.Model(&model.InspirationCase{}).Where("media_type = ?", mediaType).Count(dst).Error
	}
	if err := db.Model(&model.InspirationCase{}).Count(&st.Total).Error; err != nil {
		return nil, err
	}
	for _, m := range []struct {
		dst *int64
		mt  string
	}{{&st.Video, "video"}, {&st.Image, "image"}, {&st.UI, "ui"}, {&st.Copy, "copy"}} {
		if err := count(m.dst, m.mt); err != nil {
			return nil, err
		}
	}
	if err := db.Model(&model.InspirationRetest{}).Count(&st.Retests).Error; err != nil {
		return nil, err
	}
	if err := db.Model(&model.InspirationRetest{}).Where("origin = ?", "local").Count(&st.LocalRetests).Error; err != nil {
		return nil, err
	}
	return st, nil
}

func (s *Service) inspirationFavSet(userID string, cases []model.InspirationCase) map[uint]bool {
	favSet := map[uint]bool{}
	if strings.TrimSpace(userID) == "" || len(cases) == 0 {
		return favSet
	}
	ids := make([]uint, 0, len(cases))
	for i := range cases {
		ids = append(ids, cases[i].ID)
	}
	var favs []model.InspirationFavorite
	s.inspirationDB().Where("user_id = ? AND case_id IN ?", userID, ids).Find(&favs)
	for _, f := range favs {
		favSet[f.CaseID] = true
	}
	return favSet
}

func buildInspirationView(cs *model.InspirationCase, favSet map[uint]bool) InspirationCaseView {
	view := InspirationCaseView{InspirationCase: *cs, Favorited: favSet[cs.ID]}
	if cs.Tags != "" {
		_ = json.Unmarshal([]byte(cs.Tags), &view.Tags)
	}
	if cs.Models != "" {
		_ = json.Unmarshal([]byte(cs.Models), &view.Models)
	}
	if cs.Prompts != "" {
		_ = json.Unmarshal([]byte(cs.Prompts), &view.Prompts)
	}
	if cs.MediaPaths != "" {
		_ = json.Unmarshal([]byte(cs.MediaPaths), &view.MediaPaths)
	}
	if cs.VideoPath != "" {
		view.MediaURL = "/api/inspiration/media/" + cs.SourceID + "/video.mp4"
	}
	if cs.CoverPath != "" {
		view.CoverURL = "/api/inspiration/media/" + cs.SourceID + "/cover.jpg"
	} else if cs.PosterURL != "" {
		view.CoverURL = cs.PosterURL
	}
	return view
}

// ParseUint 辅助：handler 解析路径参数。
func ParseUint(s string) (uint, error) {
	v, err := strconv.ParseUint(s, 10, 64)
	return uint(v), err
}

// DataDir 返回后端数据目录（媒体/资源落盘根）。
func (s *Service) DataDir() string { return s.dataDir }
