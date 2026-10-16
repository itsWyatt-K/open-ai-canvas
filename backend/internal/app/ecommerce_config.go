// 电商工坊配置与预设 service。
//
// 语义（桌面版同款）：
//   - 读取缺省补齐（缺失补默认、显式空串保持为空，见 ecommerce.MergeWithDefault）；
//   - 保存前校验（ecommerce.ValidateConfig）+ 模型存在性校验；
//   - 预设只存创作参数（config JSON），不存任何密钥/URL。

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// EcommerceConfig 读取用户统一配置（缺省补齐）。
func (s *Service) EcommerceConfig(userID string) (*ecommerce.ConfigView, error) {
	stored, err := s.repo.GetEcommerceUserConfig(userID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	raw := ""
	if stored != nil {
		raw = stored.ConfigJSON
	}
	merged, err := ecommerce.NormalizeConfigJSON(raw)
	if err != nil {
		return nil, NewAppError(http.StatusBadRequest, fmt.Sprintf("电商配置无效：%v", err))
	}
	return &merged, nil
}

// SaveEcommerceConfig 保存并应用配置。
//
// 模型校验当前为存在性级别（可解析即通过）；「策划/标题必须看图、生图必须支持参考图」
// 的细粒度能力断言标注 [待接线]——RoutedModel 能力断言签名待核实，本机无 Go 工具链
// 不可试错，按纪律不臆造 API（见 impl-log 验证债务）。
func (s *Service) SaveEcommerceConfig(userID string, cfg ecommerce.ConfigView) (*ecommerce.ConfigView, error) {
	if err := ecommerce.ValidateConfig(cfg); err != nil {
		return nil, NewAppError(http.StatusBadRequest, err.Error())
	}
	if err := s.validateEcommerceModels(cfg); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	if err := s.repo.UpsertEcommerceUserConfig(&model.EcommerceUserConfig{
		UserID:     userID,
		ConfigJSON: string(encoded),
		UpdatedAt:  now,
	}); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// validateEcommerceModels 模型存在性校验：planner/title/image 三个模型 ID 非空时
// 必须可解析（带参考图的生图意图）。
func (s *Service) validateEcommerceModels(cfg ecommerce.ConfigView) error {
	intent := ModelRequestIntent{Capability: "image", Inputs: map[string]int{"image": 1}}
	for _, item := range []struct{ role, id string }{
		{"策划模型", cfg.PlannerModelID},
		{"标题模型", cfg.TitleModelID},
		{"生图模型", cfg.ImageModelID},
	} {
		if strings.TrimSpace(item.id) == "" {
			continue // 留空=用默认，不拦
		}
		if _, err := s.ResolveLogicalModel(item.id, intent); err != nil {
			return NewAppError(http.StatusBadRequest, fmt.Sprintf("%s不可用：%v", item.role, err))
		}
	}
	return nil
}

// ListEcommercePresets 用户创作预设列表（按创建时间倒序）。
//
// 阶段 0 修复：读取前先幂等确保内置预设（独乐岛 7 屏）已落库，
// 否则首次打开「生成配置」栏时列表为空（原逻辑只在 start 编排时才落库）。
// ensure 失败不阻断用户自定义预设的读取——降级为仅返回用户预设。
func (s *Service) ListEcommercePresets(userID string) ([]model.EcommercePreset, error) {
	if err := s.ensureBuiltinEcommercePresets(userID); err != nil {
		log.Printf("[ecommerce] ensure builtin presets failed user=%s: %v", userID, err)
	}
	return s.repo.ListEcommercePresets(userID)
}

// SaveEcommercePreset 保存创作预设（name + 完整 config）。
func (s *Service) SaveEcommercePreset(userID, name string, cfg ecommerce.ConfigView) (*model.EcommercePreset, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, NewAppError(http.StatusBadRequest, "预设名称不能为空")
	}
	if err := ecommerce.ValidateConfig(cfg); err != nil {
		return nil, NewAppError(http.StatusBadRequest, err.Error())
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		return nil, err
	}
	preset := &model.EcommercePreset{
		UserID:     userID,
		Name:       trimmed,
		ConfigJSON: string(encoded),
	}
	if err := s.repo.CreateEcommercePreset(preset); err != nil {
		return nil, err
	}
	return preset, nil
}

// DeleteEcommercePreset 删除创作预设（归属校验防越权）。
func (s *Service) DeleteEcommercePreset(userID, presetID string) error {
	if _, err := s.repo.EcommercePresetByID(userID, presetID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("预设不存在")
		}
		return err
	}
	return s.repo.DeleteEcommercePreset(userID, presetID)
}
