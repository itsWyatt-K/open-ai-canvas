import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, Progress, Select, Switch, Tag, Tooltip } from "antd";
import { Database, FileVideo, PlayCircle, Upload } from "lucide-react";

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

const STAGE_ORDER: EreverseStage[] = ["queued", "probe", "tracks", "scenes", "keyframes", "asr", "vlm", "write"];
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
const VLM_OPTIONS: Array<{ value: EreverseVlmBackend; label: string }> = [
    { value: "auto", label: "自动（智谱 → 反重力Gemini → Ollama → 本地Qwen）" },
    { value: "gemini", label: "反重力中转 Gemini（已授权）" },
    { value: "zhipu", label: "智谱 GLM-4V（国内云）" },
    { value: "ollama", label: "本地 Ollama" },
    { value: "hf-local", label: "本地 Qwen2.5-VL（transformers）" },
];

const TERMINAL: EreverseStage[] = ["done", "error"];

// antd Tag 在本应用主题下无色 prop 会渲染成黑底，语义标签统一用可读的中性配色
const NEUTRAL_TAG_STYLE: React.CSSProperties = {
    color: "rgba(0,0,0,0.68)",
    backgroundColor: "rgba(0,0,0,0.04)",
    borderColor: "rgba(0,0,0,0.14)",
};

