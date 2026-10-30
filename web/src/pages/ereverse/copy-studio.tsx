/**
 * 右栏 · 模式 B「AI 片段仿拍创作台」（对标 AppGrowing 图 2，0 跳转直出）。
 *
 * 结构：顶栏（返回/去画布/记录）→ ① 模型选型卡（真库实况解析）→
 * ② 创作指令框 + 四大金刚换装按钮 + 参考图上传 → ③ 参数栏 + 并发 1~8 直出 +
 * 结果网格。生成走 runBackendGenerationTaskBatch → POST /api/tasks，
 * 全程不离开本页。
 *
 * 工程纪律：
 * - 模型找不到对应渠道时诚实禁用（resolveModelChannel 有静默 fallback 陷阱）；
 * - 换装只改白名单键，主体.动作/镜头运镜锁定（slots.ts 单测保障）；
 * - 参考图/参考视频由 generation-task 层自动上传 resource，页面不碰存储细节。
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Input, Popover, Progress, Select, Tag, Upload } from "antd";
import { ArrowLeft, Clapperboard, Download, ExternalLink, ImagePlus, Trash2, Wand2 } from "lucide-react";

import type { ReferenceImage } from "@/types/image";
import type { ReferenceVideo } from "@/types/media";
import { runBackendGenerationTaskBatch } from "@/services/api/generation-task";
import { useConfigStore } from "@/stores/use-config-store";
import type { EreversePromptSlots } from "@/lib/canvas/ereverse-view";
import { compileSlotsPrompt, SWAP_LABELS, swapSlot, type SwapKind } from "./slots";
import { defaultModelCard, resolveModelCardStates, type ModelCardState } from "./model-catalog";

const ASPECT_OPTIONS = ["9:16", "4:3", "1:1", "16:9"];
const DURATION_OPTIONS = ["5", "10", "15"];
const QUALITY_OPTIONS = ["768P", "1080P"];
const COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

type BatchSlot = {
    status: "pending" | "running" | "done" | "failed";
    videoUrl?: string;
    error?: string;
};

type CopyStudioProps = {
    slots: EreversePromptSlots;
    sourceLabel: string;
    /** 原视频 URL（秘塔 H3 可选作为动作参考）。 */
    sourceVideoUrl: string | null;
    onBack: () => void;
    /** 顶栏次级入口：带反推配方跳画布深度精修。 */
    onGoCanvas: () => void;
    /** 结果卡「送入画布」：带成片视频与提示词。 */
    onSendToCanvas: (videoUrl: string, prompt: string) => void;
};

