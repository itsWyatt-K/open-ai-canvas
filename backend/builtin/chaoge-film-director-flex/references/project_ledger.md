
# 制作记录、执行门禁与连续性

实际采用文件的交付、版本替换和工作目录位置统一按 `references/asset_delivery.md`，确认后同步当前路径与总览。

## 1. 记录范围

A沿用完整台账模板，B/C沿用轻量状态模板；两者均包含唯一execution JSON块。Markdown供阅读，execution保存程序需要的明确事实；同一事实不在两处独立维护不同值。记录属于项目，不是提示词新增栏目，也不要求用户填写JSON。

当前skill_version=3.24.0，record_schema=1.4。另存迁移自旧版的记录，保留旧记录和实际采用资料。迁移只复制有依据事实，其余标待确认，不将所有门禁批量设true。

资产阶段在现有逐项记录中维护身份/状态/机位/用途、当前需求状态（未生成/待确认/待修改/已确认）、实际版本、确认依据、采用路径和唯一下一步。workflow.md的进度从这些事实汇总，不根据文件数或历史稿数推断；B提示词与图片分别记录。沿用当前记录位置，不为每张图新增进度文件。

视频执行方式按 `references/video_execution.md` 独立于platform和production_route记录为可选execution.video_execution：mode=pending/manual/cli，selection_source保存真实选择/授权依据。旧记录缺字段保留原手动交付，不自动连接；pending可继续创作和提示词但不能自动运行。cli必须是LibTV且有明确选择来源；连接、项目和任务回执在实际执行时另记，不是manual提示词门禁。脚本检查字段及来源非空，不证明授权文本含义、聊天展示或接口已可用。CLI在现有制作记录中分别保存内部提示词版本/路径与校验结果、实际上传绑定、任务回执和下载结果；未展示的提示词不记为已向用户交付。用户主动索要时另记真实展示事实，不新增提示词确认门禁，也不因查看而再次提交。

在现有“当前AI导演分析/决策与采用记录”保留具体提案版本、展示所在聊天/消息或时间位置、决定人和依据；下一段开始时展示其有效提案，代确认按workflow.md执行。引用文件只证明方案可读取，不能记录成已经在聊天完整展示。每阶段唯一下一步须和本轮可见收尾一致，完成范围和回归覆盖分开记录。

## 2. 项目设置与实际资产

前置字段保留路线、阶段、版本、平台，并增加aspect_ratio。画幅格式如16:9、9:16、2.39:1，P3A前已确定，仅表示后续视频输出目标（含LibTV CLI参数）；草图整图、草图格与资产母板各自排版。

execution.snapshot包含confirmed、mode及assets。mode为mapped/text/hybrid；confirmed表示用户确认这份实际快照及承担方式，不表示全片无缺口。资产字段：
- id：项目内稳定身份，不能用扫描序号或临时图号。
- kind：image/audio/video。
- name：正文规范名称；audio的name是角色/来源规范名称。
- source：已存在的绝对文件路径，或明确upload:开头的本次上传标识。文件名/虚构路径不能代替来源。
- user_confirmed：真实用户指认，必须布尔值。
- revision：例如r1；改文件或改变身份后递增。
- audio可增加file_role=voice_reference/dialogue_take；职责见sound_and_music.md。
- LibTV绑定的image增加已指认category（人物/道具/场景/站位参考/其他）。人物还须file_role=character_sheet、adoption_status=adopted及非空confirmation_source；当前采用路径/原来源/版本与替代关系按character_assets.md 0.2节维护。竖版及旧版可以留档，不进入最终上传队列。

扫描size_bytes、modified_ns只是变化线索，不是画质验收或内容相同证明。用户明确替换即更新revision，不能因同路径同大小忽略。P5交付前检查当前绑定文件存在；未绑定未来资产不影响当前门禁。

## 3. execution结构

模板中的JSON只初始化已知空状态，不能直接当成已完成。共同字段：

- settings_confirmed：版本、平台、画幅均已明确；已有用户答案直接记录，不重复问。
- capabilities：max_duration、max_images、max_audio、max_video、audio_reference，未知null；source注明用户界面/官方依据/未验证。值是当前入口上限，不凭模型名虚构。
- revisions：稳定事实ID到revision的映射，包括资产、项目设置、前段采用结束状态。
- unit：当前生成单元，字段如下。
- unit_history：已经处理的单元记录，不预排未来批次。
- music_library：保留历史音乐提示词/实际音轨证据，可供独立后期查阅；不决定视频是否启用音乐。
- adoptions：实际视频采用证据，不与计划混合。
- completion：完成类型、覆盖检查和证据。

