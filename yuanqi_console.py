# -*- coding: utf-8 -*-
"""
源起 (Genesis) 创作工作台本地控制面板
====================================
系统名：源起 · Genesis Studio
主力模型：gemini-3.8-Flash
架构版本：两段式按需加载架构 (Two-Tier Architecture · P4 运行时)
知识资产：52 部 Single Bundle 工业级大师思想库

用法：双击 启动源起.vbs（静默启动）或 启动源起.bat（排障控制台）即可。
"""

import os
import sys
import json
import re
import time
import socket
import threading
import subprocess
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------- 路径
ROOT = os.path.dirname(os.path.abspath(__file__))
PANEL_PORT = 17580

PYTHON = r"C:\Users\khy\.workbuddy\binaries\python\versions\3.13.12\python.exe"


def _resolve_managed_node() -> str:
    """动态解析 WorkBuddy managed node.exe。

    平台补丁升级会更换 versions 下的目录名（如 22.22.2-3 → 22.22.2-6），
    写死路径必漂移导致前端起不来。这里按版本号取最新，找不到回退 PATH。
    """
    # PYTHON = <binaries>/python/versions/3.13.12/python.exe → 上溯 4 层到 <binaries>
    binaries_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(PYTHON))))
    versions_dir = os.path.join(binaries_root, "node", "versions")
    found = []
    try:
        for name in os.listdir(versions_dir):
            exe = os.path.join(versions_dir, name, "node.exe")
            if os.path.isfile(exe):
                found.append((name, exe))
    except OSError:
        pass
    if not found:
        return "node"

    def _version_key(item):
        name = item[0]
        try:
            parts = tuple(int(p) for p in name.split("-")[0].split("."))
        except ValueError:
            parts = (0,)
        return (parts, name)

    found.sort(key=_version_key, reverse=True)
    return found[0][1]


NODE = _resolve_managed_node()


def _node_path_prefix() -> str:
    """managed node 所在目录 + 路径分隔符；回退到裸 "node" 时返回空串。

    供后端服务的 PATH 注入使用：后端（Go）exec "node" 启动 canvas-agent
    子进程时从 PATH 查找，而前端是用绝对路径 NODE 起的，不受影响。
    """
    node_dir = os.path.dirname(NODE)
    return node_dir + os.pathsep if node_dir else ""


# E-Reverse 侧车：独立 venv（py3.12 + torch/whisperx/transformers），与控制台解释器解耦
EREVERSE_DIR = r"D:\AlcheMvision\工具\e-reverse"
EREVERSE_PYTHON = os.path.join(EREVERSE_DIR, ".venv", "Scripts", "python.exe")

# Windows 进程标志：脱离父进程独立存活
DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200

# 本地服务必须绕开系统/沙箱代理，否则 127.0.0.1 请求会被劫持挂死
CLEAN_PROXY_ENV = {
    "HTTP_PROXY": "", "HTTPS_PROXY": "",
    "http_proxy": "", "https_proxy": "",
    "ALL_PROXY": "", "all_proxy": "",
    "NO_PROXY": "*", "no_proxy": "*",
}

