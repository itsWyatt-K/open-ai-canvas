/**
 * 爆款反推 → 画布消费器（夜间施工令阶段三）。
 *
 * 消除「画布侧零消费断层」：监听 URL `?handoff=ereverse`，读取 localStorage
 * 「yingce:ereverse-handoff」载荷（target=canvas，consume-once），在当前画布落出：
 *   1. 反推关键帧 → 构图/动作参考图片节点（kind:"image" 槽位，逐镜连线进分镜表）；
 *   2. 「🌟 自家主体锁定卡」→ 角色一致性槽（kind:"character"，空图占位，用户替换自家
 *      宠物/商品图后所有分镜行的 characters 都指向它——防克隆竞品主体）；
 *   3. 原对标视频（若载荷带）→ 视频参考节点（Seedance referenceVideos 按需 @ 引用；
 *      MiniMax H3 maxVideos=0 时上游协议层自动降级为仅关键帧+提示词，不会报错中断）；
 *   4. 分镜多维表（contentKind:"storyboard"）+ 精确字段映射的 StoryboardRow[]。
 *
 * 成本闸门铁律：只建节点与分镜表，**绝不触发任何生成任务**（不扣费）；
 * 首镜试水/分镜图确认的两步引导以「复刻三步走」便签节点落在分镜表旁。
 */
import { nanoid } from "nanoid";

import { createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import { EREVERSE_HANDOFF_KEY, type EreverseHandoff } from "@/pages/ereverse/handoff";
import { CanvasNodeType, type CanvasBatchTableData, type CanvasConnection, type CanvasNodeData, type StoryboardRow } from "@/types/canvas";

/** 分镜表单元格值（与 list-mode-generator 的 storyboardCells 同口径）。 */
function storyboardCells(row: StoryboardRow) {
    const values: Record<string, string> = {};
    const fields: Array<keyof StoryboardRow> = ["durationSeconds", "plotDescription", "dialogue", "narrativeIntent", "viewerPOV", "performanceBlocking", "shotSize", "emotion", "lightingAndAtmosphere", "audioEffects", "camera", "motion", "timeBeats", "imageGenerationPrompt", "videoMotionPrompt", "continuityOut", "negativePrompt"];
    fields.forEach((field) => {
        values[`storyboard-${field}`] = String(row[field] || "");
    });
    values[`storyboard-mustHave`] = row.mustHave.join("、");
    values[`storyboard-optionalDetails`] = row.optionalDetails.join("、");
    return values;
}

/** 读取并消费一次反推载荷；URL 标记与 localStorage 同时清理，绝不二次注入。 */
export function readEreverseHandoffOnce(search: string, target: "canvas" | "projects"): EreverseHandoff | null {
    const params = new URLSearchParams(search);
    if (params.get("handoff") !== "ereverse") return null;
    try {
        const raw = window.localStorage.getItem(EREVERSE_HANDOFF_KEY);
        if (!raw) return null;
        const payload = JSON.parse(raw) as EreverseHandoff;
        if (payload?.source !== "ereverse" || payload.target !== target || !payload.shots?.length) return null;
        return payload;
    } catch {
        return null;
    } finally {
        try {
            window.localStorage.removeItem(EREVERSE_HANDOFF_KEY);
        } catch {
            /* 存储不可用时忽略——URL 标记已由调用方清除 */
        }
    }
}

export function clearEreverseHandoffMark() {
    if (!window.location.search.includes("handoff=ereverse")) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("handoff");
    const rest = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
}

export type EreverseCanvasHandoffResult = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    batchNodeId: string;
    characterSlotNodeId: string;
    rows: StoryboardRow[];
    sourceName: string;
};

/**
 * 载荷 → 画布节点组。anchor 为落点锚（现有画布内容右侧），关键帧下载失败
 * 降级为远程 URL 引用（节点破图可删，不阻断分镜表）。
 */
