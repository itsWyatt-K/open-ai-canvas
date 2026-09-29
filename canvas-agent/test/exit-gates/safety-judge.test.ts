// B2 安全三层测试：聚焦"失败方向"与"不静默"两条铁律
import test from "node:test";
import assert from "node:assert/strict";

import {
    defaultExitGateRules,
    defaultSafetyWordlist,
    defaultCompetitorWordlist,
    filterJunkWords,
    type JunkwordRule,
} from "../../src/modules/exit-gates/junkword-filter.js";
import {
    createModelSafetyJudge,
    createReviewOnlySafetyJudge,
    extractJsonArray,
    summarizeSafetyVerdicts,
} from "../../src/modules/exit-gates/safety-judge.js";
import { runExitGateAsync, formatAskUserMessage } from "../../src/modules/exit-gates/exit-gate.js";

const SAFETY_PROMPT = "医学插画：正面展示人体骨骼与肌肉结构，用于解剖学教材配图。";

test("安全词表自检：每条规则必须 action=flag 且 domain=safety", () => {
    assert.ok(defaultSafetyWordlist.length > 0, "安全词表不应为空");
    for (const rule of defaultSafetyWordlist) {
        assert.equal(rule.action, "flag", `${rule.ruleId} 安全域初筛只能是 flag`);
        assert.equal(rule.domain, "safety", `${rule.ruleId} 未标注 safety 域`);
        assert.ok(rule.pattern.global, `${rule.ruleId} 正则缺少 g 标志`);
    }
});

test("竞品词表自检：软警告、不改文本", () => {
    for (const rule of defaultCompetitorWordlist) {
        assert.equal(rule.domain, "competitor");
        assert.equal(rule.severity, "soft");
    }
    const result = filterJunkWords("参考 Midjourney 的质感做一张图", defaultCompetitorWordlist);
    assert.equal(result.cleanedPrompt, "参考 Midjourney 的质感做一张图", "竞品域禁止改写文本");
    assert.equal(result.rejected, false);
    assert.equal(result.stats.warned, 1);
    assert.equal(result.hits[0].domain, "competitor");
});

test("安全域规则若配成非 flag → 直接抛错（静态兜底，防止有人偷偷硬拦）", () => {
    const bad: JunkwordRule[] = [
        {
            ruleId: "safety-bad-reject",
            pattern: /违禁示例/g,
            action: "reject",
            severity: "hard",
            domain: "safety",
            reason: "应为 flag",
        },
    ];
    assert.throws(() => filterJunkWords("违禁示例", bad), /必须为 flag/);
});

test("三域规则集齐备且互不污染：安全候选不进 cleanedPrompt、不计 strip", () => {
    const result = filterJunkWords(SAFETY_PROMPT, defaultExitGateRules);
    assert.equal(result.safetyCandidates.length, 0, "正当医学语境不该命中内置安全泛词");
    const hitResult = filterJunkWords("夜市一角，背景隐约有博彩广告牌。", defaultExitGateRules);
    assert.equal(hitResult.cleanedPrompt, "夜市一角，背景隐约有博彩广告牌。", "安全域禁止改写文本");
    assert.equal(hitResult.stats.stripped, 0, "安全域不计入剥离");
    assert.equal(hitResult.stats.flagged, hitResult.safetyCandidates.length);
    assert.ok(hitResult.byDomain.safety >= 1);
    assert.equal(typeof hitResult.byDomain.quality, "number");
});

test("reviewOnly 判定器：全部转人工，modelJudged=false，摘要标记降级", async () => {
    const judge = createReviewOnlySafetyJudge();
    const candidates = filterJunkWords("博彩", defaultExitGateRules).safetyCandidates;
    const verdicts = await judge.judge(candidates, { prompt: "博彩" });
    assert.equal(verdicts.length, candidates.length);
    for (const verdict of verdicts) {
        assert.equal(verdict.judgement, "review");
        assert.equal(verdict.modelJudged, false);
        assert.equal(verdict.confidence, 0);
    }
    const summary = summarizeSafetyVerdicts(verdicts);
    assert.equal(summary.passed, 0, "默认判定器绝不自行放行");
    assert.equal(summary.humanQueue.length, verdicts.length);
    assert.equal(summary.degraded, true);
});