# ---------------------------------------------------------------- 服务清单
# 彻底移除过时 GLM 代理 (8787) 与旧版 nxf 桥接服务 (8823)
# 聚焦三大高可用核心服务，全面协同 gemini-3.8-Flash 主力多模态 Agent
SERVICES = [
    {
        "key": "backend",
        "name": "源起后端核心 (Go Engine)",
        "desc": "「源起」总控引擎。负责多模态画布数据、安全鉴权、Agent 调度与任务流水线。",
        "port": 8080,
        "required": True,
        "cwd": os.path.join(ROOT, ".local"),
        "cmd": [os.path.join(ROOT, ".local", "canvas-backend.exe")],
        "env": {
            "CANVAS_REGISTRATION_ENABLED": "true",
            "CANVAS_ALLOW_PRIVATE_UPSTREAMS": "true",
            "CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS": "127.0.0.1,localhost",
            "CANVAS_BACKEND_ADDR": "127.0.0.1:8080",
            "CANVAS_DESKTOP_LOCAL_CHANNELS_ENABLED": "true",
            "CANVAS_CORS_ORIGINS": "http://localhost:3000",
            "CANVAS_DATA_PATH": "./data",
            # 后端 exec "node" 启动 canvas-agent 子进程时从 PATH 查找（runtime.go 的
            # 环境白名单会显式透传 PATH）。前端用绝对路径 NODE 起得来，后端不行，
            # 故这里把 managed node 所在目录注入 PATH。
            "PATH": _node_path_prefix() + os.environ.get("PATH", ""),
        },
        "log": "backend.log",
        "wait": 20,
    },
    {
        "key": "frontend",
        "name": "源起前端画布 (Vite UI)",
        "desc": "「源起」可视化创作工作台。多模态无限流画布、智能卡片与创作交互界面。",
        "port": 3000,
        "required": True,
        "cwd": os.path.join(ROOT, "web"),
        "cmd": [NODE, "node_modules/vite/bin/vite.js",
                "--host", "127.0.0.1", "--port", "3000", "--strictPort"],
        "env": {},
        "log": os.path.join("web", "vite_dev.log"),
        "wait": 45,
    },
    {
        "key": "nxf",
        "name": "nxf 视觉算子引擎 (StyleForge · 电商分层 · 直播合成)",
        "desc": "FastAPI :8823。视觉DNA九维、电商视觉算子（BiRefNet 抠图 / 重打光 / LaMa 擦除 / 文字 Banner 光栅化 / 直播间合成 / 分层 PSD）。电商工坊与直播间装修台依赖。",
        "port": 8823,
        "required": False,
        # nxf 是工作区级独立仓（D:/AlcheMvision/nxf），不在本仓库内——cwd 必须绝对路径，
        # 写成 ROOT 相对会静默起不来（uvicorn 零日志退出）。
        "cwd": r"D:\AlcheMvision\nxf\_engine\yingce_bridge",
        "cmd": [r"D:\AlcheMvision\nxf\runtimes\venv\Scripts\python.exe", "-m", "uvicorn", "service:app",
                "--host", "127.0.0.1", "--port", "8823"],
        "env": {"PYTHONUTF8": "1", "PYTHONPATH": ""},
        "log": "nxf_service.log",
        # 冷缓存首启要 import onnxruntime/psd 等重依赖，20s 不够——与 frontend 同级。
        "wait": 45,
        # 见 start_service：Python 侧重依赖侧车禁用 DETACHED_PROCESS（0xC0000135 静默死）。
        "noDetached": True,
    },
    {
        "key": "ereverse",
        "name": "E-Reverse 事实表侧车 (词级ASR · VLM)",
        "desc": "视频逆向事实表管线（pft/v1）。支撑工作台 /ereverse 页面：词级时间轴、场景打标、点词跳转。",
        "port": 8790,
        "required": False,
        "cwd": EREVERSE_DIR,
        "cmd": [EREVERSE_PYTHON, "server.py"],
        "env": {},
        "log": "ereverse_sidecar.log",
        "wait": 30,
    },
    {
        "key": "tunnel",
        "name": "公网安全隧道 (Cloudflared)",
        "desc": "将本机「源起」映射为临时安全公网 URL，保障参考图与多媒体资产与上游模型正常通信。",
        "port": 20241,
        "required": False,
        "cwd": os.path.join(ROOT, ".local"),
        "cmd": [os.path.join(ROOT, ".local", "cloudflared.exe"),
                "tunnel",
                "--url", "http://127.0.0.1:8080",
                "--metrics", "127.0.0.1:20241",
                "--no-autoupdate",
                "--loglevel", "info"],
        "env": {},
        "log": "cloudflared.log",
        "wait": 40,
        "on_started": "sync_tunnel_url",
    },
]

SVC_BY_KEY = {s["key"]: s for s in SERVICES}

# ---------------------------------------------------------------- 操作日志
BOOT_TRACE_PATH = os.path.join(ROOT, "console_boot_trace.log")


def boot_trace(msg):
    """启动埋点：每次开机关键节点写入时间戳，便于排障「启动不了」"""
    try:
        import datetime
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(BOOT_TRACE_PATH, "a", encoding="utf-8") as f:
            f.write("[%s] %s\n" % (ts, msg))
    except Exception:
        pass


_event_log = []
_log_lock = threading.Lock()


def log_event(msg, level="info"):
    with _log_lock:
        _event_log.append({
            "t": time.strftime("%H:%M:%S"),
            "level": level,
            "msg": msg,
        })
        if len(_event_log) > 200:
            del _event_log[0]


# ---------------------------------------------------------------- 端口与进程
def port_alive(port, timeout=0.7):
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect(("127.0.0.1", int(port)))
        return True
    except Exception:
        return False
    finally:
        try:
            s.close()
        except Exception:
            pass


def pids_on_port(port):
    """用 netstat 找出占用该端口的 PID"""
    try:
        out = subprocess.run(
            ["netstat", "-ano"],
            capture_output=True, timeout=8
        ).stdout.decode("gbk", errors="ignore")
    except Exception:
        return set()
    pids = set()
    needle = ":%s" % port
    for line in out.splitlines():
        if needle not in line:
            continue
        if "LISTENING" not in line.upper():
            continue
        parts = line.split()
        if len(parts) >= 5 and parts[-1].isdigit():
            pids.add(parts[-1])
    return pids


