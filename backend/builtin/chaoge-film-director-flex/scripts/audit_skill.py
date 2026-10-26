#!/usr/bin/env python3
"""Audit names, versions, references, executable regressions and install parity."""
from __future__ import annotations
import argparse
import ast
import hashlib
import re
import subprocess
import sys
from pathlib import Path

def manifest(root: Path) -> dict[str, str]:
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob("*") if p.is_file() and "__pycache__" not in p.parts
            and p.suffix != ".pyc"}

def audit(root: Path, installed: Path | None = None) -> list[str]:
    errors = []
    version = (root / "VERSION").read_text(encoding="utf-8").strip()
    main = (root / "SKILL.md").read_text(encoding="utf-8")
    ui = (root / "agents/openai.yaml").read_text(encoding="utf-8")
    if not re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?", version):  # 本地增量：放行合流版后缀
        errors.append("VERSION不是语义版本")
    if f"name: {root.name}" not in main or chr(36) + root.name not in ui:
        errors.append("目录名、技术名或UI调用不一致")
    if f"当前版本：{version}" not in main or version not in ui:
        errors.append("入口/UI版本不一致")
    for p in root.rglob("*.py"):
        if "__pycache__" not in p.parts:
            try:
                ast.parse(p.read_text(encoding="utf-8"), str(p))
            except SyntaxError as exc:
                errors.append(str(exc))
    # 本地增量：重资产外置后，assets/ 引用允许回退 CHAOGE_ASSETS_DIR
    import os as _os
    _ext = Path(_os.environ.get("CHAOGE_ASSETS_DIR", r"D:////AlcheMvision////nxf////_engine////assets////chaoge-v324"))
    for p in root.rglob("*.md"):
        text = p.read_text(encoding="utf-8")
        for ref in re.findall(r"\x60((?:references|scripts|assets)/[^\x60\s<>]+\.(?:md|py))\x60", text):
            if (root / ref).is_file():
                continue
            if ref.startswith("assets/") and ((_ext / ref).is_file() or (_ext / ref.split("/", 1)[1]).is_file()):
                continue
            errors.append(f"{p.name}引用缺失：{ref}")
    retired = (
        "一镜到底必须至少出现2次", "长镜头内至少有2次", "至少同时显示2条独立证据",
        "摄影机只在两类情况下移动", "资产阶段之前提到的偏好只作为预选",
        "所有有台词角色的实际声音文件及身份对应；任何缺失都停在P2S",
        "第二单元起默认不生成分镜", "不设置分镜确认回合",
        "后续只有用户主动要求时才进入P3B", "分镜内部检查不增加确认回合",
        "P3A方案与P3B具体线稿版本始终分开",
        "BGM省略即none", "BGM逐段显式加入", "P3A提案卡必须显示`BGM建议`",
        "必须保留P1已确认的主要片名", "不要再生成另一套一镜到底专用栏目",
    )
    for p in (root / "references").glob("*.md"):
        text = p.read_text(encoding="utf-8")
        for token in retired:
            if token in text:
                errors.append(f"{p.name}复活已删除规则：{token}")
    commands = [
        ["scripts/test_previs_release.py"],
        ["scripts/test_previs_service.py"],
        ["scripts/test_regressions.py"],
        ["scripts/test_style_state.py"],
        ["scripts/test_audio_inspect.py"],
        ["scripts/test_asset_pipeline.py"],
        ["scripts/test_emotion_curve.py"],
        ["scripts/scan_project_assets.py", "--self-test"],
        ["scripts/validate_ledger.py", "assets/project-state-template.md"],
        ["scripts/validate_ledger.py", "assets/project-ledger-template.md"],
    ]
    for command in commands:
        result = subprocess.run([sys.executable, "-B", "-X", "utf8", *command],
            cwd=root, capture_output=True, text=True, encoding="utf-8")
        if result.returncode:
            errors.append(f"{command[0]}失败：\n{result.stdout}\n{result.stderr}")
        else:
            print("PASS:", " ".join(command))
    if installed is not None:
        if not installed.is_dir():
            errors.append("安装目录不存在")
        else:
            a, b = manifest(root), manifest(installed)
            for key in sorted(a.keys() | b.keys()):
                if a.get(key) != b.get(key):
                    errors.append("安装版不一致：" + key)
    if not errors:
        print(f"PASS: version {version}; {len(manifest(root))} release files; executable regressions passed")
    return errors

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("root", nargs="?", default=str(Path(__file__).resolve().parents[1]))
    p.add_argument("--installed")
    args = p.parse_args()
    try:
        if args.installed:
            # 本地增量（2026-10-25）：双轨镜像已废弃，宿主侧改走 yingce_mcp.py 通道，
            # 不再做安装目录一致性比对（旧自动化传 --installed 不会误红）。
            print("WARN: 双轨镜像同步检查已废弃：宿主侧请改用 yingce_mcp.py 通道调用源起技能，"
                  "不要再维护 ~/.workbuddy/skills/ 镜像（本次未做一致性比对）")
            errors = audit(Path(args.root).resolve(), None)
        else:
            errors = audit(Path(args.root).resolve(), None)
    except (OSError, ValueError) as exc:
        errors = [str(exc)]
    for error in errors:
        print("ERROR:", error)
    return int(bool(errors))

if __name__ == "__main__":
    raise SystemExit(main())
