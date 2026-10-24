# Chaoge 导演技能融合与原生工具验收报告

- 本地提交：`03e1cb9ec`（分支 `absorb/upstream-v1.6.5-agent-pi`，40 文件，+5172/-2）
- 技能包：`backend/builtin/chaoge-film-director-flex/`（27 文件，v2.0.0，UTF-8 无 BOM，纯 LF）
- 验收环境：Windows + Git Bash；Go `C:/Users/khy/.workbuddy/binaries/go/go/bin/go.exe`（CGO_ENABLED=0）；Python `3.13.14`（PATH 托管版）

---

## 一、Git 状态与变更统计

```
$ git log --oneline -2
03e1cb9ec feat(skills): fuse chaoge-film-director-flex v2.0.0 with Go-native director validators
c21d634f4 test(database): align migration test assertions with local schema after renumbering

$ git status --short
?? reports/          # 既存未跟踪（本次之前已在）
?? web/dist-verify/  # 既存未跟踪（本次之前已在）

$ git show --stat HEAD（摘要）
 40 files changed, 5172 insertions(+), 2 deletions(-)
```

变更构成（全部为精确 add，无 `-A/-u/.`）：

| 区域 | 文件 | 动作 |
|---|---|---|
| 技能包 | `backend/builtin/chaoge-film-director-flex/` 27 文件 | 新增 |
| Go 校验包 | `backend/internal/director/prompt_validator.go`、`ledger_validator.go`、`director_parity_test.go` | 新增 |
| Agent 工具 | `backend/internal/app/cloud_agent_director_tools.go`（+测试） | 新增 |
| 工具注册/分派 | `cloud_agent_tools.go`（+14）、`cloud_agent_tools_read.go`（+6/-2）、`cloud_agent_tools_skills.go`（+67/-2） | 修改 |
| 检索测试 | `cloud_agent_chaoge_skill_test.go`、`skills_chaoge_builtin_test.go` | 新增 |
| 维护脚本 | `scripts/gen_director_parity_fixtures.py`、`scripts/emit_director_parity_test.py` | 新增 |
| 杂项 | `.gitignore`（+3：忽略 parity 夹具暂存目录 `scripts/_out/`） | 修改 |

---

## 二、门禁 1 回执（Python 技能自审计与自测，全部 0 error / 0 warning）

```
$ python backend/builtin/chaoge-film-director-flex/scripts/audit_skill.py backend/builtin/chaoge-film-director-flex --strict-duplicates
PASS: version 2.0.0; 19 contracts; 0 warning(s)

$ python backend/builtin/chaoge-film-director-flex/scripts/validate_prompt.py --self-test
Self-test passed

$ python backend/builtin/chaoge-film-director-flex/scripts/validate_ledger.py backend/builtin/chaoge-film-director-flex/assets/project-ledger-template.md
PASS

$ python backend/builtin/chaoge-film-director-flex/scripts/validate_ledger.py backend/builtin/chaoge-film-director-flex/assets/project-state-template.md
PASS
```

硬约束复核：SKILL.md 共 **212 行**（≤240）；`SKILL.md` / `references/workflow.md` / `references/loop_engineering.md` 中 **0 处** `4200`/`5000`；27 文件全部 UTF-8 无 BOM、零 CR 字节。

---

## 三、门禁 2~4 回执（Go 侧）

**门禁 2（Go ↔ Python 校验器对账）：**

```
$ CGO_ENABLED=0 go test ./internal/director/... -v
=== RUN   TestDirectorParityPromptSelfTest
--- PASS: TestDirectorParityPromptSelfTest (0.01s)
=== RUN   TestDirectorParityLedgerTemplates
--- PASS: TestDirectorParityLedgerTemplates (0.00s)
PASS
ok  	yingce/backend/internal/director	1.826s
```

对账口径：9 组正反用例的 ok 判定 **plus 逐案 error/warning 数量**全部与 Python 一致（jimeng 0e/0w、libtv 0/0、bad-at-alias 4e、over-15s-on-2.0 1e、missing-voice 4e、text-model-voice 0e/1w、text-with-image-placeholder 2e/1w、at-limit 0e/2w、over-limit 1e/1w），另含软上限告警、禁止词膨胀告警与 2 份模板校验。夹具由 `scripts/gen_director_parity_fixtures.py` 从权威 Python 模块**同源重建**（脚本内断言夹具与 `validate_prompt.py` 逐字节一致），杜绝转录漂移。

