package app

// 27 进 8 收敛后的检索门禁（真库验证，默认跳过）：
//   CHAOGE_REAL_DB_SMOKE=1 时对 .local 真库执行只读检索验证——
//   ①「剧本解析 / 即梦提示词」→ chaoge 4 分卡居首；
//   ②「人物反差」→ 角色锻造工坊高分居首且无同分抢戏（终结「人物 40」碰撞）。
// 前置条件：真库已按指令单完成 19 个退役 skill 清理（builtin 56 / drama 8）。

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/repository"
)

func TestDramaConsolidationRetrievalGate(t *testing.T) {
	if os.Getenv("CHAOGE_REAL_DB_SMOKE") != "1" {
		t.Skip("set CHAOGE_REAL_DB_SMOKE=1 to run the retrieval gate against the real .local database")
	}
	root := filepath.Join("..", "..", "..")
	dataDir := filepath.Join(root, ".local", "data")
	dsn := filepath.Join(dataDir, "open_ai_canvas.db") + "?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on&_synchronous=NORMAL"
	gdb, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open real db: %v", err)
	}
	gsql, err := gdb.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = gsql.Close() })
	svc := &Service{repo: repository.New(gdb), dataDir: dataDir}

	// 前置：真库 builtin 56 / drama 8（收敛终态；2026-10-30 退役治理——
	// v1.7.3.2 合流补带的 19 个上游短剧系内置技能（影策短剧制作工作流/
	// 剧本撰写/剪辑节奏等）已按 f9055ec89 删除记录物理移除并清库）
	var builtin, drama int64
	if err := gdb.Raw("SELECT COUNT(*) FROM skills WHERE source_type='builtin'").Scan(&builtin).Error; err != nil {
		t.Fatal(err)
	}
	if err := gdb.Raw("SELECT COUNT(*) FROM skills WHERE source_type='builtin' AND tag='drama'").Scan(&drama).Error; err != nil {
		t.Fatal(err)
	}
	if builtin != 56 || drama != 8 {
		t.Fatalf("真库未达收敛终态：builtin=%d drama=%d，want 56/8", builtin, drama)
	}

	// 取全部 drama 保留包的 ID（不硬编码，按库取）
	rows, err := gdb.Raw("SELECT id FROM skills WHERE source_type='builtin' AND tag='drama'").Rows()
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, 8)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	rows.Close()

	snapshots, err := svc.cloudAgentSkills(chaogeSmokeUser, ids)
	if err != nil {
		t.Fatalf("cloudAgentSkills: %v", err)
	}
	// snapshots = 已安装 drama 包（真库当前 8 个装齐；目录级收敛由上方 75/27 tripwire 锁定）
	if len(snapshots) != 8 {
		t.Fatalf("snapshot count = %d, want 8", len(snapshots))
	}

	// ① 定稿制片类 → chaoge 4 分卡居首
	for _, keyword := range []string{"剧本解析", "即梦提示词"} {
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
			t.Fatalf("keyword %q top = %v, want chaoge-film-director-flex", keyword, top["skillId"])
		}
		if score, _ := top["score"].(int); score < 4 {
			t.Fatalf("keyword %q chaoge score = %d, want >= 4", keyword, score)
		}
		path, _ := top["path"].(string)
		if !strings.HasPrefix(path, "cards/") {
			t.Fatalf("keyword %q recalled %q, want a cards/ path", keyword, path)
		}
		t.Logf("keyword %q -> %s (score=%v)", keyword, path, top["score"])
	}

	// ② 人物反差 → 角色锻造工坊居首且无同分抢戏
	result, err := cloudAgentSearchSkills(snapshots, "人物反差", 0)
	if err != nil {
		t.Fatal(err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) == 0 {
		t.Fatal("keyword 人物反差 recalled nothing")
	}
	top := matches[0]
	topScore, _ := top["score"].(int)
	if topScore < 4 {
		t.Fatalf("人物反差 top score = %d, want >= 4", topScore)
	}
	if len(matches) > 1 {
		if runner, _ := matches[1]["score"].(int); runner >= topScore {
			t.Fatalf("人物反差存在同分抢戏：%d vs %d", topScore, runner)
		}
	}
	var topName string
	if err := gdb.Raw("SELECT name FROM skills WHERE id=?", top["skillId"]).Scan(&topName).Error; err != nil {
		t.Fatal(err)
	}
	if topName != "角色锻造工坊" {
		t.Fatalf("人物反差 top = %s, want 角色锻造工坊", topName)
	}
	t.Logf("keyword 人物反差 -> %s (score=%v)", topName, topScore)
}
