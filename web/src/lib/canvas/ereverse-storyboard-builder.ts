/**
 * E-Reverse 逆向结果 → 画布分镜 DAG 构建器（M3）。
 *
 * 职责：把 pft/v1 的镜头序列转成一组「一次提交、原子落盘」的画布节点与连线。
 *
 * 载体选择（对齐本画布既有契约，不臆造节点类型）：
 *   - 分镜表 = `Script` 节点 + `metadata.storyboard`（`StoryboardData`）；
 *   - 关键帧 = `Image` 节点（content 填 keyframe URL）；
 *   - 分组容器 = `Frame` 节点（workflowKind=storyboard）；
 *   - 商品资产/关键帧 → 分镜表：`relation: "storyboard-asset-reference"` 连线。
 *
 * 负向词经 M1 的 `negativePrompt` 语义进入 `StoryboardRow.negativePrompt`，
 * 由分镜表生图/生视频链路统一下发，不另造字段。
 */

import { createCanvasNode, createStoryboardRow, cinematicStoryboardColumns } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType } from "@/types/canvas";
import type { CanvasConnection, CanvasNodeData, Position } from "@/types/canvas";
import type { EreverseStoryboardOptions, EreverseStoryboardShot, EreverseView } from "@/lib/canvas/ereverse-view";

export type EreverseStoryboardGraph = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    frameId: string;
    scriptNodeId: string;
    /** 实际绑定的商品资产节点 ID（未选则为空串）。 */
    assetNodeId: string;
    shotCount: number;
};

const KEYFRAME_WIDTH = 320;
const KEYFRAME_HEIGHT = 240;
const GRID_GAP = 20;
const FRAME_PADDING = 24;
const FRAME_HEADER_HEIGHT = 32;
/** 分镜表默认 920×360，N 镜时按行高扩展，避免表格挤出容器。 */
const STORYBOARD_ROW_HEIGHT = 44;

/**
 * 构建分镜 DAG。
 *
 * 布局（自上而下）：
 *   1) Script 分镜表（原点）
 *   2) Frame 容器（下方），内含 N 个关键帧 Image 节点（网格排列）
 *   3) 连线：商品资产 → 分镜表；每个关键帧 → 分镜表
 */
