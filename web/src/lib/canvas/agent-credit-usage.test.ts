import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { formatCreditValue, presentAgentCreditUsage } from "./agent-credit-usage.ts";

test("formatCreditValue handles zero, integers, and decimals", () => {
    assert.equal(formatCreditValue(0), "0");
    assert.equal(formatCreditValue(100), "100");
    assert.equal(formatCreditValue(0.42), "0.42");
    assert.equal(formatCreditValue(12.34567), "12.3457");
    assert.equal(formatCreditValue(undefined), "—");
    assert.equal(formatCreditValue(null), "—");
    assert.equal(formatCreditValue(NaN), "—");
});

test("presentAgentCreditUsage when 0 spent with budget", () => {
    const view = presentAgentCreditUsage(0, "200");
    assert.equal(view.spentCredits, 0);
    assert.equal(view.maxCredits, 200);
    assert.equal(view.remainingCredits, 200);
    assert.equal(view.ratio, 0);
    assert.equal(view.ring, 0);
    assert.equal(view.phase, "idle");
    assert.equal(view.percentLabel, "0%");
    assert.equal(view.heading, "积分未消耗");
});

test("presentAgentCreditUsage when partially spent (<80%)", () => {
    const view = presentAgentCreditUsage(50, 200);
    assert.equal(view.spentCredits, 50);
    assert.equal(view.maxCredits, 200);
    assert.equal(view.remainingCredits, 150);
    assert.equal(view.ratio, 0.25);
    assert.equal(view.ring, 0.25);
    assert.equal(view.phase, "ok");
    assert.equal(view.percentLabel, "25%");
    assert.equal(view.heading, "积分已用 25%");
});

test("presentAgentCreditUsage enters watch phase at >=80%", () => {
    const view = presentAgentCreditUsage(160, "200");
    assert.equal(view.ratio, 0.8);
    assert.equal(view.phase, "watch");
    assert.equal(view.percentLabel, "80%");
});

test("presentAgentCreditUsage enters exceeded phase at >=100%", () => {
    const view = presentAgentCreditUsage(210, "200");
    assert.equal(view.ratio, 1.05);
    assert.equal(view.ring, 1.0); // clamped ring
    assert.equal(view.remainingCredits, 0);
    assert.equal(view.phase, "exceeded");
    assert.equal(view.percentLabel, "105%");
    assert.match(view.heading, /预算已超限/);
});

test("presentAgentCreditUsage handles invalid/missing budget gracefully", () => {
    const view = presentAgentCreditUsage(12.5, null);
    assert.equal(view.spentCredits, 12.5);
    assert.equal(view.maxCredits, undefined);
    assert.equal(view.remainingCredits, undefined);
    assert.equal(view.phase, "ok");
    assert.equal(view.percentLabel, "12.5");
    assert.match(view.heading, /已产生 12.5 积分/);
});