def start_service(svc):
    if port_alive(svc["port"]):
        log_event("%s 已经在运行了（端口 %s）" % (svc["name"], svc["port"]))
        return "already"

    if not os.path.exists(svc["cmd"][0]):
        log_event("%s 启动失败：找不到目标文件 %s" % (svc["name"], svc["cmd"][0]), "error")
        return "missing"

    env = os.environ.copy()
    env.update(CLEAN_PROXY_ENV)
    env.update(svc.get("env") or {})

    log_path = os.path.join(ROOT, svc.get("log") or "console.log")
    try:
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        logf = open(log_path, "ab")
    except Exception as e:
        log_event("%s 无法写日志：%s" % (svc["name"], e), "error")
        logf = subprocess.DEVNULL

    try:
        # noDetached：Python 重依赖侧车（onnxruntime/psd 等原生 DLL）在
        # DETACHED_PROCESS + 文件重定定向下会以 0xC0000135 静默死亡（实测复现），
        # 改用 CREATE_NEW_PROCESS_GROUP 单体即可正常加载。Go exe 不受影响。
        spawn_flags = CREATE_NEW_PROCESS_GROUP if svc.get("noDetached") else (DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
        subprocess.Popen(
            svc["cmd"],
            cwd=svc["cwd"],
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=logf,
            stderr=subprocess.STDOUT,
            creationflags=spawn_flags,
            close_fds=True,
        )
    except Exception as e:
        log_event("%s 启动失败：%s" % (svc["name"], e), "error")
        return "error"

    log_event("正在拉起 %s ..." % svc["name"])

    deadline = time.time() + int(svc.get("wait") or 25)
    while time.time() < deadline:
        time.sleep(1)
        if port_alive(svc["port"]):
            log_event("%s 已成功就绪（端口 %s）" % (svc["name"], svc["port"]), "ok")
            _run_on_started(svc)
            return "ok"

    log_event("%s 启动等待超时（端口 %s 未监听）。可点击「查看日志」排查。"
              % (svc["name"], svc["port"]), "warn")
    return "timeout"


def _run_on_started(svc):
    hook = svc.get("on_started")
    if not hook:
        return
    fn = globals().get(hook)
    if not fn:
        return
    try:
        fn()
    except Exception as e:
        log_event("%s 启动后动作失败：%s" % (svc["name"], e), "error")


def stop_service(svc):
    pids = pids_on_port(svc["port"])
    if not pids:
        log_event("%s 当前未运行" % svc["name"])
        return "notrunning"
    for pid in pids:
        subprocess.run(["taskkill", "/F", "/PID", pid],
                       capture_output=True, timeout=8)
    time.sleep(1)
    if port_alive(svc["port"]):
        log_event("%s 停止失败，端口 %s 仍被占用" % (svc["name"], svc["port"]), "error")
        return "stuck"
    log_event("%s 已停止" % svc["name"])
    return "ok"


def tail_log(svc, lines=70):
    path = os.path.join(ROOT, svc.get("log") or "console.log")
    if not os.path.exists(path):
        return "(暂无日志记录)"
    try:
        with open(path, "rb") as f:
            data = f.read()
        text = data.decode("utf-8", errors="ignore")
    except Exception as e:
        return "(读取日志失败：%s)" % e
    tail = text.splitlines()[-lines:]
    return "\n".join(tail)


# ---------------------------------------------------------------- 公网隧道
TUNNEL_URL_RE = re.compile(r"https://[a-z0-9][a-z0-9-]*\.trycloudflare\.com")
TUNNEL_CRED_PATH = os.path.join(ROOT, ".local", "tunnel-sync.json")
TUNNEL_BACKEND = "http://127.0.0.1:8080"


def read_tunnel_url():
    path = os.path.join(ROOT, "cloudflared.log")
    try:
        with open(path, "rb") as f:
            text = f.read().decode("utf-8", errors="ignore")
    except Exception:
        return ""
    m = TUNNEL_URL_RE.search(text)
    return m.group(0) if m else ""


def _tunnel_credentials():
    try:
        with open(TUNNEL_CRED_PATH, "r", encoding="utf-8") as f:
            d = json.load(f)
        user = str(d.get("username") or "").strip()
        pwd = str(d.get("password") or "").strip()
        if user and pwd:
            return user, pwd
    except Exception:
        pass
    return "", ""


def _http_json(method, url, body=None, cookie=None, timeout=25):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", cookie)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, resp.headers.get("Set-Cookie", ""), json.loads(raw or "{}")
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, e.headers.get("Set-Cookie", ""), json.loads(raw or "{}")
        except Exception:
            return e.code, "", {"raw": raw[:300]}


def _session_cookie():
    user, pwd = _tunnel_credentials()
    if not user:
        return ""
    last = ""
    for _ in range(6):
        st, set_cookie, res = _http_json(
            "POST", TUNNEL_BACKEND + "/api/auth/login",
            {"username": user, "password": pwd})
        if st == 200:
            m = re.search(r"(open_ai_canvas_session=[^;]+)", set_cookie or "")
            if m:
                return m.group(1)
            last = "响应里未包含会话 Cookie"
        else:
            last = "%s %s" % (st, res.get("msg") or "")
        time.sleep(2)
    log_event("隧道地址同步失败：无法登录源起后端（%s）" % last, "warn")
    return ""


def current_public_base_url(cookie):
    st, _, res = _http_json("GET", TUNNEL_BACKEND + "/api/admin/settings/oss", cookie=cookie)
    if st != 200:
        return ""
    setting = (res.get("data") or {}).get("setting") or {}
    return str(setting.get("publicBaseUrl") or "").strip()


def sync_tunnel_url():
    if not port_alive(SVC_BY_KEY["backend"]["port"], timeout=0.5):
        log_event("源起后端尚未就绪，跳过隧道地址同步", "warn")
        return
    cookie = _session_cookie()
    if not cookie:
        log_event("隧道同步跳过：缺少管理员凭据（检查 .local\\tunnel-sync.json）", "warn")
        return

    url = ""
    deadline = time.time() + 40
    while time.time() < deadline:
        url = read_tunnel_url()
        if url:
            break
        time.sleep(1.5)
    if not url:
        log_event("未检测到有效隧道公网地址，请查看 cloudflared.log", "warn")
        return

    if current_public_base_url(cookie) == url:
        log_event("隧道公网地址未变，保持为 %s" % url)
        return

    last = ""
    for attempt in range(1, 9):
        st, _, res = _http_json(
            "PATCH", TUNNEL_BACKEND + "/api/admin/settings/oss",
            {"publicBaseUrl": url}, cookie=cookie)
        if st == 200:
            log_event("已将源起服务器公网地址设为 %s（多模态资产上行通道已连通）" % url, "ok")
            return
        last = str(res.get("msg") or res.get("raw") or "")[:120]
        log_event("第 %d 次同步地址重试中（%s）..." % (attempt, last), "warn")
        time.sleep(4)
    log_event("写入源起服务器公网地址失败：%s" % last, "error")


# ---------------------------------------------------------------- 升级版现代化前端界面
PANEL_HTML = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>源起 (Genesis) 智能创作工作台 · 控制台</title>
<style>
:root {
  --bg-deep: #0b0f19;
  --bg-surface: #111827;
  --bg-card: #162032;
  --bg-card-hover: #1c2940;
  --border: #24344d;
  --border-glow: rgba(14, 165, 233, 0.4);
  
  --gold: #f59e0b;
  --gold-light: #fbbf24;
  --cyan: #06b6d4;
  --emerald: #10b981;
  --rose: #f43f5e;
  --amber: #f59e0b;
  
  --text-main: #f1f5f9;
  --text-muted: #94a3b8;
  --text-dim: #64748b;
  
  --radius-lg: 16px;
  --radius-md: 12px;
  --radius-sm: 8px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--bg-deep);
  color: var(--text-main);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  line-height: 1.6;
  padding: 36px 24px;
  min-height: 100vh;
}

