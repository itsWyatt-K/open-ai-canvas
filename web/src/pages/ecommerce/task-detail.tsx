// 任务详情栏：紧凑双行头 + 7 屏分镜画廊（返工令三：首屏 100% 聚焦 3:4 海报卡）。
//   第一行 = 商品名（点击即改）+ 状态徽标 + 平台切换（紧凑下拉）+ 工具组（历史/导出/复制/重试/设置）；
//   第二行 = 商品资产条（原图 64×64 → 透明主体 64×64 + ✨ 分层精修台）+ 卖点行内快改
//            + 编排动作组（🎨 风格 / ✨ AI 策划 7 屏方案）；
//   画廊头 = 各屏分镜预览 + 编排主动作（⚡ 确认并开始生图 / 💬 AI 顾问改稿）；
//   画廊体 = 7 张 SlotCard 常驻（grid-cols-3 xl:grid-cols-4，首排顶边 ≤ 260px）。
// 纪律：任何按钮严禁 w-full 拉满主舞台行（常规/主操作 120~240px，w-auto px-4 py-2）；
//       detail.slots 为空时按平台规格在客户端补足占位卡（不落库），保证 7 屏骨架常驻。
// M3 编排器：确认方案 → 服务端按容量派发 → 轮询对账；Agent 面板为悬浮直挂（无 Drawer 空壳）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { App, Button, Dropdown, Input, Popover, Select } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import {
    ArrowLeft, CopyPlus, Download, FileArchive, History, MessageCircle,
    MoreHorizontal, Palette, RotateCcw, Rocket, Settings2, Square, Wand2,
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
    updateEcommerceSlotBrief,
    pauseEcommerceProduct,
    type EcommerceBriefBody,
    type EcommerceProductDetail,
    type EcommerceSlotKind,
    type EcommerceSlotPromptBody,
    type EcommerceSlotSummary,
} from "@/services/api/ecommerce";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";
import { useEcommerceStore } from "@/stores/canvas/use-ecommerce-store";
import { useConfigStore } from "@/stores/use-config-store";
import { AgentWorkbenchPanel, useEcommerceWorkbenchCanvas } from "./agent-panel-adapter";
import { EcommerceSlotEditorDialog } from "./slot-editor-dialog";
import { EcommerceRetouchDialog } from "./retouch-dialog";
import { ProductCutoutCard } from "./product-cutout-card";
import { SlotBriefPanel } from "./slot-card-brief-panel";
import { SlotMoreMenu } from "./slot-card-more-menu";
import { appendImageNodeToCanvas } from "./canvas-bridge";
import { stripMarkdown } from "@/lib/markdown-strip";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { downloadBlob, mergeSlotImagesToLongImage } from "./long-image";
import { resourceFileUrl } from "@/services/api/resources";
import { queryGenerationTask } from "@/services/api/task-center";
import {
    ECOMMERCE_PLATFORMS, STYLE_CAPSULES, platformByKey, platformSpecOrDefault, platformSpecSummary,
} from "./platforms";
import { slotPosterLayout, type SlotPosterDecoration, type SlotPosterPlatformSpec } from "./slot-poster-layouts";
import "./ecommerce.css";

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

/** 默认屏序职能标题（未跑 AI 策划时画框内的骨架文案）：按 kind + slotNo 推导。 */
const HERO_FUNCTION_TITLES = ["首屏视觉冲击", "核心卖点直击", "场景信任背书"];
const DETAIL_FUNCTION_TITLES = ["痛点强对比", "细节工艺放大", "规格结构清单", "品牌信任收尾"];

function slotFunctionTitle(kind: EcommerceSlotKind, slotNo: number): string {
    const table = kind === "hero" ? HERO_FUNCTION_TITLES : DETAIL_FUNCTION_TITLES;
    return table[slotNo - 1] ?? (kind === "hero" ? `主图 ${slotNo}` : `详情 ${slotNo}`);
}

/** 平台默认屏序（与后端 GeneralSlots 同构：3 主图 + 4 详情；slotKey 对齐后端命名）。 */
const DEFAULT_SLOT_PLAN: Array<{ kind: EcommerceSlotKind; slotNo: number; slotKey: string }> = [
    { kind: "hero", slotNo: 1, slotKey: "hero_main" },
    { kind: "hero", slotNo: 2, slotKey: "hero_benefit" },
    { kind: "hero", slotNo: 3, slotKey: "hero_scene" },
    { kind: "detail", slotNo: 1, slotKey: "detail_hero" },
    { kind: "detail", slotNo: 2, slotKey: "detail_macro" },
    { kind: "detail", slotNo: 3, slotKey: "detail_spec" },
    { kind: "detail", slotNo: 4, slotKey: "detail_package" },
];

/**
 * 7 屏骨架常驻（返工令三）：detail.slots 非空时原样返回；
 * 为空（刚导入 / 后端尚未预建）时按平台规格在客户端补足占位卡——只进 UI，不落库。
 */