export async function buildEreverseCanvasHandoff(payload: EreverseHandoff, anchor: { x: number; y: number }): Promise<EreverseCanvasHandoffResult> {
    const nodes: CanvasNodeData[] = [];
    const connections: CanvasConnection[] = [];
    const baseX = anchor.x;
    let cursorY = anchor.y;

    // 1) 关键帧 → 构图/动作参考（kind:"image" 槽位）：逐镜一图，超过 6 镜只带前 6 帧。
    const keyframeByShot = new Map<number, string>();
    const keyframeShots = payload.shots.filter((shot) => shot.keyframeUrl).slice(0, 6);
    for (const shot of keyframeShots) {
        const dataUrl = await keyframeDataUrl(shot.keyframeUrl!);
        const nodeId = `ereverse-kf-${nanoid(8)}`;
        nodes.push({
            id: nodeId,
            type: CanvasNodeType.Image,
            title: `🎞 关键帧 · 镜头${String(shot.index + 1).padStart(2, "0")}（构图/动作参考）`,
            position: { x: baseX, y: cursorY },
            width: 240,
            height: 240,
            metadata: { content: dataUrl || shot.keyframeUrl!, status: "success" },
        });
        keyframeByShot.set(shot.index, nodeId);
        cursorY += 264;
    }

    // 2) 自家主体锁定卡（kind:"character" 一致性槽）：空图占位，替换后所有行 characters 指向它。
    const characterSlotNodeId = `ereverse-subject-${nanoid(8)}`;
    nodes.push({
        id: characterSlotNodeId,
        type: CanvasNodeType.Image,
        title: "🌟 自家主体锁定卡（点击上传自家宠物/商品图）",
        position: { x: baseX + 264, y: anchor.y },
        width: 240,
        height: 240,
        metadata: {},
    });

    // 3) 原对标视频参考（可选）：Seedance referenceVideos 可 @；H3（maxVideos=0）自动降级。
    const sourceVideoUrl = (payload as EreverseHandoff & { sourceVideoUrl?: string }).sourceVideoUrl;
    const videoNodeId = sourceVideoUrl ? `ereverse-video-${nanoid(8)}` : "";
    if (videoNodeId) {
        nodes.push({
            id: videoNodeId,
            type: CanvasNodeType.Video,
            title: `📼 对标视频 · ${payload.sourceName || "原片"}`,
            position: { x: baseX + 264, y: anchor.y + 264 },
            width: 240,
            height: 160,
            metadata: { content: sourceVideoUrl!, status: "success" },
        });
    }

    // 4) 分镜行：字段精确映射（SceneSegment → StoryboardRow）。
    const preferCompliance = Boolean((payload as EreverseHandoff & { preferCompliance?: boolean }).preferCompliance);
    const rows = payload.shots.map((shot, rowIndex) => {
        const bodyPrompt = (preferCompliance ? shot.compliancePrompt : shot.visualPrompt) || shot.prompt || "";
        const tagsText = (shot as EreverseHandoffShotWithMeta).tags?.join("、") || "";
        const hook = (shot as EreverseHandoffShotWithMeta).hook || "";
        const narrative = [hook, tagsText].filter(Boolean).join(" · ");
        const keyframeNodeId = keyframeByShot.get(shot.index);
        return createStoryboardRow(rowIndex + 1, {
            durationSeconds: Math.max(1, Math.round(((shot.endMs - shot.startMs) / 1000) * 10) / 10),
            plotDescription: bodyPrompt,
            dialogue: shot.dialogue || "",
            narrativeIntent: narrative,
            shotSize: shot.shotType || "",
            camera: shot.cameraMovement || "",
            motion: shot.cameraMovement || "",
            imageGenerationPrompt: bodyPrompt,
            videoMotionPrompt: bodyPrompt,
            negativePrompt: shot.negativePrompt || "",
            characters: [{ characterName: "自家主体", characterImageNodeId: characterSlotNodeId, characterDescription: "用户自备主体：宠物/商品/模特，替换锁定卡图片后生效" }],
            assetBindings: [
                ...(keyframeNodeId ? [{ nodeId: keyframeNodeId, role: "motion" as const, priority: 5 }] : []),
                { nodeId: characterSlotNodeId, role: "character" as const, priority: 1 },
            ],
        });
    });

    // 5) 分镜多维表（只建表不派发生成）。
    const batchNodeId = `batch-table-${nanoid()}`;
    const tableX = baseX + 528;
    const batchTable: CanvasBatchTableData = {
        operation: "creative",
        concurrency: 2,
        aiGenerated: true,
        contentKind: "storyboard",
        storyboardRows: rows,
        storyboardTitle: `爆款复刻 · ${payload.sourceName || "对标视频"}（${rows.length} 镜）`,
        storyboardSourceNodeIds: [...keyframeByShot.values(), characterSlotNodeId],
        referenceColumns: [
            { id: "ai-ref", label: "对标关键帧", type: "image" },
            { id: "subject-ref", label: "自家主体", type: "image" },
        ],
        textColumns: [],
        rows: rows.map((row, rowIndex) => ({
            id: row.id,
            enabled: true,
            inputNodeIds: [keyframeByShot.get(payload.shots[rowIndex].index) || characterSlotNodeId],
            prompt: row.videoMotionPrompt || row.plotDescription,
            cells: storyboardCells(row),
        })),
        referenceMode: "cells",
    } as CanvasBatchTableData;
    nodes.push({
        id: batchNodeId,
        type: CanvasNodeType.BatchTable,
        title: batchTable.storyboardTitle!,
        position: { x: tableX, y: anchor.y },
        width: 1280,
        height: 560,
        metadata: { batchTable, status: "idle" },
    });
    for (const nodeId of keyframeByShot.values()) {
        connections.push({ id: `conn-${nanoid()}`, fromNodeId: nodeId, fromHandleId: "output", toNodeId: batchNodeId, toHandleId: "batch-reference:ai-ref", relation: "batch-input" });
    }
    connections.push({ id: `conn-${nanoid()}`, fromNodeId: characterSlotNodeId, fromHandleId: "output", toNodeId: batchNodeId, toHandleId: "batch-reference:subject-ref", relation: "batch-input" });
    if (videoNodeId) {
        connections.push({ id: `conn-${nanoid()}`, fromNodeId: videoNodeId, fromHandleId: "output", toNodeId: batchNodeId, toHandleId: "batch-reference:ai-ref", relation: "batch-input" });
    }

    // 6) 两步引导便签（成本闸门：先试水再批量，生成永远需手动确认）。
    nodes.push({
        id: `ereverse-guide-${nanoid(8)}`,
        type: CanvasNodeType.Text,
        title: "🧭 复刻三步走（不会自动扣费）",
        position: { x: tableX, y: anchor.y + 590 },
        width: 420,
        height: 170,
        metadata: { content: "🧭 复刻三步走（成本闸门）\n\n① 先勾选第 1 行，只生成首镜试水——确认画面方向对不对；\n② 「先出分镜图」确认自家主体没有跑偏（锁定卡记得换成自家宠物/商品）；\n③ 全部确认后再全选批量生成视频。\n\n每一步都要你手动点生成，系统绝不自动扣费。" },
    });

    return { nodes, connections, batchNodeId, characterSlotNodeId, rows, sourceName: payload.sourceName };
}

/** 关键帧 URL → dataURL（同源代理）；8s 超时失败降级 null（节点退回远程 URL 引用）。 */
async function keyframeDataUrl(url: string): Promise<string | null> {
    try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 8000);
        const response = await fetch(url, { signal: controller.signal });
        window.clearTimeout(timer);
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => resolve("");
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}

type EreverseHandoffShotWithMeta = EreverseHandoff["shots"][number] & { tags?: string[]; hook?: string };