**门禁 3（技能加载、4 分卡检索、影视工坊零回归）：**

```
$ CGO_ENABLED=0 go test ./internal/skills/... -v
（33 个用例全部 PASS，无 FAIL）
=== RUN   TestChaogeBuiltinPackageLoads          --- PASS
=== RUN   TestChaogeBuiltinPersistsDramaTag      --- PASS
=== RUN   TestYingshiBuiltinBundleCompatibility  --- PASS
ok  	yingce/backend/internal/skills	16.179s
```

`TestChaogeBuiltinPackageLoads` 校验：27 文件清单齐全、tag=drama、sourceType=builtin、author=影策、owner=yingce-system、sortWeight=96、source=3、version=2.0.0、零 CR/BOM、SKILL.md ≤240 行、三文件无 4200/5000。

**门禁 4（Agent 导演工具单测）：**

```
$ CGO_ENABLED=0 go test ./internal/app/ -run "TestAgentDirector|TestSkill" -v
=== RUN   TestAgentDirectorToolsDeclared                    --- PASS
=== RUN   TestAgentDirectorToolsAvailableInReadOnly         --- PASS
=== RUN   TestAgentDirectorValidatePromptAcceptsValidPrompt --- PASS
=== RUN   TestAgentDirectorValidatePromptRejectsBadAlias    --- PASS
=== RUN   TestAgentDirectorValidatePromptRejectsInvalidPlatform --- PASS
=== RUN   TestAgentDirectorValidateLedgerAcceptsTemplate    --- PASS
=== RUN   TestAgentDirectorValidateLedgerRejectsMissingFrontmatter --- PASS
=== RUN   TestAgentDirectorToolsDispatchThroughReadTool     --- PASS
PASS
ok  	yingce/backend/internal/app	5.271s
```

**附加守卫回归（同批全绿）：**

```
$ go test ./internal/app/ -run "TestCloudAgentToolTableMatchesRuntimeDispatch|TestCloudAgentSkillSearch|TestCloudAgentSkill" -v
（33 个用例全部 PASS，含工具表↔运行期分派集合守卫 TestCloudAgentToolTableMatchesRuntimeDispatch）

$ go test ./internal/app/ -run "TestCloudAgentSkillSearchRecallsChaogeReferenceCards|TestCloudAgentSkillReadFileReadsChaogeReference" -v
--- PASS: TestCloudAgentSkillSearchRecallsChaogeReferenceCards (7.91s)
--- PASS: TestCloudAgentSkillReadFileReadsChaogeReference (9.78s)
```

**门禁 5（全量编译与 CRLF 零混入）：**

```
$ CGO_ENABLED=0 go build ./...
FULL_BUILD_EXIT=0   （后台任务，耗时 1m19s，无输出即无错误）

$ go vet ./internal/director/... ./internal/skills/... ./internal/app/...
VET_EXIT=0（三个包均无输出）

CRLF 复核（Python 字节级）：
  backend/builtin/chaoge-film-director-flex/ 工作区 27 文件：CR = 0
  入库 blob（git show HEAD:…）27 文件：CR = 0
  新增/修改的 12 个工程文件：CR = 0
```

---

## 四、运行时数据库核验（sqlite 集成验证）

未启动完整后端（运行时库为 Postgres，需线上配置）；以 `EnsureBuiltinSkills()` 全量落库的集成测试等价验证：

```
$ go test ./internal/skills/ -run TestChaogeBuiltinPersistsDramaTag -v
=== RUN   TestChaogeBuiltinPersistsDramaTag
    skills_chaoge_builtin_test.go:112: builtin skill packages in skills table: 74
    skills_chaoge_builtin_test.go:117: chaoge row: id=chaoge-film-director-flex name=chaoge-film-director-flex tag=drama version=2.0.0 sourceType=builtin status=1 fileCount=27 contentHash=dc2ac44ef5922d7aff8e8e2703f487d6bbccc11e7c528744ac0eb351a2e9f15f
--- PASS: TestChaogeBuiltinPersistsDramaTag (1.64s)
```

