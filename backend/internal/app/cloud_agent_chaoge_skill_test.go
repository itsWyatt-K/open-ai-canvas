package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

// 检索平权契约：references/ 与 assets/ 下的 .md 必须与 cards/ 同等视为 4 分能力卡。
// 指令单指定的中文关键词（打不中英文文件名 slug）要经卡标题结构索引命中
// references/*.md，以 4 分最高权重召回，而不是退化到描述层的 2 分。
func TestCloudAgentSkillSearchRecallsChaogeReferenceCards(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := s.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserSkillState{ID: "state-chaoge", UserID: "user", SkillID: "chaoge-film-director-flex", Added: true}).Error; err != nil {
		t.Fatal(err)
	}
	snapshots, err := s.cloudAgentSkills("user", []string{"chaoge-film-director-flex"})
	if err != nil {
		t.Fatalf("cloudAgentSkills: %v", err)
	}
	if len(snapshots) != 1 {
		t.Fatalf("snapshot count = %d, want 1", len(snapshots))
	}
	if len(snapshots[0].CardTitles) == 0 {
		t.Fatal("card heading index was not populated; Chinese keywords cannot reach 4-point card hits")
	}
	// 关键词 → 期望命中的卡路径（排序在前的同级命中卡胜出）。
	expect := map[string]string{
		"三路线":   "cards/workflow.md",
		"角色设定板": "assets/character-sheet-prompt.md",  // v3.24.0 合流：新资产模板含该关键词
		"360度补角": "cards/scene-360-coverage.md",
		"空间推演":  "cards/spatial-preflight.md",
		"一镜到底":  "cards/one-take.md",
		"即梦":    "cards/prompt-templates.md",
		"Seedance": "cards/seedance-versions.md",
	}
	for keyword, wantPath := range expect {
		result, err := cloudAgentSearchSkills(snapshots, keyword, 0)
		if err != nil {
			t.Fatal(err)
		}
		matches := result["matches"].([]map[string]any)
		if len(matches) == 0 {
			t.Fatalf("keyword %q recalled nothing", keyword)
		}
		top := matches[0]
		if top["skillId"] != "chaoge-film-director-flex" {
			t.Fatalf("keyword %q top match = %v, want chaoge-film-director-flex", keyword, top["skillId"])
		}
		path, _ := top["path"].(string)
		if path != wantPath {
			t.Fatalf("keyword %q recalled %q, want %q", keyword, path, wantPath)
		}
		if score, _ := top["score"].(int); score < 4 {
			t.Fatalf("keyword %q scored %d, want >= 4 (card-level weight)", keyword, score)
		}
		if !strings.HasPrefix(path, "cards/") && !strings.HasPrefix(path, "references/") && !strings.HasPrefix(path, "assets/") {
			t.Fatalf("keyword %q recalled non-card path %q", keyword, path)
		}
	}
}

// skill_read_file 必须能按 references/xxx.md 相对路径直读正文（渐进披露的读侧契约）。
func TestCloudAgentSkillReadFileReadsChaogeReference(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := s.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserSkillState{ID: "state-chaoge-read", UserID: "user", SkillID: "chaoge-film-director-flex", Added: true}).Error; err != nil {
		t.Fatal(err)
	}
	pool, err := s.cloudAgentBuildSkillPool("user", "", []string{"chaoge-film-director-flex"}, defaultCloudAgentContextBudget())
	if err != nil {
		t.Fatalf("cloudAgentBuildSkillPool: %v", err)
	}
	state := &cloudAgentRuntime{SkillVersions: pool.Versions}
	call := cloudAgentCall{ID: "read-chaoge"}
	call.Function.Name = "skill_read_file"
	call.Function.Arguments = `{"skillId":"chaoge-film-director-flex","path":"cards/one-take.md"}`
	result, err := cloudAgentReadTool(nil, "user", state, call, s)
	if err != nil {
		t.Fatalf("skill_read_file on cards/one-take.md: %v", err)
	}
	page, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("unexpected result type %T", result)
	}
	content, _ := page["content"].(string)
	if !strings.Contains(content, "一镜到底导演标准") {
		t.Fatalf("reference body not returned: %q", content)
	}
}