export function buildEreverseStoryboardGraph(input: {
    view: EreverseView;
    shots: EreverseStoryboardShot[];
    options?: EreverseStoryboardOptions;
    origin?: Position;
}): EreverseStoryboardGraph {
    const origin = input.origin ?? { x: 0, y: 0 };
    const shots = (input.shots || []).filter((shot) => shot.prompt.trim() || shot.visualPrompt.trim() || shot.dialogue.trim() || shot.keyframeUrl);
    const assetNodeId = (input.options?.productAssetNodeId || "").trim();
    const useCompliance = input.options?.useCompliancePrompt !== false;
    const groupTitle = input.options?.groupTitle || `[逆向重构] ${input.view.sourceName || "对标视频"}`;

    // 1) 分镜表节点（Script + metadata.storyboard）。
    const scriptNode = createCanvasNode(CanvasNodeType.Script, origin, {});
    scriptNode.title = `${groupTitle} · ${shots.length} 镜`;
    scriptNode.width = 920;
    scriptNode.height = Math.max(360, 120 + shots.length * STORYBOARD_ROW_HEIGHT);

    // 2) 关键帧 Image 节点（先建，好在分镜行里回填 imageNodeId）。
    const keyframeNodes: CanvasNodeData[] = [];
    const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, shots.length)))));
    const rows = Math.max(1, Math.ceil(Math.max(1, shots.length) / columns));
    const frameWidth = FRAME_PADDING * 2 + columns * KEYFRAME_WIDTH + (columns - 1) * GRID_GAP;
    const frameHeight = FRAME_HEADER_HEIGHT + FRAME_PADDING * 2 + rows * KEYFRAME_HEIGHT + (rows - 1) * GRID_GAP;
    const framePosition: Position = {
        x: origin.x - frameWidth / 2,
        y: origin.y + scriptNode.height / 2 + 80,
    };

    shots.forEach((shot, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const node = createCanvasNode(CanvasNodeType.Image, {
            x: framePosition.x + FRAME_PADDING + column * (KEYFRAME_WIDTH + GRID_GAP) + KEYFRAME_WIDTH / 2,
            y: framePosition.y + FRAME_HEADER_HEIGHT + FRAME_PADDING + row * (KEYFRAME_HEIGHT + GRID_GAP) + KEYFRAME_HEIGHT / 2,
        }, {
            content: shot.keyframeUrl || "",
            storageKey: shot.keyframeUrl || "",
            status: shot.keyframeUrl ? "success" : "idle",
            workflowKind: "shot",
            shotIndex: index + 1,
        });
        node.title = `${shot.title} · ${shot.shotType || "镜头"}`;
        node.width = KEYFRAME_WIDTH;
        node.height = KEYFRAME_HEIGHT;
        node.parentId = "";
        keyframeNodes.push(node);
    });

    // 3) 分镜行（关键帧 ID 回填，负向词/台词/时长/景别/运镜一次到位）。
    const referenceNodeIds = [assetNodeId, ...keyframeNodes.map((node) => node.id)].filter(Boolean);
    const rows2 = shots.map((shot, index) =>
        createStoryboardRow(index + 1, {
            durationSeconds: Math.max(1, Math.round(shot.durationMs / 1000)),
            plotDescription: shot.visualPrompt || shot.prompt,
            dialogue: shot.dialogue,
            shotSize: shot.shotType,
            camera: shot.cameraMovement,
            motion: shot.cameraMovement,
            timeBeats: `${shot.startMs}ms → ${shot.endMs}ms`,
            imageGenerationPrompt: shot.prompt,
            videoMotionPrompt: shot.prompt,
            negativePrompt: shot.negativePrompt,
            mustHave: shot.keyframeUrl ? ["关键帧构图与原视频一致"] : [],
            sourceStartMs: shot.startMs,
            sourceEndMs: shot.endMs,
            keyframeTimeMs: shot.startMs,
            imageNodeId: keyframeNodes[index]?.id || "",
            assetBindings: assetNodeId ? [{ nodeId: assetNodeId, role: "prop", priority: 90 }] : [],
            status: "idle",
        }),
    );

    const storyboardMetadata = {
        rows: rows2,
        visibleColumns: cinematicStoryboardColumns(),
        referenceNodeIds,
    };
    scriptNode.metadata = { ...scriptNode.metadata, storyboard: storyboardMetadata };

    // 4) Frame 容器（关键帧收进背板，与 createStoryboardGroup 的语义一致）。
    const frame = createCanvasNode(CanvasNodeType.Frame, {
        x: framePosition.x + frameWidth / 2,
        y: framePosition.y + frameHeight / 2 - FRAME_HEADER_HEIGHT,
    }, {
        workflowKind: "storyboard",
        workflowTitle: groupTitle,
        frame: { collapsed: false, expandedWidth: frameWidth, expandedHeight: frameHeight },
    });
    frame.title = `${groupTitle} · 关键帧`;
    frame.position = { x: framePosition.x, y: framePosition.y };
    frame.width = frameWidth;
    frame.height = frameHeight;
    const parentedKeyframes = keyframeNodes.map((node) => ({
        ...node,
        parentId: frame.id,
        position: {
            x: framePosition.x + FRAME_PADDING + keyframeNodes.indexOf(node) % columns * (KEYFRAME_WIDTH + GRID_GAP) + (KEYFRAME_WIDTH - node.width) / 2,
            y: framePosition.y + FRAME_HEADER_HEIGHT + FRAME_PADDING + Math.floor(keyframeNodes.indexOf(node) / columns) * (KEYFRAME_HEIGHT + GRID_GAP) + (KEYFRAME_HEIGHT - node.height) / 2,
        },
    }));

    // 5) 连线：商品资产 → 分镜表；关键帧 → 分镜表。
    const connections: CanvasConnection[] = [];
    if (assetNodeId) {
        connections.push({
            id: `conn-${assetNodeId}-${scriptNode.id}`,
            fromNodeId: assetNodeId,
            toNodeId: scriptNode.id,
            toHandleId: "storyboard:context",
            relation: "storyboard-asset-reference",
        });
    }
    for (const node of parentedKeyframes) {
        connections.push({
            id: `conn-${node.id}-${scriptNode.id}`,
            fromNodeId: node.id,
            toNodeId: scriptNode.id,
            relation: "storyboard-asset-reference",
        });
    }

    return {
        nodes: [scriptNode, ...parentedKeyframes, frame],
        connections,
        frameId: frame.id,
        scriptNodeId: scriptNode.id,
        assetNodeId,
        shotCount: shots.length,
    };
}
