/**
 * E-Reverse 产线事实表（PFT, pft/v1）→ 前端时间轴视图模型。
 *
 * 职责：把后端原始 JSON 转成可直接渲染的百分比坐标 + 可读的词块（字幕行）。
 * 词块聚合规则：词间隙 > GAP_MS、块长 > MAX_CHUNK_MS、或累计字符 > MAX_CHUNK_CHARS
 * 时切块；相邻都是 ASCII 词元时补空格，CJK 直接拼接。
 */

import type { EreversePft, EreverseScene, EreverseWord } from "@/services/api/ereverse";

const GAP_MS = 400;
const MAX_CHUNK_MS = 3_000;
const MAX_CHUNK_CHARS = 24;

export type EreverseSceneView = {
    index: number;
    startMs: number;
    endMs: number;
    durationMs: number;
    leftPct: number;
    widthPct: number;
    keyframeUrl: string | null;
    tags: string[];
    tagProvider: string;
    /** M3 结构化导演字段（空串 = VLM 未产出，不臆造）。 */
    shotType: string;
    cameraMovement: string;
    visualPrompt: string;
    compliancePrompt: string;
    negativePrompt: string;
    /** 落入该镜头时间窗的台词（词级 ASR 有则拼接，无则空串）。 */
    dialogue: string;
    /** 无词级 ASR 时，由 speech_spans 判定该窗是否有人声（时间轴保底）。 */
    hasSpeech: boolean;
};

export type EreverseWordChunk = {
    text: string;
    startMs: number;
    endMs: number;
    leftPct: number;
    widthPct: number;
    wordCount: number;
};

/** 时间轴来源（诚实溯源：本机未装 Torch 时只有 speech_spans）。 */
export type EreverseTimelineSource = "words" | "speech_spans" | "none";

/** 单个镜头的分镜草稿（供画布 DAG 一键注入）。 */
export type EreverseStoryboardShot = {
    index: number;
    startMs: number;
    endMs: number;
    durationMs: number;
    title: string;
    shotType: string;
    cameraMovement: string;
    /** 正向提示词：默认取防封改写版（敏感品类），useCompliancePrompt=false 时取物理描述。 */
    prompt: string;
    visualPrompt: string;
    compliancePrompt: string;
    negativePrompt: string;
    dialogue: string;
    keyframeUrl: string | null;
};

/** 画布分镜组构建选项。 */
export type EreverseStoryboardOptions = {
    /** 绑定画布上的商品资产节点 ID（可选；为空则不连线商品参考）。 */
    productAssetNodeId?: string;
    /** 是否优先使用防封改写提示词（默认 true）。 */
    useCompliancePrompt?: boolean;
    /** 分组容器标题（默认由源视频名生成）。 */
    groupTitle?: string;
};

export type EreverseView = {
    durationMs: number;
    sourceName: string;
    width: number;
    height: number;
    fps: number;
    scenes: EreverseSceneView[];
    chunks: EreverseWordChunk[];
    wordCount: number;
    asrProvider: string;
    vlmProvider: string;
    timelineSource: EreverseTimelineSource;
    degraded: string[];
    generatedAt: string;
};

function clampPct(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, value));
}

function pctOf(startMs: number, endMs: number, durationMs: number): { leftPct: number; widthPct: number } {
    if (durationMs <= 0) return { leftPct: 0, widthPct: 0 };
    const leftPct = clampPct((startMs / durationMs) * 100);
    const widthPct = Math.max(((endMs - startMs) / durationMs) * 100, 0.6);
    return { leftPct, widthPct };
}

/** keyframe_path 是后端本机绝对路径（可能含反斜杠），只取文件名拼代理 URL。 */
function keyframeFileName(keyframePath: string | undefined): string | null {
    if (!keyframePath) return null;
    const parts = keyframePath.split(/[\\/]+/).filter(Boolean);
    const name = parts[parts.length - 1];
    return name && /^scene_\d+\.png$/i.test(name) ? name : null;
}

function needsSpace(left: string, right: string): boolean {
    if (!left || !right) return false;
    return /[\w).%]$/.test(left) && /^[\w(]/.test(right);
}

function baseName(path: string): string {
    const parts = path.split(/[\\/]+/).filter(Boolean);
    return parts[parts.length - 1] || path;
}

export function buildWordChunks(words: EreverseWord[], durationMs: number): EreverseWordChunk[] {
    const usable = words
        .filter((w) => w.word && Number.isFinite(w.start_ms) && Number.isFinite(w.end_ms))
        .sort((a, b) => a.start_ms - b.start_ms);
    const chunks: EreverseWordChunk[] = [];
    let cur: { words: EreverseWord[]; text: string; startMs: number; endMs: number } | null = null;
    const flush = () => {
        if (!cur || cur.words.length === 0) return;
        const { leftPct, widthPct } = pctOf(cur.startMs, cur.endMs, durationMs);
        chunks.push({ text: cur.text, startMs: cur.startMs, endMs: cur.endMs, leftPct, widthPct, wordCount: cur.words.length });
        cur = null;
    };
    for (const w of usable) {
        if (cur) {
            const gap = w.start_ms - cur.endMs;
            const tooLong = w.end_ms - cur.startMs > MAX_CHUNK_MS;
            const tooWide = cur.text.length + w.word.length > MAX_CHUNK_CHARS;
            if (gap > GAP_MS || tooLong || tooWide) flush();
        }
        if (!cur) {
            cur = { words: [w], text: w.word, startMs: w.start_ms, endMs: w.end_ms };
        } else {
            cur.text += (needsSpace(cur.text, w.word) ? " " : "") + w.word;
            cur.words.push(w);
            cur.endMs = Math.max(cur.endMs, w.end_ms);
        }
    }
    flush();
    return chunks;
}

