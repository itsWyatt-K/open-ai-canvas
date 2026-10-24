// 电商工坊 HTTP 层：路由组整组挂 RequireFeature(FeatureEcommerce)，
// handler 内 currentUser 鉴权；信封沿用 ok/failService。

package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
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
		// 阶段 4：第 1 步引导区支持改名称/卖点/附加要求（失焦即存）。
		var body struct {
			Name              *string `json:"name"`
			SellingPoints     *string `json:"sellingPoints"`
			ExtraRequirements *string `json:"extraRequirements"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		if body.Name != nil {
			if err := svc.RenameEcommerceProduct(user.ID, c.Param("id"), *body.Name); err != nil {
				failService(c, err)
				return
			}
		}
		if body.SellingPoints != nil || body.ExtraRequirements != nil {
			if err := svc.UpdateEcommerceProductBrief(user.ID, c.Param("id"), body.SellingPoints, body.ExtraRequirements); err != nil {
				failService(c, err)
				return
			}
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
		// 阶段 4：draft 态一键确认需要模型参数（用于合成各屏方案后派发）。
		var options service.EcommerceStartOptions
		if c.Request.ContentLength > 0 {
			if err := c.ShouldBindJSON(&options); err != nil {
				fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
				return
			}
		}
		detail, err := svc.ConfirmEcommercePlan(c.Request.Context(), user.ID, c.Param("id"), options)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})
	// ---- 阶段 5：三步向导 · 平台切换 ----
	// 切换上架平台：更新配置（平台/张数/比例/语言）并按平台模板重建未派发槽位。
	group.POST("/products/:id/apply-platform", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			Platform string `json:"platform"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		detail, config, err := svc.ApplyEcommercePlatform(c.Request.Context(), user.ID, c.Param("id"), body.Platform)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"detail": detail, "config": config})
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
	// v60：L1 人话企划保存（改完自动重编译 L2；ai_hint=AI 换个思路，秒级确定性变体）。
	group.PUT("/slots/:id/brief", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var patch service.EcommerceBriefPatch
		if err := c.ShouldBindJSON(&patch); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		slot, brief, err := svc.UpdateEcommerceSlotBrief(c.Request.Context(), user.ID, c.Param("id"), patch)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"slot": slot, "brief": brief})
	})
	// v60：四层交付清单回写（图层精修台保存）。
	group.PUT("/slots/:id/layers", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var manifest service.EcommerceLayerManifest
		if err := c.ShouldBindJSON(&manifest); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		slot, err := svc.SaveEcommerceSlotLayers(c.Request.Context(), user.ID, c.Param("id"), manifest)
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
			ChannelID   string `json:"channelId"`
			Model       string `json:"model"`
			ConfirmCost bool   `json:"confirmCost"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		slot, err := svc.RegenerateEcommerceSlot(c.Request.Context(), user.ID, c.Param("id"), body.EcommerceSlotPromptPatch, service.EcommerceSlotRegenerateOptions{
			ChannelID: body.ChannelID,
			Model:     body.Model,
		}, body.ConfirmCost)
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

	// ---- 阶段 3：导出闭环 ----
	group.GET("/products/:id/export", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		manifest, err := svc.EcommerceExportManifest(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, manifest)
	})
	group.GET("/products/:id/export.zip", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		// 先写内存缓冲：既能在失败时返回结构化错误，又避免半截 zip 污染下载。
		buffer := &bytes.Buffer{}
		if err := svc.EcommerceExportZip(user.ID, c.Param("id"), buffer); err != nil {
			failService(c, err)
			return
		}
		fileName := sanitizeExportFileName(c.Param("id")) + ".zip"
		c.Header("Content-Disposition", "attachment; filename=\""+fileName+"\"")
		c.DataFromReader(http.StatusOK, int64(buffer.Len()), "application/zip", buffer, nil)
	})

	// ---- 阶段 3：整组重试与复制 ----
	group.POST("/products/retry", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var body struct {
			ProductIDs  []string `json:"productIds"`
			ConfirmCost bool     `json:"confirmCost"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("参数格式无效"))
			return
		}
		result, err := svc.RetryEcommerceProducts(user.ID, body.ProductIDs, body.ConfirmCost)
		if err != nil {
			// 部分成功时也把结果带回，便于前端展示「哪些被拒」。
			if result != nil && len(result.Retried) > 0 {
				ok(c, result)
				return
			}
			failService(c, err)
			return
		}
		ok(c, result)
	})
	group.POST("/products/:id/duplicate", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		product, err := svc.DuplicateEcommerceProduct(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, product)
	})

	// ---- 阶段 3：策划原始响应查看 / 人工修正 ----
	group.GET("/products/:id/plan-response", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.GetEcommercePlanResponse(c.Request.Context(), user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	group.PUT("/products/:id/plan-response", func(c *gin.Context) {
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
		detail, err := svc.UpdateEcommercePlanResponse(c.Request.Context(), user.ID, c.Param("id"), body.Raw)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})
}

// sanitizeExportFileName 生成下载文件名（仅 ASCII 安全字符，避免 header 注入）。
func sanitizeExportFileName(productID string) string {
	cleaned := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, productID)
	if cleaned == "" {
		return "ecommerce-export"
	}
	return "ecommerce-" + cleaned
}
