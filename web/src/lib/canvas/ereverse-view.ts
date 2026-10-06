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
    leftPct: number;
    widthPct: number;
    keyframeUrl: string | null;
    tags: string[];
    tagProvider: string;
};

export type EreverseWordChunk = {
    text: string;
    startMs: number;
    endMs: number;
    leftPct: number;
    widthPct: number;
    wordCount: number;
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

export function presentEreversePft(pft: EreversePft, jobId: string, assetUrl: (jobId: string, kind: "video" | "file", fileName?: string) => string): EreverseView {
    const durationMs = Math.max(0, Number(pft.source?.duration_ms) || 0);
    const scenes: EreverseSceneView[] = (pft.scenes || []).map((scene: EreverseScene) => {
        const { leftPct, widthPct } = pctOf(scene.start_ms, Math.max(scene.end_ms, scene.start_ms), durationMs);
        const fileName = keyframeFileName(scene.keyframe_path);
        return {
            index: scene.index,
            startMs: scene.start_ms,
            endMs: scene.end_ms,
            leftPct,
            widthPct,
            keyframeUrl: fileName ? assetUrl(jobId, "file", fileName) : null,
            tags: scene.semantic_tags || [],
            tagProvider: scene.tag_provider || "",
        };
    });
    const words = pft.words || [];
    return {
        durationMs,
        sourceName: baseName(pft.source?.path || ""),
        width: Number(pft.source?.width) || 0,
        height: Number(pft.source?.height) || 0,
        fps: Number(pft.source?.fps) || 0,
        scenes,
        chunks: buildWordChunks(words, durationMs),
        wordCount: words.length,
        asrProvider: pft.provenance?.asr_provider || "",
        vlmProvider: pft.provenance?.vlm_provider || "",
        degraded: pft.provenance?.degraded || [],
        generatedAt: pft.provenance?.generated_at || "",
    };
}