.wrap {
  max-width: 1040px;
  margin: 0 auto;
}

/* 顶部 Brand 头部 */
header {
  background: linear-gradient(135deg, rgba(22,32,50,0.85) 0%, rgba(17,24,39,0.95) 100%);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 28px 32px;
  margin-bottom: 24px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.3);
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
  position: relative;
  overflow: hidden;
}
header::before {
  content: "";
  position: absolute;
  top: 0; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, #f59e0b, #06b6d4, #10b981);
}

.brand-info {
  display: flex;
  align-items: center;
  gap: 16px;
}
.brand-icon {
  width: 52px; height: 52px;
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  flex-shrink: 0;
}
.brand-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 10px;
}
.brand-title .tag {
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(6,182,212,0.15);
  border: 1px solid rgba(6,182,212,0.4);
  color: #38bdf8;
  border-radius: 20px;
  font-weight: 500;
}
.brand-sub {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 4px;
}

.meta-badges {
  display: flex;
  flex-direction: column;
  gap: 8px;
  text-align: right;
}
.badge-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  justify-content: flex-end;
}
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(30,41,59,0.8);
  border: 1px solid var(--border);
  color: var(--text-muted);
}
.pill.gold {
  border-color: rgba(245,158,11,0.3);
  color: #fde68a;
  background: rgba(245,158,11,0.1);
}
.pill.cyan {
  border-color: rgba(6,182,212,0.3);
  color: #67e8f9;
  background: rgba(6,182,212,0.1);
}
.meta-login {
  font-size: 12px;
  color: var(--text-dim);
}
.meta-login b {
  color: #e2e8f0;
}

/* 控制工具条 */
.toolbar {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: 24px;
}
button {
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-main);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
button:hover {
  background: var(--bg-card-hover);
  border-color: var(--text-dim);
  transform: translateY(-1px);
}
button:active {
  transform: translateY(0);
}
button.primary {
  background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
  border-color: #0284c7;
  color: #fff;
  box-shadow: 0 4px 12px rgba(2,132,199,0.3);
}
button.primary:hover {
  background: linear-gradient(135deg, #0369a1 0%, #075985 100%);
}
button.gold {
  background: linear-gradient(135deg, #d97706 0%, #b45309 100%);
  border-color: #f59e0b;
  color: #fff;
  box-shadow: 0 4px 12px rgba(245,158,11,0.25);
}
button.gold:hover {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
}
button.danger {
  background: rgba(244,63,94,0.12);
  border-color: rgba(244,63,94,0.35);
  color: #fda4af;
}
button.danger:hover {
  background: rgba(244,63,94,0.25);
  border-color: var(--rose);
}
button.sm {
  padding: 6px 14px;
  font-size: 12px;
}

/* 服务卡片容器 */
.cards-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 24px;
}
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 20px 24px;
  display: flex;
  align-items: center;
  gap: 20px;
  transition: all 0.25s ease;
}
.card:hover {
  border-color: rgba(14,165,233,0.35);
  box-shadow: 0 6px 20px rgba(0,0,0,0.25);
}
.card.on {
  border-left: 4px solid var(--emerald);
}
.card.off {
  border-left: 4px solid var(--border);
  opacity: 0.85;
}
.card.busy {
  border-left: 4px solid var(--amber);
}

