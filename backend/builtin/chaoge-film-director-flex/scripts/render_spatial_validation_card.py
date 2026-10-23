#!/usr/bin/env python3
"""Render a deterministic Chinese indoor camera/spatial validation card."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WIDTH, HEIGHT = 1600, 900
BG = "#F4F5F7"
INK = "#171A1F"
BLUE = "#1677FF"
GRAY = "#A7ADB7"
RED = "#D64545"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = [
        "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
    ]
    for name in names:
        if Path(name).exists():
            return ImageFont.truetype(name, size)
    return ImageFont.load_default()


def demo_spec() -> dict:
    return {
        "title": "客厅机位空间验证卡",
        "room": {"label": "客厅", "width": 10, "height": 7},
        "camera": {"x": 9.4, "y": 3.7, "target_x": 2.0, "target_y": 3.2, "label": "摄影机"},
        "elements": [
            {"label": "壁炉", "x": 0.6, "y": 3.0, "w": 0.7, "h": 1.2, "screen_col": "中", "depth": "远", "visibility": "完整"},
            {"label": "三人沙发", "x": 4.8, "y": 1.0, "w": 2.8, "h": 1.0, "screen_col": "右", "depth": "中", "visibility": "完整"},
            {"label": "扶手椅", "x": 3.0, "y": 5.4, "w": 1.1, "h": 0.9, "screen_col": "左", "depth": "前", "visibility": "完整"},
            {"label": "田字格窗", "x": 5.1, "y": 6.65, "w": 1.7, "h": 0.2, "screen_col": "左", "depth": "中", "visibility": "完整"},
            {"label": "垭口", "x": 9.55, "y": 3.0, "w": 0.25, "h": 1.4, "screen_col": "右", "depth": "前", "visibility": "局部"},
        ],
        "notes": ["机位位于门厅通往客厅的垭口", "摄影机背后的墙与家具不得入画"],
    }


def draw_dashed(draw: ImageDraw.ImageDraw, a, b, fill, width=3, dash=12):
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = max(1.0, math.hypot(dx, dy))
    ux, uy = dx / length, dy / length
    p = 0.0
    while p < length:
        q = min(length, p + dash)
        draw.line((a[0] + ux * p, a[1] + uy * p, a[0] + ux * q, a[1] + uy * q), fill=fill, width=width)
        p += dash * 1.7


def render(spec: dict, output: Path) -> None:
    image = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(image)
    draw.text((52, 28), spec.get("title", "室内机位空间验证卡"), fill=INK, font=font(36, True))
    draw.text((52, 78), "左：俯视机位与视锥　｜　右：最终画面屏幕投影", fill="#596170", font=font(19))

    left = (52, 130, 750, 800)
    right = (805, 130, 1548, 800)
    draw.rounded_rectangle(left, radius=18, fill="white", outline="#D4D8DE", width=2)
    draw.rounded_rectangle(right, radius=18, fill="white", outline="#D4D8DE", width=2)

    room = spec["room"]
    rw, rh = float(room["width"]), float(room["height"])
    margin = 66
    rx0, ry0 = left[0] + margin, left[1] + 85
    avail_w, avail_h = left[2] - left[0] - 2 * margin, left[3] - left[1] - 170
    scale = min(avail_w / rw, avail_h / rh)
    rx1, ry1 = rx0 + rw * scale, ry0 + rh * scale

    draw.text((left[0] + 28, left[1] + 22), f"俯视空间图｜{room.get('label', '当前房间')}", fill=INK, font=font(25, True))
    draw.rectangle((rx0, ry0, rx1, ry1), outline=INK, width=6)

    def pt(x, y):
        return rx0 + float(x) * scale, ry0 + float(y) * scale

    elements = spec.get("elements", [])
    for e in elements:
        x0, y0 = pt(e["x"], e["y"])
        x1, y1 = pt(float(e["x"]) + float(e.get("w", 0.5)), float(e["y"]) + float(e.get("h", 0.5)))
        color = GRAY if e.get("visibility") == "不可见" else INK
        draw.rectangle((x0, y0, x1, y1), outline=color, width=3)
        draw.text((x0 + 5, y0 + 4), e["label"], fill=color, font=font(16))

    cam = spec["camera"]
    cx, cy = pt(cam["x"], cam["y"])
    tx, ty = pt(cam["target_x"], cam["target_y"])
    angle = math.atan2(ty - cy, tx - cx)
    ray_len = min(360, math.hypot(tx - cx, ty - cy))
    for delta in (-0.46, 0.46):
        end = (cx + math.cos(angle + delta) * ray_len, cy + math.sin(angle + delta) * ray_len)
        draw_dashed(draw, (cx, cy), end, BLUE, 3)
    draw_dashed(draw, (cx, cy), (tx, ty), BLUE, 4)
    draw.ellipse((cx - 12, cy - 12, cx + 12, cy + 12), fill=BLUE)
    draw.polygon([(tx, ty), (tx - 18 * math.cos(angle - 0.45), ty - 18 * math.sin(angle - 0.45)), (tx - 18 * math.cos(angle + 0.45), ty - 18 * math.sin(angle + 0.45))], fill=BLUE)
    draw.text((cx + 16, cy - 14), cam.get("label", "摄影机"), fill=BLUE, font=font(18, True))
    draw.text((left[0] + 28, left[3] - 54), "蓝色圆点＝摄影机　虚线＝视锥　灰色＝必然不可见", fill="#596170", font=font(16))

    draw.text((right[0] + 28, right[1] + 22), "屏幕构图预演", fill=INK, font=font(25, True))
    gx0, gy0, gx1, gy1 = right[0] + 28, right[1] + 82, right[2] - 28, right[1] + 470
    draw.rectangle((gx0, gy0, gx1, gy1), outline=INK, width=3)
    for i in (1, 2):
        x = gx0 + (gx1 - gx0) * i / 3
        y = gy0 + (gy1 - gy0) * i / 3
        draw.line((x, gy0, x, gy1), fill="#C8CDD4", width=2)
        draw.line((gx0, y, gx1, y), fill="#C8CDD4", width=2)
    cols = {"左": 0, "中": 1, "右": 2}
    rows = {"远": 0, "中": 1, "前": 2}
    for c, idx in cols.items():
        draw.text((gx0 + (gx1 - gx0) * (idx + 0.5) / 3 - 12, gy0 - 30), c, fill="#596170", font=font(18, True))
    for d, idx in rows.items():
        draw.text((gx0 - 38, gy0 + (gy1 - gy0) * (idx + 0.5) / 3 - 10), d, fill="#596170", font=font(18, True))
    buckets = {}
    for e in elements:
        key = (rows.get(e.get("depth", "中"), 1), cols.get(e.get("screen_col", "中"), 1))
        buckets.setdefault(key, []).append(e)
    for (row, col), items in buckets.items():
        cell_x = gx0 + (gx1 - gx0) * col / 3 + 14
        cell_y = gy0 + (gy1 - gy0) * row / 3 + 12
        for n, e in enumerate(items[:4]):
            color = GRAY if e.get("visibility") == "不可见" else (RED if e.get("visibility") == "冲突" else INK)
            draw.text((cell_x, cell_y + n * 28), f"• {e['label']}（{e.get('visibility', '完整')}）", fill=color, font=font(16))

    visible = [e["label"] for e in elements if e.get("visibility") == "完整"]
    partial = [e["label"] for e in elements if e.get("visibility") == "局部"]
    hidden = [e["label"] for e in elements if e.get("visibility") == "不可见"]
    lines = [
        "必然可见：" + ("、".join(visible) or "无"),
        "允许局部：" + ("、".join(partial) or "无"),
        "必然不可见：" + ("、".join(hidden) or "无"),
    ] + list(spec.get("notes", []))
    y = gy1 + 28
    for line in lines[:6]:
        draw.text((right[0] + 30, y), line, fill=INK, font=font(17))
        y += 32

    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output)


def main() -> None:
    parser = argparse.ArgumentParser(description="生成中文室内机位空间验证卡")
    parser.add_argument("--input", type=Path, help="UTF-8 JSON空间规格文件")
    parser.add_argument("--output", type=Path, required=True, help="输出PNG路径")
    parser.add_argument("--demo", action="store_true", help="生成内置客厅示例")
    args = parser.parse_args()
    if args.demo:
        spec = demo_spec()
    elif args.input:
        spec = json.loads(args.input.read_text(encoding="utf-8"))
    else:
        parser.error("必须提供 --input 或 --demo")
    render(spec, args.output)


if __name__ == "__main__":
    main()
