import assert from "node:assert/strict";
import { test } from "node:test";

import { LIVE_REFERENCE_DEFAULT_MODE, LIVE_REFERENCE_DEFAULT_STRENGTH, LIVE_REFERENCE_HANDOFF_KEY, consumeLiveReferenceHandoff, describeLiveReferenceDna, parseLiveReferenceHandoff } from "@/pages/modules/platforms-live";
import { EREVERSE_HANDOFF_KEY, buildVisualDnaText, toHandoffShots, writeEreverseHandoff, writeLiveReferenceHandoff } from "./handoff";
import type { EreverseView } from "@/lib/canvas/ereverse-view";

/** 最小可用视图模型：两镜头，字段口径与 presentEreversePft 输出一致。 */
function makeView(): EreverseView {
    return {
        durationMs: 10_000,
        sourceName: "实测爆款.mp4",
        width: 1080,
        height: 1920,
        fps: 30,
        scenes: [
            {
                index: 0,
                startMs: 0,
                endMs: 4000,
                durationMs: 4000,
                leftPct: 0,
                widthPct: 40,
                keyframeUrl: "/ereverse-api/file?job=j1&name=scene_0.png",
                tags: ["暖黄侧光", "奶油原木"],
                tagProvider: "vlm",
                shotType: "中景",
                cameraMovement: "固定机位",
                visualPrompt: "暖黄侧光的奶油风直播间",
                compliancePrompt: "暖黄侧光的奶油风直播间（防封版）",
                negativePrompt: "模糊",
                dialogue: "家人们谁懂啊",
                hasSpeech: true,
                promptSlots: {
                    主体: { 身份: "愤怒男子", 外观: "黑色西装", 动作: "伸手指向屏幕" },
                    产品: { 名称与外观: "红光坐灸仪", 展示方式: "手持" },
                    场景背景: { 环境: "直播间", 光影色调: "暖黄侧光" },
                    镜头运镜: { 景别: "中景", 运镜: "固定机位" },
                    口播台词: "家人们谁懂啊",
                },
            },
            {
                index: 1,
                startMs: 4000,
                endMs: 10_000,
                durationMs: 6000,
                leftPct: 40,
                widthPct: 60,
                keyframeUrl: null,
                tags: [],
                tagProvider: "",
                shotType: "",
                cameraMovement: "",
                visualPrompt: "",
                compliancePrompt: "",
                negativePrompt: "",
                dialogue: "",
                hasSpeech: false,
                promptSlots: {
                    主体: { 身份: "", 外观: "", 动作: "" },
                    产品: { 名称与外观: "", 展示方式: "" },
                    场景背景: { 环境: "", 光影色调: "" },
                    镜头运镜: { 景别: "", 运镜: "" },
                    口播台词: "",
                },
            },
        ],
        chunks: [],
        wordCount: 0,
        asrProvider: "",
        vlmProvider: "zhipu:glm-4v-flash",
        timelineSource: "none",
        degraded: [],
        generatedAt: "2026-10-29T00:00:00Z",
        tracks: [{ kind: "audio", codec: "aac", extractedPath: "", note: "" }],
        speechSpans: [{ startMs: 0, endMs: 4000, isSilence: false }],
        fragment: null,
    };
}

/** 给 window.localStorage 装一个内存假身（bun 测试环境无 DOM）。 */
function withFakeLocalStorage(run: () => void) {
    const store = new Map<string, string>();
    const fake = {
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
        setItem: (k: string, v: string) => void store.set(k, v),
    };
    (globalThis as unknown as { window: unknown }).window = { localStorage: fake };
    try {
        run();
    } finally {
        (globalThis as unknown as { window?: unknown }).window = undefined;
    }
}

