import { useCallback, useEffect, useState } from "react";

import { CanvasCloudAgentPanel } from "@/components/canvas/canvas-cloud-agent-panel";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { useEcommerceStore } from "@/stores/canvas/use-ecommerce-store";

/**
 * 电商 Agent 适配层：为电商工作台维护一个专属「电商工作台」画布（Agent 运行时硬绑定真实画布 ID），
 * 并以空画布状态挂载原生 CanvasCloudAgentPanel（画布状态全走 props，无需改动面板本体）。
 * 会话历史按该画布 ID 隔离；「去画布精修」跳 /canvas/:id?agent=1 与 Agent 共享同一画布。
 */

const WORKBENCH_TITLE = "电商工作台";

export function useEcommerceWorkbenchCanvas() {
    const workbenchCanvasId = useEcommerceStore((state) => state.workbenchCanvasId);
    const setWorkbenchCanvasId = useEcommerceStore((state) => state.setWorkbenchCanvasId);
    const [canvasState, setCanvasState] = useState("");

    const ensureCanvas = useCallback(async () => {
        if (workbenchCanvasId) return;
        setCanvasState("正在创建工作台画布…");
        try {
            const { id, syncError } = await createCanvasProjectWithRemoteSync(WORKBENCH_TITLE);
            setWorkbenchCanvasId(id);
            setCanvasState(syncError ? `画布已创建，但云端同步异常：${syncError}` : "");
        } catch (error) {
            setCanvasState(error instanceof Error ? `画布创建失败：${error.message}` : "画布创建失败");
        }
    }, [workbenchCanvasId, setWorkbenchCanvasId]);

    return { canvasId: workbenchCanvasId || "", ensureCanvas, canvasState, resetCanvas: () => setWorkbenchCanvasId("") };
}

export function AgentWorkbenchPanel({ canvasId, canvasState, productCount }: { canvasId: string; canvasState: string; productCount: number }) {
    const [open, setOpen] = useState(true);
    // 画布创建是异步的：拿到 ID 前不挂载面板，拿到后保持常开。
    useEffect(() => {
        if (canvasId) setOpen(true);
    }, [canvasId]);

    if (!canvasId) {
        return <div className="ecommerce-agent-placeholder">{canvasState || "工作台画布准备中…"}</div>;
    }
    return (
        <div className="ecommerce-agent-panel-host" data-canvas-state={canvasState || "ready"} data-product-count={productCount}>
            <CanvasCloudAgentPanel
                canvasId={canvasId}
                nodeCount={0}
                selectedNodeIds={[]}
                references={[]}
                open={open}
                onOpen={() => setOpen(true)}
                onCollapse={() => setOpen(false)}
                canvasNodes={[]}
                runningNodeId={null}
            />
        </div>
    );
}
