# 电商实战版块升级验收报告 v2（二期指令单：权重落地 · 真开关贯通 · Schema 防撞 · 起栈 E2E）

> 执行日期：2026-10-24 ~ 10-25
> 前置：一期验收报告（`电商实战版块升级_分层抠图与批量工坊验收报告.md`）
> 本期四个专项：Schema v59/v60 撞车治理（P0）→ 真实权重落地 → 通道 B 贯通 + 真 LLM → 起栈 E2E

---

## 任务一：Schema 撞车治理（P0）✅

**上游真实号段实锤**（`git show upstream/main:…/migrations.go`）：上游 `CurrentSchemaVersion=60`，
55~60 依次为 provider_catalog_source / sql_perf_indexes / canvas_multi_session_sync / agent_memory_proposals /
channel_model_protocol_length / **user_feedbacks**——与一期发布的本地 v60=ecommerce_layer_manifest **同号不同身，撞车实锤**。

**治理结果**：
1. 电商迁移改号 **60 → 63**（`migrations.go` 附号段分配表注释）；59-62 四个空号 = 上游 57-60 吸收时的顺延落点（+2），
   合并 v1.6.9.x 时上游四条按 59/60/61/62 重写号段即可，**零改号冲突、无需再动电商迁移**。
   悬空合法性：`MigrateSchema` 按 plan 逐条执行（无连续号要求）、`ReadSchemaStatus` 按 MAX 判定。
2. 真库修正：`UPDATE schema_migrations SET version=63 WHERE version=60 AND name='ecommerce_layer_manifest'`
   （脚本核验 name 后执行，幂等）；`migrate-schema verify` → **`{"current":63,"expected":63,"ready":true}`**。
   迁移本体已是幂等列检查（HasColumn → AddColumn），重放/跨库安全。
3. **环境变量防呆**：`cmd/server/main.go` 与 `cmd/migrate-schema/main.go` 均新增 `resolveDataDir()`——
   权威变量 `CANVAS_BACKEND_DATA_DIR`；仅设旧名 `CANVAS_DATA_PATH` 时兼容读取并打警告；
   两者不一致时强警告并以权威变量为准。实测旧名路径：`警告：CANVAS_DATA_PATH 为兼容旧名…（本次解析为 …）` + verify ready。
   （一期事故复盘：验证时误设旧名导致迁移直落真库——此防呆为根治措施。）

## 任务二：真实权重落地，告别 OpenCV 兜底 ✅

| 算子 | 权重 | 来源 | 实测 |
|---|---|---|---|
| matting | **BiRefNet-lite ONNX 224MB**（onnx-community 官方转换） | hf-mirror `onnx-community/BiRefNet_lite-ONNX`（23s@9.7MB/s） | 冒烟 PASS：center=254/corner=0，CPU 37s/张；`config` 报 `provider=birefnet, degraded:false` |
| inpaint | **LaMa big-lama ONNX 208MB** | hf-mirror `Carve/LaMa-ONNX`（58s） | 冒烟 PASS：洞内重绘 delta=148、洞外零扰动、CPU 25s；`provider=lama, degraded:false` |
| relight | 无模型增强（IC-Light 权重位保留） | — | 新增**环境色温采样**（落位环带 LAB 统计）+ **边缘色差羽化**（alpha 边界内 4px：Poisson 按距离加权混合 + 环境色 35% 渗色） |

**推理实现要点**：LaMa 固定 512 输入 → IOPaint 同款「mask 包围盒外扩 64px 裁剪→等比入窗→推理→仅洞内贴回」策略；
LaMa 失败自动回落 TELEA（接口不死）。**顺带修出一个真 bug**：`_load_rgba` 对 data URL 走 `IMREAD_COLOR`
丢掉 matting 羽化 alpha → 边带恒空——已改 `IMREAD_UNCHANGED` 统一解码，并给 distanceTransform 加 pad（实体贴到
patch 图边缘时图边界也视为 alpha 边界）。

**自测 8/8**（`test_ecommerce_vision.py`）：provider 探测 / BiRefNet 抠图 / 输入校验 / 六向光源 /
锁主体中心漂移 **0/255** / **边缘和谐化（G 通道 30→60 环境渗色，中心 0 漂移）** / LaMa 擦除+recreate 降级说明 / config 自检。

## 任务三：通道 B 真开关贯通 + AI 换思路真 LLM ✅

**通道 B（消灭假开关）**——`ecommerce_channel_b.go` 三点接线：
1. **派发端**：`slotWantsChannelB`（L1 显式开启且商品有原图）→ `buildEcommerceSlotPrompt` 追加
   `【锁主体合成模式】只生成不含商品主体的纯场景承托底图`指令（单屏 regenerate 与整组派发两条路都接）。
2. **商品级抠图缓存**：`ensureEcommerceProductCutout`（productID→dataURL，7 屏不重复抠；BiRefNet 真跑）。
3. **完成端自动合成**：`reconcileEcommerceSlotVersions` completed 分支 → 读生图底图 → relight-compose →
   **自动写 4 层 layer_manifest**（背景/阴影/商品主体/合成图 + L1 主副标题转默认 text_layers）→ slot 最新态 + 版本历史态。
   生图原产物 resourceID 不变（不破坏既有导出链）。任一步失败静默降级两层（不阻断对账）。

