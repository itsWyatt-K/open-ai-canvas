# Inspiration Library License & Attribution Specification
# 灵感库开源许可、来源出处与版权保护规范

本项目灵感库（Inspiration Library）汲取并融合了 `awesome-seedance` 与 `goodcase.ai` 开源知识生态。为了严格保护原作者权益、尊重开源策划劳动并合规开放工具代码，本仓库全面遵循相同版本的开源许可三元条款：

---

## 1. 三种材料与三类条款 (Three Kinds of Material Under Three Terms)

### ① 代码 (Code) —— MIT License
- **涵盖范围**：数据导入与生成器脚本、Agent 技能（Skill）、前后端工具链与业务逻辑代码。
- **条款**：以 **MIT 许可证** 发布，详见仓库根目录 `LICENSE`。
- **限制**：MIT 许可证仅涵盖代码本身，不涵盖受版权保护的创意提示词及媒体资产。

> Code (generator scripts, Agent Skill, tooling) is released under the MIT License, see the LICENSE file. The MIT license covers the code only.

---

### ② 内容策划与整理 (Curation) —— CC BY 4.0
- **涵盖范围**：案例的选择甄别、结构化组织、统计度量、模板分类提取、中文翻译与摘要整理。
- **条款**：采用 **知识共享 署名 4.0 国际许可协议 (Creative Commons Attribution 4.0 International, CC BY 4.0)** 授权。
- **要求**：任何二次分发、修改与再利用，均须按要求署名指向 `awesome-seedance` / `goodcase.ai` 及本项目。

> Curation (selection, organization, statistics, template extraction, summaries written by us) is licensed under CC BY 4.0. Reuse it with attribution to awesome-seedance / goodcase.ai.

---

### ③ 提示词与多媒体内容 (Prompts & Media) —— 原作者保留版权 (Original Creators' Copyright)
- **涵盖范围**：提示词完整文本、创作者摘要、海报封面、视频参考物与媒体样本。
- **版权声明**：**版权均严格归属于其原始创作者所有**。
- **引用性质**：所有提示词文本、创作者摘要、海报图片与视频样本均引用自公开公开发布的社交网络帖子（如 X/Twitter、小红书、YouTube 等），仅供学术研究、个人学习、文档记录与跨模型生成效果评估之用。
- **出处链接**：**每一个条目均明确附带原始来源出处链接（Source Link）以及对应的 goodcase.ai 档案记录链接**。
- **限制**：本项目不授予对底层提示词或多媒体内容的任何超出原帖公开许可范围的商业或私有授权。

> Prompts and media remain the copyright of their original creators. Prompt text, creator summaries, poster images and video references are quoted from publicly published posts for documentation and study; every entry links back to its original source and to its goodcase.ai record. Nothing here grants a license to the underlying prompt or media beyond what the original post allows.

---

## 2. 权利人更正与下架流程 (Takedown Process)

我们高度尊重知识产权。如果您是某一条目的合法权利人（或授权代表），并希望移除、隐藏或更正某条目：

1. **提交途径**：
   - 在 GitHub 仓库提交 Issue，或者直接联系 `goodcase.ai` 官方及本平台管理员。
2. **所需信息**：
   - 该案例条目的 **Slug 唯一标识**（可从 goodcase.ai URL 或灵感库详情页一键复制）；
   - 原始发布平台的原帖链接及权利权属说明。
3. **核实与响应**：
   - 平台在对照原始公开发布内容核实权属后，将立即响应；
   - 相应条目将从底层数据库与媒体目录中下架清除，并在后续所有生成静态文件与导出包中永久移除。

> Takedown process: If you are a rights holder and want an entry removed or corrected, open a GitHub issue with the entry's slug (from its goodcase.ai URL) and the original source link, or contact goodcase.ai directly. Requests are verified against the original post and honored on verification; the entry is removed from data/ and disappears from every generated file on the next regeneration.