unit字段：
- id、sequence_index、revision、source_anchor：唯一单元、项目顺序、修订号、原文位置。
- text_proposal：文字AI导演提案，含revision、source_anchor、start_quote、end_quote、display_source、confirmed_revision、confirmation_source。start_quote/end_quote仅作内部定位，不能据此把用户提案缩成首尾两句；display_source指向已在聊天完整展示本段原文及安排的实际消息。完整原文和逐镜简述保存在同一现有制作记录，记录当前版本的明确确认。生图前调用scripts/workflow_state.py中的validate_text_proposal(unit)核对记录，缺确认不得绘制。原文范围改变更新版本并清除旧确认，先交新文字方案；仅局部修改且边界不变时沿用边界确认并记录用户具体修改。
- director_confirmed、authorization、authorization_source：有效方案确认；authorization为pending/initial/user_revision，来源记用户确认或明确修改摘要，不伪造。 编号确认须记录原回复、对应待答选项含义、单元/资产版本及提问出处，不能只存“用户：1”而丢失确认对象。
- storyboard：文字提案确认后生成的一次宫格草图，revision为当前宫格版本；source为实际图片路径或upload标识；display_source记录当前聊天实际展示位置；confirmed_revision与confirmation_source记录采用版本及来源。shots按真实镜头顺序排列，每镜含id、revision、confirmed_revision、start、end（从0连续的叙事秒数）、camera（景别/拍摄或切法）、performance（一句可见表演）、panels（该镜的格号数组，例如["03A","03B"]）。A/B归入同一镜，不重复计时。交接独立于叙事镜序，按handoff_mode记录及展示。图片source可以是多页图的主图，其余页来源在本段现有记录中列明并一起展示。
- storyboard.issues：可选的已发现问题文本数组，用户采用示意时保留问题与知情确认来源；不是阻塞性pending_gaps，不驱动自动重画。草图目标比例和实际比例分开记，不与视频比例比对；可选storyboard.canvas_aspect_ratio记草图整图目标比例，storyboard.layout用文字记录实际画格数、行列和留白/分页安排。旧记录无这两项不阻塞，不能伪称正式输入规格通过。
- compiled_storyboard_revision：P4及以后须等于当前已确认storyboard.revision；修镜后清空，逐镜同步完整提示词后才重填。程序比对记录版本及提示词镜号/时间，不证明图像或提示词语义一致，仍须实际逐镜核对。
- storyboard.exception仅用于用户明确授权本段不出宫格的例外，包含user_authorized=true、authorization_source、failure_reason；内部失败或manual不是授权，例外仍保留revision供提示词追溯。宫格例外不自动豁免preview首帧门禁。
- handoff_mode：pending/on/off；新段重新解析，当前修订沿用有效选择。bgm_mode固定none，不等待用户音乐选择。
- required_voices：当前有台词或可辨识角色人声的规范姓名数组，无角色人声用[]；记录剧情需求而非必须上传的参考清单。绑定音频的角色按实际参考生成，未绑定者随视频生成。主角、配角和路人人声均可无参考；缺参考只作现有备注提醒，不清空真实人声需求。干声友好提示及主角/重要角色的可选建议也记在现有备注中，不能升级为pending_gaps或必须上传项；用户继续沿用模型生成方式，不增设干声豁免字段。
- bindings：kind为图/音频/视频、slot从1连续、asset_id指向snapshot；同类不留空号。每个绑定必须关联已确认实际资产及同revision依赖。
- pending_gaps：当前未解决的阻塞性缺口数组；单纯无本地声音参考不放这里，只作备注提醒。旧记录只迁出明确属于缺声音参考的条目，保留视觉/身份/实际平台能力等其他问题。
- preview新增kind=single_frame/grid_panel（旧字段缺省single_frame）。grid_panel时source指向实际已确认宫格，panel_id/shot_id/shot_revision关联第一镜第一格及其版本；可保留此前确认的图源，只要首镜版本未变。确认来源须明确宫格确认覆盖首镜；不得把整张图作为视频输入。
- preview：每段required=true，status=pending/passed/text_fallback；source为实际图文件或upload标识，revision为当前图版本。single_frame是独立首帧输入，aspect_ratio须匹配视频目标；grid_panel是草图构图依据，aspect_ratio可省略/留空或记录实际格比例，不与项目aspect_ratio强制相等，也不能填整图比例冒充格比例。passed还须user_confirmed=true、confirmed_revision等于revision、confirmation_source为用户确认来源。attempts/failure_reason/unavailable只记录事实，不授权跳过。text_fallback仅限用户明确本次例外，须fallback_authorized=true及fallback_authorization_source；not_required不再通过P4门禁。
- music：视频单元action固定none，cue_id/brief留空；旧new/reuse先另存迁移到后期备注，不丢失历史真实来源。
- character_states：当前重要角色的name、known、goal、body、emotion、source、evidence_type（script/user/plan/adopted）。信息未知如实记录；不能给角色未获知的观众信息。
- planned_end：导演方案的预期状态；adopted_end不在这里伪造，见adoptions。
- dependencies：数组{id,revision}；仅当前实际依赖的资产、设置、前段状态。
- needs_review：变更后是否尚未重检；recheck_reasons记录原因。

