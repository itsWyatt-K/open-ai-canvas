// 任务详情栏：三步向导式工作台（阶段 5 小白向重构 + 返工）。
//   第一步：选择上架平台（6 大平台规范卡，一键切换整套框定）——可折叠为紧凑摘要条
//   第二步：商品卖点与风格引导（AI 看图提炼 / AI 顾问对话）——可折叠为紧凑摘要条
//   第三步：各屏图文分镜预览与确认生图（分镜脚本卡 + 唯一大按钮）——占据剩余全部高度
// 主内容区统一由外层容器纵向滚动；步骤 1/2 折叠后不再挤压分镜卡。
// 顶栏只保留纯工具按钮（历史轮次/复制/重试/下载）；编排动作全部收进向导动线。
// M3 编排器：确认方案 → 服务端按容量派发 → 轮询对账；Agent 面板为悬浮直挂（无 Drawer 空壳）。
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, Button, Empty, Input } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import {
    ArrowLeft, ChevronDown, ChevronUp, CopyPlus, Download, FileArchive, History, MessageCircle,
    Pencil, RotateCcw, Rocket, Settings2, Square, Wand2, Zap,
} from "lucide-react";

import {
    ECOMMERCE_SLOT_STATUS_LABELS,
    ECOMMERCE_STATUS_LABELS,
    applyEcommercePlatform,
    confirmEcommercePlan,
    duplicateEcommerceProduct,
    getEcommerceExportZip,
    getEcommercePlanResponse,
    regenerateEcommerceSlot,
    retryEcommerceProducts,
    saveEcommerceSlotPrompt,
    startEcommercePlanning,
    applyEcommercePlan,
    updateEcommercePlanResponse,
    updateEcommerceProduct,
    pauseEcommerceProduct,
    type EcommerceProductDetail,
    type EcommerceSlotPromptBody,
} from "@/services/api/ecommerce";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";
import { useConfigStore } from "@/stores/use-config-store";
import { AgentWorkbenchPanel, useEcommerceWorkbenchCanvas } from "./agent-panel-adapter";
import { EcommerceSlotEditorDialog } from "./slot-editor-dialog";
import { downloadBlob, mergeSlotImagesToLongImage } from "./long-image";
import { resourceFileUrl } from "@/services/api/resources";
import { queryGenerationTask } from "@/services/api/task-center";
import {
    ECOMMERCE_PLATFORMS, STYLE_CAPSULES, platformByKey, platformSpecOrDefault, platformSpecSummary,
} from "./platforms";

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

/** 平台可切换的商品状态（draft/review：未派发，后端才会按平台模板重建槽位）。 */
/**
 * 平台切换可用性：生成中（running/queued）禁止切换（会打断在途任务）；
 * draft/review 直接切；completed/failed 允许但由调用方二次确认。
 */
function platformSwitchable(status: string): boolean {
    return status !== "running" && status !== "queued";
}

