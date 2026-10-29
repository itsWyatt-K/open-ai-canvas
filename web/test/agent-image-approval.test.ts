import { expect, test } from "bun:test";
import { resolve } from "node:path";

// 子进程 harness 预算 20s：外层测试超时必须 ≥ 子进程预算，否则整机高负载
// （全量跑时）harness 刚跑满 5s 就被外层默认超时杀掉，表现为稳定 flake。
test("真实 React 图片审批多字段更新不会覆盖已选宽高比", { timeout: 25000 }, () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/agent-image-approval.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("1 pass");
    expect(output).toContain("0 fail");
});
