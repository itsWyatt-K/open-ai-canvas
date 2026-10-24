# Chaoge 导演技能·生产投产回执（最后一公里）

- 投产提交：`dc1cdb9c5`（分支 `absorb/upstream-v1.6.5-agent-pi`，4 文件，+351/-11）
- 前置签收：`03e1cb9ec`（融合主体，40 文件，+5172/-2）
- 二进制：`.local/canvas-backend.exe`（2026-10-23 13:52 编译，109,898,752 字节，`CGO_ENABLED=0 go build -o ../.local/canvas-backend.exe ./cmd/server`，exit 0）
- 回滚点：`.local/canvas-backend.exe.bak-before-chaoge`（10:36 备份，投产前二进制）、`.local/data/open_ai_canvas.db.bak-before-chaoge`（10:36 备份，真库 103MB）

---

## 回执 1：真库落盘与端口健康（:8080 已重启生效）

```
builtin rows: 76      （= 74 个现役包 + 2 个历史遗留行，见下）
drama:       27       （26 → 27）
chaoge: ('chaoge-film-director-flex', 'chaoge-film-director-flex', 'drama', '2.0.0',
          status=1, file_count=27,
          content_hash=dc2ac44ef5922d7aff8e8e2703f487d6bbccc11e7c528744ac0eb351a2e9f15f,
          updated_at=2026-10-23 13:52:36+08:00)
zhuren added: 43      （42 → 43，chaoge 已默认启用）
```

端口：`127.0.0.1:8080`（Go 后端）、`:3000`（Vite 前端）、`:17580`（控制面板）三端口 LISTENING；后端 `GET /` 返回 404（无根路由，正常）。控制台自检：【4】技能库「影策内置技能 78 个」（76 builtin + 2 私有酿笑坊技能）。

**关于 76 ≠ 74 的说明**：真库 `skills` 表有 2 个先于本次改动存在的历史遗留 builtin 行——`16000000000106`（病毒传播 STEPPS，2026-09-22 建）与 `yingce-styleforge`（风格锻造，2026-10-07 建），二者已不在 `backend/builtin/` 代码树中（`EnsureBuiltinSkills` 语义为 upsert，不清理旧行）。本次投产**未触碰**这两行；指令单预期的「73 → 74」按现役包口径成立（73 现役 + chaoge = 74 现役，落库后 builtin 行 75 → 76）。

## 回执 2：主人在前端启用/使用路径（3 步）

1. 浏览器打开 `http://127.0.0.1:3000`（控制台 `http://127.0.0.1:17580` 已自动拉起全部服务）；
2. 右侧 Agent 面板打开技能选择——`chaoge-film-director-flex` **已默认启用**（zhuren 账号 43 个已启用技能之一，drama 分类，sortWeight 96 排头部）；也可一键挂载「短剧爆款起步」预设（已含 chaoge，5/8 额度）；
3. 直接发指令，例如：*"用 AI导演2.0 帮我拍一段定稿剧本：[剧本正文]，走 C 路线直接视频制作，平台选即梦（Seedance 2.5）。"* Agent 将按 P0 → P0A 十项解析 → P1 → C 路线四表 → P3 导演地图 → P5 调 `director_validate_prompt` 自检后交付提示词。

## 回执 3：双技能同场检索排序实测（chaoge vs 影视剧作工坊）

实测快照 = 真库两个包同时启用（`cloudAgentSkills` 同入口）：

| 查询 | 顶卡技能 | 分差 | 命中路径 |
|---|---|---|---|
| 即梦 | **chaoge** | 6 : 4 | `references/prompt_templates.md` |
| Seedance | **chaoge** | 6 : 4 | `references/seedance_versions.md` |
| P0A / 三路线 / 角色设定板 | **chaoge** | 4 : 0（对方无命中） | workflow / workflow / character_assets |
| 定稿剧本 AI导演2.0 即梦视频提示词 Seedance | **chaoge** | 10 : 4 | `references/seedance_versions.md` |
| 分镜 | **影视剧作工坊** | 6 : 0 | 触发与任务识别/spec |
| 剧本打磨 角色弧光 分镜 | **影视剧作工坊** | 6 : 0 | 触发与任务识别/spec |
| 一镜到底 / 360度补角 / 空间推演 | 双包合法重叠（4:4） | — | chaoge 保持在命中列 |

