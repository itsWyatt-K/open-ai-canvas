import { useCallback, useEffect, useMemo, useState } from "react";

import { CanvasCloudAgentPanel } from "@/components/canvas/canvas-cloud-agent-panel";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { useEcommerceStore } from "@/stores/canvas/use-ecommerce-store";
import { resourceFileUrl } from "@/services/api/resources";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { EcommerceProductDetail } from "@/services/api/ecommerce";

/**
 * 电商 Agent 适配层：为电商工作台维护一个专属「电商工作台」画布（Agent 运行时硬绑定真实画布 ID），
 * 并以空画布状态挂载原生 CanvasCloudAgentPanel（画布状态全走 props，无需改动面板本体）。
 * 会话历史按该画布 ID 隔离；「去画布精修」跳 /canvas/:id?agent=1 与 Agent 共享同一画布。
 *
 * 阶段 0 修复（方案 C）：Agent 只认画布、不认识电商表（`grep ecommerce cloud_agent*.go` 零命中），
 * 因此这里把「当前商品 + 槽位」上下文通过两条既有通道喂给面板：
 *   1. `references` —— 商品实拍原图（视觉模型可直接看图）；
 *   2. `prefillRequest` —— 结构化文本上下文（`requiresVision: true` 走视觉路由，`autoSubmit: false` 不自动扣费）。
 * 不改后端：Agent 仍只读画布与 references，写能力维持原状（改槽位需阶段 2 的 slots 端点）。
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

export function AgentWorkbenchPanel({
    canvasId,
    canvasState,
    productCount,
    detail,
}: {
    canvasId: string;
    canvasState: string;
    productCount: number;
    /** 当前商品详情（含实拍原图资源 ID 与槽位）；为空时退化为纯画布助手。 */
    detail?: EcommerceProductDetail | null;
}) {
    const [open, setOpen] = useState(true);
    // 画布创建是异步的：拿到 ID 前不挂载面板，拿到后保持常开。
    useEffect(() => {
        if (canvasId) setOpen(true);
    }, [canvasId]);

    const product = detail?.product;
    const slots = detail?.slots ?? [];

    // 商品实拍原图 → 视觉引用（Agent 可直接看图，无需用户重新上传）。
    const references = useMemo<CanvasResourceReference[]>(() => {
        const resourceId = product?.sourceResourceId?.trim();
        if (!product || !resourceId) return [];
        return [{
            id: resourceId,
            nodeId: resourceId,
            kind: "image",
            label: product.sourceName || product.name || "商品原图",
            title: product.name || "商品原图",
            previewUrl: resourceFileUrl(resourceId),
            storageKey: resourceId,
            active: true,
        }];
    }, [product]);

    // 打开抽屉时的结构化商品上下文（视觉路由 + 不自动提交，避免未确认即扣费）。
    const prefillRequest = useMemo(() => {
        if (!product) return null;
        const slotLines = slots
            .map((slot, index) =>
                `  [${index + 1}] ${slot.slotKey}（${slot.title || "未命名"}）· 状态:${slot.status} · 文案:${slot.copy || "无"}`,
            )
            .join("\n");
        const text = [
            "【当前电商工坊商品上下文】",
            `- 商品名称：${product.name}（ID: ${product.id}，状态: ${product.status}）`,
            `- 核心卖点：${product.sellingPoints || "未填写"}`,
            `- 附加要求：${product.extraRequirements || "未填写"}`,
            `- 分屏槽位（共 ${slots.length} 屏）：`,
            slotLines || "  暂无已生成槽位",
            "",
            "请结合上方商品实拍图与分屏信息，协助我优化分屏文案或生图提示词。",
        ].join("\n");
        // id 变化即触发一次预填（面板以 id 判重）；取商品 ID 长度 + 槽位数，保证切换商品时重新注入。
        return { id: product.id.length + slots.length * 7919, text, autoSubmit: false, requiresVision: true };
    }, [product, slots]);

    if (!canvasId) {
        return <div className="ecommerce-agent-placeholder">{canvasState || "工作台画布准备中…"}</div>;
    }
    return (
        <div className="ecommerce-agent-panel-host" data-canvas-state={canvasState || "ready"} data-product-count={productCount}>
            <CanvasCloudAgentPanel
                canvasId={canvasId}
                nodeCount={slots.length > 0 ? slots.length : product ? 1 : 0}
                selectedNodeIds={[]}
                references={references}
                prefillRequest={prefillRequest}
                open={open}
                onOpen={() => setOpen(true)}
                onCollapse={() => setOpen(false)}
                canvasNodes={[]}
                runningNodeId={null}
            />
        </div>
    );
}
