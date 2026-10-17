// 任务详情栏：面包屑 + 头部（名称/状态徽章/轮次）+ 槽位网格（主图/详情页分区）
// + 标题面板 + 底部打包下载/历史轮次入口。
// M2.6 补：接入 M3 编排器——「开始生成」派发槽位任务并轮询对账（不再是占位）；
//           接入电商 Agent 面板（原 agent-panel-adapter 为孤儿组件，现由「Agent 精修」抽屉挂载）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Drawer, Empty, Input } from "antd";
import { ArrowLeft, Bot, CopyPlus, Download, FileArchive, History, Loader2, Play, RotateCcw, Sparkles, Square } from "lucide-react";

import {
    ECOMMERCE_SLOT_STATUS_LABELS,
    ECOMMERCE_STATUS_LABELS,
    confirmEcommercePlan,
    getEcommerceProductDetail,
    startEcommerceProduct,
    startEcommercePlanning,
    applyEcommercePlan,
    duplicateEcommerceProduct,
    getEcommerceExportZip,
    getEcommercePlanResponse,
    retryEcommerceProducts,
    updateEcommercePlanResponse,
    updateEcommerceProduct,
    pauseEcommerceProduct,
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
    const { message, modal } = App.useApp();
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
    const [zipping, setZipping] = useState(false);
    const [duplicating, setDuplicating] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
    const ecommerceConfig = useEcommerceWorkspaceStore((state) => state.config);
    // Agent 精修抽屉：电商工作台画布按需创建，面板挂载后常开。
    const { canvasId: agentCanvasId, ensureCanvas, canvasState: agentCanvasState } = useEcommerceWorkbenchCanvas();
    const [agentOpen, setAgentOpen] = useState(false);

    useEffect(() => {
        if (agentOpen && !agentCanvasId) void ensureCanvas();
    }, [agentOpen, agentCanvasId, ensureCanvas]);

    // Agent 改稿（ecommerce_update_slot_prompt）后需要刷新详情，让左侧槽位卡实时反映。
    // 面板没有"回合结束"回调，故采用：打开即刷 + 打开期间轻量轮询 + 关闭再刷一次。
    useEffect(() => {
        if (!agentOpen || !productId) return;
        void refreshDetail(productId);
        const timer = window.setInterval(() => { void refreshDetail(productId); }, 6000);
        return () => {
            window.clearInterval(timer);
            void refreshDetail(productId);
        };
    }, [agentOpen, productId, refreshDetail]);

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
        // 未选模型直接拦截（draft 态确认还要用它合成方案，更不能静默失败）。
        if (!config.imageModel || !isAiConfigReady(config, config.imageModel)) {
            message.error("请先在右侧「生成配置」选择可用的生图模型，再开始生成");
            return;
        }
        setConfirming(true);
        try {
            const flushed = await useEcommerceWorkspaceStore.getState().flushConfig();
            if (!flushed) {
                message.error("配置保存失败，已中止派发（避免用旧模型生成）");
                return;
            }
            const { resolveModelRequestConfig, modelOptionName } = await import("@/stores/use-config-store");
            const requestConfig = resolveModelRequestConfig(config, config.imageModel);
            await confirmEcommercePlan(productId, {
                channelId: requestConfig.channelId,
                model: modelOptionName(config.imageModel),
            });
            message.success("已确认方案，开始派发生图任务");
            await refreshDetail(productId);
            await refreshProducts();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "确认方案失败");
        } finally {
            setConfirming(false);
        }
    }, [productId, config, isAiConfigReady, message, refreshDetail, refreshProducts]);

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

    // 打包下载 ZIP：服务端流式打包（目录规范 商品名/主图|详情页/NN_主题.ext）。
    const handleDownloadZip = useCallback(async () => {
        if (!detail) return;
        setZipping(true);
        try {
            const blob = await getEcommerceExportZip(detail.product.id);
            downloadBlob(blob, `${detail.product.name || "电商工坊"}.zip`);
            message.success("已打包下载（含主图/详情页/标题/清单）");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "打包下载失败");
        } finally {
            setZipping(false);
        }
    }, [detail, message]);

    // 复制任务：只复制元信息，不带历史，status=draft。
    const handleDuplicate = useCallback(async () => {
        if (!productId) return;
        setDuplicating(true);
        try {
            await duplicateEcommerceProduct(productId);
            await refreshProducts();
            message.success("已创建副本任务（未开始，可单独配置后生成）");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "复制任务失败");
        } finally {
            setDuplicating(false);
        }
    }, [productId, message, refreshProducts]);

    // 从头重试：round+1，收费确认不可绕过。
    const handleRetry = useCallback(() => {
        if (!productId) return;
        modal.confirm({
            title: "从头重试该商品任务？",
            content: "将开启新一轮（round + 1）并重新派发全部槽位，已完成的图会保留但会再次计费。运行中或结果待确认的任务不允许重试。",
            okText: "确认重试（可能收费）",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    const result = await retryEcommerceProducts([productId]);
                    const refused = Object.values(result.refused || {});
                    if (refused.length) message.warning(refused.join("；"));
                    else message.success("已开启新一轮，请重新点「开始生成」派发");
                    await refreshDetail(productId);
                    await refreshProducts();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "重试失败");
                }
            },
        });
    }, [productId, modal, message, refreshDetail, refreshProducts]);

    // 查看/修正原始策划响应：GET 拉原文 → 编辑 → PUT 本地校验编译（不调模型）。
    const handleOpenPlanResponse = useCallback(async () => {
        if (!productId) return;
        try {
            const view = await getEcommercePlanResponse(productId);
            let draft = view.raw || "";
            modal.confirm({
                title: "查看 / 修正原始响应",
                width: 780,
                content: (
                    <div className="flex flex-col gap-2">
                        {view.validationError ? (
                            <p className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
                                上次校验失败：{view.validationError}
                            </p>
                        ) : null}
                        <p className="text-xs text-foreground/55">
                            期望 {view.screenCount} 屏。修正后点「校验并应用」：服务端本地校验 + 编译回写各屏，不调用模型、不扣费。
                        </p>
                        <Input.TextArea
                            defaultValue={draft}
                            rows={18}
                            onChange={(event) => { draft = event.target.value; }}
                            placeholder="粘贴或修改策划 JSON（含 productAnalysis / styleAnalysis / visualSystem / screens）"
                        />
                    </div>
                ),
                okText: "校验并应用",
                cancelText: "取消",
                onOk: async () => {
                    try {
                        await updateEcommercePlanResponse(productId, draft);
                        await refreshDetail(productId);
                        await refreshProducts();
                        message.success("已校验并写入各屏");
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "校验失败，方案未写入");
                    }
                },
            });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取原始响应失败");
        }
    }, [productId, modal, message, refreshDetail, refreshProducts]);

    // 阶段 4：Agent 改稿反馈 —— 轮询检测到槽位标题/文案变化时弹出提示并高亮。
    const [agentChangedSlots, setAgentChangedSlots] = useState<Record<string, number>>({});
    useEffect(() => {
        if (!agentOpen || !detail) return;
        setAgentChangedSlots((previous) => {
            const next: Record<string, number> = { ...previous };
            for (const slot of detail.slots) {
                const stamp = slot.updatedAt ? Date.parse(slot.updatedAt) : 0;
                const known = previous[slot.slotKey];
                if (known !== undefined && stamp > known) {
                    message.success(`Agent 已更新【${slot.title || slot.slotKey}】的参数与文案`);
                    next[slot.slotKey] = stamp;
                } else if (known === undefined) {
                    next[slot.slotKey] = stamp;
                }
            }
            return next;
        });
    }, [agentOpen, detail, message]);

    // 阶段 4：实时进度（running / planning）。槽位失败时直接显示 errorMessage，
    // 不再让失败的一直假装"排队中"。
    const progress = useMemo(() => {
        const slots = detail?.slots ?? [];
        const total = slots.length;
        const done = slots.filter((slot) => slot.status === "completed").length;
        const failed = slots.filter((slot) => slot.status === "failed");
        const active = slots.find((slot) => slot.status === "running" || slot.status === "refining");
        const queued = slots.filter((slot) => slot.status === "queued" || slot.status === "draft").length;
        const percent = total === 0 ? 0 : Math.round((done / total) * 100);
        let text = "";
        if (planning) {
            text = "AI 策划中：等待模型返回 7 屏方案…";
        } else if (active) {
            text = `正在生成：${active.title || active.slotKey}（已完成 ${done}/${total} · 排队 ${queued} 屏）`;
        } else if (failed.length > 0) {
            text = `部分失败：${failed.map((slot) => slot.title || slot.slotKey).join("、")}（可点「编辑」单屏重试）`;
        } else if (done === total && total > 0) {
            text = `全部完成 ${done}/${total}`;
        } else {
            text = `排队中 ${queued} 屏 · 已完成 ${done}/${total}`;
        }
        return { total, done, percent, text, active, failed };
    }, [detail, planning]);
    const progressText = progress.text;
    const progressPercent = progress.percent;
    // Agent 改稿高亮集合（60 秒后自动淡出）。
    const agentHighlight = useMemo(() => {
        const now = Date.now();
        const marked = new Set<string>();
        for (const [key, stamp] of Object.entries(agentChangedSlots)) {
            if (now - stamp < 60_000) marked.add(key);
        }
        return marked;
    }, [agentChangedSlots, Date.now()]);

    // 第 1 步引导区：商品信息快捷编辑（失焦即存）。
    const saveProductField = useCallback(async (field: "name" | "sellingPoints" | "extraRequirements", value: string) => {
        if (!productId || !detail) return;
        const next = detail.product;
        const patch: Record<string, string> = {};
        if (field === "name") patch.name = value;
        if (field === "sellingPoints") patch.sellingPoints = value;
        if (field === "extraRequirements") patch.extraRequirements = value;
        // 未变化不发请求，避免失焦抖动。
        const current = field === "name" ? next.name : field === "sellingPoints" ? next.sellingPoints : next.extraRequirements;
        if (current === value) return;
        try {
            await updateEcommerceProduct(productId, patch);
            await refreshDetail(productId);
            message.success("已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    }, [productId, detail, message, refreshDetail]);

    // 停止生成：中止在途槽位并退回可编辑态。
    const handleStop = useCallback(async () => {
        if (!productId) return;
        setStopping(true);
        try {
            await pauseEcommerceProduct(productId);
            await refreshDetail(productId);
            await refreshProducts();
            message.success("已停止生成，可修改参数后重新开始");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "停止失败");
        } finally {
            setStopping(false);
        }
    }, [productId, message, refreshDetail, refreshProducts]);

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
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <h2 className="truncate text-base font-semibold">{product.name}</h2>
                        <span className="shrink-0 rounded bg-foreground/10 px-2 py-0.5 text-xs text-foreground/70">
                            {ECOMMERCE_STATUS_LABELS[product.status] || product.status}
                        </span>
                        {product.round > 1 ? <span className="shrink-0 text-xs text-foreground/50">第 {product.round} 轮</span> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
                            icon={<FileArchive className="size-3.5" />}
                            loading={zipping}
                            disabled={detail.slots.every((slot) => slot.status !== "completed")}
                            onClick={() => void handleDownloadZip()}
                        >
                            打包下载 ZIP
                        </Button>
                        <Button
                            size="small"
                            icon={<CopyPlus className="size-3.5" />}
                            loading={duplicating}
                            onClick={() => void handleDuplicate()}
                        >
                            复制任务
                        </Button>
                        <Button
                            size="small"
                            icon={<RotateCcw className="size-3.5" />}
                            onClick={() => void handleRetry()}
                        >
                            从头重试
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

            {/* 阶段 4：第 1 步引导区 —— 上传后先配置文案，再确认生图 */}
            {product.status === "draft" || product.status === "review" ? (
                <div className="flex flex-col gap-3 border-b border-border/60 bg-surface px-5 py-3">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground/80">
                        <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-primary">1</span>
                        商品信息与 AI / Agent 策划
                        <span className="font-normal text-foreground/45">（改完自动保存；确认参数后才会开始生图计费）</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-foreground/55">商品名称</span>
                            <Input
                                size="small"
                                defaultValue={product.name}
                                onBlur={(event) => void saveProductField("name", event.target.value)}
                                placeholder="例如：云感深睡被"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-foreground/55">核心卖点</span>
                            <Input
                                size="small"
                                defaultValue={product.sellingPoints || ""}
                                onBlur={(event) => void saveProductField("sellingPoints", event.target.value)}
                                placeholder="例如：抗菌 · 可水洗"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-[11px] text-foreground/55">附加要求</span>
                            <Input
                                size="small"
                                defaultValue={product.extraRequirements || ""}
                                onBlur={(event) => void saveProductField("extraRequirements", event.target.value)}
                                placeholder="例如：床品场景，暖光"
                            />
                        </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            size="small"
                            icon={<Sparkles className="size-3.5" />}
                            loading={planning}
                            onClick={() => void handleAiPlan()}
                        >
                            AI 一键生成各屏文案/提示词
                        </Button>
                        <Button
                            size="small"
                            icon={<Bot className="size-3.5" />}
                            onClick={() => { setAgentOpen(true); }}
                        >
                            打开 Agent 对话精修各模块
                        </Button>
                        <Button
                            size="small"
                            type="primary"
                            icon={<Play className="size-3.5" />}
                            loading={confirming}
                            onClick={() => void handleConfirmPlan()}
                        >
                            确认各屏参数并开始生图
                        </Button>
                    </div>
                </div>
            ) : null}

            {/* 阶段 4：实时进度（running / planning） */}
            {product.status === "running" || planning ? (
                <div className="flex flex-col gap-2 border-b border-primary/25 bg-primary/5 px-5 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-foreground/75">{progressText}</span>
                        <Button
                            size="small"
                            danger
                            icon={<Square className="size-3.5" />}
                            loading={stopping}
                            onClick={() => void handleStop()}
                        >
                            停止生成
                        </Button>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
                        <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${progressPercent}%` }}
                        />
                    </div>
                </div>
            ) : null}

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

            {/* 阶段 3：策划失败/待确认时的手工兜底入口 */}
            {product.status === "review" || product.status === "failed" ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-surface px-5 py-2">
                    <span className="text-xs text-foreground/55">
                        {product.status === "failed"
                            ? "策划或出图失败：可打开原始响应手工修正后重新应用（本地校验，不调模型、不扣费）"
                            : "可打开原始策划 JSON 手工微调后重新应用（不调模型、不扣费）"}
                    </span>
                    <Button size="small" onClick={() => void handleOpenPlanResponse()}>
                        查看 / 修正原始响应
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
                        <SlotGroup title="主图" slots={heroSlots} emptyText="未配置主图槽位" onEdit={setEditingSlotId} highlighted={agentHighlight} />
                        <SlotGroup title="详情页" slots={detailSlots} emptyText="未配置详情页槽位" onEdit={setEditingSlotId} highlighted={agentHighlight} />
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

function SlotGroup({ title, slots, emptyText, onEdit, highlighted }: { title: string; slots: EcommerceProductDetail["slots"]; emptyText: string; onEdit: (slotId: string) => void; highlighted?: Set<string> }) {
    const marked = highlighted ?? new Set<string>();
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
                    <article
                        key={slot.id}
                        className={`flex flex-col gap-2 rounded-lg border p-2.5 ${marked.has(slot.slotKey) ? "border-primary/60 bg-primary/5" : "border-border/50"}`}
                    >
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
                            {marked.has(slot.slotKey) ? (
                                <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-xs text-white">Agent 已改</span>
                            ) : null}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <strong className="truncate text-xs">{slot.title || slot.slotKey}</strong>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${SLOT_STATUS_TONE[slot.status] || SLOT_STATUS_TONE.pending}`}>
                                {ECOMMERCE_SLOT_STATUS_LABELS[slot.status] || slot.status}
                            </span>
                        </div>
                        {/* 阶段 4：失败原因直接展示，不再假装排队中 */}
                        {slot.status === "failed" && slot.errorMessage ? (
                            <p className="line-clamp-3 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">{slot.errorMessage}</p>
                        ) : null}
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