.status-indicator {
  position: relative;
  width: 14px; height: 14px;
  flex: 0 0 14px;
}
.status-dot {
  width: 14px; height: 14px;
  border-radius: 50%;
  background: var(--text-dim);
}
.card.on .status-dot {
  background: var(--emerald);
  box-shadow: 0 0 12px rgba(16,185,129,0.8);
}
.card.busy .status-dot {
  background: var(--amber);
  animation: pulse 1s infinite alternate;
}
@keyframes pulse {
  0% { opacity: 0.4; transform: scale(0.85); }
  100% { opacity: 1; transform: scale(1.15); }
}

.card-info {
  flex: 1;
  min-width: 0;
}
.card-title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
.card-name {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}
.card-port {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  background: rgba(30,41,59,0.9);
  border: 1px solid var(--border);
  padding: 1px 7px;
  border-radius: 4px;
  color: #38bdf8;
}
.card-desc {
  font-size: 13px;
  color: var(--text-muted);
}
.card-status {
  font-size: 12px;
  font-weight: 500;
  margin-top: 6px;
}
.card.on .card-status { color: var(--emerald); }
.card.off .card-status { color: var(--text-dim); }
.card.busy .card-status { color: var(--amber); }

.card-actions {
  display: flex;
  gap: 8px;
  flex: 0 0 auto;
}

