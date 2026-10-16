// 任务详情栏：面包屑 + 头部（名称/状态徽章/轮次）+ 槽位网格（主图/详情页分区）
// + 标题面板 + 底部打包下载/历史轮次入口。
// M2.6 补：接入 M3 编排器——「开始生成」派发槽位任务并轮询对账（不再是占位）；
//           接入电商 Agent 面板（原 agent-panel-adapter 为孤儿组件，现由「Agent 精修」抽屉挂载）。
import { useCallback, useEffect, useState } from "react";
import { App, Button, Drawer, Empty } from "antd";
import { ArrowLeft, Bot, Download, History, Loader2, Play } from "lucide-react";

import {
    ECOMMERCE_SLOT_STATUS_LABELS,
    ECOMMERCE_STATUS_LABELS,
    getEcommerceProductDetail,
    startEcommerceProduct,
    type EcommerceProductDetail,
} from "@/services/api/ecommerce";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";
import { useConfigStore } from "@/stores/use-config-store";
import { AgentWorkbenchPanel, useEcommerceWorkbenchCanvas } from "./agent-panel-adapter";

const SLOT_STATUS_TONE: Record<string, string> = {
    pending: "bg-foreground/10 text-foreground/55",
    queued: "bg-foreground/10 text-foreground/55",
    refining: "bg-purple-500/15 text-purple-600",
    running: "bg-purple-500/15 text-purple-600",
    failed: "bg-destructive/15 text-destructive",
    uncertain: "bg-amber-500/15 text-amber-600",
    completed: "bg-emerald-500/15 text-emerald-600",
};

const TITLE_STATUS_LABELS: Record<string, string> = {
    pending: "标题未生成",
    running: "标题生成中",
    completed: "标题已生成",
    failed: "标题生成失败",
    uncertain: "标题结果待确认",
};