function gallerySlotsOf(
    slots: EcommerceSlotSummary[],
    spec: { heroCount: number; detailCount: number },
): Array<EcommerceSlotSummary & { placeholder?: boolean }> {
    if (slots.length > 0) return slots;
    const plan = DEFAULT_SLOT_PLAN
        .filter((item) => (item.kind === "hero" ? item.slotNo <= spec.heroCount : item.slotNo <= spec.detailCount));
    return plan.map((item) => ({
        id: "",
        kind: item.kind,
        slotNo: item.slotNo,
        slotKey: item.slotKey,
        title: slotFunctionTitle(item.kind, item.slotNo),
        status: "pending",
        currentVersion: 0,
        updatedAt: "",
        placeholder: true,
    }));
}

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
    const navigate = useNavigate();
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
    // v60：图层精修台（已出图屏）。持有 slot 对象而非 id——slots 为空时可回退占位卡。
    const [retouchSlot, setRetouchSlot] = useState<EcommerceSlotSummary | null>(null);
    // 返工令一：商品透明主体（BiRefNet）——顶部资产卡提取，供精修台与七屏海报草图共用。
    const [productCutout, setProductCutout] = useState("");
    // 商品名行内快改（顶栏第一行，点击标题即改，失焦即存）。
    const [editingName, setEditingName] = useState(false);
    const [nameDraft, setNameDraft] = useState("");
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
        async (slotId: string, patch: EcommerceSlotPromptBody = {}, extra?: { styleReferenceResourceIds?: string[] }) => {
            if (!config.imageModel || !isAiConfigReady(config, config.imageModel)) {
                throw new Error("请先在右侧「生成配置」选择可用的生图模型，再重新生成");
            }
            const { resolveModelRequestConfig, modelOptionName } = await import("@/stores/use-config-store");
            const requestConfig = resolveModelRequestConfig(config, config.imageModel);
            return regenerateEcommerceSlot(slotId, patch, {
                channelId: requestConfig.channelId,
                model: modelOptionName(config.imageModel),
                ...extra,
            });
        },
        [config, isAiConfigReady],
    );

    // 草图→正式图闭环（返工令三）：精修台上手绘/排版的合成草图上传为资源后，
    // 以 style 垫图角色塞进该屏的重新生成——构图与文案布局跟着草图走。
    const handleGenerateFromSketch = useCallback(
        async (slotId: string, sketchResourceId: string) => {
            await requestSlotRegenerate(slotId, {}, { styleReferenceResourceIds: [sketchResourceId] });
        },
        [requestSlotRegenerate],
    );

    // 返工令四：成品图/原图一键送入「电商工作台」画布——画布对图片节点内置了
    // 创建编辑副本（垫图再创作）、画质增强、方向校正、下载、入素材库等全套工具，
    // 电商页不再重复造轮子，直接复用。
    const handleSendToCanvas = useCallback(
        async (resourceId: string, title: string) => {
            let canvasId = agentCanvasId;
            if (!canvasId) {
                await ensureCanvas();
                canvasId = useEcommerceStore.getState().workbenchCanvasId || "";
            }
            if (!canvasId) throw new Error("工作台画布创建失败，请稍后重试");
            await appendImageNodeToCanvas(canvasId, resourceId, title);
            message.success("已送入工作台画布：可用「创建编辑副本」垫图再创作");
            navigate(`/canvas/${canvasId}`);
        },
        [agentCanvasId, ensureCanvas, message, navigate],
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

    // 商品信息快捷编辑（失焦即存）：顶栏商品名 / 资产条卖点 / 风格浮层附加要求共用。
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

    // 商品名行内快改：点击标题进入 Input，失焦/回车即存，Esc 取消。
    const startEditName = useCallback(() => {
        if (!detail) return;
        setNameDraft(detail.product.name);
        setEditingName(true);
    }, [detail]);
    const commitEditName = useCallback(() => {
        setEditingName(false);
        const value = nameDraft.trim();
        if (value) void saveProductField("name", value);
    }, [nameDraft, saveProductField]);

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
            // 战役一：主按钮「⚡ 生成本屏」与次按钮「🔄 重绘」共用此派发动动，
            // 按是否已出图区分话术，避免未出图的屏也弹「重新生成」。
            title: `确认${slot.resourceId ? "重新生成" : "生成"}「${slot.title || slot.slotKey}」？`,
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

    // 战役一：分镜卡主标题原位快改（指针补丁：只发 title 一个字段，沿用现有 title 字段）。
    const handleSlotTitleBlur = useCallback(async (slotId: string, value: string, original: string) => {
        if (value === original) return;
        try {
            await saveEcommerceSlotPrompt(slotId, { title: value });
            await refreshDetail(productId!);
            message.success("已保存该屏标题");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存标题失败");
        }
    }, [productId, message, refreshDetail]);

    // v60：L1 人话企划保存（后端自动重编译 L2；ai_hint 触发确定性变体）。
    const handleBriefSave = useCallback(async (slotId: string, body: EcommerceBriefBody) => {
        try {
            await updateEcommerceSlotBrief(slotId, body);
            await refreshDetail(productId!);
            message.success(body.ai_hint ? "已生成新企划思路（底层提示词同步重编译）" : "企划已保存，底层提示词已重编译");
        } catch (error) {
            throw error instanceof Error ? error : new Error("企划保存失败");
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
                <WorkspaceState icon="tasks" title="还没有选择商品任务" description="从左侧选择一个商品任务，这里会显示它的各屏分镜与生成进度。" />
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
                <WorkspaceState kind="error" icon="error" title="商品不存在或已删除" description="它可能已被删除或清理，从左侧重新选择一个商品任务即可。" />
            </section>
        );
    }
    const { product } = detail;
    const platformSpec = platformSpecOrDefault(ecommerceConfig?.platform);
    // 失败屏（失败条与「重新生成失败项」共用同一口径）。
    const failedSlots = detail.slots.filter((slot) => slot.status === "failed");
    // 首条具体失败原因（返工令 B：红色横幅必须直接告诉小白到底为什么没出来，而不是只说「有 N 屏失败」）。
    const firstFailedReason = failedSlots.find((slot) => slot.errorMessage)?.errorMessage;
    // 7 屏骨架常驻：slots 为空（刚导入/未策划）时按平台规格在客户端补足占位卡，不落库。
    const gallerySlots = gallerySlotsOf(detail.slots, platformSpec);
    const screenCount = gallerySlots.length;

    return (
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
            {/* 第一行（顶栏紧凑化）：商品名（点击即改）+ 状态 + 平台切换下拉 + 工具组。
                按钮宽度铁律：一律 w-auto（120~240px 或图标钮），严禁 w-full 拉满主舞台行。 */}
            <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-border/60 px-4 py-1.5">
                <button type="button" className="flex h-7 w-8 shrink-0 items-center justify-center rounded text-foreground/55 hover:text-foreground" onClick={onBack} title="返回商品列表" aria-label="返回商品列表">
                    <ArrowLeft className="size-4" />
                </button>
                {editingName ? (
                    <Input
                        size="small"
                        autoFocus
                        className="!w-52"
                        value={nameDraft}
                        maxLength={60}
                        onChange={(event) => setNameDraft(event.target.value)}
                        onBlur={commitEditName}
                        onPressEnter={(event) => event.currentTarget.blur()}
                        onKeyDown={(event) => { if (event.key === "Escape") setEditingName(false); }}
                    />
                ) : (
                    <button
                        type="button"
                        className="ecommerce-product-name-button min-w-0 max-w-[220px] truncate text-base font-semibold hover:text-primary"
                        title={`${product.name}（点击改名）`}
                        onClick={startEditName}
                    >
                        {product.name}
                    </button>
                )}
                <span className="shrink-0 rounded bg-foreground/10 px-2 py-0.5 text-caption text-foreground/70">
                    {ECOMMERCE_STATUS_LABELS[product.status] || product.status}
                </span>
                {product.round > 1 ? <span className="shrink-0 text-caption text-foreground/50">第 {product.round} 轮</span> : null}
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    <span className="shrink-0 text-caption text-foreground/55">平台</span>
                    <Select
                        size="small"
                        className="w-[128px]"
                        value={platformSpec.key}
                        disabled={switchingPlatform || !platformSwitchable(product.status)}
                        onChange={(value) => void handleApplyPlatform(String(value))}
                        options={ECOMMERCE_PLATFORMS.map((spec) => ({ value: spec.key, label: spec.name }))}
                        optionRender={(option) => {
                            const spec = platformByKey(String(option.value ?? ""));
                            if (!spec) return option.label;
                            return (
                                <span className="flex flex-col gap-0.5 py-0.5">
                                    <span className="flex items-center justify-between gap-3">
                                        <strong className="text-xs">{spec.name}</strong>
                                        {spec.key === platformSpec.key ? <span className="shrink-0 rounded bg-primary/15 px-1 text-caption text-primary">当前</span> : null}
                                    </span>
                                    <span className="text-caption text-foreground/50">{spec.tagline} · {platformSpecSummary(spec)}</span>
                                </span>
                            );
                        }}
                    />
                    <span className="shrink-0 text-caption text-foreground/45" title={`${platformSpec.tagline}｜${platformSpec.rules}`}>
                        {platformSpecSummary(platformSpec)}
                    </span>
                    <Button size="small" className="!h-7 !w-auto" icon={<History className="size-3.5" />} onClick={() => message.info("历史轮次切换施工中（M5）")}>
                        历史
                    </Button>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                {
                                    key: "zip",
                                    icon: <FileArchive className="size-3.5" />,
                                    label: "打包下载 ZIP",
                                    disabled: detail.slots.every((slot) => slot.status !== "completed"),
                                },
                                {
                                    key: "long",
                                    icon: <Download className="size-3.5" />,
                                    label: "下载长图",
                                    disabled: detail.slots.every((slot) => !slot.resourceId),
                                },
                            ],
                            onClick: ({ key }) => {
                                if (key === "zip") void handleDownloadZip();
                                if (key === "long") void handleDownloadLongImage();
                            },
                        }}
                    >
                        <Button size="small" className="!h-7 !w-auto" icon={<Download className="size-3.5" />}>
                            导出 ▾
                        </Button>
                    </Dropdown>
                    {/* 返工令四-6：复制任务 / 从头重试 / 模型与尺寸设置原是 16px 纳米图标钮
                        （热区远小于 32×28），收进 ⋯ 下拉；History 保持可见。 */}
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        menu={{
                            items: [
                                {
                                    key: "duplicate",
                                    icon: <CopyPlus className="size-3.5" />,
                                    label: "复制任务",
                                    disabled: duplicating,
                                },
                                {
                                    key: "retry",
                                    icon: <RotateCcw className="size-3.5" />,
                                    label: "从头重试",
                                },
                                { type: "divider" },
                                {
                                    key: "settings",
                                    icon: <Settings2 className="size-3.5" />,
                                    label: "模型与尺寸设置",
                                },
                            ],
                            onClick: ({ key }) => {
                                if (key === "duplicate") void handleDuplicate();
                                if (key === "retry") void handleRetry();
                                if (key === "settings") {
                                    if (onOpenConfig) onOpenConfig();
                                    else message.info("请点右上角「模型与尺寸设置」调整生图模型与尺寸");
                                }
                            },
                        }}
                    >
                        <Button
                            size="small"
                            className="!h-7 !w-9"
                            icon={<MoreHorizontal className="size-4" />}
                            title="更多任务操作"
                            aria-label="更多任务操作"
                        />
                    </Dropdown>
                </div>
                {product.errorMessage ? (
                    <p className="!mb-0 w-full rounded bg-destructive/10 px-2 py-0.5 text-caption leading-4 text-destructive">{product.errorMessage}</p>
                ) : null}
            </header>

            {/* 第二行（顶栏紧凑化）：商品资产条 + 卖点行内快改 + 编排动作组。
                原「① 平台与规格 / ② 商品卖点」垂直手风琴长条在这里压成一行 78px 高的资产头。 */}
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-0.5">
                <ProductCutoutCard
                    sourceResourceId={product.sourceResourceId}
                    onCutout={setProductCutout}
                    onOpenRetouch={() => setRetouchSlot(gallerySlots[0] ?? null)}
                    onSendToCanvas={() => void handleSendToCanvas(product.sourceResourceId, product.name || "商品原图")}
                />
                <label className="flex min-w-[140px] flex-1 items-center gap-2">
                    <span className="shrink-0 text-caption text-foreground/55">卖点</span>
                    <Input
                        key={`${product.id}:${product.sellingPoints || ""}`}
                        size="small"
                        variant="borderless"
                        className="min-w-0 flex-1"
                        defaultValue={product.sellingPoints || ""}
                        maxLength={500}
                        placeholder="未填写，点击输入或点右侧 AI 提炼"
                        onBlur={(event) => void saveProductField("sellingPoints", event.target.value)}
                    />
                </label>
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {/* 视觉风格 / 附加要求：收进轻量浮层，不再占垂直长条 */}
                    <Popover
                        trigger="click"
                        placement="bottomRight"
                        content={
                            <div className="flex w-[280px] flex-col gap-2">
                                <span className="text-caption text-foreground/55">视觉风格（点选即存）</span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {STYLE_CAPSULES.map((capsule) => (
                                        <button
                                            key={capsule.key}
                                            type="button"
                                            onClick={() => void handleStyleCapsule(capsule.key, capsule.hint)}
                                            className={`rounded-full border px-2.5 py-1 text-caption transition-colors ${activeCapsule === capsule.key ? "border-primary bg-primary/10 text-primary" : "border-border/50 text-foreground/65 hover:border-primary/40"}`}
                                        >
                                            {capsule.label}
                                        </button>
                                    ))}
                                </div>
                                <label className="flex flex-col gap-1">
                                    <span className="text-caption text-foreground/55">附加要求</span>
                                    <Input
                                        size="small"
                                        defaultValue={product.extraRequirements || ""}
                                        placeholder="例如：床品场景，暖光"
                                        onBlur={(event) => void saveProductField("extraRequirements", event.target.value)}
                                    />
                                </label>
                            </div>
                        }
                    >
                        <Button size="small" className="!w-auto" icon={<Palette className="size-3.5" />}>
                            🎨 风格
                        </Button>
                    </Popover>
                    <Button
                        size="small"
                        type="primary"
                        ghost
                        className="!w-auto"
                        icon={<Wand2 className="size-3.5" />}
                        loading={planning}
                        onClick={() => void handleAiPlan()}
                    >
                        ✨ AI 策划 {screenCount} 屏方案
                    </Button>
                </div>
            </div>

            {/* 实时进度（running / queued 顺延等容量 / planning）：紧凑一条，不挤压画廊 */}
            {isRunning || planning ? (
                <div className="flex shrink-0 items-center gap-3 border-b border-border/60 px-4 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-caption text-foreground/75">{progressText}</span>
                    <div className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-foreground/10">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
                    </div>
                    <Button size="small" danger className="!w-auto" icon={<Square className="size-3.5" />} loading={stopping} onClick={() => void handleStop()}>
                        停止生成
                    </Button>
                </div>
            ) : null}

            {/* 失败提示（返工令三-1）：不再用大红墙霸屏——单行紧凑条，
                点「详情」才展开逐屏原因；排队顺延类问题永不出现于此。 */}
            {failedSlots.length > 0 ? (
                <div className="shrink-0 px-4 py-1.5">
                    <details className="group rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-1.5">
                        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-caption text-destructive">
                            <span className="font-medium">
                                {failedSlots.length} 屏未生成成功{firstFailedReason ? `（${stripMarkdown(firstFailedReason).slice(0, 60)}）` : ""}
                            </span>
                            <span className="ml-auto flex items-center gap-1.5">
                                <Button
                                    size="small"
                                    danger
                                    icon={<ReloadOutlined />}
                                    loading={retryingFailed}
                                    onClick={(event) => { event.preventDefault(); void handleRegenerateFailed(detail.slots); }}
                                >
                                    重试失败项
                                </Button>
                                <Button
                                    size="small"
                                    icon={<Settings2 className="size-3.5" />}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        if (onOpenConfig) onOpenConfig();
                                        else message.info("请点右上角「模型与高级设置」切换生图模型");
                                    }}
                                >
                                    换模型
                                </Button>
                                <span className="text-caption text-destructive/70 group-open:hidden">详情 ▾</span>
                            </span>
                        </summary>
                        {product.errorMessage ? <p className="!mb-0 mt-1.5 text-xs leading-5 text-destructive/90">{stripMarkdown(product.errorMessage)}</p> : null}
                        <ul className="mt-1 flex flex-col gap-0.5">
                            {failedSlots.filter((slot) => slot.errorMessage).map((slot) => (
                                <li key={slot.id} className="text-xs leading-5 text-destructive/85">
                                    {slot.title || slot.slotKey}：{stripMarkdown(slot.errorMessage)}
                                </li>
                            ))}
                        </ul>
                    </details>
                </div>
            ) : null}

            {/* 各屏分镜画廊：7 屏骨架常驻（grid-cols-3 xl:grid-cols-4），
                画廊自带滚动区，首排卡片顶边固定在 ≤ 260px，首屏 100% 聚焦 3:4 海报卡。 */}
            <div className="flex min-h-0 flex-1 flex-col px-4 pt-1">
                <div className="flex shrink-0 items-center gap-2 pb-0.5">
                    <span className="shrink-0 text-xs font-semibold text-foreground/80">各屏分镜预览</span>
                    <span className="hidden min-w-0 truncate text-caption text-foreground/45 xl:inline">（默认只看海报与标题；场景描述 / 锁主体 / AI 换思路在「场景企划」抽屉里）</span>
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        <Button size="small" type="text" className="!w-auto" icon={<MessageCircle className="size-3.5" />} onClick={() => openAgent(true)}>
                            💬 AI 顾问改稿
                        </Button>
                        {product.status === "draft" || product.status === "review" ? (
                            <Button
                                type="primary"
                                size="small"
                                className="!w-auto !px-4 !py-2"
                                icon={<Rocket className="size-3.5" />}
                                loading={confirming}
                                onClick={() => void handleConfirmPlan()}
                            >
                                ⚡ 确认并开始生图（{screenCount} 屏）
                            </Button>
                        ) : null}
                    </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto pb-3">
                    {/* yq-slot-card-virtual：视口外卡片懒渲染（content-visibility），
                        消除 7+ 屏长列表的滚动卡顿与截图超时（返工令要求实测 ≥7）。 */}
                    <div className="grid grid-cols-3 gap-4 xl:grid-cols-4">
                        {gallerySlots.map((slot, slotIndex) => (
                            <SlotCard
                                key={slot.slotKey || slot.id}
                                slot={slot}
                                slotIndex={slotIndex}
                                platformSpec={platformSpec}
                                highlighted={agentHighlight.has(slot.slotKey)}
                                generating={generatingSlotId === slot.id}
                                productCutoutUrl={productCutout}
                                onEdit={() => setEditingSlotId(slot.id)}
                                onGenerate={() => handleGenerateSlot(slot)}
                                onTitleBlur={(value) => void handleSlotTitleBlur(slot.id, value, slot.title || "")}
                                onCopyBlur={(value) => handleSlotCopyBlur(slot.id, value, slot.copy || "")}
                                onBriefSave={(body) => handleBriefSave(slot.id, body)}
                                onRetouch={() => setRetouchSlot(slot)}
                                onSendToCanvas={() => void handleSendToCanvas(slot.resourceId!, slot.title || `${slot.slotKey} 成品图`)}
                            />
                        ))}
                    </div>
                    <div className="mt-4">
                        <TitlePanel detail={detail} />
                    </div>
                    {/* 高级入口（阶段 5 返工）：原始策划响应 JSON 收进折叠区，
                        普通用户不会看到；排障/工程用途才展开。 */}
                    <details className="mt-3 rounded-lg border border-border/40 px-3 py-2">
                        <summary className="cursor-pointer text-xs text-foreground/45">
                            高级：查看 / 修正原始策划响应（JSON，本地校验不调模型）
                        </summary>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Button size="small" onClick={() => void handleOpenPlanResponse()}>
                                打开原始响应编辑器
                            </Button>
                            <span className="text-caption text-foreground/45">
                                仅排障用：修改后由服务端本地校验并编译回写各屏，不调用模型、不扣费。
                            </span>
                        </div>
                    </details>
                </div>
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

            {/* v60/返工令一：图层精修台（全天候——未出图也能进：透明主体+文字层+渐变底草图）。
                slots 为空时回退占位卡（gallerySlots[0]），保证精修台随时可入。 */}
            {retouchSlot ? (
                <EcommerceRetouchDialog
                    slot={retouchSlot}
                    productSourceResourceId={product.sourceResourceId}
                    productCutoutUrl={productCutout}
                    onGenerateFromSketch={(sketchResourceId) => handleGenerateFromSketch(retouchSlot.id, sketchResourceId)}
                    onClose={() => setRetouchSlot(null)}
                    onChanged={async () => {
                        await refreshDetail(productId);
                    }}
                />
            ) : null}

            {/* Agent 精修：悬浮面板直挂（阶段 5 移除空壳 Drawer，open 由本组件控制）。
                包一层 h-0 容器：面板与启动器都是 fixed 悬浮，宿主 div 的 flex:1 曾吞掉
                画廊剩余高度（返工令三：首屏必须 100% 聚焦 7 屏画廊）。 */}
            <div className="h-0 shrink-0 overflow-visible">
                <AgentWorkbenchPanel
                    canvasId={agentCanvasId}
                    canvasState={agentCanvasState}
                    productCount={1}
                    detail={detail}
                    open={agentOpen}
                    onOpenChange={setAgentOpen}
                    advisorMode={advisorMode}
                />
            </div>
        </section>
    );
}

