#!/usr/bin/env python3
"""Read-only project asset inventory for Flagship A/B/C video entry."""

from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".heic"}
AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac", ".aac", ".ogg"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}
SKIP_DIRECTORIES = {".git", "__pycache__", ".cache", "node_modules"}

CATEGORY_ALIASES = {
    "人物": ("01_人物", "01_角色", "人物", "角色", "characters", "character", "cast"),
    "道具": ("02_道具", "道具", "props", "prop"),
    "场景": ("03_场景", "场景", "locations", "location", "scenes", "scene"),
    "声音": ("04_声音", "04_音频", "声音", "音频", "audio", "voices", "voice"),
    "站位参考": ("05_站位参考", "站位参考", "continuity", "handoff"),
}
CATEGORY_ORDER = {name: index for index, name in enumerate((*CATEGORY_ALIASES, "待确认"))}


def media_type(path: Path) -> str | None:
    suffix = path.suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in AUDIO_EXTENSIONS:
        return "audio"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    return None


def category_for(path: Path, root: Path, kind: str) -> str:
    parts = [part.casefold() for part in path.relative_to(root).parts[:-1]]
    for category, aliases in CATEGORY_ALIASES.items():
        for part in parts:
            if any(alias.casefold() in part for alias in aliases):
                return category
    if kind == "audio":
        return "声音"
    if kind == "video":
        return "站位参考"
    return "待确认"


def scan(root: Path) -> dict[str, object]:
    root = root.resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"资产根目录不存在：{root}")

    entries: list[dict[str, object]] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in SKIP_DIRECTORIES or part.startswith(".") for part in relative.parts[:-1]):
            continue
        kind = media_type(path)
        if kind is None:
            continue
        entries.append(
            {
                "category": category_for(path, root, kind),
                "media_type": kind,
                "filename": path.name,
                "relative_path": relative.as_posix(),
                "size_bytes": path.stat().st_size,
                "modified_ns": path.stat().st_mtime_ns,
            }
        )

    entries.sort(
        key=lambda item: (
            CATEGORY_ORDER[str(item["category"])],
            str(item["relative_path"]).casefold(),
        )
    )
    counters: dict[str, int] = {}
    prefixes = {"人物": "人物", "道具": "道具", "场景": "场景", "声音": "声音", "站位参考": "参考", "待确认": "待确认"}
    for item in entries:
        category = str(item["category"])
        counters[category] = counters.get(category, 0) + 1
        item["scan_id"] = f"{prefixes[category]}{counters[category]:02d}"

    return {
        "root": str(root),
        "count": len(entries),
        "counts_by_category": counters,
        "entries": entries,
    }


def render_text(result: dict[str, object]) -> str:
    lines = [f"资产根目录：{result['root']}", f"发现文件：{result['count']}"]
    entries = result["entries"]
    if not entries:
        lines.append("未发现受支持的图片、音频或视频文件。")
        return "\n".join(lines)
    lines.extend(("", "| 序号 | 类别 | 类型 | 文件名 | 相对路径 |", "|---|---|---|---|---|"))
    for item in entries:
        lines.append(
            f"| {item['scan_id']} | {item['category']} | {item['media_type']} | "
            f"{item['filename']} | {item['relative_path']} |"
        )
    return "\n".join(lines)


def self_test() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        fixtures = (
            root / "01_人物" / "主角.png",
            root / "03_场景" / "木屋.webp",
            root / "04_声音" / "主角.wav",
            root / "05_站位参考" / "上一批尾帧.jpg",
            root / "其他素材" / "后段参考.mp4",
            root / "散放声音.wav",
            root / "忽略.txt",
        )
        for fixture in fixtures:
            fixture.parent.mkdir(parents=True, exist_ok=True)
            fixture.write_bytes(b"test")
        result = scan(root)
        categories = [item["category"] for item in result["entries"]]
        assert result["count"] == 6
        assert categories == ["人物", "场景", "声音", "声音", "站位参考", "站位参考"]
        assert {item["media_type"] for item in result["entries"]} == {"image", "audio", "video"}
        assert {item["relative_path"] for item in result["entries"]} == {
            p.relative_to(root).as_posix() for p in fixtures if p.suffix != ".txt"}
        assert [item["scan_id"] for item in result["entries"]] == ["人物01", "场景01", "声音01", "声音02", "参考01", "参考02"]
    print("PASS")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.root:
        parser.error("请提供项目资产根目录，或使用 --self-test")
    try:
        result = scan(Path(args.root))
    except FileNotFoundError as exc:
        print(str(exc))
        return 2
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(render_text(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