export function EcommerceTaskDetail({
    productId, onBack, onOpenConfig,
}: {
    productId: string | null;
    onBack: () => void;
    /** 展开右侧「模型与高级设置」（失败条上的「切换生图模型」用）。 */
    onOpenConfig?: () => void;
}) {
    const { message, modal } = App.useApp();
    const detail = useEcommerceWorkspaceStore((state) => (productId ? state.detailById[productId] : undefined));
    const loading = useEcommerceWorkspaceStore((state) => state.detailLoading);
    const refreshDetail = useEcommerceWorkspaceStore((state) => state.refreshDetail);
    const refreshProducts = useEcommerceWorkspaceStore((state) => state.refreshProducts);
    const refreshConfig = useEcommerceWorkspaceStore((state) => state.refreshConfig);
    const config = useConfigStore((state) => state.config);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const [confirming, setConfirming] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [planning, setPlanning] = useState(false);
    const [zipping, setZipping] = useState(false);
    const [duplicating, setDuplicating] = useState(false);
    const [stopping, setStopping] = useState(false);
    const [switchingPlatform, setSwitchingPlatform] = useState(false);
    const [retryingFailed, setRetryingFailed] = useState(false);
    const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
    const [generatingSlotId, setGeneratingSlotId] = useState<string | null>(null);
    // 阶段 5 返工：第 1/2 步可折叠（默认收起为紧凑摘要条），把屏幕高度让给第 3 步分镜卡。
    // 收起/展开的默认值按任务状态决定：已生成方案 / 生成中 / 失败 / 完成态一律默认折叠；
    // 仅「全新 draft（还没任何方案）」才展开，让第一次上手的小白看到向导动线。
    const [stepOpen, setStepOpen] = useState({ platform: false, product: false });
    const stepInitRef = useRef<string | null>(null);
    useEffect(() => {
        if (!productId || !detail) return;
        if (stepInitRef.current === productId) return;
        stepInitRef.current = productId;
        const status = detail.product.status;
        const settled = status !== "draft" && status !== "review";
        const hasPlan = detail.slots.some((slot) => Boolean(slot.generationPrompt || slot.promptOverride));
        setStepOpen(settled || hasPlan
            ? { platform: false, product: false }
            : { platform: true, product: !detail.product.sellingPoints });
    }, [productId, detail]);
    const ecommerceConfig = useEcommerceWorkspaceStore((state) => state.config);
    // Agent 精修：悬浮面板直挂（阶段 5 移除空壳 Drawer）；advisor 模式打开即自动提交。
    const { canvasId: agentCanvasId, ensureCanvas, canvasState: agentCanvasState } = useEcommerceWorkbenchCanvas();
    const [agentOpen, setAgentOpen] = useState(false);
    const [advisorMode, setAdvisorMode] = useState(false);

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

    // 阶段 1：确认整组方案（先审方案）→ 服务端派发所有待生成槽位。
    // 后端守卫：若该商品还没跑过 AI 视觉策划，服务端会先用策划模型同步跑一次
    // 12 段策划再派发，所以这里必须把策划模型口径一并传下去。
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
            // 策划模型：优先配置栏里的策划模型，回落到当前文本模型。
            const plannerModel = ecommerceConfig?.plannerModelId || config.textModel;
            const plannerReady = Boolean(plannerModel) && isAiConfigReady(config, plannerModel);
            const plannerConfig = plannerReady ? resolveModelRequestConfig(config, plannerModel) : undefined;
            await confirmEcommercePlan(productId, {
                channelId: requestConfig.channelId,
                model: modelOptionName(config.imageModel),
                plannerChannelId: plannerConfig?.channelId,
                plannerModel: plannerReady ? modelOptionName(plannerModel) : undefined,
            });
            message.success("已确认方案，开始派发生图任务");
            await refreshDetail(productId);
            await refreshProducts();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "确认方案失败");
        } finally {
            setConfirming(false);
        }
    }, [productId, config, ecommerceConfig?.plannerModelId, isAiConfigReady, message, refreshDetail, refreshProducts]);

    // 阶段 5 返工：单屏重派发必须显式带「渠道 + 模型」——与确认整组方案同一口径。
    // 老商品没有派发快照时，不带参数就只能由后端报「请先选择生图模型与渠道」。
    const requestSlotRegenerate = useCallback(
        async (slotId: string, patch: EcommerceSlotPromptBody = {}) => {
            if (!config.imageModel || !isAiConfigReady(config, config.imageModel)) {
                throw new Error("请先在右侧「生成配置」选择可用的生图模型，再重新生成");
            }
            const { resolveModelRequestConfig, modelOptionName } = await import("@/stores/use-config-store");
            const requestConfig = resolveModelRequestConfig(config, config.imageModel);
            return regenerateEcommerceSlot(slotId, patch, {
                channelId: requestConfig.channelId,
                model: modelOptionName(config.imageModel),
            });
        },
        [config, isAiConfigReady],
    );

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

    // AI 策划轨：派发视觉文本策划 → 轮询结果 → 服务端容错编译回写各屏。
    // 阶段 5：卖点为空也能触发（后端让视觉模型看图提炼并回填 sellingPoints）。
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
                    // 阶段 5：任务结果是 {"mode":"text","text":"..."} 包装体，先解包再编译。
                    const { unwrapPlanText } = await import("./pr/commerce-detail-plan");
                    const raw = unwrapPlanText(task.textDraft || task.resultJson || "");
                    await applyEcommercePlan(productId, raw);
                    await refreshDetail(productId);
                    await refreshProducts();
                    message.success("策划已编译并写入各屏（结构不完整会智能兜底，不会中断流程）");
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
                    else message.success("已开启新一轮，请重新确认方案派发");
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

    // 阶段 5：平台切换（三步向导第 1 步）——后端一次完成配置更新 + 槽位重建。
    // 已出图/失败态也允许切换，但必须二次确认：切平台会按新平台规范重建 7 屏槽位。
    const handleApplyPlatform = useCallback(async (key: string) => {
        if (!productId || !detail) return;
        if (!platformSwitchable(detail.product.status)) {
            message.warning("任务正在生成中，暂不能切换平台（可先停止生成，或复制任务后再试）");
            return;
        }
        const target = platformByKey(key);
        const settled = detail.product.status === "completed" || detail.product.status === "failed";
        if (settled) {
            const ok = await new Promise<boolean>((resolve) => {
                modal.confirm({
                    title: `切换到「${target?.name ?? key}」？`,
                    content: "该商品已有生成结果。切换平台会按新平台的主图/详情规格重建 7 屏槽位（已生成图片仍保留在历史版本里，不会被删除）。",
                    okText: "确认切换",
                    cancelText: "取消",
                    onOk: () => resolve(true),
                    onCancel: () => resolve(false),
                });
            });
            if (!ok) return;
        }
        setSwitchingPlatform(true);
        try {
            await applyEcommercePlatform(productId, key);
            await refreshDetail(productId);
            await refreshConfig();
            await refreshProducts();
            message.success(`已切换到「${target?.name ?? key}」，各屏模板已按平台规范重置`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "切换平台失败");
        } finally {
            setSwitchingPlatform(false);
        }
    }, [productId, detail, message, modal, refreshDetail, refreshConfig, refreshProducts]);

    // 阶段 5：风格胶囊 → 写入附加要求（失焦即存的口径：立即 PATCH）。
    const [activeCapsule, setActiveCapsule] = useState<string>("");
    const handleStyleCapsule = useCallback(async (capsuleKey: string, hint: string) => {
        if (!productId) return;
        const nextKey = activeCapsule === capsuleKey ? "" : capsuleKey;
        setActiveCapsule(nextKey);
        try {
            await updateEcommerceProduct(productId, { extraRequirements: nextKey ? hint : "" });
            await refreshDetail(productId);
            if (nextKey) message.success("已应用风格方向");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "应用风格失败");
        }
    }, [productId, activeCapsule, message, refreshDetail]);

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

    // 阶段 5：单屏「单独生成此屏」——收费确认后用库内现有参数派发（空补丁）。
    const handleGenerateSlot = useCallback((slot: EcommerceProductDetail["slots"][number]) => {
        if (!productId) return;
        modal.confirm({
            title: `确认重新生成「${slot.title || slot.slotKey}」？`,
            content: "将按该屏当前参数提交 1 个生图任务并计入版本号；失败项不会自动重复扣费。",
            okText: "确认生成",
            cancelText: "取消",
            onOk: async () => {
                setGeneratingSlotId(slot.id);
                try {
                    await requestSlotRegenerate(slot.id);
                    message.success("已提交该屏生成任务");
                    await refreshDetail(productId);
                    await refreshProducts();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "生成任务提交失败");
                } finally {
                    setGeneratingSlotId(null);
                }
            },
        });
    }, [productId, modal, message, refreshDetail, refreshProducts, requestSlotRegenerate]);

    // 阶段 5 返工：失败条上的「🔄 重新生成失败项」——只重派失败屏，逐屏计数与提示。
    const handleRegenerateFailed = useCallback(async (slots: EcommerceProductDetail["slots"]) => {
        if (!productId) return;
        const failed = slots.filter((slot) => slot.status === "failed");
        if (!failed.length) {
            message.info("当前没有失败的分镜");
            return;
        }
        setRetryingFailed(true);
        let ok = 0;
        const reasons: string[] = [];
        for (const slot of failed) {
            try {
                await requestSlotRegenerate(slot.id);
                ok += 1;
            } catch (error) {
                reasons.push(`${slot.title || slot.slotKey}：${error instanceof Error ? error.message : "提交失败"}`);
            }
        }
        setRetryingFailed(false);
        if (ok > 0) message.success(`已重新提交 ${ok} 屏生成任务`);
        if (reasons.length) message.error(`有 ${reasons.length} 屏提交失败：${reasons.join("；")}`);
        await refreshDetail(productId);
        await refreshProducts();
    }, [productId, message, refreshDetail, refreshProducts, requestSlotRegenerate]);

    // 阶段 5 返工：分镜卡上的文案快改（指针补丁：只发 copy 一个字段）。
    const handleSlotCopyBlur = useCallback(async (slotId: string, value: string, original: string) => {
        if (value === original) return;
        try {
            await saveEcommerceSlotPrompt(slotId, { copy: value });
            await refreshDetail(productId!);
            message.success("已保存该屏文案");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存文案失败");
        }
    }, [productId, message, refreshDetail]);

    // 打开 Agent：refine（只预填）/ advisor（预填后自动提交，AI 主动给建议）。
    const openAgent = useCallback((advisor: boolean) => {
        setAdvisorMode(advisor);
        setAgentOpen(true);
    }, []);

    // 阶段 5：实时进度。isRunning/isPlanning 只有 running/queued/planning 为真——
    // draft/review/failed 绝不允许假转圈（Bug 4）。
    const isRunning = detail?.product.status === "running" || detail?.product.status === "queued";
    const progress = useMemo(() => {
        const slots = detail?.slots ?? [];
        const total = slots.length;
        const done = slots.filter((slot) => slot.status === "completed").length;
        const failed = slots.filter((slot) => slot.status === "failed");
        const active = slots.find((slot) => slot.status === "running" || slot.status === "refining");
        // queued=已派发等子任务；draft/pending=方案已备、顺延等容量（阶段 4 容量修复）。
        const queued = slots.filter((slot) => slot.status === "queued" || slot.status === "draft" || slot.status === "pending").length;
        const percent = total === 0 ? 0 : Math.round((done / total) * 100);
        let text = "";
        if (planning) {
            text = "AI 策划中：等待模型返回分屏方案…";
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
    const platformSpec = platformSpecOrDefault(ecommerceConfig?.platform);
    const pendingScreenCount = detail.slots.filter((slot) => slot.status !== "completed").length;
    // 失败屏（失败条与「重新生成失败项」共用同一口径）。
    const failedSlots = detail.slots.filter((slot) => slot.status === "failed");
    // 首条具体失败原因（返工令 B：红色横幅必须直接告诉小白到底为什么没出来，而不是只说「有 N 屏失败」）。
    const firstFailedReason = failedSlots.find((slot) => slot.errorMessage)?.errorMessage;

    return (
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
            {/* 头部（阶段 5 返工：拆两行，保证商品名完整可读）：
                第一行 = 面包屑返回 + 完整商品名（不截断）+ 状态/平台/轮次标签；
                第二行 = 操作按钮组 + 「⚙️ 模型与尺寸设置」入口。 */}
            <header className="flex shrink-0 flex-col gap-3 border-b border-border/60 px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button type="button" className="flex shrink-0 items-center gap-1 text-xs text-foreground/55 hover:text-foreground" onClick={onBack}>
                        <ArrowLeft className="size-3.5" />
                        电商工坊
                    </button>
                    <span className="shrink-0 text-xs text-foreground/35">/</span>
                    <h2 className="min-w-0 break-words text-base font-semibold leading-6" title={product.name}>
                        {product.name}
                    </h2>
                    <span className="shrink-0 rounded bg-foreground/10 px-2 py-0.5 text-xs text-foreground/70">
                        {ECOMMERCE_STATUS_LABELS[product.status] || product.status}
                    </span>
                    <span className="shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">
                        {platformSpec.name}
                    </span>
                    {product.round > 1 ? <span className="shrink-0 text-xs text-foreground/50">第 {product.round} 轮</span> : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Button size="small" icon={<History className="size-3.5" />} onClick={() => message.info("历史轮次切换施工中（M5）")}>
                        历史轮次
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
                    <Button
                        size="small"
                        icon={<Settings2 className="size-3.5" />}
                        onClick={() => {
                            if (onOpenConfig) onOpenConfig();
                            else message.info("请点右上角「模型与尺寸设置」调整生图模型与尺寸");
                        }}
                    >
                        ⚙️ 模型与尺寸设置
                    </Button>
                </div>
                {product.errorMessage ? (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{product.errorMessage}</p>
                ) : null}
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="flex flex-col gap-4">
                    {/* 第一步：平台与规格（任何状态都保留可展开入口） */}
                    <StepSection
                        no={1}
                        title="平台与规格"
                        open={stepOpen.platform}
                        onToggle={() => setStepOpen((prev) => ({ ...prev, platform: !prev.platform }))}
                        summary={`当前：${platformSpec.name} · ${platformSpecSummary(platformSpec)}`}
                        action="点击切换"
                        hint="切换后自动套用该平台的主图/详情规格与视觉规范"
                    >
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                            {ECOMMERCE_PLATFORMS.map((spec) => {
                                const active = spec.key === platformSpec.key;
                                return (
                                    <button
                                        key={spec.key}
                                        type="button"
                                        disabled={switchingPlatform || !platformSwitchable(product.status)}
                                        onClick={() => void handleApplyPlatform(spec.key)}
                                        className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-primary bg-primary/5" : "border-border/50 hover:border-primary/40"}`}
                                    >
                                        <span className="flex w-full items-center justify-between gap-1">
                                            <strong className="truncate text-xs">{spec.name}</strong>
                                            {active ? <span className="shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] text-white">当前</span> : null}
                                        </span>
                                        <span className="text-[11px] text-foreground/55">{spec.tagline}</span>
                                        <span className="text-[10px] text-foreground/40">{platformSpecSummary(spec)}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </StepSection>

                    {/* 第二步：商品卖点与 AI 策划（任何状态都保留可展开入口） */}
                    <StepSection
                        no={2}
                        title="商品卖点与 AI 策划"
                        open={stepOpen.product}
                        onToggle={() => setStepOpen((prev) => ({ ...prev, product: !prev.product }))}
                        summary={
                            product.sellingPoints
                                ? `当前卖点：${product.sellingPoints}`
                                : "当前卖点：未填写（可让 AI 看图自动提炼）"
                        }
                        action="展开修改 / 重新 AI 策划"
                        hint="改完自动保存；不会写没关系，AI 看图帮你提炼"
                    >
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
                                    maxLength={500}
                                    onBlur={(event) => void saveProductField("sellingPoints", event.target.value)}
                                    placeholder="例如：抗菌 · 可水洗（最长 500 字；历史超长数据编译时会被自动截断）"
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
                        {/* 视觉风格快捷胶囊 */}
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] text-foreground/55">视觉风格：</span>
                            {STYLE_CAPSULES.map((capsule) => (
                                <button
                                    key={capsule.key}
                                    type="button"
                                    onClick={() => void handleStyleCapsule(capsule.key, capsule.hint)}
                                    className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${activeCapsule === capsule.key ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-foreground/65 hover:border-primary/40"}`}
                                >
                                    {capsule.label}
                                </button>
                            ))}
                        </div>
                        {/* 阶段 5 返工：只保留两个 AI 入口（原先三个按钮职责重叠、新手无法分辨） */}
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                size="small"
                                type="primary"
                                ghost
                                icon={<Wand2 className="size-3.5" />}
                                loading={planning}
                                className={!product.sellingPoints ? "animate-pulse ring-1 ring-primary/40" : ""}
                                onClick={() => void handleAiPlan()}
                            >
                                🪄 AI 一键生成 {detail.slots.length || 7} 屏方案
                            </Button>
                            <Button
                                size="small"
                                icon={<MessageCircle className="size-3.5" />}
                                onClick={() => openAgent(true)}
                            >
                                💬 召唤 AI 顾问对话改稿
                            </Button>
                        </div>
                    </StepSection>

                    {/* 实时进度（running / queued 顺延等容量 / planning） */}
                    {isRunning || planning ? (
                        <div className="flex flex-col gap-2 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3">
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

                    {/* 失败条（阶段 5 返工）：用中文人话讲清「哪几屏没出图、为什么」，
                        横幅直接带上首条具体失败原因，并给出两个一键动作。 */}
                    {failedSlots.length > 0 ? (
                        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                            <p className="text-xs leading-5 text-destructive">
                                {product.errorMessage
                                    ? product.errorMessage
                                    : firstFailedReason
                                        ? `有 ${failedSlots.length} 屏未生成成功（原因：${firstFailedReason}）`
                                        : `有 ${failedSlots.length} 屏未生成成功：${failedSlots.map((slot) => slot.title || slot.slotKey).join("、")}`}
                            </p>
                            {failedSlots.length > 1 && failedSlots.some((slot) => slot.errorMessage) ? (
                                <ul className="flex flex-col gap-0.5">
                                    {failedSlots.filter((slot) => slot.errorMessage).map((slot) => (
                                        <li key={slot.id} className="text-xs leading-5 text-destructive/90">
                                            {slot.title || slot.slotKey}：{slot.errorMessage}
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    size="small"
                                    danger
                                    icon={<ReloadOutlined />}
                                    loading={retryingFailed}
                                    onClick={() => void handleRegenerateFailed(detail.slots)}
                                >
                                    重新生成失败项
                                </Button>
                                <Button
                                    size="small"
                                    icon={<Settings2 className="size-3.5" />}
                                    onClick={() => {
                                        if (onOpenConfig) onOpenConfig();
                                        else message.info("请点右上角「模型与高级设置」切换生图模型");
                                    }}
                                >
                                    ⚙️ 切换生图模型
                                </Button>
                            </div>
                        </div>
                    ) : null}

                    {/* 第三步：各屏图文分镜预览与确认生图 */}
                    <section className="flex flex-col gap-3">
                        <div className="flex items-center gap-2 text-xs font-semibold text-foreground/80">
                            <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-primary">3</span>
                            各屏分镜预览
                            <span className="font-normal text-foreground/45">（未出图的屏显示分镜脚本卡，文案可点开直接改）</span>
                        </div>
                        {detail.slots.length === 0 ? (
                            <div className="flex flex-col items-center gap-2 py-16 text-center">
                                <p className="text-sm text-foreground/65">该商品还没有任何槽位</p>
                                <p className="text-xs text-foreground/50">切换上方平台或导入商品图后，系统会按平台规范预建各屏卡片</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                                {detail.slots.map((slot, index) => (
                                    <SlotCard
                                        key={slot.id}
                                        slot={slot}
                                        index={index}
                                        total={detail.slots.length}
                                        highlighted={agentHighlight.has(slot.slotKey)}
                                        generating={generatingSlotId === slot.id}
                                        onEdit={() => setEditingSlotId(slot.id)}
                                        onGenerate={() => handleGenerateSlot(slot)}
                                        onCopyBlur={(value) => handleSlotCopyBlur(slot.id, value, slot.copy || "")}
                                    />
                                ))}
                            </div>
                        )}
                    </section>

                    <TitlePanel detail={detail} />

                    {/* 高级入口（阶段 5 返工）：原始策划响应 JSON 收进折叠区，
                        普通用户不会看到；排障/工程用途才展开。 */}
                    <details className="rounded-lg border border-border/40 px-3 py-2">
                        <summary className="cursor-pointer text-xs text-foreground/45">
                            高级：查看 / 修正原始策划响应（JSON，本地校验不调模型）
                        </summary>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Button size="small" onClick={() => void handleOpenPlanResponse()}>
                                打开原始响应编辑器
                            </Button>
                            <span className="text-[11px] text-foreground/45">
                                仅排障用：修改后由服务端本地校验并编译回写各屏，不调用模型、不扣费。
                            </span>
                        </div>
                    </details>
                </div>
            </div>

            {/* 阶段 5 返工：确认大按钮移入独立固定底栏（不再是 sticky 悬浮拦腰遮挡分镜卡）。
                底栏是外层纵向 flex 的最后一个 shrink-0 子项，永远贴在可用高度最底部；
                主内容区独立纵向滚动，滚到底时卡片也不会被按钮盖住。 */}
            {product.status === "draft" || product.status === "review" ? (
                <div className="z-20 flex shrink-0 flex-col gap-1 border-t border-border/60 bg-surface px-6 py-3">
                    <Button
                        type="primary"
                        size="large"
                        block
                        icon={<Rocket className="size-4" />}
                        loading={confirming}
                        onClick={() => void handleConfirmPlan()}
                    >
                        🚀 确认以上 {detail.slots.length} 屏方案，立即开始生图
                    </Button>
                    <p className="text-center text-[11px] text-foreground/45">
                        点击后按当前平台规范派发生图任务（未确认前不产生任何生图费用）
                    </p>
                </div>
            ) : null}

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

            {/* Agent 精修：悬浮面板直挂（阶段 5 移除空壳 Drawer，open 由本组件控制） */}
            <AgentWorkbenchPanel
                canvasId={agentCanvasId}
                canvasState={agentCanvasState}
                productCount={1}
                detail={detail}
                open={agentOpen}
                onOpenChange={setAgentOpen}
                advisorMode={advisorMode}
            />
        </section>
    );
}

/**
 * 向导步骤容器（阶段 5 返工）：折叠态 = 一行紧凑摘要条（编号 + 标题 + 当前值 + 展开箭头），
 * 展开态才渲染正文。目的是把纵向空间优先留给第 3 步分镜卡（主人验收要求：
 * 主内容区统一外层滚动，第 1/2 步可折叠，第 3 步至少完整露出 2 行卡片）。
 */
function StepSection({
    no, title, hint, summary, action, open, onToggle, children,
}: {
    no: number;
    title: string;
    hint?: string;
    summary: string;
    /** 折叠态右侧的动作提示（如「点击切换」「展开修改 / 重新 AI 策划」）。 */
    action?: string;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}) {
    return (
        <section className="rounded-lg border border-border/50">
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
                aria-expanded={open}
            >
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs text-primary">{no}</span>
                <strong className="shrink-0 text-xs font-semibold text-foreground/80">{title}</strong>
                {open ? (
                    hint ? <span className="min-w-0 truncate text-[11px] font-normal text-foreground/45">（{hint}）</span> : null
                ) : (
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground/55">{summary}</span>
                )}
                {action ? (
                    <span className="ml-auto shrink-0 rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[11px] text-primary">
                        {action}
                    </span>
                ) : null}
                <span className={`shrink-0 text-foreground/45 ${action ? "" : "ml-auto"}`}>
                    {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </span>
            </button>
            {open ? <div className="flex flex-col gap-3 border-t border-border/40 px-3 py-3">{children}</div> : null}
        </section>
    );
}

/**
 * 槽位卡（阶段 5 明牌分镜脚本卡）：
 *   - 已出图 → 成品图卡（版本角标 / Agent 已改 / 失败原因）；
 *   - 未出图 → 分镜脚本卡：场景定位 + 可快改的画面文案 + 构图摘要 + 详细编辑/单独生成。
 */
function SlotCard({
    slot, index, total, highlighted, generating, onEdit, onGenerate, onCopyBlur,
}: {
    slot: EcommerceProductDetail["slots"][number];
    index: number;
    total: number;
    highlighted: boolean;
    generating: boolean;
    onEdit: () => void;
    onGenerate: () => void;
    onCopyBlur: (value: string) => void;
}) {
    const generated = Boolean(slot.resourceId);
    const promptLines = (slot.promptOverride || slot.generationPrompt || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3);
    const aspect = slot.aspectRatio || "1:1";
    return (
        <article
            className={`flex min-w-0 flex-col gap-2 overflow-hidden rounded-lg border p-2.5 ${highlighted ? "border-primary/60 bg-primary/5" : "border-border/50"}`}
        >
            {generated ? (
                <>
                    <div className="relative aspect-square overflow-hidden rounded-md bg-surface-active">
                        <img src={`/api/resources/${slot.resourceId}/file`} alt={slot.title || slot.slotKey} className="size-full object-cover" />
                        {slot.currentVersion > 0 ? (
                            <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">v{slot.currentVersion}</span>
                        ) : null}
                        {highlighted ? (
                            <span className="absolute left-1.5 top-1.5 rounded bg-primary px-1.5 py-0.5 text-xs text-white">Agent 已改</span>
                        ) : null}
                    </div>
                    {/* 已出图也要显示「屏标题 + 画面文案摘要」：否则用户只能看到
                        「1/7 详细编辑 单独生成此屏」，根本认不出这一屏讲什么。 */}
                    <div className="flex flex-col gap-1">
                        <div className="flex items-start justify-between gap-2">
                            <strong className="min-w-0 flex-1 truncate text-xs" title={slot.title || slot.slotKey}>
                                {slot.title || slot.slotKey}
                            </strong>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${SLOT_STATUS_TONE[slot.status] || SLOT_STATUS_TONE.pending}`}>
                                {ECOMMERCE_SLOT_STATUS_LABELS[slot.status] || slot.status}
                            </span>
                        </div>
                        <p className="line-clamp-2 whitespace-pre-wrap text-[11px] leading-4 text-foreground/55">
                            {slot.copy ? `📝 ${slot.copy}` : "📝 纯图屏：本屏无排版文案"}
                        </p>
                    </div>
                </>
            ) : (
                <div className="flex flex-col gap-1.5 rounded-md bg-surface-active/60 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                        <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] text-foreground/60">
                            [{slot.kind === "hero" ? "主图" : "详情页"} {slot.slotNo} · {aspect}]
                        </span>
                        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${SLOT_STATUS_TONE[slot.status] || SLOT_STATUS_TONE.pending}`}>
                            {ECOMMERCE_SLOT_STATUS_LABELS[slot.status] || slot.status}
                        </span>
                    </div>
                    <strong className="text-xs">{slot.title || slot.slotKey}</strong>
                    <p className="text-[11px] text-foreground/50">
                        🏷️ 场景定位：{slot.sceneType || "待定"}
                    </p>
                    <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] text-foreground/50">📝 画面排版文案：</span>
                        <Input.TextArea
                            key={`${slot.id}-${slot.updatedAt}`}
                            size="small"
                            autoSize={{ minRows: 1, maxRows: 4 }}
                            defaultValue={slot.copy || ""}
                            onBlur={(event) => onCopyBlur(event.target.value)}
                            placeholder="需要上图的文案；纯图屏留空"
                        />
                        {!slot.copy ? <span className="text-[10px] text-foreground/40">（当前为空 = 纯图无文字）</span> : null}
                    </div>
                    {promptLines.length > 0 ? (
                        <div className="flex flex-col gap-0.5">
                            <span className="text-[11px] text-foreground/50">🎨 画面构图简述：</span>
                            <p className="whitespace-pre-wrap rounded bg-background/60 px-2 py-1 text-[10px] leading-4 text-foreground/55">
                                {promptLines.join("\n")}
                            </p>
                        </div>
                    ) : null}
                </div>
            )}
            {/* 阶段 4：失败原因直接展示，不再假装排队中 */}
            {slot.status === "failed" && slot.errorMessage ? (
                <p className="rounded bg-destructive/10 px-2 py-1 text-xs leading-4 text-destructive">{slot.errorMessage}</p>
            ) : null}
            <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-foreground/40">{index + 1} / {total}</span>
                <div className="flex items-center gap-1">
                    <Button size="small" type="link" className="!h-auto !p-0 text-xs" icon={<Pencil className="size-3" />} onClick={onEdit}>
                        详细编辑
                    </Button>
                    <Button
                        size="small"
                        type="link"
                        className="!h-auto !p-0 text-xs"
                        icon={<Zap className="size-3" />}
                        loading={generating}
                        onClick={onGenerate}
                    >
                        单独生成此屏
                    </Button>
                </div>
            </div>
        </article>
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
