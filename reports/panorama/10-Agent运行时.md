# 10 Agent 运行时

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