结论：定稿制片类查询 chaoge 综合得分排第一，剧本打磨类影视剧作工坊排第一，互不抢戏。以上行为由 `cloud_agent_dual_skill_ranking_test.go` 四个断言用例固化守门。

**顺带修复的排序缺陷**：初测发现「生产路线」的顶卡曾是台账模板（其 H2 节名与权威文档 H1 同分，按排序号侥幸胜出）。已在 `cloud_agent_tools_skills.go` 增加 **H1 身份索引与平分裁决**（slug > H1 > 小节标题；hit=0 不参与裁决），修复后「生产路线」「三路线」「三路线 生产路线」全部直达 `references/production_routes.md` / `workflow.md`。该 bug 由既有卡预算测试抓到，修复后全量回归绿。

## 回执 4：全景技术文档基线同步

`reports/panorama/` 已刷新并重合并（`panorama-merged.md` 由 `merge_panorama.py` 重新生成；合并脚本先用原始头部回归验证**逐字节一致**后才用于再合并）：

- 技能包数 73 → **74**；SKILL.md 89 → **90**；builtin 文件 1139 → **1166**；references 16 → **34**（+18，chaoge 18 份）；.py 32 → **36**；scripts 66 → **70**；drama 26 → **27**
- `B-路径索引.md`：新增 `backend/internal/director/`（3 文件）、`cloud_agent_director_tools.go`、chaoge 包与 references、两个生成脚本、双轨镜像路径
- `10-Agent运行时.md`：工具清单补两个导演校验工具；检索打分节补充「文件名 slug + Markdown 标题结构索引」双通道 4 分召回与平分裁决说明
- `D-数据口径与复现.md`：口径表更新 + 2026-10-23 变更记录一行
- 00/01/02/07/13 章的 73/1139/89/26 旧数同步刷新；07 章新增「十一、新成员：chaoge-film-director-flex」小节

---

## 测试与门禁状态

| 范围 | 结果 |
|---|---|
| `go test ./internal/director/...` | ok（对账 2 用例） |
| `go test ./internal/skills/...` | ok（33 用例，含影视工坊零回归 + 预设目录校验） |
| `go test ./internal/app/ -run "TestAgentDirector\|TestChaoge\|TestDualSkillRanking\|TestCloudAgentSkillSearch\|TestCloudAgentToolTable"` | ok |
| 真库冒烟 `CHAOGE_REAL_DB_SMOKE=1`（重启后复跑） | PASS（search→read→validate 全闭环） |
| `CGO_ENABLED=0 go build ./...` | exit 0 |
| 全量 `go test ./internal/app/` | 6 个 channel/provider 用例失败 + 10 分钟超时——**均为既存失败**：基线文件 `reports/go-test-baseline-pre-absorb.txt` 记载同样 6 项；并在基线 commit `c21d634f4` 的干净 worktree 上复跑确认同样失败（与本次改动零关联） |

## 既存事项（非本次引入，如实上报）

1. 控制台自检提示两个本地补丁缺失（`model-adapt`、`agent-runtime-stability`）：补丁目标源码本就无该特征、`git status` 干净、投产前后二进制均无——属 `_ops/local-patches/` 补丁未应用的既存状态，一条命令可补：`python _ops\local-patches\reapply.py`（未代为执行，避免中途改变运行态）。
2. Canvas Agent（MCP）未启动：控制台默认服务清单不含它，按需单独启动。
3. 真库 2 个历史遗留 builtin 行（见回执 1 说明），未清理。
