package app

// 超哥导演精修（chaoge v3.24.0 接线）单测：五段契约重组 + 门禁校验。

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestRefineDramaPromptByChaogeRebuildsContract(t *testing.T) {
	settings := DramaSettings{}
	settings.StylePrompt = "写实电影感，冷调光影"
	meta := dramaBibleMeta{VisualRules: "人物面部清晰可读"}
	shots := []model.DramaShot{{SegmentIndex: 1, SegmentTitle: "雨夜重逢", Action: "2人相认"}}

	current := "镜头1（0.0—3.0秒｜中景）2人在雨中对望。\n场景：老街路口，路灯昏黄。"
	refined, notes := refineDramaPromptByChaoge(current, shots, settings, meta)

	for _, section := range []string{"【风格锁定】", "【场景与空间锚点】", "【镜头序列】", "【声音与音乐总则】", "【全局补充】"} {
		if !strings.Contains(refined, section) {
			t.Fatalf("缺少契约段 %s：\n%s", section, refined)
		}
	}
	if !strings.Contains(refined, "写实电影感，冷调光影") {
		t.Fatal("风格未带入重组稿")
	}
	if !strings.Contains(refined, "无 BGM") && !strings.Contains(refined, "无BGM") {
		t.Fatal("缺少无 BGM 声明")
	}
	if len(notes) == 0 {
		t.Fatal("缺少重组说明")
	}
	gate := validateDramaRefinedPrompt(refined)
	t.Logf("gate: ok=%v charCount=%d errors=%v warnings=%v", gate.OK, gate.CharCount, gate.Errors, gate.Warnings)
	if !gate.OK {
		t.Fatalf("重组稿未过即梦门禁：%v", gate.Errors)
	}
}

func TestRefineDramaPromptFallsBackToShotTable(t *testing.T) {
	settings := DramaSettings{}
	settings.StylePrompt = "2D国漫水墨风"
	shots := []model.DramaShot{{SegmentIndex: 1, SegmentTitle: "竹林追影", Action: "御剑飞行"}}

	refined, notes := refineDramaPromptByChaoge("一段没有任何结构的自由文本", shots, settings, dramaBibleMeta{})
	if !strings.Contains(refined, "【镜头序列】") {
		t.Fatalf("重建失败：\n%s", refined)
	}
	joined := strings.Join(notes, "|")
	if !strings.Contains(joined, "按镜头表重建") {
		t.Fatalf("缺少重建说明：%v", notes)
	}
	gate := validateDramaRefinedPrompt(refined)
	if !gate.OK {
		t.Fatalf("重建稿未过门禁：%v", gate.Errors)
	}
}
