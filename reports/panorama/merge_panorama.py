#!/usr/bin/env python3
"""Regenerate reports/panorama/panorama-merged.md from the chapter files.

Format (reverse-engineered from the committed merged doc and verified by
regenerating the pre-edit version byte-for-byte):
  - custom merged header with the data-baseline note
  - chapters in order 00..13, A, B, C, D
  - each chapter included whole with its H1 demoted to H2
  - chapters joined by a blank line, "---", blank line
"""

from pathlib import Path

HERE = Path(__file__).resolve().parent
CHAPTERS = [
    "00-索引与导读.md", "01-系统总览.md", "02-技术栈与工程规模.md", "03-仓库与版本管理.md",
    "04-后端架构.md", "05-前端架构.md", "06-数据库.md", "07-技能体系.md", "08-画布系统.md",
    "09-电商工坊.md", "10-Agent运行时.md", "11-任务计费与模型路由.md", "12-安全合规与质量.md",
    "13-部署运维与工作区生态.md", "A-术语表.md", "B-路径索引.md", "C-读者自查清单.md",
    "D-数据口径与复现.md",
]

HEADER = """# 源起（open-ai-canvas）系统全景技术文档（合并版）

> 本文是分章版的合并单文件版，便于整份传阅。分章版位于同目录。

> 数据基线：实测 {date}，HEAD = {head}，分支 absorb/upstream-v1.6.5-agent-pi，schema {schema}。
"""


def demote_h1(text: str) -> str:
    lines = text.split("\n")
    if lines and lines[0].startswith("# ") and not lines[0].startswith("## "):
        lines[0] = "#" + lines[0]
    return "\n".join(lines)


def main() -> None:
    header = HEADER.format(date="2026-10-23", head="03e1cb9ec", schema=58)
    parts = [header.rstrip("\n")]
    for name in CHAPTERS:
        body = (HERE / name).read_text(encoding="utf-8").rstrip("\n")
        parts.append(demote_h1(body))
    merged = "\n\n\n---\n\n".join(parts) + "\n\n\n---\n"
    (HERE / "panorama-merged.md").write_text(merged, encoding="utf-8")
    print(f"merged {len(CHAPTERS)} chapters -> panorama-merged.md ({len(merged)} chars)")


if __name__ == "__main__":
    main()
