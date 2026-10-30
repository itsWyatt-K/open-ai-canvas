/**
 * 左栏 · 视频播放器 + 黄金片段选区条（对标 AppGrowing 图 1 时间轴）。
 *
 * 交互纪律：
 * - 三个一键胶囊（片头钩子 11s / 核心转化段 / 全片）点击即改选区并触发重跑；
 * - 双滑块只改「待定选区」，确认后点「按选区重新拆解」才调 startEreverseJob——
 *   侧车任务串行且首任务含 84s 模型加载，拖动过程中每帧重跑会打爆任务队列；
 * - 选区变化实时显示「当前截取片段时长：XXs」。
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Button, Slider, Tag } from "antd";
import { Flame, TrendingUp, Film, RotateCcw } from "lucide-react";

import type { EreverseSceneView } from "@/lib/canvas/ereverse-view";

const HOOK_MS = 11_000;

export type FragmentWindow = { startMs: number; endMs: number };

type FragmentBarProps = {
    videoRef: React.RefObject<HTMLVideoElement | null>;
    videoUrl: string | null;
    durationMs: number;
    committed: FragmentWindow | null;
    scenes: EreverseSceneView[];
    running: boolean;
    onSeek: (ms: number) => void;
    onCommit: (window: FragmentWindow) => void;
};

function formatMs(ms: number): string {
    const total = Math.max(0, ms);
    const s = Math.floor(total / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function FragmentBar({ videoRef, videoUrl, durationMs, committed, scenes, running, onSeek, onCommit }: FragmentBarProps) {
    const [pending, setPending] = useState<FragmentWindow>(() => committed || { startMs: 0, endMs: durationMs });

    // 新任务回执（committed 变化）时同步待定选区，避免滑块停在旧值
    const committedKey = committed ? `${committed.startMs}-${committed.endMs}` : "";
    const lastCommittedKey = useRef(committedKey);
    if (committedKey !== lastCommittedKey.current) {
        lastCommittedKey.current = committedKey;
        if (committed) setPending(committed);
    }

    const total = Math.max(1, durationMs);
    const dirty = useMemo(() => !committed || pending.startMs !== committed.startMs || pending.endMs !== committed.endMs, [pending, committed]);

    const applyCapsule = useCallback(
        (startMs: number, endMs: number) => {
            const next = { startMs: Math.max(0, Math.min(startMs, total - 100)), endMs: Math.max(100, Math.min(endMs, total)) };
            setPending(next);
            onCommit(next);
        },
        [onCommit, total],
    );

    const seek = useCallback(
        (ms: number) => {
            const video = videoRef.current;
            if (video) {
                video.currentTime = Math.max(0, ms / 1000);
                void video.play().catch(() => undefined);
            }
            onSeek(ms);
        },
        [videoRef, onSeek],
    );

    const pendingSeconds = ((pending.endMs - pending.startMs) / 1000).toFixed(1);

    return (
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3" aria-label="黄金片段选区">
            {videoUrl ? (
                <video ref={videoRef} className="max-h-[300px] w-full rounded-lg bg-black" src={videoUrl} controls playsInline preload="auto" />
            ) : (
                <div className="flex h-32 items-center justify-center rounded-lg bg-black/20 text-caption text-foreground/40">暂无视频（上传并拆解后此处播放）</div>
            )}

            {/* 一键胶囊：片头钩子 / 核心转化段 / 全片 */}
            <div className="flex flex-wrap items-center gap-2">
                <Button size="small" icon={<Flame className="size-3.5" />} disabled={running || durationMs <= 0} onClick={() => applyCapsule(0, Math.min(HOOK_MS, total))}>
                    🔥 片头黄金钩子 (00:00 - {formatMs(Math.min(HOOK_MS, total))})
                </Button>
                <Button size="small" icon={<TrendingUp className="size-3.5" />} disabled={running || durationMs <= 0} onClick={() => applyCapsule(Math.min(HOOK_MS, total - 100), total)}>
                    📈 核心转化段 ({formatMs(Math.min(HOOK_MS, total - 100))} - {formatMs(total)})
                </Button>
                <Button size="small" icon={<Film className="size-3.5" />} disabled={running || durationMs <= 0} onClick={() => applyCapsule(0, total)}>
                    🎬 全片拆解
                </Button>
            </div>

            {/* 双滑块：起止时间 */}
            <div className="px-1">
                <Slider
                    range
                    min={0}
                    max={total}
                    step={100}
                    value={[pending.startMs, pending.endMs]}
                    disabled={running || durationMs <= 0}
                    onChange={(value) => {
                        if (!Array.isArray(value)) return;
                        const [startMs, endMs] = value as [number, number];
                        setPending({ startMs, endMs: Math.max(startMs + 100, endMs) });
                    }}
                    tooltip={{ formatter: (value) => (typeof value === "number" ? formatMs(value) : "") }}
                />
                <div className="mt-1 flex flex-wrap items-center gap-2 text-caption text-foreground/50">
                    <span>
                        选区{" "}
                        <span className="font-mono text-foreground/70">
                            {formatMs(pending.startMs)} - {formatMs(pending.endMs)}
                        </span>
                    </span>
                    <Tag color="blue">当前截取片段时长：{pendingSeconds}s</Tag>
                    {dirty && (
                        <Button size="small" type="primary" icon={<RotateCcw className="size-3.5" />} disabled={running} onClick={() => onCommit(pending)}>
                            按选区重新拆解
                        </Button>
                    )}
                </div>
            </div>

            {/* 场景条（关键帧缩略图，点击跳转） */}
            {scenes.length > 0 && (
                <div className="relative h-20 w-full overflow-hidden rounded-lg border border-border bg-black/20" aria-label="场景条">
                    {scenes.map((scene) => (
                        <button
                            key={scene.index}
                            type="button"
                            className="absolute top-0 h-full overflow-hidden border-l border-border/60"
                            style={{ left: `${scene.leftPct}%`, width: `${scene.widthPct}%` }}
                            onClick={() => seek(scene.startMs)}
                            title={`场景 ${scene.index} · ${formatMs(scene.startMs)}`}
                        >
                            {scene.keyframeUrl && <img src={scene.keyframeUrl} alt={`场景 ${scene.index}`} className="h-full w-full object-cover" />}
                            <span className="absolute bottom-0 left-0 bg-black/60 px-1 text-caption text-white">#{scene.index}</span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}
