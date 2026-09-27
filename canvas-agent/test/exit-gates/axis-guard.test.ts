import { test } from "node:test";
import assert from "node:assert/strict";
import {
    mirrorCameraAcrossAxis,
    validateAxis,
    validateStoryboardAxis,
    type AxisSceneInput,
} from "../../src/modules/exit-gates/axis-guard.js";
import { validateDirectorAxis } from "../../src/modules/exit-gates/director-adapter.js";

// 场景基线：甲在 (0,0,0)，乙在 (4,0,0)，轴线沿 x 轴。
// 叉积 > 0（机位 z>0 一侧）记为甲侧，< 0（z<0）记为乙侧。
const A: AxisSceneInput["subjectA"] = [0, 0, 0];
const B: AxisSceneInput["subjectB"] = [4, 0, 0];

test("同侧机位全部通过", () => {
    const result = validateAxis([
        { sceneId: "SC01", subjectA: A, subjectB: B, shots: [
            { shotId: "S1", cameraPos: [2, 1.6, 3] },
            { shotId: "S2", cameraPos: [3, 1.7, 2.5] },
        ] },
    ]);
    assert.equal(result.passed, true);
    assert.equal(result.issues.length, 0);
    assert.deepEqual(result.sceneSummaries[0]!.sideA, ["S1", "S2"]);
});

test("少数派越轴被拦截，镜像修复落到多数侧且距离不变", () => {
    const result = validateAxis([
        { sceneId: "SC01", subjectA: A, subjectB: B, shots: [
            { shotId: "S1", cameraPos: [2, 1.6, 3] },
            { shotId: "S2", cameraPos: [3, 1.7, 2.5] },
            { shotId: "S3", cameraPos: [1.5, 1.5, -2] },
        ] },
    ]);
    assert.equal(result.passed, false);
    const crossed = result.issues.filter((issue) => issue.type === "CROSSED_AXIS");
    assert.equal(crossed.length, 1);
    assert.deepEqual(crossed[0]!.shotIds, ["S3"]);
    assert.equal(crossed[0]!.severity, "hard");

    assert.equal(result.autofixProposals.length, 1);
    const fix = result.autofixProposals[0]!;
    assert.equal(fix.shotId, "S3");
    // 镜像：z 取反、y 与 x 投影不变 → [1.5, 1.5, 2]
    assert.deepEqual(fix.suggestedCamera, [1.5, 1.5, 2]);
    // 修复后应通过多数侧判定
    const revalidated = validateAxis([
        { sceneId: "SC01", subjectA: A, subjectB: B, shots: [
            { shotId: "S1", cameraPos: [2, 1.6, 3] },
            { shotId: "S2", cameraPos: [3, 1.7, 2.5] },
            { shotId: "S3", cameraPos: fix.suggestedCamera },
        ] },
    ]);
    assert.equal(revalidated.passed, true);
});

test("镜像函数：换侧、保距、y 不变", () => {
    const mirrored = mirrorCameraAcrossAxis(A, B, [1.5, 1.5, -2]);
    assert.deepEqual(mirrored, [1.5, 1.5, 2]);
    // 斜轴线场景：轴 (0,0)→(4,4)，机位 (1,3)
    const mirroredDiag = mirrorCameraAcrossAxis([0, 0, 0], [4, 0, 4], [1, 2, 3]);
    // 投影 t = (1*4 + 3*4) / 32 = 0.5 → P=(2,2) → 镜像 (3,1)
    assert.deepEqual(mirroredDiag, [3, 2, 1]);
});

test("机位落在轴线上 → 软警告不阻断", () => {
    const result = validateAxis([
        { sceneId: "SC01", subjectA: A, subjectB: B, shots: [
            { shotId: "S1", cameraPos: [2, 1.6, 3] },
            { shotId: "S4", cameraPos: [2, 1.6, 0] },
        ] },
    ]);
    assert.equal(result.passed, true);
    const onAxis = result.issues.filter((issue) => issue.type === "ON_AXIS");
    assert.equal(onAxis.length, 1);
    assert.deepEqual(onAxis[0]!.shotIds, ["S4"]);
    assert.equal(onAxis[0]!.severity, "soft");
});

test("两侧对半分布 → SPLIT_SCENE 硬阻断", () => {
    const result = validateAxis([
        { sceneId: "SC01", subjectA: A, subjectB: B, shots: [
            { shotId: "S1", cameraPos: [2, 1.6, 3] },
            { shotId: "S2", cameraPos: [1, 1.6, -3] },
        ] },
    ]);
    assert.equal(result.passed, false);
    assert.equal(result.issues[0]!.type, "SPLIT_SCENE");
    assert.equal(result.autofixProposals.length, 0);
});

test("轴线两端重合 → DEGENERATE_AXIS 硬违规", () => {
    const result = validateAxis([
        { sceneId: "SC01", subjectA: [1, 0, 1], subjectB: [1, 0, 1], shots: [
            { shotId: "S1", cameraPos: [2, 1.6, 3] },
        ] },
    ]);
    assert.equal(result.passed, false);
    assert.equal(result.issues[0]!.type, "DEGENERATE_AXIS");
});

