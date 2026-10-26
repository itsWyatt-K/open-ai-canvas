---
record_schema: "1.4"
record_type: "full_ledger"
skill_version: "3.24.0-yuanqi.1"
project_title: ""
script_file: ""
script_version: ""
current_stage: "P0"
current_scene: ""
current_source_boundary: ""
production_route: "A_full"
batch_material_mode: "待确认"
voice_mode: "reference_or_generated"
platform: "待确认"
model_version: "待确认"
aspect_ratio: "待确认"
updated_at: ""
---

# 项目资产台账

## 当前摘要

- 当前阶段与确认依据：
- 已确认事实：
- 当前场景与原文位置：
- 唯一下一步：
- 视频执行方式及选择依据（CLI自动执行/不接入原流程；独立于平台和A/B/C）：

## 创作基准

- 定稿剧本、P0A十项解析与情绪曲线：
- P0S风格及参考职责、P1媒介/造型/光色/表演基准与确认依据：
- P1音乐圣经（实际内容/路径、版本、确认依据；曲风、乐器分工、动机、节奏、频段动态、留白禁用声音、P0A的BGM重点映射）：
- 视频输出画幅与版本/平台（不决定草图版式）：以前置字段及execution为准，不重复询问。
- 全片时长中心估计、浮动与依据：
- 声音政策：按剧情保留人声；仅实际采用的已确认声音参考参与绑定，其余由Seedance生成。P2S不论有无干声都友好提示；主角/重要常驻角色只作可选建议，路人无需专门准备。提示及继续/等待决定记在制作备注，不将干声缺失列为阻塞项。
- 环境声、对白与同步音效基准：

## 角色资产与人物信息版

| 稳定ID | 角色/状态 | 依赖 | 9:16稿状态 | 信息版状态/明确跳过依据 | 文件与用户确认 |
|---|---|---|---|---|---|

## 道具与场景资产

| 稳定ID | 类别/名称 | 必要性与依赖 | 当前决定 | 文件与用户确认 |
|---|---|---|---|---|

## 独立预演进度（A/B/C按请求启用，未调用留空）

- 触发来源、剧本版本、全部场景索引与原文依据：
- 本批所选场景、明确选择来源、实际资产及用途：
- 逐图版本/路径/展示位置/确认来源、待修改或推定布局：
- 模型依赖图纸、工程/入口、实际验证、确认及回填状态：
- 当前待答项与下一步、原路线/阶段/资产或视频单元/待答版本及返回位置：

实际图纸确认后才建模；C不为此补全套资产。有效旧图纸与模型可复用，不把提示词确认记为图纸确认。

## 场景彩图制作进度（A/B按需，C不填）

- 场景执行责任/渠道、已告知模型设置、画布连接状态：
- 各场景建模/局部建模/直接出图/复用选择与依据、连接点及楼层状态：
- 适用的布局图与有基础灯光材质的无家具预演项目、房间顺序、代表母板：
- 必要补图及机位选择、家具回填选择、唯一下一步：

| 房间/机位 | 当前成果与版本 | 状态及确认依据 | 实际文件/原生像素（收到才填） | 参考及线稿依赖（首图无） |
|---|---|---|---|---|

B外部采用声明、提示词交付、实际验图和本地归档分开；回传建议不阻塞。仅外部制作不虚构文件。

## 声音准备

图片、音频、视频全量扫描后合并确认。缺声音参考只提醒，当前人声保留并随视频生成；execution.unit.required_voices记录剧情需求，不要求本地文件齐备。

| 角色/来源 | 当前需要/后续准备 | 实际文件/上传项 | 文件职责 | 用户指认 |
|---|---|---|---|---|

## 当前场景故事节点

| 原文锚点 | 必须完成内容 | 提示词进度 | 实际采用依据 |
|---|---|---|---|

## 当前AI导演分析

