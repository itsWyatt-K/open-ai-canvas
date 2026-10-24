# 返工令 B 验收回执（电商工坊 · 阶段 5）

- 本地提交：`f44006b18`（分支 `absorb/upstream-v1.6.5-agent-pi`，20 文件，+1301/-283）
- 后端二进制：`.local/canvas-backend.exe` 已换版（备份 `.local/canvas-backend.exe.bak-before-returnB-*`、`.bak-before-versionfix-*`）
- 验收商品：`bc33eb98160120b8abfb37db531ef7cb`（微信图片_20261017182811_6154_326，抖音 `3:4` + `yingce-image-2.5`，主人授权整组 7 屏真实派发）

---

## 一、比例 → 像素尺寸标准兜底表（必改项 1）

### 代码
- `backend/internal/app/model_capability_defaults.go`：新增 `standardImageSizeFallbackTier("1k")`、`standardImageSizeFallbackTable`（主人指定 8 项）、`standardImageSizeFallbackRatios/Preset/PresetsForRatios`。
- `backend/internal/app/model_capability_validate.go`：
  - `imageSizeDeclaredTiers` 回退为只读 `Quality`/`Resolution`（不再把 `size.values` 里的 `2K`/`4K` 当档位记号）；
  - `fillMissingImageSizePresets` 重写为「缺表必补、不阻断」；
  - `resolveImageTaskSize` 在预设未命中时先走标准兜底表，再退 `openAIImageDefaultPixelSize(ratio,"1k")`；
  - 删除 `preferredImageSizeTier`；错误文案改为提示标准表覆盖范围。
- 关键坑：`normalizeDeclaredImageRatio("21:9")` 会约分成 `7:3`，比对两侧都归一化；`preset.Ratio` 保留表内原始写法（保存路径 `validateImageCapabilityConfig` 逐字校验 `Size.Values`）。

### 真实数据库实测（`ECOMMERCE_REAL_DB` 门控测试）
```
线路：yingce-image-2.5（protocol=openai-image，capability=image）
库内声明 size.values（补表前）：["1:1","16:9","9:16","4:3","3:4","2K","4K"]，无预设表
补表后预设条数：5，默认档位：1k
  预设 1:1  @ 1k → 1024x1024
  预设 16:9 @ 1k → 1280x720
  预设 9:16 @ 1k → 720x1280
  预设 4:3  @ 1k → 1024x768
  预设 3:4  @ 1k → 768x1024      ← 现场故障比例
比例 1:1 → 1024x1024 / 3:4 → 768x1024 / 4:3 → 1024x768 / 9:16 → 720x1280 / 16:9 → 1280x720
--- PASS: TestRealChannelModelSizeResolutionOnRealDB
```

## 二、剥离系统套话 · 提示词双通道（必改项 2）

### 代码
- `ecommerce/platforms.go`：`PlatformSlotBasePrompt` 重写为纯本屏描述（【本屏主题】/【背景规范】/【场景与道具】/【视角与构图】/【光影与色调】），移除【平台】/【视觉方向】/【排版】/【平台规范】等套话；新增 `slotSceneProps`、`slotComposition`、`SlotCopyDirective`、`SlotDispatchGuardrail`；`ComposeSlotFallbackPrompt` 去掉【画面文案】【主体一致性】。
- `app/ecommerce_orchestrator.go`：`ecommerceSlotDraft` 增 `dispatch` 字段；新增 `buildEcommerceDispatchPrompt`、`ecommerceSlotTextMode`；`prepareEcommerceSlot` 每个成功分支同时产出 `draft.prompt`（落库/展示）与 `draft.dispatch`（发模型）；`dispatchEcommerceSlot` 用 `dispatchPrompt` 发任务、纯净 `prompt` 落库。
- 文案排版口径：`copy` 非空且 `textMode !== "none"` → `画面预留干净排版区，清晰呈现文案：「{copy}」`；否则 → `画面纯图无文字，不生成任何文字或水印`。

### 真实数据双通道实测（bc33eb98… 7 屏真实槽位）
以 `hero_main` 为例（落库版 vs 派发版只差最后两段）：

**落库版（`slot.generation_prompt`，前端分镜卡「🎨 画面构图简述」与编辑弹窗「画面描述」同源）**
```
【本屏主题】首屏视觉冲击（强冲击竖构图）· 3:4
【场景与道具】干净的商品拍摄场景，主体与点缀道具层次分明
【视角与构图】中景竖构图，商品与随附内容同框，画面自上而下分层
【光影与色调】柔和主光 + 轻微侧逆光勾勒轮廓，阴影干净，避免硬光与彩色光污染；以产品固有色为主色，搭配中性背景（白/浅灰/米白），点缀色不超过一种
【商品】微信图片_20261017182811_6154_326
【核心卖点】…（商品卖点，截断展示）
```

