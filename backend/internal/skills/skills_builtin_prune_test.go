package skills

import (
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// 内置技能从代码树移除后，目录行不能残留成幽灵行
// （真库曾积累 yingce-styleforge / 16000000000106 两条）。
// 每次启动 EnsureBuiltinSkills 必须对账清理并留墓碑。
func TestEnsureBuiltinSkillsPrunesRetiredBuiltinRows(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}, &model.SkillCurationAssignment{}, &model.SkillCurationRootAssignment{}, &model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}

	legacy := model.Skill{
		ID: "legacy-ghost-row", OwnerID: "yingce-system", Name: "历史遗留行", Description: "模拟代码树已删的幽灵行",
		SourceType: "builtin", Source: 3, Status: skillStatusEnabled, IsPrivate: false, VersionLabel: "1.0.0",
	}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	version := model.SkillVersion{ID: "legacy-ghost-row-v1", SkillID: legacy.ID, VersionLabel: "1.0.0"}
	if err := db.Create(&version).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", legacy.ID).Update("current_version_id", version.ID).Error; err != nil {
		t.Fatal(err)
	}
	state := model.UserSkillState{ID: "legacy-ghost-state", UserID: "some-user", SkillID: legacy.ID, Added: true}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}

	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.Skill{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != int64(len(packages)) {
		t.Fatalf("builtin skill count = %d, want %d（幽灵行未被清理或误删现役行）", count, len(packages))
	}
	var ghost int64
	if err := db.Model(&model.Skill{}).Where("id = ?", legacy.ID).Count(&ghost).Error; err != nil {
		t.Fatal(err)
	}
	if ghost != 0 {
		t.Fatalf("retired builtin row %s still present", legacy.ID)
	}
	var versions int64
	if err := db.Model(&model.SkillVersion{}).Where("skill_id = ?", legacy.ID).Count(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if versions != 0 {
		t.Fatalf("retired builtin versions for %s still present", legacy.ID)
	}
	var states int64
	if err := db.Model(&model.UserSkillState{}).Where("skill_id = ?", legacy.ID).Count(&states).Error; err != nil {
		t.Fatal(err)
	}
	if states != 0 {
		t.Fatalf("user states for retired builtin %s still present", legacy.ID)
	}
	var tombstones int64
	if err := db.Model(&model.BuiltinSkillTombstone{}).Where("skill_id = ?", legacy.ID).Count(&tombstones).Error; err != nil {
		t.Fatal(err)
	}
	if tombstones != 1 {
		t.Fatalf("tombstone count for %s = %d, want 1", legacy.ID, tombstones)
	}
}

// 用户自建/社区技能（非 builtin 来源）绝不能被扫尾波及。
func TestEnsureBuiltinSkillsPruneSparesNonBuiltinRows(t *testing.T) {
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
	community := model.Skill{
		ID: "community-pack", OwnerID: "some-owner", Name: "社区包", Description: "非 builtin 来源",
		SourceType: "markdown", Source: 1, Status: skillStatusEnabled, IsPrivate: true, VersionLabel: "1.0.0",
	}
	if err := db.Create(&community).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}

	var skill model.Skill
	if err := db.First(&skill, "id = ?", community.ID).Error; err != nil {
		t.Fatalf("non-builtin row was pruned: %v", err)
	}
}
