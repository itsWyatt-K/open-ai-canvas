import { expect, test } from "bun:test";
// 外层测试超时必须 ≥ 子进程预算（15000ms）+ 余量：bun 默认 5s 会在整机高负载时先杀掉外层，
// 而 harness 本身要跑十几秒，表现为稳定 flake。
import { resolve } from "node:path";

// React DOM caches browser feature detection on first import. Use a fresh
// runtime so this real-component test is independent of prior SSR suites.
test("真实输入组件的中文组词并发合并、光标与无重试交互", { timeout: 20000 }, () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-text-concurrent-input.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(output).toContain("2 pass");
    expect(output).toContain("0 fail");
    expect(result.exitCode).toBe(0);
});
