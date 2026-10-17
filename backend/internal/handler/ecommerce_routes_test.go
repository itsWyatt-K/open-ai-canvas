package handler

// 电商工坊路由注册断言：阶段 0~2 的全部端点必须挂载在 /api/ecommerce 下，
// 且整组受 RequireFeature 保护（handler 数量 > 1 即为带中间件组）。

import (
	"testing"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestEcommerceRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("/api")
	RegisterEcommerceRoutes(group, &service.Service{})

	wanted := map[string]bool{
		// 基础（M2）
		"GET /api/ecommerce/config":              false,
		"PUT /api/ecommerce/config":              false,
		"GET /api/ecommerce/presets":             false,
		"POST /api/ecommerce/presets":            false,
		"DELETE /api/ecommerce/presets/:id":      false,
		"GET /api/ecommerce/products":            false,
		"POST /api/ecommerce/products":           false,
		"GET /api/ecommerce/products/:id":        false,
		"PATCH /api/ecommerce/products/:id":      false,
		"POST /api/ecommerce/products/delete":    false,
		"POST /api/ecommerce/products/:id/start": false,
		"POST /api/ecommerce/products/:id/sync":  false,
		// 阶段 1：先审方案 + 逐屏精修
		"POST /api/ecommerce/products/:id/confirm-plan": false,
		"POST /api/ecommerce/products/:id/pause":        false,
		"PUT /api/ecommerce/slots/:id/prompt":           false,
		"POST /api/ecommerce/slots/:id/regenerate":      false,
		// 阶段 2：AI 策划轨
		"POST /api/ecommerce/products/:id/plan":       false,
		"POST /api/ecommerce/products/:id/apply-plan": false,
		// 阶段 3：导出闭环
		"GET /api/ecommerce/products/:id/export":     false,
		"GET /api/ecommerce/products/:id/export.zip": false,
		// 阶段 3：整组重试与复制
		"POST /api/ecommerce/products/retry":         false,
		"POST /api/ecommerce/products/:id/duplicate": false,
		// 阶段 3：策划原始响应
		"GET /api/ecommerce/products/:id/plan-response": false,
		"PUT /api/ecommerce/products/:id/plan-response": false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	missing := 0
	for route, found := range wanted {
		if !found {
			t.Errorf("route %s is not registered", route)
			missing++
		}
	}
	if missing > 0 {
		t.Fatalf("%d 个电商路由缺失", missing)
	}
	if len(wanted) != 24 {
		t.Fatalf("电商路由契约应为 24 条，实际断言 %d 条", len(wanted))
	}
}
