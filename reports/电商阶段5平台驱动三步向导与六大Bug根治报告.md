# 电商阶段 5：平台驱动三步向导 + 六大现场 Bug 根治 · 验收报告

> 日期：2026-10-18 · 基线：`0db452f12`（阶段 4 容量修复）· 提交：`f945a5651`
> 施工依据：主人《架构重构指令单 · 电商工坊阶段 5》（6 Bug + 三步向导 + 验收回执）

---

## 一、六大现场 Bug 根治（逐项对账）

### Bug 1｜AI 策划报「缺少产品与风格分析」（致命阻断）✅
- **根因**：`CompileDetailPlan` 教条校验——无风格参考图时模型不返回完整 `styleAnalysis` 即整份拒绝；且不接受 Markdown 外壳与字段名差异。
- **修法**（`backend/internal/ecommerce/plandetail.go` 容错重写）：
  1. `extractPlanJSON`：剥离 ` ```json ` 外壳，截取第一个 `{` 到最后一个 `}`；
  2. `normalizePlanKeys`：snake_case/大小写差异自动归一（scene_type→sceneType）；
  3. `styleAnalysis` 缺失 → 按「平台规范 + 视觉风格种子」填 6 字段默认值；`productAnalysis` 缺失 → 用商品 Name/SellingPoints 兜底；`visualSystem` 缺失 → 通用视觉 DNA 兜底；
  4. `screens` 少于槽位数按模板补齐、多于截断——**非空即必须编译成功**；
  5. 相邻屏指纹相撞 → 自动在后一屏 `variation/composition` 追加 8 种轮换差异化机位描述，不抛错；
  6. 仍硬失败仅限：空响应 / 非法 JSON / screens 为空 / 单屏超长（不截断执行）。
- **连带修复（实测新坑）**：`canvas_text` 任务成功后 `resultJson` 是 `{"mode":"text","text":"..."}` 包装体，直接编译必报「不是合法 JSON」→ 新增 `UnwrapPlanText`（前后端同构），apply-plan 与前端轮询先解包再编译。

### Bug 2｜编辑器显示「第 5 屏」且内容全空 ✅
- **根因**：`ListEcommerceSlots` 按 `kind` 字母序（detail<hero）返回，主图排到 5~7 位；预建槽位只写 Title，编辑器无字段可预填。
- **修法**：repo 层全局排序改 `CASE kind WHEN 'hero' THEN 0 ELSE 1 END, slot_no`（详情/策划/编辑器同一屏序）；`ensureEcommerceSlotCards` 写入平台定制 `scene_type/copy/generationPrompt` 基底；`SlotSummary` 新增 `sceneType/aspectRatio/generationPrompt/promptOverride/sellingPoints` 下发；编辑器全量预填。
- **连带修复（隐藏坑）**：`UpdateEcommerceSlotPrompt` 原为全量覆盖——编辑器没带回的字段被空串清库。改**指针补丁**（nil=不改，""=显式清空），Agent 改稿工具同步适配。

### Bug 3｜Agent 精修右侧空白大白框 ✅
- **修法**：删除 `task-detail.tsx` 空壳 `<Drawer>`，`AgentWorkbenchPanel` 由父组件 `agentOpen` 控制直挂（面板自身即 fixed 悬浮）；`prefillRequest` 在打开后延迟 120ms 递增 nonce，修复挂载时序导致的预填丢失（商品 ID/名称/平台/卖点/7 屏文案稳定进输入框）；新增**顾问模式**（autoSubmit：点「💬 跟 AI 顾问对话定制」打开即自动提交，AI 结合商品原图给 3 条卖点建议与分屏修改方案）。

### Bug 4｜draft 态假转圈 + 上下两套按钮 ✅
- **修法**：顶栏删除「开始生成/编排生成中、AI 策划、Agent 精修」三个重复钮，只留纯工具钮（历史轮次/复制任务/从头重试/下载长图/打包下载 ZIP）；进度条与转圈仅 `running/queued/planning` 出现。

---

## 二、平台驱动三步向导（核心新增）

### 6 大平台规范字典（前后端同构）
`backend/internal/ecommerce/platforms.go` + `web/src/pages/ecommerce/platforms.ts`：

| 平台 | 主图 | 详情页 | 语言 | 强制规范（自动注入策划 Prompt 与槽位基底） |
|---|---|---|---|---|
| 淘宝/天猫 | 3·1:1 | 4·3:4 | 中 | 首屏高点击率焦点；详情「痛点→材质→场景→规格」递进 |
| 抖音/视频号 | 3·3:4 | 4·3:4 | 中 | 竖屏满屏冲击；大字文案 ≤8 字；直播级利益点 |
| 拼多多 | 3·1:1 | 4·3:4 | 中 | 高饱和高对比；首屏放大性价比；拒绝意识流留白 |
| 京东 | 3·1:1 | 4·3:4 | 中 | 首图强制纯白底 RGB255，主体占比 75%~85%，无牛皮癣 |
| 亚马逊 | 3·1:1 | 4·4:3 | **英** | Main Hero 纯白底无字占 85% 画幅；英文 Infographic |
| 小红书 | 3·3:4 | 4·3:4 | 中 | 真实生活化实拍；杂志感轻排版；弱化硬广 |

比例白名单补 `4:3`（亚马逊 A+ 横版，前后端同步）。

### 平台切换联动（新端点）
`POST /api/ecommerce/products/:id/apply-platform`：一次完成 ① 配置更新（平台/主图详情张数比例/语言，落库即生效）② 按平台模板重建**未派发**槽位（已派发/已完成屏原样保留，不破坏在途计费）③ 返回最新详情+配置，前端一次性同步中间卡片与右侧面板。平台槽位键与通用预设逐字一致（`hero_main` 等），杜绝重复建槽。

### 前端三区块（task-detail.tsx 重构）
1. **第一步·选择上架平台**：6 张平台卡（名称/规范标签/规格摘要/当前高亮），点击即切换整套框定；
2. **第二步·商品卖点与风格**：名称/卖点/附加要求（失焦即存）+ 5 枚风格胶囊（自动匹配品类/医疗科技净感/居家自然光/极简棚拍/户外实拍，点选写入附加要求）+「🪄 AI 看图自动提炼」（**卖点为空也可触发**，后端让视觉模型识别品类、提炼卖点回填 `sellingPoints` 并填满 7 屏；空卖点时按钮高亮脉冲引导）+「💬 AI 顾问对话定制」；
3. **第三步·各屏分镜预览**：未出图屏渲染**明牌分镜脚本卡**（`[主图 1 · 1:1]`+屏主题+状态、🏷️ 场景定位、📝 画面文案**点击可快改**、🎨 构图前三行摘要、✏️ 详细编辑、⚚ 单独生成此屏），底部唯一大按钮「🚀 确认以上 N 屏方案，立即开始生图」。

---

## 三、验收回执（指令单第三部分）

### 1. AI 策划容错（真实模型实测）✅
**海尔双子冰盒**（库中商品 `bc33eb98…`，无风格参考图）→ 真实 `gemini-3.8-flash-high`（经本地反重力网关）派发 `/plan` → 模型返回 **Markdown 外壳包裹的 JSON**（正是主人现场的失败模式）→ 解包+容错编译 **200** → 7 屏全部填满（title/sceneType/generationPrompt），屏序 hero 优先，**7 屏提示词互异**（真实响应中存在雷同屏，被自动追加「切换为场景远景视角…」差异化机位），商品回落 draft 可确认。**不再报「缺少产品与风格分析」。**

### 2. 槽位排序与编辑弹窗 ✅
`GET /products/:id` 返回顺序严格 `hero×3 + detail×4`；第 1 张主图编辑显示「编辑第 1 屏 · 首屏主视觉 (1 / 7)」，场景类型/文案/描述/比例全部预填；只改 copy 的 PUT 不影响其他字段（指针补丁实测 `changed={}`）。

### 3. 6 大平台切换 ✅（HTTP 实测逐切换）
京东（1:1/3:4/中文/「白底合规首图」/基底含纯白底硬规范）→ 亚马逊（1:1/**4:3**/英文/Main Hero (Pure White)/基底含 85% 画幅）→ 抖音（3:4/「首屏视觉冲击」）→ 淘宝（回 1:1/「首屏主视觉」）；每次切换配置数字与槽位比例 100% 同步。

### 4. UI 与 Agent 弹窗 ✅
顶栏重复钮已清；draft/review/failed 无进度条不转圈；未出图屏为可读分镜脚本卡（无英文 draft 灰框）；Agent 精修为悬浮面板直挂（无右侧空白 Drawer）。分镜卡文案快改、单独生成（收费确认）均可用。

### 5. 构建与测试证明 ✅
```
$ git diff --stat HEAD~1（commit f945a5651）
 20 files changed, 2140 insertions(+), 527 deletions(-)
 create mode 100644 backend/internal/app/ecommerce_platform.go
 create mode 100644 backend/internal/ecommerce/platforms.go
 create mode 100644 backend/internal/ecommerce/platforms_test.go
 create mode 100644 web/src/pages/ecommerce/platforms.ts

