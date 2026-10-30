import assert from "node:assert/strict";
import { test } from "node:test";

import {
    ENTER_TYPES,
    EXIT_TYPES,
    TRANSITION_TYPES,
    applyRecommendedPresets,
    blueprintFromMotion,
    classifyEditImpact,
    defaultFpsFor,
    describePlan,
    emptyBlueprint,
    estimateLocalMs,
    isEmergencyFps,
    presetsWithinEnums,
    resolveThemeValue,
    shotNeedsPreset,
    type MotionBlueprint,
} from "@/lib/omnireplica/blueprint";
import { MOTION_PRESETS } from "@/lib/omnireplica/motion-presets";

/** 三镜头演示蓝图：shot_2 的标题引用 theme.colors.primary，shot_3 引用 text。 */
function makeBlueprint(): MotionBlueprint {
    const blueprint = emptyBlueprint("测试工程");
    blueprint.canvas.duration_ms = 15_000;
    blueprint.shots = [
        {
            shot_id: "shot_1",
            start_ms: 0,
            end_ms: 5_000,
            enter: { type: "fade-up", duration_ms: 400 },
            elements: [{ element_id: "t1", type: "text", text: "家人们谁懂啊", position: { x: 0.5, y: 0.18 }, color: "@theme.colors.text" }],
        },
        {
            shot_id: "shot_2",
            start_ms: 5_000,
            end_ms: 10_000,
            enter: { type: "zoom-in", duration_ms: 450 },
            elements: [{ element_id: "t2", type: "text", text: "限时直降", position: { x: 0.5, y: 0.3 }, color: "@theme.colors.primary" }],
        },
        {
            shot_id: "shot_3",
            start_ms: 10_000,
            end_ms: 15_000,
            elements: [{ element_id: "b1", type: "text", text: "链接已挂好", position: { x: 0.5, y: 0.82 }, color: "@theme.colors.text" }],
        },
    ];
    return blueprint;
}

// ---------------------------------------------------------------------------
// 影响条判定（按 outcome 不按 cause）
// ---------------------------------------------------------------------------

test("影响判定：改被引用主题色 → 局部（只废真引用该变量的镜头）", () => {
    const prev = makeBlueprint();
    const next = structuredClone(prev);
    next.theme.colors.primary = "#00B96B";
    const impact = classifyEditImpact(prev, next);
    assert.equal(impact.scope, "partial");
    assert.deepEqual(impact.changedShotIds, ["shot_2"]);
    assert.equal(impact.changedRatio, 5_000 / 15_000);
});

test("影响判定：改无人引用的主题色 → 零变更（inert 明示）", () => {
    const prev = makeBlueprint();
    const next = structuredClone(prev);
    next.theme.colors.unused = "#123456"; // 新增键，无任何元素引用
    const impact = classifyEditImpact(prev, next);
    assert.equal(impact.scope, "none");
    assert.deepEqual(impact.changedShotIds, []);
    assert.deepEqual(impact.inertThemeKeys, ["unused"]);
});

test("影响判定：全局作用域字段（fps/时长/画幅/背景/转场/字体）任一变化 → 全局", () => {
    for (const mutate of [
        (bp: MotionBlueprint) => void (bp.canvas.fps = 30),
        (bp: MotionBlueprint) => void (bp.canvas.duration_ms = 20_000),
        (bp: MotionBlueprint) => void (bp.canvas.width = 720),
        (bp: MotionBlueprint) => void (bp.canvas.background.solid = "#FFFFFF"),
        (bp: MotionBlueprint) => void bp.transitions.push({ after_shot: "shot_1", type: "cut", duration_ms: 200 }),
        (bp: MotionBlueprint) => void (bp.theme.fonts.title = "simhei.ttf"),
    ]) {
        const prev = makeBlueprint();
        const next = structuredClone(prev);
        mutate(next);
        const impact = classifyEditImpact(prev, next);
        assert.equal(impact.scope, "global");
        assert.ok(impact.globalReasons.length > 0);
        assert.equal(impact.changedShotIds.length, 3);
    }
});