voice_mode由AI记录reference_or_generated，不增加声音模式选择；兼容旧mapped_dry_voice，继续编译时按sound_and_music.md迁移。P2V只要求实际快照确认；缺声音参考不阻塞。P3A/P3B/P4/P5的当前单元须当前已选输入真实且身份明确，未绑定人声随视频生成，P3B以后有效宫格确认（或明确本段例外）、导演授权与模式已确定，P4以后每段首帧具体版本已获用户确认或用户明确授权例外。P5前传记录给validate_prompt.py比对实际交付，不能只改current_stage标签绕过。

### 场景阶段的轻量记录

A/B在现有记录中维护“场景制作进度”，不要求用户填表：场景执行责任A/B（可局部覆盖原路线）、渠道及已告知设置、画布身份/连接状态、各地点建模范围/理由/连接点/楼层状态、风格参考选择style_reference_choice（pending/user_reference/p1_design）、适用美术组、用户选择依据及参考来源/职责（局部光色图为look_only，全局风格图为global_style，职责按scene_prompt.md；B可外部计划）、房间顺序、当前房间/机位、平面图和预演项目、代表母板与各房间彩图、补图计划、线稿具体确认版本、参考图序、实际原图路径/像素、采用依据、下一步、家具回填提示时间/来源、用户选择（待答/接受/延后/跳过）、回填工程/模型revision及验收依据。已有记录可用Markdown小表保存，不新增视频执行门禁或强制JSON模式。

图像已读取且已采用、外部采用但未读取、仅提示词已交付、待审和实际本地归档分别记录。B不回传允许继续，不伪造文件或AI视觉通过。生成成功不等于用户采用，预设机位不等于实际生成。只有已确认房间的机位扩展使用线稿版本依赖；每房间首张彩图无此依赖。回填/运镜尚未执行不得记完成。C不增加完整彩图制作表；主动请求预演台时仅使用下述独立预演记录。

### 独立预演进度（A/B/C按请求启用）

按previs_entry.md写入现有项目记录，不增加execution JSON必填字段或改变record_schema。记录触发来源、所读剧本/版本、全部物理场景稳定ID与原文依据、所选场景/批次及用户选择来源、实际资产与职责、每张图纸版本/路径/展示位置/确认来源、布局推断与未决项、模型依赖的已确认图纸版本、工程路径/入口及实际验证、模型确认和回填选择、当前待答项及唯一下一步。源剧本或图纸改变时，只重检受影响范围。

进入时保留production_route、current_stage、当前资产/视频单元、原待答问题及版本作为返回位置；独立预演的选场景/图纸待审/可建模/模型待审/已完成状态另记，不把原阶段伪写为已通过。未调用时可留空，C不因缺此记录阻塞视频；调用后缺图纸确认仅阻塞相应建模，不能以P3B的preview字段代替。部分确认逐图记录，批量确认须有明确范围；收到对应确认才更新版本。已有有效模型和图纸复用，不为升级重做。

## 4. 角色状态与计划/采用证据

每段只维护当前相关角色的已知信息、目标、身体状态、情绪余波。上一段采用状态有证据时优先作为连续性依据；只有计划时注明plan并允许继续写下一段提示词，不假装实际视频已经发生。观察范围之外的角色状态不凭空补完。

adoptions条目含unit_id、source、user_confirmed=true、end_state与可选采用区间。source是用户指定视频/截图或明确“用户确认：……”的可追溯说明。候选、生成成功、提示词满意不写入adoptions。若采用画面违反定稿剧情，不自动改剧本；请用户决定修复还是接受差异。

## 5. 修订传播与恢复

