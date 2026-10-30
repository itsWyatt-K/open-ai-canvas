/**
 * 全能复刻 · 契约 Mock 引擎（联调日整旗清除）。
 *
 * 纪律：
 * - 所有 mock 返回值形态与冻结契约一致，页面层无差别切换（omniApi() 单点选择）；
 * - 页面常驻可见 banner 标注「契约 Mock 数据」，不存在「伪装成真引擎」的路径；
 * - mock 视频资产为 ffmpeg testsrc 生成物（public/omnireplica/mock/），非用户数据；
 * - 清除方式：删本文件 + 删 omniApi() 的 mock 分支 + 删 public/omnireplica/mock/。
 */

import type { CodeRenderBatchResult, CodeRenderStatus, CodeRenderSubmitResult, RenderPlan } from "@/services/api/omnireplica";
import { blueprintFromMotion, type MotionBlueprint } from "@/lib/omnireplica/blueprint";

export const OMNI_MOCK_SAMPLE_VIDEO = "/omnireplica/mock/sample.mp4";
export const OMNI_MOCK_POSTER = "/omnireplica/mock/poster.jpg";

/** mock 加速倍率：真实 t_frame 目标 ≈100ms，demo 用 12ms（×8 速）。 */
const MOCK_FRAME_TICK_MS = 12;

type MockJob = {
    status: "queued" | "running" | "done" | "error";
    frames_done: number;
    frames_total: number;
    queue_position: number;
    plan: RenderPlan;
    startedAt: number;
    label: string;
};

const mockJobs = new Map<string, MockJob>();
let mockJobSeq = 0;

function nextMockJobId(prefix: string): string {
    mockJobSeq += 1;
    return `mock-${prefix}-${Date.now().toString(36)}-${mockJobSeq}`;
}

/** 演示用蓝图：3 镜头（口播条 / 产品特写 / 低置信氛围过场），含 1 个 degraded 镜头。 */
export function mockBlueprint(): MotionBlueprint {
    return blueprintFromMotion(
        {
            canvas: { duration_ms: 15_000, width: 1080, height: 1920 },
            theme: { colors: { primary: "#FF4D4F", text: "#FFFFFF", stroke: "#0B0B12" } },
            slots: { product_main: { kind: "product_image", url: "mock://product-1" } },
            shots: [
                {
                    shot_id: "shot_1",
                    start_ms: 0,
                    end_ms: 5_000,
                    enter: { type: "fade-up", duration_ms: 400 },
                    elements: [
                        {
                            element_id: "title_1",
                            type: "text",
                            text: "家人们谁懂啊",
                            position: { x: 0.5, y: 0.18 },
                            size_ratio: 0.08,
                            color: "@theme.colors.primary",
                            stroke: { color: "@theme.colors.stroke", width_ratio: 0.006 },
                            enter: { type: "pop", duration_ms: 300, delay_ms: 200 },
                        },
                        { element_id: "sub_1", type: "text", text: "这个价格真的假的", position: { x: 0.5, y: 0.3 }, size_ratio: 0.05, color: "@theme.colors.text" },
                    ],
                },
                {
                    shot_id: "shot_2",
                    start_ms: 5_000,
                    end_ms: 10_000,
                    enter: { type: "zoom-in", duration_ms: 450 },
                    elements: [{ element_id: "product_1", type: "image", slot: "product_main", position: { x: 0.5, y: 0.55 }, size_ratio: 0.5, enter: { type: "zoom-in", duration_ms: 450 } }],
                },
                {
                    shot_id: "shot_3",
                    start_ms: 10_000,
                    end_ms: 15_000,
                    confidence: 0.42,
                    degraded: ["VLM 对该镜动效置信度 42% 偏低，建议人工确认"],
                    elements: [{ element_id: "badge_1", type: "text", text: "链接已经挂好了", position: { x: 0.5, y: 0.82 }, size_ratio: 0.045, color: "@theme.colors.text" }],
                },
            ],
            transitions: [{ after_shot: "shot_1", type: "dip-to-white", duration_ms: 200 }],
        },
        { title: "Mock 演示工程（契约数据）", ereverseJobId: "mock-ereverse-1", durationMs: 15_000 },
    );
}

/** 演示用 PFT.motion 草案（拆解完成回执；source: mock）。 */
export function mockMotionBlock(): unknown {
    return { theme: { colors: { primary: "#FF4D4F", text: "#FFFFFF", stroke: "#0B0B12" } }, shots: mockBlueprint().shots, transitions: [{ after_shot: "shot_1", type: "dip-to-white", duration_ms: 200 }] };
}

function fullRenderMsFor(blueprint: MotionBlueprint, resolution: string, fps: number): number {
    const frames = Math.round((blueprint.canvas.duration_ms / 1000) * fps);
    const perFrame = resolution === "1080p" ? 120 : 95; // 对齐验收基线表的演示值（E1 达标口径）
    return frames * perFrame + 8_000;
}

