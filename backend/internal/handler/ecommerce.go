// 电商工坊 HTTP 层：路由组整组挂 RequireFeature(FeatureEcommerce)，
// handler 内 currentUser 鉴权；信封沿用 ok/failService。

package handler

import (
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
			failService(c, NewAppError(http.StatusBadRequest, "配置格式无效"))
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
			failService(c, NewAppError(http.StatusBadRequest, "预设格式无效"))
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
			failService(c, NewAppError(http.StatusBadRequest, "导入参数格式无效"))
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
		detail, err := svc.EcommerceProductDetail(user.ID, c.Param("id"))
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
			failService(c, NewAppError(http.StatusBadRequest, "参数格式无效"))
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
			failService(c, NewAppError(http.StatusBadRequest, "参数格式无效"))
			return
		}
		refused, err := svc.DeleteEcommerceProducts(user.ID, body.IDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": len(body.IDs) - len(refused), "refused": refused})
	})

	// ---- 任务动作占位（B5-B8 编排器后接）----
	group.POST("/products/:id/start", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		_ = user
		failService(c, NewAppError(http.StatusNotImplemented, "编排器施工中（M3），暂时无法启动"))
	})
}
