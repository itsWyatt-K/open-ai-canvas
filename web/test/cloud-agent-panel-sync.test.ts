import { expect, test } from "bun:test";
// 外层测试超时必须 ≥ 子进程预算（30000ms）+ 余量：bun 默认 5s 会在整机高负载时先杀掉外层，
// 而 harness 本身要跑十几秒，表现为稳定 flake。
import { resolve } from "node:path";

test("真实工作区面板跨设备发现、接续与账号隔离", { timeout: 35000 }, () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/cloud-agent-panel-sync.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 30000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("15 pass");
    expect(output).toContain("0 fail");
});
