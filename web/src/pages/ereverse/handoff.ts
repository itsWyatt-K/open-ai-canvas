/**
 * 爆款反推 → 三大实战出口的载荷契约（返工令 Round 5）。
 *
 * 背景纪律：画布 / 短剧制片台 / 直播装修台的所有权不在本页，预填它们需要改
 * 其他成员负责的文件或 services——本轮一律不改。退而方案：
 *   - 重负载（镜头序列 / 视觉配方 / 参考帧）写 localStorage 快照；
 *   - URL 只带轻量标记（from=ereverse）；
 *   - 跳转前 toast 明确告知「已带入反推配方，请在节点中粘贴/选择」，
 *     只有直播台参考图模块是真的自动预填（该模块同属本轮交付，会消费载荷）。
 * 严禁造假「已自动填入」。
 */

import {
    LIVE_REFERENCE_DEFAULT_STRENGTH,
    LIVE_REFERENCE_HANDOFF_KEY,
    LIVE_REFERENCE_HANDOFF_MAX_CHARS,
    type LiveReferenceHandoff,
    type LiveReferenceStrength,
} from "@/pages/modules/platforms-live";
import type { EreverseStoryboardShot, EreverseView } from "@/lib/canvas/ereverse-view";

/** 画布 / 制片台出口共用的快照键（直播台有自己的键，见 platforms-live）。 */
export const EREVERSE_HANDOFF_KEY = "yingce:ereverse-handoff";

export type EreverseHandoffTarget = "canvas" | "projects";

export type EreverseHandoffShot = {
    index: number;
    title: string;
    startMs: number;
    endMs: number;
    durationMs: number;
    shotType: string;
    cameraMovement: string;
    prompt: string;
    visualPrompt: string;
    /** 🛡️ 敏感品类防封改写版（双轨映射；空串=该镜没有改写稿）。 */
    compliancePrompt: string;
    negativePrompt: string;
    dialogue: string;
    keyframeUrl: string | null;
    /** 场景标签池（叙事标签 → 分镜行 narrativeIntent）。 */
    tags?: string[];
    /** 前 3 秒钩子标注（黄金三镜与 narrativeIntent 用）。 */
    hook?: string;
};

export type EreverseHandoff = {
    source: "ereverse";
    target: EreverseHandoffTarget;
    sourceName: string;
    createdAt: string;
    shots: EreverseHandoffShot[];
    visualDnaText: string;
    /** 原对标视频地址（可选）：画布消费器据此建视频参考节点（Seedance 可 @；H3 自动降级）。 */
    sourceVideoUrl?: string;
    /** 🛡️ 防封双轨：true 时消费器用 compliancePrompt 填 plotDescription，否则用 visualPrompt。 */
    preferCompliance?: boolean;
};

/** localStorage 体积护栏：超限先丢参考帧，再不行只留纯文本，绝不静默失败。 */
export const EREVERSE_HANDOFF_MAX_CHARS = 3_500_000;

/** 反推视图 → 画布分镜节点口径的镜头序列（复用项目现有 builder，不新造契约）。 */
export function toHandoffShots(view: EreverseView, options?: { selectedIndexes?: Set<number> }): EreverseHandoffShot[] {
    return view.scenes
        .map((scene, index) => ({ scene, index }))
        .filter(({ index }) => !options?.selectedIndexes || options.selectedIndexes.has(index))
        .map(({ scene, index }) => ({
            index,
            title: `镜头 ${String(index + 1).padStart(2, "0")}`,
            startMs: scene.startMs,
            endMs: scene.endMs,
            durationMs: scene.durationMs,
            shotType: scene.shotType,
            cameraMovement: scene.cameraMovement,
            prompt: scene.compliancePrompt || scene.visualPrompt || scene.tags.join("、"),
            visualPrompt: scene.visualPrompt,
            compliancePrompt: scene.compliancePrompt || "",
            negativePrompt: scene.negativePrompt,
            dialogue: scene.dialogue,
            keyframeUrl: scene.keyframeUrl,
            tags: scene.tags,
            hook: index === 0 && scene.startMs < 3000 ? "前 3 秒钩子" : "",
        }));
}