function planFor(blueprint: MotionBlueprint, resolution: string, fps: number, recaptureRatio: number): RenderPlan {
    const full = fullRenderMsFor(blueprint, resolution, fps);
    const total = blueprint.shots.length;
    const recapture = Math.max(1, Math.round(total * recaptureRatio));
    return { recapture_count: recapture, reuse_count: Math.max(0, total - recapture), estimated_ms: Math.round(full * recaptureRatio) + 8_000, full_render_ms: full };
}

export function mockSubmitCodeRender(input: { blueprint: MotionBlueprint; resolution: string; fps: number; label?: string; recaptureRatio?: number }): Promise<CodeRenderSubmitResult> {
    const jobId = nextMockJobId("render");
    const framesTotal = Math.round((input.blueprint.canvas.duration_ms / 1000) * input.fps);
    mockJobs.set(jobId, { status: "queued", frames_done: 0, frames_total: framesTotal, queue_position: 0, plan: planFor(input.blueprint, input.resolution, input.fps, input.recaptureRatio ?? 1), startedAt: Date.now(), label: input.label || "试看渲染" });
    return Promise.resolve({ job_id: jobId, status: "queued", render_key: `mock-${jobId.slice(-8)}` });
}

export function mockSubmitCodeRenderBatch(input: { blueprint: MotionBlueprint; variations: Array<{ label?: string }>; resolution: string; fps: number }): Promise<CodeRenderBatchResult> {
    const batchId = nextMockJobId("batch");
    const jobs = input.variations.map((variation, index) => {
        const jobId = nextMockJobId(`v${index + 1}`);
        // 裂变预报价演示：同蓝图裂变多数镜头命中缓存（改 theme/标题只废真引用镜头）
        const recaptureRatio = 1 / 3;
        mockJobs.set(jobId, {
            status: "queued",
            frames_done: 0,
            frames_total: Math.round((input.blueprint.canvas.duration_ms / 1000) * input.fps),
            queue_position: index,
            plan: planFor(input.blueprint, input.resolution, input.fps, recaptureRatio),
            startedAt: Date.now(),
            label: variation.label || `版本 ${index + 1}`,
        });
        return { job_id: jobId, plan: mockJobs.get(jobId)!.plan };
    });
    return Promise.resolve({ batch_id: batchId, jobs });
}

export function mockGetCodeRenderStatus(jobId: string): Promise<CodeRenderStatus> {
    const job = mockJobs.get(jobId);
    if (!job) return Promise.resolve({ status: "error", frames_done: 0, frames_total: 0, error: "mock：任务不存在（引擎重启后内存 job 表丢失，真实引擎同此语义）" });
    const elapsed = Date.now() - job.startedAt;
    const totalMs = job.frames_total * MOCK_FRAME_TICK_MS;
    if (job.status === "queued" && elapsed > 1_200) job.status = "running";
    if (job.status === "running") job.frames_done = Math.min(job.frames_total, Math.floor((elapsed - 1_200) / MOCK_FRAME_TICK_MS));
    if (job.status === "running" && elapsed - 1_200 >= totalMs) {
        job.status = "done";
        job.frames_done = job.frames_total;
    }
    return Promise.resolve({
        status: job.status,
        frames_done: job.frames_done,
        frames_total: job.frames_total,
        queue_position: job.queue_position,
        plan: job.plan,
        ...(job.status === "done" ? { video_url: OMNI_MOCK_SAMPLE_VIDEO } : {}),
    });
}

/** mock 拆解（e-reverse）阶段机：queued→…→done，done 时 PFT.motion = mockMotionBlock()。 */
const mockExtractStages = ["queued", "probe", "tracks", "scenes", "keyframes", "asr", "vlm", "write"] as const;
const mockExtractJobs = new Map<string, { startedAt: number }>();

export function mockStartOmniExtract(): Promise<{ id: string }> {
    const id = nextMockJobId("ereverse");
    mockExtractJobs.set(id, { startedAt: Date.now() });
    return Promise.resolve({ id });
}

export function mockGetOmniJobStatus(jobId: string): Promise<{ id: string; stage: string; stage_ts: number; video: string; error: null; pft: null | { motion: unknown } }> {
    const job = mockExtractJobs.get(jobId);
    const elapsed = job ? Date.now() - job.startedAt : 0;
    const stageIndex = Math.min(mockExtractStages.length - 1, Math.floor(elapsed / 700));
    const stage = mockExtractStages[stageIndex];
    const done = elapsed >= mockExtractStages.length * 700;
    return Promise.resolve({ id: jobId, stage: done ? "done" : stage, stage_ts: Date.now(), video: "mock://reference.mp4", error: null, pft: done ? { motion: mockMotionBlock() } : null });
}