当前素材身份/文件、项目画幅、前段采用状态变化：
1. 更新稳定事实revision；
2. 调用workflow_state.apply_change，沿已记录dependencies标记直接和间接受影响单元needs_review；
3. 未受影响单元不重做，已采用视频保留原文件；标记只意味着需要检查，不授权重新生成；
4. 重检后更新该单元使用的依赖revision、角色状态和planned_end，再清除needs_review。不能为了通过校验只改revision而不读变化事实。改动触及首帧构图/人物/持物，或独立正式输入图确需改变画幅时，递增受影响preview.revision并清空其user_confirmed、confirmed_revision和confirmation_source；新版展示确认后再通过。仅视频输出比例改变先重检适配，不自动清除草图grid_panel确认或触发重画；草图布局调整也不自动改动视频设置。纯声音变更只重检声音，不机械废弃首帧。

可用scripts/workflow_state.py --state记录.md --changed事实ID --revision新版本只读预览受影响单元；它不写项目文件。脚本建议由AI确认实际影响后以正常文件编辑保存。

当前按镜号修改时可调用workflow_state.revise_storyboard_shot(data, shot_id, shot_revision, grid_revision)在副本中清除目标镜、新宫格及已编译提示词的确认，保留其余镜和已采用视频；只有首镜被改才清除preview确认。该函数不改文件、不生图、不判断真实影响。实际修改目标格并检查邻接切点、展示新版后，保留未改镜的确认，只填入本次已采用镜的confirmed_revision，再确认组成的新宫格。只改声音绑定等不影响画面设计的修订沿用宫格，不调用此函数。旧采用视频不追溯重做或伪造文字提案确认；当前未完成单元和新单元按新版补齐文字提案确认再画一次草图。已有待审旧草图可展示并列明来源，用户明确选择复用时保留，不为升级自动重画；不得凭旧草图存在伪造先前文字批准。

当前局部修改按workflow.md直接落实。修改涉及素材时连续重排当前bindings，并重新编译对应台词引用。新文件来源或身份未确认只补问该项，不重复整个P2S或P3A。

## 6. 独立后期音乐与完成

P1主要参考影片及可见借鉴与音乐圣经分别记录在既有创作基准/制作记录中。音乐圣经保留实际内容/文件位置、版本、确认来源、曲风、乐器及分工、核心动机、节奏材质、频段动态、留白禁用声音和P0A的BGM节点映射。无需新增视频unit字段；P1音乐规划不修改bgm_mode=none、music.action=none，也不表示已有音轨。后期回传视频时读取这份已确认规划并记录实际剪辑映射及有依据的调整，不能仅保存“音乐已规划”而丢掉参数。

music_library可保留id、brief、prompt_source及实际adopted_audio，不把已有提示词标成音轨。配乐使用实际成片后按post_music.md记录真实来源、所依赖剪辑、生成或复用和采用结果；新视频始终无BGM。

完成时completion.kind=prompts或film；coverage_checked=true，evidence说明用户指定范围与原文覆盖检查。prompts表示提示词覆盖完成，不表示成片；film需要实际采用证据及用户确认全片结果。COMPLETE不能由最后一条提示词自动冒充成片。

## 7. 校验范围

validate_ledger.py检查数据形状、阶段门禁、当前资产来源、人声绑定、预演比例、固定无BGM状态和依赖修订。validate_prompt.py --state再比对本次交付槽位、规范身份、台词声音引用及当前提示词形式及宫格镜号/时间、打斗阶段时间预算或简式关键状态总时长。它们不能验证用户声明真实性、表演质量或视频执行；director_quality_gate.md保留语义冷读。发布回归包含正确与错误状态，不能只检查字段名存在。

（在源起 Agent 运行时内，直接调用工具 director_validate_ledger 执行同等确定性校验；离线 CLI 环境运行上述脚本。）
## 资产测试范围与代验收（1.4兼容扩展）

execution新增可选字段：run_scope=full/assets_only；asset_run_status=pending/in_progress/complete/awaiting_external；asset_review_policy；asset_reviews。缺省full、user与空记录兼容旧项目。字段及授权规则见 `references/asset_review.md`；用户明确要求本次只到场景时写assets_only，不改变Skill全局默认。
spec_exception为对象：{user_confirmed:true,source:"用户明确允许的规格放宽依据"}。视觉与像素规格分开登记，不能把提示词通过记成图片通过。资产完成还需核对立项范围全部已处置；程序只检查记录内部关系，不证明视觉质量。
场景预演单独保存源工程、确认平面图、scene-contract.json、模型revision、相机项目文件和截图。scene-contract记录图纸事实与暂定值，目前是建模依据，模板不会自动读取它构建任意户型。效果图记录本轮实际输入、材质/时间锚点、色卡、模型revision和机位；网页标记保留对象ID和意见。