test("模型判定器：正常解析（含 ```json 围栏）并按置信度与结论分派", async () => {
    const judge = createModelSafetyJudge({
        judgeId: "fake-judge@test",
        reviewThreshold: 0.7,
        callModel: async () =>
            '无关前缀\n```json\n[{"index":1,"judgement":"pass","confidence":0.95,"rationale":"普法语境"},' +
            '{"index":2,"judgement":"block","confidence":0.9,"rationale":"确为涉赌推广"},' +
            '{"index":3,"judgement":"block","confidence":0.4,"rationale":"拿不准"}]\n```\n后缀',
    });
    const candidates = filterJunkWords("博彩 赌博 下注", defaultExitGateRules).safetyCandidates;
    assert.ok(candidates.length >= 3, "用例需要至少 3 个候选，实际 " + candidates.length);
    const verdicts = await judge.judge(candidates, { prompt: "博彩 赌博 下注" });
    assert.equal(verdicts[0].judgement, "pass");
    assert.equal(verdicts[0].modelJudged, true);
    assert.equal(verdicts[1].judgement, "block");
    assert.equal(verdicts[2].judgement, "review", "低置信度 block 必须降级为人工");
    const summary = summarizeSafetyVerdicts(verdicts);
    assert.equal(summary.passed, 1);
    assert.equal(summary.blocked, 1);
    assert.equal(summary.review, 1);
    assert.equal(summary.degraded, false);
    assert.deepEqual(summary.judgeIds, ["fake-judge@test"]);
});

test("模型判定器失败方向：抛错 / 非 JSON / 未知结论 / 候选未覆盖 → 一律转人工", async () => {
    const candidates = filterJunkWords("博彩 赌博 下注", defaultExitGateRules).safetyCandidates;

    const cases: Array<{ name: string; callModel: (s: string, u: string) => Promise<string> }> = [
        { name: "抛错", callModel: async () => { throw new Error("渠道 502"); } },
        { name: "非JSON", callModel: async () => "我思考了一下，这个问题很复杂" },
        { name: "未知结论", callModel: async () => '[{"index":1,"judgement":"maybe","confidence":0.9,"rationale":"x"}]' },
        { name: "少覆盖", callModel: async () => '[{"index":1,"judgement":"pass","confidence":0.99,"rationale":"ok"}]' },
    ];

    for (const item of cases) {
        const judge = createModelSafetyJudge({ callModel: item.callModel });
        const verdicts = await judge.judge(candidates, { prompt: "..." });
        const allReview = verdicts.every((v) => v.judgement === "review");
        assert.equal(allReview, true, `${item.name} 场景未全部降级为 review`);
        assert.equal(
            verdicts.some((v) => v.judgement === "pass"),
            false,
            `${item.name} 场景出现了静默放行`,
        );
    }
});

test("extractJsonArray 能从围栏与前后废话中提取数组", () => {
    assert.deepEqual(extractJsonArray('```json\n[{"a":1}]\n```'), [{ a: 1 }]);
    assert.deepEqual(extractJsonArray('说明：\n[{"a":2}]\n以上'), [{ a: 2 }]);
    assert.throws(() => extractJsonArray("没有数组"));
});

test("runExitGateAsync：有安全候选 → 不放行，且 ask_user 必须给出人工放行选项", async () => {
    const report = await runExitGateAsync({ prompt: "夜市一角，背景有博彩广告牌。" });
    assert.equal(report.passed, false, "存在待人工处置项时禁止放行");
    assert.ok(report.blockers.some((line) => line.includes("[safety-review]")));
    assert.ok(report.safety && report.safety.humanQueue.length >= 1);
    assert.equal(report.junkword?.cleanedPrompt, "夜市一角，背景有博彩广告牌。", "未被确定性改写");

    const message = formatAskUserMessage(report);
    assert.ok(message.includes("博彩"), "ask_user 必须列出具体命中词");
    assert.ok(message.includes("处置权在你"), "ask_user 必须明示处置权归属");
    assert.ok(message.includes("[3]"), "必须提供人工放行选项，否则等于静默硬拦");
});

test("runExitGateAsync：语义判定为 pass 时可以真正放行（避免误报永久堵死产线）", async () => {
    const judge = createModelSafetyJudge({
        judgeId: "fake-judge@pass",
        callModel: async (_s, userPrompt) => {
            const count = (userPrompt.match(/^\d+\./gm) ?? []).length;
            return JSON.stringify(
                Array.from({ length: count }, (_, i) => ({
                    index: i + 1,
                    judgement: "pass",
                    confidence: 0.95,
                    rationale: "普法语境",
                })),
            );
        },
    });
    const report = await runExitGateAsync({ prompt: "普法短片：揭露博彩骗局的话术套路。", safetyJudge: judge });
    assert.equal(report.passed, true, "语义判定通过后应放行");
    assert.equal(report.safety?.passed, report.safety?.total);
    assert.equal(report.safety?.humanQueue.length, 0);
});

test("质量域行为零回归：确定性剥离在多域规则集下依然生效", async () => {
    const report = await runExitGateAsync({ prompt: "杰作风格，8k，城市夜景。" });
    assert.ok(report.autofixProposals.some((p) => p.kind === "strip_junkwords"));
    assert.ok(!report.junkword?.cleanedPrompt.includes("杰作"));
    assert.ok(!report.junkword?.cleanedPrompt.includes("8k"));
});
