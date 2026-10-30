/**
 * 预置动效模板双源漂移卫士（主理人裁决：TS 单一真相 + JSON 快照 + 漂移卫士）。
 *
 * 架构：`src/lib/omnireplica/motion-presets.ts` 是唯一真相；`presets/*.json` 是
 * 给 nxf preset 回归（程不宕 test_code_render.py 按绝对路径读）的序列化快照。
 * 本测试断言 JSON 快照 ≡ TS 模块导出——改了 TS 忘了重跑
 * `bun scripts/gen-omnireplica-presets.mjs` 即红，防双源漂移。
 *
 * 文件名约定：`<preset-id>.json`（id 即文件名，nxf 侧按 id 寻址可追溯）。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { MOTION_PRESETS } from "@/lib/omnireplica/motion-presets";

const presetsDir = path.join(import.meta.dir, "..", "src", "lib", "omnireplica", "presets");

function readSnapshot(id: string): unknown {
    return JSON.parse(readFileSync(path.join(presetsDir, `${id}.json`), "utf8"));
}

describe("omnireplica preset snapshots（JSON 快照 ≡ TS 单一真相）", () => {
    test("presets 目录快照文件集合与 TS 导出一一对应（无缺失、无孤儿）", () => {
        const files = readdirSync(presetsDir)
            .filter((name) => name.endsWith(".json"))
            .sort();
        const expected = MOTION_PRESETS.map((preset) => `${preset.id}.json`).sort();
        expect(files).toEqual(expected);
    });

    for (const preset of MOTION_PRESETS) {
        test(`${preset.id}.json 与 TS 导出深度一致（含 shots/transitions/cssKeyframes/refineNotes）`, () => {
            const snapshot = readSnapshot(preset.id) as Record<string, unknown>;
            expect(snapshot).toEqual(preset);
            // 关键载荷非空（防"空快照也等于空导出"的假绿）
            expect(Array.isArray(snapshot.shots) && snapshot.shots.length).toBeGreaterThan(0);
            expect(Array.isArray(snapshot.transitions)).toBeTrue();
            expect(typeof snapshot.cssKeyframes).toBe("string");
            expect(Array.isArray(snapshot.refineNotes) && snapshot.refineNotes.length).toBeGreaterThan(0);
            expect(snapshot.id).toBe(preset.id);
        });
    }

    test("快照 id 与文件名一致（nxf 按绝对路径寻址可追溯）", () => {
        for (const preset of MOTION_PRESETS) {
            const snapshot = readSnapshot(preset.id) as { id?: string };
            expect(snapshot.id).toBe(preset.id);
        }
    });
});
