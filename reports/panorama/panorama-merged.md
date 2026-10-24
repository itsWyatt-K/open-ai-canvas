# 源起（open-ai-canvas）系统全景技术文档（合并版）

> 本文是分章版的合并单文件版，便于整份传阅。分章版位于同目录。

> 数据基线：实测 2026-10-23，HEAD = 03e1cb9ec，分支 absorb/upstream-v1.6.5-agent-pi，schema 58。


---

## 源起（open-ai-canvas）系统全景技术文档

> **本文档基线**：所有数据实测于 2026-10-23；代码基线 `HEAD = 03e1cb9ec`，分支 `absorb/upstream-v1.6.5-agent-pi`；数据库 schema 版本 `58`。
> 后续如系统演进，请以附录 D「数据口径与复现」的记录为准，并在该附录追加变更记录，不改写正文历史数据。

---

## 这份文档是给谁看的

给**读不到我们本地文件**的外部方：合作方工程师、审计方、新加入团队成员。

因此本文遵循三条硬规矩：

1. **自包含**——每一个被提到的文件，都给出「路径 + 作用 + 关键内容摘要」，必要时附关键代码片段。您不需要打开我们的代码仓库也能读懂。
2. **术语通俗化**——读者可能是非程序员。专业术语首次出现时附一句大白话解释。
3. **数据可复现**——每个统计数字都附「实测日期 + 统计口径 + 复现命令」。代码在增长，数字会漂移，给了命令您就能自己重新量。

## 路径约定

| 写法 | 含义 |
|---|---|
| `backend/internal/...` | 相对于仓库根 `D:\AlcheMvision\open-ai-canvas\` 的 Go 后端代码 |
| `web/src/...` | 相对于 `D:\AlcheMvision\open-ai-canvas\web\` 的前端代码 |
| `nxf/...` | 工作区另一条线，根为 `D:\AlcheMvision\nxf\` |
| `judian-skills/...` | 工作区投稿仓，根为 `D:\AlcheMvision\judian-skills\` |

本文提到的所有路径都不含密钥、令牌、连接串。数据库只描述到 `.local/data/` 目录级别。

## 一句话说明这是什么

**源起**是一套 AI 内容创作工作台：后端用 Go 写（约 22 万行），前端用 React + TypeScript 写（约 19 万行），数据库同时支持 SQLite 和 PostgreSQL。它的核心能力是「画布」——用户在画布上摆放各种节点（图片、文本、视频、脚本……），节点之间连线，由系统调度 AI 模型生成内容。系统内置 **73 个技能包**（本质是结构化的提示词与方法论知识库），并带一个完整的「电商工坊」领域模块，可以把一张商品图变成一整套电商详情页。

## 章节导航

| 章节 | 内容 | 适合谁 |
|---|---|---|
| [01 系统总览](01-系统总览.md) | 这是什么、由哪些服务组成、一次请求怎么走完全程 | 所有人，先读这章 |
| [02 技术栈与工程规模](02-技术栈与工程规模.md) | 技术选型、可复现的规模体检报告、目录地图 | 想评估工程量的人 |
| [03 仓库与版本管理](03-仓库与版本管理.md) | 与上游开源项目的关系、tag 体系、上游合并机制 | 关心代码来源与合规的人 |
| [04 后端架构](04-后端架构.md) | 分层职责、启动装配 16 步、中间件、优雅停机 | 后端工程师 |
| [05 前端架构](05-前端架构.md) | 目录地图、20 种节点类型、主页面组织方式 | 前端工程师 |
| [06 数据库](06-数据库.md) | 双驱动切换、58 条迁移账本、checksum 机制、核心表 | 后端/DBA |
| [07 技能体系](07-技能体系.md) ★ | 73 个技能包的结构、加载链、触发机制、版本同步 | 重点章 |
| [08 画布系统](08-画布系统.md) | 节点注册、渲染三层分层、云端同步与锁修复 | 前端/架构 |
| [09 电商工坊](09-电商工坊.md) ★ | 领域模型、状态机、12 段视觉方案编译器、合规闸门 | 重点章 |
| [10 Agent 运行时](10-Agent运行时.md) | Go 如何驱动 Node 子进程、三通道通信、工具条件注入 | 架构 |
| [11 任务、计费与模型路由](11-任务计费与模型路由.md) | 任务生命周期、计费链路、模型渠道体系 | 后端 |
| [12 安全、合规与质量](12-安全合规与质量.md) | 鉴权、内容合规闸门、测试体系、质量门禁 | 安全/测试 |
| [13 部署、运维与工作区生态](13-部署运维与工作区生态.md) | 本地启动链、容器化、蒸馏产线三仓关系 | 运维 |
| [附录 A 术语表](A-术语表.md) | 约 40 条术语的大白话解释 | 随时查 |
| [附录 B 路径索引](B-路径索引.md) | 文档提到的每个文件 = 路径 + 一行作用 | 当字典查 |
| [附录 C 读者自查清单](C-读者自查清单.md) | 读完您应该能回答的 25 个问题 | 自测 |
| [附录 D 数据口径与复现](D-数据口径与复现.md) | 每个数字怎么量出来的、文档变更记录 | 复核 |

★ = 篇幅最重的两章。

## 已知待确认项

文档中有 4 处标注了「**待确认**」，都是我们尚未在工作区内核实到的信息，写文档时如实标注而非猜测：

1. `judian-skills` 投稿仓当前的真实状态（第 7、13 章）
2. nxf 酿笑坊引擎 8823 服务现在由谁拉活、暴露给谁（第 13 章）
3. 画布三种渲染引擎（tldraw / excalidraw / leafer-ui）的实时分工边界（第 8 章）
4. 计费公式的精确表达式与失败退费策略（第 11 章）

这些不影响主体架构理解，但若您需要拿这份文档做正式技术评审，建议先补齐这 4 项。


---

## 01 系统总览

## 本章目的

用最短篇幅说清四件事：这套系统是什么、由哪几个进程组成、怎么把它跑起来、一次"生成图片"的请求会穿过哪些层。读完全章您应该能在脑子里画出一张粗框图。

## 一、它是什么

**源起（内部代号，对外仓库名 open-ai-canvas）**是一套 AI 内容创作工作台。名字里的"canvas"（画布）是它的核心隐喻：用户面对一块无限大的画布，把「图片」「文本」「视频」「脚本」「表格」等节点摆上去，用线把它们连起来，系统据此调度 AI 模型干活。

它覆盖的真实业务场景至少有三类：

- **影视/短剧创作**：从故事板到分镜到成片的流程化生产（内置 74 个技能包中 27 个是 drama 影视类）
- **电商出品**：把一张商品实拍图，变成一整套符合平台规范的详情页（这是最近一年改动最重的领域，见第 9 章）
- **通用素材生成**：图片/视频生成、批量表格、风格预设等

系统不是从零写的：它 **fork 自开源项目 `ddcat-ai/open-ai-canvas`**，我们在其上空活了大量私有领域能力（电商工坊是主体）。与上游的协作方式见第 3 章。

## 二、由哪些进程组成

本机运行时是「**一个控制台 + 四项服务 + 一个按需启动的旁路引擎**」的拓扑。

```
┌─────────────────────────────────────────────────────────────┐
│  控制台面板  yuanqi_console.py          127.0.0.1:17580      │
│  （Python 写的管理面板，负责拉起/停止下面四项服务）            │
└─────────────────────────────────────────────────────────────┘
        │                │                 │              │
        ▼                ▼                 ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ 后端 API      │ │ 前端 dev     │ │ E-Reverse    │ │ cloudflared  │
│ Go+Gin        │ │ Vite+React   │ │ Python 侧车  │ │ 公网隧道     │
│ :8080         │ │ :3000        │ │ :8790        │ │ 随机端口     │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
        │
        │ 需要时再启（不受控制台管理）
        ▼
┌──────────────────────────────────────────────┐
│ nxf 酿笑坊引擎（视觉 DNA / 蒸馏）  :8823       │
│ 由 nxf/_engine/yingce_bridge/service.py 提供  │
└──────────────────────────────────────────────┘
```

### 各进程职责

| 进程 | 端口 | 是什么 | 关键路径 |
|---|---|---|---|
| 控制台面板 | 17580 | Python 写的本地管理面板，提供启停服务、看日志、改配置的 Web 界面 | `yuanqi_console.py` |
| 后端 API | 8080 | 系统主体。Go 1.25 写，Gin 做 HTTP 框架，GORM 做数据库访问 | `backend/cmd/server/main.go` |
| 前端 | 3000 | Vite 开发的 React 19 应用，生产模式由后端直接伺服静态文件 | `web/src/` |
| E-Reverse | 8790 | Python 侧车服务，负责"逆向"链路（把平台规范/合规词表转成可执行的约束） | `工具/e-reverse/` |
| 公网隧道 | 随机 | cloudflared，把本地服务临时暴露成公网 HTTPS 链接（用于移动端真机测试） | 由控制台调起 |
| nxf 引擎 | 8823 | 视觉 DNA 提取 + 技能蒸馏的离线/半离线工具链，**不在控制台管理范围内** | `nxf/_engine/` |

> **重要澄清**：早前有"本地五服务一键启动"的说法，不准确。控制台实际只管理前四项；nxf 的 8823 服务要单独启动（`nxf/` 目录下有独立启动脚本）。这一点在对外描述时务必区分，否则对方会以为少了一个服务。

### 数据库文件

后端默认用 SQLite，数据文件在 `.local/data/open_ai_canvas.db`（WAL 模式）。当前实测约 103 MB。可切换 PostgreSQL，切换方式见第 6 章。

## 三、怎么把它跑起来

```
双击 启动源起.bat
   │
   ├─ 先清空所有代理环境变量（HTTP_PROXY/HTTPS_PROXY 等）
   │    └─ 原因：本机代理会劫持 127.0.0.1 的本地请求，导致服务间调用失败
   │
   └─ 调用 yuanqi_console.py（Python 3.13.12）
        │
        ├─ 按 SERVICES 清单依次拉起：backend → frontend → ereverse → cloudflared
        ├─ 每起一个就轮询等它的端口真正 LISTENING（带 boot_trace 埋点记录启动耗时）
        └─ 全部就绪后，面板在 http://127.0.0.1:17580 可访问
```

停止用 `停止源起.bat`。

后端默认使用预编译二进制 `.local/canvas-backend.exe`（约 109 MB，Go 静态编译产物，不依赖本机 Go 环境）。源码在 `backend/`，重新构建命令见第 2 章。

## 四、一次"生成图片"请求穿过哪些层

以最典型的"用户在画布上点生成"为例，请求会穿过：

```
① 浏览器（React）
   │  POST /api/tasks
   ▼
② 后端 HTTP 层（Gin handler）
   │  鉴权中间件 → 参数校验 → 构造 Task 行（status=queued）
   ▼
③ 任务派发器（taskWorker）
   │  定时轮询，ClaimNextTask 认领（status=queued → running，加租约）
   ▼
④ 任务执行器（按任务类型分叉）
   │  canvas_image 类型 → 组装提示词 → 选渠道/模型
   ▼
⑤ 模型协议层（internal/protocol）
   │  按渠道协议（OpenAI 兼容 / Gemini / 方舟 / 即梦…）转成上游 API 调用
   ▼
⑥ 上游模型服务商（外部 HTTP）
   │  返回图片 URL 或 base64
   ▼
⑦ 结果落库 + 媒体下载 + 资源入库
   │
   ▼
⑧ 前端轮询到终态 → 画布节点显示成品图
```

**关键设计**：第 ③ 步的"认领"用数据库行锁 + 租约（lease）实现多 worker 分工，不会两个 worker 抢同一个任务。第 ⑦ 步的媒体是**先落资源库再回写节点**，所以即使前端刷新，成品也不会丢。

这条链路里最常出问题的是第 ③ 步（SQLite 写锁）和第 ⑦ 步（画布节点回写与画布保存抢锁），两者的治理方案分别见第 11 章和第 8 章。

## 五、规模速览（实测 2026-10-22）

| 指标 | 数值 |
|---|---|
| Go 代码 | 1050 个文件 / 220,693 行 |
| 前端 TS+TSX（`web/src`） | 1031 个文件 / 192,573 行 |
| 前端测试（`web/test`） | 332 个 .ts/.tsx / 33,147 行 |
| Go 测试文件 | 425 个 `*_test.go` |
| 内置技能包 | 74 个 / 90 个 SKILL.md / 1166 个文件 |
| 数据库迁移 | 58 条（schema 版本 58） |
| 画布组件文件 | 159 个 |

## 六、与其他章的关系

- 想理解"为什么数据库有 58 条迁移、其中 55-58 为什么这么排" → 第 3 章、第 6 章
- 想理解第 ④ 步执行器对电商任务的特殊处理 → 第 9 章
- 想理解技能在第 ④ 步如何被 Agent 按需读取 → 第 10 章
- 想理解第 ⑤ 步协议层如何适配几十家模型商 → 第 11 章


---

## 02 技术栈与工程规模

## 本章目的

给出一份**可复现的"体检报告"**：用什么技术、代码有多少、目录怎么摆。所有数字都附了复现命令，您可以自己重新量。

## 一、技术栈

### 后端

| 项 | 选型 | 说明 |
|---|---|---|
| 语言 | Go 1.25 | 静态编译，单二进制部署，无运行时依赖 |
| HTTP 框架 | Gin | 路由 + 中间件体系 |
| ORM | GORM | 同时支持 SQLite 与 PostgreSQL，用 Dialect 区分 |
| 数据库 | SQLite（默认）/ PostgreSQL | 切换见第 6 章 |
| 嵌入式资源 | `//go:embed` | 把 74 个技能包、工作台模板等直接编译进二进制 |
| 子进程 | Node.js | Agent 运行时是 Node 进程，由 Go 启动并通信（第 10 章） |

### 前端

| 项 | 选选 | 说明 |
|---|---|---|
| 框架 | React 19 + TypeScript | 函数组件 + Hooks |
| 构建 | Vite | 开发服务器 :3000，构建产物由后端伺服 |
| UI 库 | antd | 表格/表单/弹窗等基础组件 |
| 状态管理 | zustand | 轻量 store，无样板代码 |
| 数据请求 | TanStack Query（react-query） | 缓存 + 轮询 + 失效 |
| 测试 | `bun test` | 用 Bun 运行时跑测试，比 vitest 快 |
| 画布引擎 | 多引擎并存 | 见第 8 章（**待确认**：三引擎实时分工边界） |

### 工程命令

```bash
# 后端
cd backend
go build ./...                    # 全量编译
go vet ./...                      # 静态检查
go test ./...                     # 全量测试（本机约 10-12 分钟）

# 前端
cd web
bun run typecheck                 # tsc --noEmit 类型检查
bun run build                     # vite build 生产构建
bun test                          # 前端测试（DOM 测试需 HAPPY_DOM=1，见第 12 章）
```

## 二、规模体检报告（实测 2026-10-22）

### 代码量

| 范围 | 文件数 | 行数 | 复现命令 |
|---|---|---|---|
| Go 源码（`backend/`，排除测试） | 1050 | 220,693 | `find backend -name '*.go' -not -path '*/node_modules/*' \| wc -l` + `wc -l` |
| 前端源码（`web/src`，.ts+.tsx） | 1031 | 192,573 | `find web/src -name '*.ts' -o -name '*.tsx' \| wc -l` |
| 前端测试（`web/test`） | 332 | 33,147 | `find web/test -name '*.ts' -o -name '*.tsx' \| wc -l` |
| Go 测试文件 | 425 | — | `find backend -name '*_test.go' \| wc -l` |
| 画布组件（`web/src/components/canvas/`） | 159 | — | `ls web/src/components/canvas/ \| wc -l` |
| 内置技能包 | 74 | — | `ls backend/builtin/ \| wc -l` |

> 注：Go 文件数 1050 是**含测试文件**的总数（425 个是 `*_test.go`，其余 625 个是源码）。行数会随提交增长，量的时候请以您手上的 commit 为准。

### 最大的几个文件（行数）

| 文件 | 行数 | 为什么大 |
|---|---|---|
| `web/src/pages/canvas/project.tsx` | 3,589 | 画布主页面，组合约 25 个 `useCanvas*` hook |
| `backend/internal/app/ecommerce_orchestrator.go` | 1,394 | 电商派发编排主入口 |
| `backend/internal/ecommerce/plandetail.go` | 675 | 12 段视觉方案编译器 |
| `backend/internal/ecommerce/platforms.go` | 442 | 6 大平台槽位规范字典 |
| `backend/internal/ecommerce/config.go` | 323 | 电商用户配置（与桌面面板逐项对应） |
| `web/src/services/user-data-sync.ts` | 约 700 | 画布云端同步核心 |

## 三、仓库顶层目录地图

