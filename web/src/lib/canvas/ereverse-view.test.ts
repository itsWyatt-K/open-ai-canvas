import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWordChunks, presentEreversePft } from "./ereverse-view";
import type { EreversePft } from "@/services/api/ereverse";

const assetUrl = (_jobId: string, kind: "video" | "file", fileName?: string) =>
    kind === "video" ? "v" : `f:${fileName}`;

test("buildWordChunks splits on gaps, chunk length, and char budget", () => {
    const words = [
        { word: "女", start_ms: 0, end_ms: 100 },
        { word: "生", start_ms: 100, end_ms: 200 },
        // 500ms 间隙 → 切块
        { word: "都", start_ms: 700, end_ms: 800 },
        // 超过 3s 块长 → 切块
        { word: "去", start_ms: 5_000, end_ms: 5_100 },
    ];
    const chunks = buildWordChunks(words, 6_000);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].text, "女生");
    assert.equal(chunks[1].text, "都");
    assert.equal(chunks[2].text, "去");
    assert.ok(chunks[0].leftPct >= 0 && chunks[0].leftPct < 5);
});

test("buildWordChunks inserts spaces between ASCII tokens only", () => {
    const words = [
        { word: "好", start_ms: 0, end_ms: 100 },
        { word: "的", start_ms: 100, end_ms: 200 },
        { word: "video", start_ms: 200, end_ms: 300 },
        { word: "is", start_ms: 300, end_ms: 400 },
        { word: "好", start_ms: 400, end_ms: 500 },
    ];
    const chunks = buildWordChunks(words, 1_000);
    assert.equal(chunks.length, 1);
    // 仅 ASCII 词元之间补空格；CJK 与 ASCII 相邻直接拼接
    assert.equal(chunks[0].text, "好的video is好");
});

test("buildWordChunks skips malformed words", () => {
    const words = [
        { word: "", start_ms: 0, end_ms: 100 },
        { word: "好", start_ms: Number.NaN, end_ms: 100 },
        { word: "的", start_ms: 0, end_ms: 100 },
    ];
    const chunks = buildWordChunks(words, 1_000);
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, "的");
});

function fixturePft(): EreversePft {
    return {
        schema: "pft/v1",
        source: { path: "D:\\产线\\成片\\主图视频_1.mp4", duration_ms: 10_000, width: 720, height: 960, fps: 30 },
        scenes: [
            { index: 0, start_ms: 0, end_ms: 4_000, keyframe_path: "D:\\x\\work\\keyframes\\scene_000.png", semantic_tags: ["女性", "坐灸仪"], tag_provider: "gemini:gemini-3.8-flash-high" },
            { index: 1, start_ms: 4_000, end_ms: 10_000, keyframe_path: "D:\\x\\work\\keyframes\\scene_001.png", semantic_tags: [] },
        ],
        words: [
            { word: "女", start_ms: 0, end_ms: 100 },
            { word: "生", start_ms: 100, end_ms: 200 },
        ],
        provenance: { asr_provider: "whisperx", vlm_provider: "gemini:gemini-3.8-flash-high", degraded: ["asr-degraded: x"] },
    } as unknown as EreversePft;
}

test("presentEreversePft maps scenes to percent coords and proxy URLs", () => {
    const view = presentEreversePft(fixturePft(), "job1", assetUrl);
    assert.equal(view.durationMs, 10_000);
    assert.equal(view.sourceName, "主图视频_1.mp4");
    assert.equal(view.scenes.length, 2);
    assert.equal(view.scenes[0].keyframeUrl, "f:scene_000.png");
    assert.equal(view.scenes[0].leftPct, 0);
    assert.equal(Math.round(view.scenes[1].leftPct), 40);
    assert.equal(Math.round(view.scenes[1].widthPct), 60);
    assert.equal(view.asrProvider, "whisperx");
    assert.deepEqual(view.degraded, ["asr-degraded: x"]);
    assert.equal(view.chunks.length, 1);
    assert.equal(view.chunks[0].text, "女生");
});

test("presentEreversePft tolerates empty words and missing keyframes", () => {
    const pft = fixturePft() as EreversePft;
    pft.words = undefined;
    pft.scenes = [{ index: 0, start_ms: 0, end_ms: 10_000, keyframe_path: undefined }];
    const view = presentEreversePft(pft, "job2", assetUrl);
    assert.equal(view.chunks.length, 0);
    assert.equal(view.wordCount, 0);
    assert.equal(view.scenes[0].keyframeUrl, null);
});
