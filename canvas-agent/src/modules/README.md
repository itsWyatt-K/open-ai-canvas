# canvas-agent/src/modules —— 出口门禁与金标任务集

> 来源：《本地影策（Open-AI-Canvas）技能体系架构与多模态创作工业化演化方案报告》
> 评审回复书（智谱 GLM · 2026-09-26）P0 / P1 落地包，并入本仓。

## 目录

| 目录 | 来源 | 内容 |
|---|---|---|
| `exit-gates/` | P0 落地包 `p0-guardrails` | S5 禁词确定性过滤器 + S4 180° 轴线几何校验器 + 门禁编排与 ask_user 载荷生成 + `yingce-gate-hooks.ts` 挂点接线层 + `rules/guardrail-rules.yaml` L0 规则对象 |
| `golden-tasks/` | P1 落地包 `yingce-golden-tasks` | 16 条金标任务（含 3 条哨兵负向任务）+ 确定性检查引擎 + 配对评审（位置轮换对消）+ 晋级决策（达尔文棘轮下游回归锚点） |

## 运行

```bash
npm install     # zod / tsx / typescript（pnpm-lock.yaml 为上游产物，保持不动）
npm test        # 门禁 29 + 金标 24 + 挂点接线 7 = 60 项测试
npm run typecheck
```

## 挂点（评审回复书 6.3 五步接入）

1. `src/modules/exit-gates/` 五个文件已并入本仓（本目录即第 1 步成果）；
2. S5 挂点：`serverGenerateShot` 携带 `compiledPrompt` 时，提交前自动过 `filterJunkWords`；
3. S4 挂点：`serverGenerateShot` 携带 `storyboard` 时，提交前自动过 `validateStoryboardAxis`；
   web 端 Director 流程调用 `validateDirectorAxis`（director-adapter.ts）；
4. 拦截消息 = `GateBlockedError.message`（`formatAskUserMessage` 产物），走既有 ask_user 通道；
5. 分镜技能侧要求产出结构化 JSON（`storyboardSchema` 契约），九列表由 JSON 派生。

## 已知边界（诚实声明）

- 画幅冲突规则会把无前导零的 12:30 式时间误认为画幅候选；仅当出现第二个不同值时才升级为冲突；
- `rules/guardrail-rules.yaml` 与 TS 规则为人工双源同步，后续应由 YAML 生成 TS；
- 镜像修复不改变景别/焦段语义，过轴后构图内容仍需 S4 语义层复核；
- 本仓快照中 `src/yingce-llm.ts`、`src/project-context.ts` 及两个遗留测试依赖的
  `canvas-session.ts` / `schemas.ts` / `types.js` 等模块不在快照内（上游 fragment 既有状态），
  故 tsconfig 与 test 脚本只覆盖 modules 与门禁接线相关文件；
- 后端 Go 侧 S5 编译出口门禁（dreamina 提交函数）为后续项，本仓先行落地 agent 侧前置门禁。