/** 落入 [startMs, endMs] 窗口的台词（词块与窗口有交集即计入）。 */
export function dialogueForWindow(chunks: EreverseWordChunk[], startMs: number, endMs: number): string {
    const parts = chunks
        .filter((chunk) => chunk.endMs > startMs && chunk.startMs < endMs)
        .sort((a, b) => a.startMs - b.startMs)
        .map((chunk) => chunk.text.trim())
        .filter(Boolean);
    return parts.join(" ");
}

/** 窗口内是否有人声（无词级 ASR 时用 speech_spans 保底判定）。 */
export function hasSpeechInWindow(spans: Array<{ start_ms: number; end_ms: number; is_silence: boolean }>, startMs: number, endMs: number): boolean {
    return (spans || []).some((span) => !span.is_silence && span.end_ms > startMs && span.start_ms < endMs);
}

export function presentEreversePft(pft: EreversePft, jobId: string, assetUrl: (jobId: string, kind: "video" | "file", fileName?: string) => string): EreverseView {
    const durationMs = Math.max(0, Number(pft.source?.duration_ms) || 0);
    const words = pft.words || [];
    const chunks = buildWordChunks(words, durationMs);
    const spans = pft.speech_spans || [];
    const scenes: EreverseSceneView[] = (pft.scenes || []).map((scene: EreverseScene) => {
        const { leftPct, widthPct } = pctOf(scene.start_ms, Math.max(scene.end_ms, scene.start_ms), durationMs);
        const fileName = keyframeFileName(scene.keyframe_path);
        return {
            index: scene.index,
            startMs: scene.start_ms,
            endMs: scene.end_ms,
            durationMs: Math.max(0, scene.end_ms - scene.start_ms),
            leftPct,
            widthPct,
            keyframeUrl: fileName ? assetUrl(jobId, "file", fileName) : null,
            tags: scene.semantic_tags || [],
            tagProvider: scene.tag_provider || "",
            shotType: (scene.shot_type || "").trim(),
            cameraMovement: (scene.camera_movement || "").trim(),
            visualPrompt: (scene.visual_prompt || "").trim(),
            compliancePrompt: (scene.compliance_prompt || "").trim(),
            negativePrompt: (scene.negative_prompt || "").trim(),
            dialogue: dialogueForWindow(chunks, scene.start_ms, scene.end_ms),
            // 无词级 ASR 时用语音段保底，避免降级模式下时间轴信息整体丢失。
            hasSpeech: hasSpeechInWindow(spans, scene.start_ms, scene.end_ms),
        };
    });
    // 时间轴来源诚实标注：words 优先，其次 speech_spans，都没有则 none。
    const timelineSource: EreverseTimelineSource = words.length > 0 ? "words" : spans.length > 0 ? "speech_spans" : "none";
    return {
        durationMs,
        sourceName: baseName(pft.source?.path || ""),
        width: Number(pft.source?.width) || 0,
        height: Number(pft.source?.height) || 0,
        fps: Number(pft.source?.fps) || 0,
        scenes,
        chunks,
        wordCount: words.length,
        asrProvider: pft.provenance?.asr_provider || "",
        vlmProvider: pft.provenance?.vlm_provider || "",
        timelineSource,
        degraded: pft.provenance?.degraded || [],
        generatedAt: pft.provenance?.generated_at || "",
    };
}

/**
 * 由视图模型构建画布分镜草稿（M3 DAG 注入的数据源）。
 *
 * 取字段优先级（不臆造）：正向 prompt 默认取 compliance_prompt（防封改写版），
 * 关闭时回退 visual_prompt，再回退 semantic_tags 拼接；负向词取 negative_prompt。
 */
export function buildStoryboardShots(view: EreverseView, options?: EreverseStoryboardOptions): EreverseStoryboardShot[] {
    const useCompliance = options?.useCompliancePrompt !== false;
    return view.scenes.map((scene) => {
        const prompt = (useCompliance ? scene.compliancePrompt || scene.visualPrompt : scene.visualPrompt || scene.compliancePrompt)
            || scene.tags.join("、");
        return {
            index: scene.index,
            startMs: scene.startMs,
            endMs: scene.endMs,
            durationMs: scene.durationMs,
            title: `镜头 ${String(scene.index + 1).padStart(2, "0")}`,
            shotType: scene.shotType,
            cameraMovement: scene.cameraMovement,
            prompt,
            visualPrompt: scene.visualPrompt,
            compliancePrompt: scene.compliancePrompt,
            negativePrompt: scene.negativePrompt,
            dialogue: scene.dialogue,
            keyframeUrl: scene.keyframeUrl,
        };
    });
}