test("影响判定：只改一个镜头元素 → 局部；全镜头都改 → 全局（全未命中）", () => {
    const prev = makeBlueprint();
    const one = structuredClone(prev);
    one.shots[1].elements[0].text = "改了文案";
    assert.equal(classifyEditImpact(prev, one).scope, "partial");
    assert.deepEqual(classifyEditImpact(prev, one).changedShotIds, ["shot_2"]);

    const all = structuredClone(prev);
    for (const shot of all.shots) shot.elements[0].text = `${shot.elements[0].text}！`;
    assert.equal(classifyEditImpact(prev, all).scope, "global");
});

test("影响判定：零变更 → scope none，本地预估 0ms", () => {
    const prev = makeBlueprint();
    const impact = classifyEditImpact(prev, structuredClone(prev));
    assert.equal(impact.scope, "none");
    assert.equal(estimateLocalMs(90_000, impact), 0);
});

test("本地公式预估：T_全量 × 变更比例 + 10s 固定开销；无基线返回 null", () => {
    const prev = makeBlueprint();
    const next = structuredClone(prev);
    next.shots[1].elements[0].text = "改了";
    const impact = classifyEditImpact(prev, next);
    assert.equal(estimateLocalMs(90_000, impact), Math.round(90_000 * (1 / 3) + 10_000));
    assert.equal(estimateLocalMs(null, impact), null);
});

// ---------------------------------------------------------------------------
// fps 裁决（R6）
// ---------------------------------------------------------------------------

test("fps 默认值：480p=24 / 1080p=30；15fps 为应急档", () => {
    assert.equal(defaultFpsFor("480p"), 24);
    assert.equal(defaultFpsFor("1080p"), 30);
    assert.equal(defaultFpsFor("720p"), 24);
    assert.equal(isEmergencyFps(15), true);
    assert.equal(isEmergencyFps(24), false);
});

// ---------------------------------------------------------------------------
// plan 格式化（唯一耗时数据源）
// ---------------------------------------------------------------------------

test("plan 摘要：重截/命中/预计/全量 + 节省百分比", () => {
    const { summary, savingPct } = describePlan({ recapture_count: 1, reuse_count: 2, estimated_ms: 25_000, full_render_ms: 75_000 });
    assert.ok(summary.includes("重截 1 镜头"));
    assert.ok(summary.includes("命中缓存 2"));
    assert.ok(summary.includes("≈25 秒"));
    assert.ok(summary.includes("≈1 分 15 秒"));
    assert.equal(savingPct, 67);
    assert.equal(describePlan({ recapture_count: 3, reuse_count: 0, estimated_ms: 90_000, full_render_ms: 90_000 }).savingPct, 0);
});

// ---------------------------------------------------------------------------
// blueprintFromMotion（模板给默认值、VLM 只填槽；集合外映射 none + degraded）
// ---------------------------------------------------------------------------

test("motion 装配：枚举外动效映射 none + degraded 登记；漏返不兜底", () => {
    const blueprint = blueprintFromMotion(
        {
            shots: [
                { shot_id: "s1", start_ms: 0, end_ms: 3000, enter: { type: "wobble-in" }, elements: [{ element_id: "e1", type: "text", text: "x", position: { x: 0.5, y: 0.5 } }] },
                { shot_id: "s2", start_ms: 3000, end_ms: 6000, confidence: 0.4, elements: [] },
            ],
            transitions: [{ after_shot: "s1", type: "rainbow-swirl", duration_ms: 200 }],
        },
        { title: "T", ereverseJobId: "j1", durationMs: 6000 },
    );
    assert.equal(blueprint.shots[0].enter?.type, "none");
    assert.ok(blueprint.shots[0].degraded?.some((item) => item.includes("wobble-in")));
    assert.equal(
        blueprint.shots[1].degraded?.some((item) => item.includes("置信度")),
        true,
    );
    assert.equal(blueprint.transitions[0].type, "none");
    assert.ok(blueprint.meta.provenance.degraded.some((item) => item.includes("rainbow-swirl")));

    const missing = blueprintFromMotion(null, {});
    assert.equal(missing.shots.length, 0);
    assert.ok(missing.meta.provenance.degraded.some((item) => item.includes("motion-missing")));
});

