import { Tooltip } from "@/components/ui/base/tooltip";
import { App, Tag } from "antd";
import copy from "copy-to-clipboard";
import { Copy, ExternalLink, Flame, Heart, Play, Sparkles, Video, Image as ImageIcon, Layout, FileText, Check } from "lucide-react";
import { useRef, useState } from "react";
import type { InspirationCase } from "@/services/api/inspiration";

interface InspirationCardProps {
    item: InspirationCase;
    onSelect: (item: InspirationCase) => void;
    onToggleFavorite: (id: number) => void;
}

export function InspirationCard({ item, onSelect, onToggleFavorite }: InspirationCardProps) {
    const { message } = App.useApp();
    const [isHovered, setIsHovered] = useState(false);
    const [copied, setCopied] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    const handleMouseEnter = () => {
        setIsHovered(true);
        if (item.mediaType === "video" && item.mediaUrl && videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play().catch(() => {});
        }
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        if (videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
        }
    };

    const handleCopyPrompt = (e: React.MouseEvent) => {
        e.stopPropagation();
        const mainPrompt = item.prompts?.[0]?.text || item.summary || item.title;
        const textToCopy = `${mainPrompt}

---
[来源出处 / Attribution]:
- 案例: ${item.title}
- 创作者: ${item.creator || "社区作者"}
- 来源原帖: ${item.sourceUrl || "无"}
- GoodCase档案: ${item.goodcaseUrl || "无"}
- 声明: 提示词版权归原作者所有，引用遵循 CC BY 4.0 整理规范。`;
        copy(textToCopy);
        setCopied(true);
        message.success("已复制提示词（含作者出处署名）");
        setTimeout(() => setCopied(false), 2000);
    };

    const handleFavClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggleFavorite(item.id);
    };

    // 媒介图标映射
    const mediaIcon = () => {
        switch (item.mediaType) {
            case "video":
                return <Video className="size-3.5 text-blue-400" />;
            case "image":
                return <ImageIcon className="size-3.5 text-emerald-400" />;
            case "ui":
                return <Layout className="size-3.5 text-purple-400" />;
            default:
                return <FileText className="size-3.5 text-amber-400" />;
        }
    };

    // 格式化主提示词预览
    const firstPrompt = item.prompts?.[0]?.text || item.summary || "";

    return (
        <div
            onClick={() => onSelect(item)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className="group relative flex flex-col overflow-hidden rounded-xl border border-border/60 bg-surface transition-all duration-200 hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 cursor-pointer"
        >
            {/* 媒体封面区域 */}
            <div className="relative aspect-[16/9] w-full overflow-hidden bg-muted/40">
                {item.coverUrl ? (
                    <img
                        src={item.coverUrl}
                        alt={item.title}
                        className={`h-full w-full object-cover transition-opacity duration-300 ${
                            isHovered && item.mediaUrl && item.mediaType === "video" ? "opacity-0" : "opacity-100"
                        }`}
                        loading="lazy"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface to-muted text-foreground/30">
                        {mediaIcon()}
                    </div>
                )}

                {/* 悬浮微视频自动预览 */}
                {item.mediaType === "video" && item.mediaUrl && (
                    <video
                        ref={videoRef}
                        src={item.mediaUrl}
                        muted
                        loop
                        playsInline
                        preload="none"
                        className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                            isHovered ? "opacity-100" : "opacity-0 pointer-events-none"
                        }`}
                    />
                )}

                {/* 顶栏浮层徽章 */}
                <div className="absolute inset-x-2 top-2 flex items-center justify-between pointer-events-none">
                    <div className="flex items-center gap-1.5 flex-wrap">
                        {/* 媒介与热度 */}
                        <span className="flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-md">
                            {mediaIcon()}
                            <Flame className="size-3 text-amber-400 fill-amber-400" />
                            <span>{Math.round(item.score)}</span>
                        </span>

                        {/* 复现标识 */}
                        {item.reproStatus === "done" && (
                            <span className="rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-md shadow-sm">
                                H3 已复现
                            </span>
                        )}
                    </div>

                    {/* 收藏按钮 */}
                    <button
                        type="button"
                        onClick={handleFavClick}
                        className={`pointer-events-auto flex size-7 items-center justify-center rounded-full backdrop-blur-md transition-all ${
                            item.favorited
                                ? "bg-red-500/90 text-white"
                                : "bg-black/50 text-white/80 hover:bg-black/80 hover:text-red-400"
                        }`}
                        title={item.favorited ? "已收藏" : "加入收藏"}
                    >
                        <Heart className={`size-3.5 ${item.favorited ? "fill-white" : ""}`} />
                    </button>
                </div>

                {/* 底部渐变模型信息条 */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 pt-6 text-[11px] text-white/90 flex items-center justify-between pointer-events-none">
                    <span className="truncate font-mono">{item.modelFamily || "Multi-Model"}</span>
                    {item.categoryName && (
                        <span className="shrink-0 rounded bg-white/20 px-1.5 py-0.5 text-[10px] text-white/95">
                            {item.categoryName}
                        </span>
                    )}
                </div>
            </div>

            {/* 卡片正文 */}
            <div className="flex flex-1 flex-col p-3.5 justify-between">
                <div>
                    <h3 className="line-clamp-1 text-sm font-semibold text-foreground group-hover:text-primary transition-colors" title={item.title}>
                        {item.title}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-xs text-foreground/60 leading-relaxed font-sans" title={firstPrompt}>
                        {firstPrompt || "暂无提示词文本"}
                    </p>
                </div>

                {/* 底部出处溯源与快速操作 */}
                <div className="mt-3 pt-2.5 border-t border-border/40 flex items-center justify-between text-xs text-foreground/50">
                    {/* 创作者与来源 */}
                    <div className="flex items-center gap-1.5 min-w-0 max-w-[65%]">
                        <span className="truncate font-medium text-foreground/75" title={item.creator}>
                            @{item.creator || "社区作者"}
                        </span>
                        {item.sourceUrl && (
                            <Tooltip title="查看公开原帖出处">
                                <a
                                    href={item.sourceUrl}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-foreground/40 hover:text-primary transition-colors"
                                >
                                    <ExternalLink className="size-3" />
                                </a>
                            </Tooltip>
                        )}
                    </div>

                    {/* 快速复制提示词 */}
                    <button
                        type="button"
                        onClick={handleCopyPrompt}
                        className="flex items-center gap-1 text-[11px] text-primary/80 hover:text-primary transition-colors"
                        title="复制提示词（附原作者出处）"
                    >
                        {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                        <span>{copied ? "已复制" : "提示词"}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