**派发版（只发往模型，不落库）** = 上面全部内容 **+**
```
画面预留干净排版区，清晰呈现文案：「【实测】控糖出行，一盒安心；免充电锁温，温差自知」
保持主体结构、颜色、比例、材质和可见细节稳定；辅助参考仅用于其对应的场景、姿态或风格，不得覆盖主体特征。采用清晰的主体层级、可信透视、自然光影与真实接触关系。画面不生成文字、价格、水印、虚构品牌或未提供的产品信息；输出干净、可用于商业创作的视觉画面。
```
`--- PASS: TestRealChannelSlotPromptChannelsOnRealDB`（断言：落库版禁含护栏/排版指令，派发版必带两者）

### 关于该商品现存 `generation_prompt` 的说明（重要，不隐瞒）
bc33eb98… 7 屏当前落库文本**仍是返工前旧代码写的污染版**（以「保持主体结构…」开头）。这是 `prepareEcommerceSlot` 第 2 条纪律的必然结果——「库内已有提示词直接沿用，不重新合成、不被空模板覆盖」。**新代码不会自动清洗历史数据**（那会覆盖用户/AI 既有成果）。要让它变干净，需清空该屏「画面描述」后重新策划，或走 AI 策划轨。本次实测派发用的就是这段历史文本，属于旧数据复用，不影响像素换算与派发链路验证。

## 三、前端布局（必改项 3）

| 项 | 状态 | 位置 |
|---|---|---|
| 消灭 `🚀 确认以上 N 屏方案` sticky 悬浮遮挡 | ✅ 移入独立固定底栏 `shrink-0 border-t bg-surface px-6 py-3 z-20` | `web/src/pages/ecommerce/task-detail.tsx` |
| 右侧配置栏默认折叠 | ✅ `configCollapsed` 默认 `true` | `web/src/pages/ecommerce/index.tsx` |
| 去掉「有改动未落库，点上方按钮保存」 | ✅ 改恒显「改动即存即用」自动保存口径 | `web/src/pages/ecommerce/config-panel.tsx` |
| 网格 `grid-cols-1 md:grid-cols-2 xl:grid-cols-3` + `min-w-[240px]` + 文案自适应高度 | ✅ 网格已改；卡片用 `min-w-0 overflow-hidden`（固定 `min-w-[240px]` 会在 md 双列下撑破容器造成横向溢出，故用 `min-w-0` 让文案换行自适应）；去掉 `line-clamp-3` 行数截断 | 同上 |
| Header 拆两行，商品名完整显示 ≥20 字符 | ✅ 第一行面包屑+完整商品名（`break-words`，不截断）+状态/平台/轮次；第二行操作按钮组+「⚙️ 模型与尺寸设置」 | 同上 |
| 第 1/2 步已生成/失败/完成态默认全折叠 | ✅ 按状态决定：draft 展开看向导，其余折叠为摘要条 | 同上 |
| 失败横幅附首条具体原因 | ✅ `有 N 屏未生成成功（原因：xxx）`，多屏时逐条列原因 | 同上 |
| 「重新生成失败项」去蓝色勾选小方块，只留干净刷新图标 | ✅ emoji 移除，图标统一为 antd `ReloadOutlined` | 同上 |
| 编辑弹窗副标题英文 `pending`/`draft` → 中文 | ✅ 走 `ECOMMERCE_SLOT_STATUS_LABELS` | `web/src/pages/ecommerce/slot-editor-dialog.tsx` |

## 四、真实生图结果（验收回执核心）

商品 `bc33eb98160120b8abfb37db531ef7cb`，抖音 `3:4` + `yingce-image-2.5`（系统渠道 `CHANNEL_000016`），**7 屏全部 completed**：

| 槽位 | 标题 | 版本 | 产物资源 | 尺寸 | 大小 |
|---|---|---|---|---|---|
| hero_main | 首屏视觉冲击 | v2 | `0ae2b0609e2ca7b4ea06f75ac8826f93` | **768x1024** | 1,329,068 B |
| hero_benefit | 痛点强对比 | v2 | `771ebcc06f3e6d4a2256f77de669702d` | **768x1024** | 845,644 B |
| hero_scene | 直播利益点 | v3 | `6a8c252a19488c8fa5359e597ad25ca3` | **768x1024** | 61,099 B |
| detail_hero | 痛点引入 | v3 | `be5a1ba6f6902472a6e271ed7e49820a` | **768x1024** | 67,673 B |
| detail_macro | 核心材质/科技 | v2 | `ac99b5458325ef184f1e8c7b7082ad38` | **768x1024** | 1,104,686 B |
| detail_spec | 场景体验 | v3 | `982ac5259f7d6e85bb757c34989ef989` | **768x1024** | 1,007,703 B |
| detail_package | 规格清单 | v3 | `2c12b7cb5497c7a4538cfc8e1c23bad7` | **768x1024** | 901,031 B |

7/7 张真实产物图均为 **768×1024**，与标准兜底表 `3:4 → 768x1024` 逐项一致；`当前线路缺少像素尺寸换算表` 报错彻底消失。

