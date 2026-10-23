#!/usr/bin/env python3
"""Audit Chaoge Skill maintenance invariants without external dependencies."""

from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path


CONTRACTS = (
    ("完整状态机", "SKILL.md", ("P0R 生产路线选择", "P7 Loop诊断、连续性登记与必要抽帧")),
    ("三种制作路线", "references/production_routes.md", ("A_full", "B_prompt_only", "C_direct_video")),
    ("A路线图片优先交付", "references/production_routes.md", ("生图提示词属于内部执行载荷", "回复默认只展示资产名称或ID、生成图片", "只有创作者主动要求")),
    ("三种批次素材方式", "references/production_routes.md", ("`mapped`", "`text`", "`hybrid`")),
    ("P2路线分流", "SKILL.md", ("A 完整资产", "B 提示词资产", "C 直接视频")),
    ("P2资产立项门禁", "references/workflow.md", ("角色", "不纳入项目", "场景")),
    ("B路线分批提示词", "references/production_routes.md", ("只输出第1个已解锁批次", "本批确认后更新轻量状态")),
    ("C路线四类资产表", "references/production_routes.md", ("人物资产表", "道具资产表", "场景资产表", "声音资产表")),
    ("聊天内主交付", "references/workflow.md", ("文件只作备份", "Markdown代码块", "展示每张结果")),
    ("角色资产", "references/character_assets.md", ("9:16", "角色设定板")),
    ("道具资产", "references/prop_assets.md", ("3:4", "不是三视图")),
    ("场景资产", "references/scene_assets.md", ("室外21:9", "室内16:9", "室外拓扑正射地图固定使用16:9横构图", "24至28毫米", "毛坯户型骨架", "独立生成模式", "九宫格补视图", "不是剧本元素黑名单")),
    ("空间风险分级", "references/spatial_preflight.md", ("L1标准任务", "L2高风险任务", "普通室内第一张主视图不再默认制作")),
    ("定点360度补角", "references/scene_360_coverage.md", ("真实首帧", "顺时针匀速旋转360度")),
    ("声音模式与非阻塞", "references/sound_and_music.md", ("mapped_dry_voice", "model_voice", "post_dub", "不因未准备干声阻止")),
    ("视频提示词结构", "references/prompt_templates.md", ("【本批上传ID映射】", "【风格锁定】", "【全局补充】", "5000")),
    ("双记录类型", "references/project_ledger.md", ("full_ledger", "light_state", "batch_material_mode", "voice_mode")),
    ("Seedance 2.0按需兼容", "references/seedance_versions.md", ("用户明确", "15秒")),
    ("Loop风险路由", "references/loop_engineering.md", ("按`spatial_preflight.md`选择最小充分检查",)),
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_files(root: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    for path in root.rglob("*"):
        if not path.is_file() or "__pycache__" in path.parts:
            continue
        result[path.relative_to(root).as_posix()] = digest(path)
    return result


def markdown_blocks(path: Path) -> list[tuple[int, str]]:
    blocks: list[tuple[int, str]] = []
    current: list[str] = []
    start = 1
    in_fence = False
    for number, line in enumerate(read_text(path).splitlines(), 1):
        if line.strip().startswith("```"):
            in_fence = not in_fence
            current = []
            continue
        if in_fence or line.lstrip().startswith("#"):
            continue
        if not line.strip():
            if current:
                normalized = re.sub(r"\s+", "", " ".join(current))
                if len(normalized) >= 140:
                    blocks.append((start, normalized))
                current = []
            continue
        if not current:
            start = number
        current.append(line.strip())
    if current:
        normalized = re.sub(r"\s+", "", " ".join(current))
        if len(normalized) >= 140:
            blocks.append((start, normalized))
    return blocks


def run_check(command: list[str], cwd: Path) -> tuple[bool, str]:
    completed = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    output = "\n".join(part.strip() for part in (completed.stdout, completed.stderr) if part.strip())
    return completed.returncode == 0, output


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit rule ownership, contracts, validators and Skill sync.")
    parser.add_argument("skill_dir", nargs="?", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--installed", help="Optional installed Skill directory to compare with the source.")
    parser.add_argument("--strict-duplicates", action="store_true", help="Treat exact repeated long paragraphs as errors.")
    args = parser.parse_args()

    root = Path(args.skill_dir).resolve()
    errors: list[str] = []
    warnings: list[str] = []

    required = (
        "SKILL.md",
        "VERSION",
        "agents/openai.yaml",
        "assets/project-ledger-template.md",
        "assets/project-state-template.md",
    )
    for relative in required:
        if not (root / relative).is_file():
            errors.append(f"缺少必要文件：{relative}")

    if errors:
        for item in errors:
            print(f"ERROR: {item}")
        return 1

    skill_text = read_text(root / "SKILL.md")
    version = read_text(root / "VERSION").strip()
    interface_text = read_text(root / "agents/openai.yaml")
    skill_match = re.search(r"当前版本：([0-9]+\.[0-9]+\.[0-9]+)", skill_text)
    interface_match = re.search(r"Chaoge AI导演\s+([0-9]+\.[0-9]+\.[0-9]+)", interface_text)
    if not skill_match or skill_match.group(1) != version:
        errors.append("SKILL.md与VERSION版本号不一致")
    if not interface_match or interface_match.group(1) != version:
        errors.append("agents/openai.yaml与VERSION版本号不一致")

    for template_name in ("project-ledger-template.md", "project-state-template.md"):
        template_text = read_text(root / "assets" / template_name)
        template_match = re.search(
            r'^skill_version:\s*["\']?([0-9]+\.[0-9]+\.[0-9]+)',
            template_text,
            re.MULTILINE,
        )
        if not template_match or template_match.group(1) != version:
            errors.append(f"assets/{template_name}与VERSION版本号不一致")
    ledger_reference = root / "references/project_ledger.md"
    if ledger_reference.is_file():
        ledger_reference_match = re.search(r'本版为`([0-9]+\.[0-9]+\.[0-9]+)`', read_text(ledger_reference))
        if not ledger_reference_match or ledger_reference_match.group(1) != version:
            errors.append("references/project_ledger.md与VERSION版本号不一致")
    else:
        errors.append("缺少references/project_ledger.md")

    for name, relative, phrases in CONTRACTS:
        path = root / relative
        if not path.is_file():
            errors.append(f"{name}缺少权威文件：{relative}")
            continue
        text = read_text(path)
        missing = [phrase for phrase in phrases if phrase not in text]
        if missing:
            errors.append(f"{name}功能契约缺失：{relative} -> {', '.join(missing)}")

    paragraph_index: dict[str, list[str]] = defaultdict(list)
    for path in (root / "references").glob("*.md"):
        for line, block in markdown_blocks(path):
            paragraph_index[block].append(f"{path.relative_to(root).as_posix()}:{line}")
    for line, block in markdown_blocks(root / "SKILL.md"):
        paragraph_index[block].append(f"SKILL.md:{line}")
    duplicates = [locations for locations in paragraph_index.values() if len({item.split(":")[0] for item in locations}) > 1]
    for locations in duplicates:
        message = "发现跨文件重复长段：" + " | ".join(locations)
        (errors if args.strict_duplicates else warnings).append(message)

    for relative in ("SKILL.md", "references/workflow.md", "references/loop_engineering.md"):
        text = read_text(root / relative)
        if "4200" in text or "5000" in text:
            errors.append(f"字符预算重复展开：{relative}；唯一权威应为references/prompt_templates.md")
        if all(token in text for token in ("L0局部任务", "L1标准任务", "L2高风险任务")):
            errors.append(f"空间风险定义重复展开：{relative}；唯一权威应为references/spatial_preflight.md")

    ledger_script = root / "scripts/validate_ledger.py"
    prompt_script = root / "scripts/validate_prompt.py"
    if ledger_script.is_file():
        for template_name in ("project-ledger-template.md", "project-state-template.md"):
            ok, output = run_check(
                [sys.executable, str(ledger_script), str(root / "assets" / template_name)], root
            )
            if not ok:
                errors.append(f"{template_name}校验失败" + (f"：{output}" if output else ""))
    else:
        errors.append("缺少scripts/validate_ledger.py")
    if prompt_script.is_file():
        ok, output = run_check([sys.executable, str(prompt_script), "--self-test"], root)
        if not ok:
            errors.append("提示词校验器自测失败" + (f"：{output}" if output else ""))
    else:
        errors.append("缺少scripts/validate_prompt.py")

    if args.installed:
        installed = Path(args.installed).resolve()
        if not installed.is_dir():
            errors.append(f"正式安装目录不存在：{installed}")
        else:
            source = source_files(root)
            target = source_files(installed)
            if source != target:
                missing = sorted(set(source) - set(target))
                extra = sorted(set(target) - set(source))
                changed = sorted(key for key in set(source) & set(target) if source[key] != target[key])
                details = []
                if missing:
                    details.append("未同步=" + ",".join(missing))
                if extra:
                    details.append("仅安装目录存在=" + ",".join(extra))
                if changed:
                    details.append("内容不同=" + ",".join(changed))
                errors.append("两个Skill目录不一致：" + "；".join(details))

    if len(read_text(root / "SKILL.md").splitlines()) > 240:
        warnings.append("SKILL.md超过240行，请确认新增细节是否应迁入专项参考文件")

    for item in warnings:
        print(f"WARN: {item}")
    for item in errors:
        print(f"ERROR: {item}")
    if errors:
        print(f"FAIL: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    print(f"PASS: version {version}; {len(CONTRACTS)} contracts; {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