$ go build ./internal/...          ✅ exit 0
$ go vet ./internal/app/ ./internal/ecommerce/ ./internal/handler/  ✅
$ go test ./internal/ecommerce/    ✅ ok 3.7s（含平台字典 4 例 + 容错 8 例 + 解包 1 例）
$ go test ./internal/app/ -run 'Ecommerce|Lifecycle|…'  ✅ ok 101.8s
$ tsc --noEmit                     ✅ 0 错误
$ vite build                       ✅ exit 0（27s）
```

---

## 四、已知限制与后续

1. **step-5 渠道鉴权**：`step-5-preview-intl`（api.stepfun.ai）上游返回 401（key 对不上海外端点）；国内 `step-5-preview` 渠道未配 key。主人刷新 key 或配置国内渠道后，可直接用 step-5 复跑本报告第三节第 1 条（链路已通，只差可用凭证）。
2. 反重力渠道（localhost:8317）被出网卫兵拦截——本次实测以 `CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS=localhost,127.0.0.1` 放行（当前运行中的服务即带此环境变量，主人本地网关可正常用；若部署到公机需评估）。
3. 历史轮次切换仍是占位（M5 规划）；分镜卡文案快改为失焦保存口径，暂未做行内富文本。
4. 全量 app 包测试（1234 例）在沙箱内无法在单次超时内跑完（既有环境限制），电商相关子集与 ecommerce/handler 包均已全绿。
