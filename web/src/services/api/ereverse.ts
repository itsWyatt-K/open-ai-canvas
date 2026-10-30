/**
 * E-Reverse 本地侧车 API 客户端。
 *
 * 侧车服务跑在 127.0.0.1:8790（工具/e-reverse/server.py），dev 由 vite 代理
 * `/ereverse-api` 转发，生产构建不会包含本页面对应的路由依赖之外的任何后端。
 * 走原生 fetch 而非共享 axios 实例：侧车不走 {code,data,msg} 统一信封。
 */

export type EreverseVlmBackend = "auto" | "zhipu" | "gemini" | "ollama" | "hf-local";

export type EreverseHealth = {
    ok: boolean;
    ffmpeg: boolean;
    wordLevelAsr: boolean;
    vlm: Record<string, { name: string; available: boolean; error?: string }>;
};

export type EreverseWord = {
    word: string;
    start_ms: number;
    end_ms: number;
    confidence?: number | null;
    speaker?: string;
};

export type EreverseScene = {
    index: number;
    start_ms: number;
    end_ms: number;
    scene_score?: number;
    keyframe_path?: string;
    semantic_tags?: string[];
    tag_provider?: string;
    // ---- M3 结构化导演字段（可选；VLM 未产出时为空，不臆造）----
    shot_type?: string;
    camera_movement?: string;
    visual_prompt?: string;
    compliance_prompt?: string;
    negative_prompt?: string;
    // ---- 片段仿拍五维槽位树（可选）----
    // 视觉四槽（主体/产品/场景背景/镜头运镜）由 VLM 产出或扁平字段兜底组装；
    // "口播台词" 槽由侧车归并词级 ASR 双源注入（字符串，非子字典）。
    // 换模特/换产品/换背景/换口播只改对应键值，主体.动作与镜头运镜 100% 锁定。
    prompt_slots?: Record<string, unknown>;
};

export type EreversePft = {
    schema: string;
    source: {
        path: string;
        duration_ms: number;
        width?: number;
        height?: number;
        fps?: number;
        has_audio?: boolean;
        video_codec?: string;
        audio_codec?: string;
    };
    tracks?: Array<{ kind: string; codec?: string; extracted_path?: string; note?: string }>;
    scenes: EreverseScene[];
    words?: EreverseWord[];
    speech_spans?: Array<{ start_ms: number; end_ms: number; is_silence: boolean }>;
    /** 全能复刻动效草案（宽松 JSON；extract_motion=true 且 VLM 产出时才有，不臆造）。 */
    motion?: unknown;
    facts?: {
        scene_threshold?: number;
        scene_count?: number;
        avg_scene_ms?: number;
        /** 片段仿拍时间窗回执（整条反推时无此键）。 */
        fragment?: { start_ms: number; end_ms: number };
    };
    provenance: {
        generated_at?: string;
        ffmpeg_version?: string;
        asr_provider?: string;
        vlm_provider?: string;
        degraded?: string[];
    };
};

export type EreverseStage = "queued" | "probe" | "tracks" | "scenes" | "keyframes" | "asr" | "vlm" | "write" | "done" | "error";

export type EreverseJobStatus = {
    id: string;
    stage: EreverseStage;
    stage_ts: number;
    video: string;
    error: string | null;
    pft: EreversePft | null;
};

export type EreverseRunInput = {
    video: string;
    scene_threshold?: number;
    enable_vlm?: boolean;
    vlm_backend?: EreverseVlmBackend;
    context?: string;
    // 片段仿拍时间窗（毫秒，对标 AppGrowing 黄金片段选取）：缺省整条视频。
    // 侧车仅对 [start_ms, end_ms) 执行切镜/抽帧/ASR，产出时间戳回正到原视频总轴。
    start_ms?: number;
    end_ms?: number;
    // 全能复刻（/omnireplica）：提取 Motion Spec 动效草案（PFT.motion 宽松块）。
    // 默认 false——既有反推动线零影响；VLM prompt 增动效维度由侧车纯增量实现。
    extract_motion?: boolean;
};

const BASE = "/ereverse-api/api/ereverse";

async function request<T>(input: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const { timeoutMs = 10_000, ...rest } = init || {};
    const controller = new AbortController();
    // Round 6+施工包一：abort 必须带 reason——无 reason 的 abort 在 Chrome 下
    // 会产生 DOMException("signal is aborted without reason")，对用户是黑话假死。
    // 带 TimeoutError + 人话文案，页面层可直接展示或翻译。
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new DOMException(`请求拆片服务超时（${Math.round(timeoutMs / 1000)} 秒）：服务可能正在加载模型或处理重负载任务，请稍后重试`, "TimeoutError")), timeoutMs) : undefined;
    try {
        const res = await fetch(input, { ...rest, signal: controller.signal });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`E-Reverse ${res.status}: ${text.slice(0, 200) || res.statusText}`);
        }
        return (await res.json()) as T;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

// 返工令 Round 6：侧车首检要 import onnxruntime/whisperx 并逐个探测 VLM 引擎
// （智谱/Ollama 不可用时也有网络超时），6s 会被强行 abort，页面弹出
// 「signal is aborted without reason」假死。health/status 统一放宽到 15s。
// 施工包一：侧车 GIL 死锁已根治（/health 恒 <50ms），但首个任务加载模型期间
// 仍可能偶发超时——health 超时自动重试 1 次，避免用户手动刷新页面。
export function getEreverseHealth(): Promise<EreverseHealth> {
    return request<EreverseHealth>(`${BASE}/health`, { timeoutMs: 15_000 }).catch((e: unknown) => {
        const isTimeout = e instanceof DOMException && e.name === "TimeoutError";
        if (!isTimeout) throw e;
        return request<EreverseHealth>(`${BASE}/health`, { timeoutMs: 15_000 });
    });
}

export function uploadEreverseVideo(file: File): Promise<{ path: string; size: number }> {
    return request<{ path: string; size: number }>(`${BASE}/upload?filename=${encodeURIComponent(file.name)}`, { method: "PUT", body: file, timeoutMs: 10 * 60_000 });
}

export function startEreverseJob(input: EreverseRunInput): Promise<{ id: string }> {
    return request<{ id: string }>(`${BASE}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeoutMs: 15_000,
    });
}

export function getEreverseJobStatus(jobId: string): Promise<EreverseJobStatus> {
    return request<EreverseJobStatus>(
        `${BASE}/status?id=${encodeURIComponent(jobId)}`,
        // 返工令 Round 6：与 health 同口径放宽。施工包一：侧车 GIL 根治后轮询
        // 不再被 torch 导入阻塞，但 VLM 打标/WhisperX 转写高峰期仍可能争用，
        // 放宽到 20s 防误杀（超时现在带 TimeoutError 人话 reason，不再假死）。
        { timeoutMs: 20_000 },
    );
}

export function ereverseAssetUrl(jobId: string, kind: "video" | "file", fileName?: string): string {
    if (kind === "video") return `${BASE}/video?job=${encodeURIComponent(jobId)}`;
    return `${BASE}/file?job=${encodeURIComponent(jobId)}&name=${encodeURIComponent(fileName || "")}`;
}
