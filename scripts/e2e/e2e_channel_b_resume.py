# -*- coding: utf-8 -*-
"""电商实战版块 E2E 收尾：轮询到终态 → 通道 B 补合成 → 4 层校验 → PSD 导出。

用于：全链脚本（e2e_channel_b.py）中断后续跑，或对已完成屏补合成。
凭据走环境变量：E2E_USERNAME / E2E_PASSWORD（必填）；主机/端口可选。
按商品名 query=E2E 定位最新商品；真实调 nxf（birefnet/relight）与 PSD 导出。
"""
import base64
import http.client
import json
import os
import time
from pathlib import Path

BACKEND = (os.environ.get("E2E_BACKEND_HOST", "127.0.0.1"), int(os.environ.get("E2E_BACKEND_PORT", "8080")))
NXF = (os.environ.get("E2E_NXF_HOST", "127.0.0.1"), int(os.environ.get("E2E_NXF_PORT", "8823")))
USERNAME = os.environ["E2E_USERNAME"]
PASSWORD = os.environ["E2E_PASSWORD"]
COOKIE = [""]


def request(host, method, path, body=None, raw=None, content_type="application/json"):
    conn = http.client.HTTPConnection(host[0], host[1], timeout=300)
    headers = {"Content-Type": content_type}
    if COOKIE[0]:
        headers["Cookie"] = COOKIE[0]
    payload = raw if raw is not None else (json.dumps(body) if body is not None else None)
    conn.request(method, path, body=payload, headers=headers)
    response = conn.getresponse()
    data = response.read()
    set_cookie = response.getheader("Set-Cookie")
    if set_cookie and set_cookie.startswith("open_ai_canvas_session="):
        COOKIE[0] = set_cookie.split(";")[0]
    conn.close()
    return response.status, data


def api(method, path, body=None):
    status, data = request(BACKEND, method, path, body)
    if status != 200:
        raise SystemExit(f"API {path} -> {status}: {data[:300]!r}")
    return json.loads(data)["data"]


def nxf(path, body):
    status, data = request(NXF, "POST", path, body)
    if status != 200:
        raise SystemExit(f"NXF {path} -> {status}: {data[:200]!r}")
    return json.loads(data)


def url_to_data_url(path):
    status, data = request(BACKEND, "GET", path)
    if status != 200:
        raise SystemExit(f"fetch {path} -> {status}")
    return "data:image/png;base64," + base64.b64encode(data).decode()


def resize_layer(data_url, size):
    """各层缩放到合成图尺寸（PSD 要求层与画布一致）。"""
    import cv2
    import numpy as np
    raw = base64.b64decode(data_url.split(",", 1)[1])
    image = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_UNCHANGED)
    if image.shape[1] != size[0] or image.shape[0] != size[1]:
        interp = cv2.INTER_AREA if image.shape[2] == 3 else cv2.INTER_NEAREST
        image = cv2.resize(image, size, interpolation=interp)
    ok, encoded = cv2.imencode(".png", image)
    assert ok
    return "data:image/png;base64," + base64.b64encode(encoded.tobytes()).decode()


