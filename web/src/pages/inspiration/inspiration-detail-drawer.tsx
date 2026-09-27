import { VideoPlayer } from "@/components/video-player";
import { App, Badge, Button, Drawer, Segmented, Tabs, Tag } from "antd";
import copy from "copy-to-clipboard";
import {
    Award,
    Check,
    ChevronRight,
    Clapperboard,
    Clock,
    Copy,
    ExternalLink,
    Flame,
    Heart,
    Info,
    Layers,
    Play,
    ShieldAlert,
    ShieldCheck,
    Sliders,
    Sparkles,
    Video,
    Volume2,
    VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InspirationCase, InspirationCaseDetail, InspirationPrompt, InspirationRetest } from "@/services/api/inspiration";

interface InspirationDetailDrawerProps {
    open: boolean;
    onClose: () => void;
    detail: InspirationCaseDetail | null;
    loading?: boolean;
    onToggleFavorite?: (id: number) => void;
    onOpenLicenseModal?: (slug: string, sourceUrl: string) => void;
}

export function InspirationDetailDrawer({
    open,
    onClose,
    detail,
    loading,
    onToggleFavorite,
    onOpenLicenseModal,
}: InspirationDetailDrawerProps) {
    const { message } = App.useApp();
    const [activePromptIndex, setActivePromptIndex] = useState(0);
    const [compareMode, setCompareMode] = useState<"switch" | "sideBySide">("switch");
    const [activeVideoTrack, setActiveVideoTrack] = useState<"origin" | "local" | "official">("origin");
    const [syncPlay, setSyncPlay] = useState(false);
    const [copiedPrompt, setCopiedPrompt] = useState(false);
    const [copiedSlug, setCopiedSlug] = useState(false);

    const leftVideoRef = useRef<HTMLVideoElement>(null);
    const rightVideoRef = useRef<HTMLVideoElement>(null);

    const currentCase = detail?.case;
    const retests = detail?.retests || [];

    // 区分本地复测与官方基线
    const localRetest = useMemo(() => retests.find((r) => r.origin === "local"), [retests]);
    const officialRetest = useMemo(() => retests.find((r) => r.origin === "goodcase"), [retests]);

    // 重置抽屉状态
    useEffect(() => {
        if (open) {
            setActivePromptIndex(0);
            setActiveVideoTrack(localRetest ? "local" : "origin");
        }
    }, [open, localRetest]);

    if (!currentCase) return null;

    const prompts = currentCase.prompts || [];
    const activePrompt: InspirationPrompt | undefined = prompts[activePromptIndex];

    // 获取当前播放视频地址
    const originVideoUrl = currentCase.mediaUrl || "";
    const localVideoUrl = localRetest?.videoUrl
        ? localRetest.videoUrl.startsWith("http")
            ? localRetest.videoUrl
            : `${localRetest.videoUrl}`
        : localRetest?.videoPath
        ? `/api/inspiration/media/${currentCase.sourceId}/${localRetest.videoPath.split("/").pop()}`
        : "";

    // 复制提示词（含作者出处署名规范）
    const handleCopyPrompt = () => {
        const pText = activePrompt?.text || currentCase.summary || "";
        const neg = activePrompt?.negativePrompt ? `\nNegative Prompt: ${activePrompt.negativePrompt}` : "";
        const full = `${pText}${neg}

---
[来源与版权出处 / Attribution & Copyright]:
- 作品名称: ${currentCase.title}
- 原始创作者: @${currentCase.creator || "社区作者"}
- 原帖公开地址: ${currentCase.sourceUrl || "无"}
- GoodCase档案记录: ${currentCase.goodcaseUrl || "无"}
- 案例唯一标识: ${currentCase.sourceId}
- 许可声明: 提示词版权严格归原作者所有，引用与复现评估遵循 CC BY 4.0 整理规范。`;
        copy(full);
        setCopiedPrompt(true);
        message.success("已复制完整提示词（含原作者与出处署名）");
        setTimeout(() => setCopiedPrompt(false), 2000);
    };

    // 复制 Slug 标识
    const handleCopySlug = () => {
        copy(currentCase.sourceId);
        setCopiedSlug(true);
        message.success("已复制案例 Slug 标识符");
        setTimeout(() => setCopiedSlug(false), 2000);
    };

    // 双屏联动播放控制
    const toggleSyncPlay = () => {
        const next = !syncPlay;
        setSyncPlay(next);
        if (leftVideoRef.current && rightVideoRef.current) {
            if (next) {
                leftVideoRef.current.currentTime = 0;
                rightVideoRef.current.currentTime = 0;
                leftVideoRef.current.play().catch(() => {});
                rightVideoRef.current.play().catch(() => {});
            } else {
                leftVideoRef.current.pause();
                rightVideoRef.current.pause();
            }
        }
    };

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={740}
            destroyOnClose
            className="app-inspiration-drawer"
            title={
                <div className="flex items-center justify-between pr-4">
                    <div className="min-w-0 flex items-center gap-2">
                        <span className="truncate font-semibold text-foreground text-base max-w-[420px]" title={currentCase.title}>
                            {currentCase.title}
                        </span>
                        {currentCase.reproStatus === "done" && (
                            <Tag color="success" className="m-0 text-[10px]">
                                H3 已复现
                            </Tag>
                        )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {onToggleFavorite && (
                            <Button
                                size="small"
                                type={currentCase.favorited ? "primary" : "default"}
                                danger={currentCase.favorited}
                                icon={<Heart className={`size-3.5 ${currentCase.favorited ? "fill-white" : ""}`} />}
                                onClick={() => onToggleFavorite(currentCase.id)}
                            >
                                {currentCase.favorited ? "已收藏" : "收藏"}
                            </Button>
                        )}
                        <Button
                            size="small"
                            type="dashed"
                            icon={<ShieldCheck className="size-3.5 text-emerald-500" />}
                            onClick={() => onOpenLicenseModal?.(currentCase.sourceId, currentCase.sourceUrl)}
                        >
                            授权说明
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-6 pb-12">
                {/* 顶部元数据与出处卡片 */}
                <div className="rounded-xl border border-border/70 bg-surface/50 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                            {/* 创作者署名 */}
                            <span className="font-medium text-foreground text-sm flex items-center gap-1.5">
                                <span className="text-foreground/50">创作者:</span>
                                <span className="font-semibold text-primary">@{currentCase.creator || "社区创作者"}</span>
                            </span>

                            {/* 热度徽章 */}
                            <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                <Flame className="size-3 fill-current" />
                                热度 {Math.round(currentCase.score)}
                            </span>

                            {/* 模板分类 */}
                            {currentCase.categoryName && (
                                <Tag color="processing" className="m-0">
                                    {currentCase.categoryName}
                                </Tag>
                            )}

                            {/* 模型 */}
                            <Tag className="m-0 font-mono text-xs">{currentCase.modelFamily}</Tag>
                        </div>

                        {/* 案例唯一 Slug 复制 */}
                        <div className="flex items-center gap-1 text-xs">
                            <span className="text-foreground/40 font-mono text-[11px] truncate max-w-[140px]" title={currentCase.sourceId}>
                                {currentCase.sourceId}
                            </span>
                            <button
                                type="button"
                                onClick={handleCopySlug}
                                className="text-foreground/50 hover:text-primary transition-colors"
                                title="复制案例 Slug"
                            >
                                {copiedSlug ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                            </button>
                        </div>
                    </div>

                    {/* 公开出处溯源链接条（用户第1点核心要求） */}
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-1">
                        <div className="flex items-center gap-3">
                            <span className="text-foreground/50">公开来源出处:</span>
                            {currentCase.sourceUrl ? (
                                <a
                                    href={currentCase.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
                                >
                                    <span>查看原始发布帖子</span>
                                    <ExternalLink className="size-3" />
                                </a>
                            ) : (
                                <span className="text-foreground/40">公开网络整理</span>
                            )}
                            {currentCase.goodcaseUrl && (
                                <a
                                    href={currentCase.goodcaseUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="inline-flex items-center gap-1 text-primary/80 hover:underline"
                                >
                                    <span>GoodCase 评测档案</span>
                                    <ExternalLink className="size-3" />
                                </a>
                            )}
                        </div>

                        {/* 版权合规徽章 */}
                        <span className="text-[11px] text-foreground/45 flex items-center gap-1">
                            <ShieldCheck className="size-3 text-emerald-500" />
                            CC BY 4.0 整理 · 原作者版权保留
                        </span>
                    </div>

                    {/* 摘要说明 */}
                    {currentCase.summary && (
                        <p className="text-xs text-foreground/75 leading-relaxed bg-background/50 p-2.5 rounded-lg border border-border/30">
                            {currentCase.summary}
                        </p>
                    )}
                </div>

                {/* 视频画布对比竞技场 (Video Canvas Arena) */}
                {currentCase.mediaType === "video" && (
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Clapperboard className="size-4 text-primary" />
                                <span className="font-semibold text-foreground text-sm">视频画布对比竞技场 (Comparative Arena)</span>
                            </div>

                            {/* 对比模式切换 */}
                            {localVideoUrl && originVideoUrl && (
                                <div className="flex items-center gap-2">
                                    <Segmented
                                        size="small"
                                        value={compareMode}
                                        onChange={(val) => setCompareMode(val as "switch" | "sideBySide")}
                                        options={[
                                            { label: "单轨切换", value: "switch" },
                                            { label: "双屏并排对比", value: "sideBySide" },
                                        ]}
                                    />
                                    {compareMode === "sideBySide" && (
                                        <Button
                                            size="small"
                                            type={syncPlay ? "primary" : "default"}
                                            icon={<Play className="size-3" />}
                                            onClick={toggleSyncPlay}
                                        >
                                            {syncPlay ? "暂停双轨" : "同步播放"}
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* 单轨切换模式 */}
                        {compareMode === "switch" ? (
                            <div className="space-y-2">
                                {/* 轨道切换 Tab */}
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setActiveVideoTrack("origin")}
                                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                                            activeVideoTrack === "origin"
                                                ? "bg-primary text-primary-foreground shadow-sm"
                                                : "bg-surface text-foreground/70 hover:bg-muted"
                                        }`}
                                    >
                                        原作基线 (Seedance 2.5)
                                    </button>
                                    {localVideoUrl && (
                                        <button
                                            type="button"
                                            onClick={() => setActiveVideoTrack("local")}
                                            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5 ${
                                                activeVideoTrack === "local"
                                                    ? "bg-emerald-600 text-white shadow-sm"
                                                    : "bg-surface text-foreground/70 hover:bg-muted"
                                            }`}
                                        >
                                            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            本地实测产物 (MiniMax H3)
                                        </button>
                                    )}
                                </div>

                                {/* 播放器 */}
                                <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-border/80 bg-black shadow-inner">
                                    {activeVideoTrack === "origin" && originVideoUrl ? (
                                        <VideoPlayer
                                            src={originVideoUrl}
                                            title={`${currentCase.title} - 原版`}
                                            className="h-full w-full"
                                        />
                                    ) : activeVideoTrack === "local" && localVideoUrl ? (
                                        <VideoPlayer
                                            src={localVideoUrl}
                                            title={`${currentCase.title} - MiniMax H3 本地复现`}
                                            className="h-full w-full"
                                        />
                                    ) : (
                                        <div className="flex h-full w-full items-center justify-center text-foreground/40 text-xs">
                                            暂无该版本视频媒体
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            /* 双屏并排对比模式 */
                            <div className="grid grid-cols-2 gap-3">
                                {/* 左屏：原版 */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-[11px] text-foreground/60 px-1">
                                        <span className="font-semibold text-foreground/80">原作基线 (Seedance 2.5)</span>
                                        <span>原版参考</span>
                                    </div>
                                    <div className="aspect-[16/9] overflow-hidden rounded-lg border border-border/80 bg-black">
                                        <video
                                            ref={leftVideoRef}
                                            src={originVideoUrl}
                                            controls
                                            className="h-full w-full object-contain"
                                        />
                                    </div>
                                </div>

                                {/* 右屏：本地 H3 复现 */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between text-[11px] text-foreground/60 px-1">
                                        <span className="font-semibold text-emerald-500">本地真实复现 (MiniMax H3)</span>
                                        <span>768p / 10s</span>
                                    </div>
                                    <div className="aspect-[16/9] overflow-hidden rounded-lg border border-emerald-500/40 bg-black">
                                        <video
                                            ref={rightVideoRef}
                                            src={localVideoUrl}
                                            controls
                                            className="h-full w-full object-contain"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* 提示词多版本与参数控制台 (Prompt Studio) */}
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Sparkles className="size-4 text-primary" />
                            <span className="font-semibold text-foreground text-sm">提示词工程控制台 (Prompt Studio)</span>
                        </div>
                        <Button
                            size="small"
                            type="primary"
                            icon={copiedPrompt ? <Check className="size-3" /> : <Copy className="size-3" />}
                            onClick={handleCopyPrompt}
                        >
                            {copiedPrompt ? "已复制" : "复制完整提示词（含作者出处）"}
                        </Button>
                    </div>

                    {/* 版本 Tabs */}
                    {prompts.length > 1 && (
                        <div className="flex items-center gap-1.5 border-b border-border/40 pb-2">
                            {prompts.map((p, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => setActivePromptIndex(idx)}
                                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                                        activePromptIndex === idx
                                            ? "bg-primary/10 text-primary border border-primary/30"
                                            : "text-foreground/60 hover:bg-muted"
                                    }`}
                                >
                                    {p.version || `版本 ${idx + 1}`}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* 正向提示词 */}
                    <div className="rounded-xl border border-border/80 bg-surface p-4 space-y-2">
                        <div className="flex items-center justify-between text-xs text-foreground/50">
                            <span className="font-semibold text-foreground/75">正向提示词 (Prompt):</span>
                            <span>{activePrompt?.text?.length || 0} 字</span>
                        </div>
                        <p className="text-xs leading-relaxed text-foreground/90 font-mono whitespace-pre-wrap select-all bg-muted/30 p-3 rounded-lg border border-border/40">
                            {activePrompt?.text || currentCase.summary || "无提示词文本"}
                        </p>

                        {/* 负向提示词 */}
                        {activePrompt?.negativePrompt && (
                            <div className="pt-2 border-t border-border/30 space-y-1">
                                <span className="text-[11px] font-semibold text-foreground/60">负向提示词 (Negative Prompt):</span>
                                <p className="text-xs text-foreground/70 font-mono bg-muted/20 p-2 rounded">
                                    {activePrompt.negativePrompt}
                                </p>
                            </div>
                        )}
                    </div>

                    {/* 生成参数矩阵 */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
                        <div className="rounded-lg border border-border/60 bg-surface/50 p-2.5">
                            <span className="text-foreground/45 block text-[11px]">画面比例 / 分辨率</span>
                            <span className="font-semibold text-foreground mt-0.5 block font-mono">
                                {activePrompt?.ratio || "16:9"} · {activePrompt?.resolution || "768p"}
                            </span>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-surface/50 p-2.5">
                            <span className="text-foreground/45 block text-[11px]">时长 / 帧率</span>
                            <span className="font-semibold text-foreground mt-0.5 block font-mono">
                                {activePrompt?.durationSeconds ? `${activePrompt.durationSeconds}s` : "10s"} · {activePrompt?.fps || 24} FPS
                            </span>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-surface/50 p-2.5">
                            <span className="text-foreground/45 block text-[11px]">CFG / 采样步数</span>
                            <span className="font-semibold text-foreground mt-0.5 block font-mono">
                                CFG {activePrompt?.cfgScale || 7.0} · {activePrompt?.steps || 30} steps
                            </span>
                        </div>
                        <div className="rounded-lg border border-border/60 bg-surface/50 p-2.5">
                            <span className="text-foreground/45 block text-[11px]">镜头运动 / 光影</span>
                            <span className="font-semibold text-foreground mt-0.5 block truncate" title={`${activePrompt?.cameraMotion || "标准"} · ${activePrompt?.lighting || "环境光"}`}>
                                {activePrompt?.cameraMotion || "标准"} · {activePrompt?.lighting || "环境光"}
                            </span>
                        </div>
                    </div>
                </div>

                {/* 跨模型复现评测矩阵 (GoodCase 成果与本土化对照) */}
                <div className="rounded-xl border border-border/70 bg-surface/40 p-4 space-y-3">
                    <div className="flex items-center gap-2">
                        <Award className="size-4 text-primary" />
                        <span className="font-semibold text-foreground text-sm">跨模型复测成绩单 (Cross-Model Matrix)</span>
                    </div>

                    <div className="grid gap-2.5">
                        {/* 本地 H3 复现 */}
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-start justify-between">
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-xs text-foreground">本地实测: MiniMax-H3</span>
                                    <Tag color={localRetest ? "success" : "default"} className="m-0 text-[10px]">
                                        {localRetest ? "已完成复测" : "待放量测试"}
                                    </Tag>
                                </div>
                                <p className="text-xs text-foreground/75 mt-1">
                                    {localRetest?.notes || "已配置本地复现驱动管线，支持提示词规范裁剪与参考图生成。"}
                                </p>
                                {localRetest?.testedAt && (
                                    <span className="text-[11px] text-foreground/40 mt-1 block">
                                        测试时间: {localRetest.testedAt}
                                    </span>
                                )}
                            </div>
                            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                                {localRetest?.conclusion === "reproduced" ? "完全复现" : localRetest?.conclusion || "待测"}
                            </span>
                        </div>

                        {/* 官方基线复测 */}
                        {officialRetest && (
                            <div className="rounded-lg border border-border/60 bg-background/50 p-3 flex items-start justify-between">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-xs text-foreground">官方基线: {officialRetest.model}</span>
                                        <Tag color={officialRetest.conclusion === "reproduced" ? "success" : "warning"} className="m-0 text-[10px]">
                                            {officialRetest.conclusion === "reproduced" ? "官方已复现" : "效果降级 (Degraded)"}
                                        </Tag>
                                    </div>
                                    <p className="text-xs text-foreground/60 mt-1">
                                        {officialRetest.notes || "源自 goodcase.ai 跨模型复测基准库。"}
                                    </p>
                                </div>
                                {officialRetest.score && (
                                    <span className="text-xs font-mono font-semibold text-foreground/70">
                                        得分: {officialRetest.score.toFixed(1)}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* 权利人保护与下架指引底部声明 */}
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 text-xs text-foreground/60 space-y-1.5">
                    <div className="flex items-center justify-between text-foreground/70 font-semibold">
                        <span className="flex items-center gap-1.5">
                            <ShieldAlert className="size-3.5 text-amber-500" />
                            权利人保护与下架流程 (Takedown Process)
                        </span>
                        <Button
                            size="small"
                            type="link"
                            className="p-0 text-xs"
                            onClick={() => onOpenLicenseModal?.(currentCase.sourceId, currentCase.sourceUrl)}
                        >
                            查看完整开源许可规范 →
                        </Button>
                    </div>
                    <p className="leading-relaxed">
                        本案例的提示词与多媒体引用自公开帖子，仅供学习、研究与模型基准测试之用，版权归属原作者。若权利人有异议，请凭该案例标识符{" "}
                        <code className="rounded bg-muted px-1 font-mono text-primary">{currentCase.sourceId}</code>{" "}
                        联系下架，平台核实后将立即移除并停止分发。
                    </p>
                </div>
            </div>
        </Drawer>
    );
}
