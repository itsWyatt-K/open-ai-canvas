#!/usr/bin/env bun
/**
 * 生成 omnireplica 预置动效模板 JSON 快照（nxf preset 回归的 canonical 输入）。
 *
 * 单一真相 = `src/lib/omnireplica/motion-presets.ts`；本脚本只做序列化落盘，
 * 不承载任何业务逻辑。主理人裁决（TS 单一真相 + JSON 快照 + 漂移卫士）：
 * nxf 仓库不塞前端文件，程不宕的 preset 回归按绝对路径读这 3 份 JSON：
 *   D:/AlcheMvision/open-ai-canvas/web/src/lib/omnireplica/presets/<preset-id>.json
 *
 * 改 TS 后必须重跑（漂移卫士 test/omnireplica-presets-drift.test.ts 会抓双源不一致）：
 *   bun scripts/gen-omnireplica-presets.mjs
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { MOTION_PRESETS } from "../src/lib/omnireplica/motion-presets.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "src", "lib", "omnireplica", "presets");
mkdirSync(outDir, { recursive: true });

// 先清历史快照：模板下线/改名时不留孤儿文件（漂移卫士的"无多余文件"断言同口径）
for (const name of readdirSync(outDir)) {
    if (name.endsWith(".json")) rmSync(join(outDir, name), { force: true });
}

for (const preset of MOTION_PRESETS) {
    const file = join(outDir, `${preset.id}.json`);
    writeFileSync(file, `${JSON.stringify(preset, null, 2)}\n`, "utf8");
    console.log(`[presets] ${preset.id} -> ${file}`);
}
console.log(`[presets] done: ${MOTION_PRESETS.length} snapshots`);
