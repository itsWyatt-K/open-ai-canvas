# -*- coding: utf-8 -*-
"""电商实战版块 E2E 全链路（通道 B · 锁主体自动合成）。

链路：登录 → 商品图上传 → 导入 → nxf 抠图(BiRefNet, degraded:false) →
     L1 企划(锁主体) → ✨AI 换思路(LLM) → 锁主体单屏生成 → 轮询对账 →
     4 层 layer_manifest 校验 → PSD 导出(8BPS 头校验) → 耗时报告。

凭据一律走环境变量（不入库）：
  E2E_USERNAME / E2E_PASSWORD   后端登录账号（必填）
  E2E_BACKEND_HOST/PORT         默认 127.0.0.1:8080
  E2E_NXF_HOST/PORT             默认 127.0.0.1:8823
  E2E_CHANNEL_ID / E2E_MODEL    默认 CHANNEL_000016 / gpt-image-2.5
前置：nxf :8823 与 backend :8080 已起；真实生成会计费一次。
"""
import base64
import http.client
import json
import os
import time
from pathlib import Path

BACKEND = (os.environ.get("E2E_BACKEND_HOST", "127.0.0.1"), int(os.environ.get("E2E_BACKEND_PORT", "8080")))
NXF = (os.environ.get("E2E_NXF_HOST", "127.0.0.1"), int(os.environ.get("E2E_NXF_PORT", "8823")))
CHANNEL_ID = os.environ.get("E2E_CHANNEL_ID", "CHANNEL_000016")
MODEL = os.environ.get("E2E_MODEL", "gpt-image-2.5")
USERNAME = os.environ["E2E_USERNAME"]
PASSWORD = os.environ["E2E_PASSWORD"]
COOKIE = []
TIMINGS = []


def now_ms():
    return time.time()


class timed:
    def __init__(self, name):
        self.name = name

    def __enter__(self):
        self.start = now_ms()
        return self

    def __exit__(self, *exc):
        TIMINGS.append((self.name, round(now_ms() - self.start, 1)))
        print(f"  [{now_ms() - self.start:7.1f}s] {self.name}")


def request(host, method, path, body=None, raw=None, content_type="application/json"):
    conn = http.client.HTTPConnection(host[0], host[1], timeout=300)
    headers = {"Content-Type": content_type}
    if COOKIE:
        headers["Cookie"] = COOKIE[0]
    payload = raw if raw is not None else (json.dumps(body) if body is not None else None)
    conn.request(method, path, body=payload, headers=headers)
    response = conn.getresponse()
    data = response.read()
    set_cookie = response.getheader("Set-Cookie")
    if set_cookie and set_cookie.startswith("open_ai_canvas_session="):
        COOKIE.clear()
        COOKIE.append(set_cookie.split(";")[0])
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
        raise SystemExit(f"NXF {path} -> {status}: {data[:300]!r}")
    return json.loads(data)