### 过程中另外定位并修复的两个阻断性 bug（均在验收现场暴露）
1. **重派 500**：`UNIQUE constraint failed: ecommerce_slot_versions.slot_id, version`。库里存在「v1 版本行已写入、`current_version` 仍为 0」的历史失败态，`current_version+1` 撞唯一约束。
   → 新增 `repository.MaxEcommerceSlotVersion` + `Service.nextEcommerceSlotVersion`（取 `max(current_version, 版本表最大值)+1`），编排器 `dispatchEcommerceSlot` 与 `RegenerateEcommerceSlot` 两处都改；回归测试 `TestNextEcommerceSlotVersionSkipsExistingRows`（PASS）。
2. **重派不带渠道/模型**：`RegenerateEcommerceSlot` 的 `CreateTask` 既无 `Model` 也无 `config.channelId`，等于让后端猜模型。
   → 新增 `EcommerceSlotRegenerateOptions{ChannelID,Model}`（service 别名同步补），前端从配置栏解析后显式下发；为空才回退商品派发快照，仍为空则明确报错（私有渠道 `channelId` 允许为空，由后端按 baseUrl 兜底，不挡死）。

### 一个非代码问题的如实记录
首轮 5 屏派发中有 2 屏报 `任务结果保存失败`，根因是上游 CDN `download.xmimage2.cc.cd` 抽风（`read tcp … wsarecv: An existing connection was forcibly closed by the remote host`，`api_call_logs` 有 10 条 `结果下载失败` 记录）。同批任务重试后即成功——属于上游可用性问题，非本次改动引入，重试逻辑本身工作正常。

## 五、构建与测试

| 检查 | 结果 |
|---|---|
| `CGO_ENABLED=0 go build ./internal/...` | ✅ 通过 |
| `go build -o .local/canvas-backend.exe ./cmd/server` | ✅ 通过（109,350,912 B，已上线运行） |
| `go vet ./internal/{app,ecommerce,handler,repository,service}/...` | ✅ 通过 |
| `go test ./internal/app/ -run 'ImageSize\|RatioOnly\|LegacyRatio\|StandardImageSize\|Ecommerce\|Slot\|Platform\|Dispatch\|Prompt\|RealChannel'` | ✅ ok 75.5s |
| `go test ./internal/ecommerce/...` | ✅ ok |
| `ECOMMERCE_REAL_DB=… go test -run TestRealChannel…` | ✅ 2/2 PASS |
| `./node_modules/.bin/tsc --noEmit` | ✅ 通过（0 error） |
| `./node_modules/.bin/vite build` | ✅ built in 32.28s（沙箱拦截清空 `dist/assets` 的 1635 个文件，改输出到 `dist-verify` 验证后已清理） |
| 全量 `go test ./internal/{app,ecommerce,handler,repository,service}/...` | ⚠️ 9 个 FAIL，全部为环境限制 |

**全量测试 9 个 FAIL 的归因（非回归）**：全部是 `C:\Users\khy\AppData\Local\Temp` 被本机安全中心锁定/拒绝所致——
`sync …\Temp\…: Access is denied`、`TempDir RemoveAll cleanup: unlinkat … The process cannot access the file because it is being used by another process`、`database is locked (SQLITE_BUSY)`、`error_type=*fs.PathError`。
失败用例集中在 `admin_channel_test.go` / `appearance_updates_test.go` / `appearance_routes_test.go` / `cloud_agent_*` / `gmail` / `payment_export_test.go`，**这些文件本轮一行未改**（`git diff --name-only` 已核对）。

## 六、本轮改动文件清单（20 个）

后端（14）：
`app/ecommerce_orchestrator.go`、`app/ecommerce_slots.go`、`app/model_capability.go`、`app/model_capability_defaults.go`、`app/model_capability_validate.go`、`app/provider_style.go`、`app/image_size_presets_test.go`、`app/ecommerce_slot_version_test.go`(新)、`app/real_channel_size_test.go`(新)、`app/real_channel_slot_prompt_test.go`(新)、`ecommerce/platforms.go`、`ecommerce/platforms_test.go`、`handler/ecommerce.go`、`repository/ecommerce.go`、`service/aliases_types.go`

前端（6）：
`pages/ecommerce/task-detail.tsx`、`pages/ecommerce/config-panel.tsx`、`pages/ecommerce/index.tsx`、`pages/ecommerce/slot-editor-dialog.tsx`、`services/api/ecommerce.ts`

## 七、遗留事项（建议下一轮处理）

1. **bc33eb98… 的历史污染提示词**：如上文所述不会自动清洗。若主人希望这批旧数据也变干净，需要一次显式的「重新策划」（清空该屏画面描述后走 AI 策划轨，或切平台重建）。
2. **该商品的「核心卖点」字段被灌入了一整份 markdown 参数报告**（`【核心卖点】` 段长达数千字，含表格）。它会原样进入生图提示词，既浪费 token 又可能干扰出图。建议在导入/编辑环节对 `sellingPoints` 做长度与格式收敛。
3. **平台 5 并发上限**：一组 7 屏一次确认必然有 2 屏顺延。当前靠对账补派，但商品状态为 `failed` 时 `continueEcommerceDispatch` 不工作（只补 running/queued）。可考虑让失败态也参与顺延补派。
4. **上游 CDN `download.xmimage2.cc.cd` 可用性不稳**：建议给结果下载加指数退避重试（当前重试已能救回，但耗时长达数分钟）。
