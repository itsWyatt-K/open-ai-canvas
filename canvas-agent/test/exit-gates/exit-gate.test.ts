import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAskUserMessage, runExitGate } from "../../src/modules/exit-gates/exit-gate.js";

const crossedStoryboard = {
    title: "雨夜谈判",
    subjects: [
        { id: "chen", name: "陈默", position: [0, 0, 0] },
        { id: "bai", name: "白露", position: [4, 0, 0] },
    ],
    scenes: [{ sceneId: "SC01", axisSubjectIds: ["chen", "bai"] }],
    shots: [
        { shotId: "S01", sceneId: "SC01", cameraPosition: [2, 1.6, 3] },
        { shotId: "S02", sceneId: "SC01", cameraPosition: [1.2, 1.7, -2.5] },
        { shotId: "S03", sceneId: "SC01", cameraPosition: [3, 1.5, 2.5] },
    ],
};

test("S5 门禁：垃圾词剥离不阻断，修复提案进入报告", () => {
    const report = runExitGate({
        prompt: "夜市摊位，热气蒸腾，超逼真，8K，杰作，细节饱满。摊主低头擦刀。",
    });
    assert.equal(report.passed, true);
    assert.equal(report.blockers.length, 0);
    assert.ok(report.junkword!.stats.stripped >= 4);
    assert.ok(report.autofixProposals.some((proposal) => proposal.kind === "strip_junkwords"));
    assert.ok(!report.junkword!.cleanedPrompt.includes("超逼真"));
});

test("S5 门禁：画幅冲突硬阻断", () => {
    const report = runExitGate({
        prompt: "画面比例 16:9，同时输出 9:16 竖版物料。霓虹雨夜。",
    });
    assert.equal(report.passed, false);
    assert.ok(report.blockers[0]!.includes("aspect-ratio-conflict"));
    assert.deepEqual(report.stages, ["S5_prompt"]);
});

test("S4 门禁：越轴硬阻断并给出镜像修复", () => {
    const report = runExitGate({ storyboard: crossedStoryboard });
    assert.equal(report.passed, false);
    assert.ok(report.blockers.some((line) => line.includes("CROSSED_AXIS")));
    assert.ok(report.autofixProposals.some((proposal) => proposal.kind === "mirror_camera"));
    assert.deepEqual(report.stages, ["S4_storyboard"]);
});

test("双工位联合门禁", () => {
    const report = runExitGate({
        storyboard: crossedStoryboard,
        prompt: "镜头，超逼真，杰作。画面比例 16:9 与 9:16 冲突。",
    });
    assert.deepEqual(report.stages, ["S4_storyboard", "S5_prompt"]);
    assert.equal(report.passed, false);
    assert.ok(report.blockers.some((line) => line.includes("CROSSED_AXIS")));
    assert.ok(report.blockers.some((line) => line.includes("aspect-ratio-conflict")));
});

test("干净输入直接放行", () => {
    const report = runExitGate({ prompt: "柯达 Vision3 500T 胶片颗粒，钨丝灯主光，慢门拖影。" });
    assert.equal(report.passed, true);
});

test("ask_user 消息：拦截场景渲染完整处置选项", () => {
    const report = runExitGate({
        storyboard: crossedStoryboard,
        prompt: "镜头，超逼真，杰作。",
    });
    const message = formatAskUserMessage(report);
    assert.ok(message.includes("【出口门禁拦截】"));
    assert.ok(message.includes("硬违规"));
    assert.ok(message.includes("CROSSED_AXIS"));
    assert.ok(message.includes("mirror_camera"));
    assert.ok(message.includes("[1] 应用全部自动修复并重跑门禁"));
    assert.ok(message.includes("[2] 人工修改后重新提交"));
});

test("ask_user 消息：通过场景简短汇报", () => {
    const report = runExitGate({ prompt: "干净提示词，胶片颗粒。" });
    const message = formatAskUserMessage(report);
    assert.ok(message.includes("【出口门禁通过】"));
});
