package app

// 真机冒烟：对 .local 真库 + 真技能包 ZIP 执行 Agent 工具链闭环。
//
// 默认跳过；设 CHAOGE_REAL_DB_SMOKE=1 后对本机生产数据执行**只读**闭环：
// skill_search → skill_read_file → director_validate_prompt → director_validate_ledger。
// 数据库按服务器同款 DSN 以 WAL 只读语义打开（busy_timeout 防与运行中的后端抢锁），
// 全程不写任何表——前置条件（技能已落库、zhuren 已启用）由投产流程保证。

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/repository"
	builtinAssets "yingce/backend/builtin"
)

const chaogeSmokeUser = "586c19789e00ca880a4ec00e792397f2" // zhuren

func TestChaogeRealDBSmoke(t *testing.T) {
	if os.Getenv("CHAOGE_REAL_DB_SMOKE") != "1" {
		t.Skip("set CHAOGE_REAL_DB_SMOKE=1 to run the read-only closure against the real .local database")
	}
	root := filepath.Join("..", "..", "..")
	dataDir := filepath.Join(root, ".local", "data")
	dsn := filepath.Join(dataDir, "open_ai_canvas.db") + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open real db: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	svc := &Service{repo: repository.New(db), dataDir: dataDir}

	// 前置：真库里技能已落库且 zhuren 已启用。
	var added int64
	if err := db.Raw("SELECT COUNT(*) FROM user_skill_states WHERE user_id = ? AND skill_id = ? AND added = 1", chaogeSmokeUser, "chaoge-film-director-flex").Scan(&added).Error; err != nil {
		t.Fatal(err)
	}
	if added != 1 {
		t.Fatalf("chaoge not enabled for zhuren in the real db (added=%d)", added)
	}

	// 真库快照（与 Agent 运行时同一入口：cloudAgentSkills）。
	snapshots, err := svc.cloudAgentSkills(chaogeSmokeUser, []string{"chaoge-film-director-flex"})
	if err != nil {
		t.Fatalf("cloudAgentSkills: %v", err)
	}
	if len(snapshots) != 1 || len(snapshots[0].CardTitles) == 0 {
		t.Fatalf("snapshot not ready: %d skills, titles=%d", len(snapshots), func() int {
			if len(snapshots) == 0 {
				return 0
			}
			return len(snapshots[0].CardTitles)
		}())
	}
	state := &cloudAgentRuntime{Skills: snapshots}

	run := func(name, arguments string) map[string]any {
		t.Helper()
		call := newEcommerceToolCall(name, arguments)
		result, err := cloudAgentReadTool(nil, chaogeSmokeUser, state, call, svc)
		if err != nil {
			t.Fatalf("%s failed: %v", name, err)
		}
		payload, ok := result.(map[string]any)
		if !ok {
			t.Fatalf("%s returned %T", name, result)
		}
		return payload
	}

	// 1) skill_search：定稿制片类单词各中其卡（4 分权重）。
	//    说明：卡命中时契约只下发唯一顶卡路径（命中即直读，不再下发索引），
	//    因此分两个聚焦单词验证权威卡均可 4 分直达。
	for keyword, wantPath := range map[string]string{
		"三路线":  "cards/workflow.md",
		"生产路线": "cards/production-routes.md",
	} {
		args, _ := json.Marshal(map[string]string{"keyword": keyword})
		search := run("skill_search", string(args))
		matches, _ := search["matches"].([]map[string]any)
		if len(matches) == 0 {
			t.Fatalf("skill_search(%s) recalled nothing", keyword)
		}
		topPath, _ := matches[0]["path"].(string)
		if topPath != wantPath {
			t.Fatalf("skill_search(%s) top = %q, want %q", keyword, topPath, wantPath)
		}
		if score, _ := matches[0]["score"].(int); score < 4 {
			t.Fatalf("skill_search(%s) score = %d, want >= 4", keyword, score)
		}
		if matches[0]["skillId"] != "chaoge-film-director-flex" {
			t.Fatalf("skill_search(%s) top skill = %v", keyword, matches[0]["skillId"])
		}
		t.Logf("skill_search(%s) -> %s (score=%v)", keyword, topPath, matches[0]["score"])
	}

	// 1b) 组合查询「三路线 生产路线」：顶卡必须是 chaoge 的能力卡且 ≥4 分
	//（台账模板标题同时覆盖两词，实测 8 分居首——双词查询只回顶卡是既有契约）。
	comboArgs, _ := json.Marshal(map[string]string{"keyword": "三路线 生产路线"})
	combo := run("skill_search", string(comboArgs))
	comboMatches, _ := combo["matches"].([]map[string]any)
	if len(comboMatches) == 0 {
		t.Fatal("skill_search(三路线 生产路线) recalled nothing")
	}
	comboTop := comboMatches[0]
	if comboTop["skillId"] != "chaoge-film-director-flex" {
		t.Fatalf("combo query top skill = %v, want chaoge-film-director-flex", comboTop["skillId"])
	}
	if score, _ := comboTop["score"].(int); score < 4 {
		t.Fatalf("combo query score = %d, want >= 4", score)
	}
	t.Logf("skill_search(三路线 生产路线) -> %v (score=%v)", comboTop["path"], comboTop["score"])

	// 2) skill_read_file：按相对路径直读 references 正文。
	read := run("skill_read_file", `{"skillId":"chaoge-film-director-flex","path":"cards/prompt-templates.md"}`)
	content, _ := read["content"].(string)
	if !strings.Contains(content, "视频提示词与平台模板") {
		t.Fatal("skill_read_file did not return the reference body")
	}
	t.Logf("skill_read_file -> %d chars of cards/prompt-templates.md", len([]rune(content)))

	// 3) director_validate_prompt：合规即梦提示词必须 ok。
	promptArgs, _ := json.Marshal(map[string]string{"text": directorValidPrompt, "platform": "jimeng", "mode": "new"})
	prompt := run("director_validate_prompt", string(promptArgs))
	if prompt["ok"] != true {
		t.Fatalf("director_validate_prompt ok = %v, errors = %v", prompt["ok"], prompt["errors"])
	}
	if count, _ := prompt["charCount"].(int); count <= 0 {
		t.Fatalf("charCount = %v", prompt["charCount"])
	}
	t.Logf("director_validate_prompt -> ok=true charCount=%v", prompt["charCount"])

	// 4) director_validate_ledger：轻量制作状态必须 ok 且回显 light_state。
	template, err := fs.ReadFile(builtinAssets.FS, "chaoge-film-director-flex/assets/project-state-template.md")
	if err != nil {
		t.Fatal(err)
	}
	ledgerArgs, _ := json.Marshal(map[string]string{"text": string(template)})
	ledger := run("director_validate_ledger", string(ledgerArgs))
	if ledger["ok"] != true {
		t.Fatalf("director_validate_ledger ok = %v, errors = %v", ledger["ok"], ledger["errors"])
	}
	if ledger["recordType"] != "light_state" {
		t.Fatalf("recordType = %v, want light_state", ledger["recordType"])
	}
	t.Logf("director_validate_ledger -> ok=true recordType=%v stage=%v route=%v", ledger["recordType"], ledger["stage"], ledger["route"])
}
