import { test } from "node:test";
import assert from "node:assert/strict";
import http, { type Server } from "node:http";

import {
    GateBlockedError,
    gateCompiledPrompt,
    gateStoryboard,
} from "../../src/modules/exit-gates/yingce-gate-hooks.js";
import { serverGenerateShot } from "../../src/yingce-server-executor.js";

const validStoryboard = () => ({
    title: "雨夜当铺",
    subjects: [
        { id: "s1", name: "陈默", position: [0, 0, 0] },
        { id: "s2", name: "白露", position: [2, 0, 0] },
    ],
    scenes: [{ sceneId: "sc1", axisSubjectIds: ["s1", "s2"] }],
    shots: [
        { shotId: "sh1", sceneId: "sc1", cameraPosition: [1, 1.5, 3] },
        { shotId: "sh2", sceneId: "sc1", cameraPosition: [1, 1.5, 3.4] },
        { shotId: "sh3", sceneId: "sc1", cameraPosition: [1, 1.5, 2.6] },
    ],
});

test("S4 挂点：合规分镜通过并返回报告", () => {
    const report = gateStoryboard(validStoryboard());
    assert.equal(report.passed, true);
    assert.deepEqual(report.stages, ["S4_storyboard"]);
});

test("S4 挂点：越轴分镜抛 GateBlockedError，消息含越轴明细、镜像修复与 ask_user 选项", () => {
    const board = validStoryboard();
    board.shots[2]!.cameraPosition = [1, 1.5, -3]; // 3+1 布局，单独镜像到对侧 → 少数派越轴
    assert.throws(
        () => gateStoryboard(board),
        (error: unknown) => {
            assert.ok(error instanceof GateBlockedError);
            assert.match(error.message, /CROSSED_AXIS/);
            assert.match(error.message, /镜像/);
            assert.match(error.message, /\[1\] 应用全部自动修复并重跑门禁/);
            return true;
        },
    );
});

test("S5 挂点：干净提示词通过", () => {
    const report = gateCompiledPrompt("夜市摊位，热气蒸腾，摊主低头擦刀。");
    assert.equal(report.passed, true);
    assert.equal(report.junkword?.changed, false);
});

test("S5 挂点：多画幅比冲突抛 GateBlockedError（硬阻断）", () => {
    assert.throws(
        () => gateCompiledPrompt("画面比例 16:9，同时输出 9:16 竖版物料。"),
        (error: unknown) => {
            assert.ok(error instanceof GateBlockedError);
            assert.match(error.message, /aspect-ratio-conflict/);
            assert.match(error.message, /\[2\] 人工修改后重新提交/);
            return true;
        },
    );
});

test("serverGenerateShot：携带冲突提示词时先抛门禁错误，不发请求", async () => {
    await assert.rejects(
        () => serverGenerateShot("p1", "shot1", { compiledPrompt: "16:9 横版，9:16 竖版一起要。" }, {}),
        (error: unknown) => {
            assert.ok(error instanceof GateBlockedError);
            assert.ok(error.askUserMessage.includes("出口门禁拦截"));
            return true;
        },
    );
});

test("serverGenerateShot：门禁通过但未配置令牌时仍走原凭据错误（门禁不误伤）", async () => {
    await assert.rejects(
        () => serverGenerateShot("p1", "shot1", { compiledPrompt: "干净的提示词" }, {}),
        /Agent 服务令牌/,
    );
});

test("serverGenerateShot：门禁全通过时正常走提交通道（假后端冒烟）", async () => {
    const server: Server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
        req.on("end", () => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ code: 0, msg: "ok", data: { taskId: "task-001", shotId: "shot1", model: "m", channelId: "c", operation: "op", videoSeconds: 5, resolution: "1080p", status: "queued", promptSource: "server" } }));
        });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
        const result = await serverGenerateShot(
            "p1",
            "shot1",
            { videoSeconds: 5, compiledPrompt: "干净的提示词", storyboard: validStoryboard() },
            { YINGCE_AGENT_SERVICE_TOKEN: "ycat_test", YINGCE_SERVER_BACKEND_URL: `http://127.0.0.1:${port}` },
        );
        assert.equal(result.taskId, "task-001");
        assert.equal(result.executor, "server");
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
