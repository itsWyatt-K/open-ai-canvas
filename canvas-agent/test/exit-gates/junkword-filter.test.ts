import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultJunkwordRules, filterJunkWords, type JunkwordRule } from "../../src/modules/exit-gates/junkword-filter.js";

test("剥离中文质量咒语词并清理残留标点", () => {
    const prompt = "夜市摊位，热气蒸腾，超逼真，8K，杰作，细节饱满。摊主低头擦刀，油光在刀刃上游走。";
    const result = filterJunkWords(prompt);
    assert.equal(result.stats.stripped, 4);
    assert.ok(result.cleanedPrompt.includes("夜市摊位"));
    assert.ok(!result.cleanedPrompt.includes("超逼真"));
    assert.ok(!result.cleanedPrompt.includes("8K"));
    assert.ok(!result.cleanedPrompt.includes("杰作"));
    assert.ok(!result.cleanedPrompt.includes("细节饱满"));
    // 剥离后不应残留连续逗号
    assert.ok(!result.cleanedPrompt.includes("，，"));
    assert.ok(!/\s{2,}/.test(result.cleanedPrompt));
    assert.equal(result.rejected, false);
    assert.equal(result.changed, true);
});

test("剥离英文质量咒语词（含连字符变体）", () => {
    const prompt = "Cinematic shot, masterpiece, best quality, ultra-realistic, trending on artstation, rain-slicked alley";
    const result = filterJunkWords(prompt);
    assert.ok(result.stats.stripped >= 4);
    assert.ok(!result.cleanedPrompt.toLowerCase().includes("masterpiece"));
    assert.ok(!result.cleanedPrompt.toLowerCase().includes("ultra-realistic"));
    assert.ok(result.cleanedPrompt.includes("rain-slicked alley"));
    // 英文文本剥离后逗号折叠为半角，不应出现全角混排
    assert.ok(!result.cleanedPrompt.includes(", ,"));
    assert.ok(!result.cleanedPrompt.includes(",,"));
});

test("单一画幅比只告警不阻断", () => {
    const prompt = "2.39:1 宽银幕画幅，低照度霓虹街头，雨水反射。";
    const result = filterJunkWords(prompt);
    assert.equal(result.rejected, false);
    assert.equal(result.stats.warned, 1);
    assert.ok(result.hits[0]!.matchedText.includes("2.39"));
    assert.ok(result.hits[0]!.action === "warn");
});

test("两个不同画幅比触发硬阻断", () => {
    const prompt = "画面比例 16:9，同时输出 9:16 竖版物料。";
    const result = filterJunkWords(prompt);
    assert.equal(result.rejected, true);
    assert.equal(result.stats.rejected, 2);
    assert.ok(result.rejectReasons[0]!.includes("16:9"));
    assert.ok(result.rejectReasons[0]!.includes("9:16"));
});

test("同一画幅比出现两次不视为冲突", () => {
    const prompt = "2.39:1 画幅，夜景。结尾叠化字幕，仍保持 2.39:1。";
    const result = filterJunkWords(prompt);
    assert.equal(result.rejected, false);
    assert.equal(result.stats.warned, 2);
});

test("时间码 00:00-00:03 不被误判为画幅比", () => {
    const prompt = "片段时间码 00:00-00:03，画幅 16:9，内容为雨夜巷战。";
    const result = filterJunkWords(prompt);
    // 00:00 与 00:03 均以 0 开头被排除，仅 16:9 记为单一告警
    assert.equal(result.rejected, false);
    const ratioHits = result.hits.filter((hit) => hit.ruleId === "aspect-ratio-conflict");
    assert.equal(ratioHits.length, 1);
    assert.equal(ratioHits[0]!.matchedText.replace(/\s/g, ""), "16:9");
});

test("干净提示词零命中", () => {
    const prompt = "柯达 Vision3 500T 胶片颗粒，钨丝灯主光，4:1 光比，慢门拖影。";
    const result = filterJunkWords(prompt);
    // 注意：4:1 属画幅候选，单一值 → 告警但不阻断
    assert.equal(result.rejected, false);
    assert.equal(result.stats.stripped, 0);
});

test("自定义规则生效", () => {
    const customRules: JunkwordRule[] = [
        {
            ruleId: "ban-pretty",
            pattern: /好看/g,
            action: "strip",
            severity: "soft",
            reason: "测试规则：好看是主观空洞词。",
        },
    ];
    const result = filterJunkWords("一个好看的镜头", customRules);
    assert.equal(result.stats.stripped, 1);
    assert.equal(result.cleanedPrompt, "一个的镜头");
});

test("非全局正则的规则直接抛错（防御性契约）", () => {
    const badRules: JunkwordRule[] = [
        { ruleId: "bad", pattern: /错/, action: "strip", severity: "hard", reason: "无 g 标志" },
    ];
    assert.throws(() => filterJunkWords("测试", badRules), /g 标志/);
});

test("默认规则集与 rules/guardrail-rules.yaml 声明的 rule_id 对齐", () => {
    const ids = defaultJunkwordRules.map((rule) => rule.ruleId);
    assert.deepEqual(ids, ["zh-quality-jargon", "en-quality-jargon", "resolution-in-prompt", "aspect-ratio-conflict"]);
});
