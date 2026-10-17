# 电商分屏策划（移植自 pr(1)）

## 来源
`一键详情pr(1)/一键详情pr/源码/web/src/lib/canvas/commerce-{detail,replica}-plan.ts`

## 移植范围（仅零耦合纯函数）
- `commerce-detail-plan.ts`：详情页策划编译 —— 严格 JSON 校验 + **视觉方案指纹去重** + 编译成 12 段 prompt（超长报错不截断）
- `commerce-replica-plan.ts`：竞品复刻规划 —— **按 screenId/templateNodeId 稳定身份绑定**（不信任响应顺序）+ 编译成 19 段 prompt

## 未移植（依赖画布/存储设施，留待阶段 3）
- `commerce-pricing.ts`：依赖 `canvas-project-generation` / `model-pricing` 等画布计费链
- `commerce-image-merge.ts`：依赖 `image-storage` 与 `CanvasNodeData`
- `use-commerce-workflow.ts`：依赖画布 nodes/connections/batchTable
- `commerce-screen-editor.tsx` / `commerce-result-board.tsx`：依赖画布节点

上述未移植项的等价能力已由电商页自身实现（结果看板见 `../slot-card.tsx`，编辑器见 `../slot-editor-dialog.tsx`）。

## 使用约束
- 策划产物只填 `prompt`；`promptOverride` 是人工完整覆盖，**不得被策划回填覆盖**。
- 视觉方案重复时编译报错，不做自动去重后继续（pr(1) 纪律：不截断、不静默修复）。
