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
    facts?: { scene_threshold?: number; scene_count?: number; avg_scene_ms?: number };
    provenance: {
        generated_at?: string;
        ffmpeg_version?: string;
        asr_provider?: string;
        vlm_provider?: string;
        degraded?: string[];
    };
};

export type EreverseStage =
    | "queued" | "probe" | "tracks" | "scenes" | "keyframes" | "asr" | "vlm" | "write" | "done" | "error";

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
};

const BASE = "/ereverse-api/api/ereverse";

async function request<T>(input: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
    const { timeoutMs = 10_000, ...rest } = init || {};
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
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

export function getEreverseHealth(): Promise<EreverseHealth> {
    return request<EreverseHealth>(`${BASE}/health`, { timeoutMs: 6_000 });
}

export function uploadEreverseVideo(file: File): Promise<{ path: string; size: number }> {
    return request<{ path: string; size: number }>(
        `${BASE}/upload?filename=${encodeURIComponent(file.name)}`,
        { method: "PUT", body: file, timeoutMs: 10 * 60_000 },
    );
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
        { timeoutMs: 8_000 },
    );
}

export function ereverseAssetUrl(jobId: string, kind: "video" | "file", fileName?: string): string {
    if (kind === "video") return `${BASE}/video?job=${encodeURIComponent(jobId)}`;
    return `${BASE}/file?job=${encodeURIComponent(jobId)}&name=${encodeURIComponent(fileName || "")}`;
}
