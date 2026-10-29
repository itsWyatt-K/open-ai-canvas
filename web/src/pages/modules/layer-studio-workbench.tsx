/**
 * LayerStudioWorkbench · 通用分层装修工作台（拍板令阶段三：LayerManifest 与电商 slot 解耦）。
 *
 * 脱离电商 slot 独立运行：接收任意 背景 / 透明主体 / 文字 Banner 输入，
 * 组合 nxf live-compose（背景+主体接触阴影+文字 Banner → 合成图）与 psd/export（分层 PSD）。
 * 电商 retouch-dialog.tsx 保留 slot 回写语义；本组件服务直播间装修台等独立场景。
 *
 * 画布交互：图层在画布上实时可见、可直接拖动；右侧滑杆做精调。
 * 预览用 CSS 近似 Pillow 的光栅化结果（同字体族、同字号比例、同描边/投影量纲），
 * 目的是「所见即所改」；最终像素仍以「合成预览」的结果为准。
 *
 * 拍板令阶段三 · 战役二（三步向导化 + 人话错误映射）：
 *  - 顶部工具栏从「一次摊开」改为分段引导：① ✂️ 抠主体与擦除 → ② 💡 光影与草图垫图 →
 *    ③ 🔤 文字与图层。当前步 aria-current="step" 高亮，支持 Tab / ←→ 键切换；
 *    步骤永不禁用——未完成步骤只给「下一步引导」，不做禁用死锁；
 *  - 右上角出口收敛：主按钮「💾 保存并应用」+ 下拉「📤 导出 ▾」（合成 PNG / 分层 PSD / 送画布）；
 *  - 后端原始错误文案统一过人话映射表（layer-studio-errors.ts）；冲突类错误在横幅里给
 *    「一键刷新并合并」——重新拉取商品详情即对账（电商工坊详情接口，由调用方经 onReconcile 注入）；
 *  - Loading 用同目录 LoadingState，空态复用设计系统 EmptyState，全台统一。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Dropdown, Input, Slider, type MenuProps } from "antd";
import { Check, ChevronLeft, ChevronRight, Download, ExternalLink, FileImage, Layers, Layers3, PencilRuler, Plus, Scissors, Type } from "lucide-react";
import { useNavigate } from "react-router";
import { nanoid } from "nanoid";

import { Callout } from "@/components/ui/product/callout";
import { EmptyState } from "@/components/ui/product/empty-state";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { resourceFileUrl, resourceStorageKey } from "@/services/api/resources";
import { createCanvasProjectWithRemoteSync } from "@/services/user-data-sync";
import { nxfPost, uploadDataUrlAsResource, urlToDataUrl } from "@/pages/ecommerce/vision-client";
import { fitCoverToSize } from "./live-canvas-fit";
import type { LiveBannerText, LiveSubject } from "./live-studio-types";
import { friendlyErrorCalloutTone, toFriendlyError, type FriendlyError } from "./layer-studio-errors";
import { LoadingState } from "./layer-studio-states";

type Props = {
    title: string;
    /** 初始背景（URL 或 dataURL）。 */
    backgroundUrl: string;
    /** 初始透明主体（URL 或 dataURL，可为空）。 */
    initialSubjects?: LiveSubject[];
    /** 初始文字 Banner。 */
    initialBanners?: LiveBannerText[];
    /** 受控文字 Banner：页面上的预设/场景包插入后要能实时反映到画布。
     *  不传则退回组件内部状态（保持原调用方零改动）。 */
    banners?: LiveBannerText[];
    onBannersChange?: (next: LiveBannerText[]) => void;
    canvasWidth: number;
    canvasHeight: number;
    /** 安全区辅助线（0-1）。 */
    safeTop?: number;
    safeBottom?: number;
    /** 保存回调（拿到各层 PNG 与合成图；由页面决定下载/上传）。 */
    onSave?: (result: { composed: string; background: string; subjects: Array<{ name: string; data_url: string }>; banner?: string; psdBase64?: string }) => Promise<void> | void;
    onClose?: () => void;
    /** 冲突对账：revision 冲突时「一键刷新并合并」调用它重新拉取商品详情
     *  （电商工坊详情接口即对账，如 () => refreshDetail(productId)）。不传则只给文字引导。 */
    onReconcile?: () => Promise<void> | void;
    /** 送画布：拿到合成图（与分层 PSD）。不传走通用默认——上传为站内资源后新建画布工程并打开。 */
    onSendToCanvas?: (payload: { composed: string; psdBase64: string; title: string }) => Promise<void> | void;
};

const FONT_STACK = '"Microsoft YaHei","微软雅黑","PingFang SC",sans-serif';

