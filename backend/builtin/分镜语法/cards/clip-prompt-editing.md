# 参考素材与逐 Clip 提示词生视频（Phase 6-9）

> 提取自「叙事短片导演分镜」技能（2026-10-25 拆卡，收编进分镜语法）。

### Phase 6：需求确认

* **目标**：仅收集视频比例（已提供则跳过）。
* **执行步骤**：缺失则 `request_user_input` 弹表单，比例从 `["21:9","16:9","4:3","1:1","3:4","9:16"]` 选，故事/影视默认 16:9。
* **用户交互**：确认后进 Phase 7。

### Phase 7：参考素材生成（video-sop，注入森海 VISUAL DNA）

* **执行步骤**：
  1. `load_skill` 加载 `story-ref-gen`。
  2. 先建立项目级 VISUAL DNA（第一集建立、后续复用），作为所有参考图与提示词的约束底座。
  3. 按 `主体来源` 处理：`用户参考主体`直接复用不重生；`用户普通参考图`先据其生成标准主体图（单体走三视图）；`待生成主体`正常生成；有变体基于主体来源续生。**改图必须用 `image2image`，不用文生图。**
  4. 为有声主体确认音色。
* **用户交互**：**所有主体及全部变体生成后必须与用户确认满意，严禁直接进 Phase 8。**

> 📚 **森海知识库·VISUAL DNA + 抽象词具象化（原文保留）**
> **项目级 VISUAL DNA**（第一集建立，后续复用）：
>
> ```
> VISUAL DNA — 《[项目名]》项目级约束
> COLOR & LIGHT:
>   Color palette: [主色1]+[主色2]+[辅色]
>   Color temperature: [K值]
>   Contrast ratio: [比例]
>   Shadow tone: [描述]　Highlight tone: [描述]
> CAMERA LANGUAGE:
>   Focal length: [mm]　Depth of field: [f值]
>   Movement: [运镜方式]　Aspect ratio: [比例]　Frame rate: [fps]
> ```
>
> **抽象词具象化**：高级感\=色彩克制(≤3色)+留白合理+材质统一+光线收敛；电影感\=单侧主光+高光比+色彩分级+空间层次保留；氛围感\=光线方向+色温+背景虚化程度；商业成片感\=主体突出+信息层级清晰+背景干净+缩略图识别度高。
> **图片 Prompt 核心维度**（按任务类型调权重）：主体（形态/数量/位置/朝向）、光影（主光方向/光比/高光）、色彩（主辅点缀色/冷暖）、材质（质感/反射/纹理）、背景（衬托/留白/空间逻辑）、构图（视觉重心/前中后景/视线引导）。

### Phase 8：逐 Clip 提示词 + 分镜生视频（森海提示词模板按 Clip 重组，并入 video-sop）

* **执行步骤**：
  1. `load_skill` 加载 `video-prompt`。
  2. **按 Clip（非单镜头）** 生成提示词，套用森海 AIGC 模板，绑定真实 resource\_id 与 @引用。
  3. **前置铁律**：所有角色/物品/场景参考图、音色必须已确认成功；任一素材失败/缺图则返回 Phase 7 补齐，禁止跳过或仅用文字替代。
  4. 据 Clip 表一次性并行用 `multi_modal2video` 提交，禁止串行分批。参考主体写 `<subject>主体名称</subject>` 传真实 resource\_id，普通素材用 `@图片N`/`@视频N`/`@音频N`。**禁止生成任何 BGM/背景音乐。**

