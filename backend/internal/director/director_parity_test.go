package director

import (
	"io/fs"
	"strings"
	"testing"
	"unicode/utf8"

	builtinAssets "yingce/backend/builtin"
)

// 门禁 2：Go ↔ Python 校验器对账单测。
// 夹具与 scripts/validate_prompt.py::self_test() 同源重建（由
// scripts/gen_director_parity_fixtures.py 从权威 Python 模块导出，杜绝转录漂移），
// 不仅复刻 9 组正反用例的 ok/失败判定，还逐案对齐 error/warning 数量。

// directorParityJimeng 是 self_test 的 jimeng 正向夹具（即梦 + mapped + 干声）。
const directorParityJimeng = "【本批上传ID映射】\n| 提示词槽位 | 用户应上传的资产 | 当前准备状态 | 唯一职责 |\n|---|---|---|---|\n| 图1 | 客厅场景图 | 用户已有 | 锁定空间 |\n| 音频1 | 艾玛干声 | 待用户准备 | 锁定音色 |\n\n【风格锁定】\n自然主义雪夜惊悚片，使用ARRI Alexa 35与Cooke电影镜头，21:9，24fps；冷暗低饱和，雪反冷光，真实木材与皮肤质感。\n【素材映射】\n@用于锁定客厅，绑定后简称“图1”。\n@为艾玛声音，绑定后简称“音频1”。\n【场景与空间锚点】\n午夜客厅内，艾玛站在图1门边；门在画面右侧，走廊在画面左侧。\n【声音与音乐总则】\n使用音频1，无BGM。\n【镜头序列】\n镜头1（0.0—2.0秒｜近景）\n机位与构图：头肩近景，摄影机位于艾玛正前方；焦点落在艾玛双眼，背景轻微虚化。\n运镜：固定机位。\n    画面内容：艾玛转头。艾玛（音频1，呼吸急促、低声而坚决）：“快走。”\n镜头2（2.0—4.0秒｜中景）\n机位与构图：腰部中景，摄影机位于艾玛侧面；焦点落在艾玛面部，背景走廊轻微虚化。\n运镜：侧向跟拍。\n画面内容：艾玛跑开。\n【全局补充】\n无字幕。"

