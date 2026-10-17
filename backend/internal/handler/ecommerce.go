// 电商工坊 HTTP 层：路由组整组挂 RequireFeature(FeatureEcommerce)，
// handler 内 currentUser 鉴权；信封沿用 ok/failService。

package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// ecommercePresetView 预设对外视图：必须带 config（前端应用预设依赖它）。
type ecommercePresetView struct {
	ID        string          `json:"id"`
	UserID    string          `json:"userId"`
	Name      string          `json:"name"`
	Config    json.RawMessage `json:"config"`
	CreatedAt time.Time       `json:"createdAt"`
	UpdatedAt time.Time       `json:"updatedAt"`
}

// presetView 把存储的 ConfigJSON 解析成对象下发；损坏的配置降级为空对象（不 500）。
func presetView(preset model.EcommercePreset) ecommercePresetView {
	config := json.RawMessage(preset.ConfigJSON)
	if len(config) == 0 || !json.Valid(config) {
		config = json.RawMessage("{}")
	}
	return ecommercePresetView{
		ID: preset.ID, UserID: preset.UserID, Name: preset.Name,
		Config: config, CreatedAt: preset.CreatedAt, UpdatedAt: preset.UpdatedAt,
	}
}

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
		// 阶段 2 修复：必须下发 config（原 ConfigJSON 标记 json:"-" 导致前端拿到
		// 预设名却无法应用——「预设悬空」的真正根因）。
		items := make([]ecommercePresetView, 0, len(presets))
		for _, preset := range presets {
			items = append(items, presetView(preset))
		}
		ok(c, gin.H{"items": items})
	})
	group.POST("/presets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			Name   string               `json:"name"`
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
		ok(c, presetView(*preset))
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

	// ---- 阶段 1：方案审核与单屏精修闭环 ----
	// 确认整组方案（先审方案）：review → running 并派发所有待生成槽位。
	group.POST("/products/:id/confirm-plan", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.ConfirmEcommercePlan(c.Request.Context(), user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})
	// 暂停派发（在途子任务不取消）。
	group.POST("/products/:id/pause", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		product, err := svc.PauseEcommerceProduct(c.Request.Context(), user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, product)
	})
	// 单屏编辑仅保存（分屏编辑器「仅保存参数」）。
	group.PUT("/slots/:id/prompt", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var patch service.EcommerceSlotPromptPatch
		if err := c.ShouldBindJSON(&patch); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		slot, err := svc.UpdateEcommerceSlotPrompt(c.Request.Context(), user.ID, c.Param("id"), patch)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, slot)
	})
	// 单屏保存并重新生成（version+1，必须 confirmCost=true）。
	group.POST("/slots/:id/regenerate", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			service.EcommerceSlotPromptPatch
			ConfirmCost bool `json:"confirmCost"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		slot, err := svc.RegenerateEcommerceSlot(c.Request.Context(), user.ID, c.Param("id"), body.EcommerceSlotPromptPatch, body.ConfirmCost)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, slot)
	})

	// ---- 阶段 2：AI 策划轨（一次视觉文本策划 → 12 段编译 → 回写各屏）----
	group.POST("/products/:id/plan", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var options service.EcommercePlanOptions
		if c.Request.ContentLength > 0 {
			if err := c.ShouldBindJSON(&options); err != nil {
				fail(c, http.StatusBadRequest, errors.New("策划参数格式无效"))
				return
			}
		}
		result, err := svc.StartEcommercePlanning(c.Request.Context(), user.ID, c.Param("id"), options)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	// 把策划任务的原始文本编译并写入各屏（结构不完整则停止出图）。
	group.POST("/products/:id/apply-plan", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			Raw string `json:"raw"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		detail, err := svc.ApplyEcommercePlan(c.Request.Context(), user.ID, c.Param("id"), body.Raw)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})
}