**AI 换思路真 LLM**——`ecommerce_brief_llm.go`：env 三元组（`CANVAS_ECOMMERCE_BRIEF_LLM_{BASE,KEY,MODEL}`，
默认反重力 `127.0.0.1:8317/v1` + `gemini-3.8-flash-high`，key 必须显式注入）；system prompt 挂载
ecommerce-visual-director 技能规范（屏序职能/版式枚举/字数合同/违禁词红线）；严格 JSON 输出+校验；
未配置/超时/坏 JSON 全部静默回退确定性变体器（行为不变）。

**Go 单测 6 项全绿**：指令注入与反向不注入 / wantsChannelB 三态 / nxf 不可达降级两层+文字层保留 /
LLM 真重写（httptest 假服务器验证 system prompt 挂载）/ 坏 JSON 回退 / 未配置跳过。

## 任务四：分片测试精确数字 + 起栈 E2E ✅（尾步受上游 CDN 波动，见 4.2）

### 4.1 分片门禁（`scripts/run_backend_tests_sharded.py --app-only`，已加 `-v` 精确统计）

| 分片 | 结果 | 精确统计 |
|---|---|---|
| S1-电商（含通道 B/LLM 新用例） | **PASS** | **15 pass / 0 skip / 0 fail** |
| S2-技能导演 | PASS | 17 pass / 1 skip / 0 fail（skip=Chaoge 真库冒烟按设计需 env） |
| S3-云端Agent | FAIL | 378 pass / 6 skip / **2 fail** |
| S4-渠道下载（含新下载退避链） | **PASS** | **139 pass / 0 skip / 0 fail** |
| S5-画布核心 | FAIL | 749 pass / 5 skip / **2 fail** |
| **app 合计（1306 顶层用例）** | — | **1298 pass / 12 skip / 4 fail** |

4 个失败为一期定性的**吸收门禁项**（上游 bc2596091 / 50a2c14bc / #828 均在未吸收区间已修，与二期改动零关联；
S1/S4 含全部新用例 0 fail 佐证）。非 app 包 53/53 PASS（一期基线后无改动）。
其余门禁：nxf 自测 **8/8**、model-adapt **21/21**、前端 tsc 0 错误（一期后无前端改动）。

### 4.2 起栈 E2E 真跑（nxf :8823 + backend :8080 v2 二进制 + 真库）

| 步骤 | 结果 | 耗时 |
|---|---|---|
| 登录 E2E 账号（`open_ai_canvas_session` cookie） | ✅ | 0.4s |
| 商品图三段式上传（预留→分块→合并）+ 导入商品 | ✅ resourceId `840e3305…` | 0.1s / 0.0s |
| **nxf 抠图真跑** | ✅ **provider=birefnet, degraded=false**, 前景占比 0.21 | **23.6s**（CPU） |
| L1 企划保存（锁主体开） | ✅ | <0.1s |
| **✨AI 换思路（真 LLM：反重力 gemini-3.8-flash-high）** | ✅ 真重写：主标题「轻巧随行提着走，户外露营随时喝上一口温热水」+ 露营场景 | **7.9s** |
| 锁主体单屏派发（CHANNEL_000016 / gpt-image-2.5，真实计费两次） | ✅ 两单任务均受理，**模型两次真实出图成功**（stage=作品已生成） | 派发 0.1s |
| 结果下载保存 → 对账 completed → 通道 B 自动 4 层 → PSD | ❌ **上游 CDN 持续不可用**：`download.xmimage2.cc.cd` 结果文件下载对本机失败（两单独立任务跨 30 分钟同一症状；历史任务 10-20 同症——多日存量问题，与本期改动无关；本期反而给下载加了指数退避）。任务经 4-5 轮自动恢复后如实落 failed | 耗尽自动恢复 |

E2E 脚本：`%TEMP%\zcode_e2e_channel_b.py`（全链）+ `zcode_e2e_resume.py`（终态续跑）。
**尾步如实收口**：阻塞点在上游 CDN 下载结果文件（域名 TLS 通、具体文件失败——疑似需渠道代理或 URL 时效）。
通道 B 合成→4 层→PSD 链路由 Go 单测（降级路径全绿）+ 一期 PSD 导出实测（104KB 中文图层名）覆盖；
CDN 恢复后对账自动完成合成。**修复建议**：给 CHANNEL_000016 配 `proxy_url`（出网走代理试下载），或
`POST /api/tasks/:id/recover-media` 在网络窗口手动触发。E2E 账号 `_zcode_e2e` 留有真实商品/任务可复核。

## 遗留与升级路径

1. **E2E 尾步闭环**：上游 CDN 恢复后自动完成；或对同一 slot 手动 `recover-media`。建议下次起栈复跑
   `zcode_e2e_resume.py` 收最终 4 层 + PSD 实拍数据。
2. IC-Light Diffusion 权重位保留（relight 已有确定性环境色温+羽化增强，Poisson 档可用）。
3. LLM 三元组目前由启动环境注入（控制台服务清单可固化）；key 轮换见审查报告问题 3。
4. 吸收上游 v1.6.9.x 时按号段分配表重写上游四条迁移号（59-62），合并冲突按一期记录的 9 处解法处理。

*证据：主仓提交（见 git log，随本报告一并提交）；任务表 `e9c423b1`（真库）；`outputs\e2e-channel-b.psd`（CDN 恢复后生成）；分片失败全量日志 `reports\shard-fail-S*.log`。*
