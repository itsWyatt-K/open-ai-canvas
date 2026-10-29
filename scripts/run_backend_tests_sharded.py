# -*- coding: utf-8 -*-
"""Go 后端分片测试门禁 + 前端 bun test 分片：解决 internal/app 全量单跑超时（1200+ 例 >10 分钟）问题。

用法（仓库根或任意目录）：
    python scripts/run_backend_tests_sharded.py                # 全量（非 app 包 + app 五批 + 前端）
    python scripts/run_backend_tests_sharded.py --app-only     # 只跑 app 包分片（含前端）
    python scripts/run_backend_tests_sharded.py --skip-frontend # 跳过前端分片（仅 Go）
    python scripts/run_backend_tests_sharded.py --frontend-only # 只跑前端 bun test
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
  4) 前端独立分片 F1：`cd web && bun test`（bun 未安装 = 门禁失败并明确报出，
     不静默跳过——前端用例缺席本身就是门禁不通过）。
  5) 汇总表：任何一批 FAIL / 超时 / bun 缺失 → 退出码 1（门禁不通过）。
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BACKEND = REPO / "backend"
WEB = REPO / "web"

SHARDS: list[tuple[str, str]] = [
    ("S1-电商", r"^(TestEcommerce|TestSellingPoints)"),
    ("S2-技能导演", r"^(TestChaoge|TestSkill|TestDirector|TestDualSkill|TestAgentDirector|TestBuiltin|TestDoubao|TestYingshi|TestPreset|TestSeed)"),
    ("S3-云端Agent", r"^(TestCloudAgent|TestAgent|TestPi)"),
    ("S4-渠道下载", r"^(TestChannel|TestProvider|TestModel|TestProtocol|TestMaxForAI|TestCheaper|TestNewAPI|TestBilling|TestPayment|TestCredit|TestMedia|TestRetry|TestRedeem|TestPricing|TestApiCall|TestAnnouncement|TestAppearance|TestResolve|TestWorkflow|TestCanvas)"),
]
S5_LABEL = "S5-画布核心"
FRONTEND_LABEL = "F1-前端(bun test)"


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


def find_bun() -> str | None:
    """定位 bun：PATH 优先，回退 WorkBuddy 托管运行时与仓库 node_modules。

    返回 None 表示本机没有 bun——调用方必须按门禁失败处理（前端用例缺席 ≠ 通过）。
    """
    from shutil import which

    found = which("bun")
    if found:
        return found
    candidates = [
        Path(r"C:\Users\khy\.workbuddy\binaries\node\workspace\bun-runtime\bun.exe"),
        WEB / "node_modules" / ".bin" / "bun.exe",
        WEB / "node_modules" / ".bin" / "bun",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    return None


def frontend_env() -> dict[str, str] | None:
    """F1 子进程环境：补齐 git 所在目录。

    web 套件里的「changed-file formatting gate」等测试会 shell-out 到 git；
    门禁自身可能只继承了 bun 的 PATH（find_bun 回退路径不含 git），缺 git 时
    这批用例必挂——把 PortableGit 的 cmd 目录前置进子进程 PATH。"""
    env = os.environ.copy()
    git_dir = Path(r"C:\Users\khy\.workbuddy\binaries\PortableGit\versions\1.3.0\cmd")
    if git_dir.is_dir() and str(git_dir) not in env.get("PATH", ""):
        env["PATH"] = str(git_dir) + os.pathsep + env.get("PATH", "")
    return env


def run(cmd: list[str], cwd: Path, timeout: int) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def run_with_env(cmd: list[str], cwd: Path, timeout: int, env: dict[str, str] | None) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True,
                          encoding="utf-8", errors="replace", timeout=timeout, env=env)
    return proc.returncode, (proc.stdout or "") + (proc.stderr or "")


def list_app_tests(go: str) -> list[str]:
    code, out = run([go, "test", "-list", ".*", "./internal/app/"], BACKEND, 600)
    if code != 0:
        raise SystemExit("枚举 app 测试失败:\n" + out[-2000:])
    return [line.strip() for line in out.splitlines()
            if line.startswith("Test") and line.strip() != "TestMain"]


def run_shard(go: str, label: str, run_arg: str, skip_arg: str | None, timeout: int, matched: int) -> tuple[str, str, float]:
    # go test 自带 10 分钟包级超时会 panic 杀掉大批次——透传 -timeout 与门禁一致。
    # -v 供精确统计 pass/skip/fail（只统计顶层用例，无缩进的 --- 行）。
    cmd = [go, "test", "-run", run_arg, "-count=1", "-timeout", f"{timeout}s", "-v", "./internal/app/"]
    if skip_arg:
        # -skip 追加到尾部：插在 -run 前会被 -run 当值吞掉。
        cmd += ["-skip", skip_arg]
    started = time.time()
    try:
        code, out = run(cmd, BACKEND, timeout)
    except subprocess.TimeoutExpired:
        print(f"[TIMEOUT] {label} ({matched} 例, 超过 {timeout}s)", flush=True)
        return label, "FAIL", float(timeout)
    elapsed = time.time() - started
    status = "PASS" if code == 0 else "FAIL"
    passed = failed = skipped = 0
    for line in out.splitlines():
        if line.startswith("--- PASS: "):
            passed += 1
        elif line.startswith("--- FAIL: "):
            failed += 1
        elif line.startswith("--- SKIP: "):
            skipped += 1
    stats = f"{passed} pass / {skipped} skip / {failed} fail"
    if code != 0:
        # 失败时全量输出落盘，避免尾部截断吞掉失败名单。
        dump = REPO / "reports" / ("shard-fail-" + label.replace("/", "_") + ".log")
        dump.parent.mkdir(exist_ok=True)
        dump.write_text(out, encoding="utf-8", errors="replace")
        fail_lines = [line for line in out.splitlines()
                      if line.startswith("--- FAIL") or line.lstrip().startswith("--- FAIL") or "panic:" in line]
        print(f"[{status}] {label} ({matched} 例, {elapsed:.0f}s) [{stats}] 完整输出: {dump}", flush=True)
        for line in fail_lines[:60]:
            print("  " + line, flush=True)
        if not fail_lines:
            print(out[-2000:], flush=True)
    else:
        print(f"[{status}] {label} ({matched} 例, {elapsed:.0f}s) [{stats}]", flush=True)
    return label, status, elapsed


def run_frontend_shard(timeout: int) -> tuple[str, str, float]:
    """前端分片：cd web && bun test。bun 缺失 = FAIL（不静默跳过）。"""
    bun = find_bun()
    if not bun:
        print(f"[FAIL] {FRONTEND_LABEL}: 找不到 bun（PATH / WorkBuddy 托管运行时 / web/node_modules 均无）。", flush=True)
        print("  前端测试未执行——按门禁纪律记为失败，请安装 bun（https://bun.sh）后重跑。", flush=True)
        return FRONTEND_LABEL, "FAIL", 0.0
    started = time.time()
    try:
        code, out = run_with_env([bun, "test"], WEB, timeout, frontend_env())
    except subprocess.TimeoutExpired:
        print(f"[TIMEOUT] {FRONTEND_LABEL} (超过 {timeout}s)", flush=True)
        return FRONTEND_LABEL, "FAIL", float(timeout)
    except OSError as error:
        print(f"[FAIL] {FRONTEND_LABEL}: bun 启动失败（{error}）", flush=True)
        return FRONTEND_LABEL, "FAIL", time.time() - started
    elapsed = time.time() - started
    status = "PASS" if code == 0 else "FAIL"
    # bun test 汇总行形如 " 1234 pass / 2 fail / 6 skip"。
    passed = failed = skipped = 0
    for line in out.splitlines():
        match = re.match(r"\s*(\d+)\s+(pass|fail|skip)\b", line)
        if match:
            count = int(match.group(1))
            if match.group(2) == "pass":
                passed += count
            elif match.group(2) == "fail":
                failed += count
            else:
                skipped += count
    stats = f"{passed} pass / {skipped} skip / {failed} fail"
    if code != 0:
        dump = REPO / "reports" / "shard-fail-frontend-bun-test.log"
        dump.parent.mkdir(exist_ok=True)
        dump.write_text(out, encoding="utf-8", errors="replace")
        fail_lines = [line for line in out.splitlines() if line.startswith("(fail)") or line.lstrip().startswith("(fail)")]
        print(f"[{status}] {FRONTEND_LABEL} ({elapsed:.0f}s) [{stats}] 完整输出: {dump}", flush=True)
        for line in fail_lines[:60]:
            print("  " + line, flush=True)
        if not fail_lines:
            print(out[-2000:], flush=True)
    else:
        print(f"[{status}] {FRONTEND_LABEL} ({elapsed:.0f}s) [{stats}]", flush=True)
    return FRONTEND_LABEL, status, elapsed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--app-only", action="store_true", help="跳过非 app 包")
    parser.add_argument("--skip-frontend", action="store_true", help="跳过前端 bun test 分片")
    parser.add_argument("--frontend-only", action="store_true", help="只跑前端 bun test 分片")
    parser.add_argument("--timeout", type=int, default=900, help="每批超时秒数（透传 go test -timeout / bun test）")
    parser.add_argument("--shard", default="", help="只跑指定批（如 S5-画布核心），调试用")
    args = parser.parse_args()

    # --frontend-only 时不要求本机有 go（纯前端分片调试用）。
    go = None if args.frontend_only else find_go()
    results: list[tuple[str, str, float]] = []
    failed = False

    if not args.app_only and not args.frontend_only:
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

    if not args.frontend_only:
        all_names = list_app_tests(go)
        print(f"internal/app 共 {len(all_names)} 个测试", flush=True)
        combined = re.compile("|".join("(?:" + pattern[1:] + ")" for _, pattern in SHARDS))
        for label, pattern in SHARDS:
            if args.shard and label != args.shard:
                continue
            matched = sum(1 for name in all_names if re.match(pattern, name))
            if matched == 0:
                continue
            shard_label, status, elapsed = run_shard(go, label, pattern, None, args.timeout, matched)
            results.append((shard_label, status, elapsed))
            if status == "FAIL":
                failed = True
        # S5 兜底批：-skip 掉前四批前缀，-run 全量——覆盖保证由构造保证。
        if not args.shard or args.shard == S5_LABEL:
            rest = [name for name in all_names if not combined.match(name)]
            if rest:
                shard_label, status, elapsed = run_shard(
                    go, S5_LABEL, ".*", combined.pattern, args.timeout, len(rest))
                results.append((shard_label, status, elapsed))
                if status == "FAIL":
                    failed = True

    # 前端独立分片：cd web && bun test（bun 缺失按 FAIL 处理，不静默跳过）。
    if not args.skip_frontend and (not args.shard or args.shard == FRONTEND_LABEL):
        shard_label, status, elapsed = run_frontend_shard(args.timeout)
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
