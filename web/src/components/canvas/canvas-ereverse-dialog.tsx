import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Progress, Select, Switch, Tag, Tooltip } from "antd";
import { Captions, Database, PlayCircle, RefreshCw, Workflow } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import type { CanvasNodeData } from "@/types/canvas";
import type { SrtEntry } from "@/types/timeline";
import {
    ereverseAssetUrl,
    getEreverseHealth,
    getEreverseJobStatus,
    startEreverseJob,
    uploadEreverseVideo,
    type EreverseHealth,
    type EreverseJobStatus,
    type EreverseStage,
    type EreverseVlmBackend,
} from "@/services/api/ereverse";
import { presentEreversePft, type EreverseView } from "@/lib/canvas/ereverse-view";
import { getResourceBlob, resolveResourceUrl } from "@/services/api/resources";

const STAGE_LABEL: Record<EreverseStage, string> = {
    queued: "排队中",
    probe: "探测素材",
    tracks: "抽取音视频轨",
    scenes: "场景检测",
    keyframes: "提取关键帧",
    asr: "词级 ASR",
    vlm: "VLM 语义打标",
    write: "落盘事实表",
    done: "完成",
    error: "失败",
};
const STAGE_PCT: Partial<Record<EreverseStage, number>> = {
    queued: 3, probe: 10, tracks: 25, scenes: 40, keyframes: 55, asr: 72, vlm: 88, write: 96, done: 100,
};
const TERMINAL: EreverseStage[] = ["done", "error"];
const VLM_OPTIONS: Array<{ value: EreverseVlmBackend; label: string }> = [
    { value: "auto", label: "自动（智谱 → 反重力Gemini → Ollama → 本地Qwen）" },
    { value: "gemini", label: "反重力中转 Gemini" },
    { value: "zhipu", label: "智谱 GLM-4V（国内云）" },
    { value: "ollama", label: "本地 Ollama" },
    { value: "hf-local", label: "本地 Qwen2.5-VL" },
];