> 📚 **森海知识库·AIGC 提示词模板（原文保留，重组为 Clip 粒度）**
>
> ```
> ═══════════════════════════════════════
> AIGC 提示词（Seedance 2.0）
> ═══════════════════════════════════════
> Character: [角色名] — [外观：发型/服装/体型/标志物]  ← 用<subject>+resource_id引用
> Environment: [环境：精确到光影/色调/关键道具]
> VISUAL DNA: [约束色板，如 deep-purple + blood-red + faded-green]
> Camera: [运镜方式] — [景别] — [运动方向]
> Motion: [动效关键词]
> Prompt: "Generate cinematic animation sequence. [Clip核心描述].
>   Apply VISUAL DNA constraints. Maintain character consistency. No music."
> ═══════════════════════════════════════
> ```
>
> **AI 工具适配规则**：
>
> | 模型           | 风格适配  | 注意事项       |
> | ------------ | ----- | ---------- |
> | Seedance 2.0 | 风格化动画 | 优先使用，动效夸张化 |
> | 可灵 3.0       | 写实风格  | 写实时切换此模型   |
> | Vidu         | 中等风格化 | 折中选项       |
>
> **视频 Prompt 核心要素**：整体风格声明 → 分镜结构（按 Clip 时段组织）→ 镜头语言 → 动作/情感描述 → 音频/配音信息 → 全局约束。