test("直播台参考图 DNA 提示词：只摘有值字段，空 DNA 返回空串（不占位不臆造）", () => {
    assert.equal(describeLiveReferenceDna({}, LIVE_REFERENCE_DEFAULT_STRENGTH), "");
    const text = describeLiveReferenceDna(
        {
            color: { summary: "暖奶油色调", palette: [{ hex: "#F5DEB3" }, { hex: "#8B5A2B" }], temperature: "暖" },
            lighting: { summary: "柔和窗光", keywords: ["侧光", "柔光"] },
            layout: { summary: "中部留白" },
        },
        0.8,
    );
    assert.ok(text.includes("色彩：暖奶油色调"));
    assert.ok(text.includes("主色调 #F5DEB3 / #8B5A2B"));
    assert.ok(text.includes("光影：柔和窗光（侧光、柔光）"));
    assert.ok(text.includes("空间留白：中部留白"));
    assert.ok(text.includes("借鉴强度：0.80"));
    assert.ok(!text.includes("材质：")); // 空字段不出现
});

test("直播台外来载荷解析：坏 JSON / 非 ereverse 来源一律拒绝", () => {
    assert.equal(parseLiveReferenceHandoff(null), null);
    assert.equal(parseLiveReferenceHandoff("{not json"), null);
    assert.equal(parseLiveReferenceHandoff(JSON.stringify({ source: "other" })), null);
});

test("直播台外来载荷解析：模式恒为 style；强度异常值回落 0.6；非 data: 帧丢弃", () => {
    const parsed = parseLiveReferenceHandoff(JSON.stringify({ source: "ereverse", sourceName: "x", mode: "layout", strength: 9, dataUrl: "https://example.com/a.png", dnaText: "配方" }));
    assert.equal(parsed?.mode, "style");
    assert.equal(parsed?.strength, 0.6);
    assert.equal(parsed?.dataUrl, undefined);
    assert.equal(parsed?.dnaText, "配方");
});

test("直播台外来载荷消费：没有 from=ereverse 标记不认账，带标记读后即删", () => {
    withFakeLocalStorage(() => {
        const payload = JSON.stringify({ source: "ereverse", sourceName: "x" });
        window.localStorage.setItem(LIVE_REFERENCE_HANDOFF_KEY, payload);
        assert.equal(consumeLiveReferenceHandoff(""), null);
        assert.equal(consumeLiveReferenceHandoff("?foo=1"), null);
        assert.equal(window.localStorage.getItem(LIVE_REFERENCE_HANDOFF_KEY), payload); // 未标记不动存量
        assert.equal(consumeLiveReferenceHandoff("?from=ereverse")?.source, "ereverse");
        assert.equal(window.localStorage.getItem(LIVE_REFERENCE_HANDOFF_KEY), null); // 一次性消费
    });
});

test("出口载荷：镜头序列取防封提示词优先，空提示词不臆造", () => {
    const shots = toHandoffShots(makeView());
    assert.equal(shots.length, 2);
    assert.equal(shots[0].prompt, "暖黄侧光的奶油风直播间（防封版）");
    assert.equal(shots[1].prompt, "");
});

test("出口载荷：视觉配方文本含来源名、标签池与镜头行", () => {
    const text = buildVisualDnaText(makeView());
    assert.ok(text.includes("爆款「实测爆款.mp4」视觉配方"));
    assert.ok(text.includes("暖黄侧光"));
    assert.ok(text.includes("镜头1（中景 · 固定机位）"));
});

test("直播台载荷：无参考帧 → frameDropped；写入后可从同键读回", () => {
    withFakeLocalStorage(() => {
        const dropped = writeLiveReferenceHandoff({ sourceName: "x", dnaText: "配方" });
        assert.equal(dropped.frameDropped, true);
        const parsed = parseLiveReferenceHandoff(window.localStorage.getItem(LIVE_REFERENCE_HANDOFF_KEY));
        assert.equal(parsed?.dnaText, "配方");
        assert.equal(parsed?.strength, LIVE_REFERENCE_DEFAULT_STRENGTH);
        assert.equal(parsed?.mode, LIVE_REFERENCE_DEFAULT_MODE);
    });
});

test("画布 / 制片台快照：带 target 与镜头序列落盘", () => {
    withFakeLocalStorage(() => {
        writeEreverseHandoff({ target: "canvas", sourceName: "x", shots: toHandoffShots(makeView()), visualDnaText: "配方" });
        const raw = JSON.parse(window.localStorage.getItem(EREVERSE_HANDOFF_KEY) || "{}");
        assert.equal(raw.source, "ereverse");
        assert.equal(raw.target, "canvas");
        assert.equal(raw.shots.length, 2);
    });
});