- `skills` 表内置技能包总数：**73 → 74** ✅
- `chaoge-film-director-flex`：`id=chaoge-film-director-flex`、`tag=drama`、`version=2.0.0`、`source_type=builtin`、`status=1`（启用）、`file_count=27` ✅

---

## 五、双轨同步与 LF 换行核验

```
$ cp -r backend/builtin/chaoge-film-director-flex ~/.workbuddy/skills/chaoge-film-director-flex
$ python backend/builtin/chaoge-film-director-flex/scripts/audit_skill.py backend/builtin/chaoge-film-director-flex --strict-duplicates --installed "$HOME/.workbuddy/skills/chaoge-film-director-flex"
PASS: version 2.0.0; 19 contracts; 0 warning(s)
```

- `~/.workbuddy/skills/chaoge-film-director-flex/` 已镜像，两侧各 **27 文件**，`--installed` 逐文件 SHA-256 比对**全等**（0 未同步 / 0 内容不同）✅
- `__pycache__`/`.pyc` 零污染（双侧 find 均为空）✅
- 工作区 + 入库 blob 双视角 CRLF = 0（见门禁 5）✅

---

## 六、画布与影视工坊零污染核验

```
$ git status --short web/
?? web/dist-verify/        # 既存未跟踪（本次开工前已在首次 git status 中）

$ git status --short backend/builtin/影视剧作工坊/
（空）

$ git diff --stat   # 已跟踪文件全部改动
 .gitignore                                       |  3 ++
 backend/internal/app/cloud_agent_tools.go        | 14 +++++
 backend/internal/app/cloud_agent_tools_read.go   |  6 ++-
 backend/internal/app/cloud_agent_tools_skills.go | 67 +++++++++++++++-
 4 files changed, 88 insertions(+), 2 deletions(-)
```

- 7 个画布宿主核心文件（`web/src/pages/canvas/project.tsx` 等）：**零改动**（web/ 下无任何已跟踪文件变更）✅
- `backend/builtin/影视剧作工坊/`：**零改动**，且 `TestYingshiBuiltinBundleCompatibility` 全绿（32 个 .py 文件树哈希不变）✅

---

## 七、实现说明与偏差记录

1. **检索平权的实际状态**：核查发现 Go 侧 `cloudAgentSkillCardPaths` 本就**不硬编码 `cards/`**——除 `SKILL.md` 外全部文本文件（含 `references/`、`assets/`）均按 4 分能力卡参与 `cloudAgentSkillMatch`。但卡命中原本只比对**文件名 slug**，"一镜到底"等中文关键词打不中 `one_take.md`，只能落在描述层 2 分。为达成指令单要求的"4 分最高权重召回"，`cloud_agent_tools_skills.go` 增加**卡标题结构索引**（H1 与各级小节标题，代码围栏内不计，400 字上限，快照构建时经 `SkillPackageBundle` 一次性装载）：slug 或标题命中均记 4 分。7 个关键词实测全部命中 `references/*.md`（三路线→workflow.md、角色设定板→character_assets.md、360度补角→scene_360_coverage.md、空间推演→spatial_preflight.md、一镜到底→one_take.md、即梦→prompt_templates.md、Seedance→seedance_versions.md）。
2. **RE2 能力差的正交处理**：Python 两处负向后瞻（`(?<![A-Za-z{])图N`、`(?<![A-Za-z{])(?:图|音频|视频)N`）以"命中后回退一字节检查前字符"等价模拟（A-Za-z{ 均为 ASCII，字节级判定安全）；`机位与构图：(.*?)(?=\n运镜：)` 以"截取到下一個 `\n运镜：` 之前"等价模拟。
3. **版本期望值自同步**：`validate_ledger.py` 从技能包 `VERSION` 文件读期望版本；Go 侧改为从**嵌入的 builtin FS** 读取 `chaoge-film-director-flex/VERSION`（读不到时退回常量 `2.0.0`），版本升级时两侧不漂移。
4. **工具可用性**：`director_validate_prompt` / `director_validate_ledger` 在 `compileCloudAgentTools` 中**无条件下发**（含 `read_only`），并登记进 `cloudAgentReadToolReadOnly` 白名单；二者为纯内存校验，不写库、不扣费、不碰画布节点。
5. **未执行项**：未启动完整后端连接 Postgres 实测（以 sqlite 集成测试等价验证，见第四节）；未对上游仓库做任何 push/PR（本次全部为本地提交）。