test("结构化分镜 JSON 端到端：越轴镜头被拦截并给出修复", () => {
    const storyboard = {
        title: "雨夜谈判",
        subjects: [
            { id: "chen", name: "陈默", position: [0, 0, 0] as const },
            { id: "bai", name: "白露", position: [4, 0, 0] as const },
        ],
        scenes: [{ sceneId: "SC01", axisSubjectIds: ["chen", "bai"] }],
        shots: [
            { shotId: "S01", sceneId: "SC01", cameraPosition: [2, 1.6, 3], shotSize: "medium", cameraMove: "static", durationSec: 6 },
            { shotId: "S02", sceneId: "SC01", cameraPosition: [1.2, 1.7, -2.5], shotSize: "close_up", durationSec: 4 },
            { shotId: "S03", sceneId: "SC01", cameraPosition: [3, 1.5, 2.5], shotSize: "full" },
        ],
    };
    const result = validateStoryboardAxis(storyboard);
    assert.equal(result.passed, false);
    const crossed = result.issues.filter((issue) => issue.type === "CROSSED_AXIS");
    assert.equal(crossed.length, 1);
    assert.deepEqual(crossed[0]!.shotIds, ["S02"]);
    assert.equal(result.autofixProposals[0]!.shotId, "S02");
});

test("分镜 JSON 不符合契约 → SCHEMA_INVALID", () => {
    const bad = {
        subjects: [{ id: "chen", name: "陈默", position: [0, 0, 0] as const }],
        scenes: [{ sceneId: "SC01", axisSubjectIds: ["chen", "ghost"] }],
        shots: [{ shotId: "S01", sceneId: "SC01" }], // 缺 cameraPosition
    };
    const result = validateStoryboardAxis(bad);
    assert.equal(result.passed, false);
    assert.equal(result.issues[0]!.type, "SCHEMA_INVALID");
});

test("轴线主体未定义 → MISSING_SUBJECT", () => {
    const bad = {
        subjects: [{ id: "chen", name: "陈默", position: [0, 0, 0] as const }],
        scenes: [{ sceneId: "SC01", axisSubjectIds: ["chen", "ghost"] }],
        shots: [{ shotId: "S01", sceneId: "SC01", cameraPosition: [2, 1.6, 3] }],
    };
    const result = validateStoryboardAxis(bad);
    assert.equal(result.passed, false);
    assert.ok(result.issues.some((issue) => issue.type === "MISSING_SUBJECT"));
});

test("Director 适配层：按主体名与 cameraId 解析并完成校验", () => {
    const scene = {
        cameras: [
            { id: "camA", transform: { position: [2, 1.6, 3] as const } },
            { id: "camB", transform: { position: [1.2, 1.7, -2.5] as const } },
            { id: "camC", transform: { position: [3, 1.5, 2.5] as const } },
        ],
        objects: [
            { name: "陈默", kind: "actor", transform: { position: [0, 0, 0] as const } },
            { name: "白露", kind: "actor", transform: { position: [4, 0, 0] as const } },
        ],
    };
    const shots = [
        { id: "S01", cameraId: "camA" },
        { id: "S02", cameraId: "camB" },
        { id: "S03", cameraId: "camC" },
    ];
    const result = validateDirectorAxis(scene, shots, { subjectAName: "陈默", subjectBName: "白露" });
    assert.equal(result.passed, false);
    const crossed = result.issues.filter((issue) => issue.type === "CROSSED_AXIS");
    assert.deepEqual(crossed[0]!.shotIds, ["S02"]);
    assert.equal(result.autofixProposals[0]!.shotId, "S02");
});

test("Director 适配层：cameraId 不存在 → SCHEMA_INVALID", () => {
    const scene = {
        cameras: [{ id: "camA", transform: { position: [2, 1.6, 3] as const } }],
        objects: [
            { name: "陈默", kind: "actor", transform: { position: [0, 0, 0] as const } },
            { name: "白露", kind: "actor", transform: { position: [4, 0, 0] as const } },
        ],
    };
    const result = validateDirectorAxis(scene, [{ id: "S01", cameraId: "camX" }], {
        subjectAName: "陈默",
        subjectBName: "白露",
    });
    assert.equal(result.passed, false);
    assert.equal(result.issues[0]!.type, "SCHEMA_INVALID");
});

test("Director 适配层：主体名找不到 → MISSING_SUBJECT", () => {
    const scene = {
        cameras: [{ id: "camA", transform: { position: [2, 1.6, 3] as const } }],
        objects: [{ name: "陈默", kind: "actor", transform: { position: [0, 0, 0] as const } }],
    };
    const result = validateDirectorAxis(scene, [{ id: "S01", cameraId: "camA" }], {
        subjectAName: "陈默",
        subjectBName: "白露",
    });
    assert.equal(result.passed, false);
    assert.ok(result.issues.some((issue) => issue.type === "MISSING_SUBJECT"));
});
