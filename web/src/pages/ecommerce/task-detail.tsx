// 任务详情栏：面包屑 + 头部（名称/状态徽章/轮次）+ 槽位网格（主图/详情页分区）
// + 标题面板 + 底部打包下载/历史轮次入口。
// M2.6 补：接入 M3 编排器——「开始生成」派发槽位任务并轮询对账（不再是占位）；
//           接入电商 Agent 面板（原 agent-panel-adapter 为孤儿组件，现由「Agent 精修」抽屉挂载）。
import { useCallback, useEffect, useState } from "react";
import { App, Button, Drawer, Empty } from "antd";
import { ArrowLeft, Bot, Download, History, Loader2, Play, Sparkles } from "lucide-react";

import {
    ECOMMERCE_SLOT_STATUS_LABELS,
    ECOMMERCE_STATUS_LABELS,
    confirmEcommercePlan,
    getEcommerceProductDetail,
    startEcommerceProduct,
    startEcommercePlanning,
    applyEcommercePlan,
    type EcommerceProductDetail,
} from "@/services/api/ecommerce";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";
import { useConfigStore } from "@/stores/use-config-store";
import { AgentWorkbenchPanel, useEcommerceWorkbenchCanvas } from "./agent-panel-adapter";
import { EcommerceSlotEditorDialog } from "./slot-editor-dialog";
import { downloadBlob, mergeSlotImagesToLongImage } from "./long-image";
import { resourceFileUrl } from "@/services/api/resources";
import { queryGenerationTask } from "@/services/api/task-center";

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
    const [confirming, setConfirming] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [planning, setPlanning] = useState(false);
    const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
    const ecommerceConfig = useEcommerceWorkspaceStore((state) => state.config);
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
            // 先 flush 在途配置保存：后端派发时冻结 ConfigSnapshotJSON，
            // 若此时 PUT /config 还没回来，会冻结到旧模型/旧 mode（假保存问题）。
            const flushed = await useEcommerceWorkspaceStore.getState().flushConfig();
            if (!flushed) {
                message.error("配置保存失败，已中止派发（避免用旧模型生成）");
                return;
            }
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

    // 阶段 1：确认整组方案（先审方案）→ 服务端派发所有待生成槽位。
    const handleConfirmPlan = useCallback(async () => {
        if (!productId) return;
        setConfirming(true);
        try {
            await confirmEcommercePlan(productId);
            message.success("已确认方案，开始派发生图任务");
            await refreshDetail(productId);
            await refreshProducts();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "确认方案失败");
        } finally {
            setConfirming(false);
        }
    }, [productId, message, refreshDetail, refreshProducts]);

    // 长图下载：按屏序取已完成槽位的资源，浏览器本地栅格化（不上传、不改动原图）。
    const handleDownloadLongImage = useCallback(async () => {
        if (!detail) return;
        const sources = detail.slots
            .filter((slot) => slot.resourceId)
            .map((slot) => ({ url: resourceFileUrl(slot.resourceId!), label: slot.title || slot.slotKey }));
        if (!sources.length) {
            message.warning("还没有已完成的成品图");
            return;
        }
        setDownloading(true);
        try {
            const blob = await mergeSlotImagesToLongImage(sources);
            downloadBlob(blob, `${detail.product.name || "详情页"}.png`);
            message.success(`已合并 ${sources.length} 屏并下载`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "长图合并失败");
        } finally {
            setDownloading(false);
        }
    }, [detail, message]);

    // AI 策划轨：派发视觉文本策划 → 轮询结果 → 服务端 12 段编译回写各屏。
    const handleAiPlan = useCallback(async () => {
        if (!productId || !detail) return;
        const { resolveModelRequestConfig, modelOptionName } = await import("@/stores/use-config-store");
        const plannerModel = detail.product ? (ecommerceConfig?.plannerModelId || config.textModel) : config.textModel;
        if (!plannerModel || !isAiConfigReady(config, plannerModel)) {
            message.error("请先在右侧「生成配置」选择可用的策划模型（需支持看图）");
            return;
        }
        setPlanning(true);
        try {
            const flushed = await useEcommerceWorkspaceStore.getState().flushConfig();
            if (!flushed) {
                message.error("配置保存失败，已中止策划");
                return;
            }
            const requestConfig = resolveModelRequestConfig(config, plannerModel);
            const started = await startEcommercePlanning(productId, {
                channelId: requestConfig.channelId,
                model: modelOptionName(plannerModel),
            });
            message.info(`已派发策划任务（${started.screens} 屏），等待模型返回…`);
            const deadline = Date.now() + 10 * 60 * 1000;
            for (;;) {
                await new Promise((resolve) => setTimeout(resolve, 3000));
                const task = await queryGenerationTask(started.taskId);
                if (task.status === "succeeded") {
                    const raw = task.textDraft || task.resultJson || "";
                    await applyEcommercePlan(productId, raw);
                    await refreshDetail(productId);
                    await refreshProducts();
                    message.success("策划已编译并写入各屏（结构不合格会被拒绝，不会半成品出图）");
                    return;
                }
                if (task.status === "failed" || task.status === "cancelled") {
                    message.error(task.error || "策划任务失败，可重试或改用模板合成");
                    return;
                }
                if (Date.now() > deadline) {
                    message.warning("策划仍在执行，请稍后到任务中心查看结果后手动应用");
                    return;
                }
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "AI 策划失败");
        } finally {
            setPlanning(false);
        }
    }, [productId, detail, ecommerceConfig?.plannerModelId, config, isAiConfigReady, message, refreshDetail, refreshProducts]);

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
                            icon={<Sparkles className="size-3.5" />}
                            loading={planning}
                            disabled={starting}
                            onClick={() => void handleAiPlan()}
                        >
                            AI 策划
                        </Button>
                        <Button
                            size="small"
                            icon={<Download className="size-3.5" />}
                            loading={downloading}
                            disabled={detail.slots.every((slot) => !slot.resourceId)}
                            onClick={() => void handleDownloadLongImage()}
                        >
                            下载长图
                        </Button>
                    </div>
                </div>
                {product.errorMessage ? (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{product.errorMessage}</p>
                ) : null}
            </header>

            {/* 阶段 1：先审方案审核横幅（商品停在 review，等确认后才派发生图） */}
            {product.status === "review" ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-3">
                    <div className="min-w-0 text-xs text-amber-700 dark:text-amber-300">
                        <strong className="font-semibold">待确认方案</strong>
                        <span className="ml-2 opacity-80">
                            已生成 {detail.slots.length} 屏方案（未派发生图任务，不计生图费用）。可点任意槽位「编辑」逐屏调整文案与提示词，确认后一次派发。
                        </span>
                    </div>
                    <Button
                        size="small"
                        type="primary"
                        loading={confirming}
                        onClick={() => void handleConfirmPlan()}
                    >
                        确认方案并开始生图
                    </Button>
                </div>
            ) : null}

            {/* 槽位网格 */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
                {detail.slots.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                        <p className="text-sm text-foreground/65">该商品还没有生成任何槽位</p>
                        <p className="text-xs text-foreground/50">点右上角「开始生成」：服务端会合成各槽位提示词（含负向词与商品主体强控）并派发生图任务</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6">
                        <SlotGroup title="主图" slots={heroSlots} emptyText="未配置主图槽位" onEdit={setEditingSlotId} />
                        <SlotGroup title="详情页" slots={detailSlots} emptyText="未配置详情页槽位" onEdit={setEditingSlotId} />
                        <TitlePanel detail={detail} />
                    </div>
                )}
            </div>

            {/* 阶段 1：单屏编辑器 */}
            {editingSlotId ? (
                <EcommerceSlotEditorDialog
                    slot={detail.slots.find((item) => item.id === editingSlotId)!}
                    index={detail.slots.findIndex((item) => item.id === editingSlotId)}
                    total={detail.slots.length}
                    onClose={() => setEditingSlotId(null)}
                    onNavigate={(direction) => {
                        const next = detail.slots[detail.slots.findIndex((item) => item.id === editingSlotId) + direction];
                        if (next) setEditingSlotId(next.id);
                    }}
                    onChanged={async () => {
                        await refreshDetail(productId);
                        await refreshProducts();
                    }}
                />
            ) : null}

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

function SlotGroup({ title, slots, emptyText, onEdit }: { title: string; slots: EcommerceProductDetail["slots"]; emptyText: string; onEdit: (slotId: string) => void }) {
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
                        <div className="flex items-center justify-between gap-2">
                            {slot.copy ? <p className="line-clamp-2 text-xs text-foreground/55">{slot.copy}</p> : <span />}
                            <Button size="small" type="link" className="!h-auto !p-0 text-xs" onClick={() => onEdit(slot.id)}>
                                编辑
                            </Button>
                        </div>
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