/**
 * 槽位卡（战役一：减负 + 按钮三级收敛 + 返工令三七屏骨架 + 返工令四 7 屏差异化版式）：
 *   - 默认态只留四样：状态徽标 + 海报画框（成品缩略图 / 差异化版式海报草图）
 *     + 主标题与副标题（点击原位改字，沿用现有 title / copy 字段）；
 *   - 场景描述 / 锁主体 / AI 换思路等企划字段收进「🎛 场景企划」轻量抽屉（SlotBriefPanel）；
 *   - 底部按钮三级收敛：1 主按钮（未出图「⚡ 生成本屏」/ 已出图「✨ 分层精修」）
 *     + 1 次按钮「🔄 重绘」+「⋯」更多菜单（详细编辑 / 送画布深加工 / 分层精修台）；
 *   - 未跑 AI 策划的屏：画框整框消费 slot-poster-layouts 的版式契约——背景 / 主体变换 /
 *     画框比例（按平台主图:详情规格）/ 装饰全部按屏序分化，根治 7 胞胎克隆卡。
 */
function SlotCard({
    slot, slotIndex, platformSpec, highlighted, generating, productCutoutUrl, onEdit, onGenerate, onTitleBlur, onCopyBlur, onBriefSave, onRetouch, onSendToCanvas,
}: {
    slot: EcommerceSlotSummary & { placeholder?: boolean };
    /** 画廊内屏序（0~6）：版式与画框比例的来源。 */
    slotIndex: number;
    /** 平台规格（主图/详情的屏数与比例）。 */
    platformSpec: SlotPosterPlatformSpec;
    highlighted: boolean;
    generating: boolean;
    /** 返工令一/二：商品透明主体（未出图海报草图与精修台共用）。 */
    productCutoutUrl: string;
    onEdit: () => void;
    onGenerate: () => void;
    /** 主标题原位快改（沿用现有 title 字段）。 */
    onTitleBlur: (value: string) => void;
    /** 副标题（画面文案）原位快改（沿用现有 copy 字段）。 */
    onCopyBlur: (value: string) => void;
    /** v60：L1 企划保存（body 全量来自抽屉表单；aiHint 触发确定性变体）。 */
    onBriefSave: (body: EcommerceBriefBody) => Promise<void>;
    /** v60：打开图层精修台（已出图屏走主按钮；未出图屏走 ⋯ 菜单，全天候可入）。 */
    onRetouch: () => void;
    /** 返工令四：成品图送入工作台画布（复用画布内置图片工具），仅已出图屏。 */
    onSendToCanvas: () => void;
}) {
    const generated = Boolean(slot.resourceId);
    // 占位卡（客户端骨架，无 id）：只展示 3:4 海报草图，不挂任何交互。
    const placeholder = Boolean(slot.placeholder);
    // 在途屏禁止重复派发（与平台切换同一口径）：主/次生成按钮置灰。
    const inFlight = slot.status === "running" || slot.status === "queued" || slot.status === "refining";
    // 主标题 / 副标题原位编辑（点击文字 → 原位 Input；失焦或回车即存，Esc 取消）。
    const [editing, setEditing] = useState<"title" | "copy" | null>(null);
    const [draft, setDraft] = useState("");
    // 返工令三：成品图裂图兜底——加载失败回落渐变占位，绝不露浏览器 Broken Image。
    const [imgFailed, setImgFailed] = useState(false);
    const startEdit = (field: "title" | "copy") => {
        setDraft(field === "title" ? slot.title || "" : slot.copy || "");
        setEditing(field);
    };
    const commitEdit = () => {
        const field = editing;
        setEditing(null);
        if (!field) return;
        const original = field === "title" ? slot.title || "" : slot.copy || "";
        if (draft === original) return;
        if (field === "title") onTitleBlur(draft);
        else onCopyBlur(draft);
    };
    // 默认屏序职能标题：未跑 AI 策划（无 brief / 无 title）时画框与卡头的骨架文案。
    const fallbackTitle = slotFunctionTitle(slot.kind, slot.slotNo);
    const posterTitle = slot.brief?.screen_title ?? slot.title ?? fallbackTitle;
    const posterSub = slot.brief?.sub_title ?? "";
    const displayTitle = slot.title || fallbackTitle;
    // 返工令四-5：本屏版式契约（背景 / 主体变换 / 画框比例 / 标题排版 / 装饰）。
    const layout = slotPosterLayout(slotIndex, platformSpec);
    return (
        <article
            className={`yq-slot-card-virtual flex min-w-0 flex-col gap-2 overflow-hidden rounded-card border border-line-subtle bg-surface-card p-2.5 shadow-card ${highlighted ? "border-line-focus bg-brand-soft" : ""}`}
        >
            {/* 海报画框：已出图 = 成品缩略图；未出图 = 按屏序取版式的海报草图。
                画框比例来自平台规格（淘宝前 3 张 1:1 主图 / 后 4 张 3:4 详情），
                背景、主体变换、标题排版、装饰全部由 slot-poster-layouts 契约注入。 */}
            <div className="relative overflow-hidden rounded-md bg-surface-active" style={{ aspectRatio: layout.aspect }}>
                <span className="absolute left-1.5 top-1.5 z-[1] rounded bg-black/55 px-1.5 py-0.5 text-caption text-white backdrop-blur">
                    {slot.kind === "hero" ? "主图" : "详情"} {slot.slotNo}
                </span>
                {generated && !imgFailed ? (
                    <img
                        src={`/api/resources/${slot.resourceId}/file`}
                        alt={slot.title || slot.slotKey}
                        className="size-full object-cover"
                        onError={() => setImgFailed(true)}
                    />
                ) : generated && imgFailed ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-surface-active text-foreground/40">
                        <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <rect x="3" y="4" width="18" height="16" rx="2" />
                            <circle cx="9" cy="10" r="1.4" />
                            <path d="M4.5 18.5l4.5-4.5 3.5 3.5 3-3 4 4" />
                        </svg>
                        <span className="text-caption">图片加载失败，可点「重绘」</span>
                    </div>
                ) : (
                    <>
                        <div className="absolute inset-0" style={{ background: layout.background }} />
                        {/* 背层装饰（光环 / 网格暗纹）：压在主体之下 */}
                        {layout.decorations
                            .filter((item) => item.kind === "halo" || item.kind === "gridLines")
                            .map((item, index) => <PosterDecoration key={`back-${index}`} decoration={item} />)}
                        {productCutoutUrl ? (
                            <img
                                src={productCutoutUrl}
                                alt="商品主体"
                                // 唯一保留的 drop-shadow：object-contain 的非矩形商品图必须让阴影跟随形状，
                                // box-shadow 只能跟矩形边框。模糊半径已从 14/20 收敛到 8/12 降低合成成本。
                                className={`absolute left-1/2 top-1/2 object-contain ${
                                    layout.titleTone === "onDark"
                                        ? "drop-shadow-[0_10px_14px_rgba(0,0,0,0.5)]"
                                        : "drop-shadow-[0_8px_12px_rgba(40,30,60,0.28)]"
                                }`}
                                style={{
                                    transform: layout.subjectTransform,
                                    maxWidth: layout.subjectMax.width,
                                    maxHeight: layout.subjectMax.height,
                                }}
                                draggable={false}
                            />
                        ) : (
                            <div className="absolute left-1/2 top-1/2 flex size-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/50 text-center text-caption leading-4 text-foreground/45">
                                商品主体提取中…
                            </div>
                        )}
                        {/* 返工令 Round 3：海报大字描边用 text-shadow 替代 drop-shadow（前者走文字绘制路径，
                            后者每次合成都重新栅格化滤镜，MX350 上掉帧、整页截图会超时）。 */}
                        {posterTitle ? (
                            <span
                                className={`absolute font-bold leading-5 ${
                                    layout.title.align === "center" ? "inset-x-2 text-center" : "left-2.5 right-2.5 text-left"
                                } ${
                                    layout.title.size === "lg" ? "text-base" : "text-sm"
                                } ${
                                    layout.titleTone === "onDark"
                                        ? "text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.45)]"
                                        : "text-[#2c2440] [text-shadow:0_1px_0_rgba(255,255,255,0.8)]"
                                }`}
                                style={{ top: layout.title.top }}
                            >
                                {posterTitle}
                            </span>
                        ) : null}
                        {posterSub ? (
                            <span
                                className={`absolute text-caption leading-4 ${
                                    layout.title.align === "center" ? "inset-x-3 text-center" : "left-2.5 right-3 text-left"
                                } ${
                                    layout.titleTone === "onDark" ? "text-white/75" : "text-[#4a4066]/85"
                                }`}
                                style={{ top: layout.subtitleTop }}
                            >
                                {posterSub}
                            </span>
                        ) : null}
                        {/* 前层装饰（痛点标签 / 利益点胶囊 / 参数表 / 清单卡）：压在主体之上 */}
                        {layout.decorations
                            .filter((item) => item.kind !== "halo" && item.kind !== "gridLines")
                            .map((item, index) => <PosterDecoration key={`front-${index}`} decoration={item} />)}
                        {/* 返工令四-5：旧「海报草图 · 生成后替换为 AI 场景图」黑膏药已删除，
                            换成按屏序分化的职能签（右上角），一眼区分 7 屏职能。 */}
                        <span className="absolute right-1.5 top-1.5 rounded bg-black/35 px-1.5 py-0.5 text-caption leading-none text-white/90">
                            {layout.badge}
                        </span>
                    </>
                )}
                {generated && slot.currentVersion > 0 ? (
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">v{slot.currentVersion}</span>
                ) : null}
                {highlighted ? (
                    <span className="absolute bottom-1.5 left-1.5 rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">Agent 已改</span>
                ) : null}
            </div>
            {/* 主标题（原位改字 / 占位卡静态展示）+ 状态徽标：徽标贴卡片面，避免压在成品图上不可读。 */}
            <div className="flex items-center gap-2">
                {placeholder ? (
                    <span className="ecommerce-slot-card-title text-card-title" title={displayTitle}>
                        {displayTitle}
                    </span>
                ) : editing === "title" ? (
                    <Input
                        size="small"
                        autoFocus
                        className="min-w-0 flex-1"
                        value={draft}
                        maxLength={80}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={commitEdit}
                        onPressEnter={(event) => event.currentTarget.blur()}
                        onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); }}
                    />
                ) : (
                    <button
                        type="button"
                        className="ecommerce-slot-card-title text-card-title"
                        title={`${displayTitle}（点击修改）`}
                        onClick={() => startEdit("title")}
                    >
                        {displayTitle}
                    </button>
                )}
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-caption ${SLOT_STATUS_TONE[slot.status] || SLOT_STATUS_TONE.pending}`}>
                    {ECOMMERCE_SLOT_STATUS_LABELS[slot.status] || slot.status}
                </span>
            </div>
            {/* 副标题（画面文案，原位改字；纯图屏可留空）。占位卡不展示。 */}
            {placeholder ? null : editing === "copy" ? (
                <Input
                    size="small"
                    autoFocus
                    value={draft}
                    maxLength={200}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commitEdit}
                    onPressEnter={(event) => event.currentTarget.blur()}
                    onKeyDown={(event) => { if (event.key === "Escape") setEditing(null); }}
                    placeholder="📝 需要上图的文案；纯图屏留空"
                />
            ) : (
                <button
                    type="button"
                    className={`ecommerce-slot-card-subtitle${slot.copy ? "" : " is-empty"}`}
                    title="点击修改画面文案"
                    onClick={() => startEdit("copy")}
                >
                    {slot.copy || "＋ 画面文案（纯图屏可留空）"}
                </button>
            )}
            {/* 场景描述 / 锁主体 / AI 换思路：收进轻量抽屉，默认态不占位。 */}
            {placeholder ? null : <SlotBriefPanel slot={slot} onSave={onBriefSave} />}
            {/* 阶段 4：失败原因直接展示（返工令三：剥离 markdown，弱化为一行）。 */}
            {slot.status === "failed" && slot.errorMessage ? (
                <p className="!mb-0 rounded bg-destructive/10 px-2 py-1 text-xs leading-4 text-destructive">{stripMarkdown(slot.errorMessage)}</p>
            ) : null}
            {/* 按钮三级收敛：1 主 + 1 次 + ⋯（详细编辑 / 送画布深加工 / 分层精修台）。
                占位卡（后端未预建槽位）只留一行初始化提示，不挂死按钮。 */}
            {placeholder ? (
                <p className="!mb-0 mt-auto text-caption leading-4 text-foreground/45">待初始化：点上方「✨ AI 策划」或切换平台自动补全</p>
            ) : (
                <div className="mt-auto flex items-center gap-1">
                    <Button
                        type="primary"
                        size="small"
                        className="!text-xs"
                        loading={generating}
                        disabled={generating || (inFlight && !generated)}
                        onClick={generated ? onRetouch : onGenerate}
                    >
                        {generated ? "✨ 分层精修" : "⚡ 生成本屏"}
                    </Button>
                    <Button
                        size="small"
                        className="!text-xs"
                        loading={generating}
                        disabled={generating || inFlight}
                        onClick={onGenerate}
                    >
                        🔄 重绘
                    </Button>
                    <SlotMoreMenu
                        generated={generated}
                        onEdit={onEdit}
                        onRetouch={onRetouch}
                        onSendToCanvas={onSendToCanvas}
                    />
                </div>
            )}
        </article>
    );
}

/** 科技网格版式的四角取景框（暗纹 HUD 感，纯 border 无滤镜）。 */
const TECH_GRID_CORNERS = [
    "left-2.5 top-2.5 border-l border-t",
    "right-2.5 top-2.5 border-r border-t",
    "left-2.5 bottom-2.5 border-l border-b",
    "right-2.5 bottom-2.5 border-r border-b",
];

/**
 * 画框装饰渲染器（返工令四-5）：文案与数据全部来自 slot-poster-layouts 的版式契约，
 * 组件只按 kind 渲染——新增版式只改契约文件，不在这里硬编码。
 */
function PosterDecoration({ decoration }: { decoration: SlotPosterDecoration }) {
    switch (decoration.kind) {
        case "halo":
            return (
                <span
                    className="pointer-events-none absolute left-1/2 top-1/2 size-[54%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.62),rgba(255,255,255,0))]"
                    aria-hidden
                />
            );
        case "macroRing":
            return (
                <>
                    <span className="pointer-events-none absolute left-[56%] top-[24%] size-[30%] rounded-full border border-dashed border-white/75" aria-hidden />
                    <span className="absolute right-[12%] top-[15%] rounded-full bg-white/85 px-1.5 py-0.5 text-caption leading-none text-foreground/70">{decoration.text}</span>
                </>
            );
        case "painPills":
            return (
                <div className="absolute left-2.5 top-[32%] flex w-[34%] flex-col gap-1">
                    {decoration.items.map((item) => (
                        <span
                            key={item.text}
                            className={`rounded-full px-2 py-0.5 text-caption leading-none ${
                                item.tone === "accent" ? "bg-primary/15 font-medium text-primary" : "bg-white/75 text-foreground/55 line-through"
                            }`}
                        >
                            {item.text}
                        </span>
                    ))}
                </div>
            );
        case "benefitCapsule":
            return (
                <span className="absolute left-1/2 top-[7%] max-w-[72%] -translate-x-1/2 truncate rounded-full bg-[#e2483f] px-2.5 py-1 text-caption font-medium leading-none text-white">
                    {decoration.text}
                </span>
            );
        case "gridLines":
            return (
                <>
                    <span
                        className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.16)_1px,transparent_1px)] bg-[length:26px_26px]"
                        aria-hidden
                    />
                    {TECH_GRID_CORNERS.map((position) => (
                        <span key={position} className={`pointer-events-none absolute size-3 border-white/45 ${position}`} aria-hidden />
                    ))}
                </>
            );
        case "specRows":
            return (
                <div className="absolute bottom-2.5 right-2.5 w-[46%] overflow-hidden rounded-md border border-white/70 bg-white/75">
                    {decoration.rows.map(([label, value], rowIndex) => (
                        <div
                            key={label}
                            className={`flex items-center justify-between gap-1 px-2 py-1 text-caption leading-none ${
                                rowIndex < decoration.rows.length - 1 ? "border-b border-white/60" : ""
                            }`}
                        >
                            <span className="text-foreground/55">{label}</span>
                            <span className="font-medium text-foreground/75">{value}</span>
                        </div>
                    ))}
                </div>
            );
        case "checklistCards":
            return (
                <div className="absolute inset-x-3 bottom-3 flex gap-1.5">
                    {decoration.items.map((item) => (
                        <span key={item} className="flex-1 rounded-md border border-white/70 bg-white/70 px-1 py-1.5 text-center text-caption leading-none text-foreground/70">
                            ✓ {item}
                        </span>
                    ))}
                </div>
            );
        default:
            return null;
    }
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
                {product.titleText ? <p className="!mb-0 mt-2 text-sm text-foreground/80">{product.titleText}</p> : null}
            </div>
        </div>
    );
}
