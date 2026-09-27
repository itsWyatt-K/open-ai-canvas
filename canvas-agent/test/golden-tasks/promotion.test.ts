import { test } from "node:test";
import assert from "node:assert/strict";
import { binomialTail, decidePromotion, compareTask } from "../../src/modules/golden-tasks/promotion.js";
import { MockPipelineExecutor, runGoldenSet } from "../../src/modules/golden-tasks/runner.js";
import { MockPairwiseJudge } from "../../src/modules/golden-tasks/judge.js";
import { goldenTaskSchema, type TaskComparison, type CheckResult, type TaskEvaluation } from "../../src/modules/golden-tasks/contracts.js";

// ═══════════════════════════════════════════════════════════════════════════
// 符号检验（精确二项）
// ═══════════════════════════════════════════════════════════════════════════

test("二项尾概率与手算一致", () => {
    assert.ok(Math.abs(binomialTail(10, 16) - 14893 / 65536) < 1e-9); // ≈ 0.2272
    assert.ok(Math.abs(binomialTail(13, 16) - 697 / 65536) < 1e-9); // ≈ 0.0106
    assert.ok(Math.abs(binomialTail(16, 16) - 1 / 65536) < 1e-9);
    assert.equal(binomialTail(0, 5), 1); // 全部尾项求和 = 1
    assert.equal(binomialTail(7, 5), 0); // k > n → 0
});

// ═══════════════════════════════════════════════════════════════════════════
// 任务级裁决：确定性优先，主观只打破平局
// ═══════════════════════════════════════════════════════════════════════════

const baseTask = goldenTaskSchema.parse({
    taskId: "GT-J01",
    title: "裁决测试任务",
    tag: "drama",
    targetSkills: ["测试技能"],
    sentinel: false,
    brief: "裁决规则测试任务：用于验证确定性优先与主观平局裁决的组合逻辑。",
    constraints: {},
    expectedArtifacts: ["compiledPrompts"],
    checks: [
        { checkId: "J-junk", type: "junkword_free", blocking: true, points: 1 },
        { checkId: "J-words", type: "word_count_bounds", target: "promptsJoined", minChars: 10, maxChars: 3000, points: 1 },
    ],
    subjectiveDimensions: [
        { dimId: "J-quality", name: "综合质量", weight: 1, anchors: ["提示词具体可执行", "叙事连贯"] },
    ],
});

function artifactsWithPrompts(prompts: string[]) {
    return { status: "completed" as const, artifacts: { compiledPrompts: prompts, stageLog: [] } };
}

test("detDelta 相等时由主观配对打破平局", async () => {
    const executor = new MockPipelineExecutor({
        "GT-J01:old": artifactsWithPrompts(["短提示词，氛围灯暖光包围主体。"]),
        "GT-J01:new": artifactsWithPrompts(["雨夜当铺内景，钨丝灯主光 3200K，柜台发光怀表特写，浅景深，柯达胶片颗粒。"]),
    });
    const judge = new MockPairwiseJudge("mock-longer", "longer"); // 稳定偏好更长提示词
    const comparison = await compareTask(baseTask, executor, judge);
    assert.equal(comparison.detDelta, 0);
    assert.ok(comparison.subjectiveNet > 0);
    assert.equal(comparison.verdict, "new_wins");
});

test("detDelta 不为零时确定性层直接裁决（主观不覆盖）", async () => {
    const executor = new MockPipelineExecutor({
        "GT-J01:old": artifactsWithPrompts(["旧版合格提示词，内容完整，长度适中，叙事清楚。"]),
        "GT-J01:new": { status: "completed", artifacts: { compiledPrompts: ["超逼真"], stageLog: [] } }, // 垃圾词 → 确定性丢分
    });
    const judge = new MockPairwiseJudge("mock-longer", "longer"); // 主观上偏好 new（更长?）——new 更短，判 old
    const comparison = await compareTask(baseTask, executor, judge);
    assert.ok(comparison.detDelta < 0);
    assert.equal(comparison.verdict, "old_wins");
});

test("位置偏置裁判：两轮结论矛盾 → 全部平局（偏置对消）", async () => {
    const executor = new MockPipelineExecutor({
        "GT-J01:old": artifactsWithPrompts(["旧版提示词，基本要素齐备。"]),
        "GT-J01:new": artifactsWithPrompts(["新版提示词，更长的内容与更多细节描写。"]),
    });
    const judge = new MockPairwiseJudge("mock-position", "position"); // 永远选第一个参数
    const comparison = await compareTask(baseTask, executor, judge);
    assert.equal(comparison.subjectiveNet, 0);
    assert.equal(comparison.verdict, "tie");
});

// ═══════════════════════════════════════════════════════════════════════════
// 晋级决策：门槛、一票否决与替代规则
// ═══════════════════════════════════════════════════════════════════════════

function makeCheck(checkId: string, passed: boolean, blocking: boolean, points: number): CheckResult {
    return { checkId, type: "test", passed, blocking, points, detail: passed ? "通过" : "失败" };
}