/** 黄金三镜选择器：前 3 秒钩子镜 + 最长镜（高潮）+ 收尾镜——成本闸门的快捷筛。 */
export function goldenThreeShotIndexes(view: EreverseView): Set<number> {
    const scenes = view.scenes;
    if (!scenes.length) return new Set();
    const picks = new Set<number>();
    picks.add(0);
    picks.add(scenes.length - 1);
    let longest = 0;
    scenes.forEach((scene, index) => {
        if (scene.durationMs > scenes[longest].durationMs) longest = index;
    });
    picks.add(longest);
    return picks;
}

/** 视觉配方提示词：镜头视觉提示词 + 场景标签池，供直播台参考图模块 / 人工粘贴。 */
export function buildVisualDnaText(view: EreverseView): string {
    const shotLines = view.scenes
        .slice(0, 10)
        .map((scene, index) => {
            const bits = [scene.shotType, scene.cameraMovement].filter(Boolean).join(" · ");
            const prompt = (scene.compliancePrompt || scene.visualPrompt || "").trim() || scene.tags.join("、");
            return prompt ? `镜头${index + 1}${bits ? `（${bits}）` : ""}：${prompt}` : "";
        })
        .filter(Boolean);
    const tagPool = Array.from(new Set(view.scenes.flatMap((scene) => scene.tags))).slice(0, 14);
    const parts = [`爆款「${view.sourceName || "对标视频"}」视觉配方`];
    if (tagPool.length) parts.push(`场景标签：${tagPool.join("、")}`);
    if (shotLines.length) parts.push(shotLines.join("；"));
    return parts.join("；").slice(0, 1800);
}

/** 关键帧 URL → dataURL（侧车同源代理地址）；失败返回 null，由调用方降级。 */
export async function fetchKeyframeDataUrl(url: string): Promise<string | null> {
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("read failed"));
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

/** 写画布 / 制片台快照（同一键覆盖写，target 区分目标）。 */
export function writeEreverseHandoff(input: { target: EreverseHandoffTarget; sourceName: string; shots: EreverseHandoffShot[]; visualDnaText: string; sourceVideoUrl?: string; preferCompliance?: boolean }): void {
    const payload: EreverseHandoff = {
        source: "ereverse",
        target: input.target,
        sourceName: input.sourceName,
        createdAt: new Date().toISOString(),
        shots: input.shots,
        visualDnaText: input.visualDnaText.slice(0, 1800),
        sourceVideoUrl: input.sourceVideoUrl,
        preferCompliance: input.preferCompliance,
    };
    try {
        window.localStorage.setItem(EREVERSE_HANDOFF_KEY, JSON.stringify(payload));
    } catch {
        // 极端超限：丢视觉文本保镜头序列；再失败就丢镜头序列保最小可读信息
        try {
            window.localStorage.setItem(EREVERSE_HANDOFF_KEY, JSON.stringify({ ...payload, visualDnaText: "" }));
        } catch {
            try {
                window.localStorage.setItem(EREVERSE_HANDOFF_KEY, JSON.stringify({ ...payload, shots: [], visualDnaText: "" }));
            } catch {
                /* 存储不可用：toast 仍如实说明已尝试带入 */
            }
        }
    }
}

