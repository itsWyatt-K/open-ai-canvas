# 附录 D 数据口径与复现

> 每个统计数字的实测日期、口径、复现命令都列在这里。代码在增长，数字会漂移——您可以自己重新量。

## 文档基线

| 项 | 值 |
|---|---|
| 实测日期 | 2026-10-22 |
| 代码基线 | `HEAD = c21d634f4` |
| 分支 | `absorb/upstream-v1.6.5-agent-pi` |
| schema 版本 | 58 |
| 数据库文件 | `.local/data/open_ai_canvas.db`（约 103 MB） |

## 代码规模

| 指标 | 值 | 口径 | 复现命令 |
|---|---|---|---|
| Go 文件数 | 1050 | `backend/` 下全部 `.go`（含测试） | `find backend -name '*.go' -not -path '*/node_modules/*' \| wc -l` |
| Go 代码行数 | 220,693 | 同上，`wc -l` 汇总 | `find backend -name '*.go' \| xargs wc -l \| tail -1` |
| Go 测试文件数 | 425 | `*_test.go` | `find backend -name '*_test.go' \| wc -l` |
| 前端 TS/TSX 文件数 | 1031 | `web/src/` 下 `.ts` + `.tsx` | `find web/src -name '*.ts' -o -name '*.tsx' \| wc -l` |
| 前端代码行数 | 192,573 | 同上 | `find web/src -name '*.ts' -o -name '*.tsx' \| xargs wc -l \| tail -1` |
| 前端测试文件数 | 332 | `web/test/` 下 `.ts` + `.tsx` | `find web/test -name '*.ts' -o -name '*.tsx' \| wc -l` |
| 前端测试行数 | 33,147 | 同上 | `find web/test -name '*.ts' -o -name '*.tsx' \| xargs wc -l \| tail -1` |
| 画布组件文件数 | 159 | `web/src/components/canvas/` | `ls web/src/components/canvas/ \| wc -l` |

> 注：Go 行数 220,693 是**含测试**的总量。此前有 215,121 的旧记录，是只统计源码或更早 commit 的结果，已按当前实测修正。

## 技能体系

| 指标 | 值 | 复现命令 |
|---|---|---|
| 技能包数 | 74 | `ls backend/builtin/ \| wc -l` |
| SKILL.md 数 | 90 | `find backend/builtin -name 'SKILL.md' \| wc -l` |
| 文件总数 | 1166 | `find backend/builtin -type f \| wc -l` |
| 能力卡数 | 718 | `find backend/builtin -path '*/cards/*' -name '*.md' \| wc -l` |
| 脚本数 | 70 | `find backend/builtin -path '*/scripts/*' \| wc -l` |
| Python 脚本数 | 36 | `find backend/builtin -name '*.py' \| wc -l` |

> `ls backend/builtin/` 得 75 个顶层条目，其中一个是 `embed.go`（嵌入声明文件），所以技能包数是 74。

**影视剧作工坊的特殊口径**：`.py` 文件实测 32 个，但其 `PKG_VERSION.json` 自述 `machine_scripts: 31`、`version: 1.1.6`、`built: 2026-10-03`、`modules: 16`。差异原因未深究（可能是自述口径排除了某个辅助脚本），文档中并列两个值并说明。

## 数据库

| 指标 | 值 | 复现方式 |
|---|---|---|
| schema 版本 | 58 | `grep "CurrentSchemaVersion int64" backend/internal/database/migrations.go` |
| 迁移条数 | 58 | 同上（版本号连续 1..58，v44 为上游预留空号） |
| 模型文件数 | 约 40 | `ls backend/internal/model/ \| wc -l` |

## 电商数据量（只读查询）

实测日期 2026-10-21，用 SQLite 只读连接（`mode=ro`）查询：

| 表 | 行数 |
|---|---|
| `ecommerce_products` | 1 |
| `ecommerce_slots` | 14 |
| `ecommerce_slot_versions` | 32 |
| `ecommerce_user_configs` | 1 |
| `ecommerce_presets` | 6 |
| `schema_migrations` | 58 |

复现方式（只读，不写库）：