def main():
    api("POST", "/api/auth/login", {"username": USERNAME, "password": PASSWORD})
    products = api("GET", "/api/ecommerce/products?query=E2E&status=all")
    assert products["items"], "找不到 E2E 商品"
    product_id = products["items"][0]["id"]
    detail = api("GET", f"/api/ecommerce/products/{product_id}")
    slot = detail["slots"][0]
    print(f"slot {slot['slotKey']} status={slot['status']} resource={bool(slot.get('resourceId'))}")

    # 1) 未终态则轮询。
    started = time.time()
    while slot["status"] not in ("completed", "failed", "uncertain") and time.time() - started < 600:
        time.sleep(5)
        detail = api("GET", f"/api/ecommerce/products/{product_id}")
        slot = detail["slots"][0]
    print(f"final status: {slot['status']} ({time.time()-started:.0f}s)")
    assert slot["status"] == "completed" and slot.get("resourceId"), f"生成未成功: {slot.get('errorMessage')}"

    # 2) 已有完整 4 层则跳过补合成。
    manifest = slot.get("layerManifest") or {}
    complete = all(manifest.get(k) for k in
                   ("background_layer_url", "shadow_layer_url", "product_cutout_url", "composed_image_url"))
    if not complete:
        print("== 通道 B 补合成（抠图 → relight → 回写） ==")
        started = time.time()
        source = url_to_data_url(f"/api/resources/{detail['product']['sourceResourceId']}/file")
        matting = nxf("/api/v1/ecommerce/vision/matting", {"image": source, "feather_px": 2})
        assert matting["ok"] and matting["degraded"] is False, matting
        print(f"  [{time.time()-started:.1f}s] matting {matting['provider']} ratio={matting['foreground_ratio']:.2f}")
        background = url_to_data_url(f"/api/resources/{slot['resourceId']}/file")
        relight = nxf("/api/v1/ecommerce/vision/relight-compose", {
            "product_cutout": matting["cutout_png"], "background": background,
            "light": "studio", "position": {"x": 0.5, "y": 0.55, "scale": 0.6},
        })
        assert relight["ok"], relight
        manifest = {
            "background_layer_url": background,
            "shadow_layer_url": relight["shadow_layer_png"],
            "product_cutout_url": matting["cutout_png"],
            "product_rect": [0.25, 0.3, 0.5, 0.5],
            "text_layers": [
                {"text": (slot.get("brief") or {}).get("screen_title") or slot.get("title") or "主标题",
                 "color": "#1F1F1F", "x": 0.5, "y": 0.1, "size": 72},
                {"text": (slot.get("brief") or {}).get("sub_title") or "副标题",
                 "color": "#5A5A5A", "x": 0.5, "y": 0.2, "size": 40},
            ],
            "composed_image_url": relight["composed_png"],
        }
        status, _ = request(BACKEND, "PUT", f"/api/ecommerce/slots/{slot['id']}/layers", manifest)
        assert status == 200
        print(f"  [{time.time()-started:.1f}s] 4 层清单回写完成")

    # 3) 4 层校验 + PSD 导出。
    detail = api("GET", f"/api/ecommerce/products/{product_id}")
    got = detail["slots"][0].get("layerManifest") or {}
    checks = {k: bool(got.get(k)) for k in
              ("background_layer_url", "shadow_layer_url", "product_cutout_url", "composed_image_url")}
    print("4层校验:", checks, "text_layers:", len(got.get("text_layers") or []))
    assert all(checks.values()), checks

    import cv2
    import numpy as np
    composed_raw = base64.b64decode(got["composed_image_url"].split(",", 1)[1])
    composed_img = cv2.imdecode(np.frombuffer(composed_raw, np.uint8), cv2.IMREAD_COLOR)
    size = (composed_img.shape[1], composed_img.shape[0])
    status, data = request(NXF, "POST", "/api/nxf/psd/export", {
        "layers": [
            {"name": "背景层", "data_url": resize_layer(got["background_layer_url"], size)},
            {"name": "阴影光效层", "data_url": resize_layer(got["shadow_layer_url"], size)},
            {"name": "商品主体层", "data_url": resize_layer(got["product_cutout_url"], size)},
        ],
        "width": size[0], "height": size[1], "filename": "e2e-channel-b",
    })
    assert status == 200 and data[:4] == b"8BPS", f"PSD 导出失败: {data[:8]!r}"
    out = Path("outputs/e2e-channel-b.psd")
    out.write_bytes(data)
    print(f"PSD 头 8BPS ✓ 画布{size[0]}x{size[1]} {len(data)/1024:.0f}KB -> {out}")
    print("E2E-RESUME-PASS")


if __name__ == "__main__":
    main()