function makeEvaluation(checks: CheckResult[]): TaskEvaluation {
    return {
        taskId: "T",
        status: "completed",
        checks,
        detPoints: checks.filter((check) => check.passed).reduce((sum, check) => sum + check.points, 0),
        detMax: checks.reduce((sum, check) => sum + check.points, 0),
        hardFailures: checks.filter((check) => !check.passed && check.blocking).map((check) => `${check.checkId}: 失败`),
    };
}

function makeComparison(taskId: string, verdict: TaskComparison["verdict"], oldPoints: number, newPoints: number, maxPoints: number, regression = false): TaskComparison {
    const oldChecks = [makeCheck("c1", true, true, maxPoints)];
    const newChecks = [makeCheck("c1", !regression, true, maxPoints)];
    const oldEvaluation = makeEvaluation(oldChecks);
    const newEvaluation = makeEvaluation(newChecks);
    // 手动对齐分值以构造场景
    oldEvaluation.detPoints = oldPoints;
    newEvaluation.detPoints = newPoints;
    newEvaluation.detMax = maxPoints;
    oldEvaluation.detMax = maxPoints;
    return {
        taskId, title: `任务 ${taskId}`, sentinel: false,
        oldEvaluation, newEvaluation,
        subjectives: [], subjectiveNet: 0,
        detDelta: newPoints - oldPoints,
        verdict,
    };
}

test("净胜场达标且无硬回归 → promote", () => {
    const comparisons = [
        makeComparison("T1", "new_wins", 5, 5, 5),
        makeComparison("T2", "new_wins", 5, 5, 5),
        makeComparison("T3", "tie", 5, 5, 5),
    ];
    const report = decidePromotion(comparisons, { netWinThreshold: 2, detPointSubstitute: 5, significanceAlpha: 0.1, judgeId: "test" });
    assert.equal(report.decision, "promote");
    assert.equal(report.winsNew, 2);
    assert.equal(report.winsOld, 0);
});

test("硬回归一票否决 → keep_old", () => {
    const comparisons = [
        makeComparison("T1", "new_wins", 5, 5, 5),
        makeComparison("T2", "new_wins", 5, 5, 5),
        makeComparison("T3", "new_wins", 5, 5, 5, true), // 丢了旧版通过的阻断检查
    ];
    const report = decidePromotion(comparisons, { netWinThreshold: 2, detPointSubstitute: 5, significanceAlpha: 0.1, judgeId: "test" });
    assert.equal(report.decision, "keep_old");
    assert.equal(report.hardRegressions.length, 1);
});

test("确定性总分下降 → keep_old", () => {
    const comparisons = [
        makeComparison("T1", "new_wins", 5, 5, 5),
        makeComparison("T2", "new_wins", 5, 5, 5),
        makeComparison("T3", "old_wins", 5, 2, 5), // 总分 12 < 15
    ];
    const report = decidePromotion(comparisons, { netWinThreshold: 2, detPointSubstitute: 5, significanceAlpha: 0.1, judgeId: "test" });
    assert.equal(report.decision, "keep_old");
});

test("净胜 1 场但确定性分差 ≥5 → 替代规则晋级", () => {
    const comparisons = [
        makeComparison("T1", "new_wins", 5, 5, 5),
        makeComparison("T2", "new_wins", 2, 7, 7), // detDelta +5
        makeComparison("T3", "old_wins", 3, 3, 3),
    ];
    const report = decidePromotion(comparisons, { netWinThreshold: 2, detPointSubstitute: 5, significanceAlpha: 0.1, judgeId: "test" });
    assert.equal(report.decision, "promote");
    // 净胜 1 场、总分 15 vs 10
});

test("胜负相抵 → inconclusive（增益稀疏是正常态）", () => {
    const comparisons = [
        makeComparison("T1", "new_wins", 5, 5, 5),
        makeComparison("T2", "old_wins", 5, 5, 5),
        makeComparison("T3", "tie", 5, 5, 5),
    ];
    const report = decidePromotion(comparisons, { netWinThreshold: 2, detPointSubstitute: 5, significanceAlpha: 0.1, judgeId: "test" });
    assert.equal(report.decision, "inconclusive");
    assert.ok(report.rationale.length > 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Runner 端到端
// ═══════════════════════════════════════════════════════════════════════════

test("runGoldenSet 端到端：位置偏置裁判产不出假胜负", async () => {
    const tasks = [baseTask];
    const executor = new MockPipelineExecutor({
        "GT-J01:old": artifactsWithPrompts(["旧版产物。"]),
        "GT-J01:new": artifactsWithPrompts(["新版产物，细节更多。"]),
    });
    const report = await runGoldenSet(tasks, executor, new MockPairwiseJudge("mock-position", "position"));
    assert.equal(report.comparisons[0]!.subjectiveNet, 0);
    assert.equal(report.decision === "promote", false);
    assert.equal(report.decision, "inconclusive");
});
