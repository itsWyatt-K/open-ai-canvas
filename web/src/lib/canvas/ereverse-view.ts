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
    /**
     * 片段仿拍五维槽位树（prompt_slots）。
     * 视觉四槽（主体/产品/场景背景/镜头运镜）由 VLM 产出或扁平字段兜底组装；
     * "口播台词" 槽由侧车双源注入。换装只改对应键值，主体.动作与镜头运镜锁定。
     */
    promptSlots: EreversePromptSlots;
};

/** 五维槽位树（与侧车 providers.SLOT_TEMPLATE 同构；口播台词为字符串槽）。 */
export type EreversePromptSlots = {
    主体: { 身份: string; 外观: string; 动作: string };
    产品: { 名称与外观: string; 展示方式: string };
    场景背景: { 环境: string; 光影色调: string };
    镜头运镜: { 景别: string; 运镜: string };
    口播台词: string;
};

/** 空槽位树（字段全空串——用于无 PFT 时的编辑初始化）。 */
export function emptyPromptSlots(): EreversePromptSlots {
    return {
        主体: { 身份: "", 外观: "", 动作: "" },
        产品: { 名称与外观: "", 展示方式: "" },
        场景背景: { 环境: "", 光影色调: "" },
        镜头运镜: { 景别: "", 运镜: "" },
        口播台词: "",
    };
}

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
    /** 音视频轨实测（音频提取 Tab 用；侧车未抽到则空数组）。 */
    tracks: Array<{ kind: string; codec: string; extractedPath: string; note: string }>;
    /** 语音段实测（无词级 ASR 时的保底时间轴证据）。 */
    speechSpans: Array<{ startMs: number; endMs: number; isSilence: boolean }>;
    /** 片段仿拍时间窗回执（整条反推时为 null）。 */
    fragment: { startMs: number; endMs: number } | null;
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
    const usable = words.filter((w) => w.word && Number.isFinite(w.start_ms) && Number.isFinite(w.end_ms)).sort((a, b) => a.start_ms - b.start_ms);
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

/** mm:ss.mmm 格式化（页面与面板共用）。 */
export function formatMs(ms: number): string {
    const total = Math.max(0, ms);
    const s = Math.floor(total / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(total % 1000).padStart(3, "0")}`;
}

/** 把侧车 prompt_slots 原始 JSON 规范化为固定五维结构（缺键补空串，与侧车同构）。 */
export function normalizePromptSlots(raw: unknown): EreversePromptSlots {
    const slots = emptyPromptSlots();
    if (!raw || typeof raw !== "object") return slots;
    const src = raw as Record<string, unknown>;
    const pick = (slot: keyof EreversePromptSlots, key: string): string => {
        const node = src[slot];
        if (!node || typeof node !== "object") return "";
        const value = (node as Record<string, unknown>)[key];
        return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
    };
    slots.主体 = { 身份: pick("主体", "身份"), 外观: pick("主体", "外观"), 动作: pick("主体", "动作") };
    slots.产品 = { 名称与外观: pick("产品", "名称与外观"), 展示方式: pick("产品", "展示方式") };
    slots.场景背景 = { 环境: pick("场景背景", "环境"), 光影色调: pick("场景背景", "光影色调") };
    slots.镜头运镜 = { 景别: pick("镜头运镜", "景别"), 运镜: pick("镜头运镜", "运镜") };
    const dialogue = src["口播台词"];
    slots.口播台词 = typeof dialogue === "string" ? dialogue.trim() : dialogue == null ? "" : String(dialogue).trim();
    return slots;
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
            // 片段仿拍槽位树：侧车漏返时前端同样兜底（扁平字段组装），保证编辑框永不为空。
            promptSlots: normalizePromptSlots(
                scene.prompt_slots && Object.keys(scene.prompt_slots).length
                    ? scene.prompt_slots
                    : {
                          主体: { 身份: "", 外观: scene.visual_prompt || "", 动作: "" },
                          场景背景: { 环境: (scene.semantic_tags || []).join("、"), 光影色调: "" },
                          镜头运镜: { 景别: scene.shot_type || "", 运镜: scene.camera_movement || "" },
                      },
            ),
        };
    });
    // 时间轴来源诚实标注：words 优先，其次 speech_spans，都没有则 none。
    const timelineSource: EreverseTimelineSource = words.length > 0 ? "words" : spans.length > 0 ? "speech_spans" : "none";
    const fragment = pft.facts?.fragment;
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
        tracks: (pft.tracks || []).map((track) => ({
            kind: track.kind,
            codec: track.codec || "",
            extractedPath: track.extracted_path || "",
            note: track.note || "",
        })),
        speechSpans: spans.map((span) => ({ startMs: span.start_ms, endMs: span.end_ms, isSilence: span.is_silence })),
        fragment: fragment && Number.isFinite(fragment.start_ms) && Number.isFinite(fragment.end_ms) ? { startMs: Number(fragment.start_ms), endMs: Number(fragment.end_ms) } : null,
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
        const prompt = (useCompliance ? scene.compliancePrompt || scene.visualPrompt : scene.visualPrompt || scene.compliancePrompt) || scene.tags.join("、");
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