/* 隧道卡片 */
.tunnel-box {
  background: linear-gradient(135deg, rgba(6,182,212,0.08) 0%, rgba(17,24,39,0.7) 100%);
  border: 1px solid rgba(6,182,212,0.3);
  border-radius: var(--radius-md);
  padding: 16px 20px;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.tunnel-url {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13.5px;
  color: #38bdf8;
  text-decoration: none;
  word-break: break-all;
}
.tunnel-url:hover { text-decoration: underline; }

/* 日志框 */
.logbox {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 20px 24px;
}
.log-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.log-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--gold-light);
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.logbody {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.8;
  color: #cbd5e1;
  max-height: 250px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  padding-right: 6px;
}
.logbody .k { color: #34d399; }
.logbody .w { color: #fbbf24; }
.logbody .e { color: #f87171; }
.logbody .t { color: #64748b; }

/* 模态弹窗 */
.modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(11,15,25,0.85);
  backdrop-filter: blur(8px);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal.show { display: flex; }
.modal-content {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  width: 90%;
  max-width: 720px;
  padding: 24px 28px;
  box-shadow: 0 20px 40px rgba(0,0,0,0.5);
}
.modal-content h4 {
  color: var(--gold-light);
  font-size: 15px;
  margin-bottom: 14px;
}
.modal-content pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: #e2e8f0;
  background: #0b0f19;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 16px;
  max-height: 380px;
  overflow: auto;
  line-height: 1.7;
}

footer {
  margin-top: 32px;
  padding-top: 20px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-dim);
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
</style>
</head>
<body>
<div class="wrap">

<header>
  <div class="brand-info">
    <div class="brand-icon">
      <img src="data:image/png;base64,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" width="36" height="36" style="object-fit:contain;display:block;" alt="源起 Logo">
    </div>
    <div>
      <div class="brand-title">
        源起 · 智能创作工作台
        <span class="tag">Genesis v3.2</span>
      </div>
      <div class="brand-sub">Genesis Multi-Agent Studio · 本地多智能体工业级协同总控</div>
    </div>
  </div>
  <div class="meta-badges">
    <div class="badge-row">
      <span class="pill cyan">🤖 Agent 模型: <strong>gemini-3.8-Flash</strong></span>
      <span class="pill gold">⚡ 架构: <strong>两段式 P4 运行时就绪</strong></span>
    </div>
    <div class="meta-login">
      工作台: <b>http://127.0.0.1:3000</b> &nbsp;|&nbsp; 账号 <b>jinji</b> / 密码 <b>jinji666</b>
    </div>
  </div>
</header>

<div class="toolbar">
  <button class="primary" id="btnStartAll">⚡ 一键启动全部</button>
  <button class="danger" id="btnStopAll">⏹ 全部停止</button>
  <button class="gold" id="btnOpenCanvas">🎨 打开源起创作画布</button>
  <button class="gold" id="btnOpenEreverse">🧬 E-Reverse 事实表</button>
  <button class="gold" id="btnOpen">🏠 进入工作台首页</button>
  <button id="btnSelfCheck">🩺 接入自检</button>
  <button id="btnRefresh">🔄 刷新</button>
  <button id="btnQuitPanel" title="仅退出控制面板，后台服务继续运行">🚪 退出面板</button>
  <span id="busyTip" style="font-size:13px;color:var(--amber);display:none">
    ⏳ 正在调度，请稍候…
  </span>
</div>

<div id="cards" class="cards-grid"></div>

<div id="tunnelBox" class="tunnel-box" style="display:none">
  <div>
    <span style="font-size:12.5px;color:var(--text-muted);display:block;margin-bottom:2px">🌐 临时安全公网隧道 (用于多模态模型资产交互):</span>
    <a id="tunnelLink" class="tunnel-url" href="#" target="_blank"></a>
  </div>
  <span style="font-size:11.5px;color:var(--text-dim)">每次启动自动安全同步</span>
</div>

<div class="logbox">
  <div class="log-header">
    <h3>运行操作日志 · Live Events</h3>
  </div>
  <div class="logbody" id="logBody"></div>
</div>

<div class="modal" id="modal">
  <div class="modal-content">
    <h4 id="modalTitle">日志详情</h4>
    <pre id="modalBody"></pre>
    <div style="margin-top:16px;text-align:right">
      <button class="sm" onclick="document.getElementById('modal').classList.remove('show')">关闭</button>
    </div>
  </div>
</div>

<footer>
  <div>源起 (Genesis) 创作工作台 · 工业级多智能体协同架构 · 心跳每 3 秒自动同步</div>
  <div>如需完全关停后台服务，点击上方「全部停止」即可</div>
</footer>

</div>

<script>
var busy = false;

function esc(s){
  return String(s).replace(/[&<>]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];
  });
}

function render(data){
  var html = '';
  data.services.forEach(function(s){
    var cls = s.state === 'running' ? 'on' : 'off';
    if(s.busy) cls = 'busy';
    if(s.state === 'dead') cls += ' dead';
    
    var stText = {
      running: '● 正在运行中 · 端口 ' + s.port,
      stopped: '○ 未启动',
      starting: '◌ 正在拉起服务…',
      stopping: '◌ 正在停止服务…',
      dead: '⚠ 异常 · 端口已被占用'
    }[s.state] || s.state;

    html += '<div class="card ' + cls + '">'
      + '<div class="status-indicator"><div class="status-dot"></div></div>'
      + '<div class="card-info">'
      +   '<div class="card-title-row">'
      +     '<span class="card-name">' + esc(s.name) + '</span>'
      +     '<span class="card-port">:' + esc(s.port) + '</span>'
      +   '</div>'
      +   '<div class="card-desc">' + esc(s.desc) + '</div>'
      +   '<div class="card-status">' + esc(stText) + '</div>'
      + '</div>'
      + '<div class="card-actions">'
      +   '<button class="sm" onclick="act(\'start\',\'' + s.key + '\')">启动</button>'
      +   '<button class="sm danger" onclick="act(\'stop\',\'' + s.key + '\')">停止</button>'
      +   '<button class="sm" onclick="viewLog(\'' + s.key + '\')">查看日志</button>'
      + '</div>'
      + '</div>';
  });
  document.getElementById('cards').innerHTML = html;

  var t = data.tunnelUrl || '';
  var tBox = document.getElementById('tunnelBox');
  var tLink = document.getElementById('tunnelLink');
  if(t){
    tLink.href = t;
    tLink.textContent = t;
    tBox.style.display = 'flex';
  } else {
    tBox.style.display = 'none';
  }

  var lb = '';
  (data.log || []).slice().reverse().forEach(function(e){
    var c = {ok:'k', warn:'w', error:'e'}[e.level] || 't';
    lb += '<div class="' + c + '">[' + esc(e.t) + '] ' + esc(e.msg) + '</div>';
  });
  document.getElementById('logBody').innerHTML = lb || '<div class="t">（暂无运行记录）</div>';
}

async function refresh(){
  try{
    var r = await fetch('/api/status', {cache: 'no-store'});
    render(await r.json());
  }catch(e){
    document.getElementById('logBody').innerHTML =
      '<div class="e">无法连接至控制台。请双击 启动源起.bat 重新初始化。</div>';
  }
}

async function post(url){
  if(busy) return;
  busy = true;
  document.getElementById('busyTip').style.display = 'inline';
  try{
    await fetch(url, {method: 'POST'});
  }catch(e){}
  await refresh();
  busy = false;
  document.getElementById('busyTip').style.display = 'none';
}

function act(a, k){ post('/api/' + a + '/' + k); }
function startAll(){ post('/api/start/all'); }
function stopAll(){
  if(!confirm('确认停止全部源起核心服务吗？\n（网页工作台将暂时无法访问，直到再次启动）')) return;
  post('/api/stop/all');
}

async function viewLog(k){
  var r = await fetch('/api/log/' + k, {cache: 'no-store'});
  var d = await r.json();
  document.getElementById('modalTitle').textContent = d.name + ' · 最近日志';
  document.getElementById('modalBody').textContent = d.text;
  document.getElementById('modal').classList.add('show');
}

async function selfCheck(){
  var btn = document.getElementById('btnSelfCheck');
  btn.disabled = true; btn.textContent = '自检中…';
  try{
    var r = await fetch('/api/selfcheck', {cache: 'no-store'});
    var d = await r.json();
    document.getElementById('modalTitle').textContent =
      (d.ok ? '✅ [全线畅通] ' : '⚠ [存在断点] ') + '源起系统接入自检报告';
    document.getElementById('modalBody').textContent = d.text;
    document.getElementById('modal').classList.add('show');
  }catch(e){
    alert('自检调用异常：' + e);
  }finally{
    btn.disabled = false; btn.textContent = '🩺 接入自检';
  }
}

document.getElementById('btnStartAll').onclick = startAll;
document.getElementById('btnStopAll').onclick = stopAll;
document.getElementById('btnRefresh').onclick = refresh;
document.getElementById('btnSelfCheck').onclick = selfCheck;

function quitPanel(){
  if(!confirm('退出控制面板？\n\n已运行的后台服务将保持运行，不受影响。\n需要重新打开控制台时，双击 启动源起.vbs 即可。')) return;
  fetch('/api/quit', {method: 'POST'}).catch(function(){});
  setTimeout(function(){
    document.body.innerHTML =
      '<div style="padding:60px 20px;font-family:sans-serif;color:#94a3b8;text-align:center">' +
      '<h2 style="color:#f1f5f9;margin-bottom:12px">源起控制面板已正常退出</h2>' +
      '后台服务正在平稳运行。您可以安全关闭此标签页。</div>';
  }, 300);
}
document.getElementById('btnQuitPanel').onclick = quitPanel;

document.getElementById('btnOpenCanvas').onclick = function(){
  window.open('http://127.0.0.1:3000/canvas?mode=new', '_blank');
};
document.getElementById('btnOpenEreverse').onclick = function(){
  window.open('http://127.0.0.1:3000/ereverse', '_blank');
};
document.getElementById('btnOpen').onclick = function(){
  window.open('http://127.0.0.1:3000', '_blank');
};

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    busy_state = {}

    def log_message(self, *args):
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = self.path.split("?")[0]

        if p in ("/", "/index.html"):
            body = PANEL_HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if p == "/api/status":
            svcs = []
            for s in SERVICES:
                st = Handler.busy_state.get(s["key"])
                if not st:
                    st = "running" if port_alive(s["port"]) else "stopped"
                svcs.append({
                    "key": s["key"], "name": s["name"], "desc": s["desc"],
                    "port": s["port"], "state": st, "busy": st in ("starting", "stopping"),
                })
            with _log_lock:
                logs = list(_event_log)
            tunnel_url = read_tunnel_url() if port_alive(SVC_BY_KEY["tunnel"]["port"]) else ""
            self._json({"services": svcs, "log": logs, "tunnelUrl": tunnel_url})
            return

        # 接入自检：只读体检
        if p == "/api/selfcheck":
            script = os.path.join(ROOT, "_ops", "check_integration.py")
            if not os.path.isfile(script):
                self._json({"ok": False, "text": "找不到自检脚本: %s" % script})
                return
            try:
                proc = subprocess.run(
                    [PYTHON, script],
                    capture_output=True, text=True,
                    encoding="utf-8", errors="replace",
                    timeout=60, cwd=ROOT,
                )
                self._json({
                    "ok": proc.returncode == 0,
                    "code": proc.returncode,
                    "text": (proc.stdout or "") + (proc.stderr or ""),
                })
            except Exception as e:
                self._json({"ok": False, "text": "自检执行失败: %r" % (e,)})
            return

        if p.startswith("/api/log/"):
            key = p[len("/api/log/"):]
            s = SVC_BY_KEY.get(key)
            if not s:
                self._json({"name": "?", "text": "(没有这个服务)"})
                return
            self._json({"name": s["name"], "text": tail_log(s)})
            return

        self._json({"error": "not found"}, 404)

    def do_POST(self):
        p = self.path.split("?")[0]
        parts = [x for x in p.split("/") if x]
        if len(parts) == 2 and parts[0] == "api" and parts[1] == "quit":
            self._json({"ok": True})

            def bye():
                time.sleep(0.4)
                log_event("源起控制面板已正常退出（后台服务持续运行）", "ok")
                os._exit(0)

            threading.Thread(target=bye, daemon=True).start()
            return

        if len(parts) != 3 or parts[0] != "api":
            self._json({"error": "bad request"}, 400)
            return
        action, target = parts[1], parts[2]

        if action not in ("start", "stop"):
            self._json({"error": "bad action"}, 400)
            return

        def work():
            try:
                if target == "all":
                    if action == "start":
                        items = [s for s in SERVICES if not s.get("legacy")]
                    else:
                        items = list(reversed(SERVICES))
                else:
                    s = SVC_BY_KEY.get(target)
                    items = [s] if s else []
                for s in items:
                    Handler.busy_state[s["key"]] = "starting" if action == "start" else "stopping"
                    try:
                        if action == "start":
                            start_service(s)
                        else:
                            stop_service(s)
                    finally:
                        Handler.busy_state.pop(s["key"], None)
            except Exception as e:
                log_event("服务操作异常：%s" % e, "error")

        threading.Thread(target=work, daemon=True).start()
        self._json({"ok": True})


# ---------------------------------------------------------------- 自动化初始化
def auto_start_if_idle():
    time.sleep(1.2)
    running = [s for s in SERVICES if port_alive(s["port"], timeout=0.4)]
    if running:
        log_event("检测到 %d 个核心服务正在运行，已跳过重复初始化" % len(running))
        if port_alive(SVC_BY_KEY["tunnel"]["port"], timeout=0.5):
            try:
                sync_tunnel_url()
            except Exception as e:
                log_event("隧道地址复核异常：%s" % e, "warn")
        else:
            log_event("检测到公网安全隧道未运行，正在自动补齐…")
            Handler.busy_state["tunnel"] = "starting"
            try:
                start_service(SVC_BY_KEY["tunnel"])
            except Exception as e:
                log_event("补启动公网隧道失败：%s" % e, "error")
            finally:
                Handler.busy_state.pop("tunnel", None)
        if not port_alive(SVC_BY_KEY["ereverse"]["port"], timeout=0.5):
            log_event("检测到 E-Reverse 事实表侧车未运行，正在自动补齐…")
            Handler.busy_state["ereverse"] = "starting"
            try:
                start_service(SVC_BY_KEY["ereverse"])
            except Exception as e:
                log_event("补启动 E-Reverse 侧车失败：%s" % e, "error")
            finally:
                Handler.busy_state.pop("ereverse", None)
        return

    log_event("正在初始化拉起「源起」核心服务集群（gemini-3.8-Flash 协同架构）…")
    auto_svcs = [s for s in SERVICES if not s.get("legacy")]
    for s in auto_svcs:
        Handler.busy_state[s["key"]] = "starting"
        try:
            start_service(s)
        finally:
            Handler.busy_state.pop(s["key"], None)

    up = [s for s in auto_svcs if port_alive(s["port"], timeout=0.4)]
    if len(up) == len(auto_svcs):
        log_event("全部 %d 个源起核心服务已全部就绪。点击「进入工作台首页」开启创作！" % len(up), "ok")
    else:
        log_event("%d/%d 个核心服务已就绪。如有未启动项可点击「查看日志」排查。"
                  % (len(up), len(auto_svcs)), "warn")


boot_trace("boot: >>> yuanqi_console.py 进程启动 (argv=%r)" % (sys.argv[1:],))


def main():
    # 工业级健壮性检测：验证控制台是否真正健康存活
    if port_alive(PANEL_PORT):
        boot_trace("boot: 17580 端口可连接，进入健康复核…")
        # 尝试真实心跳探测
        is_truly_healthy = False
        try:
            req = urllib.request.Request("http://127.0.0.1:%d/api/status" % PANEL_PORT)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(req, timeout=1.5) as resp:
                if resp.status == 200:
                    is_truly_healthy = True
        except Exception as e:
            boot_trace("boot: 健康探测异常: %r" % (e,))

        if is_truly_healthy:
            log_event("源起控制面板已在运行且响应正常，正在为您直接打开浏览器…")
            try:
                webbrowser.open("http://127.0.0.1:%d/" % PANEL_PORT)
                boot_trace("boot: 已复用运行中实例，webbrowser.open 调用返回")
            except Exception as e:
                boot_trace("boot: webbrowser.open 失败: %r" % (e,))
            return
        else:
            boot_trace("boot: 17580 残留非健康实例，执行清理")
            log_event("检测到端口 %d 处于非活动残留状态，正在清理…" % PANEL_PORT, "warn")
            stale_pids = pids_on_port(PANEL_PORT)
            for sp in stale_pids:
                try:
                    subprocess.run(["taskkill", "/F", "/PID", str(sp)], capture_output=True, timeout=5)
                except Exception:
                    pass
            time.sleep(1.0)

    server = None
    for attempt in range(4):
        boot_trace("boot: 尝试绑定 17580（第 %d 次）" % (attempt + 1))
        try:
            server = ThreadingHTTPServer(("127.0.0.1", PANEL_PORT), Handler)
            break
        except OSError as e:
            boot_trace("boot: 绑定失败: %r" % (e,))
            if attempt < 3:
                time.sleep(1.2)
            else:
                log_event("无法绑定控制面板端口 %d: %s" % (PANEL_PORT, e), "error")
                boot_trace("boot: 绑定彻底失败，退出")
                return

    boot_trace("boot: 17580 绑定成功，serve_forever 即将启动")
    log_event("源起控制面板服务已就绪：http://127.0.0.1:%d/" % PANEL_PORT, "ok")

    threading.Thread(target=auto_start_if_idle, daemon=True).start()

    def _open_browser():
        time.sleep(1.0)
        try:
            webbrowser.open("http://127.0.0.1:%d/" % PANEL_PORT)
            boot_trace("boot: webbrowser.open 已调用")
        except Exception as e:
            boot_trace("boot: webbrowser.open 异常: %r" % (e,))

    threading.Thread(target=_open_browser, daemon=True).start()

    try:
        server.serve_forever()
        boot_trace("boot: serve_forever 退出（异常结束）")
    except KeyboardInterrupt:
        boot_trace("boot: KeyboardInterrupt")
    except Exception as e:
        boot_trace("boot: serve_forever 异常: %r" % (e,))
        log_event("控制面板运行异常退出：%s" % e, "error")
    finally:
        if server:
            try:
                server.server_close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
