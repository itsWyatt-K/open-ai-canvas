/**
 * OiiOii「全能复刻」MVP · 服务层（前端唯一对接面）。
 *
 * 两条链路：
 * ① **拆解**：e-reverse 侧车（vite 代理 /ereverse-api → 127.0.0.1:8790）——
 *    复用 services/api/ereverse.ts，仅新增 extract_motion 入参（PFT.motion 宽松块）。
 * ② **渲染/物料/蓝图**：nxf 引擎（127.0.0.1:8823 直连，CORS 已含 127.0.0.1:3000，
 *    无需改 vite.config）——契约以《项目交付方案 v1.2》冻结版为准，本文件不得擅改。
 *
 * 纪律（施工包教训）：
 * - 所有 fetch 超时 abort 必须带 DOMException("TimeoutError") + 人话 reason——
 *   无 reason 的 abort 在 Chrome 下弹出「signal is aborted without reason」黑话假死；
 * - 渲染轮询（GET status）单次请求超时 ≥15s，页面轮询总deadline ≥300s；
 * - 不伪造接口：mock 数据由页面层显式标注 source: "mock"，联调日整旗清除。
 */

import { getEreverseJobStatus, startEreverseJob, type EreverseJobStatus, type EreversePft, type EreverseRunInput, type EreverseVlmBackend } from "@/services/api/ereverse";

// 拆解链路复用件：上传与后端枚举从 ereverse 服务再导出，页面只 import 本模块（单一对接面）。
export { uploadEreverseVideo } from "@/services/api/ereverse";
export type { EreverseVlmBackend } from "@/services/api/ereverse";

const DEFAULT_NXF_BASE = "http://127.0.0.1:8823";

/** 渲染引擎不可达/返回异常的人话错误（复用 visual-dna.ts 的 NxfBridgeError 模式）。 */
export class OmnireplicaApiError extends Error {
    readonly status?: number;
    constructor(message: string, status?: number) {
        super(message);
        this.name = "OmnireplicaApiError";
        this.status = status;
    }
}

/** nxf 基址：默认 127.0.0.1:8823，可用 localStorage["nxf-bridge-base"] 覆盖（与 visual-dna 同键）。 */
export function nxfBase(): string {
    return (typeof localStorage !== "undefined" && localStorage.getItem("nxf-bridge-base")) || DEFAULT_NXF_BASE;
}

function timeoutReason(action: string, timeoutMs: number): string {
    return `${action}超时（${Math.round(timeoutMs / 1000)} 秒）：渲染引擎可能正在处理重负载任务，请稍后重试`;
}

