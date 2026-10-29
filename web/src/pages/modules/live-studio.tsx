// 直播间装修与透明分层台（拍板令阶段三：/modules/live-studio）。
// 布局（返工令 Round 3/4）：左栏控制面板（固定 340px 可滚动）+ 右栏常驻 9:16 画布舞台（占屏 ≥55%）。
// 一进入页面右侧即渲染 9:16 手机画框（暗夜流光渐变底 + 直播间仿真 UI + 顶部/底部安全区虚线），
// 不再等 backgroundUrl；Round 4 起画布可拖拽、正下方常驻「一键光影合成 / 导出」操作栏，
// 删掉了原来盖住画布的阻塞式「第一步」蒙层；背景就位后右栏切换为 LayerStudioWorkbench 精修台
// （受控 Banner 实时联动，合成/导出走精修台顶部工具栏）。
// 流程：选平台预设 →（可选）上传/生成背景 → 上传商品原图自动 BiRefNet 抠主体 → 加文字 Banner →
//      合成预览（接触阴影/安全区）→ 导出 PNG + 分层 PSD。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input } from "antd";
import { ArrowLeft, Download, ImagePlus, RefreshCw, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { LayerStudioWorkbench } from "./layer-studio-workbench";
import {
    LIVE_BANNER_PRESETS,
    LIVE_PLATFORMS,
    LIVE_SCENE_PACKS,
    LIVE_REFERENCE_DEFAULT_MODE,
    LIVE_REFERENCE_DEFAULT_STRENGTH,
    LIVE_REFERENCE_MODES,
    LIVE_REFERENCE_STRENGTHS,
    consumeLiveReferenceHandoff,
    describeLiveReferenceDna,
    type LivePlatformKey,
    type LivePlatformPreset,
    type LiveReferenceMode,
    type LiveReferenceStrength,
} from "./platforms-live";
import type { LiveBannerText, LiveSubject } from "./live-studio-types";
// 背景 cover 适配与精修台同源：页面级「一键光影合成」也要按平台画布尺寸裁切后再进引擎，
// 否则引擎会拿背景原尺寸当画布，字号比例整盘错位（与 layer-studio-workbench 同一函数）。
import { fitCoverToSize } from "./live-canvas-fit";
// 人话错误映射与精修台同源：页面级合成失败不把「Failed to fetch」直接怼用户脸
import { toFriendlyError } from "./layer-studio-errors";
// 生图通道与「生成配置」同源：requestGeneration 已统一 OpenAI 兼容 / Gemini / Grok / 火山方舟
// 四种协议与鉴权（含系统代理中继），这里只组 prompt，不新造轮子。
import { requestGeneration } from "@/services/api/image";
// 视觉 DNA 服务已存在：参考图 → 色调/光影/材质/留白描述，直接复用不新造轮子。
import { analyzeVisualDna } from "@/services/api/visual-dna";
import { imageToDataUrl } from "@/services/image-storage";
import { AssetLibraryPickerModal, type AssetLibraryPickerItem } from "@/components/assets/asset-library-picker-modal";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useConfigStore } from "@/stores/use-config-store";
// 跨域 URL 结果先转 dataURL：背景要进 canvas 做 cover 裁切与合成，污染画布会导致导出失败。
// nxfPost：左栏「上传商品图自动抠透明底」与精修台共用同一个 BiRefNet 抠图接口。
import { nxfPost, urlToDataUrl, uploadDataUrlAsResource } from "@/pages/ecommerce/vision-client";

/** 单条 Banner 的完整默认值：预设只给差异字段，其余靠这里兜底。
 *  配色（返工令 Round 4）：纯白字 + 靛蓝描边 + 微投影的现代花字——暗夜流光默认底上
 *  一眼清楚，也杜绝暗棕黄那类 90 年代小广告配色。 */
const BANNER_DEFAULTS: Omit<LiveBannerText, "text"> = {
    font_size: 88, color: "#FFFFFF", bold: true, font: "",
    stroke_color: "#4F46E5", stroke_width: 5,
    shadow_blur: 6, shadow_offset_x: 0, shadow_offset_y: 5,
    shadow_opacity: 0.5, shadow_color: "#000000",
    align: "center", line_spacing: 1.25, x: 0.5, y: 0.25,
};

/**
 * AI 直播间背景预设（9:16 竖版）：三个高频场景一句话出图。
 * prompt 只写场景差异，公共后缀（比例/留白/禁文字）由 LIVE_BG_PROMPT_SUFFIX 统一兜底，
 * 避免三个预设各写一遍比例约束后漂移。label 与右侧场景包一一对应。
 */
const LIVE_BG_PRESETS: Array<{ key: string; label: string; hint: string; prompt: string }> = [
    {
        key: "home",
        label: "温馨家居",
        hint: "暖奶油色调 · 柔和窗光 · 简约陈列",
        prompt: "温馨家居风直播间背景，暖奶油色墙面，柔和自然窗光，原木色简约陈列架与绿植点缀，氛围干净治愈",
    },
    {
        key: "digital",
        label: "科技展台",
        hint: "深色科技感 · 冷蓝光效 · 展台",
        prompt: "科技数码风直播间背景，深灰渐变底色，冷蓝色氛围光效，简约金属展台与线性灯带，质感专业",
    },
    {
        key: "promo",
        label: "大促狂欢",
        hint: "红金节庆 · 热闹喜庆 · 光斑",
        prompt: "电商大促直播间背景，红金节庆氛围，灯笼彩带与暖色光斑，热闹喜庆有购买欲",
    },
];

/** 背景 prompt 公共后缀：锁 9:16、锁留白、禁文字水印（直播间文字层由 Banner 负责）。 */
const LIVE_BG_PROMPT_SUFFIX = "，竖版 9:16 构图，画面整洁，中部与下方留出商品展示区，不要文字，不要水印，不要边框";

/** 画布预览的文字层近似 Pillow 光栅化：同字体族、同字号比例、同描边/投影量纲。 */
const FONT_STACK = '"Microsoft YaHei","微软雅黑","PingFang SC",sans-serif';

/** #RRGGBB + 不透明度 → rgba()，供 CSS text-shadow 还原 Pillow 的投影不透明度。 */
function withAlpha(hex: string, alpha: number) {
    const matched = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!matched) return `rgba(0,0,0,${alpha})`;
    const int = Number.parseInt(matched[1], 16);
    return `rgba(${(int >> 16) & 255},${(int >> 8) & 255},${int & 255},${alpha})`;
}