```python
import sqlite3
c = sqlite3.connect('file:.local/data/open_ai_canvas.db?mode=ro', uri=True)
c.execute("select count(*) from ecommerce_slots").fetchone()
```

> 这是开发机数据量，不代表生产规模。

## 单文件行数

| 文件 | 行数 |
|---|---|
| `web/src/pages/canvas/project.tsx` | 3,589 |
| `backend/internal/app/ecommerce_orchestrator.go` | 1,394 |
| `backend/internal/ecommerce/plandetail.go` | 675 |
| `backend/internal/ecommerce/platforms.go` | 442 |
| `backend/internal/app/task_worker.go` | 477 |
| `web/src/pages/canvas/use-commerce-workflow.ts` | 295 |

复现：`wc -l <路径>`

## Git 与 tag

| 指标 | 值 | 复现命令 |
|---|---|---|
| tag 总数 | 138 | `git tag \| wc -l` |
| remote 数 | 2 | `git remote -v` |

## 迁移验证输出

```bash
cd backend
CANVAS_BACKEND_DATA_DIR=<DataDir> go run ./cmd/migrate-schema status
# 期望：{"current":58,"expected":58,"ready":true}
```

阶段一合并时用真库副本实测过：迁移前 `{"current":56,"expected":58,"ready":false}`，迁移后 `{"current":58,"expected":58,"ready":true}`；账本 54..58 连续，本地 v55/v56 身份原样，上游 v57/v58 落地；新增 4 列（`api_call_logs.created_at_epoch`、`tasks.created_at_epoch`、`model_channels.catalog_provider_id`、`channel_models.catalog_model_key`）与 4 个索引全部就位。

## 测试基线

合并前的全量后端测试结果存档在 `reports/go-test-baseline-pre-absorb.txt`（合并上游阶段一之前跑的）。

**已知既有失败**（非回归，环境限制导致）：

| 测试 | 原因 |
|---|---|
| `TestGmailMailboxRegistrationConcurrent` | 临时目录写入被安全中心拦截 |
| `TestPaymentExportKeepsSnapshotWhenRerunCompletesBetweenReads` | 压力测试故意制造锁 |
| 两个 assets 用例 | 仅全量跑时失败，单独跑通过 |

**区分回归的方法**：合并前后各跑一次 `go test ./...`，把结果做 diff，只关注"基线通过、合并后失败"的新增项。

## 前端测试运行方式

```bash
cd web
bun test test/xxx.test.ts                    # 纯逻辑测试
HAPPY_DOM=1 bun test test/xxx.test.tsx       # DOM 测试（React 组件）
```

`HAPPY_DOM=1` 门控的 preload 见 `web/test/happy-dom-preload.ts`，默认完全空转，不影响其余测试文件。

## 文档变更记录

| 日期 | 变更 |
|---|---|
| 2026-10-22 | 初版创建。含 13 章 + 4 附录。标注 4 项待确认缺口 |
| 2026-10-23 | 合入 `chaoge-film-director-flex`（第 74 个内置包，drama 26→27）：技能包 73→74、SKILL.md 89→90、builtin 文件 1139→1166、references 16→34、.py 32→36；新增 `backend/internal/director/` 与两个 Agent 校验工具；能力卡检索升级为「文件名 slug + Markdown 标题结构索引」双通道（提交 `03e1cb9ec`）。 |

## 待确认项汇总

| # | 缺口 | 影响章节 | 状态 |
|---|---|---|---|
| 1 | `judian-skills` 投稿仓真实定位（35 域包仅 1 个有内容、已更名 yuanqi-pipeline） | 第 7、13 章 | 待确认 |
| 2 | nxf 8823 服务现状（谁拉活、MCP 暴露给谁） | 第 13 章 | 待确认 |
| 3 | 画布三引擎（tldraw/excalidraw/leafer-ui）实时分工边界 | 第 8 章 | 待确认 |
| 4 | 计费公式精确表达式与失败退费策略 | 第 11 章 | 待确认 |

> 补齐这 4 项后，应更新对应章节并把本表标记为已确认。