/** 复制分镜文本到剪贴板（画布 / 制片台「粘贴」动线的真实载体）；失败返回 false。 */
export async function copyStoryboardText(shots: EreverseStoryboardShot[]): Promise<boolean> {
    const text = shots
        .map((shot) => [`镜头${shot.index + 1} ${shot.shotType || ""} ${shot.cameraMovement || ""}`.trim(), `画面：${shot.prompt}`, shot.dialogue ? `台词：${shot.dialogue}` : ""].filter(Boolean).join("\n"))
        .join("\n\n");
    if (!text.trim()) return false;
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

/** 只读查看载荷（制片台导入预览用；确认导入后才 removeEreverseHandoff）。 */
export function peekEreverseHandoff(target: EreverseHandoffTarget): EreverseHandoff | null {
    try {
        const raw = window.localStorage.getItem(EREVERSE_HANDOFF_KEY);
        if (!raw) return null;
        const payload = JSON.parse(raw) as EreverseHandoff;
        if (payload?.source !== "ereverse" || payload.target !== target || !payload.shots?.length) return null;
        return payload;
    } catch {
        return null;
    }
}

/** 清除载荷（制片台确认导入后调用；画布侧走 readEreverseHandoffOnce 的 consume-once）。 */
export function removeEreverseHandoff(): void {
    try {
        window.localStorage.removeItem(EREVERSE_HANDOFF_KEY);
    } catch {
        /* 存储不可用时忽略 */
    }
}

/**
 * 载荷 → Markdown 分镜表（制片台「分镜导入」格式的直喂文本）。
 * 🛡️ 防封双轨：preferCompliance 时画面列用 compliancePrompt（空则回退 visualPrompt）。
 */
export function ereverseHandoffMarkdownTable(payload: EreverseHandoff): string {
    const header = `| 镜头 | 时长(秒) | 景别 | 运镜 | 画面 | 台词 | 叙事标签 |\n| --- | --- | --- | --- | --- | --- | --- |`;
    const rows = payload.shots.map((shot) => {
        const seconds = Math.max(1, Math.round(((shot.endMs - shot.startMs) / 1000) * 10) / 10);
        const visual = (payload.preferCompliance ? shot.compliancePrompt : shot.visualPrompt) || shot.prompt || "";
        const narrative = [shot.hook, (shot.tags || []).join("、")].filter(Boolean).join(" · ");
        const cell = (value: string) => value.replace(/\|/g, "／").replace(/\n/g, " ");
        return `| ${shot.index + 1} | ${seconds} | ${cell(shot.shotType)} | ${cell(shot.cameraMovement)} | ${cell(visual)} | ${cell(shot.dialogue)} | ${cell(narrative)} |`;
    });
    return [`# 爆款复刻 · ${payload.sourceName || "对标视频"}`, header, ...rows].join("\n");
}

/**
 * 组装直播台参考图模块载荷并落盘（同属本轮交付，直播台会真实消费）。
 * 参考帧超体积护栏时丢帧留文，frameDropped 供 toast 如实说明。
 */
export function writeLiveReferenceHandoff(input: {
    sourceName: string;
    referenceFrame?: string;
    dnaText: string;
    strength?: LiveReferenceStrength;
}): { frameDropped: boolean } {
    const strength = input.strength ?? LIVE_REFERENCE_DEFAULT_STRENGTH;
    const base: LiveReferenceHandoff = {
        source: "ereverse",
        sourceName: input.sourceName,
        mode: "style",
        strength,
        dnaText: input.dnaText.slice(0, 4000),
        createdAt: new Date().toISOString(),
    };
    const withFrame: LiveReferenceHandoff = input.referenceFrame ? { ...base, dataUrl: input.referenceFrame } : { ...base, frameDropped: true };
    const fits = (payload: LiveReferenceHandoff) => JSON.stringify(payload).length <= LIVE_REFERENCE_HANDOFF_MAX_CHARS;
    const finalPayload = fits(withFrame) ? withFrame : { ...base, dataUrl: undefined, frameDropped: true };
    try {
        window.localStorage.setItem(LIVE_REFERENCE_HANDOFF_KEY, JSON.stringify(finalPayload));
    } catch {
        try {
            window.localStorage.setItem(LIVE_REFERENCE_HANDOFF_KEY, JSON.stringify({ ...base, dataUrl: undefined, frameDropped: true }));
        } catch {
            /* 存储不可用：直播台侧收不到载荷，toast 会说明只尝试了带入 */
        }
    }
    return { frameDropped: Boolean(finalPayload.frameDropped) || !input.referenceFrame };
}
