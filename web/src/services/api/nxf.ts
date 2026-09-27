// 酿笑坊能力服务（nxf bridge）客户端。
// 与影策后端不同：nxf 是独立 FastAPI（默认 http://127.0.0.1:8823），
// 返回体不是 BackendEnvelope，故不走 request() 封装，直接 fetch。

const nxfBaseURL = (import.meta.env.VITE_NXF_URL as string | undefined) || "http://127.0.0.1:8823";

export type NxfCharacterSpec = { role?: string; identity?: string; state?: string };

export type NxfBeatSpec = { start: number; end: number; action: string };

export type NxfSceneSpec = {
    scene: { goal: string; location?: string; time?: string; mood?: string };
    characters?: NxfCharacterSpec[];
    visual?: { style?: string; camera?: string; lighting?: string };
    beats?: NxfBeatSpec[];
    constraints?: { identity_lock?: boolean; continuity_lock?: boolean; positive_only?: boolean };
    brief?: { platform?: string; total_seconds?: number; aspect?: string; use_case?: string };
};

export type NxfHealth = {
    bridge_version: string;
    spec_version: string;
    cards_total: number;
    cards_by_state: Record<string, number>;
    router_json_ok: boolean;
};

export type NxfRecipeHit = { name: string; score: number; why: string };

export type NxfNativeSkillHit = { tag: string; suggest: string; reason: string };

export type NxfShotContract = {
    shot: {
        title: string;
        shot_size: string;
        camera_angle: string;
        camera_movement: string;
        duration_ms: number;
        plot_description: string;
        action: string;
        dialogue?: Array<Record<string, unknown>> | null;
        action_beats: Array<{ start_ms: number; end_ms: number; action: string }>;
        continuity_notes: string;
    };
    render: {
        platform: string;
        image_prompt: string;
        video_prompt: string;
        negative_prompt: string;
    };
    gate: { verdict: "PASS" | "FAIL"; failures: string[] };
};

export type NxfCompileResult = {
    selected_recipes: NxfRecipeHit[];
    selected_native_skills: NxfNativeSkillHit[];
    adapter: { platform: string; blocks: string[] };
    shots: NxfShotContract[];
    prompts: Array<{ shot_id: string; image_prompt: string; video_prompt: string; negative_prompt: string; mode: string; warnings: string[]; issues: string[] }>;
    warnings: string[];
    coverage: { beats_mapped: number; beats_total: number; warnings: string[] };
    gate: { overall: "PASS" | "FAIL"; per_shot: Array<{ shot_id: string; verdict: "PASS" | "FAIL"; failures: string[] }> };
};

/** 配方路由（/api/nxf/route）：只挑配方与原生技能，不含镜头。 */
export type NxfRouteResult = {
    recipes: NxfRecipeHit[];
    native_skills: NxfNativeSkillHit[];
    adapter: { platform: string; blocks: string[] };
    coverage: { beats_mapped: number; beats_total: number; warnings: string[] };
};

/** 官方提示词翻译产物（/api/nxf/translate 返回的是**数组**，不是对象）。 */
export type NxfPromptOut = {
    shot_id: string;
    title: string;
    image_prompt: string;
    video_prompt: string;
    negative_prompt: string;
    mode: string;
    warnings: string[];
    issues: string[];
};

/** 质量门（/api/nxf/gate）。 */
export type NxfGateResult = {
    verdict: "PASS" | "FAIL";
    failures: string[];
    checks_run: string[];
};

export async function nxfHealth(signal?: AbortSignal): Promise<NxfHealth> {
    const response = await fetch(`${nxfBaseURL}/api/nxf/health`, { signal });
    if (!response.ok) throw new Error(`nxf health ${response.status}`);
    return response.json() as Promise<NxfHealth>;
}

export async function nxfSceneCompile(spec: NxfSceneSpec, topK = 5, signal?: AbortSignal): Promise<NxfCompileResult> {
    const response = await fetch(`${nxfBaseURL}/api/nxf/scene/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, top_k: topK }),
        signal,
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`编译失败（${response.status}）${detail ? `：${detail.slice(0, 200)}` : ""}`);
    }
    return response.json() as Promise<NxfCompileResult>;
}

// ---------------------------------------------------------------------------
// 以下三个端点与 scene/compile 同源：都跑在本地引擎（:8823）上，
// 纯本地零 LLM、零外部 key，所以前端可以放心按需触发。
// ---------------------------------------------------------------------------

/**
 * 配方路由：只做「挑配方 / 挑技能」，**不产出镜头**。
 *
 * ⚠️ 请求形状与 scene/compile 不同：spec **直接作为 body**（不再包一层 spec），
 * top_k 走 **query 参数**。这是本文件最容易踩的坑。
 */
export async function nxfRoute(spec: NxfSceneSpec, topK = 5, signal?: AbortSignal): Promise<NxfRouteResult> {
    const response = await fetch(`${nxfBaseURL}/api/nxf/route?top_k=${encodeURIComponent(String(topK))}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
        signal,
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`配方路由失败（${response.status}）${detail ? `：${detail.slice(0, 200)}` : ""}`);
    }
    return response.json() as Promise<NxfRouteResult>;
}

/**
 * 提示词翻译台：把已有的镜头契约翻译成官方出图 / 出片提示词。
 *
 * ⚠️ shots 必须是**完整镜头契约**（shot + render + gate 三块齐全），
 * 也就是 compile 产物里的 shots，不能只取其中一段。
 */
export async function nxfTranslate(shots: NxfShotContract[], spec: NxfSceneSpec, platform?: string, signal?: AbortSignal): Promise<NxfPromptOut[]> {
    const response = await fetch(`${nxfBaseURL}/api/nxf/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shots, spec, ...(platform ? { platform } : {}) }),
        signal,
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`提示词翻译失败（${response.status}）${detail ? `：${detail.slice(0, 200)}` : ""}`);
    }
    return response.json() as Promise<NxfPromptOut[]>;
}

/** 质量门：对一条提示词（可选带上镜头）做官方格式 + 禁词 + 时长口径检查。 */
export async function nxfGate(prompt: string, shot?: NxfShotContract["shot"], policy?: Record<string, unknown>, signal?: AbortSignal): Promise<NxfGateResult> {
    const response = await fetch(`${nxfBaseURL}/api/nxf/gate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, ...(shot ? { shot } : {}), policy: policy ?? {} }),
        signal,
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`质量门检查失败（${response.status}）${detail ? `：${detail.slice(0, 200)}` : ""}`);
    }
    return response.json() as Promise<NxfGateResult>;
}
