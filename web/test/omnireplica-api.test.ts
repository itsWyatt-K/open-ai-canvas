import assert from "node:assert/strict";
import { test } from "node:test";

import { OmnireplicaApiError, codeRenderFileUrl, getBlueprint, getCodeRenderStatus, putBlueprint, submitCodeRender } from "@/services/api/omnireplica";
import { RENDER_POLL_DEADLINE_MS, fanoutDueJobs, isTerminalStatus, pollDeadlineExceeded } from "@/lib/omnireplica/polling";

/**
 * 给全局 localStorage 装内存假身。
 * 注意：源码读的是裸 `localStorage`（浏览器全局语义），bun 运行时会提供一个空全局，
 * 因此假身必须覆盖 globalThis.localStorage，而不是 window.localStorage。
 */
function withFakeLocalStorage(run: () => void) {
    const store = new Map<string, string>();
    const fake = {
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
        setItem: (k: string, v: string) => void store.set(k, v),
    };
    const carrier = globalThis as unknown as { localStorage?: unknown };
    const had = Object.prototype.hasOwnProperty.call(carrier, "localStorage");
    const original = carrier.localStorage;
    carrier.localStorage = fake;
    try {
        run();
    } finally {
        if (had) carrier.localStorage = original;
        else delete carrier.localStorage;
    }
}

/** 替换全局 fetch，记录调用并返回预置响应；run 结束后还原。 */
function withFetchStub(stub: (url: string, init?: RequestInit) => Promise<Response> | Response, run: () => Promise<void> | void) {
    const original = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    (globalThis as unknown as { fetch: unknown }).fetch = (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return stub(String(url), init);
    };
    return {
        calls,
        run: async () => {
            try {
                await run();
            } finally {
                (globalThis as unknown as { fetch: unknown }).fetch = original;
            }
        },
    };
}

// ---------------------------------------------------------------------------
// URL 拼装
// ---------------------------------------------------------------------------

test("codeRenderFileUrl：默认 127.0.0.1:8823 + job/name 双参转义", () => {
    withFakeLocalStorage(() => {
        const url = codeRenderFileUrl("job 1", "out 480p.mp4");
        assert.equal(url, "http://127.0.0.1:8823/api/v1/video/code-render/file?job=job+1&name=out+480p.mp4");
        assert.equal(codeRenderFileUrl("j1"), "http://127.0.0.1:8823/api/v1/video/code-render/file?job=j1");
    });
});

test("nxfBase 覆盖：localStorage[nxf-bridge-base] 生效（与 visual-dna 同键）", () => {
    withFakeLocalStorage(() => {
        globalThis.localStorage?.setItem("nxf-bridge-base", "http://127.0.0.1:9911/");
        assert.equal(codeRenderFileUrl("j"), "http://127.0.0.1:9911/api/v1/video/code-render/file?job=j");
    });
});

test("蓝图 PUT/GET：路径 /api/v1/omnireplica/blueprint + job query + JSON body", async () => {
    await withFakeLocalStorage(async () => {
        const stub = withFetchStub(
            () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } }),
            async () => {
                await putBlueprint("bp_ab12", { schema: "motion-blueprint/v1" });
                await getBlueprint("bp_ab12");
            },
        );
        await stub.run();
        assert.equal(stub.calls.length, 2);
        assert.equal(stub.calls[0].url, "http://127.0.0.1:8823/api/v1/omnireplica/blueprint?job=bp_ab12");
        assert.equal(stub.calls[0].init?.method, "PUT");
        assert.equal(stub.calls[1].init?.method, "GET");
    });
});