async function nxfRequest<T>(path: string, options: { method?: "GET" | "POST" | "PUT"; body?: unknown; timeoutMs?: number; query?: Record<string, string | undefined> } = {}): Promise<T> {
    const { method = "GET", body, timeoutMs = 30_000, query } = options;
    const base = nxfBase().replace(/\/$/, "");
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query || {})) {
        if (value !== undefined && value !== "") params.set(key, value);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new DOMException(timeoutReason("请求渲染引擎", timeoutMs), "TimeoutError")), timeoutMs) : undefined;
    let response: Response;
    try {
        response = await fetch(base + path + suffix, {
            method,
            headers: body === undefined ? undefined : { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        if (timer) clearTimeout(timer);
        if (error instanceof DOMException && error.name === "TimeoutError") throw new OmnireplicaApiError(error.message);
        throw new OmnireplicaApiError("连不上渲染引擎（nxf :8823）：请先启动引擎（启动源起 控制台 → nxf 卡片 ▶ 启动）");
    }
    if (timer) clearTimeout(timer);
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new OmnireplicaApiError(`渲染引擎返回 ${response.status}：${text.slice(0, 200) || response.statusText}`, response.status);
    }
    const data = (await response.json()) as T & { ok?: boolean; error?: string; error_code?: string };
    if (data && data.ok === false) throw new OmnireplicaApiError(data.error || data.error_code || "渲染引擎处理失败");
    return data;
}

// ---------------------------------------------------------------------------
// 类型（契约冻结版；blueprint 为透传 JSON，强类型在 lib/omnireplica/blueprint.ts）
// ---------------------------------------------------------------------------

export type OmniResolution = "480p" | "720p" | "1080p";

/** 渲染计划——全站唯一耗时数据源（plan 唯一数据源治理纪律，禁第二套计时口径）。 */
export type RenderPlan = {
    recapture_count: number;
    reuse_count: number;
    estimated_ms: number;
    full_render_ms: number;
};

export type SpriteSlice = {
    index: number;
    bbox: [number, number, number, number];
    url: string;
};

export type SpriteSliceResult = {
    slices: SpriteSlice[];
    preview_png: string;
    degraded: string[];
    elapsed_ms?: number;
};

export type CodeRenderSubmit = {
    blueprint: unknown;
    assets_override?: Record<string, string>;
    resolution: string;
    fps: number;
};

export type CodeRenderSubmitResult = {
    job_id: string;
    status: string;
    render_key?: string;
    cached?: boolean;
    video_url?: string;
};

export type CodeRenderStatus = {
    status: string;
    frames_done: number;
    frames_total: number;
    queue_position?: number;
    plan?: RenderPlan;
    video_url?: string;
    degraded?: string[];
    error?: string;
    render_key?: string;
};

/** 裂变变量差集（每版只放差异：theme/标题/资产覆盖）。 */
export type OmniVariation = {
    label?: string;
    title?: string;
    theme?: Record<string, unknown>;
    asset_overrides?: Record<string, string>;
};

export type CodeRenderBatchSubmit = {
    blueprint: unknown;
    variations: OmniVariation[];
    resolution: string;
    fps: number;
};

export type CodeRenderBatchResult = {
    batch_id: string;
    jobs: Array<{ job_id: string; plan?: RenderPlan }>;
};

// ---------------------------------------------------------------------------
// 物料层：精灵图切片（M3）
// ---------------------------------------------------------------------------

export function sliceSpriteSheet(input: { image: string; rows?: number; cols?: number; auto_detect_connected_components?: boolean; padding?: number; trim_alpha?: boolean; max_slices?: number }): Promise<SpriteSliceResult> {
    return nxfRequest<SpriteSliceResult>("/api/v1/ecommerce/vision/sprite-sheet-slice", { method: "POST", body: input, timeoutMs: 180_000 });
}

// ---------------------------------------------------------------------------
// 渲染层：异步 job + 队列 + 批量裂变（M4/S1）
// ---------------------------------------------------------------------------

export function submitCodeRender(input: CodeRenderSubmit): Promise<CodeRenderSubmitResult> {
    return nxfRequest<CodeRenderSubmitResult>("/api/v1/video/code-render", { method: "POST", body: input, timeoutMs: 60_000 });
}

/** 渲染轮询：单次请求超时 20s（页面总 deadline ≥300s，见 copy-bench）。 */
export function getCodeRenderStatus(jobId: string): Promise<CodeRenderStatus> {
    return nxfRequest<CodeRenderStatus>("/api/v1/video/code-render/status", { query: { job_id: jobId }, timeoutMs: 20_000 });
}

/** 裂变批量提交：提交即见每版渲染计划（预报价）。 */
export function submitCodeRenderBatch(input: CodeRenderBatchSubmit): Promise<CodeRenderBatchResult> {
    return nxfRequest<CodeRenderBatchResult>("/api/v1/video/code-render/batch", { method: "POST", body: input, timeoutMs: 60_000 });
}

// ---------------------------------------------------------------------------
// 资产层：蓝图 PUT/GET（16MB 上限）+ 成片文件
// ---------------------------------------------------------------------------

export function putBlueprint(job: string, blueprint: unknown): Promise<{ ok?: boolean }> {
    return nxfRequest<{ ok?: boolean }>("/api/v1/omnireplica/blueprint", { method: "PUT", query: { job }, body: blueprint, timeoutMs: 60_000 });
}

export function getBlueprint(job: string): Promise<unknown> {
    return nxfRequest<unknown>("/api/v1/omnireplica/blueprint", { query: { job }, timeoutMs: 30_000 });
}

/** 成片文件 URL（播放/下载同源）。 */
export function codeRenderFileUrl(jobId: string, name?: string): string {
    const base = nxfBase().replace(/\/$/, "");
    const params = new URLSearchParams({ job: jobId });
    if (name) params.set("name", name);
    return `${base}/api/v1/video/code-render/file?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// 拆解层：e-reverse 扩 Motion Spec（纯增量，extract_motion 默认 false）
// ---------------------------------------------------------------------------

export type OmniExtractInput = {
    video: string;
    enable_vlm?: boolean;
    vlm_backend?: EreverseVlmBackend;
    context?: string;
    start_ms?: number;
    end_ms?: number;
};

/** 触发带 Motion Spec 提取的拆解（黄金片段时间窗可选用）。 */
export function startOmniExtract(input: OmniExtractInput): Promise<{ id: string }> {
    const run: EreverseRunInput = {
        video: input.video,
        enable_vlm: input.enable_vlm ?? true,
        vlm_backend: input.vlm_backend ?? "auto",
        context: input.context,
        extract_motion: true,
        ...(input.start_ms !== undefined ? { start_ms: input.start_ms } : {}),
        ...(input.end_ms !== undefined ? { end_ms: input.end_ms } : {}),
    };
    return startEreverseJob(run);
}

export function getOmniJobStatus(jobId: string): Promise<EreverseJobStatus> {
    return getEreverseJobStatus(jobId);
}

export type { EreverseJobStatus, EreversePft };
