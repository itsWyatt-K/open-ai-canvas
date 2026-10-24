# 附录 B 路径索引

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