以仓库根 `D:\AlcheMvision\open-ai-canvas\` 为基准：

| 目录/文件 | 作用 |
|---|---|
| `backend/` | Go 后端主体（见第 4 章） |
| `backend/builtin/` | **74 个内置技能包**，`go:embed` 进二进制（见第 7 章） |
| `web/` | 前端主体（见第 5 章） |
| `canvas-agent/` | 旧版 Agent 实现的 TS 源码（16 个文件）。**当前运行时已改用 `agent-runtime/`**，此目录是遗留代码，文档中如无特别说明均指新实现 |
| `agent-runtime/` | Node 版 Agent 运行时（被 Go 当子进程拉起，见第 10 章） |
| `plugin-packages/` | 模型协议插件包（如千问、MiniMax、Seedream 等，每个是一个 manifest + 实现） |
| `docs/content/docs/` | MDX 文档站，教人"怎么用系统"；本文档是"系统是什么"，两者互补 |
| `reports/` | 阶段验收报告、本文档所在目录 |
| `_ops/`、`scripts/` | 运维脚本与构建脚本 |
| `docker/`、`Dockerfile`、`docker-compose*.yml`、`nginx.conf` | 容器化部署（见第 13 章） |
| `.local/` | 本机运行产物：`canvas-backend.exe` 预编译二进制、`data/open_ai_canvas.db` 数据库、历史 `.bak` 备份 |
| `AGENTS.md` | 给 AI 协作助手的项目规范（含上游只读铁律） |
| `CHANGELOG.md` | 版本变更日志 |
| `VERSION` | 当前版本号（实测 `v1.6.8.3`） |
| `启动源起.bat` / `停止源起.bat` / `启动影策.bat` / `停止影策.bat` | 本机启停脚本 |
| `yuanqi_console.py` | 控制台面板本体（Python） |
| `.gitattributes` | 强制 `backend/builtin/**` 用 LF 换行（见第 7 章，这是技能哈希校验的前提） |

## 四、与既有文档站的分工

仓库里有 `docs/content/docs/` 下的 MDX 文档站，那是**面向使用者**的操作手册（怎么配置渠道、怎么用工作台）。本文档是**面向技术评审者**的结构说明。两者不重复：本文讲"为什么这样设计、数据怎么流"，文档站讲"点哪里"。

## 五、与其他章的关系

- 想了解这些代码怎么分层组织 → 第 4 章（后端）、第 5 章（前端）
- 想了解 74 个技能包为什么能塞进二进制 → 第 7 章
- 想了解 `plugin-packages/` 的插件机制 → 第 11 章


---

## 03 仓库与版本管理

## 本章目的

解释三件外部方最容易困惑的事：这套代码和开源上游是什么关系、`git tag` 那一大堆前缀是什么意思、上游的新版本是怎么被"吸收"进来的（尤其是数据库迁移号撞车是怎么解的）。

## 一、与上游的 fork 关系

```
github.com/ddcat-ai/open-ai-canvas        ← 上游（开源项目，别人维护）
        │
        │  fork
        ▼
github.com/itsWyatt-K/open-ai-canvas      ← 我们自己的 fork（localfork）
        │
        │  clone 到本地 + 大量私有领域开发
        ▼
D:\AlcheMvision\open-ai-canvas            ← 本地私有工程（本文档主角）
```

本地仓库配了两个 remote（`git remote -v` 实测）：

| 名称 | URL | 用途 |
|---|---|---|
| `upstream` | `https://github.com/ddcat-ai/open-ai-canvas.git` | 只读拉取上游新版本 |
| `localfork` | `https://github.com/itsWyatt-K/open-ai-canvas.git` | 我们自己的远端 |

**铁律**：`upstream` 的 push URL 被显式锁死为占位符 `PUSH-DISABLED-check-docs`——这是故意为之，从机制上保证**绝不向上游推送、绝不提 PR**。我们只 `fetch` 上游，在本地合并。优化成果以本地提交和本地 tag 交付。

> 这也是合规边界：我们的私有领域代码（电商工坊、技能体系增量）不外泄，上游的开源贡献也不被我们污染。

## 二、tag 体系（138 个 tag，五类）

`git tag` 实测有 138 个，按前缀分五类，各有明确用途：

| 前缀 | 含义 | 例子 |
|---|---|---|
| `v1.6.x` / `v1.5.x` | 与上游版本对应的发布点 | `v1.6.8.3`、`v1.6.5` |
| `absorbed/upstream-*` | **吸收完成标记**：某个上游版本已被完整合入 | `absorbed/upstream-20260927` |
| `backup/*` | **合并前备份**：吸收上游前的最后稳定态，回滚用 | `backup/before-upstream-v1.6.8`、`backup/upstream-7ce07a4c0` |
| `baseline/*` | **自愈基线**：仓库出问题后固化的"已知良好"状态 | `baseline/pre-absorb-upstream-v1.5.9` |
| `archive/wip/*` | 未完成的吸收尝试存档 | `archive/wip/merge-v1.5.8.2-uncompilable` |

**回滚时怎么用**：如果一次上游吸收把系统搞坏了，最快的恢复路径是「停服 → 用 `backup/*` 对应的数据库备份恢复 → checkout 到合并前的 commit」。第 13 章会讲数据库迁移不可逆这个约束。

## 三、当前分支在干什么

当前分支叫 **`absorb/upstream-v1.6.5-agent-pi`**——名字就说明了它的使命：最初为了吸收上游 v1.6.5 而切出，之后成为"版本吸收主线"。

它同时承载两类提交：
1. **上游吸收合并提交**（merge commit，双父）
2. **我们自己的领域开发**（电商工坊 stage0-5、Agent 运行时修复、SQLite 锁治理等）

最近的提交链（`git log --oneline -6` 实测）：

```
c21d634f4  test(database): align migration test assertions with local schema
32ceba085  Merge upstream v1.6.8.x stage1: db perf (#789) + provider catalog
97dd3b561  fix(stage5): commit AI-plan guard and legacy prompt repair
1dab360c0  fix(sqlite-lock): backoff-retry task claim and throttle+debounce
53bb8c0b0  fix(stage5-returnC): poster-grade prompt contract, AI-plan guard
f44006b18  fix(stage5-returnB): standard pixel-size fallback, clean slot prompts
```

## 四、上游吸收机制：以 schema 撞号为例

这是整套版本管理里**最技术、最容易出错**的一环，值得展开讲。

### 4.1 问题：迁移号撞车

系统用「顺序编号的数据库迁移」管理表结构（见第 6 章）。合并上游时，如果上游也新增了迁移，而号段已被我们占用，就会撞车。

实际发生的案例（2026-10-21 完成阶段一合并）：

| 迁移号 | 我们本地已占用 | 上游 v1.6.8.x 也要用 |
|---|---|---|
| v55 | `ecommerce_workshop`（电商五表） | `provider_catalog_source`（渠道目录来源） |
| v56 | `ecommerce_plan_review`（分屏审核字段） | `sql_perf_indexes`（性能索引） |
| v57 | — | `canvas_multi_session_sync`（多窗实时光标） |

### 4.2 解法：新来者顺延拿新号

沿用历史上 `7608d59e3` 合入上游 v1.6.8 时的惯例——**先占号的不动，新来的顺延**：

```
v54  workbench_tools_and_presets   ← 双方一致（checksum 相同）
v55  ecommerce_workshop            ← 我们的，一字不动
v56  ecommerce_plan_review         ← 我们的，一字不动
v57  provider_catalog_source       ← 上游的，从 55 顺延到 57
v58  sql_perf_indexes              ← 上游的，从 56 顺延到 58
（v59 预留给 canvas_multi_session_sync，阶段二合并时处理）
```

对应代码改动在 `backend/internal/database/migrations.go`：`CurrentSchemaVersion` 从 56 改成 58，上游两条迁移条目追加在本地 v56 之后，`version` 字段与 checksum 字符串里内嵌的版本号同步改。

### 4.3 为什么不会导致校验失败

迁移系统有个安全设计：**只有当数据库里已经存在某个 version 的记录时，才比对你的 name/checksum 和代码里的是否一致，不一致就拒绝启动**（防止代码改了已执行过的迁移导致账实不符）。

- 我们本地库的 1..56 条记录身份与合并后代码完全一致 → 校验通过，跳过
- 57/58 在任何本地库里都不存在（上游那部分代码我们此前根本没合过）→ 首次执行时 apply，然后**按代码里的新 checksum 记账**，从此代码与账本永远一致

### 4.4 已生产库的升级路径

真库原本 `MAX(version)=56`。升级到新代码后：

```
MigrateSchema 单事务遍历迁移计划
  ├─ v1..v56：库里都有记录且身份一致 → 校验通过，跳过
  ├─ v57/v58：缺失 → 按序 apply + 记账
  └─ 结束：MAX=58 = CurrentSchemaVersion → ready
```

任何一步失败整体回滚，账本不会留半截记录。**实测验证过**：用真库副本跑迁移，`{"current":58,"expected":58,"ready":true}`，且新增的 4 个列、4 个索引全部就位。

## 五、`.gitattributes` 为什么重要

仓库根有 `.gitattributes`，其中一条：

```
backend/builtin/** text eol=lf
```

**原因**：技能包的加载机制会给每个技能算 SHA-256 内容哈希（见第 7 章）。Windows 的 Git 默认会把文本文件的换行转成 CRLF，如果不强制 LF，同一个技能在 Windows 上克隆后哈希值就变了，会导致「技能被判定为已修改」、版本同步机制失效。所以这条配置是技能体系正确性的前提，不是可选项。

## 六、阶段一与阶段二

| 阶段 | 内容 | 状态 |
|---|---|---|
| **阶段一** | 上游 db 性能优化（SQLite 时间索引、钱包读写改先读后写）+ 渠道目录 + 若干修复 | ✅ 已合入（`32ceba085`），真机验证通过 |
| **阶段二** | 画布同步大重构（编辑租约、多端同步、保存冲突恢复）+ 多窗实时光标 | ⏸ 未合入 |

**阶段二为什么暂缓**：上游对 `web/src/services/user-data-sync.ts`（画布云端同步核心）做了 +577/-138 行的大重构，而我们在 `1dab360c0` 刚为修 SQLite 锁改过同一个文件（节流+防抖混合调度）。两套机制叠在一起的收益不明确、风险不小，所以先观察阶段一的实际效果。

## 七、与其他章的关系

- 迁移机制的完整设计 → 第 6 章
- 技能哈希为什么也怕换行符 → 第 7 章
- 阶段二涉及的画布同步 → 第 8 章
- 回滚时数据库为什么不可逆 → 第 6 章、第 13 章


---

## 04 后端架构

## 本章目的

说清后端怎么分层、每层负责什么、启动时按什么顺序装配、以及哪些横切关注点（日志/脱敏/优雅停机）在哪里。

## 一、分层架构

```
                    HTTP 请求
                       │
                       ▼
┌──────────────────────────────────────────┐
│  internal/handler        （HTTP 层）      │  路由注册、参数绑定、响应包装
│  84 个文件 / 约 430 条路由                 │
└──────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────┐
│  internal/app            （编排层）        │  ★ 最大最重
│  Service 结构体 + 几十个领域文件           │  业务流程编排、事务边界、任务派发
└──────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────┐
│  internal/repository     （数据访问层）    │  SQL/GORM 操作，无业务逻辑
│  internal/model          （领域模型）      │  表结构 struct 定义
└──────────────────────────────────────────┘
                       │
                       ▼
               SQLite / PostgreSQL
```

侧挂的横向能力包：

| 包 | 职责 |
|---|---|
| `internal/ecommerce/` | 电商工坊**领域层**（纯业务规则，不碰 HTTP）——第 9 章主角 |
| `internal/database/` | 连接池 + 58 条迁移（第 6 章） |
| `internal/protocol/` | 模型协议适配（把内部请求转成各上游 API 格式） |
| `internal/provider/`、`internal/providercatalog/` | 服务商目录与渠道模型体系 |
| `internal/generation/` | 生成任务的核心执行逻辑 |
| `internal/agent/`、`internal/agentcontext/`、`internal/yingceagent/` | Agent 运行时（第 10 章） |
| `internal/skills/` | 技能加载与检索（第 7 章） |
| `internal/canvas/` | 画布后端（节点/连接的持久化与协作） |
| `internal/auth/` | 鉴权（第 12 章） |
| `internal/payment/`、`internal/platform/` | 支付与平台集成 |
| `internal/workbench/`、`internal/tools/` | 工作台与内置工具目录 |
| `internal/hostupdate/` | 在线更新（第 13 章） |
| `internal/kernel/` | 基础设施（ID 生成、token 计费内核等） |

### `internal/app` 是重心

这一层没有按业务拆成多个包，而是用**一个 `Service` 结构体 + 几十个领域文件**的组织方式。原因是这些领域共享同一套 repository、事务边界和任务派发器，拆包会带来大量循环依赖。

代表性文件：

| 文件 | 行数 | 职责 |
|---|---|---|
| `ecommerce_orchestrator.go` | 1,394 | 电商派发编排（第 9 章） |
| `task_worker.go` | 477 | 任务派发器主循环 |
| `admin.go` | — | 运营后台 |
| `cloud_agent_*.go` | 约 100 个文件 | 云端 Agent 的工具、审批、记忆、恢复 |

## 二、启动装配：main.go 的 16 步

`backend/cmd/server/main.go`（334 行）的启动顺序**是有依赖关系的**，前一步失败即退出：

```
 1. Open()                      打开数据库连接（SQLite/Postgres）
 2. ConfigurePool()             配置连接池参数
 3. MigrateSchema()             执行迁移，把库升到 CurrentSchemaVersion
 4. repository.New()            构造数据访问层
 5. service.New()               构造编排层（注入 repo、provider、worker 等）
 6. ValidateRuntime()           校验运行时配置（缺关键配置直接失败）
 7. EnsureSystemChannelModels() 确保系统渠道的模型清单存在
 8. EnsureDefaultPromptTemplates()   确保默认提示词模板存在
 9. EnsureBuiltinProjectWorkflowTemplate()  确保内置项目工作流模板存在
10. EnsureBuiltinSkills()       ★ 把 73 个技能包解析并 upsert 进 skills 表
11. EnsureSkillPackages()       确保技能包的目录记录
12. EnsureBuiltinTools()        确保内置工具目录
13. EnsureBuiltinWorkbenchCatalog()  确保工作台目录
14. MigrateLegacyStorage()      旧存储路径迁移
15. Gin 中间件 + 路由注册        AccessLog / Recovery / RequestCorrelation / CORS
16. StartWorker()               启动任务派发器
    └─ BackfillPlaybackTranscodes()  启动时回填视频播放副本
```

**第 10 步是技能体系的关键入口**：技能包通过 `//go:embed` 编译进二进制，启动时被解析成数据库记录。详见第 7 章。

### 优雅停机

收到停止信号后的顺序：

```
1. HTTP 服务停止接受新请求，等在途请求收尾（drain 上限 30 秒）
2. 任务 worker 停止认领新任务，等在途任务收尾（drain 上限 10 分钟）
   └─ 已认领但没做完的任务靠"租约过期"机制被下一个 worker 捡起，不会丢
3. 关闭数据库连接
```

## 三、横切关注点

### 中间件（按注册顺序）

| 中间件 | 作用 |
|---|---|
| Recovery | panic 时不崩进程，转成 500 响应 |
| RequestCorrelation | 给每个请求分配 request_id，串起全链路日志 |
| AccessLog | 记录 method/path/status/latency/ip |
| CORS | 跨域策略（第 12 章） |

### 日志脱敏（安全设计实例）

后端在写访问日志时会主动脱敏。实例是 `redactCanvasSharePath`：画布分享链接形如 `/api/public/canvas-shares/<token>`，其中 `<token>` 是访问凭证，日志里会被替换成字面量 `:token`，避免凭证泄露到日志文件。

```
原始路径  /api/public/canvas-shares/abc123def456/resources/x/file
日志记录  /api/public/canvas-shares/:token/resources/x/file
```

### 错误语义

后端用 `NewAppError(status, message)` 构造业务错误，message 是**给用户看的中文可读说明**，不含内部堆栈。内部诊断信息走单独的日志通道。

## 四、与其他章的关系

- 第 3 步的迁移机制细节 → 第 6 章
- 第 10 步的技能装配细节 → 第 7 章
- 第 16 步的任务派发与锁治理 → 第 11 章
- 中间件里的 CORS 与鉴权 → 第 12 章


---

## 05 前端架构

## 本章目的

让读者能在前端正确定位任何一个功能：目录怎么摆、画布主页面为什么有 3589 行、20 种节点类型分别是什么、状态怎么管。

## 一、`web/src` 目录地图

| 目录 | 职责 |
|---|---|
| `pages/canvas/` | **画布系统**，前端最重的部分（`project.tsx` 3589 行是主页面） |
| `pages/ecommerce/` | 电商工坊的独立页面（三步向导、任务详情、槽位编辑器） |
| `pages/create/` | 创作首页 |
| `pages/inspirations/` | 灵感广场 |
| `pages/assets/` | 资产库 |
| `pages/admin/` | 运营后台 |
| `pages/ereverse/` | E-Reverse 侧车的前端界面 |
| `pages/workbench/` | 工作台 |
| `pages/skills/` | 技能管理 |
| `pages/tasks/` | 任务中心 |
| `pages/settings/` | 设置 |
| `components/canvas/` | **159 个画布组件文件**（第 8 章） |
| `lib/canvas/` | 画布领域逻辑：节点注册表、工具注册表、`commerce-*.ts` 系列 |
| `services/` | API 客户端与云端同步（`user-data-sync.ts` 是同步核心） |
| `stores/` | zustand 状态仓库 |
| `types/` | TypeScript 类型定义（`types/canvas.ts` 是画布数据模型） |
| `hooks/` | 通用 React hooks |
| `constant/` | 常量（导航项、默认配置等） |

## 二、画布数据模型

定义在 `web/src/types/canvas.ts`。

### 节点

```typescript
interface CanvasNodeData {
  id: string;
  type: CanvasNodeType;      // 20 种之一
  title: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  parentId?: string;         // 挂在 Frame 下时为 Frame 的 id
  metadata?: Record<string, any>;   // ★ 所有业务数据都挂这里
}
```

**关键设计**：`metadata` 是个自由字典。电商工坊的 `commerceWorkflow`、批量的 `batchTable`、图片的 `generationSpec` 全都塞在 metadata 里。好处是加新业务不用改数据模型；代价是类型安全性弱，需要各处自己做校验。

### 连线

```typescript
interface CanvasConnection {
  fromNodeId: string;
  toNodeId: string;
  relation?: string;   // 如 "batch-output" / "batch-input"，区分普通连线和批量关系
}
```

### 20 种节点类型（`CanvasNodeType` 实测全列表）

| 类型 | 用途 |
|---|---|
| `image` | 图片 |
| `text` | 文本 |
| `video` | 视频 |
| `audio` | 音频 |
| `drawing` | 绘图 |
| `script` | 脚本 |
| `skill` | 技能 |
| `config` | 配置 |
| `frame` | 框架/容器（可含子节点，电商的"拼合长图"就是 Frame） |
| `markdown` | Markdown 文档 |
| `svg` | SVG 图形 |
| `html` | HTML |
| `panorama` | 全景图 |
| `compare` | 对比 |
| `chart` | 图表 |
| `colorgrade` | 调色 |
| `media-conversion` | 媒体转换 |
| `batch-table` | 批量表格 |
| `product-detail` | **一键详情**（电商，见第 9 章） |
| `product-replica` | **一键复刻**（电商，见第 9 章） |

## 三、画布主页面：3589 行怎么组织的

`web/src/pages/canvas/project.tsx` 是全系统最大的单文件。它的定位是**组合层**——自己不实现业务，只负责把约 25 个 `useCanvas*` hook 组装起来。

典型 hook 分工（部分）：

| Hook | 职责 |
|---|---|
| `use-canvas-nodes` | 节点增删改查 |
| `use-canvas-connections` | 连线管理 |
| `use-canvas-viewport-controller` | 视口平移缩放 |
| `use-canvas-batch-table` | 批量表格执行（电商化改造的重点） |
| `use-canvas-generation-batches` | 生成批次入队与调度 |
| `use-canvas-node-operations` | 节点操作（复制/删除/重命名） |
| `use-canvas-media-tools` | 媒体工具 |
| `use-canvas-create-commands` | 创建命令（右键菜单/命令面板） |
| `use-commerce-workflow` | 电商工作流编排（295 行，第 9 章） |

**节点内容分发**：`renderCanvasNodeContent(node)` 是一个大 switch，按 `node.type` 决定渲染哪个组件。`product-detail` / `product-replica` 分支渲染 `CommerceWorkflowNode`。

## 四、状态管理

用 zustand（轻量，无 Provider 包裹）。主要 store：

| Store | 管什么 |
|---|---|
| `use-canvas-store` | 画布项目列表、当前打开的项目 |
| `use-config-store` | 模型渠道配置、AI 配置 |
| `use-user-store` | 当前用户、权限、feature 开关 |
| `use-asset-store` | 资产库 |
| `use-sync-progress-store` | 云端同步进度（画布保存时显示） |

数据请求用 TanStack Query，轮询任务状态、失效画布查询都靠它。

## 五、路由

`web/src/router.tsx` 的顶层路由（实测）：

| 路径 | 页面 |
|---|---|
| `/` | 创作首页 |
| `/canvas` | 画布列表 |
| `/canvas/:projectId` | 画布主页面 |
| `/ecommerce` | 电商工坊 |
| `/ecommerce/:view` | 电商子视图 |
| `/inspirations` | 灵感广场 |
| `/assets` | 资产库 |
| `/create` | 创作 |
| `/workbench` | 工作台 |
| `/skills` | 技能管理 |
| `/tasks` | 任务中心 |
| `/settings` | 设置 |
| `/admin/*` | 运营后台（多个子路由） |
| `/ereverse` | E-Reverse 界面 |

部分路由带 feature flag（如 `/ecommerce` 需要 `ecommerceEnabled`），未开启时不可访问。

## 六、画布渲染引擎（**待确认**）

`web/package.json` 与 `web/src` 中同时存在多个画布/图形引擎的依赖。它们各自负责哪一层、是否可切换、默认用哪个——**这一项目前尚未在工作区核实清楚**，文档暂不给出确定结论，避免写错。可确认的是：画布的节点渲染、连线绘制、视口变换由 `components/canvas/` 下的自研组件体系完成（第 8 章会讲渲染分层），第三方引擎在特定节点类型（如白板式绘制）中作为能力提供方接入。

## 七、与其他章的关系

- 画布组件的分层与同步 → 第 8 章
- `commerce-*.ts` 与 `use-commerce-workflow` → 第 9 章
- `user-data-sync.ts` 的锁修复 → 第 8 章
- feature flag 如何控制路由 → 第 12 章


---

## 06 数据库

## 本章目的

说清四件事：怎么在 SQLite 和 PostgreSQL 之间切换、58 条迁移是怎么管理的（尤其是 checksum 安全设计）、核心表有哪些、实测数据量多少。

## 一、双驱动设计

系统同一套代码同时支持两种数据库：

| | SQLite（默认） | PostgreSQL |
|---|---|---|
| 数据位置 | `.local/data/open_ai_canvas.db` | 由 `DATABASE_URL` 指定 |
| 适用场景 | 单机部署、开发测试 | 多实例部署、生产 |
| 切换方式 | 环境变量 `CANVAS_DATABASE_DRIVER=postgres` + `DATABASE_URL=...` | 同左 |
| 连接参数 | `?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on&_synchronous=NORMAL` | 标准 DSN |

### WAL 是什么（大白话）

SQLite 默认模式下，写数据时会把整个数据库文件锁住，读也要等。**WAL（Write-Ahead Log，预写日志）**模式改成"先写一个单独的日志文件，再异步合并回主库"，这样**读和写可以并行**，不会互相堵。对我们要多线程写任务的场景是必需的。

### SQLite 的一个真实坑：busy_timeout 不是万能的

配置里明明有 `_busy_timeout=5000`（等锁最多 5 秒），但线上仍然出现过 `database is locked` 报错。根因：

> 任务认领的 SQL 是「先 SELECT（拿共享锁）→ 再 UPDATE（升级成写锁）」两步。WAL 模式下，**锁升级**冲突时 glebarez/sqlite 这个纯 Go 驱动会**立即**返回 SQLITE_BUSY，根本不走等待队列，所以 busy_timeout 形同虚设。

解法只能在应用层做：`withSQLiteBusyRetry` 按 150ms / 400ms / 900ms 退避重试。这是 `1dab360c0` 提交的内容，详见第 11 章。

## 二、迁移机制：58 条版本账本

### 2.1 迁移长什么样

`backend/internal/database/migrations.go` 里是一个**有序的迁移计划数组**，每条四要素：

```go
{version: 57, name: "provider_catalog_source",
 checksum: "sha256:provider-catalog-source-v57",
 apply: func(tx *gorm.DB) error { /* 加列/建表/回填 */ }},
