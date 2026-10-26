# 资产代验收、规格与重测范围

## 授权与阶段
用户明确委托“哪张好你来决定／尽量自动测试”时，记录 execution.asset_review_policy={mode:"delegated",authorization_source:"用户原话或可追溯位置"}。未委托为 user。此授权允许人物、道具、场景的常规图像质量检查、候选选择和局部修复，不自动决定剧情歧义、人物身份变化、核心风格或户型拓扑变更；已明确授权的决定不再重复询问。
A路线文件中“图片确认”在此授权范围内允许AI代验收。B人物/道具仍确认提示词设计；场景按实际证据分别记录规划/线稿图片、提示词或外部采用声明，不伪造未回传图片。房间扩展机位的具体线稿确认按workflow.md执行，不被常规代验收自动取代。视频实际采用、角色声音身份及P2S素材身份确认不由图像质量授权替代。

用户只测到场景资产、不进入视频时，execution.run_scope="assets_only"，停留P2并登记execution.asset_run_status="complete"或"awaiting_external"；不要转P2V追问版本、人声、站位交接或输出视频提示词。普通继续不解除范围；用户明确开始视频后改full。缺省full兼容旧记录。此范围只控制本次执行，不删除Skill原视频能力。
用户要求重新测试时在其指定父目录创建新的独立测试目录，不覆盖旧产物、旧机位或旧台账。

## 每轮评测
每项产物在execution.asset_reviews记录：
id（本轮唯一）、asset_id、source（实际文件/本次upload:）、reviewed_by（user/agent）、authorization_source（本次本人确认或委托依据）、evidence（prompt/image/model）、visual_status、spec_status（均为passed/failed/unverified）、disposition（accepted/rejected/pending）、findings（问题与证据摘要）。同一源图修订应有新id；保留失败稿。
agent接受必须具有delegated政策及授权来源。A的accepted需要image或model证据；prompt证据不得记accepted。规格未达但用户允许功能试用时增加spec_exception说明真实放宽依据，结论写“视觉通过／规格未达，获准试用”，不能称完全合格。未经查看不记image passed。
P2S的user_confirmed仍只表示实际身份指认，不能因AI验图通过而填写true。

- 人物：身份、年龄、状态、服装与左右锚点、设定板布局及清晰/模糊区域。
- 道具：单件完整、结构及动作接触点、文字图案、底色与实际alpha透明度。
- 户型/模型：邻接、门窗尺寸/位置、通道、相机与遮挡；构建成功不等于空间通过。
- 效果图：结构、材质、时间/灯具状态、目标影调分别检查；漂亮不能抵消多门、错层或昼夜错误。
- 像素：先确认工具实际可选尺寸；文件生成后读取宽高、比例，4K/8K提示词不是输出事实。不可用时按真实能力说明，不能用放大后的像素冒充原生分辨率。精确户型比例优先坐标绘制，不靠重复生成猜尺寸。

相同问题两轮仍失败，改变输入或方法并说明局限，不无限叠加禁止词。修复只针对失败项，不重新选角或重设整套空间。