function formatMs(ms: number): string {
    const total = Math.max(0, ms);
    const s = Math.floor(total / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.${String(total % 1000).padStart(3, "0")}`;
}

export default function EReversePage() {
    const [health, setHealth] = useState<EreverseHealth | null>(null);
    const [healthError, setHealthError] = useState<string | null>(null);
    const [videoPath, setVideoPath] = useState("");
    const [enableVlm, setEnableVlm] = useState(true);
    const [vlmBackend, setVlmBackend] = useState<EreverseVlmBackend>("auto");
    const [context, setContext] = useState("");
    const [uploading, setUploading] = useState(false);
    const [starting, setStarting] = useState(false);
    const [jobId, setJobId] = useState<string | null>(null);
    const [status, setStatus] = useState<EreverseJobStatus | null>(null);
    const [view, setView] = useState<EreverseView | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const running = Boolean(jobId) && (!status || !TERMINAL.includes(status.stage));

    useEffect(() => {
        getEreverseHealth()
            .then((h) => {
                setHealth(h);
                setHealthError(null);
            })
            .catch((e: unknown) => setHealthError(e instanceof Error ? e.message : String(e)));
    }, []);

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
                    if (s.stage === "error") setView(null);
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

    const handleUpload = useCallback(async (file: File) => {
        setUploading(true);
        try {
            const { path } = await uploadEreverseVideo(file);
            setVideoPath(path);
        } catch (e) {
            setHealthError(e instanceof Error ? e.message : String(e));
        } finally {
            setUploading(false);
        }
    }, []);

    const handleRun = useCallback(async () => {
        setStarting(true);
        setView(null);
        setStatus(null);
        try {
            const { id } = await startEreverseJob({
                video: videoPath.trim(),
                enable_vlm: enableVlm,
                vlm_backend: vlmBackend,
                context: context.trim(),
            });
            setJobId(id);
        } catch (e) {
            setHealthError(e instanceof Error ? e.message : String(e));
        } finally {
            setStarting(false);
        }
    }, [videoPath, enableVlm, vlmBackend, context]);

    const stage = status?.stage;
    const progressPct = useMemo(() => {
        if (!stage) return 0;
        if (stage === "done") return 100;
        if (stage === "error") return 100;
        return STAGE_PCT[stage] ?? 5;
    }, [stage]);

    const vlmChips = useMemo(() => {
        if (!health) return [];
        return Object.values(health.vlm).map((b) => ({ name: b.name, available: b.available }));
    }, [health]);

    return (
        <div className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
                <header className="flex flex-col gap-1">
                    <h1 className="flex items-center gap-2 text-xl font-semibold">
                        <Database className="size-5 text-primary" />
                        E-Reverse · 视频事实表工作台
                    </h1>
                    <p className="text-sm text-foreground/60">
                        逆向声明式视频管线：成片 → 词级时间戳 + 场景 + 语义标签 → pft/v1 事实表。全流程本地侧车执行（127.0.0.1:8790）。
                    </p>
                </header>

                {healthError && (
                    <Alert
                        type="warning"
                        showIcon
                        message="侧车服务不可用"
                        description={healthError + " —— 请先启动：工具\\e-reverse\\.venv\\Scripts\\python.exe 工具\\e-reverse\\server.py"}
                    />
                )}
                {!healthError && health && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Tag color={health.ffmpeg ? "green" : "red"}>ffmpeg {health.ffmpeg ? "就绪" : "缺失"}</Tag>
                        <Tag color={health.wordLevelAsr ? "green" : "orange"}>
                            词级 ASR {health.wordLevelAsr ? "可用" : "降级（语音段）"}
                        </Tag>
                        {vlmChips.map((chip) => (
                            <Tooltip key={chip.name} title={chip.available ? "可用" : "不可用（未配置或服务未启动）"}>
                                <Tag color={chip.available ? "green" : undefined}
                                    style={chip.available ? undefined : NEUTRAL_TAG_STYLE}>
                                    {chip.name}
                                </Tag>
                            </Tooltip>
                        ))}
                    </div>
                )}

                <section className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex flex-col gap-3">
                        <div className="flex items-center gap-2">
                            <FileVideo className="size-4 shrink-0 text-foreground/50" />
                            <Input
                                placeholder="视频绝对路径，如 D:\\edge download\\主图\\红光坐灸仪\\主图视频\\主图视频_1.mp4"
                                value={videoPath}
                                onChange={(e) => setVideoPath(e.target.value)}
                                allowClear
                            />
                            <>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.mkv,.avi,.flv,.m4v"
                                    className="hidden"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) void handleUpload(file);
                                        e.target.value = "";
                                    }}
                                />
                                <Button
                                    icon={<Upload className="size-4" />}
                                    loading={uploading}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    上传视频
                                </Button>
                            </>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-2 text-sm">
                                <Switch size="small" checked={enableVlm} onChange={setEnableVlm} />
                                VLM 语义打标
                            </label>
                            <Select
                                className="min-w-64"
                                size="small"
                                value={vlmBackend}
                                disabled={!enableVlm}
                                options={VLM_OPTIONS}
                                onChange={(v) => setVlmBackend(v as EreverseVlmBackend)}
                            />
                            <Input
                                className="max-w-64"
                                size="small"
                                placeholder="打标上下文（如：短剧第1集）"
                                value={context}
                                onChange={(e) => setContext(e.target.value)}
                                disabled={!enableVlm}
                            />
                            <Button
                                type="primary"
                                icon={<PlayCircle className="size-4" />}
                                disabled={!videoPath.trim() || running || uploading}
                                loading={starting}
                                onClick={() => void handleRun()}
                            >
                                {running ? "分析中…" : "生成事实表"}
                            </Button>
                        </div>
                    </div>
                </section>

                {jobId && status && (
                    <section className="rounded-xl border border-border bg-surface p-4">
                        <div className="mb-2 flex items-center justify-between text-sm">
                            <span>
                                {stage === "error" ? "任务失败" : STAGE_LABEL[stage ?? "queued"]}
                                <span className="ml-2 font-mono text-xs text-foreground/40">{jobId}</span>
                            </span>
                            <span className="text-xs text-foreground/50">{progressPct}%</span>
                        </div>
                        <Progress
                            percent={progressPct}
                            status={stage === "error" ? "exception" : stage === "done" ? "success" : "active"}
                        />
                        {stage === "error" && status.error && (
                            <Alert className="mt-3" type="error" showIcon message={status.error} />
                        )}
                    </section>
                )}

                {view && jobId && (
                    <section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-medium">{view.sourceName}</span>
                            <span className="text-xs text-foreground/50">
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
                            className="max-h-[420px] w-full rounded-lg bg-black"
                            src={ereverseAssetUrl(jobId, "video")}
                            controls
                            playsInline
                            preload="auto"
                        />

                        <div>
                            <h3 className="mb-2 text-sm font-medium text-foreground/70">场景与语义标签</h3>
                            <div className="relative h-24 w-full overflow-hidden rounded-lg border border-border bg-black/20">
                                {view.scenes.map((scene) => (
                                    <button
                                        key={scene.index}
                                        type="button"
                                        className="absolute top-0 h-full overflow-hidden border-l border-border/60"
                                        style={{ left: `${scene.leftPct}%`, width: `${scene.widthPct}%` }}
                                        onClick={() => seekTo(scene.startMs)}
                                        title={`场景 ${scene.index} · ${formatMs(scene.startMs)}`}
                                    >
                                        {scene.keyframeUrl && (
                                            <img
                                                src={scene.keyframeUrl}
                                                alt={`场景 ${scene.index}`}
                                                className="h-full w-full object-cover"
                                            />
                                        )}
                                        <span className="absolute bottom-0 left-0 bg-black/60 px-1 text-[10px] text-white">
                                            #{scene.index}
                                        </span>
                                    </button>
                                ))}
                            </div>
                            <div className="mt-2 flex flex-col gap-1">
                                {view.scenes.map((scene) => (
                                    <div key={scene.index} className="flex flex-wrap items-center gap-1 text-xs">
                                        <span className="font-mono text-foreground/40">
                                            #{scene.index} {formatMs(scene.startMs)}
                                        </span>
                                        {scene.tags.map((tag) => (
                                            <Tag key={tag} className="mr-0" style={NEUTRAL_TAG_STYLE}>{tag}</Tag>
                                        ))}
                                        {scene.tags.length === 0 && <span className="text-foreground/30">（无标签）</span>}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h3 className="mb-2 text-sm font-medium text-foreground/70">
                                词级时间轴（点击跳转播放）
                            </h3>
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
                                        <span className="mr-1 font-mono text-[10px] text-foreground/40">
                                            {formatMs(chunk.startMs)}
                                        </span>
                                        {chunk.text}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}
