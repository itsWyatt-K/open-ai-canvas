"""模型渠道配置自检（夜间施工令阶段三-5）。

检查项：
1. CHANNEL_000011（火山方舟 Seedance 2.5）：enabled 状态、channel_models 是否配置、
   价格是否已配（price_configured = 有价格的 model 数）。
2. :8790 E-Reverse 侧车：zhipu:glm-4v-flash 的环境变量 Key 读取逻辑（ZHIPU_API_KEY /
   GLM_API_KEY / EREVERSE_ZHIPU_API_KEY 任一存在即就绪）。
3. 全渠道速览：启用渠道数、缺价格的热计生图/视频渠道。

只读打开 SQLite（file:...?mode=ro），绝不写库；缺库/缺表给出人话提示而非堆栈。
用法：python scripts/model_channel_selfcheck.py [--db <路径>]
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_DB = REPO / ".local" / "data" / "open_ai_canvas.db"

ZHIPU_ENV_CANDIDATES = ("ZHIPU_API_KEY", "GLM_API_KEY", "EREVERSE_ZHIPU_API_KEY", "ZHIPUAI_API_KEY")


def open_readonly(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        sys.exit(f"[缺库] 找不到 {db_path}——先用控制台拉起一次后端让它建库，或用 --db 指定路径")
    uri = "file:" + db_path.as_posix().replace(":", "%3A", 1) + "?mode=ro"
    try:
        return sqlite3.connect(uri, uri=True)
    except sqlite3.Error as error:
        sys.exit(f"[缺库] 无法只读打开 {db_path}：{error}")


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    row = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone()
    return row is not None


def check_seedance_channel(conn: sqlite3.Connection) -> None:
    print("\n== CHANNEL_000011（火山方舟 Seedance 2.5）==")
    if not table_exists(conn, "channels"):
        print("[跳过] channels 表不存在（库还没跑过迁移）")
        return
    row = conn.execute("SELECT id, name, enabled FROM channels WHERE id LIKE 'CHANNEL_000011%'").fetchone()
    if not row:
        print("[缺] 没有找到 CHANNEL_000011 渠道：请在管理后台新增火山方舟渠道（爆款视频第三层生成依赖它）")
        return
    channel_id, name, enabled = row
    print(f"[{'OK' if enabled else '停'}] {channel_id} {name} enabled={enabled}")
    if not enabled:
        print("     → 管理后台 → 渠道管理 → 启用该渠道；爆款视频第 3 层（Seedance 2.5 生成）走它")
    if not table_exists(conn, "channel_models"):
        print("[跳过] channel_models 表不存在")
        return
    models = conn.execute(
        "SELECT model_key, enabled, price_type, price_amount FROM channel_models WHERE channel_id = ?",
        (channel_id,),
    ).fetchall()
    if not models:
        print("[缺] 该渠道下没有配置任何模型：需添加 Seedance 2.5（如 doubao-seedance-2-5）等视频模型")
        return
    priced = 0
    for model_key, model_enabled, price_type, price_amount in models:
        has_price = price_type not in (None, "", "none") or (price_amount or 0) > 0
        priced += 1 if has_price else 0
        flag = "OK" if (model_enabled and has_price) else ("无价" if model_enabled else "停用")
        print(f"  [{flag}] {model_key} enabled={model_enabled} price={price_type}/{price_amount}")
    if priced < len(models):
        print("     → 有模型未配价：Agent/制片台计费预检会拦截，请在渠道-模型编辑里补价格")


def check_zhipu_key() -> None:
    print("\n== :8790 E-Reverse 侧车 · zhipu:glm-4v-flash ==")
    found = next((name for name in ZHIPU_ENV_CANDIDATES if os.environ.get(name, "").strip()), None)
    if found:
        print(f"[OK] 环境变量 {found} 已设置（值不回显）")
    else:
        print("[缺] 未设置智谱 Key 环境变量")
        print("     → 设置其一：ZHIPU_API_KEY / GLM_API_KEY / EREVERSE_ZHIPU_API_KEY")
        print("     → 侧车会降级为纯 ffmpeg 拆片（时间轴/镜头可用，视觉标签与提示词变弱）")


def check_channels_overview(conn: sqlite3.Connection) -> None:
    print("\n== 渠道速览 ==")
    if not table_exists(conn, "channels"):
        return
    rows = conn.execute("SELECT id, name, enabled FROM channels ORDER BY id").fetchall()
    enabled = [r for r in rows if r[2]]
    print(f"共 {len(rows)} 个渠道，启用 {len(enabled)} 个：")
    for channel_id, name, _ in enabled[:20]:
        print(f"  [OK] {channel_id} {name}")
    if table_exists(conn, "channel_models") and enabled:
        placeholders = ",".join("?" for _ in enabled)
        missing = conn.execute(
            f"SELECT channel_id, model_key FROM channel_models WHERE channel_id IN ({placeholders}) "
            "AND enabled = 1 AND (price_type IS NULL OR price_type = '' OR price_type = 'none') AND (price_amount IS NULL OR price_amount = 0)",
            tuple(r[0] for r in enabled),
        ).fetchall()
        if missing:
            print(f"[注意] {len(missing)} 个启用模型未配价（计费预检会拦）：")
            for channel_id, model_key in missing[:10]:
                print(f"  - {channel_id} {model_key}")


def main() -> None:
    parser = argparse.ArgumentParser(description="模型渠道配置自检")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite 库路径（默认 .local/data/open_ai_canvas.db，只读打开）")
    args = parser.parse_args()
    print("== 源起 · 模型渠道自检 ==")
    conn = open_readonly(Path(args.db))
    try:
        check_seedance_channel(conn)
        check_zhipu_key()
        check_channels_overview(conn)
    finally:
        conn.close()
    print("\n自检完成（只读，未改动任何数据）")


if __name__ == "__main__":
    main()
