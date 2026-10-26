#!/usr/bin/env python3
"""Executable regression cases; not an AI-video quality benchmark."""
from __future__ import annotations
import copy
import json
import re
import tempfile
import unittest
from pathlib import Path
from validate_prompt import validate, SCENE_REFERENCE_BOUNDARY
from validate_ledger import validate as validate_record, parse_frontmatter
from workflow_state import parse_execution, apply_change, revise_storyboard_shot, validate_text_proposal

ROOT = Path(__file__).resolve().parents[1]


def record(data: dict, route: str = "C_direct_video", stage: str = "P5", ratio: str = "9:16", platform: str = "LibTV") -> str:
    return f'''---
record_schema: "1.4"
record_type: "{'full_ledger' if route == 'A_full' else 'light_state'}"
skill_version: "{(ROOT / 'VERSION').read_text().strip()}"
project_title: "回归测试"
script_version: "1"
current_stage: "{stage}"
current_scene: "客厅"
current_source_boundary: "S1:L1-L3"
production_route: "{route}"
batch_material_mode: "mapped"
voice_mode: "reference_or_generated"
platform: "{platform}"
model_version: "Seedance 2.5"
aspect_ratio: "{ratio}"
---

## 执行状态（机器校验）
```json
{json.dumps(data, ensure_ascii=False)}
```
'''


def state() -> dict:
    data = parse_execution((ROOT / "assets/project-state-template.md").read_text(encoding="utf-8"))
    data['style_profile'].update(status='confirmed',medium='live_action',source_kind='legacy',
        confirmed_revision='R01',confirmation_source='测试夹具：旧项目已确认真人P1',
        features='真人自然侧光',performance_scale='克制自然')
    data['unit']['style_revision']='R01'
    data["settings_confirmed"] = True
    data["snapshot"] = {"confirmed": True, "mode": "mapped", "assets": [
        {"id": "SCN-room", "kind": "image", "category": "场景", "name": "老宅客厅", "source": "upload:客厅.png", "user_confirmed": True, "revision": "r1"},
        {"id": "AUD-lucas", "kind": "audio", "name": "卢卡斯", "source": "upload:卢卡斯.wav", "user_confirmed": True, "revision": "r1", "file_role": "voice_reference"}]}
    data["revisions"].update({"SCN-room": "r1", "AUD-lucas": "r1"})
    data["unit"].update({"id": "S1-U1", "sequence_index": 1, "source_anchor": "S1:L1-L3", "director_confirmed": True,
        "authorization": "initial", "authorization_source": "用户：确认方案＋不需要站位交接", "bgm_mode": "none", "handoff_mode": "off",
        "required_voices": ["卢卡斯"], "bindings": [{"kind": "图", "slot": 1, "asset_id": "SCN-room"}, {"kind": "音频", "slot": 1, "asset_id": "AUD-lucas"}],
        "preview": {"required": True, "status": "passed", "aspect_ratio": "9:16", "attempts": 1,
            "source": "upload:首帧_R1.png", "revision": "r1", "user_confirmed": True,
            "confirmed_revision": "r1", "confirmation_source": "用户：确认首帧R1"},
        "character_states": [{"name": "艾玛", "known": "听见卢卡斯要求等待，未获知原因", "goal": "等他解释", "body": "坐着自然呼吸", "emotion": "平静专注", "source": "定稿S1:L2", "evidence_type": "script"}],
        "dependencies": [{"id": x, "revision": "r1"} for x in ("SETTINGS", "SCN-room", "AUD-lucas")]})
    data["unit"]["storyboard"] = {
        "revision": "r1", "source": "upload:宫格_R1.png", "display_source": "测试消息：已展示宫格R1",
        "confirmed_revision": "r1", "confirmation_source": "用户：采用宫格R1，含首镜构图",
        "shots": [{"id": "01", "revision": "r1", "confirmed_revision": "r1", "start": 0, "end": 8,
                   "camera": "固定中景", "performance": "卢卡斯说先等等，艾玛倾听。", "panels": ["01"]}]}
    data["unit"]["text_proposal"] = {
        "revision": "r1", "source_anchor": "S1:L1-L3", "start_quote": "卢卡斯走进客厅。",
        "end_quote": "先等等。", "display_source": "测试消息：文字AI导演提案r1及逐镜简述",
        "confirmed_revision": "r1", "confirmation_source": "用户：确认本段到这里结束，生成草图"}
    data["unit"]["compiled_storyboard_revision"] = "r1"
    return data


def prompt(platform: str = "libtv", handoff: bool = False, bgm: bool = False, suno: bool = False) -> str:
    mappings = {
        "libtv": "{{Image 1}}是老宅客厅场景。\n{{Audio 1}}是卢卡斯的角色声音。",
        "jimeng": "@是老宅客厅场景，绑定后简称“图1”。\n@是卢卡斯的角色声音，绑定后简称“音频1”。",
        "other": "图1用于指定老宅客厅场景。\n音频1用于指定卢卡斯的角色声音。"}
    handoff_text = "\n【站位交接镜头】\n8—9秒\n硬切至稳定的高位斜俯全景，卢卡斯与艾玛保持座位关系，艾玛的脚被桌子自然遮挡，两人自然呼吸，不摆拍。" if handoff else ""
    music = "BGM以低音弦乐与大提琴长音构成平静氛围，音乐压低，为对白让位。" if bgm else "无BGM。"
    result = f'''【本批上传ID映射】
| 序号 | 提示词槽位 | 用户应上传的资产 | 当前准备状态 | 素材身份 |
|---|---|---|---|---|
| 01 | 图1 | upload:客厅.png | 用户已有 | 场景：老宅客厅 |
| 02 | 音频1 | upload:卢卡斯.wav | 用户已有 | 声音：卢卡斯 |

【本段生成信息】Seedance 2.5｜叙事时长8秒｜站位交接{1 if handoff else 0}秒｜总时长{9 if handoff else 8}秒｜独立生成

```text
【风格锁定】
主要视觉参考《风声》，借鉴室内自然侧光与人物间克制的观察距离。

当前片段为上午09:00。采用ARRI数字摄影机与Cooke镜头，24fps自然运动模糊。窗外日光照出人物与桌面，阴影自然保留，不为看清所有细节而整体提亮。低饱和影调，柔和高光。禁止游戏CG、磨皮与HDR光晕。

【素材映射】
{mappings[platform]}
{SCENE_REFERENCE_BOUNDARY}

【场景与空间锚点】
老宅客厅中，两人隔桌坐着，卢卡斯在左侧，艾玛在右侧。

【镜头序列】
镜头1（0—8秒｜固定中景，一镜到底）
固定看两人安静坐在桌边。卢卡斯看着艾玛，她专注倾听，身体自然放松。
卢卡斯（音频1，平静）：先等等。
话音落下，两人保持安静，窗边的光线没有变化。{handoff_text}

【声音设计】
室内环境底噪自然持续，中文对白清楚。{music}

【全局补充】
无字幕，无水印。
```'''
    if suno:
        result += "\n【Suno BGM备用提示词】\n```text\nAmbient chamber score\nMuted cello, bowed double bass, soft synth pad\nQuiet, reflective, restrained\n56 BPM, 4/4, D minor\n[Intro] A soft sustained cello tone.\n[Development] A sparse bass pulse joins a warm pad.\n[Outro] The texture thins into a clean tail.\n```"
    return result


