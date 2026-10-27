/**
 * 电商 → 画布桥（返工令四）：把电商工坊的成品图/商品原图一键送进「电商工作台」画布。
 *
 * 画布对图片节点内置了全套 hover 工具（创建编辑副本=垫图再创作、画质增强、方向校正、
 * 下载、加入素材库……），电商页不再重复造轮子——把资源变成标准图片节点，剩下的事
 * 全部交给画布既有能力。
 */
import { nanoid } from "nanoid";

import { loadCanvasProjectForEditing, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

/** 往工作台画布追加一张资源图片节点（自动加载远程画布、落盘持久化），返回节点 id。 */
export async function appendImageNodeToCanvas(canvasId: string, resourceId: string, title: string): Promise<string> {
    await loadCanvasProjectForEditing(canvasId);
    const project = useCanvasStore.getState().openProject(canvasId);
    if (!project) throw new Error("工作台画布加载失败，请稍后重试");
    // 摆到现有内容右侧留白处，多次发送从左往右排开，不叠节点。
    const offsetX = project.nodes.reduce((max, node) => Math.max(max, node.position.x + node.width), 0);
    const nodeId = nanoid();
    const node: CanvasNodeData = {
        id: nodeId,
        type: CanvasNodeType.Image,
        title,
        position: { x: offsetX + 80, y: 80 },
        width: 360,
        height: 360,
        metadata: {
            content: resourceFileUrl(resourceId),
            storageKey: resourceStorageKey(resourceId),
            status: "success",
        },
    };
    useCanvasStore.getState().updateProject(canvasId, { nodes: [...project.nodes, node] });
    await saveRemoteUserDataNow();
    return nodeId;
}