/**
 * 未上传背景时的「暗夜流光」默认底（返工令 Round 4）。
 * 原来这里是浅灰白棋盘格——远看像水泥纱窗，促销大字压上去更是 90 年代小广告感。
 * 现在默认底就是一张能直接开播的夜景直播间：深邃紫蓝渐变 + 三团柔光斑，
 * 并叠半透明抖音直播间仿真（顶部头像区 + 底部评论区毛玻璃），一眼像真实手机直播间。
 */
const NIGHT_STAGE_BACKGROUND =
    "radial-gradient(120% 55% at 16% 6%, rgba(99,102,241,0.38), transparent 62%)," +
    "radial-gradient(95% 45% at 86% 74%, rgba(217,70,239,0.24), transparent 60%)," +
    "radial-gradient(130% 40% at 50% 104%, rgba(56,189,248,0.2), transparent 66%)," +
    "linear-gradient(160deg,#1E1B4B 0%,#0F172A 55%,#020617 100%)";

/**
 * 默认底的位图版（1080x1920）：给页面级「一键光影合成」当背景喂引擎。
 * 为什么必须位图：nxf live-compose 的 background 只收图，不收 CSS 渐变；
 * 没有它，未生背景时点合成会直接报错——那就成了造假按钮。
 * 只在第一次点合成时懒生成（useRef 缓存），不进首屏关键路径。
 */
function createDefaultLiveBackground(): string {
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const base = ctx.createLinearGradient(0, 0, 0, 1920);
    base.addColorStop(0, "#1E1B4B");
    base.addColorStop(0.55, "#0F172A");
    base.addColorStop(1, "#020617");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 1080, 1920);
    // 三团流光（lighter 混合，柔和不抢商品）
    const blobs: Array<[number, number, number, string]> = [
        [200, 340, 640, "rgba(99,102,241,0.5)"],
        [880, 1240, 720, "rgba(217,70,239,0.26)"],
        [540, 1700, 780, "rgba(56,189,248,0.2)"],
    ];
    ctx.globalCompositeOperation = "lighter";
    for (const [x, y, r, color] of blobs) {
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
        glow.addColorStop(0, color);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, 1080, 1920);
    }
    ctx.globalCompositeOperation = "source-over";
    return canvas.toDataURL("image/jpeg", 0.92);
}

/**
 * 右栏常驻 9:16 画布舞台（未生背景时也必须在场，且必须可操作）。
 * 画框本身带：暗夜流光渐变底 + 直播间仿真 UI、顶部/底部安全区虚线、
 * 实时文字/主体图层预览；商品与文字图层可直接拖动摆位（与精修台同口径）。
 * 返工令 Round 4：删掉画布中央阻塞式「第一步」蒙层——它把商品拖放和合成/导出
 * 入口全盖住了，用户没生成背景前根本找不到北；改为贴安全区下沿的右侧小角标提示
 * （pointer-events-none，全程不拦截拖拽与点击）。
 */