class Regressions(unittest.TestCase):
    def test_text_proposal_approval_precedes_sketch(self):
        data = state()
        self.assertEqual(validate_text_proposal(data["unit"]), [])
        for key, value in (("confirmed_revision", ""), ("revision", "r2"),
                           ("source_anchor", "S1:L1-L8"), ("end_quote", ""),
                           ("display_source", ""), ("confirmation_source", "")):
            bad = copy.deepcopy(data)
            bad["unit"]["text_proposal"][key] = value
            self.assertTrue(validate_text_proposal(bad["unit"]), key)
            self.assertTrue(validate_record(record(bad, stage="P3A"))[0], key)
            self.assertTrue(validate_record(record(bad))[0], key)
        del data["unit"]["text_proposal"]
        self.assertTrue(validate_record(record(data))[0])

    def test_text_only_pending_proposal_does_not_claim_sketch_adoption(self):
        data = state()
        data["unit"]["text_proposal"].update(confirmed_revision="", confirmation_source="")
        data["unit"]["storyboard"].update(source="", display_source="", confirmed_revision="", confirmation_source="")
        self.assertEqual(validate_record(record(data, stage="P3A"))[0], [])
        self.assertTrue(validate_record(record(data, stage="P3B"))[0])

    def test_user_can_adopt_sketch_with_disclosed_issues(self):
        data = state()
        data["unit"]["storyboard"]["issues"] = ["01草图门牌不清，用户选择仅作示意，正式按文字方案"]
        data["unit"]["storyboard"]["confirmation_source"] = "用户：已知问题，采用草图，按文字方案继续"
        self.assertEqual(validate_record(record(data))[0], [])
        self.check_prompt(data=data)

    def test_grid_required_for_manual_and_cli_all_routes(self):
        for route in ("A_full", "B_prompt_only", "C_direct_video"):
            for mode in ("manual", "cli"):
                data = state()
                data["video_execution"] = {"mode": mode, "selection_source": "用户明确选择"}
                self.assertEqual(validate_record(record(data, route=route))[0], [])
                del data["unit"]["storyboard"]
                self.assertTrue(validate_record(record(data, route=route))[0])

    def test_grid_actual_source_display_and_current_confirmation(self):
        for key, value in (("source", ""), ("display_source", ""),
                           ("confirmed_revision", "r0"), ("confirmation_source", "")):
            data = state()
            data["unit"]["storyboard"][key] = value
            self.assertTrue(validate_record(record(data))[0], key)
        data = state()
        data["unit"]["compiled_storyboard_revision"] = "r0"
        self.assertTrue(validate_record(record(data))[0])

    def test_prompt_cannot_claim_current_grid_while_using_old_timing_or_cuts(self):
        data = state()
        data["unit"]["storyboard"]["shots"][0]["end"] = 9
        errors, _ = validate(prompt(), "libtv", "2.5", "mapped", "none", "off", state_text=record(data))
        self.assertTrue(any("时间与已确认宫格" in e for e in errors), errors)
        data = state()
        data["unit"]["storyboard"]["shots"][0]["id"] = "02"
        errors, _ = validate(prompt(), "libtv", "2.5", "mapped", "none", "off", state_text=record(data))
        self.assertTrue(any("镜号/镜序与已确认宫格" in e for e in errors), errors)
        data = state()
        data["unit"]["storyboard"]["shots"][0]["panels"] = ["01A", "01B"]
        self.check_prompt(data=data)  # Two states remain one actual shot.

    def test_later_shot_edit_preserves_other_shots_first_frame_and_adoptions(self):
        data = state()
        board = data["unit"]["storyboard"]
        board["shots"][0]["end"] = 4
        board["shots"].append({"id": "02", "revision": "r1", "confirmed_revision": "r1",
            "start": 4, "end": 8, "camera": "切近景", "performance": "艾玛抬眼。", "panels": ["02"]})
        data["adoptions"] = [{"unit_id": "PREV", "source": "upload:已采用.mp4",
                              "user_confirmed": True, "end_state": {"position": "左侧"}}]
        before = copy.deepcopy(data)
        changed = revise_storyboard_shot(data, "02", "r2", "r2")
        self.assertEqual(data, before)
        self.assertEqual(changed["unit"]["storyboard"]["shots"][0], board["shots"][0])
        self.assertEqual(changed["unit"]["preview"], data["unit"]["preview"])
        self.assertEqual(changed["adoptions"], data["adoptions"])
        self.assertTrue(validate_record(record(changed))[0])
        # New media/display plus acceptance of only the changed shot composes the new grid.
        revised = changed["unit"]["storyboard"]
        revised.update(source="upload:宫格_R2.png", display_source="测试消息R2",
                       confirmed_revision="r2", confirmation_source="用户：采用修改后的镜02，其他镜保留")
        revised["shots"][1]["confirmed_revision"] = "r2"
        changed["unit"].update(director_confirmed=True, authorization="user_revision",
                               authorization_source="用户采用镜02新版")
        self.assertTrue(validate_record(record(changed))[0])  # Old/uncompiled prompt still fails.
        changed["unit"]["compiled_storyboard_revision"] = "r2"
        self.assertEqual(validate_record(record(changed))[0], [])

    def test_first_shot_edit_invalidates_first_frame(self):
        data = state()
        changed = revise_storyboard_shot(data, "01", "r2", "r2")
        self.assertFalse(changed["unit"]["preview"]["user_confirmed"])
        self.assertEqual(changed["unit"]["preview"]["status"], "pending")
        for sid, shot_rev, grid_rev in (("missing", "r2", "r2"), ("01", "r1", "r2"), ("01", "r2", "r1")):
            with self.assertRaises(ValueError):
                revise_storyboard_shot(data, sid, shot_rev, grid_rev)

    def test_grid_first_state_can_supply_preview_without_duplicate_approval(self):
        data = state()
        data["unit"]["storyboard"]["shots"][0]["panels"] = ["01A", "01B"]
        preview = data["unit"]["preview"]
        preview.update(kind="grid_panel", source="upload:宫格_R1.png", panel_id="01A",
                       shot_id="01", shot_revision="r1", confirmation_source="用户采用宫格R1含首格01A")
        self.assertEqual(validate_record(record(data))[0], [])
        preview["panel_id"] = "01B"
        self.assertTrue(validate_record(record(data))[0])
        preview.update(panel_id="01A", shot_revision="r0")
        self.assertTrue(validate_record(record(data))[0])

    def test_grid_shots_timing_identity_and_malformed_containers(self):
        for shots in (None, [], [None], [{}]):
            data = state(); data["unit"]["storyboard"]["shots"] = shots
            self.assertTrue(validate_record(record(data))[0])
        for key, value in (("id", []), ("start", True), ("start", 1), ("end", float("nan")),
                           ("end", 0), ("panels", ["01", "01"]), ("panels", [{}]),
                           ("confirmed_revision", "r0"), ("performance", "")):
            data = state(); data["unit"]["storyboard"]["shots"][0][key] = value
            self.assertTrue(validate_record(record(data))[0], key)

    def test_grid_exception_needs_explicit_source_and_does_not_waive_preview(self):
        for exception in (False, {}, {"user_authorized": True},
                          {"user_authorized": True, "authorization_source": "用户允许", "failure_reason": ""}):
            data = state(); data["unit"]["storyboard"]["exception"] = exception
            self.assertTrue(validate_record(record(data))[0])
        data = state()
        data["unit"]["storyboard"] = {"revision": "r1", "exception": {
            "user_authorized": True, "authorization_source": "用户明确本段跳过宫格", "failure_reason": "生图不可用"}}
        self.assertEqual(validate_record(record(data))[0], [])
        data["unit"]["preview"]["status"] = "pending"
        self.assertTrue(validate_record(record(data))[0])

    def check_prompt(self, text=None, data=None, valid=True, **kw):
        text = prompt() if text is None else text
        kwargs = dict(platform="libtv", model_version="2.5", asset_mode="mapped", bgm_mode="none", handoff_mode="off", delivery_kind="initial")
        kwargs.update(kw)
        if data is not None:
            kwargs["state_text"] = record(data)
        errors, _ = validate(text, **kwargs)
        self.assertEqual(not errors, valid, errors)

    def test_all_routes_and_platforms(self):
        for route in ("A_full", "B_prompt_only", "C_direct_video"):
            for platform, label in (("libtv", "LibTV"), ("jimeng", "即梦"), ("other", "其他")):
                with self.subTest(route=route, platform=platform):
                    text = record(state(), route=route, platform=label)
                    self.assertEqual(validate_record(text)[0], [])
                    errors, _ = validate(prompt(platform), platform, "2.5", "mapped", "none", "off", state_text=text)
                    self.assertEqual(errors, [])

    def test_templates_start_unconfirmed(self):
        for path in (ROOT / "assets").glob("project-*-template.md"):
            self.assertEqual(validate_record(path.read_text(encoding="utf-8"))[0], [])

    def test_manual_libtv_needs_no_cli_or_remote_nodes_for_all_routes(self):
        for route in ("A_full", "B_prompt_only", "C_direct_video"):
            data = state()
            data["video_execution"] = {"mode": "manual", "selection_source": "用户：不接入，交提示词"}
            text = record(data, route=route)
            self.assertEqual(validate_record(text)[0], [])
            self.assertEqual(validate(prompt(), "libtv", "2.5", "mapped", "none", "off", state_text=text)[0], [])

    def test_old_and_undecided_channels_do_not_block_creative_delivery(self):
        for mode in (None, "pending"):
            data = state()
            data.pop("video_execution", None)
            if mode:
                data["video_execution"] = {"mode": mode, "selection_source": ""}
            self.assertEqual(validate_record(record(data))[0], [])
            self.check_prompt(data=data)

    def test_cli_selection_requires_real_choice_source(self):
        for source in (None, "", "   ", False):
            data = state()
            data["video_execution"] = {"mode": "cli", "selection_source": source}
            self.assertTrue(any("授权来源" in e for e in validate_record(record(data))[0]))
        data["video_execution"]["selection_source"] = "用户：接入LibTV CLI自动运行本段"
        self.assertEqual(validate_record(record(data))[0], [])
        self.check_prompt(data=data)

    def test_cli_channel_is_not_another_platform_or_asset_route(self):
        data = state()
        data["video_execution"] = {"mode": "cli", "selection_source": "用户：接入LibTV CLI"}
        self.assertTrue(any("只适用于LibTV" in e for e in validate_record(record(data, platform="即梦"))[0]))
        data["video_execution"] = {"mode": "manual", "selection_source": "用户：我自己生成"}
        self.assertEqual(validate_record(record(data, platform="即梦"))[0], [])

    def test_invalid_channel_choice_is_reported_without_crash(self):
        for choice in (None, [], "cli", {"mode": "automatic"}):
            data = state()
            data["video_execution"] = choice
            self.assertTrue(any("video_execution" in e for e in validate_record(record(data))[0]))

    def test_quiet_fixed_no_change_and_film_title(self):
        self.check_prompt(data=state())

    def test_published_style_example(self):
        style = (ROOT / "references/style_lock.md").read_text(encoding="utf-8")
        sample = re.findall(r"```text\s*\n(.*?)```", style, re.S)[-1]
        replacement = sample.strip().removeprefix("【风格锁定】").strip()
        text = re.sub(r"(?<=【风格锁定】)\n.*?(?=\n【素材映射】)", "\n" + replacement + "\n", prompt(), flags=re.S)
        self.check_prompt(text)

    def test_bound_voice_must_be_referenced_in_both_dialogue_formats(self):
        for replacement in ("卢卡斯：先等等。", "卢卡斯：“先等等。”"):
            self.check_prompt(prompt().replace("卢卡斯（音频1，平静）：先等等。", replacement), valid=False)

    def test_nonexistent_audio_and_video(self):
        for replacement in ("卢卡斯（音频99，平静）：先等等。", "卢卡斯（音频1，平静）：先等等。\n动作参考视频99。"):
            self.check_prompt(prompt().replace("卢卡斯（音频1，平静）：先等等。", replacement), valid=False)

    def test_wrong_voice_owner(self):
        self.check_prompt(prompt().replace("卢卡斯（音频1", "艾玛（音频1"), valid=False)

    def test_short_anchor_mapping_and_voice_owner(self):
        for platform in ("libtv", "jimeng", "other"):
            text = prompt(platform).replace(SCENE_REFERENCE_BOUNDARY, "")
            text = text.replace("是老宅客厅场景", "作为老宅客厅环境锚定")
            text = text.replace("是卢卡斯的角色声音", "作为卢卡斯音色锚定")
            text = text.replace("用于指定老宅客厅场景", "作为老宅客厅环境锚定")
            text = text.replace("用于指定卢卡斯的角色声音", "作为卢卡斯音色锚定")
            self.check_prompt(text, platform=platform)
            self.check_prompt(text.replace("卢卡斯（音频1", "艾玛（音频1"), platform=platform, valid=False)
            if platform == "other":
                self.check_prompt(text.replace("图1作为老宅客厅环境锚定。", "图1作为老宅客厅环境锚定。\n图1作为老宅客厅环境锚定。"), platform=platform, valid=False)

    def test_equivalent_scene_boundary(self):
        self.check_prompt(prompt().replace(SCENE_REFERENCE_BOUNDARY, "场景图仅作环境氛围参考；不沿用原图空间结构、拍摄方向、焦段、透视、景别及构图，画面按本提示词。"))

    def test_gaps_duplicates_and_repair(self):
        gap = prompt().replace("图1", "图2").replace("Image 1", "Image 2")
        self.check_prompt(gap, valid=False)
        self.check_prompt(gap.replace("图2", "图1").replace("Image 2", "Image 1"))
        self.check_prompt(prompt().replace("{{Image 1}}是老宅客厅场景。", "{{Image 1}}是老宅客厅场景。\n{{Image 1}}是老宅客厅场景。"), valid=False)

    def test_shot_times_and_micro_times(self):
        self.check_prompt(prompt().replace("0—8秒", "1—8秒"), valid=False)
        self.check_prompt(prompt().replace("话音落下", "第2秒话音落下"), valid=False)
        self.check_prompt(prompt().replace("先等等。", "等我3秒。"))

    def test_duration_metadata_and_limit(self):
        self.check_prompt(prompt().replace("总时长8秒", "总时长7秒"), valid=False)
        self.check_prompt(prompt().replace("【风格锁定】", "总时长：8秒\n【风格锁定】"), valid=False)
        self.check_prompt(prompt().replace("0—8秒", "0—31秒"), valid=False)
        self.check_prompt(prompt().replace("0—8秒", "0—16秒").replace("Seedance 2.5", "Seedance 2.0").replace("时长8秒", "时长16秒"), model_version="2.0", valid=False)

    def test_handoff_occlusion_and_running(self):
        self.check_prompt(prompt(handoff=True), handoff_mode="on")
        running = prompt(handoff=True).replace("保持座位关系，艾玛的脚被桌子自然遮挡，两人自然呼吸", "从原位置沿下坡方向继续奔跑，艾玛被卢卡斯局部遮挡，两人不改变路线")
        self.check_prompt(running, handoff_mode="on")
        self.check_prompt(prompt(handoff=True).replace("8—9秒", "8—10秒"), handoff_mode="on", valid=False)
        self.check_prompt(prompt(handoff=True), valid=False)

    def test_old_video_music_modes_are_retired_not_silently_reused(self):
        data = state()
        data["unit"]["bgm_mode"] = "suno"
        data["unit"]["music"] = {"action": "new", "cue_id": "M1", "brief": "安静室内"}
        self.check_prompt(prompt(bgm=True, suno=True), data=data, bgm_mode="suno", valid=False)
        self.check_prompt(prompt(bgm=True), data=data, bgm_mode="suno", valid=False)
        data["unit"]["music"]["action"] = "reuse"
        self.check_prompt(prompt(bgm=True), data=data, bgm_mode="suno", valid=False)
        data["music_library"] = [{"id": "M1", "brief": "安静室内", "prompt_source": "用户已确认Suno提示词M1"}]
        self.check_prompt(prompt(bgm=True), data=data, bgm_mode="suno", valid=False)
        # Archival cues remain valid when the current video has no music.
        data["unit"].update(bgm_mode="none", music={"action": "none", "cue_id": "", "brief": ""})
        self.check_prompt(prompt(), data=data)

    def test_no_bgm_cannot_hide_positive_music_directives(self):
        for instruction in ("BGM以低弦推动。", "配乐：加入钢琴。", "无BGM，但要加入配乐鼓点。"):
            self.check_prompt(prompt().replace("无BGM。", "无BGM。" + instruction), valid=False)
        self.check_prompt(prompt().replace("无BGM。", ""), valid=False)
        self.check_prompt(prompt().replace("无BGM。", "撞击后短促低频随即衰减。无BGM。"))
        self.check_prompt(prompt().replace("先等等。", "把音乐关掉。"))
        self.check_prompt(prompt().replace("老宅客厅，", "老宅客厅有钢琴，"))
        self.check_prompt(prompt() + "\n是否需要BGM？", valid=False)
        self.check_prompt(prompt() + "\n**BGM建议**：加入。", valid=False)
        self.check_prompt(prompt() + "\n```text\nAmbient strings\n```", valid=False)

    def continuous_case(self, form, platform="libtv", handoff=False, duration=25):
        text = prompt(platform, handoff=handoff)
        dialogue = "卢卡斯（音频1，语速稍快）：先等等。"
        if form == "one_take":
            body = "【一镜到底执行声明】\n本段叙事连续拍摄，不切镜，不瞬移。\n【起手式】\n卢卡斯从客厅门边朝窗口疾走。\n【连续动作过程】\n摄影机从正面后退，沿空旷桌侧弧移至侧面，持续跟随他的行动。\n" + dialogue + "\n【最终镜头落点】\n摄影机从侧后方看向窗口，卢卡斯仍警惕窗外。\n"
        else:
            body = "【起手式】\n卢卡斯持刀封住客厅通路，艾玛持刀迫近。\n【打斗过程】\n双方争夺窗口通路，贴近交锋后承受碰撞后退，对手立即追上，边打边向窗口推进。\n" + dialogue + "\n【结束状态】\n艾玛赢得窗口前位，卢卡斯仍在追击，两人各自持刀。\n"
        text = re.sub(r"【镜头序列】.*?(?=【站位交接镜头】|【声音设计】)", lambda _: body, text, flags=re.S)
        text = re.sub(r"叙事时长8秒", f"叙事时长{duration}秒", text)
        text = re.sub(r"总时长\d+秒", f"总时长{duration + int(handoff)}秒", text)
        if handoff:
            text = text.replace("8—9秒", f"{duration}—{duration+1}秒")
        data = state()
        data["unit"].update(prompt_form=form, handoff_mode="on" if handoff else "off")
        board = data["unit"]["storyboard"]
        board["basis"] = "beats" if form == "combat" else "shots"
        board["shots"][0].update(end=duration, panels=["01A", "01B", "01C"])
        return text, data

    def test_continuous_forms_all_routes_platforms_and_handoff(self):
        for form in ("one_take", "combat"):
            for route in ("A_full", "B_prompt_only", "C_direct_video"):
                for platform in ("libtv", "jimeng", "other"):
                    for handoff in (False, True):
                        text, data = self.continuous_case(form, platform, handoff)
                        errors, _ = validate(text, platform, handoff_mode="on" if handoff else "off",
                            state_text=record(data, route=route, platform=platform))
                        self.assertEqual(errors, [], (form, route, platform, handoff, errors))

    def test_continuous_forms_duration_and_grid_cannot_be_bypassed(self):
        for form in ("one_take", "combat"):
            text, data = self.continuous_case(form)
            self.check_prompt(text, data=data)
            bad = copy.deepcopy(data); bad["unit"]["storyboard"]["shots"][0]["end"] = 24
            self.check_prompt(text, data=bad, valid=False)
            bad = copy.deepcopy(data); bad["unit"]["storyboard"]["confirmed_revision"] = "old"
            self.check_prompt(text, data=bad, valid=False)
            self.check_prompt(text.replace("25秒", "31秒"), valid=False)
            self.check_prompt(re.sub(r"【本段生成信息】[^\n]*", "", text), valid=False)
            text30, _ = self.continuous_case(form, handoff=True, duration=30)
            self.check_prompt(text30, handoff_mode="on", valid=False)

    def test_continuous_forms_keep_voice_and_section_gates(self):
        for form in ("one_take", "combat"):
            text, data = self.continuous_case(form)
            self.check_prompt(text.replace("（音频1，语速稍快）", ""), data=data, valid=False)
            self.check_prompt(text.replace("【起手式】", "【镜头序列】"), data=data, valid=False)
            self.check_prompt(text.replace("【起手式】", "【起手式】\n【起手式】"), data=data, valid=False)
            self.check_prompt(text.replace("【起手式】", "【起手式】\n镜头1（0—3秒｜近景）"), data=data, valid=False)
            self.check_prompt(text.replace("【起手式】", "【起手式】\n停顿1秒。"), data=data, valid=False)
            bad=copy.deepcopy(data); bad["unit"]["prompt_form"] = []
            self.assertTrue(validate_record(record(bad))[0])
            self.check_prompt(text, data=state(), valid=False)

    def test_one_take_cannot_claim_cuts_or_multiple_real_shots(self):
        text, data = self.continuous_case("one_take")
        self.check_prompt(text.replace("持续跟随", "切到背面，持续跟随"), data=data, valid=False)
        bad=copy.deepcopy(data)
        bad["unit"]["storyboard"]["shots"][0]["end"] = 10
        second=copy.deepcopy(bad["unit"]["storyboard"]["shots"][0])
        second.update(id="02", start=10, end=25, panels=["02"])
        bad["unit"]["storyboard"]["shots"].append(second)
        self.check_prompt(text, data=bad, valid=False)
        text, data = self.continuous_case("one_take", handoff=True)
        self.check_prompt(text.replace("本段叙事连续", "整条视频连续"), data=data, handoff_mode="on", valid=False)

    def test_one_take_flash_no_hidden_cut_declaration_is_not_a_cut(self):
        text, data = self.continuous_case("one_take")
        for flash in ("闪光", "闪白", "白闪"):
            ban = f"不切镜，不瞬移，不用遮挡、黑场或{flash}隐藏切点。"
            safe = text.replace("不切镜，不瞬移。", ban)
            self.check_prompt(safe, data=data)
            for action in (f"用遮挡、黑场或{flash}隐藏切点。", "遮挡后切到人物背面。"):
                # A preceding prohibition cannot excuse a contradictory action.
                for source in (text, safe):
                    bad = source.replace("持续跟随", action + "持续跟随")
                    errors, _ = validate(bad, "libtv", handoff_mode="off", state_text=record(data))
                    self.assertTrue(any("真一镜到底叙事不能含切镜或遮挡藏切" in e for e in errors),
                                    (flash, action, errors))

    def test_combat_optional_camera_and_beats_mapping(self):
        text, data = self.continuous_case("combat")
        camera = "【特效与运镜】\n交锋以近景为主，随受力方向弧移和快速切近，不固定每次招式机位。\n"
        self.check_prompt(text.replace("【起手式】", camera + "【起手式】"), data=data)
        self.check_prompt(text.replace("【起手式】", camera.replace("交锋", "镜头1（0—3秒）交锋") + "【起手式】"), data=data, valid=False)
        bad=copy.deepcopy(data); bad["unit"]["storyboard"]["basis"] = "shots"
        self.check_prompt(text, data=bad, valid=False)
        # Multiple key states have stable IDs, but do not require literal cut headers.
        data["unit"]["storyboard"]["shots"][0]["end"] = 9
        beat=copy.deepcopy(data["unit"]["storyboard"]["shots"][0])
        beat.update(id="02", start=9, end=25, panels=["02"])
        data["unit"]["storyboard"]["shots"].append(beat)
        self.check_prompt(text, data=data)
        revised=revise_storyboard_shot(data, "02", "r2", "r2")
        self.assertEqual(revised["unit"]["preview"],data["unit"]["preview"])
        self.check_prompt(text, data=revised, valid=False)

    def test_live_action_styles_with_translated_film_reference(self):
        for description in ("原创真人奇幻风格，低照度自然侧光。", "真人实拍雪境动作风格，真实器械重量与低照度自然侧光。"):
            text = re.sub(r"主要视觉参考《风声》[^\n]*", description, prompt())
            self.check_prompt(text)

    def phased_combat_case(self, platform="libtv", handoff=False):
        duration = 29 if handoff else 30
        text, data = self.continuous_case("combat", platform, handoff, duration)
        intervals = [(0, 5), (5, 10), (10, 15), (15, 20), (20, 25), (25, duration)]
        beats = []
        template = data["unit"]["storyboard"]["shots"][0]
        for i, (start, end) in enumerate(intervals, 1):
            beat = copy.deepcopy(template)
            beat.update(id=f"{i:02d}", start=start, end=end, panels=[f"{i:02d}"])
            beats.append(beat)
        data["unit"]["storyboard"]["shots"] = beats
        process = "【打斗过程】\n" + "\n".join(
            f"阶段{i}（{start}—{end}秒｜攻防升级）\n兵器相撞，肩背受力后退，对手立即追击。HARD CUT，切到双方肩侧近景。"
            for i, (start, end) in enumerate(intervals, 1)
        ) + "\n卢卡斯（音频1，语速稍快）：先等等。\n"
        text = re.sub(r"【打斗过程】.*?(?=【结束状态】)", lambda _: process, text, flags=re.S)
        return text, data

    def test_combat_phases_all_routes_channels_and_platforms(self):
        for platform in ("libtv", "jimeng", "other"):
            for handoff in (False, True):
                text, data = self.phased_combat_case(platform, handoff)
                for route in ("A_full", "B_prompt_only", "C_direct_video"):
                    for channel in (("manual", "cli") if platform == "libtv" else ("manual",)):
                        data["video_execution"] = {"mode": channel, "selection_source": "用户明确本轮执行方式"}
                        errors, _ = validate(text, platform, handoff_mode="on" if handoff else "off",
                                             state_text=record(data, route=route, platform=platform))
                        self.assertEqual(errors, [], (platform, handoff, route, channel, errors))

    def test_combat_phase_alternate_headers_and_nonuniform_budgets(self):
        text, data = self.phased_combat_case()
        text = text.replace("0—5秒", "0—4.5秒").replace("5—10秒", "4.5—10秒")
        data["unit"]["storyboard"]["shots"][0]["end"] = 4.5
        data["unit"]["storyboard"]["shots"][1]["start"] = 4.5
        self.check_prompt(text, data=data)
        alternative = re.sub(r"阶段\d+（([\d.]+)—([\d.]+)秒｜[^）]+）\n", r"\1秒—\2秒：", text)
        self.check_prompt(alternative, data=data)

    def test_combat_phases_reject_invalid_budgets_and_hidden_shots(self):
        text, data = self.phased_combat_case()
        for old, new in (
            ("0—5秒", "1—5秒"), ("5—10秒", "4—10秒"),
            ("5—10秒", "6—10秒"), ("5—10秒", "10—10秒"),
            ("25—30秒", "25—29秒"), ("阶段2", "阶段3"),
            ("阶段2（5—10秒｜攻防升级）", "阶段2（5—10秒）"),
            ("兵器相撞", "镜头1（0—1秒｜特写）兵器相撞"),
            ("兵器相撞", "停顿1秒后兵器相撞"),
        ):
            self.check_prompt(text.replace(old, new, 1), data=data, valid=False)
        empty = re.sub(r"(阶段2[^\n]*\n).*?(?=阶段3)", r"\1", text, flags=re.S)
        self.check_prompt(empty, data=data, valid=False)
        misplaced = text.replace("【起手式】", "【起手式】\n0秒—5秒：交战。")
        self.check_prompt(misplaced, data=data, valid=False)
        mixed = text.replace("阶段2（5—10秒｜攻防升级）", "5秒—10秒：")
        self.check_prompt(mixed, data=data, valid=False)

    def test_combat_phases_require_current_confirmed_stage_times(self):
        text, data = self.phased_combat_case()
        bad = copy.deepcopy(data)
        bad["unit"]["storyboard"]["shots"][0]["end"] = 6
        bad["unit"]["storyboard"]["shots"][1]["start"] = 6
        self.check_prompt(text, data=bad, valid=False)
        bad = copy.deepcopy(data)
        bad["unit"]["storyboard"]["confirmed_revision"] = "old"
        self.check_prompt(text, data=bad, valid=False)
        bad = copy.deepcopy(data)
        bad["unit"]["prompt_form"] = "one_take"
        self.check_prompt(text, data=bad, valid=False)

    def test_sound_supports_auxiliary_effects_and_single_final_no_bgm(self):
        cases = [(prompt(), state())] + [self.continuous_case(f) for f in ("one_take", "combat")]
        for text, data in cases:
            for effects in (
                "碰撞时加入短促低频冲击，立即衰减。",
                "人物眩晕时主观耳鸣遮住部分环境声，恢复意识后还原。",
                "原剧情屋外警戒鼓点随距离变远而减弱。",
                "快速转场有短促空气撕裂声，击打同步有锐利音头。",
            ):
                self.check_prompt(text.replace("无BGM。", effects + "无BGM。"), data=data)
            for invalid in ("无BGM。无BGM。", "无BGM。禁止背景音乐。", "无BGM。保留脚步。",
                            "禁止背景音乐。", "加入钢琴伴奏。无BGM。", "加入低弦和声铺底。无BGM。"):
                self.check_prompt(text.replace("无BGM。", invalid), data=data, valid=False)
            self.check_prompt(text.replace("【全局补充】", "【全局补充】\n无BGM。"), data=data, valid=False)

    def test_one_take_still_rejects_hard_cut_and_phase_timing(self):
        text, data = self.continuous_case("one_take")
        self.check_prompt(text.replace("持续跟随", "HARD CUT，持续跟随"), data=data, valid=False)
        self.check_prompt(text.replace("持续跟随", "阶段1（0—5秒｜追逐），持续跟随"), data=data, valid=False)

    def test_published_three_form_examples_compile(self):
        source = (ROOT / "references" / "prompt_examples.md").read_text(encoding="utf-8")
        blocks = list(re.finditer(r"(【本段生成信息】[^\n]+)\n\n```text\n(.*?)```", source, re.S))
        self.assertEqual(len(blocks), 3)
        for i, block in enumerate(blocks, 1):
            delivery = "本批无需上传素材\n" + block[0]
            errors, _ = validate(delivery, "other", asset_mode="text", handoff_mode="off")
            self.assertEqual(errors, [], (i, errors))

    def test_music_appendices_are_rejected_regardless_of_old_suno_format(self):
        self.check_prompt(prompt(bgm=True, suno=True).replace("A soft sustained cello tone.", "x" * 1001), bgm_mode="suno", valid=False)
        self.check_prompt(prompt(bgm=True, suno=True).replace("A soft sustained cello tone.", "The father flees in Scene 2 at 0:20."), bgm_mode="suno", valid=False)
        self.check_prompt(prompt(suno=True), valid=False)

    def test_revision_without_reconfirmation(self):
        data = state()
        data["unit"].update(authorization="user_revision", authorization_source="用户：改固定过肩，不重新确认")
        text = prompt().split("【本段生成信息】", 1)[1]
        self.check_prompt("【本段生成信息】" + text, data=data, delivery_kind="revision", suno_action="none")

    def test_unconfirmed_and_empty_assets_cannot_pass_p5(self):
        self.assertTrue(validate_record(record(state(), route="待确认"))[0])
        for mutate in (
            lambda d: d["snapshot"].update(confirmed=False),
            lambda d: d["snapshot"].update(assets=[]),
            lambda d: d["unit"].update(director_confirmed=False),
            lambda d: d["unit"].update(handoff_mode="pending"),
            lambda d: d["unit"].update(pending_gaps=["当前场景未确认"]),
        ):
            data = state(); mutate(data)
            self.assertTrue(validate_record(record(data))[0])

    def test_future_voices_do_not_block(self):
        data = state(); data["future_voice_preparation"] = ["第三场配角未准备"]
        self.assertEqual(validate_record(record(data))[0], [])
        data["snapshot"]["assets"] = []
        self.assertEqual(validate_record(record(data, stage="P2V"))[0], [])

    def test_generated_dialogue_and_cry_without_audio_reference_all_routes(self):
        data = state()
        data["snapshot"]["assets"] = [a for a in data["snapshot"]["assets"] if a["kind"] != "audio"]
        data["unit"]["bindings"] = [b for b in data["unit"]["bindings"] if b["kind"] != "音频"]
        data["unit"]["dependencies"] = [d for d in data["unit"]["dependencies"] if d["id"] != "AUD-lucas"]
        data["unit"]["required_voices"] = ["卢卡斯", "婴儿"]
        data["capabilities"].update(audio_reference=False, max_audio=0)
        text = prompt().replace("{{Audio 1}}是卢卡斯的角色声音。\n", "")
        text = text.replace("| 02 | 音频1 | upload:卢卡斯.wav | 用户已有 | 声音：卢卡斯 |\n", "")
        text = text.replace("卢卡斯（音频1，平静）：先等等。", "卢卡斯（平静）：先等等。\n婴儿发出哭声。")
        text = text.replace("无BGM。", "对白和哭声由视频模型配音随画面生成。无BGM。")
        for route in ("A_full", "B_prompt_only", "C_direct_video"):
            for mode in ("manual", "cli"):
                data["video_execution"] = {"mode": mode, "selection_source": "用户本轮选择"}
                project = record(data, route=route)
                errors, warnings = validate_record(project)
                self.assertEqual(errors, [], (route, mode))
                self.assertTrue(warnings)
                for variant in (text, text.replace("卢卡斯（平静）：先等等。", "卢卡斯：先等等。")):
                    errors, warnings = validate(variant, "libtv", "2.5", "mapped", "none", "off", state_text=project)
                    self.assertEqual(errors, [], (route, mode))
                    self.assertTrue(warnings)
        legacy = record(data).replace('voice_mode: "reference_or_generated"', 'voice_mode: "mapped_dry_voice"')
        self.assertEqual(validate_record(legacy)[0], [])
        self.check_prompt(text.replace("卢卡斯（平静）", "卢卡斯（音频99，平静）"), data=data, valid=False)

    def test_mixed_reference_and_generated_voice(self):
        data = state()
        data["unit"]["required_voices"] = ["卢卡斯", "艾玛", "婴儿"]
        text = prompt().replace("卢卡斯（音频1，平静）：先等等。", "卢卡斯（音频1，平静）：先等等。\n艾玛（急促）：快走。\n婴儿哭泣。")
        self.check_prompt(text, data=data)
        self.check_prompt(text.replace("艾玛（急促）", "艾玛（音频1，急促）"), data=data, valid=False)
        for stage in ("P3A", "P3B", "P4", "P5", "P6"):
            errors, warnings = validate_record(record(data, stage=stage))
            self.assertEqual(errors, [], stage)
            self.assertTrue(warnings)

    def test_optional_lead_and_crowd_voices_across_video_pipeline(self):
        for reference_count in (0, 1, 2):
            data = state()
            data["unit"]["required_voices"] = ["卢卡斯", "艾玛"] + [f"路人{i}" for i in range(1, 13)]
            data["capabilities"].update(audio_reference=bool(reference_count), max_audio=reference_count)
            text = prompt()
            if reference_count == 0:
                data["snapshot"]["assets"] = [a for a in data["snapshot"]["assets"] if a["kind"] != "audio"]
                data["unit"]["bindings"] = [b for b in data["unit"]["bindings"] if b["kind"] != "音频"]
                data["unit"]["dependencies"] = [d for d in data["unit"]["dependencies"] if d["id"] != "AUD-lucas"]
                text = text.replace("{{Audio 1}}是卢卡斯的角色声音。\n", "")
                text = text.replace("| 02 | 音频1 | upload:卢卡斯.wav | 用户已有 | 声音：卢卡斯 |\n", "")
                text = text.replace("卢卡斯（音频1，平静）", "卢卡斯（平静）")
            if reference_count == 2:
                data["snapshot"]["assets"].append({"id": "AUD-emma", "kind": "audio", "name": "艾玛",
                    "source": "upload:艾玛.wav", "revision": "r1", "user_confirmed": True, "file_role": "voice_reference"})
                data["revisions"]["AUD-emma"] = "r1"
                data["unit"]["bindings"].append({"kind": "音频", "slot": 2, "asset_id": "AUD-emma"})
                data["unit"]["dependencies"].append({"id": "AUD-emma", "revision": "r1"})
                text = text.replace("{{Audio 1}}是卢卡斯的角色声音。", "{{Audio 1}}是卢卡斯的角色声音。\n{{Audio 2}}作为艾玛音色锚定。")
                row = "| 02 | 音频1 | upload:卢卡斯.wav | 用户已有 | 声音：卢卡斯 |"
                text = text.replace(row, row + "\n| 03 | 音频2 | upload:艾玛.wav | 用户已有 | 声音：艾玛 |")
            emma = "艾玛（音频2，低声）" if reference_count == 2 else "艾玛（低声）"
            text = text.replace("话音落下，", f"{emma}：好。\n窗外路人同时发出一阵短促惊呼，声音由远及近后消散。\n话音落下，")
            for route in ("A_full", "B_prompt_only", "C_direct_video"):
                for mode in ("manual", "cli"):
                    data["video_execution"] = {"mode": mode, "selection_source": "用户本轮选择"}
                    for stage in ("P2S", "P2V", "P3A", "P3B", "P4", "P5"):
                        with self.subTest(refs=reference_count, route=route, mode=mode, stage=stage):
                            self.assertEqual(validate_record(record(data, route=route, stage=stage))[0], [])
                    project = record(data, route=route)
                    self.assertEqual(validate(text, "libtv", "2.5", "mapped", "none", "off", state_text=project)[0], [])
                    # Optional audio does not permit phantom slots or using the lead's voice for a bystander.
                    phantom = text.replace(f"{emma}：好。", "艾玛（音频99，低声）：好。")
                    self.assertTrue(validate(phantom, "libtv", "2.5", "mapped", "none", "off", state_text=project)[0])

    def test_unselected_audio_does_not_require_binding_or_fill_voice_gaps(self):
        data = state()
        data["unit"]["required_voices"] = ["卢卡斯", "路人"]
        data["snapshot"]["assets"].extend([
            {"id": "AUD-ambience", "kind": "audio", "name": "街道环境音", "source": "upload:街道.wav",
             "revision": "r1", "user_confirmed": True},
            {"id": "AUD-unknown", "kind": "audio", "name": "待指认", "source": "upload:未知声音.wav",
             "revision": "r1", "user_confirmed": False}])
        data["capabilities"].update(max_audio=1)
        for route in ("A_full", "B_prompt_only", "C_direct_video"):
            self.assertEqual(validate_record(record(data, route=route))[0], [])
            self.assertEqual(validate(prompt(), "libtv", "2.5", "mapped", "none", "off", state_text=record(data, route=route))[0], [])
        # Only truly selected references must remain real and correctly identified.
        with tempfile.TemporaryDirectory() as temp:
            invalid = copy.deepcopy(data)
            invalid["snapshot"]["assets"][1]["source"] = str(Path(temp) / "missing-voice.wav")
            self.assertTrue(validate_record(record(invalid))[0])
        invalid = copy.deepcopy(data)
        invalid["snapshot"]["assets"][1]["user_confirmed"] = False
        self.assertTrue(validate_record(record(invalid))[0])

    def test_vertical_preview_and_fallback(self):
        data = state(); data["unit"]["preview"]["aspect_ratio"] = "16:9"
        self.assertTrue(validate_record(record(data))[0])
        data["unit"]["preview"] = {"status": "text_fallback", "attempts": 2, "failure_reason": "两次画幅均错误"}
        self.assertTrue(validate_record(record(data))[0])
        data["unit"]["preview"].update(unavailable=True)
        self.assertTrue(validate_record(record(data))[0])
        data["unit"]["preview"].update(fallback_authorized=True, fallback_authorization_source="用户明确要求本段跳过首帧")
        self.assertEqual(validate_record(record(data))[0], [])
        data["unit"]["preview"]["attempts"] = 0
        self.assertEqual(validate_record(record(data))[0], [])

    def test_grid_layout_independent_of_video_ratio_for_four_to_nine_panels(self):
        for count in range(4, 10):
            data = state()
            board = data["unit"]["storyboard"]
            prototype = copy.deepcopy(board["shots"][0])
            board["shots"] = []
            for i in range(count):
                shot = copy.deepcopy(prototype)
                shot.update(id=f"{i+1:02d}", start=i*2, end=(i+1)*2, panels=[f"{i+1:02d}"])
                board["shots"].append(shot)
            board.update(canvas_aspect_ratio="4:3", layout=f"实际{count}格，按表演和标签安排，余位留白")
            data["unit"]["preview"].update(kind="grid_panel", source=board["source"],
                panel_id="01", shot_id="01", shot_revision="r1", aspect_ratio="16:9",
                confirmation_source="用户：采用宫格R1及首格构图")
            for route in ("A_full", "B_prompt_only", "C_direct_video"):
                for channel in ("manual", "cli"):
                    data["video_execution"] = {"mode": channel, "selection_source": "用户本轮选择"}
                    errors, _ = validate_record(record(data, route=route, ratio="21:9"))
                    self.assertEqual(errors, [], (count, route, channel, errors))

    def test_grid_panel_ratio_optional_but_adoption_and_source_still_required(self):
        data = state()
        data["unit"]["preview"].update(kind="grid_panel", panel_id="01", shot_id="01", shot_revision="r1")
        del data["unit"]["preview"]["aspect_ratio"]
        self.assertEqual(validate_record(record(data, ratio="21:9"))[0], [])
        for value in ("", "1:1", "4:3", "16:9"):
            data["unit"]["preview"]["aspect_ratio"] = value
            self.assertEqual(validate_record(record(data, ratio="21:9"))[0], [])
        for mutation in ({"aspect_ratio": "0:9"}, {"aspect_ratio": []}, {"user_confirmed": False},
                         {"source": ""}, {"panel_id": "02"}, {"shot_revision": "old"}):
            bad = copy.deepcopy(data)
            bad["unit"]["preview"].update(mutation)
            self.assertTrue(validate_record(record(bad, ratio="21:9"))[0], mutation)
        for value in ("0:3", "invalid", {}):
            bad = copy.deepcopy(data)
            bad["unit"]["storyboard"]["canvas_aspect_ratio"] = value
            self.assertTrue(validate_record(record(bad, ratio="21:9"))[0], value)

    def test_single_frame_input_still_matches_video_not_grid_canvas(self):
        data = state()
        data["unit"]["storyboard"]["canvas_aspect_ratio"] = "4:3"
        data["unit"]["preview"].update(kind="single_frame", aspect_ratio="21:9")
        self.assertEqual(validate_record(record(data, ratio="21:9"))[0], [])
        data["unit"]["preview"]["aspect_ratio"] = "4:3"
        self.assertTrue(validate_record(record(data, ratio="21:9"))[0])

    def test_every_unit_requires_current_image_confirmation(self):
        for sequence in (1, 2, 8):
            for mutate in (
                {"status": "not_required", "required": False},
                {"user_confirmed": False},
                {"revision": "r2"},
                {"confirmation_source": ""},
                {"source": "C:/nonexistent-fixture/first-frame.png"},
            ):
                data = state()
                data["unit"]["sequence_index"] = sequence
                data["unit"]["preview"].update(mutate)
                with self.subTest(sequence=sequence, change=mutate):
                    self.assertTrue(validate_record(record(data))[0])
        data = state()
        data["unit"]["sequence_index"] = 2
        data["unit"]["preview"].update(status="pending", user_confirmed=False)
        self.assertEqual(validate_record(record(data, stage="P3B"))[0], [])
        data["unit"]["preview"].update(status="passed", user_confirmed=True)
        self.assertEqual(validate_record(record(data))[0], [])

    def test_actual_file_and_identity_binding(self):
        data = state(); data["snapshot"]["assets"][1]["source"] = "C:/nonexistent-fixture/voice.wav"
        self.assertTrue(validate_record(record(data))[0])
        self.check_prompt(prompt().replace("{{Audio 1}}是卢卡斯", "{{Audio 1}}是艾玛"), data=state(), valid=False)
        self.check_prompt(prompt().replace("upload:卢卡斯.wav", "upload:错误人物.wav"), data=state(), valid=False)

    def test_silent_text_batch_without_voice_assets(self):
        data = state()
        data["snapshot"].update(mode="text", assets=[])
        data["unit"].update(required_voices=[], bindings=[], dependencies=[{"id": "SETTINGS", "revision": "r1"}])
        text = re.sub(r"【素材映射】.*?(?=【场景与空间锚点】)", "", prompt(), flags=re.S)
        text = "本批无需上传素材\n\n【本段生成信息】" + text.split("【本段生成信息】", 1)[1]
        text = text.replace("卢卡斯（音频1，平静）：先等等。", "卢卡斯安静等待，艾玛没有开口。")
        project = record(data).replace('batch_material_mode: "mapped"', 'batch_material_mode: "text"')
        errors, _ = validate(text, "libtv", "2.5", "text", "none", "off", state_text=project)
        self.assertEqual(errors, [])

    def test_text_dialogue_without_any_local_media(self):
        data = state()
        data["snapshot"].update(mode="text", assets=[])
        data["unit"].update(bindings=[], dependencies=[{"id": "SETTINGS", "revision": "r1"}])
        data["capabilities"].update(audio_reference=False, max_audio=0)
        for platform, label in (("libtv", "LibTV"), ("jimeng", "即梦"), ("other", "其他")):
            text = re.sub(r"【素材映射】.*?(?=【场景与空间锚点】)", "", prompt(platform), flags=re.S)
            text = "本批无需上传素材\n\n【本段生成信息】" + text.split("【本段生成信息】", 1)[1]
            text = text.replace("卢卡斯（音频1，平静）：先等等。", "卢卡斯：先等等。")
            project = record(data, platform=label).replace('batch_material_mode: "mapped"', 'batch_material_mode: "text"')
            errors, warnings = validate(text, platform, "2.5", "text", "none", "off", state_text=project)
            self.assertEqual(errors, [], platform)
            self.assertTrue(warnings)

    def test_platform_capabilities(self):
        data = state(); data["capabilities"]["audio_reference"] = False
        self.assertTrue(validate_record(record(data))[0])
        data = state(); data["capabilities"]["max_duration"] = 5
        self.check_prompt(data=data, valid=False)

    def test_dependency_change_propagates_without_overwrite(self):
        data = state()
        first = copy.deepcopy(data["unit"]); first["id"] = "PREV"
        data["unit_history"] = [first]
        data["unit"]["dependencies"] = [{"id": "END:PREV", "revision": "r1"}]
        data["adoptions"] = [{"unit_id": "PREV", "source": "upload:已采用.mp4", "user_confirmed": True, "end_state": {"position": "左侧"}}]
        changed, affected = apply_change(data, "SCN-room", "r2")
        self.assertEqual(set(affected), {"PREV", "S1-U1"})
        self.assertEqual(changed["adoptions"], data["adoptions"])
        self.assertFalse(data["unit"]["needs_review"])
        self.assertTrue(validate_record(record(changed))[0])

    def test_planned_not_adopted_and_completion(self):
        data = state(); data["unit"]["planned_end"] = {"position": "右侧"}
        self.assertEqual(data["adoptions"], [])
        data["completion"] = {"kind": "prompts", "coverage_checked": True, "evidence": "用户范围台词与原文覆盖完成"}
        self.assertEqual(validate_record(record(data, stage="COMPLETE"))[0], [])
        data["completion"]["kind"] = "film"
        self.assertTrue(validate_record(record(data, stage="COMPLETE"))[0])

    def test_malformed_state_returns_errors(self):
        for key in ("snapshot", "unit", "revisions", "adoptions"):
            data = state(); data[key] = None
            self.assertTrue(validate_record(record(data))[0])


def run() -> int:
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(Regressions)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1

if __name__ == "__main__":
    raise SystemExit(run())
