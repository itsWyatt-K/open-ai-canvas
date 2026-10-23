package app

// 双核导演技能同场竞争排序断言：
//   - 影视剧作工坊（yingshi-drama-workshop）管「未定稿的剧本打磨」；
//   - chaoge-film-director-flex 管「定稿后的解析/资产/出片」。
// 两者同时启用时，skill_search 必须把查询路由到正确的核——定稿制片类查询
// chaoge 综合得分排第一，剧本打磨类查询影视剧作工坊排第一，互不抢戏。
//
// 得分口径（cloudAgentSkillMatch）：能力卡 4 分 > 技能名 3 分 > 描述 2 分；
// 卡命中按「文件名 slug + Markdown 标题结构索引」双通道。
// 本用例的期望值全部来自 2026-10-23 对真实内置包的实测（见提交历史说明），
// 其中 4-4 平局关键词（一镜到底/360度补角/空间推演）两个包都合法覆盖，
// 只断言 chaoge 必在命中列（平局由请求内 SkillIDs 顺序稳定打破），不做独占断言。

import (
	"testing"

	"yingce/backend/internal/model"
)

func dualSkillSnapshots(t *testing.T) []cloudAgentSkill {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	if err := s.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	for _, sid := range []string{"chaoge-film-director-flex", "yingshi-drama-workshop"} {
		if err := db.Create(&model.UserSkillState{ID: "state-" + sid, UserID: "user", SkillID: sid, Added: true}).Error; err != nil {
			t.Fatal(err)
		}
	}
	snapshots, err := s.cloudAgentSkills("user", []string{"chaoge-film-director-flex", "yingshi-drama-workshop"})
	if err != nil {
		t.Fatalf("cloudAgentSkills: %v", err)
	}
	if len(snapshots) != 2 {
		t.Fatalf("snapshot count = %d, want 2", len(snapshots))
	}
	return snapshots
}

func topSkillOf(t *testing.T, snapshots []cloudAgentSkill, keyword string) (string, int) {
	t.Helper()
	result, err := cloudAgentSearchSkills(snapshots, keyword, 0)
	if err != nil {
		t.Fatal(err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) == 0 {
		t.Fatalf("keyword %q recalled nothing", keyword)
	}
	top := matches[0]
	skillID, _ := top["skillId"].(string)
	score, _ := top["score"].(int)
	return skillID, score
}

func chaogeInMatches(t *testing.T, snapshots []cloudAgentSkill, keyword string) bool {
	t.Helper()
	result, err := cloudAgentSearchSkills(snapshots, keyword, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range result["matches"].([]map[string]any) {
		if m["skillId"] == "chaoge-film-director-flex" {
			return true
		}
	}
	return false
}

// 定稿制片类查询：chaoge 必须综合得分第一（严格胜出，无平局）。
func TestDualSkillRankingChaogeWinsProductionQueries(t *testing.T) {
	snapshots := dualSkillSnapshots(t)
	cases := []struct {
		keyword  string
		wantPath string
	}{
		{"即梦", "references/prompt_templates.md"},
		{"Seedance", "references/seedance_versions.md"},
		{"P0A", "references/workflow.md"},
		{"角色设定板", "references/character_assets.md"},
		{"三路线", "references/workflow.md"},
		{"定稿剧本 AI导演2.0 即梦视频提示词 Seedance", "references/seedance_versions.md"},
	}
	for _, tc := range cases {
		skillID, score := topSkillOf(t, snapshots, tc.keyword)
		if skillID != "chaoge-film-director-flex" {
			t.Fatalf("keyword %q top = %s, want chaoge-film-director-flex", tc.keyword, skillID)
		}
		if score < 4 {
			t.Fatalf("keyword %q chaoge score = %d, want >= 4 (card-level weight)", tc.keyword, score)
		}
		result, err := cloudAgentSearchSkills(snapshots, tc.keyword, 0)
		if err != nil {
			t.Fatal(err)
		}
		path := result["matches"].([]map[string]any)[0]["path"]
		if path != tc.wantPath {
			t.Fatalf("keyword %q recalled %q, want %q", tc.keyword, path, tc.wantPath)
		}
	}
}

// 剧本打磨类查询：影视剧作工坊必须排第一，chaoge 不抢戏。
func TestDualSkillRankingYingshiWinsScriptPolishQueries(t *testing.T) {
	snapshots := dualSkillSnapshots(t)
	for _, keyword := range []string{"分镜", "剧本打磨 角色弧光 分镜"} {
		skillID, _ := topSkillOf(t, snapshots, keyword)
		if skillID != "yingshi-drama-workshop" {
			t.Fatalf("keyword %q top = %s, want yingshi-drama-workshop", keyword, skillID)
		}
	}
}

// 双包合法重叠区（一镜到底/360度补角/空间推演）：chaoge 必须仍在命中列，
// 用户无论从哪个核切入都能拿到 chaoge 的权威卡路径。
func TestDualSkillRankingOverlapKeepsChaogeReachable(t *testing.T) {
	snapshots := dualSkillSnapshots(t)
	for _, keyword := range []string{"一镜到底", "360度补角", "空间推演"} {
		if !chaogeInMatches(t, snapshots, keyword) {
			t.Fatalf("keyword %q must keep chaoge-film-director-flex in matches", keyword)
		}
	}
}

// 触发词直达：chaoge 的招牌触发词只命中它自己（影视剧作工坊无对应得分）。
func TestDualSkillRankingChaogeTriggerWordsAreExclusive(t *testing.T) {
	snapshots := dualSkillSnapshots(t)
	for _, keyword := range []string{"P0A", "三路线", "AI导演2.0", "弹性资产路线", "定稿剧本"} {
		result, err := cloudAgentSearchSkills(snapshots, keyword, 0)
		if err != nil {
			t.Fatal(err)
		}
		matches := result["matches"].([]map[string]any)
		if len(matches) != 1 {
			t.Fatalf("keyword %q should exclusively hit chaoge, got %d matches", keyword, len(matches))
		}
		if matches[0]["skillId"] != "chaoge-film-director-flex" {
			t.Fatalf("keyword %q hit %v, want chaoge-film-director-flex", keyword, matches[0]["skillId"])
		}
	}
}