export function EcommerceTaskDetail({ productId, onBack }: { productId: string | null; onBack: () => void }) {
    const { message } = App.useApp();
    const detail = useEcommerceWorkspaceStore((state) => (productId ? state.detailById[productId] : undefined));
    const loading = useEcommerceWorkspaceStore((state) => state.detailLoading);
    const refreshDetail = useEcommerceWorkspaceStore((state) => state.refreshDetail);
    const refreshProducts = useEcommerceWorkspaceStore((state) => state.refreshProducts);
    const config = useConfigStore((state) => state.config);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [starting, setStarting] = useState(false);
    // Agent 精修抽屉：电商工作台画布按需创建，面板挂载后常开。
    const { canvasId: agentCanvasId, ensureCanvas, canvasState: agentCanvasState } = useEcommerceWorkbenchCanvas();
    const [agentOpen, setAgentOpen] = useState(false);

    useEffect(() => {
        if (agentOpen && !agentCanvasId) void ensureCanvas();
    }, [agentOpen, agentCanvasId, ensureCanvas]);

    // M3 编排器：派发槽位任务 → 轮询对账直至终态（详情接口本身会对账）。
    const handleStart = useCallback(async () => {
        if (!productId || !detail) return;
        // 阶段 0 修复（移植自 pr(1) use-commerce-workflow.ts:127,205 的 isAiConfigReady 守卫）：
        // 派发前强制校验生图模型「已选且可用」，杜绝无模型请求导致 7 张卡静默变红。
        const { resolveModelRequestConfig, modelOptionName } = await import("@/stores/use-config-store");
        if (!config.imageModel || !isAiConfigReady(config, config.imageModel)) {
            message.error("请先在右侧「生成配置」选择可用的生图模型，再开始生成");
            return;
        }
        setStarting(true);
        try {
            const requestConfig = resolveModelRequestConfig(config, config.imageModel);
            const bareModel = modelOptionName(config.imageModel);
            const started = await startEcommerceProduct(productId, {
                channelId: requestConfig.channelId,
                model: bareModel,
                size: "1:1",
                quality: "auto",
                sellingPoints: detail.product.sellingPoints || "",
                extraRequirements: detail.product.extraRequirements || "",
            });
            if (started.degraded?.length) message.warning(started.degraded.join("；"));
            message.success(`已派发 ${started.dispatched} 个槽位任务${started.failed ? `（失败 ${started.failed}）` : ""}`);
            // 轮询：详情接口隐式对账，终态后停止。
            const deadline = Date.now() + 15 * 60 * 1000;
            for (;;) {
                await refreshDetail(productId);
                const latest = useEcommerceWorkspaceStore.getState().detailById[productId];
                const status = latest?.product.status;
                if (!status || status === "completed" || status === "completed_with_warnings" || status === "failed" || status === "uncertain" || status === "paused") break;
                if (Date.now() > deadline) break;
                await new Promise((resolve) => setTimeout(resolve, 3000));
            }
            await refreshProducts();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "启动编排失败");
        } finally {
            setStarting(false);
        }
    }, [productId, detail, config, message, refreshDetail, refreshProducts]);

    if (!productId) {
        return (
            <section className="flex flex-1 items-center justify-center bg-surface">
                <Empty description="从左侧选择一个商品任务" />
            </section>
        );
    }
    if (loading && !detail) {
        return (
            <section className="flex flex-1 items-center justify-center bg-surface">
                <p className="text-sm text-foreground/55">正在读取商品详情…</p>
            </section>
        );
    }
    if (!detail) {
        return (
            <section className="flex flex-1 items-center justify-center bg-surface">
                <Empty description="商品不存在或已删除" />
            </section>
        );
    }
    const { product } = detail;
    const heroSlots = detail.slots.filter((slot) => slot.kind === "hero");
    const detailSlots = detail.slots.filter((slot) => slot.kind === "detail");

    return (
        <section className="flex flex-1 flex-col overflow-hidden bg-surface">
            {/* 面包屑 + 头部 */}
            <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-4">
                <div className="flex items-center gap-2 text-xs text-foreground/55">
                    <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={onBack}>
                        <ArrowLeft className="size-3.5" />
                        电商工坊
                    </button>
                    <span>/</span>
                    <span className="truncate text-foreground/75">{product.name}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <h2 className="truncate text-base font-semibold">{product.name}</h2>
                        <span className="shrink-0 rounded bg-foreground/10 px-2 py-0.5 text-xs text-foreground/70">
                            {ECOMMERCE_STATUS_LABELS[product.status] || product.status}
                        </span>
                        {product.round > 1 ? <span className="shrink-0 text-xs text-foreground/50">第 {product.round} 轮</span> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button size="small" icon={<History className="size-3.5" />} onClick={() => message.info("历史轮次切换施工中（M5）")}>
                            历史轮次
                        </Button>
                        <Button
                            size="small"
                            icon={<Bot className="size-3.5" />}
                            onClick={() => setAgentOpen(true)}
                        >
                            Agent 精修
                        </Button>
                        <Button
                            size="small"
                            type="primary"
                            icon={starting ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                            loading={starting}
                            onClick={() => void handleStart()}
                        >
                            {starting ? "编排生成中…" : "开始生成"}
                        </Button>
                        <Button
                            size="small"
                            icon={<Download className="size-3.5" />}
                            onClick={() => message.info("打包下载施工中（M5）")}
                        >
                            打包下载
                        </Button>
                    </div>
                </div>
                {product.errorMessage ? (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{product.errorMessage}</p>
                ) : null}
            </header>

            {/* 槽位网格 */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
                {detail.slots.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                        <p className="text-sm text-foreground/65">该商品还没有生成任何槽位</p>
                        <p className="text-xs text-foreground/50">点右上角「开始生成」：服务端会合成各槽位提示词（含负向词与商品主体强控）并派发生图任务</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6">
                        <SlotGroup title="主图" slots={heroSlots} emptyText="未配置主图槽位" />
                        <SlotGroup title="详情页" slots={detailSlots} emptyText="未配置详情页槽位" />
                        <TitlePanel detail={detail} />
                    </div>
                )}
            </div>

            {/* Agent 精修抽屉：复用电商工作台画布与 Cloud Agent 面板；阶段 0 注入商品上下文 */}
            <Drawer
                title="Agent 精修 · 电商工作台"
                open={agentOpen}
                onClose={() => setAgentOpen(false)}
                width={420}
                destroyOnHidden
            >
                <AgentWorkbenchPanel canvasId={agentCanvasId} canvasState={agentCanvasState} productCount={1} detail={detail} />
            </Drawer>
        </section>
    );
}

function SlotGroup({ title, slots, emptyText }: { title: string; slots: EcommerceProductDetail["slots"]; emptyText: string }) {
    if (slots.length === 0) {
        return (
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground/75">{title}</h3>
                <p className="text-xs text-foreground/50">{emptyText}</p>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground/75">
                {title} <span className="font-normal text-foreground/50">· {slots.length} 张</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {slots.map((slot) => (
                    <article key={slot.id} className="flex flex-col gap-2 rounded-lg border border-border/50 p-2.5">
                        <div className="relative aspect-square overflow-hidden rounded-md bg-surface-active">
                            {slot.resourceId ? (
                                <img src={`/api/resources/${slot.resourceId}/file`} alt={slot.title || slot.slotKey} className="size-full object-cover" />
                            ) : (
                                <div className="flex size-full items-center justify-center text-xs text-foreground/45">
                                    {ECOMMERCE_SLOT_STATUS_LABELS[slot.status] || slot.status}
                                </div>
                            )}
                            {slot.currentVersion > 0 ? (
                                <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">v{slot.currentVersion}</span>
                            ) : null}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <strong className="truncate text-xs">{slot.title || slot.slotKey}</strong>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${SLOT_STATUS_TONE[slot.status] || SLOT_STATUS_TONE.pending}`}>
                                {ECOMMERCE_SLOT_STATUS_LABELS[slot.status] || slot.status}
                            </span>
                        </div>
                        {slot.copy ? <p className="line-clamp-2 text-xs text-foreground/55">{slot.copy}</p> : null}
                    </article>
                ))}
            </div>
        </div>
    );
}

function TitlePanel({ detail }: { detail: EcommerceProductDetail }) {
    const { product } = detail;
    return (
        <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground/75">标题</h3>
            <div className="rounded-lg border border-border/50 p-3">
                <div className="flex items-center justify-between gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${SLOT_STATUS_TONE[product.titleStatus] || SLOT_STATUS_TONE.pending}`}>
                        {TITLE_STATUS_LABELS[product.titleStatus] || product.titleStatus}
                    </span>
                </div>
                {product.titleText ? <p className="mt-2 text-sm text-foreground/80">{product.titleText}</p> : null}
            </div>
        </div>
    );
}