后期单独记录工作剪辑revision、采用区间、画面锁定依据、声音输入/输出、实际工具、处理参数、响度与峰值测量、主观试听范围及用户采用。独立声音任务只需媒体记录，不伪造完整剧本execution。音乐来源区分实际生成工具/模型、用户提供和公开素材。

独立后期任务在现有记录中另记执行方式manual/自动工具、适用范围、用户选择依据与交付类型。手动音乐/音效提示词已交付、实际音轨已取得、本地混音完成、用户已采用分开登记；无音轨时不伪造生成任务ID或WAV路径。沿用适用范围内的不接入决定，不因scene/video曾用CLI自动授权配乐。此记录不修改视频unit的bgm_mode=none，也不要求独立配乐任务具备剧本阶段execution。

## 提示词形式（1.4兼容扩展）

unit.prompt_form=shots/one_take/combat；旧字段缺省shots。storyboard.basis=shots/beats，缺省shots。普通段按真实镜头逐项记录；one_take只有一项真实镜头，多个panels为同镜连续状态；combat用beats，沿用shots容器逐项记录攻防阶段及关键状态，start/end是连续阶段预算，须与最终提示词的阶段时间范围一致；不要求每阶段只对应一个切点，camera可记录本阶段具体观看位置、机位路径和特效镜头。用户明确无摄影时可用无内部时间标题的简式过程，预算仍用于总长与容量核对。不要把beats条目称为已锁定真实镜头数。形式改变属于导演设计变更，更新宫格与确认，不能只改字段绕过。明确本段宫格例外仍需有效授权，不取消形式一致性。

新项目默认bgm_mode=none、music.action=none，不设pending音乐状态。旧当前单元迁移按sound_and_music.md，历史unit_history/adoptions与原媒体保留。剧本和项目设置优先于示例：20—30秒、画幅、分辨率、角色数和武器数都不从案例自动改写到已有项目。

## 新入口与风格状态

新项目使用workflow_revision=route-style-first-v1，新增阶段P0S（P0R选择路线，P0S读取图片/预检并确认风格）。style_profile的status=pending/confirmed，medium=live_action/stylized_3d/handdrawn_2d/custom；source_kind=preset/custom/existing_assets/legacy；preset_id仅内置选择填写；当前允许linglong_3d（CG写实虚幻风）、painterly_3d2d（3渲2厚涂风）、inkwash_2d（2D国漫水墨风）、pixar_3d（3D皮克斯画风）和live_action_drama（真人短剧风）；inkwash_2d对应medium=handdrawn_2d，live_action_drama对应medium=live_action，其余三项对应medium=stylized_3d；preset_revision读取catalog中所选预设revision（当前均R01）。每个预设须读取其自己的独立原图，不能交叉用另一预设的原图完成读取校验。原三种preset_id不可用于新项目选择；已确认旧项目按原证据改记source_kind=legacy继续，保留原媒介与历史ID。记录revision、confirmed_revision、confirmation_source、features、performance_scale和references。另可记preview_source、preview_presented及各批实际使用的参考ID；视频样片与总览不默认成为生成输入。reference逐项记录source（实际绝对路径或upload:来源）、media_kind=image/video/audio、role、visually_reviewed。自定义与已有资产选风格须至少一张实际查看的global_style图片，可为用户图片或从其视频实际抽取并查看的帧，记录源视频与时间点，不要求用户重复上传图片；视频动态依据可额外记录motion，不能代替未读取的画面。内置风格的编号或名称选择即为confirmation_source，原图由AI内部读取，不增加第二次用户确认；对外名称读取catalog.name，不展示内部ID。自定义尚未提供可读素材时保持status=pending。

C的asset_preflight记录status=reviewed或text_authorized、basis和unresolved_conflicts；普通未决先pending。图片未看过、身份未指认、风格未确认分别记录，不能互相代替。P0A前profile必须确认；视频unit.style_revision必须等于当前风格revision，风格变更后旧单元保持待复核。既有revisions/dependencies可用STYLE跟踪影响，不自动重生成已采用媒体。

旧记录没有新字段时兼容原流程，下一次编辑从有效P1补齐legacy，不伪造新确认。已选定的global_style同时满足适用场景参考选择，不要求再次上传；look_only仍按局部光色边界。