func TestDirectorParityPromptSelfTest(t *testing.T) {
	jimeng := directorParityJimeng
	libtv := strings.ReplaceAll(jimeng, "@用于锁定客厅，绑定后简称“图1”。\n@为艾玛声音，绑定后简称“音频1”。", "{{Image 1}}用于锁定客厅。\n{{Audio 1}}为艾玛声音。")
	bad := strings.ReplaceAll(jimeng, "@用于锁定客厅，绑定后简称“图1”。", "@图片1用于锁定客厅。")
	over15 := strings.ReplaceAll(jimeng, "2.0—4.0秒", "2.0—16.0秒")
	missingVoice := strings.ReplaceAll(strings.ReplaceAll(jimeng, "@为艾玛声音，绑定后简称“音频1”。\n", ""), "艾玛（音频1，呼吸急促、低声而坚决）", "艾玛低声说")
	textModelVoice := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(jimeng,
		"【本批上传ID映射】\n| 提示词槽位 | 用户应上传的资产 | 当前准备状态 | 唯一职责 |\n|---|---|---|---|\n| 图1 | 客厅场景图 | 用户已有 | 锁定空间 |\n| 音频1 | 艾玛干声 | 待用户准备 | 锁定音色 |\n\n",
		""),
		"【素材映射】\n@用于锁定客厅，绑定后简称“图1”。\n@为艾玛声音，绑定后简称“音频1”。\n",
		""),
		"图1门边", "旧木屋客厅门边"),
		"使用音频1，无BGM。", "保留安静房间底噪，无BGM。")
	textModelVoice = strings.ReplaceAll(textModelVoice, "艾玛（音频1，呼吸急促、低声而坚决）", "艾玛（呼吸急促、语速稍快、低声而坚决）")
	badTextImage := strings.ReplaceAll(textModelVoice, "旧木屋客厅门边", "{{Image 1}}中的客厅门边")

	// 与 Python self_test 同一算式：payload 长度按 rune 计，x 填充到恰好 5000。
	payloadLength := utf8.RuneCountInString(extractPromptPayload(jimeng, "new"))
	if payloadLength != 383 {
		t.Fatalf("jimeng payload length = %d, want 383", payloadLength)
	}
	atLimit := jimeng + strings.Repeat("x", maxVideoPromptChars-payloadLength)
	overLimit := atLimit + "x"

	variants := map[string]string{
		"jimeng": jimeng, "libtv": libtv, "bad-at-alias": bad, "over-15s-on-2.0": over15,
		"missing-voice": missingVoice, "text-model-voice": textModelVoice,
		"text-with-image-placeholder": badTextImage, "at-limit": atLimit, "over-limit": overLimit,
	}

	cases := []struct {
		name                        string
		platform, mode, modelVersion string
		assetMode, voiceMode         string
		wantOK                       bool
		wantErrors, wantWarnings     int
	}{
		{name: "jimeng", platform: "jimeng", mode: "new", modelVersion: "2.5", assetMode: "mapped", voiceMode: "mapped_dry_voice", wantOK: true, wantErrors: 0, wantWarnings: 0},
		{name: "libtv", platform: "libtv", mode: "new", modelVersion: "2.5", assetMode: "mapped", voiceMode: "mapped_dry_voice", wantOK: true, wantErrors: 0, wantWarnings: 0},
		{name: "bad-at-alias", platform: "jimeng", mode: "new", modelVersion: "2.5", assetMode: "mapped", voiceMode: "mapped_dry_voice", wantOK: false, wantErrors: 4, wantWarnings: 0},
		{name: "over-15s-on-2.0", platform: "jimeng", mode: "new", modelVersion: "2.0", assetMode: "mapped", voiceMode: "mapped_dry_voice", wantOK: false, wantErrors: 1, wantWarnings: 0},
		{name: "missing-voice", platform: "jimeng", mode: "new", modelVersion: "2.5", assetMode: "mapped", voiceMode: "mapped_dry_voice", wantOK: false, wantErrors: 4, wantWarnings: 0},
		{name: "text-model-voice", platform: "jimeng", mode: "new", modelVersion: "2.5", assetMode: "text", voiceMode: "model_voice", wantOK: true, wantErrors: 0, wantWarnings: 1},
		{name: "text-with-image-placeholder", platform: "libtv", mode: "new", modelVersion: "2.5", assetMode: "text", voiceMode: "model_voice", wantOK: false, wantErrors: 2, wantWarnings: 1},
		{name: "at-limit", platform: "jimeng", mode: "new", modelVersion: "2.5", assetMode: "mapped", voiceMode: "mapped_dry_voice", wantOK: true, wantErrors: 0, wantWarnings: 2},
		{name: "over-limit", platform: "jimeng", mode: "new", modelVersion: "2.5", assetMode: "mapped", voiceMode: "mapped_dry_voice", wantOK: false, wantErrors: 1, wantWarnings: 1},
	}
	for _, tc := range cases {
		text, ok := variants[tc.name]
		if !ok {
			t.Fatalf("missing fixture for %s", tc.name)
		}
		result := ValidateVideoPrompt(PromptValidateRequest{
			Text: text, Platform: tc.platform, Mode: tc.mode, ModelVersion: tc.modelVersion,
			AssetMode: tc.assetMode, VoiceMode: tc.voiceMode,
		})
		if result.OK != tc.wantOK {
			t.Errorf("%s: ok = %v, want %v; errors = %v", tc.name, result.OK, tc.wantOK, result.Errors)
		}
		if len(result.Errors) != tc.wantErrors {
			t.Errorf("%s: error count = %d, want %d; errors = %v", tc.name, len(result.Errors), tc.wantErrors, result.Errors)
		}
		if len(result.Warnings) != tc.wantWarnings {
			t.Errorf("%s: warning count = %d, want %d; warnings = %v", tc.name, len(result.Warnings), tc.wantWarnings, result.Warnings)
		}
	}

	// 软上限告警：恰好 5000 字符不报错，但超过 4200 必须告警。
	limitResult := ValidateVideoPrompt(PromptValidateRequest{Text: atLimit, Platform: "jimeng", Mode: "new", ModelVersion: "2.5"})
	if !limitResult.OK {
		t.Errorf("at-limit prompt must pass: %v", limitResult.Errors)
	}
	if !containsSubstring(limitResult.Warnings, "常规目标") {
		t.Errorf("at-limit missing soft-limit warning: %v", limitResult.Warnings)
	}

	// 禁止词膨胀告警。
	bloated := strings.ReplaceAll(jimeng, "无字幕。", "严禁换脸。严禁换装。严禁跳轴。严禁新增人物。严禁改变光线。严禁改变道具。严禁改变空间。")
	bloatResult := ValidateVideoPrompt(PromptValidateRequest{Text: bloated, Platform: "jimeng", Mode: "new", ModelVersion: "2.5"})
	if !containsSubstring(bloatResult.Warnings, "禁止表达") {
		t.Errorf("bloated prompt missing prohibition warning: %v", bloatResult.Warnings)
	}
}

// 两份 assets/*.md 模板必须原样通过台账校验（与 audit_skill.py 的内部调用一致）。
func TestDirectorParityLedgerTemplates(t *testing.T) {
	for _, path := range []string{
		"chaoge-film-director-flex/assets/project-ledger-template.md",
		"chaoge-film-director-flex/assets/project-state-template.md",
	} {
		data, err := fs.ReadFile(builtinAssets.FS, path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		result := ValidateProjectLedger(string(data))
		if !result.OK {
			t.Errorf("%s: ledger validation failed: %v", path, result.Errors)
		}
	}
}

func containsSubstring(items []string, want string) bool {
	for _, item := range items {
		if strings.Contains(item, want) {
			return true
		}
	}
	return false
}
