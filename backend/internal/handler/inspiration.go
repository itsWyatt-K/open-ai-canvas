package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterInspirationRoutes 注册灵感库（AI 视频/图像/UI/文案案例库）API。
func RegisterInspirationRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/inspiration/cases", func(c *gin.Context) {
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		size, _ := strconv.Atoi(c.DefaultQuery("size", "24"))
		q := app.InspirationListQuery{
			MediaType:   c.Query("mediaType"),
			Category:    c.Query("category"),
			ModelFamily: c.Query("modelFamily"),
			ReproStatus: c.Query("reproStatus"),
			Keyword:     c.Query("keyword"),
			Sort:        c.Query("sort"),
			Page:        page,
			Size:        size,
		}
		if user, err := currentUser(c, svc); err == nil {
			q.UserID = user.ID
		}
		result, err := svc.ListInspirationCases(q)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/inspiration/cases/:id", func(c *gin.Context) {
		id, err := strconv.ParseUint(c.Param("id"), 10, 64)
		if err != nil {
			failService(c, service.BadAuthRequest("非法案例 ID"))
			return
		}
		var userID string
		if user, err := currentUser(c, svc); err == nil {
			userID = user.ID
		}
		view, retests, err := svc.GetInspirationCase(uint(id), userID)
		if err != nil {
			failService(c, service.BadAuthRequest("案例不存在"))
			return
		}
		ok(c, gin.H{"case": view, "retests": retests})
	})

	r.POST("/inspiration/cases/:id/favorite", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		id, err := strconv.ParseUint(c.Param("id"), 10, 64)
		if err != nil {
			failService(c, service.BadAuthRequest("非法案例 ID"))
			return
		}
		favorited, err := svc.ToggleInspirationFavorite(user.ID, uint(id))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"favorited": favorited})
	})

	r.GET("/inspiration/favorites", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.ListFavoriteInspirationCases(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/inspiration/stats", func(c *gin.Context) {
		stats, err := svc.InspirationStatsSnapshot()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, stats)
	})

	// 本地媒体静态服务：/api/inspiration/media/<slug>/<file>
	mediaRoot := filepath.Join(svc.DataDir(), "inspiration", "media")
	r.GET("/inspiration/media/*filepath", func(c *gin.Context) {
		rel := strings.TrimPrefix(c.Param("filepath"), "/")
		if rel == "" || strings.Contains(rel, "..") {
			c.Status(http.StatusBadRequest)
			return
		}
		full := filepath.Join(mediaRoot, filepath.FromSlash(rel))
		info, err := os.Stat(full)
		if err != nil || info.IsDir() {
			c.Status(http.StatusNotFound)
			return
		}
		switch strings.ToLower(filepath.Ext(full)) {
		case ".mp4", ".mov", ".webm":
			c.Header("Content-Type", "video/mp4")
			c.Header("Accept-Ranges", "bytes")
		case ".jpg", ".jpeg":
			c.Header("Content-Type", "image/jpeg")
		case ".png":
			c.Header("Content-Type", "image/png")
		case ".webp":
			c.Header("Content-Type", "image/webp")
		}
		c.Header("Cache-Control", "public, max-age=86400")
		c.File(full)
	})
}
