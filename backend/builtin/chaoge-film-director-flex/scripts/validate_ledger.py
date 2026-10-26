#!/usr/bin/env python3
"""Validate Flagship project metadata and actual per-unit execution gates."""
from __future__ import annotations
import argparse
import json
import re
from pathlib import Path
from workflow_state import parse_execution, validate_execution

REQUIRED_FRONTMATTER = {"record_schema", "record_type", "skill_version", "project_title",
    "script_version", "current_stage", "current_scene", "current_source_boundary",
    "platform", "model_version", "production_route", "batch_material_mode", "voice_mode", "aspect_ratio"}
VALID_STAGES = {"P0", "P0R", "P0S", "P0A", "P1", "P2", "P2S", "P2V", "P3A", "P3B", "P4", "P5", "P6", "P7", "COMPLETE"}
POST_SETTINGS = {"P3A", "P3B", "P4", "P5", "P6", "P7", "COMPLETE"}
EXPECTED_SKILL_VERSION = (Path(__file__).resolve().parents[1] / "VERSION").read_text(encoding="utf-8").strip()

def parse_frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.S)
    if not match:
        return {}
    return {k.strip(): v.strip().strip("\"'") for k, v in
            (line.split(":", 1) for line in match[1].splitlines() if ":" in line)}

def validate(text: str) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    fields = parse_frontmatter(text)
    missing = REQUIRED_FRONTMATTER - fields.keys()
    if missing:
        errors.append("缺少前置字段：" + "、".join(sorted(missing)))
    if fields.get("record_schema") != "1.4":
        errors.append("record_schema必须为1.4；旧记录需另存并按证据迁移")
    if fields.get("skill_version") != EXPECTED_SKILL_VERSION:
        errors.append("skill_version与本分支VERSION不一致")
    if fields.get("current_stage") not in VALID_STAGES:
        errors.append("current_stage无效")
    if fields.get("model_version") not in {"待确认", "Seedance 2.0", "Seedance 2.5"}:
        errors.append("model_version无效")
    if fields.get("platform") not in {"待确认", "即梦", "LibTV", "其他", "jimeng", "libtv", "other"}:
        errors.append("platform无效；未知品牌使用其他")
    if fields.get("current_stage") in POST_SETTINGS and (
        fields.get("model_version") == "待确认" or fields.get("platform") == "待确认"):
        errors.append("进入当前阶段前版本与平台必须明确")
    route, record = fields.get("production_route"), fields.get("record_type")
    if route not in {"待确认", "A_full", "B_prompt_only", "C_direct_video"}:
        errors.append("production_route无效")
    if fields.get("current_stage") in POST_SETTINGS and route == "待确认":
        errors.append("进入当前阶段前生产路线必须明确")
    if record not in {"full_ledger", "light_state"}:
        errors.append("record_type无效")
    if route == "A_full" and record != "full_ledger" or record == "full_ledger" and route not in {"待确认", "A_full"}:
        errors.append("A路线与full_ledger不匹配")
    if fields.get("batch_material_mode") not in {"待确认", "mapped", "text", "hybrid"}:
        errors.append("batch_material_mode无效")
    if fields.get("voice_mode") not in {"待确认", "reference_or_generated", "mapped_dry_voice"}:
        errors.append("voice_mode应为reference_or_generated；兼容旧mapped_dry_voice")
    try:
        data = parse_execution(text)
        errors.extend(validate_execution(data, fields))
        if not errors and fields.get("current_stage") in POST_SETTINGS - {"COMPLETE"}:
            assets = {a["id"]: a for a in data["snapshot"]["assets"]}
            voices = {assets[b["asset_id"]]["name"] for b in data["unit"]["bindings"]
                      if b["kind"] == "音频"}
            missing = sorted(set(data["unit"]["required_voices"]) - voices)
            if missing:
                warnings.append("无本地声音绑定，仅提醒：" + "、".join(missing)
                                + "；保留原文人声安排，随视频生成，不阻塞")
    except (ValueError, TypeError) as exc:
        errors.append("执行状态无法解析：" + str(exc))
    return errors, warnings

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("file")
    p.add_argument("--json", action="store_true")
    args = p.parse_args()
    try:
        errors, warnings = validate(Path(args.file).read_text(encoding="utf-8-sig"))
    except OSError as exc:
        errors, warnings = [str(exc)], []
    result = {"ok": not errors, "errors": errors, "warnings": warnings}
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else
          "\n".join(["PASS" if not errors else "FAIL"] + ["ERROR: " + x for x in errors]
                    + ["WARNING: " + x for x in warnings]))
    return int(bool(errors))

if __name__ == "__main__":
    raise SystemExit(main())
