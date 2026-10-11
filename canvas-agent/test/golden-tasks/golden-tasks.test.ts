import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGoldenTasks, assertTaskSetSanity } from "../../src/modules/golden-tasks/tasks.js";
import { evaluateTask } from "../../src/modules/golden-tasks/deterministic-checks.js";
import { goldenTaskSchema } from "../../src/modules/golden-tasks/contracts.js";

// ═══════════════════════════════════════════════════════════════════════════
// 任务集契约与覆盖度
// ═══════════════════════════════════════════════════════════════════════════

test("金标任务集加载并通过契约校验（16 条）", () => {
    const tasks = loadGoldenTasks();
    assertTaskSetSanity(tasks);
    assert.equal(tasks.length, 16);
});

test("任务 ID 唯一且符合 GT-<域><序号> 模式", () => {
    const tasks = loadGoldenTasks();
    const ids = tasks.map((task) => task.taskId);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
        assert.match(id, /^GT-[A-Z]\d{2}$/);
    }
});

test("五大技能域与哨兵域全覆盖", () => {
    const tags = new Set(loadGoldenTasks().map((task) => task.tag));
    for (const expected of ["drama", "social", "ecommerce", "creative", "others", "sentinel"] as const) {
        assert.ok(tags.has(expected), `缺少技能域：${expected}`);
    }
});

test("哨兵任务：无主观维度、核心检查加权、带 notes", () => {
    const sentinels = loadGoldenTasks().filter((task) => task.sentinel);
    assert.equal(sentinels.length, 3);
    for (const sentinel of sentinels) {
        assert.equal(sentinel.subjectiveDimensions.length, 0);
        assert.ok(sentinel.notes && sentinel.notes.length > 0);
        const core = sentinel.checks.find((check) => check.points >= 3);
        assert.ok(core, `${sentinel.taskId} 哨兵核心检查应加权 ≥3 分`);
    }
});

