package app

import (
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// B3 配置与预设 service 测试（SQLite 内存库 + Service{repo: repository.New(db)} 字面量）。
// 注：模型 ID 非空的用例需全量 Service（platform 路由在位），本测试只覆盖
// 「模型留空」与「校验先于模型解析」路径——未知模型报错用例待全量环境（见 impl-log）。

func newEcommerceTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.EcommerceUserConfig{}, &model.EcommercePreset{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}
}

func TestEcommerceConfig_缺省读取返回全默认(t *testing.T) {
	svc := newEcommerceTestService(t)
	cfg, err := svc.EcommerceConfig("user-a")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.TaskConcurrency != 2 || cfg.Mode != "auto" || cfg.Hero.TextMode != "typeset" {
		t.Fatalf("缺省补齐结果不符: %+v", cfg)
	}
}

func TestEcommerceConfig_保存后读回一致(t *testing.T) {
	svc := newEcommerceTestService(t)
	cfg, err := svc.EcommerceConfig("user-a")
	if err != nil {
		t.Fatal(err)
	}
	cfg.TaskConcurrency = 4
	cfg.Platform = "抖音"
	cfg.Quality = "high"
	saved, err := svc.SaveEcommerceConfig("user-a", *cfg)
	if err != nil {
		t.Fatal(err)
	}
	if saved.TaskConcurrency != 4 || saved.Platform != "抖音" || saved.Quality != "high" {
		t.Fatalf("保存返回不符: %+v", saved)
	}
	readBack, err := svc.EcommerceConfig("user-a")
	if err != nil {
		t.Fatal(err)
	}
	if readBack.TaskConcurrency != 4 || readBack.Platform != "抖音" || readBack.Quality != "high" {
		t.Fatalf("读回不一致: %+v", readBack)
	}
}

func TestEcommerceConfig_非法并发报错400(t *testing.T) {
	svc := newEcommerceTestService(t)
	cfg, err := svc.EcommerceConfig("user-a")
	if err != nil {
		t.Fatal(err)
	}
	cfg.TaskConcurrency = 9
	_, err = svc.SaveEcommerceConfig("user-a", *cfg)
	if err == nil {
		t.Fatal("非法并发应报错")
	}
	if !strings.Contains(err.Error(), "1~5") {
		t.Fatalf("错误信息应含区间提示: %v", err)
	}
}

func TestEcommercePreset_增列删与只存创作参数(t *testing.T) {
	svc := newEcommerceTestService(t)
	cfg, err := svc.EcommerceConfig("user-a")
	if err != nil {
		t.Fatal(err)
	}
	cfg.Platform = "小红书"
	preset, err := svc.SaveEcommercePreset("user-a", "小红书默认", *cfg)
	if err != nil {
		t.Fatal(err)
	}
	if preset.Name != "小红书默认" {
		t.Fatalf("预设名称不符: %q", preset.Name)
	}
	// 只存创作参数：config JSON 不得含任何密钥/URL 字段名
	for _, banned := range []string{"apiKey", "secret", "token", "baseURL", "proxyURL"} {
		if strings.Contains(preset.ConfigJSON, banned) {
			t.Fatalf("预设不得包含 %s 字段", banned)
		}
	}
	list, err := svc.ListEcommercePresets("user-a")
	if err != nil {
		t.Fatal(err)
	}
	// 阶段 2 起：列表 = 用户自建 1 条 + 内置 2 条（通用电商标准、独乐岛）。
	if len(list) != 3 {
		t.Fatalf("预设列表应 3 条（1 用户 + 2 内置）: %d", len(list))
	}
	if !hasBuiltinPreset(t, list, ecommerce.GeneralPresetKey) {
		t.Fatal("缺少内置通用预设（系统默认）")
	}
	if !hasBuiltinPreset(t, list, ecommerce.SoloIslandPresetKey) {
		t.Fatal("缺少内置独乐岛预设（可选）")
	}
	// 归属防越权：他人删不掉
	if err := svc.DeleteEcommercePreset("user-b", preset.ID); err == nil {
		t.Fatal("他人删除应报错")
	}
	if err := svc.DeleteEcommercePreset("user-a", preset.ID); err != nil {
		t.Fatal(err)
	}
	list, err = svc.ListEcommercePresets("user-a")
	if err != nil {
		t.Fatal(err)
	}
	// 删掉用户自建后，仍应剩 2 条内置（内置不可被用户删除语义：这里删的是自建 ID）。
	if len(list) != 2 {
		t.Fatalf("删除用户预设后应剩 2 条内置: %d", len(list))
	}
}

// hasBuiltinPreset 断言列表中存在指定 key 的内置预设。
func hasBuiltinPreset(t *testing.T, list []model.EcommercePreset, key string) bool {
	t.Helper()
	for _, item := range list {
		config, err := ecommerce.NormalizePresetConfig(item.ConfigJSON)
		if err != nil {
			continue
		}
		if config.Key == key {
			return true
		}
	}
	return false
}

func TestEcommercePreset_空名称与空ID(t *testing.T) {
	svc := newEcommerceTestService(t)
	cfg, err := svc.EcommerceConfig("user-a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveEcommercePreset("user-a", "  ", *cfg); err == nil {
		t.Fatal("空预设名称应报错")
	}
	if err := svc.DeleteEcommercePreset("user-a", "not-exist"); err == nil {
		t.Fatal("删除不存在预设应报错")
	}
}