test("渲染提交：POST /api/v1/video/code-render，body 带 blueprint/resolution/fps", async () => {
    await withFakeLocalStorage(async () => {
        const stub = withFetchStub(
            () => new Response(JSON.stringify({ job_id: "j9", status: "queued" }), { status: 200, headers: { "Content-Type": "application/json" } }),
            async () => {
                const result = await submitCodeRender({ blueprint: { schema: "motion-blueprint/v1" }, resolution: "480p", fps: 24 });
                assert.equal(result.job_id, "j9");
            },
        );
        await stub.run();
        assert.equal(stub.calls[0].init?.method, "POST");
        const body = JSON.parse(String(stub.calls[0].init?.body));
        assert.equal(body.resolution, "480p");
        assert.equal(body.fps, 24);
    });
});

// ---------------------------------------------------------------------------
// 错误人话化（超时 abort 必须带 TimeoutError + 人话 reason）
// ---------------------------------------------------------------------------

test("超时 abort：保留 TimeoutError 人话 reason，不露出「signal is aborted without reason」", async () => {
    await withFakeLocalStorage(async () => {
        const stub = withFetchStub(
            () => {
                throw new DOMException("请求渲染引擎超时（20 秒）：渲染引擎可能正在处理重负载任务，请稍后重试", "TimeoutError");
            },
            async () => {
                await assert.rejects(getCodeRenderStatus("j1"), (error: unknown) => {
                    assert.ok(error instanceof OmnireplicaApiError);
                    assert.match(error.message, /超时/);
                    assert.doesNotMatch(error.message, /signal is aborted without reason/);
                    return true;
                });
            },
        );
        await stub.run();
    });
});

test("网络不可达：人话提示先启动引擎（nxf :8823）", async () => {
    await withFakeLocalStorage(async () => {
        const stub = withFetchStub(
            () => {
                throw new TypeError("Failed to fetch");
            },
            async () => {
                await assert.rejects(getCodeRenderStatus("j1"), (error: unknown) => {
                    assert.ok(error instanceof OmnireplicaApiError);
                    assert.match(error.message, /连不上渲染引擎（nxf :8823）/);
                    return true;
                });
            },
        );
        await stub.run();
    });
});

test("引擎返回 500：状态码 + 截断响应体进人话错误", async () => {
    await withFakeLocalStorage(async () => {
        const stub = withFetchStub(
            () => new Response("internal boom", { status: 500 }),
            async () => {
                await assert.rejects(submitCodeRender({ blueprint: {}, resolution: "480p", fps: 24 }), (error: unknown) => {
                    assert.ok(error instanceof OmnireplicaApiError);
                    assert.match(error.message, /500/);
                    assert.match(error.message, /internal boom/);
                    assert.equal((error as OmnireplicaApiError).status, 500);
                    return true;
                });
            },
        );
        await stub.run();
    });
});

// ---------------------------------------------------------------------------
// 轮询 fan-out（进行态逐版进度）
// ---------------------------------------------------------------------------

test("fan-out：每 job 独立节流；慢 job 不阻塞快 job", () => {
    const jobs = [{ job_id: "a" }, { job_id: "b" }, { job_id: "c" }];
    const lastPollAt = new Map<string, number>([["a", 1_000]]);
    const now = 2_500;
    const due = fanoutDueJobs(jobs, lastPollAt, now, 2_000);
    assert.deepEqual(
        due.map((job) => job.job_id),
        ["b", "c"],
    ); // a 距上次 1.5s 未到节流窗
    const due2 = fanoutDueJobs(jobs, lastPollAt, 3_100, 2_000);
    assert.deepEqual(
        due2.map((job) => job.job_id),
        ["a", "b", "c"],
    );
});

test("终态与 deadline：done/error 不再轮询；≥300s 判超时", () => {
    assert.equal(isTerminalStatus("done"), true);
    assert.equal(isTerminalStatus("error"), true);
    assert.equal(isTerminalStatus("running"), false);
    assert.equal(pollDeadlineExceeded(0, RENDER_POLL_DEADLINE_MS - 1), false);
    assert.equal(pollDeadlineExceeded(0, RENDER_POLL_DEADLINE_MS), true);
});