test("每条任务至少 1 条阻断检查；主观维度锚点 ≥2 且权重为正", () => {
    for (const task of loadGoldenTasks()) {
        assert.ok(task.checks.some((check) => check.blocking), `${task.taskId} 缺少阻断性检查`);
        for (const dim of task.subjectiveDimensions) {
            assert.ok(dim.anchors.length >= 2, `${task.taskId}/${dim.dimId} 锚点不足`);
            assert.ok(dim.weight > 0);
        }
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// 确定性检查引擎
// ═══════════════════════════════════════════════════════════════════════════

const validStoryboard = () => ({
    title: "雨夜当铺",
    subjects: [
        { id: "boss", name: "老板", position: [0, 0, 0] },
        { id: "girl", name: "少女", position: [4, 0, 0] },
    ],
    scenes: [{ sceneId: "SC01", axisSubjectIds: ["boss", "girl"] }],
    shots: [
        { shotId: "S01", sceneId: "SC01", clipId: "C01", durationSec: 6, cameraPosition: [2, 1.6, 3], narrativePurpose: "建立对峙关系" },
        { shotId: "S02", sceneId: "SC01", clipId: "C01", durationSec: 5, cameraPosition: [3, 1.7, 2.5] },
        { shotId: "S03", sceneId: "SC01", clipId: "C02", durationSec: 8, cameraPosition: [1, 1.5, 3.5] },
    ],
});

const engineTask = goldenTaskSchema.parse({
    taskId: "GT-T01",
    title: "引擎测试任务（全检查类型）",
    tag: "drama",
    targetSkills: ["测试技能"],
    sentinel: false,
    brief: "覆盖全部确定性检查类型的测试任务。",
    constraints: { ratio: "16:9", durationSec: [4, 15] },
    expectedArtifacts: ["scriptText", "beatSheet", "storyboard", "compiledPrompts"],
    checks: [
        { checkId: "T-schema", type: "schema_valid", blocking: true, points: 2 },
        { checkId: "T-axis", type: "axis_guard", blocking: true, points: 2 },
        { checkId: "T-midpoint", type: "beat_percentage", beat: "midpoint|中点", minPct: 45, maxPct: 55, points: 1 },
        { checkId: "T-bstory", type: "beat_percentage", beat: "b[_ -]?story|B故事", minPct: 8, maxPct: 18, points: 1 },
        { checkId: "T-duration", type: "duration_bounds", minSec: 4, maxSec: 15, blocking: true, points: 2 },
        { checkId: "T-clips", type: "clip_count_bounds", min: 1, max: 5, scope: "clips", points: 1 },
        { checkId: "T-ratio", type: "ratio_consistent", expected: "16:9", points: 1 },
        { checkId: "T-junk", type: "junkword_free", blocking: true, points: 1 },
        { checkId: "T-script", type: "required_pattern", pattern: "内景|INT\\.", target: "scriptText", points: 1 },
        { checkId: "T-forbid", type: "forbidden_pattern", pattern: "超逼真|masterpiece", target: "promptsJoined", points: 1 },
        { checkId: "T-purpose", type: "field_present", path: "shots.0.narrativePurpose", points: 1 },
        { checkId: "T-words", type: "word_count_bounds", target: "scriptText", minChars: 10, maxChars: 200, points: 1 },
    ],
    subjectiveDimensions: [],
});

const goodArtifacts = {
    scriptText: "内景 雨夜当铺 - 夜。柜台两侧，老板与神秘少女对峙。",
    beatSheet: {
        totalUnits: 40,
        beats: [
            { beatName: "开场画面", atUnit: 0 },
            { beatName: "B故事", atUnit: 5 },
            { beatName: "中点", atUnit: 20 },
            { beatName: "一无所有", atUnit: 30 },
        ],
    },
    storyboard: validStoryboard(),
    compiledPrompts: [
        "雨夜当铺内景，钨丝灯主光，柜台上发光怀表特写，16:9 电影构图，柯达胶片颗粒",
        "过肩镜头：少女面部轮廓光分离，背景虚化暖色霓虹",
    ],
};

function evalWith(artifacts: Record<string, unknown>) {
    return evaluateTask(engineTask, { status: "completed", artifacts: { ...goodArtifacts, ...artifacts, stageLog: [] } as never });
}

test("全绿产物：所有检查通过，detPoints = detMax", () => {
    const result = evalWith({});
    assert.equal(result.detPoints, result.detMax);
    assert.equal(result.hardFailures.length, 0);
    for (const check of result.checks) {
        assert.ok(check.passed, `${check.checkId} 应通过：${check.detail}`);
    }
});

test("越轴分镜被轴线检查拦截（复用 P0 门禁）", () => {
    const crossed = validStoryboard();
    (crossed.shots as Array<{ cameraPosition: number[] }>)[2].cameraPosition = [1.5, 1.5, -2];
    const result = evalWith({ storyboard: crossed });
    const axis = result.checks.find((check) => check.checkId === "T-axis")!;
    assert.equal(axis.passed, false);
    assert.ok(axis.detail.includes("轴线"));
    assert.ok(result.hardFailures.some((line) => line.startsWith("T-axis")));
});

test("垃圾词残留：S5 门禁未生效被确定性检查抓到", () => {
    const result = evalWith({
        compiledPrompts: ["雨夜当铺内景，超逼真，杰作质感，16:9 电影构图", "过肩镜头，暖色霓虹"],
    });
    const junk = result.checks.find((check) => check.checkId === "T-junk")!;
    assert.equal(junk.passed, false);
    const forbid = result.checks.find((check) => check.checkId === "T-forbid")!;
    assert.equal(forbid.passed, false);
});

test("画幅冲突：两种画幅同时出现被拦截", () => {
    const result = evalWith({
        compiledPrompts: ["竖版 9:16 手机端构图，霓虹雨巷", "横版 16:9 电影画幅，街景全貌"],
    });
    const ratio = result.checks.find((check) => check.checkId === "T-ratio")!;
    assert.equal(ratio.passed, false);
    assert.ok(ratio.detail.includes("画幅"));
});

test("节拍占比：中点偏离 50% 区间被拦截；B故事 12.5% 通过", () => {
    const result = evalWith({
        beatSheet: { totalUnits: 40, beats: [
            { beatName: "开场画面", atUnit: 0 },
            { beatName: "B Story", atUnit: 5 },
            { beatName: "中点", atUnit: 28 }, // 70%，超出 [45,55]
        ] },
    });
    const midpoint = result.checks.find((check) => check.checkId === "T-midpoint")!;
    assert.equal(midpoint.passed, false);
    const bstory = result.checks.find((check) => check.checkId === "T-bstory")!;
    assert.equal(bstory.passed, true); // B Story 命中英文别名，12.5% 在区间
});

test("时长越界与 Clip 数越界", () => {
    const board = validStoryboard();
    (board.shots as Array<{ durationSec: number }>)[2].durationSec = 20; // 超过 15
    const result = evalWith({ storyboard: board });
    assert.equal(result.checks.find((check) => check.checkId === "T-duration")!.passed, false);
    const tooManyClips = evalWith({
        storyboard: { ...validStoryboard(), shots: [...validStoryboard().shots, ...validStoryboard().shots].map((s, i) => ({ ...s, shotId: `S${i}`, clipId: `C${i}` })) },
    });
    assert.equal(tooManyClips.checks.find((check) => check.checkId === "T-clips")!.passed, false);
});

test("字段断言与字数边界", () => {
    const missingPurpose = evalWith({ storyboard: { ...validStoryboard(), shots: validStoryboard().shots.map((s) => ({ ...s, narrativePurpose: undefined })) } });
    assert.equal(missingPurpose.checks.find((check) => check.checkId === "T-purpose")!.passed, false);
    const longScript = evalWith({ scriptText: "内景 " + "长".repeat(300) });
    assert.equal(longScript.checks.find((check) => check.checkId === "T-words")!.passed, false);
});

test("分镜缺失：schema/axis/field 检查同时失败", () => {
    const result = evalWith({ storyboard: undefined });
    assert.equal(result.checks.find((check) => check.checkId === "T-schema")!.passed, false);
    assert.equal(result.checks.find((check) => check.checkId === "T-axis")!.passed, false);
    assert.ok(result.hardFailures.length >= 2);
});

test("哨兵任务被拦截 = 全检查通过；普通任务被拦截 = 全失败", () => {
    const sentinelTask = goldenTaskSchema.parse({ ...engineTask, taskId: "GT-T02", tag: "sentinel", sentinel: true, checks: engineTask.checks });
    const blocked: { status: "blocked"; stage: string; reason: string } = { status: "blocked", stage: "S4_storyboard", reason: "axis_guard: 镜头 S03 越轴，已阻断并等待 ask_user 确认" };

    const sentinelResult = evaluateTask(sentinelTask, blocked);
    assert.equal(sentinelResult.detPoints, sentinelResult.detMax);
    assert.equal(sentinelResult.hardFailures.length, 0);

    const normalResult = evaluateTask(engineTask, blocked);
    assert.equal(normalResult.detPoints, 0);
    assert.ok(normalResult.hardFailures.length >= 3);
});
