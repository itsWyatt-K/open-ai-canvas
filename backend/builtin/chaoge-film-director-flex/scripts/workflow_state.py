#!/usr/bin/env python3
"""Read-only execution-state validation and dependency-impact preview."""
from __future__ import annotations

import argparse
import copy
import json
import math
import re
from pathlib import Path
from style_state import validate_style

VIDEO_STAGES = {"P3A", "P3B", "P4", "P5", "P6", "P7"}
AUTHORIZED_STAGES = VIDEO_STAGES - {"P3A"}
COMPILED_STAGES = {"P4", "P5", "P6", "P7"}
KINDS = {"图": "image", "音频": "audio", "视频": "video"}


def parse_execution(text: str) -> dict:
    blocks = re.findall(r"(?m)^## 执行状态（机器校验）\s*\n```json\s*\n(.*?)\n```", text, re.S)
    if len(blocks) != 1:
        raise ValueError("必须有且只有一个执行状态JSON块")
    data = json.loads(blocks[0])
    if not isinstance(data, dict):
        raise ValueError("执行状态必须为对象")
    return data


def valid_ratio(value: str) -> bool:
    m = re.fullmatch(r"(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)", value)
    return bool(m and all(float(x) > 0 for x in m.groups()))


def source_exists(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    if value.startswith("upload:"):
        return bool(value[7:].strip())
    p = Path(value)
    return p.is_absolute() and p.is_file()


def validate_asset_reviews(data: dict, fields: dict) -> list[str]:
    errors = []
    scope = data.get("run_scope", "full")
    if scope not in ("full", "assets_only"):
        errors.append("run_scope应为full或assets_only")
    if scope == "assets_only" and fields.get("current_stage") in VIDEO_STAGES | {"P2V", "COMPLETE"}:
        errors.append("assets_only范围不能进入视频阶段；资产结束保留P2")
    if data.get("asset_run_status", "pending") not in ("pending", "in_progress", "complete", "awaiting_external"):
        errors.append("asset_run_status无效")
    policy = data.get("asset_review_policy", {"mode": "user"})
    if not isinstance(policy, dict) or policy.get("mode") not in ("user", "delegated"):
        return errors + ["asset_review_policy无效"]
    if policy["mode"] == "delegated" and not policy.get("authorization_source"):
        errors.append("AI代验收必须有用户授权来源")
    reviews = data.get("asset_reviews", [])
    if not isinstance(reviews, list):
        return errors + ["asset_reviews必须为数组"]
    seen = set()
    for review in reviews:
        if not isinstance(review, dict):
            errors.append("asset_reviews每项必须为对象")
            continue
        rid = review.get("id")
        if not isinstance(rid, str) or not rid or rid in seen:
            errors.append("资产验收ID缺失或重复")
        else:
            seen.add(rid)
        if not isinstance(review.get("asset_id"), str) or not review.get("asset_id"):
            errors.append("验收缺少asset_id")
        if review.get("reviewed_by") not in ("user", "agent") or review.get("evidence") not in ("prompt", "image", "model"):
            errors.append("验收人或证据类型无效")
        if review.get("visual_status") not in ("passed", "failed", "unverified") or review.get("spec_status") not in ("passed", "failed", "unverified"):
            errors.append("视觉与规格状态须分别登记")
        if review.get("disposition") not in ("accepted", "rejected", "pending"):
            errors.append("资产采用状态无效")
        if not isinstance(review.get("findings"), str):
            errors.append("验收findings应为文字依据")
        if review.get("evidence") == "prompt" and review.get("visual_status") == "passed":
            errors.append("提示词检查不能登记为视觉通过")
        if review.get("disposition") != "accepted":
            continue
        if not review.get("authorization_source") or not source_exists(review.get("source")):
            errors.append("采用必须有可追溯授权及实际文件/上传证据")
        if review.get("reviewed_by") == "agent" and policy.get("mode") != "delegated":
            errors.append("未授权AI代验收不能采用资产")
        if fields.get("production_route") == "A_full" and review.get("evidence") == "prompt":
            errors.append("A路线提示词不能代替实际图片/模型采用")
        if review.get("evidence") in ("image", "model") and review.get("visual_status") != "passed":
            errors.append("未通过视觉检查不能采用视觉资产")
        waiver = review.get("spec_exception")
        waived = isinstance(waiver, dict) and waiver.get("user_confirmed") is True and waiver.get("source")
        if review.get("spec_status") != "passed" and not waived:
            errors.append("规格未通过只能待定，或记录用户明确豁免")
    if data.get("asset_run_status") == "complete" and (not reviews or any(
            isinstance(r, dict) and r.get("disposition") == "pending" for r in reviews)):
        errors.append("资产完成需有验收记录且不能存在待定项")
    return errors


def validate_video_execution(data: dict, fields: dict) -> list[str]:
    """Check optional channel choice; never require CLI for prompt delivery.

    This validates recorded intent only, not login, permission or UI evidence.
    Missing fields in older records retain the manual delivery workflow.
    """
    if "video_execution" not in data:
        return []
    choice = data["video_execution"]
    if not isinstance(choice, dict):
        return ["video_execution必须为对象"]
    mode = choice.get("mode")
    if mode not in ("pending", "manual", "cli"):
        return ["video_execution.mode应为pending/manual/cli"]
    if mode != "cli":
        return []
    errors = []
    if fields.get("platform") not in ("LibTV", "libtv"):
        errors.append("当前CLI视频执行只适用于LibTV平台")
    source = choice.get("selection_source")
    if not isinstance(source, str) or not source.strip():
        errors.append("CLI视频执行须记录用户明确选择或自动执行授权来源")
    return errors


def validate_text_proposal(unit: dict) -> list[str]:
    """Check recorded approval for the source range before a sketch is used."""
    proposal = unit.get("text_proposal")
    if not isinstance(proposal, dict):
        return ["绘制草图前须先确认文字AI导演提案的原文范围与安排"]
    required = ("revision", "source_anchor", "start_quote", "end_quote", "display_source", "confirmation_source")
    errors = []
    if any(not isinstance(proposal.get(k), str) or not proposal[k].strip() for k in required):
        errors.append("文字AI导演提案缺少版本、内部原文定位或完整原文展示/确认来源")
    if proposal.get("source_anchor") != unit.get("source_anchor"):
        errors.append("文字提案确认的原文范围与当前单元不一致")
    if not proposal.get("revision") or proposal.get("confirmed_revision") != proposal.get("revision"):
        errors.append("当前文字AI导演提案尚未确认，不能绘制草图")
    return errors


def validate_storyboard(unit: dict, fields: dict) -> list[str]:
    """Validate recorded grid/shot revisions; not visual quality or actual UI delivery."""
    board = unit.get("storyboard")
    if not isinstance(board, dict):
        return ["当前单元缺少宫格提案storyboard"]
    errors = []
    nonempty = lambda x: isinstance(x, str) and bool(x.strip())
    canvas_ratio = board.get("canvas_aspect_ratio")
    if canvas_ratio not in (None, "") and (not isinstance(canvas_ratio, str) or not valid_ratio(canvas_ratio)):
        errors.append("草图整图canvas_aspect_ratio须为有效比例，不要求等于视频画幅")
    form = unit.get("prompt_form", "shots")
    basis = board.get("basis", "shots")
    if form not in ("shots", "one_take", "combat"):
        errors.append("prompt_form须为shots/one_take/combat")
    if basis != ("beats" if form == "combat" else "shots"):
        errors.append("宫格basis须匹配提示词形式；打斗用beats，其余用shots")
    revision = board.get("revision")
    if not nonempty(revision):
        errors.append("宫格提案缺少revision")
    exception = board.get("exception")
    if exception is not None:
        if (not isinstance(exception, dict) or exception.get("user_authorized") is not True
                or not nonempty(exception.get("authorization_source"))
                or not nonempty(exception.get("failure_reason"))):
            errors.append("宫格例外须有用户明确本段授权及原因")
    else:
        if not source_exists(board.get("source")) or not nonempty(board.get("display_source")):
            errors.append("宫格提案缺少实际图片或聊天展示来源")
        if board.get("confirmed_revision") != revision or not nonempty(board.get("confirmation_source")):
            errors.append("当前宫格版本尚未确认")
        shots = board.get("shots")
        if not isinstance(shots, list) or not shots:
            errors.append("宫格提案缺少逐镜记录")
            shots = []
        if form == "one_take" and len(shots) != 1:
            errors.append("一镜到底宫格只有一个真实镜头，多个状态放同镜panels")
        seen_shots, seen_panels = set(), set()
        previous_end = 0
        for shot in shots:
            if not isinstance(shot, dict):
                errors.append("宫格shots每项必须为对象")
                continue
            sid = shot.get("id")
            if not nonempty(sid) or sid in seen_shots:
                errors.append("宫格镜号缺失或重复")
            else:
                seen_shots.add(sid)
            if (not nonempty(shot.get("revision"))
                    or shot.get("confirmed_revision") != shot.get("revision")):
                errors.append("宫格镜头当前版本尚未确认")
            if not nonempty(shot.get("performance")) or not nonempty(shot.get("camera")):
                errors.append("宫格镜头缺少表演或观看方式")
            start, end = shot.get("start"), shot.get("end")
            numeric = lambda x: type(x) in (int, float) and math.isfinite(x)
            if not numeric(start) or not numeric(end) or start != previous_end or end <= start:
                errors.append("宫格镜头时间须从0连续且为正时长")
            if numeric(end):
                previous_end = end
            panels = shot.get("panels")
            if not isinstance(panels, list) or not panels:
                errors.append("宫格镜头缺少格号")
                continue
            for panel in panels:
                if not nonempty(panel) or panel in seen_panels:
                    errors.append("宫格格号缺失或重复；A/B状态应归属同一镜")
                else:
                    seen_panels.add(panel)
    if (fields.get("current_stage") in COMPILED_STAGES
            and unit.get("compiled_storyboard_revision") != revision):
        errors.append("提示词尚未同步当前宫格版本")
    return errors


def revise_storyboard_shot(data: dict, shot_id: str, shot_revision: str, grid_revision: str) -> dict:
    """Invalidate one shot on a copy; never generate images or auto-adopt a revision."""
    result = copy.deepcopy(data)
    unit = result["unit"]
    board = unit["storyboard"]
    shots = board["shots"]
    matches = [shot for shot in shots if shot.get("id") == shot_id]
    if len(matches) != 1:
        raise ValueError("修改镜号必须唯一存在")
    shot = matches[0]
    if (not isinstance(shot_revision, str) or not shot_revision.strip()
            or not isinstance(grid_revision, str) or not grid_revision.strip()
            or shot_revision == shot.get("revision") or grid_revision == board.get("revision")):
        raise ValueError("修改须使用新的镜头与宫格版本")
    shot.update(revision=shot_revision, confirmed_revision="")
    board.update(revision=grid_revision, source="", display_source="",
                 confirmed_revision="", confirmation_source="")
    board.pop("exception", None)
    unit.update(director_confirmed=False, authorization="pending", authorization_source="",
                compiled_storyboard_revision="")
    if shots[0]["id"] == shot_id:
        unit["preview"].update(status="pending", user_confirmed=False,
                               confirmed_revision="", confirmation_source="")
    return result


def validate_execution(data: dict, fields: dict) -> list[str]:
    errors: list[str] = []
    stage = fields.get("current_stage", "")
    # Reject malformed containers before any deeper access; never crash on user records.
    types = {"snapshot": dict, "unit": dict, "revisions": dict, "capabilities": dict,
             "music_library": list, "unit_history": list, "adoptions": list, "completion": dict}
    for key, kind in types.items():
        if not isinstance(data.get(key), kind):
            errors.append(f"execution.{key}必须为{kind.__name__}")
    if errors:
        return errors
    errors.extend(validate_style(data, fields))
    errors.extend(validate_asset_reviews(data, fields))
    errors.extend(validate_video_execution(data, fields))
    snapshot, unit = data["snapshot"], data["unit"]
    assets = snapshot.get("assets")
    if not isinstance(assets, list) or not all(isinstance(x, dict) for x in assets):
        return ["snapshot.assets必须为对象数组"]
    by_id = {}
    for asset in assets:
        aid = asset.get("id")
        if not isinstance(aid, str) or not aid or aid in by_id:
            errors.append("资产稳定ID缺失或重复")
            continue
        by_id[aid] = asset
        if asset.get("kind") not in KINDS.values() or not asset.get("name") or not asset.get("revision"):
            errors.append(f"资产{aid}缺少类别、规范名称或revision")
    if stage in VIDEO_STAGES | {"P2V", "COMPLETE"}:
        if snapshot.get("confirmed") is not True:
            errors.append("实际资产快照尚未由用户确认")
        if snapshot.get("mode") not in {"mapped", "text", "hybrid"}:
            errors.append("快照承担方式尚未明确")
        if fields.get("voice_mode") not in {"reference_or_generated", "mapped_dry_voice"}:
            errors.append("角色声音方式应为reference_or_generated；兼容旧mapped_dry_voice")
    caps = data["capabilities"]
    for key in ("max_duration", "max_images", "max_audio", "max_video"):
        value = caps.get(key)
        if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0):
            errors.append(f"平台能力{key}应为非负数或null")
    if caps.get("audio_reference") not in (None, True, False):
        errors.append("audio_reference应为布尔或null")
    if stage in VIDEO_STAGES | {"COMPLETE"}:
        if data.get("settings_confirmed") is not True or not valid_ratio(fields.get("aspect_ratio", "")):
            errors.append("版本/平台/画幅设置尚未确认或画幅无效")
    if stage in VIDEO_STAGES:
        for key in ("bindings", "required_voices", "pending_gaps", "dependencies", "character_states"):
            if not isinstance(unit.get(key), list):
                errors.append(f"unit.{key}必须为数组")
        for key in ("preview", "music", "planned_end"):
            if not isinstance(unit.get(key), dict):
                errors.append(f"unit.{key}必须为对象")
        if errors:
            return errors
        if unit.get("bgm_mode") != "none" or unit["music"].get("action") != "none":
            errors.append("视频阶段固定bgm_mode=none、music.action=none；旧音乐决定移交成片后期")
        if not unit.get("id") or not unit.get("source_anchor"):
            errors.append("当前单元缺少ID或原文锚点")
        board = unit.get("storyboard")
        if stage in AUTHORIZED_STAGES or (isinstance(board, dict) and board.get("source")):
            errors.extend(validate_text_proposal(unit))
        if type(unit.get("sequence_index")) is not int or unit["sequence_index"] < 1:
            errors.append("当前单元sequence_index无效")
        if unit["pending_gaps"]:
            errors.append("当前单元素材缺口未处理")
        if unit.get("needs_review") is not False:
            errors.append("当前单元依赖变化尚未重检")
        deps = unit["dependencies"]
        if not all(isinstance(x, dict) and isinstance(x.get("id"), str) and isinstance(x.get("revision"), str) for x in deps):
            return errors + ["dependencies必须包含事实ID与revision"]
        dep_ids = [x["id"] for x in deps]
        if len(set(dep_ids)) != len(dep_ids):
            errors.append("dependencies存在重复ID")
        for dep in deps:
            if data["revisions"].get(dep["id"]) != dep["revision"]:
                errors.append(f"依赖{dep['id']}已过期或没有当前revision")
        if "SETTINGS" not in dep_ids:
            errors.append("当前单元未关联项目设置revision")
        seen = set()
        for binding in unit["bindings"]:
            if not isinstance(binding, dict):
                errors.append("bindings须为对象数组")
                continue
            kind, slot = binding.get("kind"), binding.get("slot")
            if kind not in KINDS or type(slot) is not int or slot < 1:
                errors.append("绑定的素材类别或编号无效")
                continue
            if (kind, slot) in seen:
                errors.append("当前单元素材编号重复")
            seen.add((kind, slot))
            asset = by_id.get(binding.get("asset_id"))
            if not asset:
                errors.append("绑定引用不存在的实际资产")
                continue
            if asset.get("kind") != KINDS[kind] or asset.get("user_confirmed") is not True:
                errors.append(f"绑定{kind}{slot}类别错误或未经用户指认")
            if kind == "图" and str(fields.get("platform", "")).casefold().replace(" ", "") == "libtv":
                category = asset.get("category")
                if category not in {"人物", "道具", "场景", "站位参考", "其他"}:
                    errors.append(f"绑定图{slot}须先确认图片category，不能直接把扫描清单当上传队列")
                character = (category == "人物" or str(asset.get("id", "")).startswith("CHR-")
                             or str(asset.get("file_role", "")).startswith("character_"))
                if character and (asset.get("file_role") != "character_sheet"
                        or asset.get("adoption_status") != "adopted"
                        or not isinstance(asset.get("confirmation_source"), str)
                        or not asset.get("confirmation_source", "").strip()):
                    errors.append(f"绑定图{slot}必须为当前已确认人物信息版；竖版/旧版不能作为LibTV最终人物资产")
            if not source_exists(asset.get("source")):
                errors.append(f"绑定{kind}{slot}实际文件不存在或上传来源无效")
            if asset["id"] not in dep_ids or data["revisions"].get(asset["id"]) != asset.get("revision"):
                errors.append(f"绑定{kind}{slot}未关联当前资产revision")
        for kind in KINDS:
            numbers = sorted(n for k, n in seen if k == kind)
            if numbers != list(range(1, len(numbers) + 1)):
                errors.append(f"当前单元{kind}编号不连续")
        if not all(isinstance(x, str) and x for x in unit["required_voices"]):
            errors.append("required_voices应为规范姓名数组")
        # required_voices tracks story needs, not mandatory local reference files.
        # References that ARE bound must still exist and belong to the right actor.
        if any(kind == "音频" for kind, _ in seen) and caps.get("audio_reference") is False:
            errors.append("当前平台入口不支持已绑定的声音输入")
        for kind, cap in (("图", "max_images"), ("音频", "max_audio"), ("视频", "max_video")):
            maximum = caps.get(cap)
            if isinstance(maximum, (int, float)) and sum(k == kind for k, _ in seen) > maximum:
                errors.append(f"当前{kind}素材数超过平台入口上限")
        for actor in unit["character_states"]:
            if not isinstance(actor, dict) or any(not actor.get(k) for k in ("name", "known", "goal", "body", "emotion", "source")):
                errors.append("角色状态缺少已知信息、目标、身体、情绪或依据")
            elif actor.get("evidence_type") not in {"script", "user", "plan", "adopted"}:
                errors.append("角色状态来源类型无效")
    if stage in AUTHORIZED_STAGES:
        errors.extend(validate_storyboard(unit, fields))
        if unit.get("director_confirmed") is not True or unit.get("authorization") not in {"initial", "user_revision"} or not unit.get("authorization_source"):
            errors.append("当前导演方案尚未获得有效用户确认/修订授权")
        if unit.get("handoff_mode") not in {"on", "off"}:
            errors.append("当前单元交接尚未解析")
    if stage in COMPILED_STAGES:
        preview = unit["preview"]
        status = preview.get("status")
        if status == "passed":
            kind = preview.get("kind", "single_frame")
            if kind not in ("single_frame", "grid_panel"):
                errors.append("首帧依据kind应为single_frame或grid_panel")
            if kind == "grid_panel":
                board = unit.get("storyboard")
                shots = board.get("shots") if isinstance(board, dict) else None
                first = shots[0] if isinstance(shots, list) and shots and isinstance(shots[0], dict) else {}
                panels = first.get("panels")
                if (not first or not isinstance(panels, list) or not panels
                        or preview.get("panel_id") != panels[0]
                        or preview.get("shot_id") != first.get("id")
                        or preview.get("shot_revision") != first.get("revision")):
                    errors.append("首帧宫格依据未关联当前第一镜第一状态")
            if kind == "single_frame" and preview.get("aspect_ratio") != fields.get("aspect_ratio"):
                errors.append("独立首帧输入图画幅与视频目标画幅不一致")
            if kind == "grid_panel":
                panel_ratio = preview.get("aspect_ratio")
                if panel_ratio not in (None, "") and (not isinstance(panel_ratio, str) or not valid_ratio(panel_ratio)):
                    errors.append("草图首格aspect_ratio如有记录须为有效比例；可省略，不与视频画幅强制相等")
            if not source_exists(preview.get("source")):
                errors.append("首帧分镜缺少实际图像来源")
            if (preview.get("user_confirmed") is not True
                    or not preview.get("revision")
                    or preview.get("confirmed_revision") != preview.get("revision")
                    or not str(preview.get("confirmation_source") or "").strip()):
                errors.append("首帧分镜当前版本尚未获得用户确认")
        elif status == "text_fallback":
            if (preview.get("fallback_authorized") is not True
                    or not str(preview.get("fallback_authorization_source") or "").strip()
                    or not str(preview.get("failure_reason") or "").strip()):
                errors.append("首帧文字回退缺少用户明确例外授权及原因")
        else:
            errors.append("每个视频单元均须完成首帧图及用户确认")
    for adopted in data["adoptions"]:
        if not isinstance(adopted, dict) or adopted.get("user_confirmed") is not True or not adopted.get("source") or not adopted.get("end_state"):
            errors.append("采用事实缺少用户确认、实际来源或结束状态")
    if stage == "COMPLETE":
        complete = data["completion"]
        if complete.get("kind") not in {"prompts", "film"} or complete.get("coverage_checked") is not True or not complete.get("evidence"):
            errors.append("完成状态缺少范围覆盖检查与完成类型")
        if complete.get("kind") == "film" and (not data["adoptions"] or complete.get("user_confirmed") is not True):
            errors.append("成片完成缺少实际采用与用户确认")
    return errors


def apply_change(data: dict, fact_id: str, revision: str) -> tuple[dict, list[str]]:
    """Return a copy; mark direct/transitive consumers, never alter adopted media."""
    result = copy.deepcopy(data)
    if result["revisions"].get(fact_id) == revision:
        return result, []
    result["revisions"][fact_id] = revision
    dirty = {fact_id}
    affected: list[str] = []
    units = result.get("unit_history", []) + [result.get("unit", {})]
    while True:
        changed = False
        for unit in units:
            uid = unit.get("id")
            if not uid or uid in affected:
                continue
            reasons = [x["id"] for x in unit.get("dependencies", []) if x.get("id") in dirty]
            if reasons:
                unit["needs_review"] = True
                unit["recheck_reasons"] = reasons
                affected.append(uid)
                dirty.add("END:" + uid)
                changed = True
        if not changed:
            return result, affected


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--state", required=True)
    p.add_argument("--changed", required=True)
    p.add_argument("--revision", required=True)
    args = p.parse_args()
    try:
        data = parse_execution(Path(args.state).read_text(encoding="utf-8"))
        _, affected = apply_change(data, args.changed, args.revision)
        print(json.dumps({"affected_units": affected, "writes_performed": False}, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError) as exc:
        print("FAIL:", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