/** 三步分段引导：序号 + 表情 + 文案 + 引导语 + 未完成时的下一步指引。步骤永不禁用。 */
const WIZARD_STEPS = [
    {
        key: "cutout",
        num: "①",
        emoji: "✂️",
        label: "抠主体与擦除",
        guide: "先把商品主体弄进来：上传商品原图会自动抠成透明主体（BiRefNet），也可以直接传已经抠好的透明贴片；背景不满意就先换背景。",
        todo: "还没有主体层：上传一张商品原图自动抠图，或直接上传透明贴片。",
    },
    {
        key: "light",
        num: "②",
        emoji: "💡",
        label: "光影与草图垫图",
        guide: "主体默认带接触阴影更「落地」，点选主体后可随时开关；换背景后看一眼画布右下角的裁切提示——背景会按画布尺寸居中裁切后进引擎，安全区虚线内别压内容。",
        todo: "还没有主体可调光影：回第 1 步抠出主体再回来这里（默认已开接触阴影）。",
    },
    {
        key: "text",
        num: "③",
        emoji: "🔤",
        label: "文字与图层",
        guide: "右侧「图层」面板可增删文字与主体，点选后精调字号 / 描边 / 投影；画布上直接拖动图层摆位。全部就绪后点上方「合成预览」。",
        todo: "还没有文字 Banner：点「添加文字 Banner」加一条促销文案（只要主体层也可以跳过）。",
    },
] as const;

function clamp01(value: number) {
    return Math.min(1, Math.max(0, value));
}

/** #RRGGBB + 不透明度 → rgba()，供 CSS text-shadow 还原 Pillow 的投影不透明度。 */
function withAlpha(hex: string, alpha: number) {
    const matched = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!matched) return `rgba(0,0,0,${alpha})`;
    const int = Number.parseInt(matched[1], 16);
    return `rgba(${(int >> 16) & 255},${(int >> 8) & 255},${int & 255},${alpha})`;
}