- 完整对应原文与单元边界：
- 综合估时：对白/动作依赖/识别时间：
- 一句话导演意图、视觉节拍、首帧与结束：
- 必要空间关系和镜头执行信息：
- 宫格提案版本、目标修改镜号及实际展示所在聊天/消息或时间位置（文件链接不等于已展示）：
- 草图实际画格数、行列、整图比例和留白/分页安排（独立于视频画幅）：
- 用户/授权代理决定或本次明确修改依据：
- 状态、槽位、当前角色四项状态及依赖，以execution记录为准。
- 对外不另列逐镜技术配额、角色状态表或校验清单。

## 决策与采用记录

| 日期/单元 | 用户决定或实际证据 | 本次改变与影响 | 下一步 |
|---|---|---|---|

计划结束状态写execution.unit.planned_end，实际采用写execution.adoptions；不要相互覆盖。仅“下一段”推进提示词，不证明视频已生成或已采用。

## 执行状态（机器校验）
```json
{
  "workflow_revision": "route-style-first-v1",
  "style_profile": {"status": "pending", "medium": "", "source_kind": "", "preset_id": "", "revision": "R01", "confirmed_revision": "", "confirmation_source": "", "features": "", "performance_scale": "", "references": []},
  "asset_preflight": {"status":"pending","basis":"","unresolved_conflicts":[]},
  "run_scope": "full",
  "asset_run_status": "pending",
  "asset_review_policy": {"mode": "user", "authorization_source": ""},
  "asset_reviews": [],
  "settings_confirmed": false,
  "video_execution": {"mode": "pending", "selection_source": ""},
  "snapshot": {
    "confirmed": false,
    "mode": "待确认",
    "assets": []
  },
  "capabilities": {
    "max_duration": null,
    "max_images": null,
    "max_audio": null,
    "max_video": null,
    "audio_reference": null,
    "source": "未验证"
  },
  "revisions": {
    "SETTINGS": "r1"
  },
  "unit": {
    "id": "",
    "sequence_index": 1,
    "revision": "r1",
    "source_anchor": "",
    "text_proposal": {
      "revision": "r1",
      "source_anchor": "",
      "start_quote": "",
      "end_quote": "",
      "display_source": "",
      "confirmed_revision": "",
      "confirmation_source": ""
    },
    "storyboard": {
      "revision": "r1",
      "source": "",
      "display_source": "",
      "confirmed_revision": "",
      "confirmation_source": "",
      "shots": []
    },
    "compiled_storyboard_revision": "",
    "director_confirmed": false,
    "authorization": "pending",
    "authorization_source": "",
    "handoff_mode": "pending",
    "prompt_form": "shots",
    "bgm_mode": "none",
    "required_voices": [],
    "bindings": [],
    "pending_gaps": [],
    "preview": {
      "required": true,
      "status": "pending",
      "aspect_ratio": "待确认",
      "attempts": 0,
      "failure_reason": "",
      "fallback_authorized": false,
      "unavailable": false,
      "source": "",
      "revision": "r1",
      "user_confirmed": false,
      "confirmed_revision": "",
      "confirmation_source": "",
      "fallback_authorization_source": ""
    },
    "music": {
      "action": "none",
      "cue_id": "",
      "brief": ""
    },
    "character_states": [],
    "planned_end": {},
    "dependencies": [
      {
        "id": "SETTINGS",
        "revision": "r1"
      }
    ],
    "needs_review": false,
    "recheck_reasons": []
  },
  "unit_history": [],
  "music_library": [],
  "adoptions": [],
  "completion": {
    "kind": "",
    "coverage_checked": false,
    "user_confirmed": false,
    "evidence": ""
  }
}
```

程序读取本块检查事实之间的对应关系；字段依据见references/project_ledger.md。不要只修改版本号或布尔值绕过未完成步骤。开始下一单元时将当前单元存入unit_history，仅重置新段选择，保留稳定事实与music_library。

## 文件位置与当前交付

- 最终资产根目录（实际绝对路径）：
- 制作工作根目录（项目外实际绝对路径）：
- 当前资产总览（从采用记录生成）：
- 旧项目未迁移范围及活动依赖（无则不填）：

归档与版本替换按 `references/asset_delivery.md`；未确认/未回传不列为本地已确认资产。
