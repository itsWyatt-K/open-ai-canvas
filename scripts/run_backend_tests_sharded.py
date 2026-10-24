# -*- coding: utf-8 -*-
"""Go 后端分片测试门禁：解决 internal/app 全量单跑超时（1200+ 例 >10 分钟）问题。

用法（仓库根或任意目录）：
    python scripts/run_backend_tests_sharded.py            # 全量（非 app 包 + app 五批）
    python scripts/run_backend_tests_sharded.py --app-only # 只跑 app 包分片
    python scripts/run_backend_tests_sharded.py --timeout 900

流程：
  1) `go list ./...` 枚举全部包；先逐包跑**非 app 包**（各自独立，快速失败）。
  2) internal/app 按测试名**前缀**分 5 批（Windows 命令行 32K 上限不允许
     逐个枚举全名，必须用短前缀交替正则）：
       S1 电商      ^(TestEcommerce|TestSellingPoints)
       S2 技能/导演  ^(TestChaoge|TestSkill|TestDirector|...)
       S3 云端Agent  ^(TestCloudAgent|TestAgent|TestPi)
       S4 渠道下载   ^(TestChannel|TestProvider|TestModel|...)
       S5 画布核心   其余全部：-run ".*" -skip "S1|S2|S3|S4 正则"（go1.21+）
  3) 逐批执行（-count=1），超时按批隔离。
  4) 汇总表：任何一批 FAIL 或超时 → 退出码 1（门禁不通过）。
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKEND = REPO / "backend"

SHARDS: list[tuple[str, str]] = [
    ("S1-电商", r"^(TestEcommerce|TestSellingPoints)"),
    ("S2-技能导演", r"^(TestChaoge|TestSkill|TestDirector|TestDualSkill|TestAgentDirector|TestBuiltin|TestDoubao|TestYingshi|TestPreset|TestSeed)"),
    ("S3-云端Agent", r"^(TestCloudAgent|TestAgent|TestPi)"),
    ("S4-渠道下载", r"^(TestChannel|TestProvider|TestModel|TestProtocol|TestMaxForAI|TestCheaper|TestNewAPI|TestBilling|TestPayment|TestCredit|TestMedia|TestRetry|TestRedeem|TestPricing|TestApiCall|TestAnnouncement|TestAppearance|TestResolve|TestWorkflow|TestCanvas)"),
]
S5_LABEL = "S5-画布核心"


def find_go() -> str:
    """定位 go 可执行文件：PATH 优先，回退本机 WorkBuddy 托管安装。"""
    from shutil import which

    found = which("go")
    if found:
        return found
    managed = Path(r"C:\Users\khy\.workbuddy\binaries\go\go\bin\go.exe")
    if managed.is_file():
        return str(managed)
    raise SystemExit("找不到 go：请把 go 加入 PATH 或确认 WorkBuddy 托管安装存在")


def run(cmd: list[str], cwd: Path, timeout: int) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def list_app_tests(go: str) -> list[str]:
    code, out = run([go, "test", "-list", ".*", "./internal/app/"], BACKEND, 600)
    if code != 0:
        raise SystemExit("枚举 app 测试失败:\n" + out[-2000:])
    return [line.strip() for line in out.splitlines()
            if line.startswith("Test") and line.strip() != "TestMain"]


def run_shard(go: str, label: str, run_arg: str, skip_arg: str | None, timeout: int, matched: int) -> tuple[str, str, float]:
    cmd = [go, "test", "-run", run_arg, "-count=1", "./internal/app/"]
    if skip_arg:
        cmd[3:3] = ["-skip", skip_arg]
    started = time.time()
    try:
        code, out = run(cmd, BACKEND, timeout)
    except subprocess.TimeoutExpired:
        print(f"[TIMEOUT] {label} ({matched} 例, 超过 {timeout}s)", flush=True)
        return label, "FAIL", float(timeout)
    elapsed = time.time() - started
    status = "PASS" if code == 0 else "FAIL"
    if code != 0:
        print(f"[{status}] {label} ({matched} 例, {elapsed:.0f}s)\n{out[-5000:]}", flush=True)
    else:
        print(f"[{status}] {label} ({matched} 例, {elapsed:.0f}s)", flush=True)
    return label, status, elapsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-only", action="store_true", help="跳过非 app 包")
    parser.add_argument("--timeout", type=int, default=900, help="每批超时秒数")
    args = parser.parse_args()

    go = find_go()
    results: list[tuple[str, str, float]] = []
    failed = False

    if not args.app_only:
        code, out = run([go, "list", "./..."], BACKEND, 120)
        if code != 0:
            raise SystemExit("go list 失败:\n" + out[-2000:])
        packages = [line.strip() for line in out.splitlines() if line.strip()]
        for pkg in packages:
            if pkg.endswith("/internal/app"):
                continue
            started = time.time()
            code, out = run([go, "test", "-count=1", pkg], BACKEND, args.timeout)
            elapsed = time.time() - started
            status = "PASS" if code == 0 else "FAIL"
            if code != 0:
                failed = True
                print(f"[{status}] {pkg} ({elapsed:.0f}s)\n{out[-3000:]}", flush=True)
            else:
                print(f"[{status}] {pkg} ({elapsed:.0f}s)", flush=True)
            results.append((pkg, status, elapsed))

    all_names = list_app_tests(go)
    print(f"internal/app 共 {len(all_names)} 个测试", flush=True)
    combined = re.compile("|".join("(?:" + pattern[1:] + ")" for _, pattern in SHARDS))
    for label, pattern in SHARDS:
        matched = sum(1 for name in all_names if re.match(pattern, name))
        if matched == 0:
            continue
        shard_label, status, elapsed = run_shard(go, label, pattern, None, args.timeout, matched)
        results.append((shard_label, status, elapsed))
        if status == "FAIL":
            failed = True
    # S5 兜底批：-skip 掉前四批前缀，-run 全量——覆盖保证由构造保证。
    rest = [name for name in all_names if not combined.match(name)]
    if rest:
        shard_label, status, elapsed = run_shard(
            go, S5_LABEL, ".*", combined.pattern, args.timeout, len(rest))
        results.append((shard_label, status, elapsed))
        if status == "FAIL":
            failed = True

    print("\n===== 分片测试汇总 =====", flush=True)
    for label, status, elapsed in results:
        print(f"{status}  {label}  ({elapsed:.0f}s)")
    total_failed = sum(1 for _, s, _ in results if s == "FAIL")
    print(f"========================\n{total_failed} 批失败" if total_failed else "========================\n全部通过 (0 Failed)")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
