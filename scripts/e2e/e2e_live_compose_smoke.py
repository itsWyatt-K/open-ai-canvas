#!/usr/bin/env python3
"""live-compose 全链冒烟：背景图 + 透明底文字 banner -> 合成图 + 分层 PSD。"""
import base64
import io
import json
import urllib.request
from pathlib import Path

from PIL import Image

BG = Path(r"D:\AlcheMvision\generated-images\A_cinematic_Mid_Autumn_Festiva_2026-09-25T03-32-27.png")
OUT = Path(r"D:\AlcheMvision\open-ai-canvas\_wt_live_compose")

img = Image.open(BG).convert("RGB")
img.thumbnail((540, 960))
buf = io.BytesIO()
img.save(buf, format="PNG")
bg_data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
print("background:", img.size, len(buf.getvalue()), "bytes")

payload = {
    "background": bg_data_url,
    "subjects": [],
    "banners": [
        {"text": "梦百合直播间", "x": 0.5, "y": 0.12, "font_size": 72, "color": "#FFFFFF",
         "stroke_color": "#8B0000", "stroke_width": 4, "align": "center"},
        {"text": "今晚8点 全场5折", "x": 0.5, "y": 0.88, "font_size": 56, "color": "#FFD700",
         "stroke_color": "#000000", "stroke_width": 3, "align": "center"},
    ],
    "export_psd": True,
    "filename": "live-smoke",
}
req = urllib.request.Request(
    "http://127.0.0.1:8823/api/v1/ecommerce/vision/live-compose",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=120) as resp:
    result = json.load(resp)

print("ok:", result.get("ok"), "| keys:", list(result.keys()))
if not result.get("ok"):
    raise SystemExit("compose failed: " + str(result.get("error")))

OUT.mkdir(parents=True, exist_ok=True)
for key in ("composed_png", "banner_png", "psd_base64", "psd"):
    value = result.get(key)
    if not isinstance(value, str) or not value.startswith("data:"):
        continue
    raw = base64.b64decode(value.split(",", 1)[1])
    suffix = ".psd" if "psd" in key else ".png"
    target = OUT / f"live-smoke-{key.replace('_base64', '')}{suffix}"
    target.write_bytes(raw)
    print(f"saved {target.name}: {len(raw)} bytes, magic={raw[:4].hex()}")