> 📚 **森海知识库·导演技法库 30 种（原文保留，含核心/用法/提示词/AI适配度）**
>
> **A. 镜头运动类**
>
> 1. 轨道追踪 ★★★★｜核心：空间同行即情感同行｜用法：迎向\=尊重/期待，跟随\=在场/紧张，远离\=疏离/失落｜`tracking shot, dolly forward, following camera`
> 2. 升降镜头 ★★★｜核心：垂直维度创造上帝视角｜用法：上升\=希望/开阔，下降\=压抑/终结，起始于角色→揭示环境｜`crane shot, rising shot, aerial descent, jib shot`
> 3. Z轴纵深 ★★★★｜核心：靠近\=压迫/亲密，远离\=疏离/失落｜用法：配合广角增强纵深，与焦点转移结合｜`dolly in, approaching camera, walking toward viewer`
> 4. 旋转镜头 ★★★★｜核心：360度环绕，世界绕观众转｜用法：慢速\=优雅/浪漫，快速\=眩晕/失控｜`spinning shot, 360 rotation, orbit camera`
> 5. 荷兰角 ★★★★★｜核心：倾斜画框\=心理失衡｜用法：轻微\=不安，大幅\=精神错乱｜`dutch angle, tilted frame, oblique angle`
> 6. 快速变焦 ★★★★｜核心：极快推近再拉回，速度即冲击｜用法：6-12帧完成，在强拍上用，禁过度｜`flash zoom, smash zoom, jump zoom, sudden zoom in`
> 7. 延时拍摄 ★★｜核心：时间压缩，平凡变奇观｜用法：城市天际线/植物生长/人流，光影参与叙事｜`time-lapse, hyperlapse, speed up, accelerated growth`
> 8. 手持/斯坦尼康 ★★★★｜核心：呼吸感\=临场感\=真实｜用法：现实/追逐/纪录片，与固定镜头对比｜`handheld camera, steadicam shot, documentary style`
>
> **B. 构图与光影类**
> 9\. 逆光/剪影 ★★★★★｜核心：剥离细节保留形态，姿态>表情｜用法：开场/告别、力量、神秘，规避AI面部缺陷｜`silhouette, backlit, rim lighting, dramatic shadow`
> 10\. 遮挡切入 ★★★★★｜核心：光之边界\=注意边界｜用法：聚焦道具/人物、时代转场、梦境引入｜`iris shot, circular iris, vignetting, light halo`
> 11\. 过肩镜头 ★★★★★｜核心：空间同位\=情感共鸣，前景角色\=观众代理｜用法：对话/审讯/告白，切换OT实现立场摇摆｜`over the shoulder shot, OTS, dialogue framing`
> 12\. 主观镜头 ★★★★★｜核心：观众成为角色｜用法：恐惧、渴望、沉浸式｜`first person POV, point of view shot, subjective camera`
> 13\. 反射映像 ★★★★｜核心：反射面\=双重叙事空间｜用法：镜子\=自我认知、玻璃\=隔阂、水面\=脆弱、碎镜\=分裂｜`mirror reflection, glass reflection, water surface reflection`
> 14\. 非常规构图 ★★★★｜核心：打破三分法/视线规则｜用法：极端低/高角度、倾斜、遮挡、框中框｜`extreme angle, low angle, high angle, frame within frame`
> 15\. 动态构图 ★★★｜核心：构图不是起点是过程｜用法：角色运动+摄影机运动共同重构画面｜`dynamic composition, evolving frame, compositional movement`
> 16\. 色彩叙事 ★★★★★｜核心：色调\=情绪编码，色彩变化\=情感转折｜用法：建立视觉DNA、划分叙事段落、暗示主题｜`color grading, color palette, cinematic color, mood lighting`
>
> **C. 剪辑技法类**
> 17\. 跳切 ★★★★★｜核心：断裂即感知，打破时间连续性｜用法：时间压缩、主观时间、心理失序，同机位同景别跳切｜`jump cut, discontinuous editing, time jump`
> 18\. J切/L切 ★★★★★｜核心：声音先于画面(J)/声音延续过画面(L)｜用法：无缝衔接、空间连续、声音引导注意力｜`J-cut, L-cut, audio bridge, sound leads video`
> 19\. 动作顺接 ★★★★★｜核心：在动作中切换，实现隐形剪辑｜用法：连续动作流畅衔接｜`match cut, cut on action, invisible edit`
> 20\. 叠化/双重曝光 ★★★★｜核心：时间折叠，过去与现在叠加｜用法：记忆/闪回、梦境、意识流｜`superimposition, double exposure, layered image`
> 21\. 定格画面 ★★★★★｜核心：时间冻结\=叙事强调｜用法：高潮定格、开场结尾、回忆锚点、喜剧｜`freeze frame, still shot, paused motion`
> 22\. 分屏/画中画 ★★★★｜核心：空间并置，同时展示不同时空/视角｜用法：对比、并列叙事、监控视角｜`split screen, picture in picture, divided frame`
> 23\. 慢动作 ★★★★｜核心：时间拉伸\=感知放大｜用法：动作高潮、情感峰值、仪式感、暴力美学，60fps→2.5倍慢｜`slow motion, high frame rate, cinematic slow mo`
>
> **D. 声音叙事类**
> 24\. 音画对立 ★★★★★｜核心：声音与画面情绪矛盾→第三层含义｜用法：暴力vs宁静、悲伤vs快乐、平凡vs史诗｜`audio visual counterpoint, juxtaposition of sound and image`
> 25\. 隐藏动作 ★★★★★｜核心：关键动作画外，声音+反应让观众填补｜用法：恐怖、悬疑、暴力，"想象力比银幕更强大"｜`off-screen action, sound driven, implied violence`
>
> **E. 叙事思维类**
> 26\. 悬念公式 ★★★★★｜悬念\=观众知道+角色不知道+时限威胁｜持续张力而非惊吓，信息不对称是核心武器
> 27\. 闪回锚点 ★★★★★｜闪回必须从具体动作/道具触发，角色主动回忆｜锚点：道具/声音/气味/触感/词语
> 28\. 潜台词 ★★★★★｜台词说的≠角色想的｜台词张力\=文本与潜台词的差距
> 29\. 循环叙事 ★★★★｜打破线性时间，结尾与开头闭环｜时间折叠、可逆因果、谜题结构
> 30\. 限制空间 ★★★★★｜空间即高压锅，放大戏剧张力｜出租车后座、电梯内、停电办公室
>
> **AI适配度说明**：★★★★★极易实现（已有大量训练数据）/ ★★★★较易（需精确描述镜头参数）/ ★★★可实现（需复杂提示词）/ ★★需后期处理或特殊技术。

### Phase 9：视频剪辑

* **执行步骤**：
  1. 先用表单询问配乐：表单1 是否需要配乐（默认不需要）；选需要则表单2 收集主题/风格/节奏/情绪，组装为 `music` 对象。
  2. 拼接时按森海转场/剪辑技法设计衔接（见 Step1 转场技巧表 + Phase 8 剪辑技法 17-23）。
  3. 用 `video_editor` 剪辑，参数 `ratio` / `video_resource_id_list`（按 Clip 顺序，≤20 个）/ `output_id` / 可选 `music`。
* **用户交互**：展示成片询问满意度。

***
