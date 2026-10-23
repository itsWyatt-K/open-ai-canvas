#!/usr/bin/env python3
"""Validate Chaoge 2.0 full ledgers and lightweight production states."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


REQUIRED_FRONTMATTER = {
    "record_schema",
    "record_type",
    "skill_version",
    "project_title",
    "script_version",
    "current_stage",
    "platform",
    "model_version",
    "production_route",
    "batch_material_mode",
    "voice_mode",
}

FULL_SECTIONS = [
    "当前摘要",
    "生产路线与交付策略",
    "剧本解析与创作基准",
    "风格与声音圣经",
    "角色资产",
    "声音准备",
    "关键道具与场景资产",
    "导演单元",
    "动态与连续性资产",
    "视频结果",
    "当前连续性快照",
    "当前批次上传映射",
    "决策与Loop记录",
]

LIGHT_SECTIONS = [
    "当前摘要",
    "创作基准",
    "资产范围",
    "B路线提示词进度",
    "导演地图与视频批次",
    "当前批次上传映射",
    "已交付提示词",
    "采用结果与连续性",
    "决策记录",
]

VALID_STAGES = {
    "P0", "P0R", "P0A", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "COMPLETE"
}
VALID_STATUSES = {"待生成", "候选", "待修改", "已确认", "已采用", "弃用"}
VALID_PROMPT_STATUSES = {"待输出", "待确认", "已确认", "需修改"}
EXPECTED_RECORD_SCHEMA = "2.0"
EXPECTED_SKILL_VERSION = (
    Path(__file__).resolve().parents[1] / "VERSION"
).read_text(encoding="utf-8").strip()

VALID_RECORD_TYPES = {"full_ledger", "light_state"}
VALID_ROUTES = {"待确认", "A_full", "B_prompt_only", "C_direct_video"}
VALID_MATERIAL_MODES = {"待确认", "mapped", "text", "hybrid"}
VALID_VOICE_MODES = {"待确认", "mapped_dry_voice", "model_voice", "post_dub"}


def parse_frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not match:
        return {}
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        fields[key.strip()] = value.strip().strip('"\'')
    return fields


def validate(text: str) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    fields = parse_frontmatter(text)
    if not fields:
        return ["缺少有效YAML前置区"], warnings

    missing = sorted(REQUIRED_FRONTMATTER - set(fields))
    if missing:
        errors.append("缺少前置字段：" + "、".join(missing))

    if fields.get("record_schema") != EXPECTED_RECORD_SCHEMA:
        warnings.append(
            f"记录结构版本为{fields.get('record_schema', '空')}，当前Skill期望{EXPECTED_RECORD_SCHEMA}"
        )
    if fields.get("skill_version") != EXPECTED_SKILL_VERSION:
        warnings.append(
            f"记录Skill版本{fields.get('skill_version', '空')}，当前为{EXPECTED_SKILL_VERSION}"
        )
    if fields.get("current_stage") not in VALID_STAGES:
        errors.append("current_stage不是有效阶段：" + fields.get("current_stage", "空"))

    enum_checks = (
        ("record_type", VALID_RECORD_TYPES),
        ("production_route", VALID_ROUTES),
        ("batch_material_mode", VALID_MATERIAL_MODES),
        ("voice_mode", VALID_VOICE_MODES),
    )
    for field, allowed in enum_checks:
        value = fields.get(field)
        if value is not None and value not in allowed:
            errors.append(f"{field}不是有效值：{value}")

    record_type = fields.get("record_type")
    route = fields.get("production_route")
    if record_type == "full_ledger" and route not in {"A_full", "待确认"}:
        errors.append("完整资产台账只能用于A_full路线")
    if record_type == "light_state" and route == "A_full":
        errors.append("A_full路线必须使用完整资产台账")

    required_sections = FULL_SECTIONS if record_type == "full_ledger" else LIGHT_SECTIONS
    for section in required_sections:
        if not re.search(rf"^##\s+{re.escape(section)}\s*$", text, re.MULTILINE):
            errors.append(f"缺少栏目：## {section}")

    if record_type == "light_state":
        forbidden = ("本地路径", "文件哈希", "目录扫描", "已验证文件")
        found = [token for token in forbidden if token in text]
        if found:
            errors.append("轻量制作状态不得包含本地核验字段：" + "、".join(found))

    ids = re.findall(r"\b(?:CHR|SCN|PRP|DYN|CNT|AUD|VID)-[A-Za-z0-9_\-\u4e00-\u9fff]+", text)
    duplicate_ids = sorted({asset_id for asset_id in ids if ids.count(asset_id) > 1})
    if duplicate_ids:
        warnings.append("稳定ID重复出现，请确认是引用而非重复登记：" + "、".join(duplicate_ids))

    table_statuses = re.findall(
        r"\|\s*(待生成|候选|待修改|已确认|已采用|弃用|待输出|待确认|需修改)\s*\|",
        text,
    )
    for status in table_statuses:
        if status not in VALID_STATUSES | VALID_PROMPT_STATUSES:
            errors.append("无效状态：" + status)

    if "已采用" in text and record_type == "full_ledger" and not re.search(
        r"## 当前连续性快照[\s\S]+人物位置与朝向：\S+", text
    ):
        warnings.append("已有采用视频，但连续性快照可能尚未填写")

    return errors, warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("file", help="UTF-8 full ledger or lightweight production state")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    text = Path(args.file).read_text(encoding="utf-8")
    errors, warnings = validate(text)
    result = {"ok": not errors, "errors": errors, "warnings": warnings}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("PASS" if result["ok"] else "FAIL")
        for item in errors:
            print("ERROR:", item)
        for item in warnings:
            print("WARN:", item)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
