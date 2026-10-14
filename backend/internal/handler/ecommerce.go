// 电商工坊 HTTP 层：路由组整组挂 RequireFeature(FeatureEcommerce)，
// handler 内 currentUser 鉴权；信封沿用 ok/failService。

package handler

import (
	"errors"
	"net/http"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterEcommerceRoutes(api *gin.RouterGroup, svc *service.Service) {
	group := api.Group("/ecommerce")
	group.Use(RequireFeature(svc, service.FeatureEcommerce))

	// ---- 配置与预设（B3）----
	group.GET("/config", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		cfg, err := svc.EcommerceConfig(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, cfg)
	})
	group.PUT("/config", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var cfg ecommerce.ConfigView
		if err := c.ShouldBindJSON(&cfg); err != nil {
			fail(c, http.StatusBadRequest, errors.New("配置格式无效"))
			return
		}
		saved, err := svc.SaveEcommerceConfig(user.ID, cfg)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, saved)
	})
	group.GET("/presets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		presets, err := svc.ListEcommercePresets(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": presets})
	})
	group.POST("/presets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			Name   string              `json:"name"`
			Config ecommerce.ConfigView `json:"config"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("预设格式无效"))
			return
		}
		preset, err := svc.SaveEcommercePreset(user.ID, body.Name, body.Config)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, preset)
	})
	group.DELETE("/presets/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteEcommercePreset(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	// ---- 商品任务（B4）----
	group.POST("/products", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			Items []struct {
				ResourceID string `json:"resourceId"`
				Name       string `json:"name"`
			} `json:"items"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("导入参数格式无效"))
			return
		}
		items := make([]service.ImportItem, 0, len(body.Items))
		for _, item := range body.Items {
			items = append(items, service.ImportItem{ResourceID: item.ResourceID, Name: item.Name})
		}
		created, skipped, err := svc.ImportEcommerceProducts(user.ID, items)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": created, "skipped": skipped})
	})
	group.GET("/products", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, total, err := svc.ListEcommerceProducts(user.ID, c.Query("query"), c.Query("status"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": items, "total": total})
	})
	group.GET("/products/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		// 详情即对账：把已收尾子任务的结果回写到槽位版本与商品状态，
		// 前端刷新页面即可看到最新进度（无需额外轮询接口）。
		detail, err := svc.SyncEcommerceProduct(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})
	group.PATCH("/products/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			Name string `json:"name"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		if err := svc.RenameEcommerceProduct(user.ID, c.Param("id"), body.Name); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"updated": true})
	})
	group.POST("/products/delete", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			IDs []string `json:"ids"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		refused, err := svc.DeleteEcommerceProducts(user.ID, body.IDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": len(body.IDs) - len(refused), "refused": refused})
	})

	// ---- 任务动作（M3 编排器）----
	group.POST("/products/:id/start", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body service.EcommerceStartOptions
		if c.Request.ContentLength > 0 {
			if err := c.ShouldBindJSON(&body); err != nil {
				fail(c, http.StatusBadRequest, errors.New("启动参数格式无效"))
				return
			}
		}
		result, err := svc.StartEcommerceProduct(user.ID, c.Param("id"), body)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	// 对账：把子任务终态回写到槽位版本与商品状态（详情接口也会隐式对账）。
	group.POST("/products/:id/sync", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.SyncEcommerceProduct(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})
}