export function LayerStudioWorkbench({ title, backgroundUrl, initialSubjects, initialBanners, banners: controlledBanners, onBannersChange, canvasWidth, canvasHeight, safeTop, safeBottom, onSave, onClose, onReconcile, onSendToCanvas }: Props) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [background, setBackground] = useState(backgroundUrl);
    const [subjects, setSubjects] = useState<LiveSubject[]>(() => (initialSubjects ?? []).slice());
    const [innerBanners, setInnerBanners] = useState<LiveBannerText[]>(() => (initialBanners ?? []).slice());
    // 受控优先：父级插入预设/场景包后要立刻出现在画布上，
    // 否则组件只在挂载时读一次 initialBanners，点按钮只会弹 toast 不见图层。
    const banners = controlledBanners ?? innerBanners;
    const setBanners = useCallback(
        (updater: LiveBannerText[] | ((prev: LiveBannerText[]) => LiveBannerText[])) => {
            if (controlledBanners) {
                onBannersChange?.(typeof updater === "function" ? updater(controlledBanners) : updater);
                return;
            }
            setInnerBanners(updater);
        },
        [controlledBanners, onBannersChange],
    );
    const [composed, setComposed] = useState("");
    const [psdBase64, setPsdBase64] = useState("");
    const [busy, setBusy] = useState("");
    const [selected, setSelected] = useState<{ kind: "subject" | "text"; index: number } | null>(null);

    // ---- 三步向导 + 人话错误（战役二）----
    const [step, setStep] = useState(0);
    const [error, setError] = useState<FriendlyError | null>(null);
    const stepRefs = useRef<Array<HTMLButtonElement | null>>([]);
    /** 步骤完成度（只做引导展示，绝不锁步骤）：有主体 / 有阴影 / 有文字。 */
    const stepDone = useMemo(() => [subjects.length > 0, subjects.some((subject) => subject.shadow), banners.length > 0], [subjects, banners]);
    /** 后端原始文案 → 人话横幅；raw 原文收进 <details> 供排查。 */
    const failWith = useCallback((raw: string) => {
        setError(toFriendlyError(raw));
    }, []);
    const onStepKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLElement>) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = (step + (event.key === "ArrowRight" ? 1 : -1) + WIZARD_STEPS.length) % WIZARD_STEPS.length;
            setStep(next);
            stepRefs.current[next]?.focus();
        },
        [step],
    );

    // 背景按平台画布 cover 裁切后的结果：这是真正进引擎的那张图。
    const [fitted, setFitted] = useState("");
    const [fitNote, setFitNote] = useState("");
    // 适配中标记：画布上盖统一 Loading，避免「看起来没反应」。
    const [fitting, setFitting] = useState(true);
    // 画布显示尺寸（实测像素），用于把画布坐标换算成屏幕坐标。
    const boxRef = useRef<HTMLDivElement | null>(null);
    const [box, setBox] = useState({ width: 0, height: 0 });
    const dragRef = useRef<{ kind: "subject" | "text"; index: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

    useEffect(() => {
        const element = boxRef.current;
        if (!element) return;
        const sync = () => setBox({ width: element.clientWidth, height: element.clientHeight });
        sync();
        const observer = new ResizeObserver(sync);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    // 背景一换就重新贴合画布：平台预设 1080x1920 必须落到最终像素上，
    // 否则引擎会拿背景原尺寸当画布，字号比例整盘错位。
    useEffect(() => {
        let cancelled = false;
        setFitted("");
        setFitting(true);
        fitCoverToSize(background, canvasWidth, canvasHeight)
            .then((result) => {
                if (cancelled) return;
                setFitted(result.dataUrl);
                if (result.croppedX > 0.02 || result.croppedY > 0.02) {
                    setFitNote(`背景已按 ${canvasWidth}x${canvasHeight} 居中裁切（横向裁掉 ${(result.croppedX * 100).toFixed(1)}%，纵向裁掉 ${(result.croppedY * 100).toFixed(1)}%）`);
                } else {
                    setFitNote("");
                }
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setFitNote("");
                failWith(error instanceof Error ? error.message : "背景适配失败");
            })
            .finally(() => {
                if (!cancelled) setFitting(false);
            });
        return () => {
            cancelled = true;
        };
    }, [background, canvasWidth, canvasHeight, failWith]);

    // 舞台尺寸：先按可用高度顶满，再按宽度回缩，保证 9:16 不变形。
    const stageHeight = box.width > 0 && box.height > 0 ? Math.min(box.height, (box.width * canvasHeight) / canvasWidth) : 0;
    const stageWidth = (stageHeight * canvasWidth) / canvasHeight;
    const displayScale = stageHeight > 0 ? stageHeight / canvasHeight : 0;
    // 画布浮层 Loading：适配 / 合成 / 送画布三态共一个出口，读屏也能听到。
    const canvasLoading = fitting ? "正在适配画布尺寸…" : busy === "compose" ? "正在合成…" : busy === "canvas" ? "正在送到画布…" : "";

    const patchSubject = useCallback((index: number, patch: Partial<LiveSubject>) => {
        setSubjects((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    }, []);
    const patchBanner = useCallback(
        (index: number, patch: Partial<LiveBannerText>) => {
            setBanners((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
        },
        [setBanners],
    );

    const addBanner = useCallback(() => {
        setBanners((prev) => [
            ...prev,
            {
                text: "新文字",
                font_size: 88,
                color: "#FFE066",
                bold: true,
                font: "",
                stroke_color: "#7A1010",
                stroke_width: 5,
                shadow_blur: 6,
                shadow_offset_x: 0,
                shadow_offset_y: 5,
                shadow_opacity: 0.5,
                shadow_color: "#000000",
                x: 0.5,
                y: 0.25,
                align: "center",
                line_spacing: 1.25,
            },
        ]);
    }, [setBanners]);

    const readFileAsDataUrl = useCallback(
        (file: File) =>
            new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error("读取失败"));
                reader.readAsDataURL(file);
            }),
        [],
    );

    const addSubjectFromFile = useCallback(
        async (file: File) => {
            try {
                const dataUrl = await readFileAsDataUrl(file);
                setSubjects((prev) => [...prev, { image: dataUrl, name: file.name.replace(/\.[^.]+$/, ""), x: 0.5, y: 0.6, scale: 0.5, shadow: true }]);
                message.success("主体/贴片已加入图层");
            } catch (reason) {
                failWith(reason instanceof Error ? reason.message : "读取失败");
            }
        },
        [readFileAsDataUrl, message, failWith],
    );

    const mattingFromUpload = useCallback(
        async (file: File) => {
            // 商品原图 → BiRefNet 透明主体（画布上传即抠）。
            setBusy("matting");
            try {
                const dataUrl = await readFileAsDataUrl(file);
                const result = await nxfPost<{ cutout_png: string; degraded: boolean }>("/api/v1/ecommerce/vision/matting", { image: dataUrl, feather_px: 2 });
                if (!result.ok) throw new Error(result.error || "抠图失败");
                setSubjects((prev) => [...prev, { image: result.cutout_png, name: file.name.replace(/\.[^.]+$/, ""), x: 0.5, y: 0.6, scale: 0.5, shadow: true }]);
                message.success(result.degraded ? "已用兜底档抠图" : "透明主体已生成（BiRefNet）");
            } catch (error) {
                failWith(error instanceof Error ? error.message : "抠图失败");
            } finally {
                setBusy("");
            }
        },
        [readFileAsDataUrl, message, failWith],
    );

    const compose = useCallback(async () => {
        setBusy("compose");
        try {
            const result = await nxfPost<{ composed_png: string; banner_png?: string; psd_base64?: string; psd_bytes?: number; width?: number; height?: number }>("/api/v1/ecommerce/vision/live-compose", {
                background: fitted || background,
                export_psd: true,
                filename: "live-studio",
                subjects: subjects.map((s) => ({ image: s.image, name: s.name, x: s.x, y: s.y, scale: s.scale, shadow: s.shadow })),
                banners,
            });
            if (!result.ok) throw new Error(result.error || "合成失败");
            setComposed(result.composed_png || "");
            setPsdBase64(result.psd_base64 || "");
            const sizeNote = result.width && result.height ? `${result.width}x${result.height}` : `${canvasWidth}x${canvasHeight}`;
            message.success(`合成完成（${sizeNote}${result.psd_bytes ? `，PSD ${(result.psd_bytes / 1024 / 1024).toFixed(1)}MB` : ""}）`);
        } catch (error) {
            failWith(error instanceof Error ? error.message : "合成失败");
        } finally {
            setBusy("");
        }
    }, [background, fitted, subjects, banners, message, canvasWidth, canvasHeight, failWith]);

    const downloadComposedPng = useCallback(() => {
        const anchor = document.createElement("a");
        anchor.href = composed;
        anchor.download = "live-studio.png";
        anchor.click();
    }, [composed]);

    const downloadPsd = useCallback(() => {
        const anchor = document.createElement("a");
        anchor.href = "data:application/x-photoshop;base64," + psdBase64;
        anchor.download = "live-studio.psd";
        anchor.click();
    }, [psdBase64]);

    const handleSave = useCallback(async () => {
        if (!composed) {
            message.info("先点「合成预览」生成合成图");
            return;
        }
        setBusy("save");
        try {
            if (onSave) {
                await onSave({
                    composed,
                    background: fitted || background,
                    subjects: subjects.map((s, i) => ({ name: s.name || `主体层 ${i + 1}`, data_url: s.image })),
                    banner: banners.length ? composed : undefined,
                    psdBase64,
                });
                return;
            }
            // 默认：下载 PNG 与 PSD。
            downloadComposedPng();
            if (psdBase64) downloadPsd();
            message.success("已导出 PNG" + (psdBase64 ? " 与分层 PSD" : ""));
        } catch (reason) {
            failWith(reason instanceof Error ? reason.message : "保存失败");
        } finally {
            setBusy("");
        }
    }, [composed, psdBase64, banners.length, subjects, background, fitted, onSave, message, downloadComposedPng, downloadPsd, failWith]);

    /** 一键刷新并合并：重新拉取商品详情（电商工坊详情接口即对账）。 */
    const handleReconcile = useCallback(async () => {
        if (!onReconcile) return;
        setBusy("reconcile");
        try {
            await onReconcile();
            setError(null);
            message.success("已刷新商品详情并合并最新画面");
        } catch (reason) {
            failWith(reason instanceof Error ? reason.message : "刷新失败");
        } finally {
            setBusy("");
        }
    }, [onReconcile, message, failWith]);

    /** 送画布：调用方可接管；默认上传为站内资源 → 新建画布工程并打开。 */
    const handleSendToCanvas = useCallback(async () => {
        if (!composed) {
            message.info("先点「合成预览」生成合成图");
            return;
        }
        setBusy("canvas");
        try {
            if (onSendToCanvas) {
                await onSendToCanvas({ composed, psdBase64, title });
                message.success("已送到画布");
                return;
            }
            const resourceId = await uploadDataUrlAsResource(composed, `${title || "图层精修台"}-合成图.png`);
            const node: CanvasNodeData = {
                id: nanoid(),
                type: CanvasNodeType.Image,
                title: `${title || "图层精修台"} · 合成图`,
                position: { x: 80, y: 80 },
                width: 360,
                height: 360,
                metadata: {
                    content: resourceFileUrl(resourceId),
                    storageKey: resourceStorageKey(resourceId),
                    status: "success",
                },
            };
            const { id, syncError } = await createCanvasProjectWithRemoteSync(`${title || "图层精修台"} · 送画布`, undefined, { nodes: [node] });
            if (syncError) message.warning("画布已在本地创建，云端同步失败，稍后会自动重试");
            message.success("已送到画布，正在打开…");
            navigate(`/canvas/${id}`);
        } catch (reason) {
            failWith(reason instanceof Error ? reason.message : "送画布失败");
        } finally {
            setBusy("");
        }
    }, [composed, psdBase64, title, onSendToCanvas, message, navigate, failWith]);

    const exportMenu = useMemo<MenuProps>(
        () => ({
            items: [
                { key: "png", icon: <FileImage aria-hidden className="size-3.5" />, label: "合成 PNG" },
                { key: "psd", icon: <Layers aria-hidden className="size-3.5" />, label: "分层 PSD" },
                { type: "divider" },
                { key: "canvas", icon: <ExternalLink aria-hidden className="size-3.5" />, label: "送画布" },
            ],
            onClick: ({ key }) => {
                if (key === "png") {
                    if (!composed) {
                        message.info("先点「合成预览」生成合成图");
                        return;
                    }
                    downloadComposedPng();
                    message.success("已导出合成 PNG");
                    return;
                }
                if (key === "psd") {
                    if (!psdBase64) {
                        message.info("先点「合成预览」，生成时会一并产出分层 PSD");
                        return;
                    }
                    downloadPsd();
                    message.success("已导出分层 PSD");
                    return;
                }
                if (key === "canvas") void handleSendToCanvas();
            },
        }),
        [composed, psdBase64, message, downloadComposedPng, downloadPsd, handleSendToCanvas],
    );

    // ---- 画布拖动：把屏幕位移换算回 0-1 画布坐标 ----
    const beginDrag = useCallback(
        (kind: "subject" | "text", index: number, event: React.PointerEvent<HTMLElement>) => {
            event.stopPropagation();
            setSelected({ kind, index });
            const current = kind === "text" ? banners[index] : subjects[index];
            if (!current) return;
            dragRef.current = { kind, index, startX: event.clientX, startY: event.clientY, baseX: current.x, baseY: current.y };
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        [banners, subjects],
    );

    const moveDrag = useCallback(
        (event: React.PointerEvent<HTMLElement>) => {
            const drag = dragRef.current;
            if (!drag || stageWidth <= 0 || stageHeight <= 0) return;
            const nextX = clamp01(drag.baseX + (event.clientX - drag.startX) / stageWidth);
            const nextY = clamp01(drag.baseY + (event.clientY - drag.startY) / stageHeight);
            if (drag.kind === "text") patchBanner(drag.index, { x: nextX, y: nextY });
            else patchSubject(drag.index, { x: nextX, y: nextY });
        },
        [patchBanner, patchSubject, stageWidth, stageHeight],
    );

    const endDrag = useCallback(() => {
        dragRef.current = null;
    }, []);

    const scaleValue = selected?.kind === "subject" ? (subjects[selected.index]?.scale ?? 0.5) : 0.5;
    const selectedLabel = selected ? (selected.kind === "subject" ? subjects[selected.index]?.name || `主体 ${selected.index + 1}` : `文字 ${selected.index + 1}`) : "未选中";
    const stageStyle = useMemo(
        () => ({
            width: stageWidth,
            height: stageHeight,
            left: Math.max(0, (box.width - stageWidth) / 2),
            top: Math.max(0, (box.height - stageHeight) / 2),
        }),
        [box.width, box.height, stageWidth, stageHeight],
    );

    return (
        <div className="flex flex-col gap-3">
            {/* 顶栏：标题 + 出口收敛（合成预览是中转动作，保存并应用才是唯一主出口） */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="flex items-center gap-1.5 text-sm">
                    <Layers3 className="size-4" /> {title}
                </strong>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="small" loading={busy === "compose"} onClick={() => void compose()}>
                        合成预览
                    </Button>
                    {composed ? (
                        <>
                            <span className="text-caption text-status-success">已合成 ✓</span>
                            <Button size="small" icon={<PencilRuler className="size-3.5" />} onClick={() => setComposed("")}>
                                回到编辑
                            </Button>
                        </>
                    ) : null}
                    <Button size="small" type="primary" loading={busy === "save"} disabled={Boolean(busy)} onClick={() => void handleSave()}>
                        💾 保存并应用
                    </Button>
                    <Dropdown trigger={["click"]} menu={exportMenu} disabled={Boolean(busy)}>
                        <Button size="small">📤 导出 ▾</Button>
                    </Dropdown>
                    {onClose ? (
                        <Button size="small" onClick={onClose}>
                            关闭
                        </Button>
                    ) : null}
                </div>
            </div>

            {/* 人话错误横幅：role="alert" 即时播报；冲突类带「一键刷新并合并」 */}
            {error ? (
                <Callout
                    role="alert"
                    tone={friendlyErrorCalloutTone(error.tone)}
                    title={error.title}
                    onClose={() => setError(null)}
                    closeLabel="关闭错误提示"
                    action={
                        error.refreshable && onReconcile ? (
                            <Button size="small" type="primary" loading={busy === "reconcile"} onClick={() => void handleReconcile()}>
                                一键刷新并合并
                            </Button>
                        ) : undefined
                    }
                >
                    <p>
                        {error.hint}
                        {error.refreshable && !onReconcile ? "（本场景未接入对账接口：刷新页面或重新进入精修台，也能加载最新画面。）" : ""}
                    </p>
                    {error.raw ? (
                        <details className="mt-1">
                            <summary className="cursor-pointer select-none opacity-70">技术详情</summary>
                            <p className="mt-0.5 break-all opacity-70">{error.raw}</p>
                        </details>
                    ) : null}
                </Callout>
            ) : null}

            {/* 三步分段引导：当前步 aria-current="step"，←/→ 键切换，永不禁用 */}
            <nav aria-label="图层精修步骤" onKeyDown={onStepKeyDown} className="flex flex-col gap-2">
                <ol className="flex items-stretch gap-1.5">
                    {WIZARD_STEPS.map((item, index) => {
                        const active = index === step;
                        return (
                            <li key={item.key} className="min-w-0 flex-1">
                                <button
                                    ref={(node) => {
                                        stepRefs.current[index] = node;
                                    }}
                                    type="button"
                                    aria-current={active ? "step" : undefined}
                                    onClick={() => setStep(index)}
                                    className={`flex w-full items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-primary bg-primary text-white shadow-sm" : "border-border/60 bg-surface-secondary text-foreground/70 hover:border-primary/50 hover:text-foreground"}`}
                                >
                                    <span aria-hidden>{item.emoji}</span>
                                    <span className="truncate">
                                        {item.num} {item.label}
                                    </span>
                                    {stepDone[index] ? (
                                        <>
                                            <Check aria-hidden className="size-3.5 shrink-0" />
                                            <span className="sr-only">（已完成）</span>
                                        </>
                                    ) : null}
                                </button>
                            </li>
                        );
                    })}
                </ol>
                <p className="sr-only" aria-live="polite">
                    当前第 {step + 1} 步，共 {WIZARD_STEPS.length} 步：{WIZARD_STEPS[step].label}
                </p>

                {/* 当前步工具区：只摊开这一步要用的工具，其余步骤不堆位 */}
                <div className="rounded-lg border border-border/50 bg-surface-secondary/40 p-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                        {step === 0 ? (
                            <>
                                <label className={`cursor-pointer rounded border border-border/50 px-2 py-1 text-xs hover:border-primary/50 ${busy === "matting" ? "pointer-events-none opacity-60" : ""}`}>
                                    上传背景
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="sr-only"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (file)
                                                void urlToDataUrl(URL.createObjectURL(file))
                                                    .then((data) => {
                                                        setBackground(data);
                                                        setComposed("");
                                                        event.target.value = "";
                                                    })
                                                    .catch((reason: unknown) => failWith(reason instanceof Error ? reason.message : "读取图片失败"));
                                        }}
                                    />
                                </label>
                                <label className={`cursor-pointer rounded border border-border/50 px-2 py-1 text-xs hover:border-primary/50 ${busy === "matting" ? "pointer-events-none opacity-60" : ""}`}>
                                    <Scissors className="mr-1 inline size-3" />
                                    上传商品原图并抠图{busy === "matting" ? "（抠图中…）" : ""}
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="sr-only"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (file) void mattingFromUpload(file);
                                            event.target.value = "";
                                        }}
                                    />
                                </label>
                                <label className={`cursor-pointer rounded border border-border/50 px-2 py-1 text-xs hover:border-primary/50 ${busy === "matting" ? "pointer-events-none opacity-60" : ""}`}>
                                    <Plus className="mr-1 inline size-3" />
                                    上传透明贴片
                                    <input
                                        type="file"
                                        accept="image/*"
                                        className="sr-only"
                                        onChange={(event) => {
                                            const file = event.target.files?.[0];
                                            if (file) void addSubjectFromFile(file);
                                            event.target.value = "";
                                        }}
                                    />
                                </label>
                            </>
                        ) : null}
                        {step === 1 ? (
                            selected?.kind === "subject" && subjects[selected.index] ? (
                                <label className="flex cursor-pointer items-center gap-1.5 rounded border border-border/50 px-2 py-1 text-xs hover:border-primary/50">
                                    <input type="checkbox" checked={subjects[selected.index].shadow} onChange={(event) => patchSubject(selected.index, { shadow: event.target.checked })} />
                                    接触阴影（{selectedLabel}）
                                </label>
                            ) : (
                                <span className="text-xs text-foreground/50">在画布或右侧图层列表点选一个主体，就能开关它的接触阴影。</span>
                            )
                        ) : null}
                        {step === 2 ? (
                            <Button size="small" icon={<Plus className="size-3.5" />} onClick={addBanner}>
                                添加文字 Banner
                            </Button>
                        ) : null}
                    </div>
                    <p className="mt-1.5 text-caption leading-5 text-foreground/55">{WIZARD_STEPS[step].guide}</p>
                    {!stepDone[step] ? <p className="mt-1 text-caption leading-5 text-amber-500/90">{WIZARD_STEPS[step].todo}</p> : null}
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                        <Button size="small" type="text" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))} icon={<ChevronLeft className="size-3.5" />}>
                            上一步
                        </Button>
                        {step < WIZARD_STEPS.length - 1 ? (
                            <Button size="small" type="link" onClick={() => setStep((current) => Math.min(WIZARD_STEPS.length - 1, current + 1))}>
                                下一步：{WIZARD_STEPS[step + 1].label}
                                <ChevronRight className="size-3.5" />
                            </Button>
                        ) : (
                            <span className="text-caption text-foreground/45">全部就绪后点上方「合成预览」，再「保存并应用」或「导出」</span>
                        )}
                    </div>
                </div>
            </nav>

            <div className="flex flex-col gap-3 lg:flex-row">
                {/* 画布预览：图层实时可见 + 可直接拖动；安全区线严格贴着画布左右边界 */}
                <div ref={boxRef} aria-busy={canvasLoading ? true : undefined} className="relative h-[52vh] min-w-0 flex-1 overflow-hidden rounded-lg bg-black/[0.06] lg:h-[68vh]">
                    {stageWidth > 0 ? (
                        <div
                            className="absolute overflow-hidden rounded-sm ring-1 ring-black/15 shadow-[0_4px_24px_rgba(0,0,0,0.28)]"
                            style={stageStyle}
                            onPointerMove={moveDrag}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            onPointerDown={() => setSelected(null)}
                        >
                            <img src={composed || fitted || background} alt={title} className="block size-full object-cover" draggable={false} />

                            {/* 主体层：宽度 = 画布宽 × scale，与 nxf live-compose 同口径 */}
                            {!composed
                                ? subjects.map((subject, index) => (
                                      <img
                                          key={`subject-layer-${index}`}
                                          src={subject.image}
                                          alt={subject.name}
                                          draggable={false}
                                          onPointerDown={(event) => beginDrag("subject", index, event)}
                                          className={`absolute cursor-move select-none ${selected?.kind === "subject" && selected.index === index ? "outline outline-2 outline-primary/80" : ""}`}
                                          style={{
                                              left: `${subject.x * 100}%`,
                                              top: `${subject.y * 100}%`,
                                              width: canvasWidth * subject.scale * displayScale,
                                              transform: "translate(-50%, -50%)",
                                          }}
                                      />
                                  ))
                                : null}

                            {/* 文字层：CSS 近似 Pillow 结果（同字体族、同字号比例、同描边/投影量纲） */}
                            {!composed
                                ? banners.map((banner, index) => (
                                      <div
                                          key={`banner-layer-${index}`}
                                          onPointerDown={(event) => beginDrag("text", index, event)}
                                          className={`absolute cursor-move select-none whitespace-pre ${selected?.kind === "text" && selected.index === index ? "outline outline-2 outline-dashed outline-primary/80" : ""}`}
                                          style={{
                                              left: `${banner.x * 100}%`,
                                              top: `${banner.y * 100}%`,
                                              transform: "translate(-50%, -50%)",
                                              color: banner.color,
                                              fontFamily: FONT_STACK,
                                              fontSize: Math.max(1, banner.font_size * displayScale),
                                              fontWeight: banner.bold ? 700 : 400,
                                              lineHeight: banner.line_spacing,
                                              textAlign: (banner.align as "left" | "center" | "right") || "center",
                                              WebkitTextStroke: banner.stroke_width > 0 ? `${banner.stroke_width * displayScale}px ${banner.stroke_color}` : undefined,
                                              paintOrder: "stroke fill",
                                              textShadow:
                                                  banner.shadow_blur > 0
                                                      ? `${banner.shadow_offset_x * displayScale}px ${banner.shadow_offset_y * displayScale}px ${banner.shadow_blur * displayScale}px ${withAlpha(banner.shadow_color, banner.shadow_opacity)}`
                                                      : undefined,
                                          }}
                                      >
                                          {banner.text || "（空文案）"}
                                      </div>
                                  ))
                                : null}

                            {typeof safeTop === "number" && !composed ? (
                                <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-amber-400/70" style={{ top: `${safeTop * 100}%` }}>
                                    <span className="absolute left-1 top-0.5 rounded bg-amber-400/85 px-1 text-caption text-black">顶部安全区</span>
                                </div>
                            ) : null}
                            {typeof safeBottom === "number" && !composed ? (
                                <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-amber-400/70" style={{ top: `${(1 - safeBottom) * 100}%` }}>
                                    <span className="absolute left-1 top-0.5 rounded bg-amber-400/85 px-1 text-caption text-black">底部互动区</span>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {canvasLoading ? (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
                            <div className="rounded-lg bg-surface px-4 py-3 shadow-lg">
                                <LoadingState label={canvasLoading} />
                            </div>
                        </div>
                    ) : null}
                </div>

                {/* 右侧：图层与属性 */}
                <div className="flex w-full shrink-0 flex-col gap-2.5 lg:w-[320px] lg:overflow-y-auto">
                    <div className="rounded-lg border border-border/50 p-2.5">
                        <p className="mb-1.5 text-xs font-semibold text-foreground/70">图层（自上而下）</p>
                        {banners.length === 0 && subjects.length === 0 ? (
                            <EmptyState
                                size="compact"
                                icon={Layers3}
                                title="还没有图层"
                                description="第 1 步抠出商品主体、第 3 步添加文字 Banner；加好的图层都会列在这里，可点选、拖动、删除。"
                                action={
                                    <Button size="small" onClick={() => setStep(0)}>
                                        从第 1 步开始
                                    </Button>
                                }
                            />
                        ) : (
                            <>
                                {banners.map((banner, index) => (
                                    <button
                                        key={`t${index}`}
                                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${selected?.kind === "text" && selected.index === index ? "bg-primary/10 text-primary" : "hover:bg-surface-active"}`}
                                        onClick={() => setSelected({ kind: "text", index })}
                                    >
                                        <span className="truncate">🔤 {banner.text.slice(0, 12) || `文字 ${index + 1}`}</span>
                                        <span
                                            className="text-caption opacity-50"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setBanners((prev) => prev.filter((_, i) => i !== index));
                                                setSelected(null);
                                            }}
                                        >
                                            ✕
                                        </span>
                                    </button>
                                ))}
                                {subjects.map((subject, index) => (
                                    <button
                                        key={`s${index}`}
                                        className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${selected?.kind === "subject" && selected.index === index ? "bg-primary/10 text-primary" : "hover:bg-surface-active"}`}
                                        onClick={() => setSelected({ kind: "subject", index })}
                                    >
                                        <span className="truncate">📦 {subject.name || `主体 ${index + 1}`}</span>
                                        <span
                                            className="text-caption opacity-50"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setSubjects((prev) => prev.filter((_, i) => i !== index));
                                                setSelected(null);
                                            }}
                                        >
                                            ✕
                                        </span>
                                    </button>
                                ))}
                            </>
                        )}
                        <button className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-foreground/60 hover:bg-surface-active" onClick={addBanner}>
                            <Plus className="size-3.5" /> 文字 Banner
                        </button>
                    </div>

                    {selected?.kind === "subject" && subjects[selected.index] ? (
                        <div className="flex flex-col gap-2 rounded-lg border border-border/50 p-2.5 text-xs">
                            <strong className="text-foreground/75">主体：{selectedLabel}</strong>
                            <label className="flex items-center gap-2">
                                位置 X<Slider className="flex-1" min={0} max={1} step={0.01} value={subjects[selected.index].x} onChange={(v) => patchSubject(selected.index, { x: v })} />
                            </label>
                            <label className="flex items-center gap-2">
                                位置 Y<Slider className="flex-1" min={0} max={1} step={0.01} value={subjects[selected.index].y} onChange={(v) => patchSubject(selected.index, { y: v })} />
                            </label>
                            <label className="flex items-center gap-2">
                                缩放
                                <Slider className="flex-1" min={0.05} max={2} step={0.01} value={subjects[selected.index].scale} onChange={(v) => patchSubject(selected.index, { scale: v })} />
                                <span className="w-10 text-right tabular-nums">{Math.round(scaleValue * 100)}%</span>
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={subjects[selected.index].shadow} onChange={(e) => patchSubject(selected.index, { shadow: e.target.checked })} />
                                接触阴影
                            </label>
                        </div>
                    ) : null}

                    {selected?.kind === "text" && banners[selected.index] ? (
                        <div className="flex flex-col gap-2 rounded-lg border border-border/50 p-2.5 text-xs">
                            <strong className="text-foreground/75">文字：{selectedLabel}</strong>
                            <Input size="small" value={banners[selected.index].text} onChange={(e) => patchBanner(selected.index, { text: e.target.value })} placeholder="Banner 文案" />
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={banners[selected.index].color}
                                    onChange={(e) => patchBanner(selected.index, { color: e.target.value })}
                                    className="h-6 w-8 cursor-pointer rounded border border-border/50 bg-transparent"
                                    aria-label="文字颜色"
                                />
                                <Type className="size-3.5 text-foreground/50" />
                                <Slider className="flex-1" min={24} max={400} step={4} value={banners[selected.index].font_size} onChange={(v) => patchBanner(selected.index, { font_size: v })} />
                                <span className="w-10 text-right tabular-nums">{banners[selected.index].font_size}</span>
                            </div>
                            <label className="flex items-center gap-2">
                                描边宽
                                <Slider className="flex-1" min={0} max={20} step={1} value={banners[selected.index].stroke_width} onChange={(v) => patchBanner(selected.index, { stroke_width: v })} />
                                <input
                                    type="color"
                                    value={banners[selected.index].stroke_color}
                                    onChange={(e) => patchBanner(selected.index, { stroke_color: e.target.value })}
                                    className="h-6 w-8 cursor-pointer rounded border border-border/50 bg-transparent"
                                    aria-label="描边颜色"
                                />
                            </label>
                            <label className="flex items-center gap-2">
                                投影
                                <Slider className="flex-1" min={0} max={30} step={1} value={banners[selected.index].shadow_blur} onChange={(v) => patchBanner(selected.index, { shadow_blur: v })} />
                                <input type="checkbox" checked={banners[selected.index].bold} onChange={(e) => patchBanner(selected.index, { bold: e.target.checked })} />
                                加粗
                            </label>
                            <div className="flex items-center gap-2">
                                位置 X<Slider className="flex-1" min={0} max={1} step={0.01} value={banners[selected.index].x} onChange={(v) => patchBanner(selected.index, { x: v })} />
                                Y<Slider className="flex-1" min={0} max={1} step={0.01} value={banners[selected.index].y} onChange={(v) => patchBanner(selected.index, { y: v })} />
                            </div>
                        </div>
                    ) : null}

                    <p className="text-caption leading-4 text-foreground/40">
                        画布 {canvasWidth}x{canvasHeight} · 文字 Banner 由 nxf Pillow 光栅化（描边/投影/多行），合成走 alpha 分层，导出 PSD 保留每层。 画布上可直接拖动图层；预览为 CSS 近似，最终像素以「合成预览」为准。
                    </p>
                    {fitNote ? <p className="text-caption leading-4 text-amber-500/80">{fitNote}</p> : null}
                </div>
            </div>
        </div>
    );
}
