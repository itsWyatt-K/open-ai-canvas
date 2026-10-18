package ecommerce

import "testing"

// B3a 配置契约测试（go 环境就绪即跑；本机无 Go，测试先行的 TDD 纪律）。

func TestValidateConfig_合法配置通过(t *testing.T) {
	cfg := DefaultConfigView()
	cfg.Platform = "自定义平台A"
	cfg.Mode = ModeReview
	cfg.Quality = QualityHigh
	if err := ValidateConfig(cfg); err != nil {
		t.Fatalf("合法配置应通过: %v", err)
	}
}

func TestValidateConfig_非法用例(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*ConfigView)
	}{
		{"并发0", func(c *ConfigView) { c.TaskConcurrency = 0 }},
		{"并发6", func(c *ConfigView) { c.TaskConcurrency = 6 }},
		{"模式非法", func(c *ConfigView) { c.Mode = "turbo" }},
		{"质量非法", func(c *ConfigView) { c.Quality = "ultra" }},
		{"自定义超长", func(c *ConfigView) { c.Platform = string(make([]rune, 501)) }},
		{"文字模式非法", func(c *ConfigView) { c.Hero.TextMode = "both" }},
		{"自定义比例无宽高", func(c *ConfigView) { c.Hero.Ratio = "7:5" }},
		{"主图数量0", func(c *ConfigView) { c.Hero.Count = 0 }},
		{"标题数量0", func(c *ConfigView) { c.TitleCount = 0 }},
		{"重试为负", func(c *ConfigView) { c.MaxRetries = -1 }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := DefaultConfigView()
			tc.mutate(&cfg)
			if err := ValidateConfig(cfg); err == nil {
				t.Fatalf("%s：应报错却通过", tc.name)
			}
		})
	}
}

func TestValidateConfig_自定义比例合法宽高通过(t *testing.T) {
	cfg := DefaultConfigView()
	cfg.Detail.Ratio = "7:5"
	cfg.Detail.Width = 1400
	cfg.Detail.Height = 1000
	if err := ValidateConfig(cfg); err != nil {
		t.Fatalf("自定义比例+合法宽高应通过: %v", err)
	}
}

func TestMergeWithDefault_缺省补齐与显式空串(t *testing.T) {
	// 空 stored → 全默认（阶段 4：默认模式为 review，未确认不扣费）。
	merged := MergeWithDefault(ConfigView{})
	if merged.TaskConcurrency != 2 || merged.Mode != ModeReview || merged.Hero.TextMode != TextModeTypeset {
		t.Fatalf("空配置应补全默认: %+v", merged)
	}
	// 显式值覆盖；显式空串保持为空（不补默认）
	merged = MergeWithDefault(ConfigView{TaskConcurrency: 5, Language: "", Quality: QualityLow})
	if merged.TaskConcurrency != 5 {
		t.Fatalf("显式并发应覆盖: %d", merged.TaskConcurrency)
	}
	if merged.Language != "" {
		t.Fatalf("显式空串应保持为空: %q", merged.Language)
	}
	if merged.Quality != QualityLow {
		t.Fatalf("显式质量应覆盖: %q", merged.Quality)
	}
}

func TestNormalizeConfigJSON(t *testing.T) {
	merged, err := NormalizeConfigJSON(`{"taskConcurrency":3,"platform":"抖音"}`)
	if err != nil {
		t.Fatalf("合法 JSON 应通过: %v", err)
	}
	// 阶段 4：缺省模式改为 review（先审方案，未确认不扣费）。
	if merged.TaskConcurrency != 3 || merged.Platform != "抖音" || merged.Mode != ModeReview {
		t.Fatalf("解析+补齐结果不符: %+v", merged)
	}
	if _, err := NormalizeConfigJSON(`{"taskConcurrency":9}`); err == nil {
		t.Fatal("非法并发应报错")
	}
	if _, err := NormalizeConfigJSON(`not-json`); err == nil {
		t.Fatal("坏 JSON 应报错")
	}
}