```

| 要素 | 作用 |
|---|---|
| `version` | 顺序号，只能增不能改 |
| `name` | 人类可读的迁移名，也是身份标识 |
| `checksum` | 内容指纹，防"改了已执行过的迁移" |
| `apply` | 实际要做的事（通常调 `AutoMigrate` 加列建表） |

数组最后一条的 version 必须等于 `CurrentSchemaVersion`（实测 = 58），有测试专门守这条不变式。

### 2.2 checksum 安全设计

启动时 `MigrateSchema` 的流程：

```
开始事务（单事务，保证原子性）
  │
  ├─ 遍历迁移计划 v1 → v58
  │    │
  │    ├─ 数据库里没有该 version 记录？
  │    │     └─ 执行 apply() → 按代码里的 name/checksum 记账
  │    │
  │    └─ 已有记录？
  │           ├─ name/checksum 与代码一致 → 跳过
  │           └─ 不一致 → 报错拒绝启动（防止账实不符）
  │
└─ 提交事务（任一步失败整体回滚，不留半截账）
```

**它防的是什么**：如果有人改了某条已执行过的迁移的 `apply` 逻辑（比如把"加一列"改成"删一列"），已生产的库不会重新执行它，但代码与库的实际结构就不一致了。checksum 让这种情况在启动时就被抓住。

**特殊情况**：`migrations.go` 里有 `normalizeLegacyWorkbenchMigration`，能把"旧版记在 v51 的工作台迁移"归一化成 v54 的新身份。它带多重拒绝条件（已有后续记录即拒、表不全即拒、影响行数不等于 1 即拒），是一次性的历史账本修正工具。

### 2.3 强校验模式

生产环境可设 `CANVAS_AUTO_MIGRATE=false`，此时后端不会自动迁移，而是用 `RequireSchemaVersion` 检查：如果库的版本低于程序要求的版本，**直接拒绝启动**并提示先用 `migrate-schema` 工具升级。这避免了"多个实例同时抢着迁移"的竞态。

配套有独立命令行工具：

```bash
cd backend
go run ./cmd/migrate-schema status   # 看当前库版本与期望版本
go run ./cmd/migrate-schema up       # 执行迁移
```

实测输出示例：`{"current":58,"expected":58,"ready":true}`

## 三、迁移分期概览（v1 → v58）

完整 58 条见 `migrations.go`，这里按主题概括：

| 号段 | 主题 |
|---|---|
| v1–v19 | 基础 schema：用户、资产、项目、公告、支付插件 |
| v20–v34 | 云端 Agent 运行时、记忆、Gemini 缓存、认证通知、任务媒体恢复 |
| v35–v47 | OAuth 状态、工具收藏、渠道模型标签、视频 token 计费快照、画布版本历史、技能库分类、上传配额 |
| v48–v54 | 渠道代理地址、技能策展、公告排序、画布变更回执、个人资料安全、头像预设、登录日志、工作台工具与预设 |
| **v55** | **`ecommerce_workshop`** —— 电商工坊五表（我们的） |
| **v56** | **`ecommerce_plan_review`** —— 分屏编辑器与先审方案字段（我们的） |
| **v57** | **`provider_catalog_source`** —— 渠道目录来源（上游，顺延改号） |
| **v58** | **`sql_perf_indexes`** —— SQLite 时间索引与复合索引（上游，顺延改号） |

> v55–v58 的号段冲突与解法详见第 3 章第 4 节。

### v58 具体做了什么（上游性能优化）

```go
func migrateSchemaV56(tx *gorm.DB) error {
    AutoMigrate(&ApiCallLog{}, &Task{}, &CreditLedgerEntry{})   // 加 created_at_epoch 列
    // SQLite 下回填：把已有的 created_at 时间戳转成 epoch 整数
    UPDATE api_call_logs SET created_at_epoch = unixepoch(created_at) WHERE ...
    UPDATE tasks         SET created_at_epoch = unixepoch(created_at) WHERE ...
}
```

**为什么**：SQLite 里如果用 `unixepoch(created_at)` 包着列做查询，索引会失效导致全表扫描。改成"提前算好一个整数列 + 建索引"，时间范围查询就能走索引。对任务表、调用日志表这种会涨到几十万行的是质变。

新增索引（实测已就位）：
- `idx_api_logs_created_epoch` / `idx_tasks_created_epoch`（时间查询）
- `idx_api_logs_kind_status_created`（运营统计）
- `idx_credit_ledger_user_type`（账本查询）

## 四、核心表概览

`backend/internal/model/` 下有约 40 个模型文件，定义全部表结构。按域分组：

| 域 | 代表表 |
|---|---|
| 用户与鉴权 | `users`、`auth_sessions`、`auth_verifications`、`email_verification_codes`、`user_login_logs` |
| 任务 | `tasks`（★ 全系统最核心的表）、`task_logs` |
| 渠道与模型 | `model_channels`、`channel_models`、`channel_model_price_tiers`、`logical_models` |
| 画布 | `canvas_projects`、`canvas_mutation_receipts` |
| 云端 Agent | `cloud_agent_sessions`、`cloud_agent_pi_sessions`、`agent_execution_journal`、`agent_memory_settings`、`agent_lessons`、`agent_profiles`、`cloud_agent_gemini_cache` |
| 技能 | `skills`、`user_skill_states`、`skill_library_categories` |
| 财务 | `credit_accounts`、`credit_ledger_entries`、`topup_sale_strategies`、`payment_reconciliation_runs`、`payment_reconciliation_items` |
| 电商 | `ecommerce_products`、`ecommerce_slots`、`ecommerce_slot_versions`、`ecommerce_user_configs`、`ecommerce_presets`（第 9 章详解） |
| 资产 | `assets`、`resources`、`asset_library_folders`、`upload_reservations` |

### 电商五表关系

```
EcommerceProduct (商品)  1 ── N  EcommerceSlot (槽位/屏)  1 ── N  EcommerceSlotVersion (版本)
                                                                        │
                                                                        └─ child_task_id → tasks.id
EcommerceUserConfig (每用户一行配置)
EcommercePreset (创作预设，只存参数不存密钥)
```

## 五、实测数据量（2026-10-21，只读查询）

| 表 | 行数 |
|---|---|
| `ecommerce_products` | 1 |
| `ecommerce_slots` | 14 |
| `ecommerce_slot_versions` | 32 |
| `ecommerce_user_configs` | 1 |
| `ecommerce_presets` | 6 |
| `schema_migrations` | 58 |
| 数据库文件 | 约 103 MB（含大量任务历史与媒体元数据） |

> 这是开发机的真实数据量，不代表生产规模。生产库的任务表与调用日志表会大得多——这也是 v58 时间索引优化的动机。

## 六、与其他章的关系

- 迁移号撞车的完整故事 → 第 3 章
- 任务表的状态机与认领 → 第 11 章
- 电商五表的字段细节 → 第 9 章
- 账本回滚约束 → 第 3 章、第 13 章


---

## 07 技能体系

> 本章是重点章。技能（Skill）是这套系统最有特色的设计：**把"怎么让 AI 干好某件事"的知识，从硬编码的提示词代码里搬出来，变成可版本化、可检索、可按需加载的 Markdown 知识包**。

## 本章目的

从「生产 → 编译进二进制 → 加载进数据库 → 被 Agent 检索 → 按需读取正文」全链路讲清技能体系，并说明它和我们工作区另一条"蒸馏产线"的关系。

## 一、技能是什么（大白话）

传统做法里，"让 AI 写一个电影分镜"的提示词是写在程序代码里的字符串。技能体系把这个提示词连同方法论、示例、检查清单，变成一个**独立的 Markdown 文件夹**，跟代码解耦。

打个比方：代码是厨房，技能是菜谱。菜谱可以单独修订、单独版本号、单独分发，不用改厨房。

## 二、规模实测（2026-10-23）

| 指标 | 数值 | 复现命令 |
|---|---|---|
| 技能包数 | **74** | `ls backend/builtin/ \| wc -l` |
| SKILL.md 文件数 | **90** | `find backend/builtin -name 'SKILL.md' \| wc -l` |
| 文件总数 | **1166** | `find backend/builtin -type f \| wc -l` |
| 能力卡（cards/） | 718 | `find backend/builtin -path '*/cards/*' -name '*.md' \| wc -l` |
| 脚本（scripts/） | 66 | `find backend/builtin -path '*/scripts/*' \| wc -l` |
| 参考资料（references/） | 34 | — |
| Python 脚本（.py） | 36 | `find backend/builtin -name '*.py' \| wc -l` |

**为什么 74 个包有 90 个 SKILL.md**：因为旗舰技能「影视剧作工坊」内部还分 16 个子技能，每个子技能有自己的 SKILL.md。

### tag 分布

| tag | 数量 | 内容 |
|---|---|---|
| `drama` | 27 | 影视/短剧创作 |
| `creative` | 24 | 通用创意 |
| `ecommerce` | 12 | 电商方法论（配套电商工坊代码模块） |
| `social` | 8 | 社交媒体 |
| 其他 | 3 | — |

## 三、三种构成形态

### 形态 A：单文件技能（约 37 个）

```
backend/builtin/<技能名>/
└── SKILL.md          ← 就一个文件，写完即用
```

适合知识量小的场景，比如某个具体的文案套路。

### 形态 B：总纲 + 能力卡（约 35 个）

```
backend/builtin/<技能名>/
├── SKILL.md          ← 总纲：说明这个技能干什么、包内有哪些卡
└── cards/
    ├── <能力一>.md    ← 一张卡讲一个具体能力
    ├── <能力二>.md
    └── ...
```

**能力卡（capability card）**是核心抽象：把一个大技能拆成若干独立可读的小知识块。这样 Agent 不用一次读完整本技能，按需读某张卡即可（这是"渐进披露"设计，见第 10 章）。

### 形态 C：多层子技能包（旗舰「影视剧作工坊」）

```
backend/builtin/影视剧作工坊/
├── SKILL.md                      ← 顶层总纲
├── PKG_VERSION.json              ← version 1.1.6, built 2026-10-03, modules 16
├── 影视剧作工坊-01-触发与任务识别/SKILL.md
├── 影视剧作工坊-02-影视风格/SKILL.md
├── ...（共 16 个子技能）
├── 影视剧作工坊-引擎/SKILL.md     ← ★ 最特别的一个
└── engine/
    ├── 454 条导演学方法论
    └── 32 个 Python 脚本（PKG_VERSION.json 自述 31）
```

「-引擎」子技能是**蒸馏产物**：把四本导演学专著蒸馏成 454 条可检索的方法论条目。这是工作区"酿笑坊蒸馏器"的产出实证，详见第 13 章。

## 四、SKILL.md 的元数据规范

### 4.1 规范全集

解析器在 `backend/internal/skills/skills_builtin.go`（约 276 行起），认识的 frontmatter 字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | ✅ | 技能名 |
| `description` | ✅ | 描述 + **触发词**（Agent 靠它判断何时用这个技能） |
| `metadata.version` | | 版本号，默认 `1.0.0` |
| `metadata.author` | | 作者，默认 `影策` |
| `metadata.owner` | | 属主，默认 `yingce-system` |
| `metadata.skillId` | | 稳定 ID |
| `metadata.tag` | | 分类标签，默认 `others` |
| `metadata.sortWeight` | | 排序权重 |
| `metadata.source` | | 来源，默认 `3` |
| `metadata.createdAt` / `updatedAt` | | 时间戳 |
| `metadata.showcaseMedia` 等 | | 展示用媒体 |

### 4.2 实例的常见形态（重要区别）

**实际上绝大多数技能的 frontmatter 很简朴**。例如「影视剧作工坊-引擎」的 frontmatter 只有三行：

```yaml
---
name: 影视剧作工坊-引擎
description: 导演学方法论检索引擎...
agent_created: true
---
```

解析器对缺失字段全部给默认值，不会报错。**所以"规范全集"和"实例常见形态"是两回事**，对外描述时要说清，否则对方会以为每个技能都填了一堆元数据。

### 4.3 触发机制

技能**没有结构化的触发条件声明**，靠两件事：

1. `description` 里写的触发词（如"当用户要求写分镜/故事板时使用"）
2. 正文里的「何时调用」章节

这是个**设计取舍**而非缺陷：自然语言触发词比结构化规则更灵活，能覆盖模糊意图；代价是召回率不如精确匹配。系统用检索打分（第 10 章）来弥补。

## 五、加载链：从磁盘到数据库

```
① 编译期
   backend/builtin/ 目录
        │  //go:embed all:*        ← Go 的嵌入式文件系统
        ▼
   打进 Go 二进制（canvas-backend.exe 里就有这 1166 个文件）
        │
        ▼