function formatMs(ms: number): string {
    const total = Math.max(0, ms);
    const s = Math.floor(total / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(total % 1000).padStart(3, "0")}`;
}

type Props = {
    node: CanvasNodeData;
    open: boolean;
    onClose: () => void;
    /** 把词级结果写回节点字幕（获得画布字幕叠层 + 时间线字幕轨） */
    onApplySubtitles: (nodeId: string, entries: SrtEntry[]) => void;
    /** 画布上可绑定的商品资产节点（asset / reference；供一键分镜组连线） */
    assetNodes?: CanvasNodeData[];
    /** 一键生成画布分镜组（M3：Frame 容器 + 关键帧图 + 连续分镜卡 + 商品资产连线） */
    onCreateStoryboard?: (view: EreverseView, options: { productAssetNodeId: string; useCompliancePrompt: boolean }) => void | Promise<void>;
};

/**
 * E-Reverse 视频事实表对话框——挂在视频节点的悬停工具栏上。
 * 打开即自动把节点视频送入本地侧车（127.0.0.1:8790）跑逆向管线，
 * 产出 pft/v1：词级时间轴 + 场景关键帧 + 语义标签，点词跳转播放；
 * 可一键把词块写入节点字幕，或一键铺成画布分镜组（绑定商品资产）。
 */
export function CanvasEreverseDialog({ node, open, onClose, onApplySubtitles, assetNodes = [], onCreateStoryboard }: Props) {
    const { message } = App.useApp();
    const [health, setHealth] = useState<EreverseHealth | null>(null);
    const [healthError, setHealthError] = useState<string | null>(null);
    const [jobId, setJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<EreverseJobStatus | null>(null);
    const [view, setView] = useState<EreverseView | null>(null);
    const [runError, setRunError] = useState<string | null>(null);
    const [enableVlm, setEnableVlm] = useState(true);
    const [vlmBackend, setVlmBackend] = useState<EreverseVlmBackend>("auto");
    const [runNonce, setRunNonce] = useState(0);
    const [applying, setApplying] = useState(false);
    const [creating, setCreating] = useState(false);
    const [assetNodeId, setAssetNodeId] = useState("");
    const videoRef = useRef<HTMLVideoElement>(null);

    const storageKey = node.metadata?.storageKey || "";
    const fallbackUrl = node.metadata?.content || "";
    const videoUrl = useMemo(
        () => (open ? (storageKey ? resolveResourceUrl(storageKey) : fallbackUrl) : ""),
        [open, storageKey, fallbackUrl],
    );

    const stage = status?.stage;
    const running = Boolean(jobId) && (!status || !TERMINAL.includes(status.stage));
    const busy = running || jobId === null;

    // 打开时体检侧车
    useEffect(() => {
        if (!open) return;
        getEreverseHealth()
            .then((h) => {
                setHealth(h);
                setHealthError(null);
            })
            .catch((e: unknown) => setHealthError(e instanceof Error ? e.message : String(e)));
    }, [open]);

    // 自动上送视频并启动任务（open / 节点切换 / 手动重跑时触发；ref 防StrictMode双触发）
    const startedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!open) return;
        const startKey = `${node.id}:${runNonce}`;
        if (startedKeyRef.current === startKey) return;
        startedKeyRef.current = startKey;
        (async () => {
            try {
                let blob: Blob | null = null;
                if (storageKey) {
                    try {
                        blob = await getResourceBlob(storageKey);
                    } catch {
                        blob = null;
                    }
                }
                if (!blob && fallbackUrl) {
                    blob = await (await fetch(fallbackUrl)).blob();
                }
                if (!blob) throw new Error("无法读取节点视频（缺少资源与回退地址）");
                const file = new File([blob], `node-${node.id}.mp4`, { type: blob.type || "video/mp4" });
                const { path } = await uploadEreverseVideo(file);
                const { id } = await startEreverseJob({
                    video: path,
                    enable_vlm: enableVlm,
                    vlm_backend: vlmBackend,
                    context: `画布视频 ${node.title || node.id}`,
                });
                setJobId(id);
            } catch (e) {
                setRunError(e instanceof Error ? e.message : String(e));
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- runNonce 承载 VLM 参数变化的重跑
    }, [open, node.id, runNonce]);

    // 轮询任务
    useEffect(() => {
        if (!jobId || !running) return;
        let cancelled = false;
        const tick = () => {
            getEreverseJobStatus(jobId)
                .then((s) => {
                    if (cancelled) return;
                    setStatus(s);
                    if (s.stage === "done" && s.pft) {
                        setView(presentEreversePft(s.pft, jobId, ereverseAssetUrl));
                    }
                })
                .catch(() => undefined);
        };
        tick();
        const timer = setInterval(tick, 1_500);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [jobId, running]);

    const seekTo = useCallback((ms: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = Math.max(0, ms / 1000);
        void video.play().catch(() => undefined);
    }, []);

    const applySubtitles = useCallback(() => {
        if (!view || view.chunks.length === 0) return;
        setApplying(true);
        try {
            const entries: SrtEntry[] = view.chunks.map((chunk, i) => ({
                index: i + 1,
                startMs: chunk.startMs,
                endMs: chunk.endMs,
                text: chunk.text,
            }));
            onApplySubtitles(node.id, entries);
            message.success(`已写入 ${entries.length} 条词级字幕（节点叠层与时间线已同步）`);
        } finally {
            setApplying(false);
        }
    }, [view, node.id, onApplySubtitles, message]);

    /** 一键铺成画布分镜组：默认用防封改写版提示词，负向词经 M1 的 negativePrompt 字段下发。 */
    const createStoryboard = useCallback(async () => {
        if (!view || !onCreateStoryboard) return;
        const directed = view.scenes.filter((scene) => scene.compliancePrompt || scene.visualPrompt || scene.tags.length);
        if (!directed.length) {
            message.warning("这一版还没产出结构化导演字段——请勾选 VLM 打标后重新运行");
            return;
        }
        setCreating(true);
        try {
            await onCreateStoryboard(view, { productAssetNodeId: assetNodeId, useCompliancePrompt: true });
            message.success(`已在画布铺开 ${view.scenes.length} 个分镜节点`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "分镜组生成失败");
        } finally {
            setCreating(false);
        }
    }, [view, onCreateStoryboard, assetNodeId, message]);

    const progressPct = !stage ? 2 : stage === "done" ? 100 : stage === "error" ? 100 : STAGE_PCT[stage] ?? 5;

    return (
        <AppModal
            className="canvas-ereverse-dialog"
            title={
                <span className="flex items-center gap-2">
                    <Database className="size-4" />
                    E-Reverse 视频事实表 · {node.title || "视频节点"}
                </span>
            }
            open={open}
            centered
            footer={null}
            width={920}
            destroyOnHidden
            onCancel={onClose}
        >
            <div className="flex max-h-[76vh] flex-col gap-4 overflow-y-auto p-5 text-sm">
                {healthError && (
                    <Alert
                        type="warning"
                        showIcon
                        message="E-Reverse 侧车不可用"
                        description={
                            <span>
                                {healthError}
                                <br />
                                请先在源起控制面板启动「E-Reverse 事实表侧车」（或运行 工具\e-reverse\.venv\Scripts\python.exe 工具\e-reverse\server.py），然后
                                <Button type="link" size="small" onClick={() => setRunNonce((n) => n + 1)}>重试</Button>
                            </span>
                        }
                    />
                )}
                {runError && <Alert type="error" showIcon message="任务启动失败" description={runError} />}
                {status?.stage === "error" && status.error && (
                    <Alert type="error" showIcon message="管线执行失败" description={status.error} />
                )}

                <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs">
                        <Switch size="small" checked={enableVlm} onChange={setEnableVlm} />
                        VLM 打标
                    </label>
                    <Select
                        className="min-w-52"
                        size="small"
                        value={vlmBackend}
                        disabled={!enableVlm}
                        options={VLM_OPTIONS}
                        onChange={(v) => setVlmBackend(v as EreverseVlmBackend)}
                    />
                    <Button
                        size="small"
                        icon={<RefreshCw className="size-3.5" />}
                        disabled={running || Boolean(healthError)}
                        onClick={() => setRunNonce((n) => n + 1)}
                    >
                        重新分析
                    </Button>
                    {health && (
                        <Tag color={health.wordLevelAsr ? "green" : "orange"}>
                            词级 ASR {health.wordLevelAsr ? "可用" : "降级"}
                        </Tag>
                    )}
                </div>

                {(busy || running) && (
                    <div>
                        <div className="mb-1 flex items-center justify-between text-xs">
                            <span>{jobId ? STAGE_LABEL[stage ?? "queued"] : "上送节点视频…"}</span>
                            <span className="text-foreground/50">{progressPct}%</span>
                        </div>
                        <Progress
                            percent={progressPct}
                            status={stage === "error" ? "exception" : "active"}
                        />
                    </div>
                )}

                {view && (
                    <>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-medium">{view.sourceName}</span>
                            <span className="text-foreground/50">
                                {view.width}×{view.height} · {formatMs(view.durationMs)} · {view.fps}fps
                            </span>
                            <Tag color="blue">词级 {view.wordCount} 词 · {view.asrProvider || "无 ASR"}</Tag>
                            {view.vlmProvider && <Tag color="purple">VLM {view.vlmProvider}</Tag>}
                            {view.degraded.map((d) => (
                                <Tag key={d} color="orange">{d}</Tag>
                            ))}
                        </div>

                        <video
                            ref={videoRef}
                            className="max-h-[380px] w-full rounded-lg bg-black"
                            src={videoUrl}
                            controls
                            playsInline
                            preload="auto"
                        />

                        <div>
                            <h4 className="mb-2 text-xs font-semibold text-foreground/70">场景与语义标签（点击跳转）</h4>
                            <div className="flex flex-wrap gap-1">
                                {view.scenes.map((scene) => (
                                    <button
                                        key={scene.index}
                                        type="button"
                                        onClick={() => seekTo(scene.startMs)}
                                        className="group relative h-16 w-28 shrink-0 overflow-hidden rounded-md border border-border bg-black/20"
                                        title={`场景 ${scene.index} · ${formatMs(scene.startMs)}`}
                                    >
                                        {scene.keyframeUrl && (
                                            <img src={scene.keyframeUrl} alt={`场景 ${scene.index}`} className="h-full w-full object-cover" />
                                        )}
                                        <span className="absolute bottom-0 left-0 bg-black/60 px-1 text-caption text-white">
                                            #{scene.index} · {scene.tags.slice(0, 2).join(" / ") || "—"}
                                        </span>
                                    </button>
                                ))}
                            </div>
                            {view.scenes.some((s) => s.tags.length > 0) && (
                                <div className="mt-2 flex flex-col gap-1">
                                    {view.scenes.filter((s) => s.tags.length > 0).map((scene) => (
                                        <div key={scene.index} className="flex flex-wrap items-center gap-1 text-xs">
                                            <span className="font-mono text-foreground/40">#{scene.index} {formatMs(scene.startMs)}</span>
                                            {scene.tags.map((tag) => (
                                                <Tag key={tag} className="mr-0">{tag}</Tag>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div>
                            <h4 className="mb-2 text-xs font-semibold text-foreground/70">词级时间轴（点击跳转播放）</h4>
                            {view.chunks.length === 0 && (
                                <p className="text-xs text-foreground/40">无词级时间戳（素材可能无语音）</p>
                            )}
                            <div className="flex flex-wrap gap-1.5">
                                {view.chunks.map((chunk, i) => (
                                    <button
                                        key={`${chunk.startMs}-${i}`}
                                        type="button"
                                        onClick={() => seekTo(chunk.startMs)}
                                        className="rounded-md border border-border bg-surface-hover px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
                                    >
                                        <span className="mr-1 font-mono text-caption text-foreground/40">
                                            {formatMs(chunk.startMs)}
                                        </span>
                                        {chunk.text}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                            <Select
                                size="small"
                                allowClear
                                placeholder="绑定画布商品资产（可选）"
                                value={assetNodeId || undefined}
                                onChange={(value) => setAssetNodeId(value ?? "")}
                                options={assetNodes.map((node) => ({ value: node.id, label: node.title || node.id }))}
                                style={{ minWidth: 200 }}
                            />
                            <Button
                                icon={<Captions className="size-4" />}
                                disabled={view.chunks.length === 0}
                                loading={applying}
                                onClick={applySubtitles}
                            >
                                写入节点字幕（{view.chunks.length} 条）
                            </Button>
                            <Button
                                type="primary"
                                icon={<Workflow className="size-4" />}
                                disabled={view.scenes.length === 0}
                                loading={creating}
                                onClick={createStoryboard}
                            >
                                一键生成画布分镜组（{view.scenes.length} 镜）
                            </Button>
                            <Button icon={<PlayCircle className="size-4" />} onClick={onClose}>完成</Button>
                        </div>
                    </>
                )}
            </div>
        </AppModal>
    );
}