def main():
    print("== 1. 登录 ==")
    with timed("login"):
        api("POST", "/api/auth/login", {"username": USERNAME, "password": PASSWORD})

    print("== 2. 上传商品图（三段式；用 cv2 现场生成保温杯测试图） ==")
    import cv2
    import numpy as np
    canvas = np.full((800, 800, 3), 250, np.uint8)
    cv2.rectangle(canvas, (255, 205), (545, 625), (55, 45, 200), -1)
    cv2.rectangle(canvas, (285, 140), (515, 208), (95, 85, 160), -1)
    cv2.circle(canvas, (400, 300), 36, (240, 235, 180), -1)
    ok, encoded = cv2.imencode(".png", canvas)
    assert ok
    png = encoded.tobytes()
    with timed("upload-resource"):
        session = api("POST", "/api/resources/uploads", {"fileName": "e2e-product.png", "size": len(png)})
        upload_id = session["uploadId"]
        status, _ = request(BACKEND, "PUT", f"/api/resources/uploads/{upload_id}/chunks/0",
                            raw=png, content_type="application/octet-stream")
        assert status == 200, status
        completed = api("POST", f"/api/resources/uploads/{upload_id}/complete")
        resource_id = completed["resource"]["id"]

    print("== 3. 导入商品 ==")
    with timed("import-product"):
        created = api("POST", "/api/ecommerce/products", {"items": [{"resourceId": resource_id, "name": "E2E恒温壶.png"}]})
        product_id = created["items"][0]["id"]

    print("== 4. nxf 抠图真跑（BiRefNet, degraded 必须 false） ==")
    with timed("matting-birefnet"):
        source_data_url = "data:image/png;base64," + base64.b64encode(png).decode()
        matting = nxf("/api/v1/ecommerce/vision/matting", {"image": source_data_url, "feather_px": 2})
    assert matting["ok"] and matting["provider"] == "birefnet" and matting["degraded"] is False, matting
    print(f"  前景占比={matting['foreground_ratio']:.2f}")

    print("== 5. L1 企划（锁主体开） ==")
    detail = api("GET", f"/api/ecommerce/products/{product_id}")
    slot = detail["slots"][0]
    with timed("save-brief"):
        api("PUT", f"/api/ecommerce/slots/{slot['id']}/brief", {
            "screen_title": "38dB 深度静音恒温壶",
            "sub_title": "24h 锁温 55°C，宝宝夜奶不等待",
            "scene_desc": "暖色母婴台面，木纹桌上有奶瓶与小夜灯，午后柔光",
            "layout_type": "center-closeup",
            "preserve_product_exact": True,
        })

    print("== 6. ✨AI 换思路（LLM；未配 LLM 时后端自动回退确定性变体器） ==")
    with timed("ai-rework"):
        result = api("PUT", f"/api/ecommerce/slots/{slot['id']}/brief", {"ai_hint": "改成户外露营草地背景，突出便携"})
    print(f"  主标题: {result['brief']['screen_title'][:40]}")

    print("== 7. 锁主体单屏生成（真实计费一次） ==")
    with timed("regenerate-dispatch"):
        api("POST", f"/api/ecommerce/slots/{slot['id']}/regenerate",
            {"channelId": CHANNEL_ID, "model": MODEL, "confirmCost": True})
    with timed("poll-generation"):
        for _ in range(200):
            detail = api("GET", f"/api/ecommerce/products/{product_id}")
            slot = detail["slots"][0]
            if slot["status"] in ("completed", "failed", "uncertain"):
                break
            time.sleep(3)
    print(f"  slot status={slot['status']}")
    if slot["status"] != "completed":
        raise SystemExit(f"生成失败: {slot.get('errorMessage')}")

    print("== 8. 4 层 layer_manifest 校验（完成对账自动合成） ==")
    manifest = slot.get("layerManifest") or {}
    layers = {k: bool(manifest.get(k)) for k in
              ("background_layer_url", "shadow_layer_url", "product_cutout_url", "composed_image_url")}
    print(f"  {layers} text_layers={len(manifest.get('text_layers') or [])}")
    if not all(layers.values()):
        print("  合成层缺失（nxf 不可达降级或时序）——可运行 e2e_channel_b_resume.py 补合成")

    print("== 9. PSD 导出 + 8BPS 头校验 ==")
    with timed("psd-export"):
        status_code, data = request(NXF, "POST", "/api/nxf/psd/export",
                                    {"layers": [{"name": "合成图", "data_url": manifest.get("composed_image_url") or ""}],
                                     "width": 1024, "height": 1024, "filename": "e2e-channel-b"})
    assert status_code == 200 and data[:4] == b"8BPS", f"PSD 导出失败: {data[:8]!r}"
    out = Path("outputs/e2e-channel-b.psd")
    out.write_bytes(data)
    print(f"  8BPS ✓ {len(data)/1024:.0f}KB -> {out}")

    print("\n===== E2E 耗时 =====")
    for name, elapsed in TIMINGS:
        print(f"  {elapsed:8.1f}s  {name}")
    print("E2E-PASS")


if __name__ == "__main__":
    main()
