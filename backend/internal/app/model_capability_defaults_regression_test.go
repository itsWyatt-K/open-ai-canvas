package app

import "testing"

// 回归守卫：默认能力配置（测试夹具与「未配置专属表」渠道共用的兜底路径）
// 必须能通过能力合同校验——否则这些渠道的模型会被目录读路径整批静默剔除
// （此前 3:2→1216x832 漂移 2.57% 超出旧 2.5% 容差，触发整目录为空）。
func TestDefaultModelCapabilityConfigPassesValidation(t *testing.T) {
	for _, tc := range []struct {
		protocol, model string
		capability      string
	}{
		{"", "generic-image", "image"},
		{"", "generic-text", "text"},
		{"", "generic-video", "video"},
		{"openai-image", "gpt-image-2.5", "image"},
	} {
		config := DefaultModelCapabilityConfigForModel(tc.protocol, tc.model)
		normalized, err := NormalizeModelCapabilityConfigForModel(tc.capability, tc.protocol, tc.model, config)
		if err != nil {
			t.Fatalf("默认配置校验失败 protocol=%q model=%q: %v", tc.protocol, tc.model, err)
		}
		if normalized == nil {
			t.Fatalf("默认配置被归一化为空 protocol=%q model=%q", tc.protocol, tc.model)
		}
	}
}

// 标准兜底表逐项过比例一致性校验（主表是兜底换算的唯一真源，逐项钉死）。
func TestStandardImageSizeFallbackTablePassesRatioConsistency(t *testing.T) {
	presets := standardImageSizePresetsForRatios(standardImageSizeFallbackRatios())
	if len(presets) != len(standardImageSizeFallbackTable) {
		t.Fatalf("兜底表应有 %d 项预设，实际 %d", len(standardImageSizeFallbackTable), len(presets))
	}
	config := DefaultModelCapabilityConfigForModel("", "generic-image")
	if config.Image == nil {
		t.Fatal("默认图片能力缺失")
	}
	// 用兜底预设替换默认预设后整包校验。
	config.Image.Size.Presets = presets
	if _, err := NormalizeModelCapabilityConfigForModel("image", "", "generic-image", config); err != nil {
		t.Fatalf("标准兜底表存在比例一致性违例: %v", err)
	}
}