test("theme 引用解析：@theme.colors.X → 实际值；非引用原样返回", () => {
    const blueprint = makeBlueprint();
    assert.equal(resolveThemeValue(blueprint, "@theme.colors.primary"), blueprint.theme.colors.primary);
    assert.equal(resolveThemeValue(blueprint, "#ABCDEF"), "#ABCDEF");
});

test("空蓝图主题种子：覆盖预置模板五色引用（accent/mood 有解析基准，单一数据源）", () => {
    const blueprint = emptyBlueprint();
    for (const key of ["primary", "text", "stroke", "accent", "mood"]) assert.ok(blueprint.theme.colors[key], `缺主题色 ${key}`);
    assert.equal(resolveThemeValue(blueprint, "@theme.colors.accent"), blueprint.theme.colors.accent);
    assert.equal(resolveThemeValue(blueprint, "@theme.colors.mood"), blueprint.theme.colors.mood);
});

test("motion 装配：词表版本/产出方回填 provenance；枚举外动效文案带词表号", () => {
    const blueprint = blueprintFromMotion(
        {
            wordlist_version: "motion-wordlist/v1",
            generated_by: "ereverse-motion/0.2",
            shots: [{ shot_id: "s1", start_ms: 0, end_ms: 3000, enter: { type: "wobble-in" }, elements: [{ element_id: "e1", type: "text", text: "x", position: { x: 0.5, y: 0.5 } }] }],
        },
        {},
    );
    assert.equal(blueprint.meta.provenance.wordlist_version, "motion-wordlist/v1");
    assert.equal(blueprint.meta.provenance.generated_by, "ereverse-motion/0.2");
    assert.ok(blueprint.shots[0].degraded?.some((item) => item.includes("词表 motion-wordlist/v1")));
});

// ---------------------------------------------------------------------------
// 预置模板（degraded 三机制之二）
// ---------------------------------------------------------------------------

test("预置模板自检：全部动效落在引擎枚举内（preset 回归第一道闸）", () => {
    assert.equal(presetsWithinEnums(), true);
    assert.equal(MOTION_PRESETS.length, 3);
});

test("一键补齐：只补待确认镜头；无适配模板诚实告知；采用后 cleared degraded", () => {
    const blueprint = makeBlueprint();
    blueprint.shots[1].degraded = ["低置信，建议人工确认"];
    blueprint.shots[1].confidence = 0.3;
    const result = applyRecommendedPresets(blueprint);
    assert.ok(result.filledShotIds.includes("shot_2"));
    assert.ok(!result.filledShotIds.includes("shot_1")); // 无 degraded 且已有动效 → 不碰
    const patched = result.blueprint.shots[1];
    assert.equal(patched.enter?.type, "fade");
    assert.equal(patched.degraded, undefined); // degraded 键被清除（JSON 干净）
});

test("shotNeedsPreset：degraded/低置信/动效缺失三类判待确认", () => {
    const shot = { shot_id: "s", start_ms: 0, end_ms: 1000, elements: [{ element_id: "e", type: "text" as const, text: "x", position: { x: 0, y: 0 } }] };
    assert.equal(shotNeedsPreset(shot), true); // 无动效
    assert.equal(shotNeedsPreset({ ...shot, enter: { type: "fade", duration_ms: 200 } }), false);
    assert.equal(shotNeedsPreset({ ...shot, enter: { type: "fade" }, degraded: ["x"] }), true);
    assert.equal(shotNeedsPreset({ ...shot, enter: { type: "fade" }, confidence: 0.2 }), true);
});

test("动效枚举非空且互斥口径稳定（UI 下拉与引擎同源）", () => {
    assert.ok(ENTER_TYPES.includes("fade-up"));
    assert.ok(EXIT_TYPES.includes("scale-down"));
    assert.ok(TRANSITION_TYPES.includes("dip-to-white"));
});