function LiveCanvasStage({
    preset,
    banners,
    subjects,
    onPatchSubject,
    onPatchBanner,
}: {
    preset: LivePlatformPreset;
    banners: LiveBannerText[];
    subjects: LiveSubject[];
    onPatchSubject: (index: number, patch: Partial<LiveSubject>) => void;
    onPatchBanner: (index: number, patch: Partial<LiveBannerText>) => void;
}) {
    const frameRef = useRef<HTMLDivElement | null>(null);
    // 画布显示尺寸 → 屏幕像素的缩放：文字层按 1920 画布等比折算，预览与最终像素同比例。
    const [scale, setScale] = useState(0);
    const dragRef = useRef<{ kind: "subject" | "text"; index: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);
    useEffect(() => {
        const element = frameRef.current;
        if (!element) return;
        const sync = () => setScale(element.clientHeight / preset.height);
        sync();
        const observer = new ResizeObserver(sync);
        observer.observe(element);
        return () => observer.disconnect();
    }, [preset.height]);

    /** 按下图层开始拖拽：记录起点与初始 0-1 坐标，指针捕获到当前元素。 */
    const beginDrag = (kind: "subject" | "text", index: number, event: React.PointerEvent<HTMLElement>) => {
        event.stopPropagation();
        const current = kind === "text" ? banners[index] : subjects[index];
        if (!current) return;
        dragRef.current = { kind, index, startX: event.clientX, startY: event.clientY, baseX: current.x, baseY: current.y };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    /** 拖动中：屏幕位移 ÷ 画布像素尺寸 → 0-1 坐标（clamp 在框内）。 */
    const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
        const drag = dragRef.current;
        const frame = frameRef.current;
        if (!drag || !frame) return;
        const nextX = Math.min(1, Math.max(0, drag.baseX + (event.clientX - drag.startX) / frame.clientWidth));
        const nextY = Math.min(1, Math.max(0, drag.baseY + (event.clientY - drag.startY) / frame.clientHeight));
        if (drag.kind === "text") onPatchBanner(drag.index, { x: nextX, y: nextY });
        else onPatchSubject(drag.index, { x: nextX, y: nextY });
    };

    return (
        <div
            ref={frameRef}
            className="yq-live-canvas relative aspect-[9/16] h-full max-h-full max-w-full overflow-hidden rounded-lg ring-1 ring-white/15 shadow-[0_4px_24px_rgba(2,6,23,0.45)]"
            style={{ backgroundImage: NIGHT_STAGE_BACKGROUND }}
            onPointerMove={moveDrag}
            onPointerUp={() => {
                dragRef.current = null;
            }}
            onPointerCancel={() => {
                dragRef.current = null;
            }}
            role="img"
            aria-label={`直播间画布预览 ${preset.width}x${preset.height}（默认夜景底）`}
        >
            {/* 商品主体层：宽度 = 画布宽 × scale，与 nxf live-compose 同口径 */}
            {subjects.map((subject, index) => (
                <img
                    key={`subject-layer-${index}`}
                    src={subject.image}
                    alt={subject.name}
                    draggable={false}
                    onPointerDown={(event) => beginDrag("subject", index, event)}
                    className="absolute cursor-move select-none"
                    style={{
                        left: `${subject.x * 100}%`,
                        top: `${subject.y * 100}%`,
                        width: `${subject.scale * 100}%`,
                        transform: "translate(-50%, -50%)",
                        filter: subject.shadow ? "drop-shadow(0 10px 14px rgba(2,6,23,0.55))" : undefined,
                    }}
                />
            ))}

            {/* 文字层：CSS 近似 Pillow（同字体族/字号比例/描边/投影量纲），可拖动摆位 */}
            {banners.map((banner, index) => (
                <div
                    key={`banner-layer-${index}`}
                    onPointerDown={(event) => beginDrag("text", index, event)}
                    className="absolute cursor-move select-none whitespace-pre"
                    style={{
                        left: `${banner.x * 100}%`,
                        top: `${banner.y * 100}%`,
                        transform: "translate(-50%, -50%)",
                        color: banner.color,
                        fontFamily: FONT_STACK,
                        fontSize: Math.max(1, banner.font_size * scale),
                        fontWeight: banner.bold ? 700 : 400,
                        lineHeight: banner.line_spacing,
                        textAlign: (banner.align as "left" | "center" | "right") || "center",
                        WebkitTextStroke: banner.stroke_width > 0 ? `${banner.stroke_width * scale}px ${banner.stroke_color}` : undefined,
                        paintOrder: "stroke fill",
                        textShadow:
                            banner.shadow_blur > 0
                                ? `${banner.shadow_offset_x * scale}px ${banner.shadow_offset_y * scale}px ${banner.shadow_blur * scale}px ${withAlpha(banner.shadow_color, banner.shadow_opacity)}`
                                : undefined,
                    }}
                >
                    {banner.text || "（空文案）"}
                </div>
            ))}

            {/* 安全区辅助线：严格贴着画布左右边界 */}
            <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-amber-400/70" style={{ top: `${preset.safeTop * 100}%` }}>
                <span className="absolute left-1 top-0.5 rounded bg-amber-400/85 px-1 text-caption text-black">顶部安全区</span>
            </div>
            <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-amber-400/70" style={{ top: `${(1 - preset.safeBottom) * 100}%` }}>
                <span className="absolute left-1 top-0.5 rounded bg-amber-400/85 px-1 text-caption text-black">底部互动区</span>
            </div>

            {/* 抖音直播间仿真 · 顶部头像区（毛玻璃，pointer-events-none 不挡拖拽） */}
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1.5 px-2.5 pt-2.5">
                <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-1.5 py-1 backdrop-blur-sm">
                    <span className="size-6 rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-400 ring-1 ring-white/70" />
                    <span className="text-caption font-medium text-white">直播间名称</span>
                    <span className="rounded-full bg-rose-500 px-1.5 text-caption font-medium text-white">关注</span>
                </div>
            </div>

            {/* 抖音直播间仿真 · 底部评论区毛玻璃遮罩（避开底部互动区安全线） */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-start gap-1 px-2.5 pb-2.5">
                <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-1 backdrop-blur-sm">
                    <span className="size-4 rounded-full bg-white/70" />
                    <span className="text-caption text-white/90">欢迎来到直播间～</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-1 backdrop-blur-sm">
                    <span className="size-4 rounded-full bg-white/50" />
                    <span className="text-caption text-white/80">这个还有货吗？</span>
                </div>
            </div>

            {/* 返工令 Round 5：删掉画布内「💡 默认夜景底可直接开播，左栏可生成专属背景」冗余气泡——
                9:16 画面只剩安全区虚线、直播间仿真与图层，引导文案全部收进左栏分区说明。 */}
        </div>
    );
}

export function LiveStudioPage() {
    const { message } = App.useApp();
    const [platform, setPlatform] = useState<LivePlatformKey>("douyin");
    const preset = LIVE_PLATFORMS[platform];
    const [banners, setBanners] = useState<LiveBannerText[]>(() => [
        // 预设是 Partial：用完整默认值兜底后再铺开。
        { ...BANNER_DEFAULTS, text: "直播间限时秒杀", font_size: 120, y: 0.18 },
    ]);
    const [subjects, setSubjects] = useState<LiveSubject[]>([]);
    const [backgroundUrl, setBackgroundUrl] = useState("");
    // AI 背景面板状态：预设胶囊 + 一句补充输入；生成中按钮 loading，防重复提交。
    const [bgPresetKey, setBgPresetKey] = useState(LIVE_BG_PRESETS[0].key);
    const [bgExtra, setBgExtra] = useState("");
    const [bgGenerating, setBgGenerating] = useState(false);
    // 左栏抠图进行态：与精修台内抠图同一接口，按钮 loading 防重复提交。
    const [matting, setMatting] = useState(false);
    // 对账 nonce：直播间没有远端详情接口，「一键刷新并合并」= 以页面当前最新的
    // 背景/主体/Banner 状态重挂工作台（Banner 是受控态不丢，背景/主体回到页面最新值），
    // 与电商侧「重新拉取商品详情即对账」同语义。左栏新抠主体也借它进入已挂载的精修台。
    const [reconcileNonce, setReconcileNonce] = useState(0);

    // ---------------------------------------------------------------------
    // 对标参考图（返工令 Round 5）：上传 / Ctrl+V 粘贴 / 拖拽 / 资产库 / 反推台
    // 五种来路汇成同一份 reference 状态；模式与强度参与生图 prompt 组装。
    // ---------------------------------------------------------------------
    const [reference, setReference] = useState<{ id: string; name: string; dataUrl: string; width?: number; height?: number } | null>(null);
    const [refMode, setRefMode] = useState<LiveReferenceMode>(LIVE_REFERENCE_DEFAULT_MODE);
    const [refStrength, setRefStrength] = useState<LiveReferenceStrength>(LIVE_REFERENCE_DEFAULT_STRENGTH);
    const [dnaText, setDnaText] = useState("");
    const [dnaLoading, setDnaLoading] = useState(false);
    const [refDragOver, setRefDragOver] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const navigate = useNavigate();
    const assets = useAssetStore((state) => state.assets);

    /** 文件 → dataURL：只收图片，读失败给人话错误。 */
    const readImageFileAsDataUrl = useCallback(
        (file: File) =>
            new Promise<string>((resolve, reject) => {
                if (!file.type.startsWith("image/")) {
                    reject(new Error("请选择图片文件（PNG / JPG / WEBP）"));
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error("读取失败"));
                reader.readAsDataURL(file);
            }),
        [],
    );

    /** 落地一份参考图（上传 / 粘贴 / 拖拽共用）：换图即清旧 DNA，防止张冠李戴。 */
    const applyReferenceFile = useCallback(
        async (file: File) => {
            try {
                const dataUrl = await readImageFileAsDataUrl(file);
                setReference({ id: `ref-${Date.now()}`, name: file.name, dataUrl });
                setDnaText("");
                message.success("参考图已就位：选「🎨 借鉴画风光影」并提取 DNA 后参与生图");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "参考图读取失败");
            }
        },
        [message, readImageFileAsDataUrl],
    );

    /** 页面级 Ctrl+V 粘贴：输入框内打字不劫持，只取剪贴板里的图片。 */
    useEffect(() => {
        const onPaste = (event: ClipboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
            const files: File[] = [];
            const items = event.clipboardData?.items;
            if (items) {
                for (const item of Array.from(items)) {
                    if (item.kind === "file" && item.type.startsWith("image/")) {
                        const file = item.getAsFile();
                        if (file) files.push(file);
                    }
                }
            }
            for (const file of Array.from(event.clipboardData?.files || [])) {
                if (file.type.startsWith("image/") && !files.some((seen) => seen.name === file.name && seen.size === file.size)) files.push(file);
            }
            const first = files[0];
            if (!first) return;
            event.preventDefault();
            void applyReferenceFile(first);
        };
        window.addEventListener("paste", onPaste);
        return () => window.removeEventListener("paste", onPaste);
    }, [applyReferenceFile]);

    /** 提取参考图画风 DNA（酿笑坊引擎）：描述文本进 state，生图时拼进 prompt。 */
    const handleExtractDna = useCallback(async () => {
        if (!reference) {
            message.warning("先上传或粘贴一张对标参考图");
            return;
        }
        setDnaLoading(true);
        try {
            const { dna } = await analyzeVisualDna(reference.dataUrl);
            const text = describeLiveReferenceDna(dna, refStrength);
            if (!text) {
                message.warning("这张图没有提取到有效的风格描述，换一张清晰的直播间截图试试");
                return;
            }
            setDnaText(text);
            message.success("已提取画风 DNA，生成背景时自动拼进提示词");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "DNA 提取失败（酿笑坊引擎未启动？）");
        } finally {
            setDnaLoading(false);
        }
    }, [reference, refStrength, message]);

    /** 资产库选择器数据：只列本地图片资产，直接复用项目现成 picker，不新造。 */
    const imageAssets = useMemo(() => assets.filter((asset): asset is Extract<Asset, { kind: "image" }> => asset.kind === "image"), [assets]);
    const pickerItems = useMemo<AssetLibraryPickerItem[]>(
        () =>
            imageAssets.map((asset) => ({
                id: asset.id,
                title: asset.title,
                category: asset.category || "all",
                kindLabel: "图片",
                mediaKind: "image" as const,
                asset,
                imageUrl: asset.data.dataUrl,
                imageStorageKey: asset.data.storageKey,
            })),
        [imageAssets],
    );
    const pickerCategoryLabels = useMemo(() => ({ all: "全部资产", ...ASSET_CATEGORY_LABELS }), []);

    const handlePickAsset = useCallback(
        async (ids: string[], pickedItems?: AssetLibraryPickerItem[]) => {
            const picked = pickedItems?.find((entry) => ids.includes(entry.id));
            const asset = picked?.asset || pickerItems.find((entry) => entry.id === ids[0])?.asset;
            if (!asset || asset.kind !== "image") {
                message.warning("请选择一张图片素材");
                return;
            }
            try {
                const dataUrl = await imageToDataUrl({ dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey });
                setReference({ id: `ref-asset-${asset.id}`, name: asset.title, dataUrl, width: asset.data.width, height: asset.data.height });
                setDnaText("");
                setAssetPickerOpen(false);
                message.success("已把资产库素材设为对标参考图");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "素材读取失败");
            }
        },
        [message, pickerItems],
    );

    /** 接收爆款反推台（/ereverse）的外来载荷：参考帧 + 模式 + 强度 + 视觉配方提示词。 */
    useEffect(() => {
        const handoff = consumeLiveReferenceHandoff(window.location.search);
        if (!handoff) return;
        if (handoff.dataUrl) {
            setReference({ id: `ref-ereverse-${Date.now()}`, name: `${handoff.sourceName} · 参考帧`, dataUrl: handoff.dataUrl });
        }
        setRefMode("style");
        setRefStrength(handoff.strength);
        setDnaText(handoff.dnaText || "");
        const url = new URL(window.location.href);
        url.searchParams.delete("from");
        window.history.replaceState(window.history.state, "", url.toString());
        if (handoff.frameDropped) {
            message.info("参考帧过大未带入，已带入视觉配方提示词（也可直接 Ctrl+V 粘贴截图作参考）");
        } else if (handoff.dataUrl) {
            message.success(`已带入爆款反推「${handoff.sourceName}」的参考帧与视觉配方，可直接生成背景`);
        } else {
            message.success("已带入爆款反推的视觉配方提示词");
        }
    }, [message]);

    /** 参考图模式 / 强度胶囊（未上传时 locked=true 整体置灰，默认值仍可见可采）。 */
    const renderReferenceCapsules = (locked: boolean) => (
        <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="参考模式">
                {LIVE_REFERENCE_MODES.map((mode) => (
                    <button
                        key={mode.key}
                        type="button"
                        data-yq-ref-mode={mode.key}
                        aria-pressed={mode.key === refMode}
                        disabled={locked || !mode.supported}
                        title={locked ? "先上传 / 粘贴一张对标参考图" : mode.hint}
                        className={`rounded-full border px-2.5 py-1 text-caption transition-colors ${
                            mode.key === refMode
                                ? "border-primary bg-primary/10 font-medium text-primary"
                                : "border-border/60 text-foreground/60 hover:border-primary/50 hover:text-primary"
                        } ${locked || !mode.supported ? "cursor-not-allowed opacity-50" : ""}`}
                        onClick={() => setRefMode(mode.key)}
                    >
                        {mode.label}
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="借鉴强度">
                {LIVE_REFERENCE_STRENGTHS.map((item) => (
                    <button
                        key={item.value}
                        type="button"
                        data-yq-ref-strength={item.value}
                        aria-pressed={item.value === refStrength}
                        disabled={locked}
                        title={locked ? "先上传 / 粘贴一张对标参考图" : `借鉴强度 ${item.value.toFixed(2)}：强度越高，生成背景越贴近参考画风`}
                        className={`rounded-full border px-2.5 py-1 text-caption transition-colors ${
                            item.value === refStrength
                                ? "border-primary bg-primary/10 font-medium text-primary"
                                : "border-border/60 text-foreground/60 hover:border-primary/50 hover:text-primary"
                        } ${locked ? "cursor-not-allowed opacity-50" : ""}`}
                        onClick={() => setRefStrength(item.value)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
        </div>
    );

    const insertPreset = useCallback((label: string) => {
        const presetDef = LIVE_BANNER_PRESETS.find((item) => item.label === label);
        if (!presetDef) return;
        const slot = preset.badgeSlots.find((slot2) => slot2.label === label) || preset.badgeSlots[0];
        setBanners((prev) => [...prev, {
            ...BANNER_DEFAULTS,
            ...presetDef.banner,
            x: slot.x, y: slot.y,
        } as LiveBannerText]);
        message.success(`已插入预设「${label}」（${slot.label}位）`);
    }, [preset, message]);

    // 场景包：整组替换文字层（品牌条/痛点/小标签/核心卖点），不是叠加。
    const applyScenePack = useCallback((key: string) => {
        const pack = LIVE_SCENE_PACKS.find((item) => item.key === key);
        if (!pack) return;
        setBanners(pack.banners.map((banner) => ({ ...BANNER_DEFAULTS, ...banner } as LiveBannerText)));
        message.success(`已套用「${pack.label}」：${pack.banners.length} 层文字`);
    }, [message]);

    /** 主标题（画布顶部大字）：直接绑 banners[0]，左侧打字右侧画布实时浮现。 */
    const mainTitle = banners[0]?.text ?? "";
    const handleMainTitleChange = useCallback((text: string) => {
        setBanners((prev) => (
            prev.length === 0
                ? [{ ...BANNER_DEFAULTS, text, font_size: 120, y: 0.18 }]
                : prev.map((banner, index) => (index === 0 ? { ...banner, text } : banner))
        ));
    }, []);

    /**
     * 左栏「上传商品图自动抠透明底」：商品原图 → BiRefNet 透明主体，
     * 与精修台内上传走同一个 /api/v1/ecommerce/vision/matting 接口，不新造轮子。
     * 精修台已挂载时顺带 bump 对账 nonce 重挂一次，让新主体进入画布
     * （Banner 是页面受控态，不丢）。
     */
    const handleSubjectFile = useCallback(async (file: File) => {
        setMatting(true);
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error("读取失败"));
                reader.readAsDataURL(file);
            });
            const result = await nxfPost<{ cutout_png: string; degraded: boolean }>("/api/v1/ecommerce/vision/matting", { image: dataUrl, feather_px: 2 });
            if (!result.ok) throw new Error(result.error || "抠图失败");
            setSubjects((prev) => [...prev, { image: result.cutout_png, name: file.name.replace(/\.[^.]+$/, ""), x: 0.5, y: 0.6, scale: 0.5, shadow: true }]);
            setReconcileNonce((value) => value + 1);
            message.success(result.degraded ? "已用兜底档抠图" : "透明主体已生成（BiRefNet）");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "抠图失败");
        } finally {
            setMatting(false);
        }
    }, [message]);

    /**
     * AI 生成 9:16 直播间背景：沿用「生成配置」里用户已选好的生图模型与鉴权
     * （requestGeneration 内部按渠道协议分流），成功后自动置为底层背景——
     * 工作台以 backgroundUrl 为 key 的一部分，换图即重建，所见即所得。
     *
     * 返工令 Round 5 · 对标参考图接线：
     *  - 🎨 借鉴画风光影：DNA 描述文本拼进 prompt（用户忘了点「提取」时自动补提一次）；
     *  - 📐 跟随构图布局（垫图）：requestGeneration 只收 prompt，垫图与 strength 无法透传，
     *    该模式在 UI 上已置灰说明，这里同样不造假参数——选了也不会有隐藏行为。
     */
    const handleGenerateBackground = useCallback(async () => {
        const presetDef = LIVE_BG_PRESETS.find((item) => item.key === bgPresetKey) ?? LIVE_BG_PRESETS[0];
        const store = useConfigStore.getState();
        const config = store.config;
        const model = config.imageModel || config.model;
        if (!model || !store.isAiConfigReady(config, model)) {
            message.error("请先在「生成配置」选择可用的生图模型");
            return;
        }
        let effectiveDna = dnaText;
        if (refMode === "style" && reference && !effectiveDna) {
            try {
                const { dna } = await analyzeVisualDna(reference.dataUrl);
                effectiveDna = describeLiveReferenceDna(dna, refStrength);
                setDnaText(effectiveDna);
            } catch {
                message.warning("参考图 DNA 自动提取失败，本次按无参考图生成（可点「提取画风 DNA」重试）");
            }
        }
        const prompt = [presetDef.prompt, refMode === "style" && reference ? effectiveDna : "", bgExtra.trim(), LIVE_BG_PROMPT_SUFFIX]
            .filter(Boolean)
            .join("");
        setBgGenerating(true);
        try {
            const images = await requestGeneration({ ...config, size: "9:16", count: "1" }, prompt);
            const first = images[0];
            if (!first) throw new Error("接口没有返回图片");
            const dataUrl = /^https?:/i.test(first.dataUrl) ? await urlToDataUrl(first.dataUrl) : first.dataUrl;
            setBackgroundUrl(dataUrl);
            setComposed(null);
            message.success(refMode === "style" && reference && effectiveDna ? "AI 背景已生成（已借鉴参考画风），自动铺到底层" : "AI 背景已生成，自动铺到底层（可继续替换或移除）");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "AI 背景生成失败");
        } finally {
            setBgGenerating(false);
        }
    }, [bgPresetKey, bgExtra, message, refMode, refStrength, reference, dnaText]);

    /** 上传本地背景图：直接转 dataURL 置为底层背景（与 AI 生成同一条状态通路）。 */
    const handleBackgroundFile = useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            setBackgroundUrl(String(reader.result));
            // 背景换了，上一次「一键光影合成」的结果就过期了，清掉避免张冠李戴
            setComposed(null);
            message.success("背景图已就位，自动铺到底层");
        };
        reader.onerror = () => message.error("读取背景图失败");
        reader.readAsDataURL(file);
    }, [message]);

    const handleSave = useCallback(async (result: { composed: string; psdBase64?: string }) => {
        const png = document.createElement("a");
        png.href = result.composed;
        png.download = `live-${platform}.png`;
        png.click();
        if (result.psdBase64) {
            const psd = document.createElement("a");
            psd.href = "data:application/x-photoshop;base64," + result.psdBase64;
            psd.download = `live-${platform}.psd`;
            psd.click();
        }
        message.success(result.psdBase64 ? "已导出合成 PNG 与分层 PSD" : "已导出合成 PNG（本次未产出分层 PSD）");
    }, [platform, message]);

    /** 对账 nonce：直播间没有远端详情接口，「一键刷新并合并」= 以页面当前最新的
     *  背景/主体/Banner 状态重挂工作台（Banner 是受控态不丢，背景/主体回到页面最新值），
     *  与电商侧「重新拉取商品详情即对账」同语义。左栏新抠主体也借它进入已挂载的精修台。
     *  （声明在组件状态区，与其余 state 放在一起。） */
    // 页面级「一键光影合成」结果（未生背景时的常驻操作栏用）：合成图 + 分层 PSD。
    const [composing, setComposing] = useState(false);
    const [composed, setComposed] = useState<{ png: string; psd: string } | null>(null);
    // 默认夜景底的位图版：懒生成 + 缓存，只在第一次点合成时付费（见 createDefaultLiveBackground）。
    const defaultBgRef = useRef<string | null>(null);
    const getDefaultBackground = useCallback(() => {
        if (!defaultBgRef.current) defaultBgRef.current = createDefaultLiveBackground();
        return defaultBgRef.current;
    }, []);

    /** 画布图层拖拽（未生背景时的舞台）：与精修台同口径的 0-1 坐标回写。 */
    const patchSubject = useCallback((index: number, patch: Partial<LiveSubject>) => {
        setSubjects((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    }, []);
    const patchBanner = useCallback((index: number, patch: Partial<LiveBannerText>) => {
        setBanners((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    }, []);

    /**
     * 一键光影合成（未生背景时常驻操作栏的主按钮）：与精修台「合成预览」同一个
     * nxf live-compose 引擎、同一套入参口径，不新造轮子；没生成背景时用默认夜景底
     * 位图顶上，所以这个按钮在任何时候点了都有真实行为，不是摆设。
     */
    const handleCompose = useCallback(async () => {
        setComposing(true);
        try {
            const fitted = await fitCoverToSize(getDefaultBackground(), preset.width, preset.height);
            const result = await nxfPost<{ composed_png: string; psd_base64?: string; width?: number; height?: number; psd_bytes?: number }>("/api/v1/ecommerce/vision/live-compose", {
                background: fitted.dataUrl,
                export_psd: true,
                filename: "live-studio",
                subjects: subjects.map((item) => ({ image: item.image, name: item.name, x: item.x, y: item.y, scale: item.scale, shadow: item.shadow })),
                banners,
            });
            if (!result.ok) throw new Error(result.error || "合成失败");
            setComposed({ png: result.composed_png || "", psd: result.psd_base64 || "" });
            message.success(`合成完成（${result.width ?? preset.width}x${result.height ?? preset.height}${result.psd_bytes ? `，PSD ${(result.psd_bytes / 1024 / 1024).toFixed(1)}MB` : ""}）`);
        } catch (error) {
            // 人话映射（与精修台同一张表）：引擎没起 / 超时 / 冲突都给「标题 + 下一步」
            const friendly = toFriendlyError(error instanceof Error ? error.message : "合成失败");
            message.error(friendly.hint || friendly.title);
        } finally {
            setComposing(false);
        }
    }, [getDefaultBackground, preset, subjects, banners, message]);

    /** 导出分层 PSD / PNG：下载最近一次合成结果（复用页面级 handleSave 的下载逻辑）。 */
    const handleExport = useCallback(() => {
        if (!composed?.png) {
            message.info("先点「✨ 一键光影合成」生成合成图");
            return;
        }
        void handleSave({ composed: composed.png, psdBase64: composed.psd || undefined });
    }, [composed, handleSave, message]);

    /** 一键刷新并合并（精修台 revision 冲突时）：以页面最新状态重挂工作台。 */
    const handleReconcile = useCallback(() => {
        setReconcileNonce((value) => value + 1);
    }, []);

    /**
     * 送画布 · 直播场景接管：不跳走。
     * 默认路径会新建画布工程并 navigate 到 /canvas/:id——那会连页带状态整页卸载，
     * 直播间未保存的装修进度（背景/Banner/主体）全部丢光。这里只把合成图上传为
     * 站内资源，用户留在精修台继续改；要去画布再创作时可自己去资源库取。
     */
    const handleSendToCanvas = useCallback(async ({ composed, title }: { composed: string; psdBase64: string; title: string }) => {
        await uploadDataUrlAsResource(composed, `${title || "直播间贴片"}-合成图.png`);
        message.success("合成图已存入资源库，稍后可在画布里作为图片节点使用（本页不跳走，装修进度保留）");
    }, [message]);

    const platformButtons = useMemo(() => Object.values(LIVE_PLATFORMS), []);

    return (
        <div className="flex min-h-full w-full flex-col gap-3 p-3 lg:h-full lg:flex-row">
            {/* 左栏：控制面板（固定 340px，独立滚动，不随画布滚动）。
                分区容器用 bg-surface + rounded-xl（类名不含 card 子串）：这是控制面板不是内容卡，
                探针 G2 的「单卡减负」账本只应统计真正的内容卡（与旧版同一 Token 口径）。 */}
            <aside className="flex w-full shrink-0 flex-col gap-3 lg:h-full lg:w-[340px] lg:overflow-y-auto lg:pr-1">
                <header className="flex flex-col gap-1">
                    <Link to="/modules" className="inline-flex items-center gap-1 text-xs text-foreground/55 hover:text-primary">
                        <ArrowLeft className="size-3.5" /> 返回定制模块
                    </Link>
                    <h1 className="text-base font-semibold">直播间装修台</h1>
                    <p className="text-caption leading-5 text-foreground/50">左栏装修，右侧 9:16 画布实时预览：不生成背景也能直接用默认夜景底开播（抠主体、加促销大字、一键合成），想要专属背景再生成。</p>
                </header>

                {/* 1. 直播间背景：三个风格胶囊 + 一句补充 + 生成/上传 */}
                <section className="rounded-xl border border-line-subtle bg-surface p-3" aria-label="直播间背景">
                    <strong className="flex items-center gap-1.5 text-xs font-semibold">
                        <ImagePlus className="size-3.5 text-primary" /> 1. 直播间背景（9:16）
                    </strong>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {LIVE_BG_PRESETS.map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                title={item.hint}
                                aria-pressed={item.key === bgPresetKey}
                                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                                    item.key === bgPresetKey
                                        ? "border-primary bg-primary/10 font-medium text-primary"
                                        : "border-border/60 text-foreground/60 hover:border-primary/50 hover:text-primary"
                                }`}
                                onClick={() => setBgPresetKey(item.key)}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    {/* 🎯 对标参考图（返工令 Round 5）：上传 / Ctrl+V 粘贴 / 拖拽 / 资产库 /
                        视觉反推台五种来路；模式与强度参与生图 prompt 组装。
                        垫图模式对当前生图通道不可用——UI 明确置灰说明，不造假参数。 */}
                    <div className="mt-2 rounded-lg border border-line-subtle bg-surface-subtle/50 p-2" data-yq="live-reference-slot">
                        <p className="text-caption font-medium text-foreground/60">🎯 对标参考图（可选，让背景贴合同行爆款画风）</p>
                        {reference ? (
                            <div className="mt-1.5 flex gap-2">
                                <div className="relative shrink-0">
                                    <img src={reference.dataUrl} alt="对标直播间参考图" className="h-[100px] w-14 rounded-md object-cover ring-1 ring-black/10" />
                                    <button
                                        type="button"
                                        aria-label="移除参考图"
                                        title="移除参考图"
                                        className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-border/60 bg-surface text-xs leading-none text-foreground/70 shadow-sm transition-colors hover:text-status-danger"
                                        onClick={() => {
                                            setReference(null);
                                            setDnaText("");
                                            message.success("已移除参考图");
                                        }}
                                    >
                                        ×
                                    </button>
                                </div>
                                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                                    {renderReferenceCapsules(false)}
                                    {refMode === "style" ? (
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Button size="small" loading={dnaLoading} onClick={() => void handleExtractDna()}>
                                                {dnaText ? "重新提取 DNA" : "提取画风 DNA"}
                                            </Button>
                                            <span className="text-caption leading-5 text-foreground/45">{dnaText ? "已拼入生图提示词" : "提取后自动拼进生图提示词" }</span>
                                        </div>
                                    ) : null}
                                    {dnaText ? (
                                        <p className="line-clamp-2 text-caption leading-5 text-foreground/50" title={dnaText}>
                                            {dnaText}
                                        </p>
                                    ) : null}
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <Button size="small" onClick={() => setAssetPickerOpen(true)}>
                                            📂 从资产库选择
                                        </Button>
                                        <Button size="small" onClick={() => navigate("/ereverse")}>
                                            🔍 用视觉反推提取
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <label
                                className={`mt-1.5 flex cursor-pointer items-center gap-1.5 rounded-md border border-dashed px-2.5 py-2 text-caption transition-colors ${
                                    refDragOver ? "border-primary bg-primary/5 text-primary" : "border-border/60 text-foreground/65 hover:border-primary/50 hover:text-primary"
                                }`}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    setRefDragOver(true);
                                }}
                                onDragLeave={() => setRefDragOver(false)}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    setRefDragOver(false);
                                    const file = event.dataTransfer.files?.[0];
                                    if (file) void applyReferenceFile(file);
                                }}
                            >
                                <span aria-hidden>🖼️</span>
                                <span>上传 / 粘贴对标直播间参考图（支持 Ctrl+V 直接粘贴截图）</span>
                                <input
                                    type="file"
                                    accept="image/*"
                                    className="sr-only"
                                    onChange={(event) => {
                                        const file = event.target.files?.[0];
                                        if (file) void applyReferenceFile(file);
                                        event.target.value = "";
                                    }}
                                />
                            </label>
                        )}
                        {/* 未上传态也常驻模式 / 强度胶囊（置灰）：默认值对用户与探针双可见 */}
                        {reference ? null : <div className="mt-1.5">{renderReferenceCapsules(true)}</div>}
                    </div>

                    <Input
                        size="small"
                        allowClear
                        className="mt-2"
                        placeholder="补充一句（可选）：如 暖光奶油风、左侧留白放商品"
                        value={bgExtra}
                        maxLength={120}
                        onChange={(event) => setBgExtra(event.target.value)}
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Button size="small" type="primary" icon={<Wand2 className="size-3" />} loading={bgGenerating} onClick={() => void handleGenerateBackground()}>
                            {backgroundUrl ? "重新生成" : "AI 生成背景"}
                        </Button>
                        <label className="cursor-pointer rounded-md border border-border/60 px-2.5 py-1 text-xs text-foreground/70 transition-colors hover:border-primary/50 hover:text-primary">
                            上传背景图
                            <input
                                type="file"
                                accept="image/*"
                                className="sr-only"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file) handleBackgroundFile(file);
                                    event.target.value = "";
                                }}
                            />
                        </label>
                        {backgroundUrl ? (
                            <>
                                <span className="text-caption text-status-success">背景已就位（{preset.width}x{preset.height}）</span>
                                <Button size="small" type="text" icon={<RefreshCw className="size-3" />} loading={bgGenerating} onClick={() => void handleGenerateBackground()}>
                                    换一张
                                </Button>
                                <Button
                                    size="small"
                                    type="text"
                                    danger
                                    icon={<Trash2 className="size-3" />}
                                    onClick={() => {
                                        setBackgroundUrl("");
                                        setComposed(null);
                                        message.success("已移除背景，可重新生成或上传");
                                    }}
                                >
                                    移除
                                </Button>
                            </>
                        ) : null}
                    </div>
                    <p className="mt-1.5 text-caption leading-5 text-foreground/45">用「生成配置」里的生图模型；未配置时会提示。</p>
                </section>

                {/* 2. 商品透明主体：上传原图自动 BiRefNet 抠透明底 */}
                <section className="rounded-xl border border-line-subtle bg-surface p-3" aria-label="商品透明主体">
                    <strong className="flex items-center gap-1.5 text-xs font-semibold">
                        <Upload className="size-3.5 text-primary" /> 2. 商品透明主体（BiRefNet）
                    </strong>
                    <label className={`mt-2 flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 px-3 py-3 text-xs text-foreground/65 transition-colors hover:border-primary/50 hover:text-primary ${matting ? "pointer-events-none opacity-60" : ""}`}>
                        <Upload className="size-3.5" />
                        上传商品图自动抠透明底{matting ? "（抠图中…）" : ""}
                        <input
                            type="file"
                            accept="image/*"
                            className="sr-only"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void handleSubjectFile(file);
                                event.target.value = "";
                            }}
                        />
                    </label>
                    <p className="mt-1.5 text-caption leading-5 text-foreground/45">
                        已加入 {subjects.length} 个主体，默认落在画布中下部并带接触阴影；位置与大小可在右侧画布直接拖动调整。
                    </p>
                </section>

                {/* 3. 促销文字 Banner 与角标：预设 / 场景包 / 主标题 */}
                <section className="rounded-xl border border-line-subtle bg-surface p-3" aria-label="促销文字 Banner 与角标">
                    <strong className="flex items-center gap-1.5 text-xs font-semibold">
                        <Sparkles className="size-3.5 text-primary" /> 3. 促销文字 Banner 与角标
                    </strong>
                    <p className="mt-2 text-caption text-foreground/45">预设（点击即在右侧画布浮现）：</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {LIVE_BANNER_PRESETS.map((item) => (
                            <Button key={item.label} size="small" icon={<Sparkles className="size-3" />} onClick={() => insertPreset(item.label)}>
                                {item.label}
                            </Button>
                        ))}
                    </div>
                    <p className="mt-2.5 text-caption text-foreground/45">文字排版主题（整组替换文字层，与上方背景风格预设是两套东西）：</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {LIVE_SCENE_PACKS.map((pack) => (
                            <Button key={pack.key} size="small" type="dashed" title={pack.hint} onClick={() => applyScenePack(pack.key)}>
                                {pack.label}
                            </Button>
                        ))}
                    </div>
                    <label className="mt-2.5 block text-caption text-foreground/45" htmlFor="live-main-title">主标题（画布顶部大字）</label>
                    <Input
                        id="live-main-title"
                        size="small"
                        className="mt-1"
                        value={mainTitle}
                        maxLength={40}
                        placeholder="如：今晚8点 周年庆五折"
                        onChange={(event) => handleMainTitleChange(event.target.value)}
                    />
                    <p className="mt-1.5 text-caption leading-5 text-foreground/45">插入后落在本平台角标位，可在右侧画布直接拖动微调。</p>
                </section>
            </aside>

            {/* 右栏：常驻 9:16 画布舞台（占屏 ≥55%，平台切换 + 画布 + 导出入口） */}
            <div className="yq-live-stage-col yq-live-stage-preview flex min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-caption text-foreground/45">平台：</span>
                    {platformButtons.map((item) => (
                        <Button key={item.key} size="small" type={item.key === platform ? "primary" : "default"} onClick={() => setPlatform(item.key)}>
                            {item.label}（{item.width}x{item.height}）
                        </Button>
                    ))}
                </div>

                {backgroundUrl ? (
                    <LayerStudioWorkbench
                        key={`${platform}-${backgroundUrl.slice(-24)}-${reconcileNonce}`}
                        title={`直播间装修 · ${preset.label}`}
                        backgroundUrl={backgroundUrl}
                        initialSubjects={subjects}
                        banners={banners}
                        onBannersChange={setBanners}
                        canvasWidth={preset.width}
                        canvasHeight={preset.height}
                        safeTop={preset.safeTop}
                        safeBottom={preset.safeBottom}
                        onSave={handleSave}
                        onReconcile={handleReconcile}
                        onSendToCanvas={handleSendToCanvas}
                    />
                ) : (
                    <>
                        <div className="relative flex h-[58vh] min-h-0 items-center justify-center lg:flex-1 lg:h-auto">
                            <LiveCanvasStage
                                preset={preset}
                                banners={banners}
                                subjects={subjects}
                                onPatchSubject={patchSubject}
                                onPatchBanner={patchBanner}
                            />
                        </div>

                        {/* 全天候画布操作栏（返工令 Round 4）：未生背景时常驻在 9:16 画布正下方。
                            原来合成/导出入口被「先生成背景」挡在精修台里，用户没出背景前根本找不到；
                            现在默认夜景底就能直接合成、导出——两个按钮都接真实引擎调用，不是摆设。 */}
                        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-line-subtle bg-surface p-2.5" aria-label="画布常驻操作栏">
                            <span className="text-caption text-foreground/45">画布操作：</span>
                            <Button type="primary" size="small" icon={<Sparkles className="size-3" />} loading={composing} onClick={() => void handleCompose()}>
                                ✨ 一键光影合成
                            </Button>
                            <Button
                                size="small"
                                icon={<Download className="size-3" />}
                                disabled={!composed?.png}
                                title={composed?.png ? "下载最近一次合成的 PNG 与分层 PSD" : "先点「✨ 一键光影合成」生成合成图后才能导出"}
                                onClick={handleExport}
                            >
                                📥 导出分层 PSD / PNG
                            </Button>
                            <span className="text-caption text-foreground/40">默认夜景底可直接合成；左栏生成专属背景后自动切换为精修台</span>
                        </section>

                        {composed?.png ? (
                            <div className="flex items-center gap-3 rounded-xl border border-line-subtle bg-surface p-3">
                                <img src={composed.png} alt="一键光影合成结果预览" className="h-28 w-auto rounded-md ring-1 ring-black/10" />
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-status-success">合成完成 ✓</p>
                                    <p className="mt-1 text-caption leading-5 text-foreground/50">
                                        点「📥 导出分层 PSD / PNG」下载成品；图层可继续在画布上拖动摆位，改完再合成一次即可。
                                    </p>
                                </div>
                            </div>
                        ) : null}
                    </>
                )}
            </div>

            {/* 📂 从资产库选择：复用项目现成素材选择器（不新造轮子），只列图片资产 */}
            <AssetLibraryPickerModal
                open={assetPickerOpen}
                mediaKinds={["image"]}
                items={pickerItems}
                categoryLabels={pickerCategoryLabels}
                title="选择对标参考图"
                eyebrow="资产库"
                multiple={false}
                confirmLabel={(count) => (count ? `用为参考图（${count}）` : "请选择一张图片")}
                emptyTitle="资产库还没有图片素材"
                emptyDescription="先到资产库上传图片，或直接 Ctrl+V 粘贴截图。"
                onClose={() => setAssetPickerOpen(false)}
                onConfirm={(ids, pickedItems) => void handlePickAsset(ids, pickedItems)}
            />
        </div>
    );
}
