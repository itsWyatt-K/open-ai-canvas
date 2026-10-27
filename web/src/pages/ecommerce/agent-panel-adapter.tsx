import { useCallback, useEffect, useMemo, useState } from "react";

import { CanvasCloudAgentPanel } from "@/components/canvas/canvas-cloud-agent-panel";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { useEcommerceStore } from "@/stores/canvas/use-ecommerce-store";
import { useGlobalAgentStore } from "@/stores/use-global-agent-store";
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
 *   2. `prefillRequest` —— 结构化文本上下文（`requiresVision: true` 走视觉路由）。
 *
 * 阶段 5 修复（Bug 3）：
 *   - **移除 task-detail 里的空壳 Drawer**：CanvasCloudAgentPanel 自身是 fixed 悬浮面板，
 *     包在 Drawer 里只会得到一个右侧空白大白框。现在 open 由父组件控制，直接渲染。
 *   - **prefillRequest 时序**：面板挂载瞬间 prefill 可能早于输入框就绪。打开后延迟 120ms
 *     再递增 prefillNonce（改变 prefillRequest.id 触发一次新预填），保证商品上下文
 *     【ID + 名称 + 平台 + 卖点 + 各屏文案】稳定进入输入框。
 *   - **顾问模式（advisor）**：用户点「跟 AI 顾问对话定制」时 autoSubmit=true，
 *     Agent 打开瞬间直接结合商品原图给出卖点与分屏建议；「精修」模式不自动提交（不自动扣费）。
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
    open,
    onOpenChange,
    advisorMode = false,
}: {
    canvasId: string;
    canvasState: string;
    productCount: number;
    /** 当前商品详情（含实拍原图资源 ID 与槽位）；为空时退化为纯画布助手。 */
    detail?: EcommerceProductDetail | null;
    /** 父组件控制的打开态（阶段 5：不再有内部默认常开，也不套 Drawer）。 */
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    /** 顾问模式：预填后自动提交（AI 主动给建议）；精修模式只预填不提交。 */
    advisorMode?: boolean;
}) {
    const product = detail?.product;
    const slots = detail?.slots ?? [];

    // 打开后延迟递增 nonce：改变 prefillRequest.id 触发面板重新预填一次，
    // 规避「挂载瞬间输入框未就绪 → prefill 丢失」的时序问题（Bug 3）。
    const [prefillNonce, setPrefillNonce] = useState(0);
    useEffect(() => {
        if (!open) return;
        const timer = window.setTimeout(() => setPrefillNonce((value) => value + 1), 120);
        return () => window.clearTimeout(timer);
    }, [open]);

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

    // 打开抽屉时的结构化商品上下文（视觉路由 + 精修模式不自动提交，避免未确认即扣费）。
    const prefillRequest = useMemo(() => {
        if (!product) return null;
        const slotLines = slots
            .map((slot, index) =>
                `  [${index + 1}] ${slot.slotKey}（${slot.title || "未命名"}）· 状态:${slot.status} · 文案:${slot.copy || "无"}`,
            )
            .join("\n");
        const ask = advisorMode
            ? "请基于上方商品实拍图，直接给我 3 条核心卖点建议和这套分屏的修改方案（每条说明改哪屏、改成什么）。"
            : "请结合上方商品实拍图与分屏信息，协助我优化分屏文案或生图提示词。";
        const text = [
            "【当前电商工坊商品上下文】",
            `- 商品名称：${product.name}（ID: ${product.id}，状态: ${product.status}）`,
            `- 核心卖点：${product.sellingPoints || "未填写"}`,
            `- 附加要求：${product.extraRequirements || "未填写"}`,
            `- 分屏槽位（共 ${slots.length} 屏）：`,
            slotLines || "  暂无已生成槽位",
            "",
            ask,
        ].join("\n");
        // id 变化即触发一次预填（面板以 id 判重）：商品 ID + 槽位数 + 打开 nonce，
        // 保证切换商品/重新打开都能重新注入。
        return {
            id: product.id.length + slots.length * 7919 + prefillNonce * 104729,
            text,
            autoSubmit: advisorMode,
            requiresVision: true,
        };
    }, [product, slots, prefillNonce, advisorMode]);

    if (!canvasId) {
        return <div className="ecommerce-agent-placeholder">{canvasState || "工作台画布准备中…"}</div>;
    }
    // v1.6.9 合流：平台级 Agent 面板改为零 props（从 useGlobalAgentStore 读上下文），
    // 电商页改为发布 AgentCanvasContext 供面板消费，卸载时清空避免跨页串扰。
    useEffect(() => {
        useGlobalAgentStore.getState().setCanvas({
            canvasId,
            nodeCount: slots.length > 0 ? slots.length : product ? 1 : 0,
            selectedNodeIds: [],
            references,
            prefillRequest,
            runningNodeId: null,
        });
        return () => useGlobalAgentStore.getState().setCanvas(null);
    }, [canvasId, slots.length, product, references, prefillRequest]);
    return (
        <div className="ecommerce-agent-panel-host" data-canvas-state={canvasState || "ready"} data-product-count={productCount}>
            <CanvasCloudAgentPanel />
        </div>
    );
}
