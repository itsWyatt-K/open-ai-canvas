package skills

import (
	"bytes"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const chaogeSkillID = "chaoge-film-director-flex"

// chaoge-film-director-flex（v2.0.0）必须以 drama 分类、builtin 来源进入内置技能目录，
// 且 27 个文件（SKILL.md / VERSION / agents / assets / references / scripts）齐全、纯 LF 无 BOM，
// SKILL.md 不超 240 行、三个总纲文件不重复展开字符预算。
func TestChaogeBuiltinPackageLoads(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	var target *builtinSkillPackage
	for index := range packages {
		if packages[index].skill.ID == chaogeSkillID {
			target = &packages[index]
			break
		}
	}
	if target == nil {
		t.Fatal("chaoge-film-director-flex builtin package was not loaded")
	}
	if target.skill.Tag != "drama" {
		t.Fatalf("tag = %q, want drama", target.skill.Tag)
	}
	if target.skill.SourceType != "builtin" {
		t.Fatalf("sourceType = %q, want builtin", target.skill.SourceType)
	}
	if target.skill.AuthorName != "影策" || target.skill.OwnerID != "yingce-system" {
		t.Fatalf("author/owner = %q/%q, want 影策/yingce-system", target.skill.AuthorName, target.skill.OwnerID)
	}
	if target.skill.SortWeight != 96 || target.skill.Source != 3 {
		t.Fatalf("sortWeight/source = %d/%d, want 96/3", target.skill.SortWeight, target.skill.Source)
	}
	if target.archive.Metadata.Version != "2.0.0" {
		t.Fatalf("archive version = %q, want 2.0.0", target.archive.Metadata.Version)
	}
	want := []string{
		"SKILL.md", "VERSION", "agents/openai.yaml",
		"assets/project-ledger-template.md", "assets/project-state-template.md",
		"references/character_assets.md", "references/director_rules.md", "references/dynamic_asset_gate.md",
		"references/emotion_curve.md", "references/loop_engineering.md", "references/one_take.md",
		"references/production_routes.md", "references/project_ledger.md", "references/prompt_templates.md",
		"references/prop_assets.md", "references/scene_360_coverage.md", "references/scene_assets.md",
		"references/seedance_versions.md", "references/sound_and_music.md", "references/spatial_preflight.md",
		"references/story_bible.md", "references/style_lock.md", "references/workflow.md",
		"scripts/audit_skill.py", "scripts/render_spatial_validation_card.py",
		"scripts/validate_ledger.py", "scripts/validate_prompt.py",
	}
	for _, path := range want {
		if _, ok := target.archive.Files[path]; !ok {
			t.Errorf("package is missing %s", path)
		}
	}
	if len(target.archive.Files) != 50 {
		t.Fatalf("file count = %d, want 50 (27 原文件 + 23 张 2026-10-25 收编卡)", len(target.archive.Files))
	}
	// 收编建卡后，cards/ 必须存在且不少于 15 张（主核 0 卡问题的修复验证）。
	cardCount := 0
	for path := range target.archive.Files {
		if strings.HasPrefix(path, "cards/") && strings.HasSuffix(path, ".md") {
			cardCount++
		}
	}
	if cardCount < 15 {
		t.Fatalf("cards/ 只有 %d 张，少于 15 张下限", cardCount)
	}
	for path, content := range target.archive.Files {
		if bytes.Contains(content, []byte("\r")) {
			t.Errorf("%s contains CR bytes; builtin packages must stay LF-only", path)
		}
		if bytes.HasPrefix(content, []byte("\xef\xbb\xbf")) {
			t.Errorf("%s carries a UTF-8 BOM", path)
		}
	}
	skillLines := strings.Split(string(target.archive.Files["SKILL.md"]), "\n")
	if len(skillLines) > 240 {
		t.Fatalf("SKILL.md has %d lines, want <= 240", len(skillLines))
	}
	for _, path := range []string{"SKILL.md", "references/workflow.md", "references/loop_engineering.md"} {
		text := string(target.archive.Files[path])
		if strings.Contains(text, "4200") || strings.Contains(text, "5000") {
			t.Errorf("%s must not restate the 4200/5000 char budgets; sole authority is references/prompt_templates.md", path)
		}
	}
}

// EnsureBuiltinSkills 落库后，skills 表里的 chaoge 记录必须是 tag=drama、source_type=builtin。
func TestChaogeBuiltinPersistsDramaTag(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}, &model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.Skill{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	t.Logf("builtin skill packages in skills table: %d", count)
	var skill model.Skill
	if err := db.First(&skill, "id = ?", chaogeSkillID).Error; err != nil {
		t.Fatalf("chaoge row missing after EnsureBuiltinSkills: %v", err)
	}
	t.Logf("chaoge row: id=%s name=%s tag=%s version=%s sourceType=%s status=%d fileCount=%d contentHash=%s",
		skill.ID, skill.Name, skill.Tag, skill.VersionLabel, skill.SourceType, skill.Status, skill.FileCount, skill.ContentHash)
	if skill.Tag != "drama" {
		t.Fatalf("tag = %q, want drama", skill.Tag)
	}
	if skill.SourceType != "builtin" {
		t.Fatalf("source_type = %q, want builtin", skill.SourceType)
	}
	if skill.Status != skillStatusEnabled {
		t.Fatalf("status = %d, want enabled", skill.Status)
	}
}
