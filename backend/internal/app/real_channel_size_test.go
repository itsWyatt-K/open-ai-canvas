package app

import (
	"os"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"yingce/backend/internal/model"
)

// TestRealChannelModelSizeResolutionOnRealDB 用**真实数据库**里的渠道模型配置，
// 验证「只声明比例、没有专属像素换算表」的线路（现场故障线路 yingce-image-2.5）
// 在缺表时不再被「缺少像素尺寸换算表」阻断，并能把比例换算成内置标准像素尺寸。
//
// 该测试默认跳过：只有显式给出数据库路径时才运行，保证 CI 不依赖本机数据。
//
//	ECOMMERCE_REAL_DB=D:/AlcheMvision/open-ai-canvas/.local/data/open_ai_canvas.db \
//	  go test ./internal/app -run TestRealChannelModelSizeResolutionOnRealDB -v
func TestRealChannelModelSizeResolutionOnRealDB(t *testing.T) {
	dbPath := os.Getenv("ECOMMERCE_REAL_DB")
	if dbPath == "" {
		t.Skip("未设置 ECOMMERCE_REAL_DB，跳过真实数据库验证")
	}
	if _, err := os.Stat(dbPath); err != nil {
		t.Skipf("真实数据库不存在：%v", err)
	}
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("打开真实数据库失败：%v", err)
	}

	var record model.ChannelModel
	if err := db.Where("model_key = ?", "yingce-image-2.5").First(&record).Error; err != nil {
		t.Skipf("真实数据库中没有 yingce-image-2.5：%v", err)
	}
	t.Logf("线路：%s（protocol=%s，capability=%s）", record.ModelKey, record.Protocol, record.Capability)
	t.Logf("库内声明 size.values（换算表补表前）：%s", record.CapabilityConfigJSON)

	// 走与派发完全一致的归一化路径：解出能力配置 → 补缺表 → 就绪检查。
	normalized, err := normalizedChannelModelCapability(&record)
	if err != nil {
		t.Fatalf("归一化渠道模型能力配置失败：%v", err)
	}
	imageProfile := DefaultImageCapabilityConfig(string(record.Protocol), firstNonEmpty(record.ProviderModelKey, record.ModelKey))
	if normalized != nil && normalized.Image != nil {
		imageProfile = normalized.Image
	}
	fillMissingImageSizePresets(imageProfile, string(record.Protocol))
	if err := imageSizePresetReadyError(imageProfile, string(record.Protocol)); err != nil {
		t.Fatalf("缺表线路仍被阻断（返工令要求严禁直接报错）：%v", err)
	}
	t.Logf("补表后预设条数：%d，默认档位：%s", len(imageProfile.Size.Presets), imageProfile.Size.DefaultTier)
	for _, preset := range imageProfile.Size.Presets {
		t.Logf("  预设 %s @ %s → %s", preset.Ratio, preset.Tier, preset.Size)
	}

	// 现场故障复现：抖音 3:4 槽位。
	cases := []struct{ ratio, want string }{
		{"1:1", "1024x1024"},
		{"3:4", "768x1024"},
		{"4:3", "1024x768"},
		{"9:16", "720x1280"},
		{"16:9", "1280x720"},
	}
	for _, testCase := range cases {
		got := resolveImageTaskSize(imageProfile, string(record.Protocol), testCase.ratio, "")
		t.Logf("比例 %s → 像素 %s", testCase.ratio, got)
		if got != testCase.want {
			t.Errorf("比例 %s 应换算为 %s，实际 %s", testCase.ratio, testCase.want, got)
		}
		if !containsCapabilityString(imageProfile.Size.Values, got) {
			t.Errorf("换算出的像素 %s 未出现在线路支持值中（保存路径会校验失败）", got)
		}
	}
}