export function CopyStudio({ slots: initialSlots, sourceLabel, sourceVideoUrl, onBack, onGoCanvas, onSendToCanvas }: CopyStudioProps) {
    const { message } = App.useApp();
    const readCardStates = useCallback(() => resolveModelCardStates(useConfigStore.getState().config), []);
    const [slots, setSlots] = useState<EreversePromptSlots>(initialSlots);
    const [cardStates, setCardStates] = useState<ModelCardState[]>(readCardStates);
    const [selectedId, setSelectedId] = useState<string>(() => defaultModelCard(readCardStates())?.id || "");
    const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
    const [useVideoRef, setUseVideoRef] = useState(false);
    const [aspect, setAspect] = useState("9:16");
    const [duration, setDuration] = useState("5");
    const [quality, setQuality] = useState("768P");
    const [withAudio, setWithAudio] = useState(true);
    const [count, setCount] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [batch, setBatch] = useState<BatchSlot[]>([]);
    const objectUrls = useRef<string[]>([]);

    // 组件挂载时渠道可能尚未同步完成：暴露一次手动刷新
    const refreshChannels = useCallback(() => {
        const states = readCardStates();
        setCardStates(states);
        if (!states.some((item) => item.id === selectedId)) {
            setSelectedId(defaultModelCard(states)?.id || "");
        }
    }, [readCardStates, selectedId]);

    const selected = useMemo(() => cardStates.find((item) => item.id === selectedId) || null, [cardStates, selectedId]);
    const compiled = useMemo(() => compileSlotsPrompt(slots), [slots]);
    const videoRefModels = useMemo(() => cardStates.filter((item) => item.modelKey === "MiniMax-H3"), [cardStates]);

    const applySwap = useCallback((kind: SwapKind, value: string) => {
        setSlots((previous) => swapSlot(previous, kind, value));
    }, []);

    const handleUpload = useCallback((file: File) => {
        const url = URL.createObjectURL(file);
        objectUrls.current.push(url);
        setReferenceImages((previous) => [...previous, { id: `ref-${Date.now()}-${previous.length}`, name: file.name, type: file.type || "image/png", url, dataUrl: "" }]);
    }, []);

    const handleGenerate = useCallback(async () => {
        if (!selected || !selected.available) {
            message.warning("请先选择一个已配置的视频模型");
            return;
        }
        if (!compiled.trim()) {
            message.warning("提示词为空：请先在 AI Prompt 视图补全槽位");
            return;
        }
        setSubmitting(true);
        setBatch(Array.from({ length: count }, () => ({ status: "pending" as const })));
        try {
            const store = useConfigStore.getState().config;
            const config = {
                ...store,
                model: selected.pinnedModel,
                videoModel: selected.pinnedModel,
                size: aspect,
                videoSeconds: duration,
                vquality: quality,
                videoGenerateAudio: withAudio ? "true" : "false",
                count: "1",
            };
            const referenceVideos: ReferenceVideo[] = useVideoRef && sourceVideoUrl ? [{ id: "ereverse-source-video", name: "原视频（动作参考）", type: "video/mp4", url: sourceVideoUrl }] : [];
            const settled = await runBackendGenerationTaskBatch({
                mode: "video",
                prompt: compiled,
                config,
                referenceImages,
                referenceVideos,
                count,
                metadata: { source: "ereverse-copy-studio", sceneLabel: sourceLabel },
            });
            // Promise.allSettled 保序：下标即批次号
            const next: BatchSlot[] = settled.map((entry) =>
                entry.status === "fulfilled" && entry.value.video?.dataUrl
                    ? { status: "done", videoUrl: entry.value.video.dataUrl }
                    : entry.status === "fulfilled"
                      ? { status: "failed", error: "任务完成但未返回视频" }
                      : { status: "failed", error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason) },
            );
            setBatch(next);
            const doneCount = next.filter((item) => item.status === "done").length;
            if (doneCount) message.success(`${doneCount}/${count} 条仿拍成片已出炉`);
            else message.error("全部生成失败，请查看任务中心日志");
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
            setBatch((previous) => previous.map((item) => (item.status === "pending" ? { status: "failed", error: "提交失败" } : item)));
        } finally {
            setSubmitting(false);
        }
    }, [selected, compiled, count, aspect, duration, quality, withAudio, referenceImages, useVideoRef, sourceVideoUrl, sourceLabel, message]);

    const doneCount = batch.filter((item) => item.status === "done").length;
    const progressPct = batch.length ? Math.round((batch.filter((item) => item.status !== "pending" && item.status !== "running").length / batch.length) * 100) : 0;

    return (
        <section className="flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-3" aria-label="AI 片段仿拍创作台">
            {/* 顶栏 */}
            <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-2">
                <Button size="small" type="text" icon={<ArrowLeft className="size-3.5" />} onClick={onBack}>
                    返回解析视图
                </Button>
                <strong className="flex items-center gap-1.5 text-sm">
                    <Clapperboard className="size-4 text-primary" />
                    AI 片段仿拍
                </strong>
                <span className="text-caption text-foreground/40">来源：{sourceLabel}</span>
                <div className="ml-auto flex items-center gap-1">
                    <Button size="small" type="link" onClick={onGoCanvas} icon={<ExternalLink className="size-3" />}>
                        去画布页继续编辑
                    </Button>
                    <Button size="small" type="link" href="/tasks" target="_blank">
                        查看仿拍记录
                    </Button>
                </div>
            </div>

            {/* ① 模型选型卡 */}
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-foreground/70">① 选择视频模型（真库实况）</h4>
                    <Button size="small" type="text" onClick={refreshChannels}>
                        刷新渠道状态
                    </Button>
                </div>
                <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
                    {cardStates.map((card) => {
                        const active = card.id === selectedId;
                        return (
                            <button
                                key={card.id}
                                type="button"
                                disabled={!card.available}
                                onClick={() => setSelectedId(card.id)}
                                className={`rounded-lg border p-2 text-left transition-colors ${active ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40"} ${card.available ? "" : "cursor-not-allowed opacity-55"}`}
                            >
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold text-foreground/85">{card.title}</span>
                                    {card.badge && (
                                        <Tag color={card.recommended ? "red" : "blue"} className="!mr-0">
                                            {card.badge}
                                        </Tag>
                                    )}
                                    {!card.available && (
                                        <Tag color="orange" className="!mr-0">
                                            未启用
                                        </Tag>
                                    )}
                                </div>
                                <p className="mt-0.5 text-caption leading-5 text-foreground/50">{card.available ? card.desc : `${card.reason} · 去「模型设置 / 渠道」开启后点上方刷新`}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* ② 创作指令框 + 四大换装 */}
            <div className="flex flex-col gap-1.5">
                <h4 className="text-xs font-semibold text-foreground/70">② 创作指令（换装只改对应槽位，动作与运镜 100% 锁定）</h4>
                <Input.TextArea value={compiled} readOnly autoSize={{ minRows: 2, maxRows: 5 }} className="!font-mono !text-caption" aria-label="创作指令" />
                <div className="flex flex-wrap items-center gap-1.5">
                    {(Object.keys(SWAP_LABELS) as SwapKind[]).map((kind) => (
                        <Popover
                            key={kind}
                            trigger="click"
                            placement="bottom"
                            content={
                                <div className="flex w-72 flex-col gap-2">
                                    <p className="text-caption text-foreground/55">{SWAP_LABELS[kind].hint}</p>
                                    <Input.TextArea rows={3} placeholder={SWAP_LABELS[kind].placeholder} id={`swap-${kind}`} />
                                    <Button
                                        size="small"
                                        type="primary"
                                        onClick={() => {
                                            const node = document.getElementById(`swap-${kind}`) as HTMLTextAreaElement | null;
                                            applySwap(kind, node?.value || "");
                                            message.success(`${SWAP_LABELS[kind].button} 完成，动作与运镜已锁定`);
                                        }}
                                    >
                                        确认替换
                                    </Button>
                                </div>
                            }
                        >
                            <Button size="small">{SWAP_LABELS[kind].button}</Button>
                        </Popover>
                    ))}
                    <Button size="small" type="text" icon={<Wand2 className="size-3.5" />} onClick={() => message.info("提示词优化将走模型设置里的系统提示词，本版不改写槽位")}>
                        ✨ 优化提示词
                    </Button>
                    <Button size="small" type="text" icon={<Trash2 className="size-3.5" />} onClick={() => setReferenceImages([])}>
                        🗑️ 清空参考图
                    </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <Upload
                        accept="image/*"
                        showUploadList={false}
                        beforeUpload={(file) => {
                            handleUpload(file);
                            return false;
                        }}
                    >
                        <Button size="small" icon={<ImagePlus className="size-3.5" />}>
                            📤 上传参考图/产品图
                        </Button>
                    </Upload>
                    {referenceImages.map((image) => (
                        <span key={image.id} className="relative inline-block">
                            <img src={image.url} alt={image.name} className="h-10 w-10 rounded border border-border object-cover" />
                            <button
                                type="button"
                                className="absolute -right-1.5 -top-1.5 rounded-full bg-black/70 px-1 text-caption text-white"
                                onClick={() => setReferenceImages((previous) => previous.filter((item) => item.id !== image.id))}
                                aria-label="移除参考图"
                            >
                                ×
                            </button>
                        </span>
                    ))}
                    {videoRefModels.some((item) => item.available) && sourceVideoUrl && (
                        <label className="flex items-center gap-1 text-caption text-foreground/55">
                            <input type="checkbox" checked={useVideoRef} onChange={(event) => setUseVideoRef(event.target.checked)} />
                            ☑️ 同时将原视频作为动作参考 (referenceVideos)
                        </label>
                    )}
                </div>
            </div>

            {/* ③ 参数栏 + 并发直出 */}
            <div className="flex flex-col gap-1.5">
                <h4 className="text-xs font-semibold text-foreground/70">③ 生成参数与并发抽卡</h4>
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-caption text-foreground/45">画幅</span>
                    <Select size="small" value={aspect} options={ASPECT_OPTIONS.map((v) => ({ value: v, label: `📱 ${v}` }))} onChange={setAspect} className="!w-24" />
                    <span className="text-caption text-foreground/45">时长</span>
                    <Select size="small" value={duration} options={DURATION_OPTIONS.map((v) => ({ value: v, label: `⏱️ ${v}s` }))} onChange={setDuration} className="!w-24" />
                    <span className="text-caption text-foreground/45">清晰度</span>
                    <Select size="small" value={quality} options={QUALITY_OPTIONS.map((v) => ({ value: v, label: `🎬 ${v}` }))} onChange={setQuality} className="!w-28" />
                    <span className="text-caption text-foreground/45">声音</span>
                    <Select
                        size="small"
                        value={withAudio ? "on" : "off"}
                        options={[
                            { value: "on", label: "🔊 有声" },
                            { value: "off", label: "🔇 无声" },
                        ]}
                        onChange={(v) => setWithAudio(v === "on")}
                        className="!w-28"
                    />
                    <span className="text-caption text-foreground/45">并发</span>
                    <Select size="small" value={count} options={COUNT_OPTIONS.map((v) => ({ value: v, label: `🔢 ${v} 条` }))} onChange={setCount} className="!w-24" />
                </div>
                <Button type="primary" block loading={submitting} disabled={!selected?.available} onClick={() => void handleGenerate()}>
                    🚀 开始创作（{count} 条并发）
                </Button>
                {batch.length > 0 && (
                    <div className="flex flex-col gap-1">
                        <Progress percent={progressPct} size="small" status={doneCount === batch.length ? "success" : "active"} />
                        <span className="text-caption text-foreground/45">
                            {doneCount}/{batch.length} 条完成
                        </span>
                    </div>
                )}
            </div>

            {/* 结果网格 */}
            {batch.length > 0 && (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    {batch.map((slot, index) => (
                        <div key={index} className="flex flex-col gap-1 rounded-lg border border-border bg-surface-subtle/40 p-1.5">
                            <span className="text-caption text-foreground/40">#{index + 1}</span>
                            {slot.status === "done" && slot.videoUrl ? (
                                <>
                                    <video src={slot.videoUrl} className="w-full rounded bg-black" controls playsInline preload="metadata" />
                                    <div className="flex items-center gap-1">
                                        <Button size="small" type="link" href={slot.videoUrl} download={`ereverse-copy-${index + 1}.mp4`} icon={<Download className="size-3" />}>
                                            下载
                                        </Button>
                                        <Button size="small" type="link" onClick={() => onSendToCanvas(slot.videoUrl!, compiled)}>
                                            送入画布
                                        </Button>
                                    </div>
                                </>
                            ) : slot.status === "failed" ? (
                                <Alert type="error" showIcon message={slot.error || "失败"} className="!py-1 text-caption" />
                            ) : (
                                <div className="flex h-20 items-center justify-center text-caption text-foreground/35">生成中…</div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