② 启动期（main.go 第 10 步）
   EnsureBuiltinSkills()
        │
        ├─ 遍历内置包，解析每个 SKILL.md 的 frontmatter
        ├─ 计算内容哈希：对「路径\0内容\0」排序后算 SHA-256
        └─ upsert 进 skills 表（SourceType=builtin, IsPrivate=false）
             MarkdownURL = 基础路径 + "/SKILL.md"
        │
        ▼
③ 运行期
   Agent 请求带 SkillIDs
        │
        ├─ 只把这些技能的【元数据 + 文件路径】装进快照
        └─ 正文不内联（关键！见第 10 章）
```

### 为什么要算内容哈希

技能会被修改。哈希让系统能判断"这个技能和上次比变了没有"，用途：
- 读取时检测版本变化，防止读到半新半旧的混合版本
- 有测试专门钉死内置技能的 Python 文件树哈希（`skills_yingshi_builtin_test.go`），改技能内容会让测试失败——这是**故意的严格门禁**

### `.gitattributes` 是前置条件

`backend/builtin/** text eol=lf` 强制 LF 换行。否则 Windows 上 Git 会把换行转成 CRLF，同一个技能哈希值就变了，版本同步机制会误判"技能被改过"。**这条配置是技能体系正确性的前提。**

## 六、用户技能：四条导入渠道

内置技能之外，用户还能自己装技能，走**同一张 skills 表**：

| 渠道 | 说明 |
|---|---|
| 自建 Markdown | 直接在界面里写 |
| ZIP 上传 | 传一个技能包压缩文件 |
| GitHub 安装 | 从仓库拉取 |
| seed 预设 | 系统预置推荐清单 |

用户技能与内置技能在表里用 `SourceType` 区分，启用/禁用关系记在 `user_skill_states` 表（与 skills 表是独立的两张表，避免互相污染）。

## 七、双轨制：`backend/builtin/` vs `~/.workbuddy/skills/`

这是一个**必须知道的维护风险点**：

| | `backend/builtin/` | `~/.workbuddy/skills/` |
|---|---|---|
| 归属 | 本系统（Go 二进制内嵌） | 宿主平台 WorkBuddy |
| 代码关系 | 被 `go:embed` 编译进 exe | **后端代码零引用** |
| 同步方式 | 自动（启动时 upsert） | **人工镜像** |
| 当前状态 | 74 个包 | 影视工坊等，与 builtin 同版本 1.1.6 |

也就是说，同一份技能知识在**两套独立体系里各存一份**，目前靠人的纪律保持同版本，**没有代码强制同步**。改一边忘了改另一边，两边就会漂移。这是已知风险，对外说明时不应隐瞒。

## 八、版本同步的五道机制

| # | 机制 | 防什么 |
|---|---|---|
| 1 | `metadata.version` 字段 | 人可读的版本标识 |
| 2 | SHA-256 内容哈希 | 检测技能内容是否被改动 |
| 3 | 测试钉死 Python 树哈希 | 防止误改内置技能的文件树（测试会红） |
| 4 | `.gitattributes` 强制 LF | 防止换行符导致哈希漂移 |
| 5 | judian `presets_check.py` 跨仓对账 | 防止投稿仓与落地仓的技能不一致（**待确认**：该脚本当前是否仍在有效运行，见下） |

### judian 投稿仓（**待确认**）

`D:\AlcheMvision\judian-skills\` 定位为"技能公开化投稿仓"，理论上是从蒸馏器到 `backend/builtin/` 的中间环节。但实测发现：

- `skills/` 下 35 个域包目录中，**只有 1 个**（`creative/scene-recipe-concierge`）含 SKILL.md，其余 34 个的 `cards/` 是**空目录**
- singles 实际只有 14 个（6 drama + 8 ecommerce），而非早期记录的 70 个
- 最新 git 提交显示仓库已更名为 `yuanqi-pipeline`

**结论待确认**：它现在是"投稿骨架模板"还是"已废弃/迁移到别处"，我们尚未核实。文档在此如实标注，不做猜测。如需用于正式评审，建议先补这项调研。

## 九、技能与 Agent 的关系（概要）

详细机制见第 10 章，这里先给结论：

- Agent **不会**把整本技能塞进提示词
- 只有请求带 `SkillIDs` 时，才注册 `skill_search` / `skill_read_file` 两个工具
- 快照里只有元数据和路径，正文永不内联
- 检索打分：**卡 4 分 > 名 3 分 > 描述 2 分**
- 「每轮激活上限 8」出自 `skills_presets.go` 的预设编号范围（1-8）

## 十、电商技能包：代码与方法论分层

电商工坊是**代码模块**（第 9 章），同时配有 **12 个 `tag: ecommerce` 技能包**作为方法论层。两者关系：

```
技能包（12 个）         代码模块
   │                      │
   │  告诉 AI「怎么做」    │  「执行」的工程实现
   ▼                      ▼
"电商详情页的构图惯例"   →  12 段视觉方案编译器
"平台规范怎么解读"       →  platforms.go 的 6 平台字典
"合规词怎么规避"         →  exitgate.go 的出口门禁
```

即：**技能是知识，代码是机制**。改知识不用发版，改机制才需要。

## 十一、新成员：chaoge-film-director-flex（2026-10-23 合入，提交 03e1cb9ec）

第 74 个内置技能包，`tag: drama`、`sortWeight: 96`、版本 2.0.0，27 个文件：

```
backend/builtin/chaoge-film-director-flex/
├── SKILL.md                    ← 总纲（212 行，frontmatter 带 metadata 块）
├── VERSION                     ← 2.0.0（审计与台账校验的版本权威源）
├── agents/openai.yaml          ← 界面展示与默认提示词
├── assets/                     ← 2 份台账/状态模板（validate_ledger 的校验对象）
├── references/                 ← 18 份方法论文档（一镜到底/360度补角/空间推演/提示词模板…）
└── scripts/                    ← 4 个 Python：audit_skill / validate_prompt / validate_ledger / render_spatial_card
```

三个配套工程事实：

1. **Go 原生校验包** `backend/internal/director/`：把 `validate_prompt.py` 与 `validate_ledger.py` 1:1 移植到 Go（字符预算按 rune 计、栏目顺序、平台素材语法、声音模式、时间码连续性、台账 11 字段与二级标题）。动机是 Node 子进程沙箱（`PI_OFFLINE=1`）不执行 `.py`，Agent 需要毫秒级确定性自检。对账测试 `director_parity_test.go` 的夹具由 `scripts/gen_director_parity_fixtures.py` 从权威 Python 模块同源导出，9 组用例的 error/warning 数量与 Python 分毫不差。
2. **Agent 工具** `cloud_agent_director_tools.go`：`director_validate_prompt` / `director_validate_ledger` 两个只读工具，纯内存校验（不写库、不扣费），只读权限模式下同样下发。
3. **双轨同步已闭环**：`~/.workbuddy/skills/chaoge-film-director-flex/` 人工镜像，`audit_skill.py --installed` 逐文件 SHA-256 比对一致。

它与旗舰「影视剧作工坊」的分工：**未定稿的剧本打磨走影视剧作工坊；定稿后的解析/资产/出片走 chaoge**。两者可同时启用，`skill_search` 按关键词路由（双核排序有断言测试守门，见第 10 章）。

## 十二、与其他章的关系

- 技能如何被 Agent 按需读取 → 第 10 章
- 技能从生产到分发的完整产线 → 第 13 章
- 电商技能与代码的对应 → 第 9 章
- 技能哈希测试为什么是质量门禁 → 第 12 章


---

## 08 画布系统

## 本章目的

说清画布的三件事：节点和工具怎么注册、渲染怎么分层、本地与云端怎么同步（含我们最近修的 SQLite 锁问题）。

## 一、画布组件地图

`web/src/components/canvas/` 下有 **159 个文件**。按职责分层：

| 层 | 代表文件 | 职责 |
|---|---|---|
| 骨架 | `canvas-node.tsx`、`canvas-viewport.tsx`、`canvas-connections.tsx`、`canvas-mini-map.tsx` | 节点外壳、视口、连线、小地图 |
| 工作区 | `canvas-workspace-panel.tsx`、`canvas-workspace-overlays.tsx` | 右侧工作台、覆盖层 |
| 批量 | `canvas-batch-table-node.tsx` | 批量表格节点 |
| 电商 | `commerce-workflow-node.tsx`、`commerce-result-board.tsx`、`commerce-screen-editor.tsx`、`commerce-template-copy-editor.tsx`、`commerce-preview-image.tsx` | 一键详情/复刻节点族（第 9 章） |
| 交互 | `canvas-node-mask-edit-dialog.tsx` 等 | 局部重绘、蒙版编辑等工具弹窗 |

**渲染引擎（待确认）**：画布的节点渲染、连线、视口变换由上述自研组件完成。仓库中还存在 tldraw / excalidraw / leafer-ui 等多个图形引擎依赖，它们各自负责哪类节点、是否可切换——**这一项目前尚未核实清楚**，本文不做确定结论。

## 二、节点注册机制

`web/src/lib/canvas/node-registry.ts`（118 行）是节点类型的注册表：

```typescript
// 概念示意（非源码原文）
const NODE_SPECS = new Map<CanvasNodeType, NodeSpec>()

interface NodeSpec {
  label: string              // 菜单显示名
  icon: ReactNode
  minSize: { width, height } // 最小尺寸
  showInCreateMenu: boolean  // 是否出现在创建菜单
  acceptsInputKind?: string[]// 接受什么类型的输入连线
  showOutputConnection?: boolean  // 是否提供输出端口
}
```

**owner 隔离**：注册表支持"属主隔离"——内置节点、插件贡献的节点属于不同 owner，插件可以新增节点类型而不污染内置表。

以最近合入的电商节点为例（`builtin-nodes.tsx:172`）：

```typescript
[CanvasNodeType.ProductDetail]: {
  label: "一键详情",
  icon: <PanelTop />,
  minSize: { width: 520, height: 600 },
  showInCreateMenu: true,
  acceptsInputKind: ["image", "text"],   // 接受图片和文本输入
  showOutputConnection: false,           // ★ 配置节点不提供输出端口
}
```

`showOutputConnection: false` 是个关键设计：电商配置节点**不是图片资产**，不能直接拖线连给别人。成品要从独立的"结果卡"输出。这一约束在后端连线校验里也有对应实现（`canvas-connection-policy.ts`）。

## 三、工具注册机制

`web/src/lib/canvas/tool-registry.ts`（163 行）管工具栏：

- 按 `ToolbarId` 分组（不同上下文显示不同工具集）
- `resolveToolbarEntries()` 把注册的工具转成 `FloatingDockEntry`（浮动工具条的条目）
- 同样支持插件贡献

「一键详情」「一键复刻」的创建入口注册在 `add-node-menu-tools.tsx`，`defaultOrder` 分别是 67 和 68（排在「批量创作表」66 之后）。

## 四、渲染三层分层

`web/src/pages/canvas/canvas-project-world-layers.tsx`（258 行）定义堆叠顺序：

```
┌─────────────────────────────────────────┐
│ 第 3 层  多选包围盒（最上层，交互用）      │
├─────────────────────────────────────────┤
│ 第 2 层  节点层                            │
│         Frame 优先 + stackOrder 排序       │
│         （Frame 是容器，要画在子节点下面）  │
├─────────────────────────────────────────┤
│ 第 1 层  SVG 连线层（最底层）              │
└─────────────────────────────────────────┘
```

**为什么 Frame 优先**：Frame 是容器型节点（比如电商的"拼合长图组"），子节点挂在它下面。如果不同时保证 Frame 先画，子图片会压在 Frame 背景下面看不见。

## 五、画布主页面如何组织 3589 行

`web/src/pages/canvas/project.tsx` 是**纯组合层**：持有 `nodes` / `connections` 状态，组合约 25 个 `useCanvas*` hook，然后：

```typescript
// 概念示意
const renderCanvasNodeContent = (node: CanvasNodeData) => {
  switch (node.type) {
    case CanvasNodeType.Image:        return <CanvasNodeImage ... />
    case CanvasNodeType.BatchTable:   return <CanvasBatchTableNode ... />
    case CanvasNodeType.ProductDetail:      // ★ 电商
    case CanvasNodeType.ProductReplica:
      return <CommerceWorkflowNode node={node} workflow={commerceWorkflow} ... />
    // ... 其余 17 种
  }
}
```

**这种组织的代价**：单文件巨大，改一处要全文搜索。**好处**：所有画布状态在一处可见，调试时能一眼看清数据流。这是有意取舍，不是失控。

## 六、云端同步与 SQLite 锁治理

`web/src/services/user-data-sync.ts`（约 700 行）是画布"本地 ↔ 云端"同步的核心。

### 6.1 触发链

```
用户在画布上操作（拖动/编辑/生成）
   │
   ▼
useCanvasStore 状态变化
   │  subscribe 回调：比对内容是否真变（sameCanvasContent）
   ▼
scheduleRemoteUserDataSync()      ← 节流 + 防抖混合调度
   │
   ▼
saveRemoteUserDataNow()
   │
   ▼
applyRemoteCanvasOperations(id, request)
   │  PATCH /api/canvas-projects/{id}/operations
   ▼
后端落库
```

### 6.2 节流 + 防抖混合调度（本地修复 `1dab360c0`）

**原来的问题**：调度函数是纯 1200ms 防抖——每次画布变更都重置定时器。生图任务收尾时，节点 metadata 会被连续写三次（loading → 成功 → 资源回填），间隔短于 1200ms，定时器被**无限重置**，保存迟迟发不出去；等它终于发出时，正好撞上后端任务派发的写锁，于是前端看到「作品已生成，保存遇到问题，正在自动恢复」。

**修法**：改成节流 + 防抖混合，三个常量（`user-data-sync.ts:610` 附近）：

```typescript
const SYNC_DEBOUNCE_MS   = 1200   // 常规防抖窗口
const SYNC_MAX_WAIT_MS   = 3000   // 兜底：防抖期内持续有变更，最多等 3 秒必发
const SYNC_MIN_INTERVAL_MS = 250  // 距上次调度不足 250ms 只合并，不重置定时器
```

调度逻辑：

```
距上次调度 < 250ms？
  ├─ 是 → 只排一个到最小间隔的短定时器（合并高频写入，不重置）
  └─ 否 → 排 1200ms 防抖 + 启动 3000ms 兜底定时器
              兜底触发时无条件发一次，保证不会无限推迟
```

配套的 `clearSyncTimers()` 统一清理两个定时器，`lastSyncScheduledAt` 记录上次发起时刻。

有 4 个前端测试专门守这套逻辑（`web/test/remote-sync-throttle.test.ts`），包括"高频连续变更最短 250ms 内必发一次"这个不变式。

### 6.3 后端配合：任务认领退避重试

光改前端不够——后端认领任务时如果撞锁会直接放弃。所以后端也加了 `withSQLiteBusyRetry`（`backend/internal/app/sqlite_busy_retry.go`），按 150/400/900ms 退避重试，共 4 次尝试。

```go
// isSQLiteBusyError 识别库忙类错误（覆盖 glebarez 与 modernc 两种驱动的文案）
// withSQLiteBusyRetry 只对库忙重试；非库忙错误（约束冲突等）立即返回，不掩盖真实故障
```

**实测效果**：修复上线后真机重启，日志中 `database is locked` 与 `task dispatch paused` 均为 0 次。

## 七、电商节点如何挂进画布

三个接入点（这是最近从上游 PR 合入后做的宿主适配）：

| 接入点 | 改动 |
|---|---|
| `project.tsx` 的 `renderCanvasNodeContent` | 新增 `product-detail` / `product-replica` 分支，渲染 `CommerceWorkflowNode` |
| `use-canvas-batch-table.ts` | commerce 化：用 `commerceSnapshot` 防旧快照重复收费、`generateConfirmedCommerceRows` 专用入队、逐屏尺寸走 `commerceScreenImageSize` |
| `canvas-generation-task-sync.ts` | 回填分支：识别 commerce 任务，用 `applyCommerceOutput` 回填结果，不改成文本节点 |

详细业务见第 9 章。

## 八、与其他章的关系

- 电商节点的完整业务 → 第 9 章
- 云端同步的后端锁治理 → 第 11 章
- 连线校验为什么禁止配置节点出线 → 第 9 章
- 无缝长图为什么能"无缝" → 第 9 章第 7 节


---

## 09 电商工坊

> 本章是重点章。电商工坊是这套系统里**最近一年改动最重、业务最复杂**的领域，也是"上游开源项目 → 私有领域空活"的典型样本。

## 本章目的

讲清五件事：一个商品从导入到出图经过哪些状态、核心的「12 段视觉方案编译器」怎么工作、内容合规闸门卡什么、派发提示词的完整合同、以及画布上的「一键详情 / 一键复刻」节点怎么用这套后端。

## 一、它解决什么问题

输入：**一张商品实拍图** + **商品名称和卖点**。
输出：**一整套符合平台规范的详情页图片**（淘宝 7 屏、抖音 7 屏……），每屏有独立的构图、场景、文案排版。

难点不在"生成图片"，在于：
1. **7 屏不能长一样**（否则没有详情页的叙事功能）
2. **每屏的文案要逐字上画**（电商图的核心信息载体）
3. **不能虚构功效/认证/数据**（合规红线）
4. **产品外观不能变形**（否则是废品）

这套系统的解法是「**两段式 + 中间夹一个编译器**」，下面第 4 节详说。

## 二、代码地图

### 领域层 `backend/internal/ecommerce/`（11 个 .go）

| 文件 | 行数 | 职责 |
|---|---|---|
| `plandetail.go` | 675 | **12 段视觉方案编译器**（本模块最核心） |
| `platforms.go` | 442 | 6 大平台槽位规范字典 + 文案指令 |
| `plan.go` | 357 | 预设契约（独乐岛 7 屏 / 通用电商标准 7 屏） |
| `config.go` | 323 | 用户配置视图（与桌面面板逐项对应） |
| `exitgate.go` | 198 | **S5 视觉安全出口门禁** |
| `status.go` | 127 | 状态全集与商品状态推导 |
| `options.go` | 66 | 固化常量（槽位类型、文字模式、比例档位） |
| 测试 11 个 | — | 域层合计 53 个用例 |

### 编排层 `backend/internal/app/ecommerce_*.go`（12 个文件）

| 文件 | 行数 | 入口函数与职责 |
|---|---|---|
| `ecommerce_orchestrator.go` | 1394 | `StartEcommerceProduct`（派发主入口）、`SyncEcommerceProduct`（对账回写）、`dispatchEcommerceSlot`/`stageEcommerceSlot`/`prepareEcommerceSlot`、`continueEcommerceDispatch`（顺延补派）、**`buildEcommerceSlotPrompt`（提示词合同）** |
| `ecommerce_slots.go` | 488 | `UpdateEcommerceSlotPrompt`（指针式 patch）、`RegenerateEcommerceSlot`（单屏重生成）、`ConfirmEcommercePlan`、`PauseEcommerceProduct` |
| `ecommerce_products.go` | 420 | `ImportEcommerceProducts`（导入即预建 7 槽位卡，draft 不收费）、列表/详情/重命名/删除 |
| `ecommerce_planner.go` | 419 | `StartEcommercePlanning`（派发视觉文本策划）、`ApplyEcommercePlan`（编译回写） |
| `ecommerce_export.go` | 254 | 导出 manifest + ZIP |
| `ecommerce_plan_guard.go` | 124 | `ecommerceNeedsVisualPlan` / `ensureEcommerceVisualPlan`（**策划守卫**） |
| `ecommerce_platform.go` | 135 | `ApplyEcommercePlatform`（切平台 + 重建未派发槽位） |
| `ecommerce_config.go` | 134 | 配置与预设保存 |
| `ecommerce_prompt_repair.go` | 71 | `RepairLegacyEcommerceSlotPrompts`（**启动自检清洗**） |
| `ecommerce_retry.go` | 103 | `RetryEcommerceProducts` |
| `cloud_agent_ecommerce_tools.go` | 123 | Agent 改稿工具 |

HTTP 层在 `backend/internal/handler/ecommerce.go`（544 行，约 20 条 REST 路由）。

### 前端

- `web/src/pages/ecommerce/`：三步向导、任务详情、槽位编辑器
- `web/src/components/canvas/commerce-*.tsx`：画布节点族
- `web/src/lib/canvas/commerce-*.ts`：9 个领域库
- `web/src/pages/canvas/use-commerce-workflow.ts`（295 行）：编排 10 种动作

## 三、领域模型与状态机

### 3.1 五张表

```
EcommerceProduct (商品)  ──1:N──▶  EcommerceSlot (屏/槽位)  ──1:N──▶  EcommerceSlotVersion (版本)
       │                                                                │
       │                                                                └─ child_task_id → tasks.id
       ├─ PlanJSON       只存 AI 策划的原始响应
       ├─ DiagJSON       编排诊断信息
       └─ ExecutionMode  执行模式快照（review / auto）
EcommerceUserConfig   每用户一行配置
EcommercePreset       创作预设（只存参数，不存密钥）
```

**关键设计**：`EcommerceProduct` 是**编排实体**，它自己不直接调模型。每个阶段（策划、生图）都派发成一条**画布子任务**（`tasks` 表里 `type=canvas_image` / `canvas_text`），复用整套任务派发、计费、恢复机制。这样电商不用自己造一套任务系统。

### 3.2 商品 9 态

| 状态 | 含义 |
|---|---|
| `draft` | 刚导入，槽位卡已预建但未派发 |
| `queued` | 已确认，等待派发 |
| `running` | 有屏在生成中 |
| `review` | 先审模式：等人工审方案 |
| `failed` | 有屏失败 |
| `uncertain` | 有屏状态不确定（需人工介入判断） |
| `completed` | 全部完成 |
| `completed_with_warnings` | 全部完成但标题图有问题 |
| `paused` | 用户主动停止 |

推导规则（`status.go` 的 `ComputeProductStatus`）：任一 `uncertain` → `uncertain`；任一 `failed` → `failed`；仅 `queued`/`running` 算在途 → `running`；仍有 `draft` → 停在 `draft`；全 `completed` 但标题 `failed`/`uncertain` → `completed_with_warnings`。

有个死锁修复有测试专门守着（`status_deadlock_test.go`）：**review 态下，draft 槽位不得被推导成 running**。

### 3.3 槽位 8 态

比商品多一个 `draft`（方案已备但未派发）和 `refining`（重新生成中）。

## 四、核心：12 段视觉方案编译器

这是整套电商工坊的**心脏**，在 `backend/internal/ecommerce/plandetail.go`。

### 4.1 为什么要"两段式"

**旧做法（一段式）**：把平台模板套话直接当生图提示词。后果是模型既不知道产品是什么，又被"保持主体结构稳定""画面不生成文字"这类套话绑死 → **7 屏长得一模一样且全无文字**。这是我们实际踩过的坑。

**新做法（两段式）**：

```
商品图 + 卖点文案
      │
      ▼
【第一段】策划提示词 ──► 视觉文本模型（如 gemini-3.8-flash-high）
      │                     │
      │                     ▼
      │              输出严格 JSON（DetailPlan）
      │                     │
      ▼                     ▼
【编译器】compileDetailPlan ◄┘
      │  校验 + 编译成 12 段中文方案
      ▼
【第二段】生图提示词 ──► 生图模型（如 yingce-image-2.5）
      │
      ▼
带字海报级单屏图
```

**为什么中间必须有编译器**：模型直接吐的自然语言没法可靠校验。逼它输出严格 JSON，再由**代码**编译成提示词，这样：
- 模型写"同上""照参考图" → 编译器直接报错，不许出图
- 相邻两屏的构图/环境/光线/材质/卖点表达 **6 个字段指纹相同** → 判定雷同，拒绝
- 字段超长 → 拒绝，**不截断执行**（截断会产出残缺提示词）

### 4.2 DetailPlan 四块结构

```jsonc
{
  "productAnalysis": {          // ① 商品事实（只从产品图提取）
    "identity": "...",           // 产品身份与必须保留的外观
    "visibleFeatures": [...],    // 看得见的形态/颜色/材质
    "confirmedSellingPoints": [...],  // 已确认卖点（区分"图像可见"与"用户提供"）
    "unknowns": [...]            // ★ 无法确认的，明确标未知，不许编
  },
  "styleAnalysis": {            // ② 风格分析（只从风格参考图）
    "palette": "...", "composition": "...", "lighting": "...",
    "typography": "...",
    "transferableElements": "...",  // 可迁移到本产品的视觉规则
    "excludedElements": "..."       // 不可复制的元素
  },
  "visualSystem": {             // ③ 整组统一视觉（7 屏共享）
    "artDirection": "...", "palette": "...", "lighting": "...", "typography": "..."
  },
  "screens": [                  // ④ 逐屏方案
    { "title": "...", "copy": "...", "prompt": "...",
      "visualPlan": {
        "subject": "...", "composition": "...", "environment": "...",
        "lighting": "...", "colorAndMaterials": "...", "typography": "...",
        "visualEvidence": "...", "variation": "..."
      } }
  ]
}
```

### 4.3 编译出的 12 段（顺序固定）

```
 1  整组视觉方向        ← visualSystem.artDirection（整组共享）
 2  统一配色            ← visualSystem.palette
 3  统一光影            ← visualSystem.lighting
 4  统一字体            ← visualSystem.typography
 5  产品与主体          ← visualPlan.subject（本屏）
 6  镜头与构图          ← visualPlan.composition
 7  环境与道具          ← visualPlan.environment
 8  光线与质感          ← visualPlan.lighting
 9  色彩与材质          ← visualPlan.colorAndMaterials
10  文字与留白          ← visualPlan.typography
11  卖点的视觉表达      ← visualPlan.visualEvidence
12  本屏差异与连续性    ← 明确说出这屏相对相邻屏改了什么景别/场景/布局
```

**第 12 段是防同质化的点睛之笔**：它逼模型自己声明差异化，而不是靠我们事后猜。

前 4 段整组共享（保证 7 屏是一套设计语言），后 8 段每屏独立（保证每屏有独立信息）。

### 4.4 编译规则

| 规则 | 行为 |
|---|---|
| 屏数少于槽位 | 按平台模板补齐 |
| 屏数多于槽位 | 截断 |
| 相邻屏指纹相撞（6 字段） | **自动追加 8 种差异化机位之一**（微距特写/场景远景/45度俯视/平视正面/侧面轮廓/低角度仰视/斜侧光/拆解视角），不抛错 |
| title > 200 字 / copy > 8000 字 / 字段 > 6000 字 / 单屏方案 > 12000 字 | **拒绝，不截断** |
| 空响应 / 非法 JSON / screens 为空 | 硬失败 |

### 4.5 容错整形（线上实测出来的）

现场遇到过：模型把 `styleAnalysis` 返回成**数组**而不是对象，严格按 `map[string]string` 解码会让**整个策划失败**。

修法（`normalizePlanBlocks`）：在严格解码前先把模型返回的"数组/对象子字段"压平成字符串——数组用「；」连接、对象转成「key：value」。哲学是**"能编译成功就绝不中断用户流程"**。

配套的还有：`normalizePlanKeys`（snake_case 归一）、`extractPlanJSON`（剥 Markdown 代码围栏）、`UnwrapPlanText`（剥任务包装）。

## 五、6 大平台槽位规范

`platforms.go` 定义 6 个平台，**每个都是 3 主图 + 4 详情 = 7 屏**：

| 平台 | 主图比例 | 详情比例 | 特殊 |
|---|---|---|---|
| 淘宝/天猫（默认） | 1:1 | 3:4 | — |
| 抖音商城 | 3:4 | 3:4 | — |
| 拼多多 | 1:1 | 3:4 | — |
| 京东 | 1:1 | 3:4 | 首图纯白底 |
| 亚马逊 | 1:1 | 4:3 | 英文输出、纯白底 |
| 小红书 | 3:4 | 3:4 | — |

**槽位键跨端固定**：`hero_main` / `hero_benefit` / `hero_scene` + `detail_hero` / `detail_macro` / `detail_spec` / `detail_package`。换平台不重新建槽，只改参数——这样已生成的成品可以跨平台复用对比。

未知平台 key 由 `PlatformSpecOrDefault` 回落到淘宝（不报错）。

## 六、内容合规闸门（S5 出口门禁）

`exitgate.go` 的 `ComplianceGate` 在提示词发往模型前做三步：

```
① 确定性剥离
   剥掉分辨率词（"4K""高清"）、质量套话（" masterpiece"）
   └─ 这些词对模型是噪音，还可能触发平台审核

② 红线词通感改写
   22 个违禁词 → 隐喻映射表
   例：「情趣用品」→「私享生活器物」
   └─ 不是简单删除（删除会让画面信息缺失），而是改写成合规但语义相近的表达，
      改写后才追加 Aesop 质感锚点

③ 画面比例冲突拒绝
   同一屏出现 ≥2 个不同画面比例 → Rejected
   └─ 调用方不得兜底，必须让用户改
```

第 ③ 步是硬拒绝：比例冲突时如果后台悄悄选一个，产出的图必然不符合预期，不如直接失败让用户看见。

## 七、派发提示词的 7 段合同

`ecommerce_orchestrator.go:443` 的 `buildEcommerceSlotPrompt` 组装最终发往生图模型的提示词：

```
① 制作说明
   制作{平台} 电商详情页单屏：{屏标题}（第 N 屏，{类型}）

② 参考图用途（关键！）
   前 N 张参考图是产品，严格保留产品外观、材质、包装、标识。
   仅作为产品身份依据，不是原产品照片的背景、机位和构图模板。
   按本屏视觉方案重新组织场景、道具、镜头与光线，不复制原图场景。

③ 产品与卖点
   产品：{名称}
   核心卖点：{卖点}

④ 12 段视觉方案
   （第 4 节编译出来的那 12 段）

⑤ 本屏场景与卖点绑定
   本屏场景类型：{sceneType}
   本屏绑定的已确认卖点：{sellingPoints}

⑥ 【画面文字与海报排版硬性要求】
   textMode=none 或文案为空 → 「不要添加任何排版文字。」
   否则 → 「这是一张带中文商业海报排版的电商详情页图片…
           画面文字必须逐字使用以下文案，不添加其他文字：\n{copy}」

⑦ 收口约束
   只制作本屏方案，不扩展为整页或多屏拼图。
   遵循本屏已确定的视觉设计，整组产品身份和设计风格保持一致。
   不得虚构产品功效、认证或数据。
```

**第 ② 段那句"不是原产品照片的背景、机位和构图模板…不复制原图场景"**，正是对着旧套话「保持主体结构、颜色、比例、材质和可见细节稳定」去的——那句话的实质效果就是"照着原图复刻"，必然导致 7 屏雷同。

### 优先级链

```
PromptOverride（人工完整覆盖，最高）
   ↓ 无
库内 GenerationPrompt（12 段方案）
   ↓ 无
nxf 合成
   ↓ 无
平台兜底（ComposeSlotFallbackPrompt，永不为空）
```

每一级都要过 `ComplianceGate`。

## 八、画布上的「一键详情 / 一键复刻」

### 8.1 节点定义

`CanvasNodeType.ProductDetail`（label「一键详情」）/ `ProductReplica`（label「一键复刻」），traits 见第 8 章。默认尺寸 660×860 / 660×760。

### 8.2 组件分工

| 文件 | 职责 |
|---|---|
| `commerce-workflow-node.tsx`（169 行） | 双角色：source 态是配置面板，result 态是结果看板 |
| `commerce-result-board.tsx`（72 行） | 预生成卡片组，支持列数 1-6 切换 |
| `commerce-screen-editor.tsx`（37 行） | 单屏编辑弹窗 |
| `commerce-template-copy-editor.tsx`（29 行） | 复刻模板的原文案替换编辑器 |
| `commerce-preview-image.tsx`（22 行） | 预览图（宿主适配层） |

### 8.3 9 个领域库

| 库 | 行数 | 职责 |
|---|---|---|
| `commerce-workflow.ts` | 205 | 输入分流/校验/快照/策划提示词/`commerceBatchTable` 组装逐屏提示词 |
| `commerce-detail-plan.ts` | 75 | TS 侧 12 段编译（与 Go 侧同构，有 parity 测试） |
| `commerce-replica-plan.ts` | 78 | 复刻方案编译 |
| `commerce-image-assembly.ts` | 63 | **引用拼合组**：建 Frame + `imageAssembly:"vertical"`，图片等宽原比例无缝排列 |
| `commerce-image-merge.ts` | 43 | 下载时才读取原图合成 PNG，不自动上传 |
| `commerce-image-size.ts` | 39 | 逐屏像素尺寸计算 |
| `commerce-pricing.ts` | 125 | 只读计价（展示"一张多少钱"） |
| `commerce-result-layout.ts` | 18 | 结果组布局 |
| `commerce-workflow-graph.ts` | 28 | 建结果组 |

### 8.4 use-commerce-workflow 的 10 种动作

`plan`（AI 策划）/ `manual`（手工）/ `direct`（直接生成）/ `ocr`（模板文字识别）/ `replan`（单屏重策划）/ `apply`（应用方案）/ `resume` / `stop` / `generate` / `release`。

### 8.5 无缝长图为什么能"无缝"

拼合组里的图片节点带 `referenceSetId`（指向 Frame）。宿主的 `ensureMediaNodeMinimumSize` 原本会对所有图片强制套一个最小尺寸（宽 420 / 高 236）——这会把拼合图片整体放大，**长图立刻出现缝隙**。

修法：对带 `referenceSetId`（拼合组成员）或 `manualSize`（用户手工拉过）的节点，跳过最小尺寸兜底。

## 九、策划守卫与启动自检

### 9.1 策划守卫（对齐上游 direct 模式）

`ecommerce_plan_guard.go`：如果商品 `PlanRevision == 0` 且没有 12 段方案且没有人工覆盖，`ConfirmEcommercePlan` / `StartEcommerceProduct` 会**先同步跑一次 AI 策划再派发**，而不是让空壳槽位直接去生图。

策划模型的选取顺序：`options.PlannerModel` → 用户配置的 `plannerModelId`。**取不到就明确报错**，绝不静默拿生图模型当文本模型用（那是会出错的）。

策划失败时**不出图**——纪律是"宁可停下来让用户修，不要产出废品"。

### 9.2 启动自检清洗

`ecommerce_prompt_repair.go` 的 `RepairLegacyEcommerceSlotPrompts`：启动时扫描 `ecommerce_slots`，把**同时命中两个旧标记**（"保持主体结构、颜色、比例、材质和可见细节稳定" + "画面不生成文字"）的脏提示词，按平台+屏位重生成"海报版式 + 场景描述"。

**为什么要两个标记同时命中**：只命中一个可能是人工写的合理描述，同时命中两个才确定是旧套话。这是为了**不误伤**。

幂等，重复跑无副作用。实测一次清洗 7 条。

## 十、Agent 改稿工具的边界

`cloud_agent_ecommerce_tools.go`（123 行）给云端 Agent 提供改稿能力，边界划得很死：

- **只读写 `ecommerce_*` 表**，不碰画布
- **不计费**（改文案不触发模型调用）
- 工具：`ecommerce_get_product_detail`、`ecommerce_update_slot_prompt` 等

## 十一、实测数据与测试覆盖

### 数据量（2026-10-21）

| 表 | 行数 |
|---|---|
| `ecommerce_products` | 1 |
| `ecommerce_slots` | 14 |
| `ecommerce_slot_versions` | 32 |
| `ecommerce_presets` | 6 |

那 1 个商品当前状态 `failed`（round=2、plan_revision=8、review 模式），失败原因正是 `PLAN_VALIDATION_FAILED: cannot unmarshal array into DetailPlan.styleAnalysis`——也就是第 4.5 节容错整形针对的现场，**该问题已修复**。

### 测试

约 **198 个**电商相关用例：
- 后端 `ecommerce_*_test.go` 31 个文件 + 域层 53 个 + cloud_agent 6 个
- 前端 `commerce-*.test.ts(x)` 与 `ecommerce-*.test.ts` 共 108 个

其中 `plandetail_parity_test.go` 专门守 **Go 侧与 TS 侧 12 段编译器的同构性**——两边逻辑必须一致，改一边要同步改另一边。

## 十二、与其他章的关系

- 12 段编译器的输入从哪来 → 第 10 章（Agent 如何读技能）
- 派发的任务如何被执行 → 第 11 章
- 合规闸门与 E-Reverse 的同构关系 → 第 12 章、第 13 章
- 画布节点的挂载机制 → 第 8 章
- 为什么迁移号 55/56 被电商占用 → 第 3 章、第 6 章


---

## 10 Agent 运行时

## 本章目的

讲清这套系统最有特色的部分：**Go 后端如何驱动一个 Node.js 子进程当"AI 助手"**，两者之间怎么通信，以及技能（第 7 章）是如何被 Agent 按需读取而不是一股脑塞进提示词的。

## 一、为什么是 Go + Node 双进程

Agent 的生态工具链（MCP、Skills、各种 SDK）主要在 Node/TypeScript 侧，而后端主体是 Go。硬把 Agent 逻辑移植到 Go 成本极高，所以选了个务实方案：**Go 当宿主，Node 当子进程**。

```
┌───────────────────────────────────────────────┐
│  Go 后端进程（宿主）                            │
│  internal/agent/runtime/runtime.go             │
│                                                 │
│  每轮 Agent 运行：                               │
│    exec.Command("node",                        │
│      "--max-old-space-size=<MB>",              │
│      "<RuntimeDir>/agent-runtime.mjs")         │
└──────────────┬────────────────────────────────┘
               │
               │  ① stdin  ← JSON 请求（ProcessRequest）
               │  ② 本地 HTTP 回调桥（127.0.0.1:随机端口 + bearer token）
               │  ③ stdout ← 行分隔的事件流
               ▼
┌───────────────────────────────────────────────┐
│  Node 子进程（Agent 运行时）                    │
│  agent-runtime/pi/agent-runtime.mjs            │
│  - 调模型                                       │
│  - 调工具                                       │
│  - 读技能                                       │
└───────────────────────────────────────────────┘
```

### RuntimeDir 解析顺序

Node 运行时脚本的位置按以下顺序找（找不到就报错）：

1. 环境变量 `CANVAS_PI_RUNTIME_DIR`
2. Docker 部署路径 `/app/backend/agent-runtime/pi`
3. 源码相对路径 `backend/agent-runtime/pi`

### 环境白名单

传给 Node 子进程的环境变量**只有三个**：`PATH`、`NODE_ENV=production`、`PI_OFFLINE=1`。父进程的其他环境变量一律不继承——这是安全边界，防止宿主环境的配置泄漏进子进程。

### 进程闸

同时运行的 Node Agent 进程数有上限：**默认 30，可通过 `CANVAS_AGENT_MAX_PROCESSES` 调整，硬上限 64**。超过就在队列里等。

## 二、三通道通信

### 通道 ①：stdin（请求）

父进程启动子进程时，通过 stdin 写一个 JSON 对象 `ProcessRequest`，约 16 个字段：

| 字段 | 作用 |
|---|---|
| `BridgeURL` / `BridgeToken` | 回调桥地址与令牌（给通道 ② 用） |
| `Prompt` | 用户输入 |
| `SystemPrompt` | 系统提示词 |
| `EnabledSkills` | 本次启用的技能 ID 列表 |
| `Tools` | 可用工具清单 |
| `Compaction` | 上下文压缩配置 |
| `Permissions` | 权限边界 |
| `Model` | 用哪个模型 |

### 通道 ②：本地 HTTP 回调桥

Node 需要回调父进程时（调模型、调工具、发事件），走一个**本地 HTTP 服务**：

- 监听 `127.0.0.1:0`（**随机端口**，避免端口冲突）
- 用 bearer token 鉴权（令牌由父进程生成，只告诉这一个子进程）
- 三类回调：`model`（调模型）、`tool`（调工具）、`event`（发进度事件）

**为什么不用 stdio 做工具回调**：工具调用可能需要几秒到几十秒（比如生成图片），用 stdio 会阻塞其他消息。HTTP 桥可以并发。

### 通道 ③：stdout（事件流）

Node 的标准输出按行输出事件，父进程逐行读。这是"广播通道"，Agent 的思考过程、回答片段都从这里流出。

## 三、工具条件注入（技能体系的关键机制）

这是第 7 章技能加载链的最后一环，也是**最反直觉**的设计。

### 常见做法（错误做法）

把技能的全部内容拼进系统提示词。后果：73 个技能全塞进去，提示词几十万 token，模型又慢又贵还会被无关信息干扰。

### 本系统的做法：渐进披露

```
① 请求带 EnabledSkills（本次启用的技能 ID）
        │
        ▼
② 只有 EnabledSkills 非空时，才注册这两个工具：
     skill_search      （检索：返回匹配的技能/能力卡索引）
     skill_read_file   （读取：按需读某个文件正文）
     director_validate_prompt / director_validate_ledger
                        （校验：即梦/LibTV 提示词与项目台账的确定性门禁，
                          纯内存执行，只读权限模式下同样可用）
        │
        ▼
③ 装进 Agent 快照的只有【元数据 + 文件路径】
   ★ 正文永不内联进提示词
        │
        ▼
④ Agent 自己决定：先 skill_search 找 → 再 skill_read_file 读需要的
```

**类比**：不是把整座图书馆搬进办公室，而是给一张目录卡片 + 一个"按需调书"的按钮。

### 检索打分

`skill_search` 的排序规则（`cloudAgentSkillMatch`）：

| 命中位置 | 分值 |
|---|---|
| 能力卡（card） | 4 |
| 技能名 | 3 |
| 描述（description） | 2 |

即**能力卡匹配权重最高**——因为能力卡是知识的细粒度单元，命中它说明真的找到了对口知识。

**能力卡的双通道匹配（2026-10-23 升级）**：卡命中原本只比对文件名 slug，`references/one_take.md` 这类英文文件名打不中中文词「一镜到底」。现在除 slug 外，还抽取每张卡的 **Markdown 标题结构索引**（H1 与各级小节标题，代码围栏内不计，400 字上限）参与 4 分判定——`cards/`、`references/`、`assets/` 三类目录真正平权。平分时按「文件名 slug > H1 标题 > 小节标题」裁决，保证权威文档（如 `references/production_routes.md` 的 H1）胜出台账模板的 H2 节名。实测 7 个中文关键词（三路线/角色设定板/360度补角/空间推演/一镜到底/即梦/Seedance）全部 4 分命中对应 references 卡。

配套还有：中文分词（单汉字放行 + 停用词表）、token 预算上限、每轮默认返回 8 条（上限 20）、片段截断 120 字、卡索引预算 40。卡命中时只下发唯一顶卡路径（命中即直读，不再下发整包索引）；仅命中技能名/描述时才下发卡索引清单。

### 读取时的版本保护

`skill_read_file` 读文件时会检测版本/哈希变化，防止"快照是旧的、文件是新的"导致读到混合版本。

### 技能包的执行边界

快照的 `Files` 列表只包含 `.md` / `.txt` / `.json` 三类，**可执行包永不执行**。技能包里的 Python 脚本（如影视工坊的 32 个）是给开发者用的工具，不是给 Agent 直接跑的。

## 四、`skills_load` 是审计事件，不是工具

技能被加载会记一条审计事件（`skills_load`），但它**不是一个可调用的工具**。这样设计的目的是：技能加载留痕可审计，但不会被 Agent 当作"动作"反复触发。

## 五、遗留代码厘清

仓库里有三个名字相近的东西，别搞混：

| 路径 | 状态 |
|---|---|
| `agent-runtime/pi/agent-runtime.mjs` | ✅ **当前运行时**，被 Go 当子进程拉起 |
| `canvas-agent/`（16 个 TS 文件） | ⚠️ 旧实现，已不在主链路 |
| `yingce-agent/` | ⚠️ 旧实现 |

对外描述时说"Agent 运行时是 Node 子进程，脚本在 `agent-runtime/`"即可，不要提后两个。

## 六、cloud_agent 系文件全景

`backend/internal/app/` 下约 100 个 `cloud_agent_*.go` 文件，按职责分类：

| 类别 | 干什么 |
|---|---|
| runtime / bridge | 子进程管理与三通道通信 |
| tools | Agent 可调用的工具集（含电商改稿工具，见第 9 章） |
| canvas events | 画布事件订阅与变更回执 |
| approval | 审批流（敏感操作要人确认） |
| memory / compaction | 记忆与上下文压缩 |
| vision | 图像理解 |
| recovery / checkpoint | 断点恢复（`internal/agentcontext/checkpoint.go`） |
| user errors | 用户可见的错误映射 |

`internal/yingceagent/client.go` 是与外部 Agent 服务通信的客户端。

## 七、与其他章的关系

- 技能包本身的结构与加载 → 第 7 章
- 电商改稿工具的边界 → 第 9 章
- 任务派发与 Agent 任务的关系 → 第 11 章
- 审批流的权限模型 → 第 12 章


---

## 11 任务、计费与模型路由

## 本章目的

讲清"一次生成任务的生死周期"和"钱怎么算"。所有生成动作（图片、视频、文本）都走同一套任务系统。

> **待确认**：本章的计费公式部分尚未核实到公式级精度（credit/token 换算、失败退费策略、video_token_billing 的 v25 公式快照机制）。文中已如实标注，未做猜测。正式评审前建议补这项调研。

## 一、任务状态机

`backend/internal/model/models_task.go` 定义 Task 结构，状态取值：

| 状态 | 含义 |
|---|---|
| `queued` | 已创建，等 worker 认领 |
| `running` | 已被认领，执行中 |
| `succeeded` | 成功 |
| `failed` | 失败 |
| `cancelled` | 用户取消 |

### 流转条件

```
创建任务
   │
   ▼
queued ─── worker 认领（ClaimNextTask） ──▶ running
                                              │
                        ┌─────────────────────┼─────────────────────┐
                        ▼                     ▼                     ▼
                   succeeded               failed               cancelled
                        │                     │                     │
                        ▼                     ▼                     ▼
                  回写画布节点           错误信息带回详情       释放资源
```

### 认领的并发安全

多个 worker 同时轮询时，靠**数据库条件更新**保证一个任务只被一个 worker 拿到：

```sql
UPDATE tasks
   SET status = 'running', lease_owner = ?, lease_expires_at = ?, attempts = attempts + 1
 WHERE id = ?
   AND (status = 'queued'
        OR (status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)))
   AND (next_poll_at IS NULL OR next_poll_at <= ?)
```

- `lease_owner` / `lease_expires_at`：租约。worker 拿到任务后有 45 秒独占期
- `attempts + 1`：重试计数
- 条件里的 `lease_expires_at <= now`：**租约过期的任务可以被别的 worker 捡起**——这是 worker 崩溃后任务不丢的关键
- `RowsAffected == 0` 说明被别人抢了，本次认领失败

Postgres 下还会加 `FOR UPDATE SKIP LOCKED`，SQLite 下靠上面的条件更新。

## 二、任务派发器

`backend/internal/app/task_worker.go`（477 行）：

| 函数 | 职责 |
|---|---|
| `StartWorker` / `StopWorker` | 启停派发循环 |
| `runWorkerLoop` | 主循环 |
| `dispatch` | 一次派发动作 |
| `processClaimedTask` | 按任务类型分叉执行 |

### 并发控制

`runtimeConcurrencySetting()` 返回 worker 并发数。派发时用 `AcquireLease` 拿全局槽位，槽位满了就等下一轮。

### 优雅停机

`StopWorker` 后：不再认领新任务，等在途任务收尾（drain 上限 10 分钟）。已认领未完成的任务靠租约过期被下一个 worker 捡起。

### SQLite 锁退避重试（本地修复 `1dab360c0`）

**问题**：`ClaimNextTask` 内部是「SELECT（持共享锁）→ UPDATE（升级写锁）」两步。WAL 模式下**锁升级**冲突时，glebarez/sqlite 驱动立即返回 `SQLITE_BUSY`，`busy_timeout` 不生效。撞上画布保存的写事务时，认领直接失败，前端看到「作品已生成，保存遇到问题」。

**修复**（`backend/internal/app/sqlite_busy_retry.go`）：

```go
var sqliteRetryDelays = []time.Duration{
    150 * time.Millisecond,
    400 * time.Millisecond,
    900 * time.Millisecond,
}

// isSQLiteBusyError：识别库忙类错误
//   "database is locked" / "database table is locked"
//   "sqlite_busy" / "sqlite_locked" / "database is busy"
//   glebarez 的 "(517)" 裸错误码

// withSQLiteBusyRetry：只对库忙重试，共 4 次尝试
//   非库忙错误（约束冲突等）立即返回，不掩盖真实故障
```

`claimNextTaskWithRetry` 包装认领——认领本身幂等（status/lease 条件收口），重试不会重复认领同一任务。

**实测效果**：上线后真机 `database is locked` 与 `task dispatch paused` 均为 0 次。

## 三、任务类型与执行分叉

`processClaimedTask` 顶部按 `task.Type` 分叉：

| 类型 | 执行器 |
|---|---|
| `canvas_image` | 生图（电商工坊、画布节点都走这个） |
| `canvas_text` | 文本（AI 策划、文本节点） |
| `timeline_transcription` | 字幕转写（本地 whisper.cpp，不走模型渠道不计费） |
| `timeline_render` | 时间线渲染（本地 ffmpeg） |
| 视频类 | 视频生成 |

**注意**：`timeline_*` 两类是**本地执行**，不经过模型路由与计费。这是有意的——本地推理不该收用户的积分。

## 四、计费链路（**待确认公式**）

### 涉及文件

| 文件 | 行数 | 职责 |
|---|---|---|
| `backend/internal/app/credit_cost.go` | 70 | 积分成本计算 |
| `backend/internal/app/credit_policy.go` | 184 | 积分策略（上游阶段一合入了 5 分钟 TTL 缓存） |
| `backend/internal/app/task_billing.go` | 140 | 任务计费主流程 |
| `video_token_billing.go` | — | 视频 token 计费（v25 迁移做了公式快照） |
| `backend/internal/kernel/token_billing.go` | — | token 计费内核 |

### 上游阶段一合入的优化

`CreditAccount`（钱包）改成**先读后写**，消除读路径上的写锁争用。这直接缓解了我们遇到的 `database is locked` 同类问题——之前读钱包余额也要拿写锁，和任务派发抢。

### 待确认项

以下尚未核实到可写入文档的精度：
1. credit 与 token 的精确换算公式
2. 任务失败是否退费、部分退费规则
3. `video_token_billing` 的 v25 公式快照机制具体怎么工作（推测是"公式变了老任务仍按老公式算"，但未验证）
4. `billing_review` 系列的审计逻辑

## 五、模型路由与渠道体系

### 渠道模型两级结构

```
ModelChannel（渠道）  1 ── N  ChannelModel（渠道下的模型）
      │                          │
      │                          └─ 挂价格档（ChannelModelPriceTier）
      ▼
LogicalModel（逻辑模型，跨渠道的统一标识）
```

### 系统渠道

`EnsureSystemChannelModels()` 启动时确保系统渠道的模型清单存在。系统渠道的模型对所有用户可见，无需自己配 key。

### provider catalog（上游阶段一合入）

v57 迁移给 `ModelChannel` 加了 `CatalogProviderID`、`ChannelModel` 加了 `CatalogModelKey`，用于标记"这个渠道/模型是从哪个服务商目录一键接入的"。纯来源展示用，不影响计费。

### 协议适配层

`internal/protocol/` 把内部统一的请求格式转成各上游 API 格式：

| 协议 | 服务商示例 |
|---|---|
| OpenAI 兼容 | 绝大多数 |
| Gemini | Google |
| 方舟 / 即梦 | 字节系 |
| 千问 MaaS | 阿里（插件包形式） |
| MiniMax / Seedream | 各自的插件包 |

插件包在 `plugin-packages/` 下，每个是一个 manifest + 实现，新增服务商不用改主体代码。

## 六、任务恢复与媒体找回

| 机制 | 作用 |
|---|---|
| `task_media_recovery` | 任务成功但媒体丢了时，按原任务重试交付，**不重复计费** |
| `provider_task_recovery.go` | 上游任务超时后继续回查，合并轮询日志 |
| `agentcontext/checkpoint.go` | Agent 断点恢复 |

`task_media_recovery` 的"不重复计费"很重要：生图已经付过费了，只是下载/入库失败，重试不能二次扣钱。

## 七、与其他章的关系

- 电商任务如何被派发 → 第 9 章
- 任务认领的锁治理 → 第 8 章
- 上游阶段一合入的钱包优化 → 第 3 章、第 6 章
- 协议插件如何扩展 → 第 2 章


---

## 12 安全、合规与质量

## 本章目的

汇总系统里所有的"闸门"——鉴权、网络、内容合规、测试门禁。这套系统的设计哲学是**fail-closed**（该拒就拒，不悄悄兜底）。

## 一、鉴权体系

`backend/internal/auth/` 负责，能力包括：

| 能力 | 说明 |
|---|---|
| 邮箱验证 | 注册/改邮箱发验证码，`auth_verification` 表管理 |
| 短信验证 | `sms_channels` / `sms_records` 表，多渠道短信 |
| OAuth 多提供商 | LinuxDo / TapNow / libtv 等，`oauth_state` 表防 CSRF |
| 注册协议 | v20-v22 迁移引入的"同意协议"校验，影策协议正文预留在 v21 |
| 密码重置 | 邮箱验证码流程 |
| 登录日志 | v53 迁移的 `user_login_logs`，审计用 |

**会话机制**：`auth_sessions` 表存 session（token 哈希 + 过期时间）。cookie 形如 `open_ai_canvas_session=<session_id>.<token>`，服务端只存 token 的 SHA-256，不存明文。

**注册开关**：`CANVAS_REGISTRATION_ENABLED` 环境变量控制是否开放注册。

> 本文档不含任何密钥、令牌、连接串。如需了解具体配置项，见 `.env` 文件（只列变量名）。

## 二、CORS 策略

后端中间件层配置，三条规则：

1. **来源白名单**：显式配置的允许来源
2. **同主机豁免**：请求来自同一主机时放宽
3. **localhost 兜底**：本地开发默认放行

## 三、日志脱敏

### 画布分享 token

`redactCanvasSharePath` 把访问日志里的分享令牌替换成字面量：

```
真实路径  /api/public/canvas-shares/abc123.../resources/x/file
日志记录  /api/public/canvas-shares/:token/resources/x/file
```

### 用户可见错误与内部诊断分离

业务错误用 `NewAppError(status, message)`，message 是**给用户看的中文可读说明**；内部堆栈、SQL、上游原始响应走日志，不回给前端。

上游阶段一还专门合入了一个提交（`fix(security): 用户错误信息 - 隐藏上游诊断和任务标识`），把上游 API 返回的原始错误和内部任务 ID 从用户可见信息里去掉——这是防信息泄露。

## 四、内容合规闸门（多层防御）

系统在**三个不同层**都有合规检查：

### 4.1 电商出口门禁（S5）

第 9 章第 6 节详述。三步：剥离 → 红线词通感改写 → 比例冲突拒绝。22 个违禁词映射到隐喻表达。

### 4.2 E-Reverse 侧车

`工具/e-reverse/` 下的 Python 服务（8790 端口），负责"逆向"链路：把平台规范、合规词表转成可执行的约束。`providers.py` 里的合规改写与电商 exitgate **同构**——同一套思路在两个语言里各实现一遍（Go 侧给电商，Python 侧给通用）。

### 4.3 审批流

云端 Agent 的敏感操作走审批：Agent 提出动作 → 生成审批卡片 → 用户确认 → 才执行。这是"AI 不能擅自做危险操作"的机制保障。

## 五、测试体系

### 5.1 规模（实测 2026-10-22）

| 范围 | 数量 |
|---|---|
| Go 测试文件 | 425 个 `*_test.go` |
| 前端测试文件（`web/test/`） | 332 个 .ts/.tsx |
| 前端测试代码行数 | 33,147 行 |

### 5.2 前端 DOM 测试的特殊配置

前端有两类测试：
- **纯逻辑**：直接 `bun test test/xxx.test.ts`
- **需要 DOM 的**（React 组件测试）：要设 `HAPPY_DOM=1` 并配 preload

**为什么需要 preload**：某些组件（如视频播放器）在**模块加载时**就读 `localStorage`，而测试文件自己装配 DOM 全局发生在静态 import 之后，时序对不上。

解法是 `web/test/happy-dom-preload.ts` + `web/bunfig.toml`，用 `HAPPY_DOM=1` 门控——**默认完全空转**，不影响其余 313 个测试文件。

### 5.3 运行方式

```bash
cd web
bun test test/xxx.test.ts                          # 纯逻辑
HAPPY_DOM=1 bun test test/xxx.test.tsx             # DOM 测试
```

### 5.4 已知既有失败（非回归）

本机环境限制导致 3 个测试长期失败，合并/改代码后它们失败**不算回归**：

| 测试 | 原因 |
|---|---|
| `TestGmailMailboxRegistrationConcurrent` | 临时目录写入被安全中心拦截（`Access is denied`） |
| `TestPaymentExportKeepsSnapshotWhenRerunCompletesBetweenReads` | 压力测试，故意用第二连接在查询中间插入写制造锁 |
| 两个 assets 用例 | 仅全量跑时失败，单独跑通过——测试间数据污染 |

**区分回归的方法**：合并前先把全量测试结果存档（`reports/go-test-baseline-pre-absorb.txt`），合并后重跑做 diff，只关注"基线通过、合并后失败"的新增回归。

## 六、质量门禁（测试守不变式）

这套系统用**测试钉死关键不变式**，改坏了会红：

| 门禁 | 守什么 |
|---|---|
| `migrations_test.go` | `CurrentSchemaVersion` 必须等于迁移计划最后一条；迁移身份不被篡改 |
| `skills_yingshi_builtin_test.go` | 内置技能的 Python 文件树哈希——改技能内容会红 |
| `migrations_lineage_test.go` | 迁移血缘（顺序、无跳号） |
| `plandetail_parity_test.go` | Go 侧与 TS 侧 12 段编译器同构 |
| `status_deadlock_test.go` | review 态下 draft 槽位不得推导成 running |
| `presets_check.py`（judian 侧，**待确认**） | 跨仓技能对账 |

## 七、法务边界

| 文件 | 作用 |
|---|---|
| `LICENSE-INSPIRATION.md` | 灵感广场内容的授权说明 |
| `NOTICE` | 第三方组件声明 |
| `SECURITY.md` | 安全策略 |
| `AGENTS.md` | AI 协作规范（含"对上游只读"铁律） |

**fork 合规**：我们 fork 自开源项目，私有领域代码不外泄、不污染上游；上游的开源贡献按原许可证保留。这条边界由 `upstream` remote 的 push URL 锁死从机制上保证（见第 3 章）。

## 八、与其他章的关系

- 电商合规闸门的三步细节 → 第 9 章
- E-Reverse 侧车 → 第 13 章
- 审批流与 Agent → 第 10 章
- 测试基线如何用于区分回归 → 第 3 章


---

## 13 部署、运维与工作区生态

## 本章目的

把"工程"放回"工作区"：系统怎么在本机跑起来、怎么容器化、怎么在线更新，以及工作区里另一条线（酿笑坊蒸馏产线）如何为它供给技能内容。

## 一、本地启动链

```
双击 启动源起.bat
   │
   ├─ set HTTP_PROXY= （等全部清空）
   │    └─ 本机系统代理会劫持 127.0.0.1 请求，导致服务间调用失败
   │
   ▼
yuanqi_console.py（Python 3.13.12）
   │
   ├─ SERVICES 清单：backend → frontend → ereverse → cloudflared
   ├─ 每起一个轮询等端口 LISTENING，boot_trace 记录启动耗时
   └─ 就绪后面板 http://127.0.0.1:17580
```

### 各服务归谁管（重要区分）

| 服务 | 端口 | 归谁管 |
|---|---|---|
| 后端 API | 8080 | 控制台 |
| 前端 dev | 3000 | 控制台 |
| E-Reverse | 8790 | 控制台 |
| cloudflared 隧道 | 随机 | 控制台 |
| **nxf 酿笑坊引擎** | **8823** | **不由控制台管**，`nxf/` 下有独立启动脚本 |

> 早前"本地五服务一键启动"的说法不准确。控制台实际只管前四项，nxf 要单独启。

### 后端二进制

控制台默认跑 `.local/canvas-backend.exe`——一个约 109 MB 的 Go 静态编译产物，不依赖本机 Go 环境。源码在 `backend/`，重建命令：

```bash
cd backend
go build -o ../.local/canvas-backend.exe ./cmd/server
```

`.local/` 下还有一堆 `.bak-before-*` 后缀的历史二进制备份，是每次换版前留的回滚点。

### 控制台面板

`http://127.0.0.1:17580` 提供启停服务、看实时日志、改配置的 Web 界面。

> **脱敏提示**：控制台页面里有默认演示账号。本文档不列出任何凭据，请以实际部署时的设置为准。

## 二、容器化部署

仓库提供完整的 Docker 支持：

| 文件 | 用途 |
|---|---|
| `Dockerfile` | 镜像构建 |
| `docker-compose.yml` | 主 compose |
| `docker-compose.build.yml` | 构建用 |
| `docker-compose.deploy.yml` | 部署用 |
| `docker-compose.dev.yml` | 开发用 |
| `docker-compose.local.yml` | 本地用 |
| `docker-compose.server.yml` | 服务端用 |
| `nginx.conf` | 反向代理配置 |

Docker 部署时，Agent 运行时的路径解析走 `/app/backend/agent-runtime/pi`（见第 10 章）。

### 迁移在容器编排中的位置

生产 compose 里有一个独立的 migrate 服务，**在 Backend 之前**执行 `migrate-schema up`。这样保证升级时先迁库、再起新代码，避免"新代码连旧库"的版本闸门拒绝启动。

## 三、在线更新

`backend/internal/hostupdate/` 实现：

| 文件 | 职责 |
|---|---|
| `manager.go` | 更新管理器 |
| `server.go` | 更新服务 |
| `version.go` | 版本比对 |
| `disk_*.go` | 磁盘空间检查等前置条件 |

机制：updater socket + `CANVAS_UPDATER_TOKEN` 鉴权。触发更新前会检查磁盘空间，失败自动回退。

**边界**：在线更新面向"受管部署"；本机 SQLite 单文件场景下手动换二进制更直接。

## 四、数据库备份与回滚

### 备份方式

本机是**文件级备份**：停服后复制 `.local/data/open_ai_canvas.db*`（含 `-wal`、`-shm`）整个目录。历史上每次重大操作前都会留一份 `.bak-before-*`。

### 回滚的硬约束

**数据库迁移不可逆。** 如果把代码回滚到旧版本，而库已经被迁到新高版本，`RequireSchemaVersion` 会以「数据库结构版本高于程序支持的版本」**拒绝启动**——这是设计使然的保护。

所以安全回滚路径只有一条：

```
停服 → 用合并前的库备份恢复 .local/data/ → 启动旧代码
```

**不要**手删 `schema_migrations` 里的记录来绕过版本闸门——表结构已经变了，旧代码连新库是未定义行为。

这也是为什么每次上游合并前都要：(1) 打 tag (2) 备份真库 (3) **用库副本先试迁移**。

## 五、工作区生态：蒸馏产线

`D:\AlcheMvision\` 下不只有 open-ai-canvas，还有一条为它供给"技能知识"的产线。

```
┌──────────────────────┐
│ D:\书籍蒸馏库\        │  19 个书舱（原始素材：专著、教材）
│  （原料）             │
└──────────┬───────────┘
           │  蒸馏
           ▼
┌──────────────────────┐
│ D:\AlcheMvision\nxf\ │  酿笑坊 cangjie-niangxiaofang v3.0
│  _engine/ 七区引擎    │  - visual_dna.py      视觉 DNA 提取
│                      │  - distill_engine     技法蒸馏
│                      │  - ingest_engine      摄入
│                      │  - rag_engine         检索增强
│                      │  - verify_gate.py     质量门禁
│                      │  - yingce_bridge      8823 服务 / MCP 暴露
│                      │  - launch_director.py 导演链路
└──────────┬───────────┘
           │  投稿
           ▼
┌──────────────────────┐
│ judian-skills/       │  公开化投稿仓（已更名 yuanqi-pipeline）
│  （待确认：现状不明） │  - 35 域包中仅 1 个有 SKILL.md，34 个 cards 为空
│                      │  - singles 实为 14 个
│                      │  - presets_check.py 跨仓对账门禁
└──────────┬───────────┘
           │  落地
           ▼
┌──────────────────────┐
│ open-ai-canvas/      │  backend/builtin/ 74 个技能包
│  backend/builtin/    │  go:embed 进二进制，启动 upsert 进 skills 表
└──────────────────────┘
```

### 蒸馏产物的实证

`backend/builtin/影视剧作工坊/影视剧作工坊-引擎/` 就是蒸馏产物：**四本导演学专著 → 454 条方法论 + 32 个 Python 脚本**。这是"从书到可用知识库"的完整链路物证。

### nxf 的耦合程度

nxf 与 open-ai-canvas 的耦合是**松耦合**：
- 控制台不管理 nxf 服务
- nxf 的产出通过**文件落地**（写入 `backend/builtin/`）进入系统，不是运行时调用
- 系统运行时不依赖 8823 端口

**待确认**：`nxf/_engine/yingce_bridge/service.py` 与 `mcp_server.py` 现在由谁拉活、MCP 暴露给谁，我们尚未核实。对外描述时建议说"nxf 是工作区级的离线/半离线工具链"，不要说成"系统的组成部分"。

## 六、E-Reverse 侧车

`工具/e-reverse/`（8790 端口，Python）：

| 文件 | 职责 |
|---|---|
| `server.py` | HTTP 服务 |
| `e_reverse.py` | 主逻辑 |
| `pft_schema.py` | 平台事实表 schema |
| `providers.py` | 服务商与合规改写（与电商 exitgate 同构） |

职责是把"平台规范 / 合规词表"这类外部知识，转成系统能执行的约束（pft/v1 事实表管线、词级时间轴）。

## 七、与其他章的关系

- 技能如何被加载进系统 → 第 7 章
- 迁移为什么不可逆 → 第 6 章
- 上游合并前的备份流程 → 第 3 章
- 合规改写与电商门禁的同构 → 第 9 章、第 12 章


---

## 附录 A 术语表

> 按主题分组。每条给一句大白话解释，非程序员也能看懂。

## 工程通用

| 术语 | 解释 |
|---|---|
| **Go** | Google 出的编程语言，特点是编译成一个独立文件、跑得快。本系统后端用它 |
| **Gin** | Go 的 Web 框架，负责"收到 HTTP 请求后分发给哪个函数" |
| **GORM** | Go 的数据库操作库，把"查数据库"写成类似"操作对象"的代码 |
| **SQLite** | 一种把整个数据库存成**单个文件**的数据库，零配置，适合单机 |
| **PostgreSQL** | 功能更全的数据库，需要独立服务，适合多实例部署 |
| **WAL（预写日志）** | SQLite 的一种运行模式：写操作先记到单独日志文件，让读和写能并行，不互相堵 |
| **React** | Facebook 出的前端框架，把界面拆成一个个可复用"组件" |
| **TypeScript** | JavaScript 加上了"类型检查"，写错变量名/类型在编译期就能发现 |
| **Vite** | 前端构建工具，开发时改代码立刻能在浏览器看到效果 |
| **antd** | 一套现成的 React 界面组件库（表格、弹窗、表单等） |
| **zustand** | 前端状态管理库，负责"整个应用共享的数据放哪、怎么改" |
| **go:embed** | Go 的特性，能把文件夹里的文件**编译进最终的程序文件**里，部署时不用带额外文件 |
| **frontmatter** | Markdown 文件开头用 `---` 包起来的一段元数据（标题、作者、版本等） |
| **checksum（校验和）** | 对文件内容算的一串"指纹"。内容变一个字节，指纹就完全不同，用来检测"东西被改过没有" |
| **迁移（migration）** | 管理数据库表结构变更的脚本，按顺序编号执行，保证每台机器的库结构一致 |
| **租约（lease）** | "这个东西我包了 X 秒"的机制。别的工人看到租约没过期就不碰，过期了才能捡起 |
| **fail-closed** | "该拒就拒"的设计哲学：宁可报错停下，也不悄悄兜底产出错东西 |
| **灰度 / 降级** | 新功能出问题时自动退回旧路径，保证主流程不断 |

## 本系统专有

| 术语 | 解释 |
|---|---|
| **画布（Canvas）** | 系统主界面：一块无限大的板子，上面摆各种"节点"，节点之间拉线连线 |
| **节点（Node）** | 画布上的一个方块，可以是图片、文本、视频、脚本、配置等 20 种之一 |
| **Frame** | 容器型节点，可以把别的节点装在里面。电商的"拼合长图组"就是一个 Frame |
| **槽位（Slot）** | 电商工坊里"详情页的第几屏"，一个商品 7 个槽位（3 主图 + 4 详情） |
| **能力卡（capability card）** | 技能包里的细粒度知识单元，一个技能拆成多张卡，按需读 |
| **技能包（Skill）** | 一个带 SKILL.md 的文件夹，装着"怎么让 AI 干好某件事"的知识 |
| **渐进披露** | 不一次给 AI 全部资料，先给目录，AI 按需再取正文。防止提示词爆炸 |
| **控制台** | 本机的 Python 管理面板（17580 端口），用来启停服务、看日志 |
| **对账（reconcile）** | 任务跑完后，把上游结果和本地记录逐条核对，确认没漏没错 |
| **出口门禁（exitgate）** | 提示词发往模型前的最后一道检查，不合规就拒 |
| **拼合组** | 电商把多张成品图按顺序无缝拼成一张长图的结构 |
| **上游 / 下游** | 上游 = 我们 fork 的那个开源项目；下游 = 使用我们的系统的人 |

## 电商域

| 术语 | 解释 |
|---|---|
| **主图 / 详情页** | 电商商品页的两类图：主图是列表里的小方图，详情页是往下滑的大长图 |
| **12 段视觉方案** | 本系统把一屏的画面描述固定拆成 12 个维度（构图、光线、配色、文字留白…） |
| **指纹去重** | 对相邻屏的画面方案算"指纹"，发现两屏太像就自动加一个差异化机位 |
| **视觉 DNA** | nxf 引擎从参考图里提取的风格特征（配色、光影、构图规律） |
| **通感改写** | 合规词不能直接用，改写成意思相近但能过审的表达（如"情趣用品"→"私享生活器物"） |
| **textMode** | 电商配置项：`typeset`（按需排版文字）/ `none`（纯图无字） |
| **策划（plan）** | 用视觉文本模型看商品图 + 读卖点，产出结构化分屏方案的过程 |

## Agent 域

| 术语 | 解释 |
|---|---|
| **Agent** | 能自己调工具、多轮思考的 AI 助手，不只是"一问一答" |
| **MCP** | Model Context Protocol，一套让 AI 调用外部工具的标准协议 |
| **审批流** | Agent 要做敏感操作时，先弹卡片问人，人点了才执行 |
| **上下文压缩（compaction）** | 对话太长时把早期内容摘要化，防止超出模型的输入上限 |
| **检查点（checkpoint）** | Agent 运行到一半的状态存档，崩了能从这儿恢复 |
| **检索打分** | 搜技能时按"命中位置"给分：能力卡 4 分 > 技能名 3 分 > 描述 2 分 |

## 运维域

| 术语 | 解释 |
|---|---|
| **drain（排空）** | 停机时先不收新活，把手头的活干完再退出 |
| **回填（backfill）** | 给历史数据补上新增字段的值 |
| **absorbed tag** | "这个上游版本已被完整合入"的标记 |
| **baseline tag** | 仓库出问题后固化的"已知良好状态"，用来对比和恢复 |
| **侧车（sidecar）** | 跟着主服务一起跑的辅助进程（本系统的 E-Reverse 就是） |
| **公网隧道** | 把本地服务临时暴露成公网链接，用于手机真机测试 |


---

## 附录 B 路径索引

> 文档提到的每个文件 = 路径 + 一行作用。当字典查。路径相对于 `D:\AlcheMvision\open-ai-canvas\`（标注"工作区"的除外）。

## 后端入口与装配

| 路径 | 作用 |
|---|---|
| `backend/cmd/server/main.go` | 服务入口，334 行，16 步启动装配 |
| `backend/internal/database/database.go` | 数据库连接与 DSN 配置 |
| `backend/internal/database/migrations.go` | 58 条迁移计划 + checksum 校验 + 旧账本归一化 |
| `backend/internal/database/migrations_test.go` | 迁移不变式测试（版本号、身份、血缘） |
| `backend/cmd/migrate-schema/` | 独立迁移命令行工具（status / up） |

## 后端分层

| 路径 | 作用 |
|---|---|
| `backend/internal/handler/` | HTTP 层，84 文件约 430 条路由 |
| `backend/internal/app/` | 编排层，最大最重 |
| `backend/internal/repository/` | 数据访问层 |
| `backend/internal/model/` | 领域模型（表结构 struct） |
| `backend/internal/kernel/` | 基础设施（ID 生成、token 计费内核） |

## 电商工坊

| 路径 | 作用 |
|---|---|
| `backend/internal/ecommerce/plandetail.go` | 12 段视觉方案编译器（675 行） |
| `backend/internal/ecommerce/platforms.go` | 6 平台槽位规范 + 文案指令（442 行） |
| `backend/internal/ecommerce/plan.go` | 预设契约（独乐岛 / 通用标准 7 屏） |
| `backend/internal/ecommerce/config.go` | 用户配置视图（323 行） |
| `backend/internal/ecommerce/exitgate.go` | S5 视觉安全出口门禁（198 行） |
| `backend/internal/ecommerce/status.go` | 状态全集与商品状态推导 |
| `backend/internal/ecommerce/options.go` | 固化常量 |
| `backend/internal/app/ecommerce_orchestrator.go` | 派发编排 + `buildEcommerceSlotPrompt`（1394 行） |
| `backend/internal/app/ecommerce_slots.go` | 槽位 patch / 单屏重生成 / 确认 / 停止（488 行） |
| `backend/internal/app/ecommerce_products.go` | 导入 / 列表 / 详情（420 行） |
| `backend/internal/app/ecommerce_planner.go` | AI 策划派发与应用（419 行） |
| `backend/internal/app/ecommerce_export.go` | 导出 manifest + ZIP（254 行） |
| `backend/internal/app/ecommerce_plan_guard.go` | 策划守卫：未策划不许直接生图（124 行） |
| `backend/internal/app/ecommerce_platform.go` | 切平台 + 重建槽位 |
| `backend/internal/app/ecommerce_config.go` | 配置与预设保存 |
| `backend/internal/app/ecommerce_prompt_repair.go` | 启动自检清洗存量脏提示词（71 行） |
| `backend/internal/app/ecommerce_retry.go` | 商品重试 |
| `backend/internal/app/cloud_agent_ecommerce_tools.go` | Agent 改稿工具（只读写 ecommerce 表，不计费） |
| `backend/internal/model/models_ecommerce.go` | 电商五表定义 |
| `backend/internal/handler/ecommerce.go` | 电商 REST 路由（544 行，约 20 条） |

## 任务与计费

| 路径 | 作用 |
|---|---|
| `backend/internal/app/task_worker.go` | 任务派发器主循环（477 行） |
| `backend/internal/app/sqlite_busy_retry.go` | SQLite 锁退避重试（本地修复） |
| `backend/internal/app/task_lifecycle.go` | 任务状态流转 |
| `backend/internal/app/credit_cost.go` | 积分成本计算 |
| `backend/internal/app/credit_policy.go` | 积分策略（含 TTL 缓存） |
| `backend/internal/app/task_billing.go` | 任务计费主流程 |
| `backend/internal/repository/repository_tasks.go` | `ClaimNextTask` 认领 SQL |

## Agent 运行时

| 路径 | 作用 |
|---|---|
| `backend/internal/agent/runtime/runtime.go` | Go 侧 Agent 宿主，启动 Node 子进程 |
| `agent-runtime/pi/agent-runtime.mjs` | Node 侧 Agent 运行时（当前实现） |
| `backend/internal/agentcontext/checkpoint.go` | Agent 断点恢复 |
| `backend/internal/yingceagent/client.go` | 外部 Agent 服务客户端 |
| `backend/internal/app/cloud_agent_director_tools.go` | `director_validate_prompt` / `director_validate_ledger` 只读校验工具（纯内存，只读模式同样下发） |
| `canvas-agent/` | ⚠️ 旧 Agent 实现（16 个 TS 文件），已不在主链路 |

## 技能体系

| 路径 | 作用 |
|---|---|
| `backend/builtin/` | 74 个内置技能包（go:embed 进二进制） |
| `backend/builtin/embed.go` | 嵌入声明 |
| `backend/internal/skills/skills_builtin.go` | 技能 frontmatter 解析 + 加载 |
| `backend/internal/skills/skills_presets.go` | 技能预设（每轮激活上限 8） |
| `backend/builtin/影视剧作工坊/` | 旗舰技能，16 个子技能多层包 |
| `backend/builtin/影视剧作工坊/影视剧作工坊-引擎/` | 蒸馏产物：454 条导演学方法论 + 32 个 .py |
| `.gitattributes` | 强制 `backend/builtin/**` LF（技能哈希前提） |
| `backend/internal/director/prompt_validator.go` | Go 原生视频提示词校验器（1:1 移植 validate_prompt.py） |
| `backend/internal/director/ledger_validator.go` | Go 原生台账校验器（1:1 移植 validate_ledger.py） |
| `backend/internal/director/director_parity_test.go` | Go↔Python 对账测试（同源夹具，error/warning 计数级对齐） |
| `backend/internal/app/cloud_agent_chaoge_smoke_test.go` | 真库冒烟（`CHAOGE_REAL_DB_SMOKE=1` 门控，只读闭环） |
| `backend/internal/app/cloud_agent_dual_skill_ranking_test.go` | chaoge vs 影视剧作工坊双核同场排序断言 |
| `backend/builtin/chaoge-film-director-flex/` | 第 74 个包：Chaoge AI导演 2.0（三路线弹性制片 + 即梦/LibTV 提示词门禁） |
| `backend/builtin/chaoge-film-director-flex/references/` | 18 份方法论文档（检索平权：按 4 分能力卡参与 skill_search） |
| `scripts/gen_director_parity_fixtures.py` | 从权威 Python 校验器同源导出对账夹具 |
| `scripts/emit_director_parity_test.py` | 由夹具生成 Go 对账测试 |
| `~/.workbuddy/skills/chaoge-film-director-flex/` | 双轨镜像（人工同步，SHA-256 对账） |

## 前端

| 路径 | 作用 |
|---|---|
| `web/src/types/canvas.ts` | 画布数据模型，CanvasNodeType 20 种 |
| `web/src/pages/canvas/project.tsx` | 画布主页面（3589 行，组合约 25 个 hook） |
| `web/src/pages/canvas/canvas-project-world-layers.tsx` | 渲染三层分层（258 行） |
| `web/src/pages/canvas/use-commerce-workflow.ts` | 电商工作流编排（295 行，10 种动作） |
| `web/src/lib/canvas/node-registry.ts` | 节点注册表（118 行） |
| `web/src/lib/canvas/tool-registry.ts` | 工具注册表（163 行） |
| `web/src/lib/canvas/node-registry/definitions/builtin-nodes.tsx` | 内置节点 traits 定义 |
| `web/src/lib/canvas/tool-registry/definitions/add-node-menu-tools.tsx` | 创建菜单工具注册 |
| `web/src/lib/canvas/canvas-connection-policy.ts` | 连线校验（含 commerce 约束） |
| `web/src/lib/canvas/canvas-node-copy.ts` | 节点复制（commerce 深拷贝 + ID 重映射） |
| `web/src/lib/canvas/canvas-node-size.ts` | 节点尺寸（拼合组豁免最小尺寸） |
| `web/src/components/canvas/commerce-workflow-node.tsx` | 一键详情/复刻节点组件（169 行） |
| `web/src/components/canvas/commerce-result-board.tsx` | 预生成卡片组（72 行） |
| `web/src/components/canvas/commerce-screen-editor.tsx` | 单屏编辑弹窗（37 行） |
| `web/src/components/canvas/commerce-template-copy-editor.tsx` | 复刻模板文案替换（29 行） |
| `web/src/components/canvas/commerce-preview-image.tsx` | 预览图（宿主适配层，22 行） |
| `web/src/lib/canvas/commerce-workflow.ts` | 输入分流/校验/快照/策划提示词（205 行） |
| `web/src/lib/canvas/commerce-detail-plan.ts` | TS 侧 12 段编译（75 行） |
| `web/src/lib/canvas/commerce-replica-plan.ts` | 复刻方案编译（78 行） |
| `web/src/lib/canvas/commerce-image-assembly.ts` | 引用拼合组（63 行） |
| `web/src/lib/canvas/commerce-image-merge.ts` | 下载时合成 PNG（43 行） |
| `web/src/lib/canvas/commerce-image-size.ts` | 逐屏尺寸计算（39 行） |
| `web/src/lib/canvas/commerce-pricing.ts` | 只读计价（125 行） |
| `web/src/lib/canvas/commerce-result-layout.ts` | 结果组布局（18 行） |
| `web/src/lib/canvas/commerce-workflow-graph.ts` | 建结果组（28 行） |
| `web/src/components/canvas/use-canvas-image-source.ts` | 宿主媒体接口适配 |
| `web/src/pages/canvas/use-canvas-batch-table.ts` | 批量表 commerce 化 |
| `web/src/pages/canvas/use-canvas-generation-batches.ts` | 生成批次入队与调度 |
| `web/src/lib/canvas/canvas-generation-task-sync.ts` | 任务回填（含 commerce 分支） |
| `web/src/services/user-data-sync.ts` | 画布云端同步核心（约 700 行，含锁修复） |
| `web/src/router.tsx` | 前端路由 |
| `web/src/constant/navigation-tools.ts` | 左侧导航项 |
| `web/test/happy-dom-preload.ts` | DOM 测试 preload（HAPPY_DOM=1 门控） |
| `web/bunfig.toml` | Bun 测试配置（注册 preload） |

## 部署与运维

| 路径 | 作用 |
|---|---|
| `启动源起.bat` / `停止源起.bat` | 本机启停脚本 |
| `yuanqi_console.py` | 控制台面板本体（Python） |
| `.local/canvas-backend.exe` | 预编译后端二进制（约 109 MB） |
| `.local/data/open_ai_canvas.db` | SQLite 数据库文件 |
| `Dockerfile` / `docker-compose*.yml` | 容器化（5 个 compose 矩阵） |
| `nginx.conf` | 反向代理 |
| `backend/internal/hostupdate/` | 在线更新 |

## 工作区其他线（不在 open-ai-canvas 内）

| 路径 | 作用 |
|---|---|
| `D:\AlcheMvision\nxf\_engine\` | 酿笑坊引擎（visual_dna / distill / ingest / rag / verify_gate） |
| `D:\AlcheMvision\nxf\_engine\yingce_bridge\service.py` | 8823 服务（**待确认**现状） |
| `D:\AlcheMvision\nxf\00_先看我_酿笑坊全景.md` | nxf 自述定位文档 |
| `D:\AlcheMvision\judian-skills\` | 投稿仓，已更名 yuanqi-pipeline（**待确认**现状） |
| `D:\书籍蒸馏库\` | 19 个书舱（蒸馏原料） |
| `D:\AlcheMvision\工具\e-reverse\` | E-Reverse 侧车（8790） |


---

## 附录 C 读者自查清单

> 读完全文档，您应该能回答下面 25 个问题。答不上来的，回到对应章节重读。

## 服务与拓扑

**1. 系统由哪些服务组成？各自端口、职责、归谁启动？**
→ 第 1 章第 2 节。要点：控制台只管 4 项（8080/3000/8790/隧道），nxf 8823 是工作区级独立服务。

**2. `启动源起.bat` 之后发生了什么？控制台面板端口是多少？**
→ 第 1 章第 3 节、第 13 章第 1 节。要点：清代理环境变量 → `yuanqi_console.py` → 依次拉服务并等端口就绪 → 面板在 17580。

**3. 公网隧道是干什么的？**
→ 第 1 章第 2 节。要点：cloudflared 把本地服务临时暴露成公网 HTTPS，用于移动端真机测试。

## 请求链路

**4. 一次生图请求从浏览器到上游模型商，依次经过哪些层？**
→ 第 1 章第 4 节。要点：前端 → Gin handler → task worker 认领 → 执行器分叉 → protocol 协议层 → 上游 → 落库回写。

**5. 任务失败了会发生什么？媒体找回和任务恢复分别由谁负责？**
→ 第 11 章第 6 节。要点：`task_media_recovery` 按原任务重试交付且不重复计费；`provider_task_recovery` 超时后继续回查。

## 技能体系

**6. 一个内置技能从磁盘到数据库再到 Agent 上下文，经过哪些环节？哪一步算哈希、为什么？**
→ 第 7 章第 5 节。要点：`go:embed` → `EnsureBuiltinSkills()` 解析 frontmatter → 算 SHA-256 → upsert 进 skills 表。算哈希是为了检测技能被改过、防止读混合版本。

**7. Agent 会不会把整本技能书塞进提示词？不会的话靠什么机制？**
→ 第 7 章第 9 节、第 10 章第 3 节。要点：不会。只有带 SkillIDs 时才注册 `skill_search`/`skill_read_file`，快照只含元数据和路径，正文永不内联——渐进披露。

**8. 搜索技能时「卡 4 > 名 3 > 描述 2」是什么意思？为什么这样设计？**
→ 第 10 章第 3 节。要点：按命中位置给分，能力卡权重最高，因为卡是知识细粒度单元，命中它说明真找到了对口知识。

**9. 技能从生产到分发经过哪些环节？三仓之间靠什么保持同步？**
→ 第 7 章第 8 节、第 13 章第 5 节。要点：书籍蒸馏库 → nxf 酿笑坊蒸馏 → judian 投稿 → `backend/builtin/` 落地。同步靠 version + contentHash + 测试钉死 + LF 强制 + presets_check。

**10. `~/.workbuddy/skills/` 和后端 `builtin/` 是什么关系？为什么说是双轨？**
→ 第 7 章第 7 节。要点：两套独立体系，后端代码零引用宿主目录，靠人工镜像同版本——这是已知维护风险。

## 数据库

**11. schema 58 里 55/56/57/58 分别是什么？为什么撞号、怎么解的？**
→ 第 3 章第 4 节、第 6 章第 2.3 节。要点：55/56 是本地电商先占号，57/58 是上游顺延，本地的一字不动。

**12. 迁移带 checksum 是为了防什么？对不上会怎样？**
→ 第 6 章第 2.2 节。要点：防"改了已执行过的迁移"导致账实不符；对不上直接拒绝启动。

**13. SQLite 和 PostgreSQL 怎么切换？WAL 是什么、数据文件在哪？**
→ 第 6 章第 1 节。要点：`CANVAS_DATABASE_DRIVER` + `DATABASE_URL`；WAL 让读写并行；文件在 `.local/data/open_ai_canvas.db`。

## 电商工坊

**14. 一个商品从导入到出图经过哪些状态？哪些状态需要人工介入？**
→ 第 9 章第 3.2 节。要点：draft → queued → running → completed；`review`/`uncertain`/`failed` 需要人工介入。

**15. 「12 段视觉方案编译器」输入什么、输出什么？指纹去重防的是什么？**
→ 第 9 章第 4 节。要点：输入模型 JSON，输出 12 段中文方案；指纹去重防相邻屏雷同。

**16. 出口门禁三步各自做什么？为什么红线词要改写成隐喻而不是直接删除？**
→ 第 9 章第 6 节。要点：剥离 → 通感改写 → 比例拒绝。删除会让画面信息缺失，改写既合规又保留语义。

**17. Agent 改稿工具能碰画布吗？能计费吗？为什么这样限制？**
→ 第 9 章第 10 节。要点：都不能。只读写 `ecommerce_*` 表，改文案不触发模型调用——职责划清，避免误计费和越权。

## 画布与 Agent

**18. 画布有几种节点类型？三层渲染怎么叠？**
→ 第 5 章第 2 节、第 8 章第 4 节。要点：20 种；SVG 连线层最底 → 节点层（Frame 优先）→ 多选包围盒最上。

**19. Agent 运行时是几个进程？Go 和 Node 之间走几条通道？并发上限多少？**
→ 第 10 章。要点：两个进程；三通道（stdin JSON / 本地 HTTP 回调桥 / stdout 行流）；进程闸默认 30、硬上限 64。

**20. 什么情况下 Agent 才会拿到 `skill_search` 工具？**
→ 第 10 章第 3 节。要点：只有请求的 `EnabledSkills` 非空时才注册。

## 版本与生态

**21. 这个仓库和上游是什么关系？tag 的 backup/baseline/absorbed 各自什么用途？**
→ 第 3 章第 1、2 节。要点：fork 自 ddcat-ai，上游只读；backup=合并前备份、baseline=自愈基线、absorbed=吸收完成标记。

**22. 蒸馏链的产物如何进入本系统？**
→ 第 13 章第 5 节。要点：书舱 → nxf 蒸馏 → judian 投稿 → `backend/builtin/` → go:embed 进二进制。物证是影视工坊「-引擎」子技能。

**23. 上游阶段二合并计划是什么、为什么还没合？**
→ 第 3 章第 6 节。要点：画布同步大重构 + 多窗实时光标；暂缓因为上游对 `user-data-sync.ts` 大重构，与我们刚做的锁修复同域，风险不明确。

## 合规与质量

**24. 系统里有哪些内容合规闸门？分别在哪一层？**
→ 第 12 章第 4 节。要点：电商 S5 出口门禁（Go）、E-Reverse 合规改写（Python，同构）、Agent 审批流。

**25. 测试体系怎么保证「改迁移不改数据」和「改技能不改哈希」？**
→ 第 12 章第 6 节。要点：`migrations_test.go` 守版本与身份不变式；`skills_yingshi_builtin_test.go` 钉死技能文件树哈希。

---

## 自测通过标准

- 能不看文档回答 20 题以上 → 主体已掌握
- 能全部回答 → 可以拿这套知识去跟对方技术对话了
- 有 4 个问题答不上来且都在标注「待确认」的章节 → 正常，那 4 项我们自己也还没核实


---

## 附录 D 数据口径与复现

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


---
