import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Input, Progress, Select, Tag, Tooltip } from "antd";
import { ArrowLeft, FileVideo, PlayCircle, Sparkles, Upload } from "lucide-react";
import { Link, useNavigate } from "react-router";

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
import { buildStoryboardShots, presentEreversePft, type EreverseView } from "@/lib/canvas/ereverse-view";
import {
    buildVisualDnaText,
    copyStoryboardText,
    fetchKeyframeDataUrl,
    toHandoffShots,
    writeEreverseHandoff,
    writeLiveReferenceHandoff,
} from "./handoff";

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
// 返工令 Round 4：下拉框去黑话——原来默认项是「自动（智谱 → 反重力Gemini → Ollama → 本地Qwen）」，
// 一长串引擎名对小白就是天书；现在默认项只说人话，具体引擎链留在各选项里给进阶用户。
const VLM_OPTIONS: Array<{ value: EreverseVlmBackend; label: string }> = [
    { value: "auto", label: "🤖 智能多模态引擎（自动优选）" },
    { value: "gemini", label: "Gemini 中转（已授权）" },
    { value: "zhipu", label: "智谱 GLM-4V（国内云）" },
    { value: "ollama", label: "本地 Ollama" },
    { value: "hf-local", label: "本地 Qwen2.5-VL" },
];

const TERMINAL: EreverseStage[] = ["done", "error"];

/**
 * 反推产出物结构预览（静态示意，不造假接口调用）：
 * 上传区下方原来是大片空白，用户不知道点下去之后到底能拿到什么。
 * 三张示例卡把产出物结构摆出来——① 词级台词脚本 ② 镜头景别与运镜拆解 ③ 视觉 DNA 与生图提示词。
 */
const OUTPUT_PREVIEW: Array<{ num: string; title: string; desc: string; lines: string[] }> = [
    {
        num: "①",
        title: "词级台词脚本",
        desc: "每句台词带起止时间戳，点击即可跳转播放对照。",
        lines: ["00:00.240　家人们谁懂啊", "00:01.860　这个价格真的假的", "00:03.120　链接已经挂好了"],
    },
    {
        num: "②",
        title: "镜头景别与运镜拆解",
        desc: "按场景自动切片，标注景别、机位与运镜方式。",
        lines: ["中景 · 固定机位 · 口播", "特写 → 近景 · 推镜 · 产品展示", "全景 · 手持跟晃 · 收尾"],
    },
    {
        num: "③",
        title: "视觉 DNA 与生图提示词",
        desc: "配色、光线、构图打成标签，直接喂给生图复刻同款。",
        lines: ["暖黄侧光 · 奶油原木 · 45°俯拍", "高饱和红金 · 节庆光斑 · 居中构图", "提示词一键复制到生图工作台"],
    },
];

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
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [health, setHealth] = useState<EreverseHealth | null>(null);
    const [healthError, setHealthError] = useState<string | null>(null);
    const [videoPath, setVideoPath] = useState("");
    const [uploadedName, setUploadedName] = useState("");
    const [dragOver, setDragOver] = useState(false);
    const [advancedOpen, setAdvancedOpen] = useState(false);
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
            setUploadedName(file.name);
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

    /** 视觉配方提示词（结果区摘要 + 直播台出口共用一份口径）。 */
    const visualDnaText = useMemo(() => (view ? buildVisualDnaText(view) : ""), [view]);
    /** 画布 / 制片台出口的镜头序列快照。 */
    const handoffShots = useMemo(() => (view ? toHandoffShots(view) : []), [view]);
    /** 画布分镜 builder 产物（复制到剪贴板供「粘贴」动线）。 */
    const storyboardShots = useMemo(() => (view ? buildStoryboardShots(view) : []), [view]);

    /**
     * 主按钮点击：没上传不装死——按钮保持实心主色（G16 口径：主 CTA 必须可见可点），
     * 点击后给「下一步做什么」的人话提示，而不是灰着脸让用户猜。
     */
    const handleRunClick = useCallback(() => {
        if (!videoPath.trim()) {
            message.warning("先上传对标视频（或展开下方「高级」填服务端本地路径），再开始拆解");
            return;
        }
        if (uploading) {
            message.info("视频还在上传中，稍等一两秒再点");
            return;
        }
        void handleRun();
    }, [videoPath, uploading, handleRun, message]);

    /**
     * 三大实战出口（返工令 Round 5）。
     * 纪律：画布 / 制片台页面本轮不可改——预填它们需要动其他成员的文件或 services。
     * 因此重负载走 localStorage 快照 + URL 轻量标记，toast 如实告知「已带入反推配方，
     * 请在节点中粘贴/选择」，并尽量把分镜文本复制进剪贴板让「粘贴」真实可执行；
     * 只有直播台参考图模块同属本轮交付，会真实自动预填。严禁造假「已自动填入」。
     */
    const exitDisabledReason = "先完成拆解：上传视频后点上方「🔍 开始拆解爆款配方」，拿到结果就能复刻";

    const handleSendToCanvas = useCallback(async () => {
        if (!view) return;
        writeEreverseHandoff({ target: "canvas", sourceName: view.sourceName, shots: handoffShots, visualDnaText });
        const copied = await copyStoryboardText(storyboardShots);
        navigate("/canvas?from=ereverse&target=canvas");
        message.success(copied ? "已带入反推配方并复制分镜文本，请在画布「一键复刻」/分镜节点中粘贴/选择" : "已带入反推配方，请在画布「一键复刻」/分镜节点中粘贴/选择");
    }, [view, handoffShots, storyboardShots, visualDnaText, navigate, message]);

    const handleSendToProjects = useCallback(async () => {
        if (!view) return;
        writeEreverseHandoff({ target: "projects", sourceName: view.sourceName, shots: handoffShots, visualDnaText });
        const copied = await copyStoryboardText(storyboardShots);
        navigate("/projects?from=ereverse&target=projects");
        message.success(copied ? "已带入反推配方并复制分镜文本，请在制片台分镜中粘贴/选择" : "已带入反推配方，请在制片台分镜中粘贴/选择");
    }, [view, handoffShots, storyboardShots, visualDnaText, navigate, message]);

    const handleSendToLiveStudio = useCallback(async () => {
        if (!view) return;
        const firstKeyframe = view.scenes.find((scene) => scene.keyframeUrl)?.keyframeUrl || null;
        const referenceFrame = firstKeyframe ? await fetchKeyframeDataUrl(firstKeyframe) : null;
        const { frameDropped } = writeLiveReferenceHandoff({
            sourceName: view.sourceName,
            referenceFrame: referenceFrame || undefined,
            dnaText: visualDnaText,
        });
        navigate("/modules/live-studio?from=ereverse");
        message.success(
            referenceFrame && !frameDropped
                ? "已带入参考帧与视觉配方，直播台「🎯 对标参考图」模块已自动预填"
                : "参考帧过大或缺失，已带入视觉配方提示词，直播台参考图模块已自动预填",
        );
    }, [view, visualDnaText, navigate, message]);

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

    /** 状态点口径：ffmpeg + 词级 ASR + 全部 VLM 引擎都就绪才算「就绪」，否则「部分引擎降级」。 */
    const engineReady = Boolean(health && health.ffmpeg && health.wordLevelAsr && vlmChips.length > 0 && vlmChips.every((chip) => chip.available));

    return (
        <main className="min-h-screen bg-background text-foreground">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
                <header className="relative flex flex-col gap-2">
                    {/* 返工令 Round 4 · 去孤岛：本页在路由上不套工作台外壳（侧车页面历史原因），
                        左上角放醒目返回入口，用户不会一进来就困在黑话里。 */}
                    <Link
                        to="/modules"
                        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border/60 bg-surface px-3 py-1.5 text-xs font-medium text-foreground/70 shadow-sm transition-colors hover:border-primary/50 hover:text-primary"
                    >
                        <ArrowLeft className="size-3.5" /> 返回模块大厅
                    </Link>
                    {/* 返工令 Round 5 · 状态收敛：原来这里一排 6 个技术 Tag（ffmpeg / ASR / 四个引擎名）
                        全铺在页面中央，小白一进来就被黑话劝退。现在收成右上角一个极简状态点，
                        具体模型列表进 antd Tooltip（hover/focus 才显示）。
                        三态常驻：就绪 🟢 / 部分降级 🟡 / 侧车不可用 🔴——不因健康检查失败而消失。 */}
                    <div className="absolute right-0 top-0" data-yq="ereverse-status-zone">
                        <Tooltip
                            title={
                                healthError ? (
                                    <span>{healthError}</span>
                                ) : (
                                    <div className="flex flex-col gap-1">
                                        <span>ffmpeg {health?.ffmpeg ? "就绪" : "缺失"}</span>
                                        <span>词级 ASR {health?.wordLevelAsr ? "可用" : "降级（语音段）"}</span>
                                        {vlmChips.map((chip) => (
                                            <span key={chip.name}>
                                                {chip.name}：{chip.available ? "可用" : "不可用（未配置或服务未启动）"}
                                            </span>
                                        ))}
                                    </div>
                                )
                            }
                        >
                            <button
                                type="button"
                                className="yq-ereverse-status-dot inline-flex min-h-6 items-center gap-1.5 rounded-full border border-border/60 bg-surface px-2.5 py-1 text-caption text-foreground/70 transition-colors hover:border-primary/50 hover:text-primary"
                            >
                                <span aria-hidden>{healthError ? "🔴" : engineReady ? "🟢" : "🟡"}</span>
                                {healthError ? "拆片引擎未就绪" : engineReady ? "多模态拆片引擎就绪" : "部分引擎降级"}
                            </button>
                        </Tooltip>
                    </div>
                    <h1 className="flex items-center gap-2 text-xl font-semibold">
                        <Sparkles className="size-5 text-primary" />
                        爆款视觉反推
                    </h1>
                    <p className="max-w-2xl text-sm text-foreground/60">
                        上传爆款对标视频或图片，AI 自动拆解分镜脚本、台词时间戳与视觉 DNA 配方，一键复刻同款。
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

                {/* 3 步复刻引导条（返工令 Round 5）：把「上传 → 拆解 → 复刻」讲成小白三步，
                    消灭「点下去之后到底能干嘛」的茫然。极简步骤条，不占主交互区。 */}
                <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5" data-yq="ereverse-steps" aria-label="复刻三步">
                    {[
                        { step: "Step 1", text: "上传同行爆款视频 / 图" },
                        { step: "Step 2", text: "AI 拆解台词、分镜与视觉提示词" },
                        { step: "Step 3", text: "替换自家商品，一键复刻同款" },
                    ].map((item, index) => (
                        <li key={item.step} className="flex items-center gap-2">
                            {index > 0 ? <span aria-hidden className="text-foreground/30">➔</span> : null}
                            <span className="flex items-center gap-1.5 rounded-full border border-line-subtle bg-surface px-2.5 py-1 text-caption">
                                <strong className="font-semibold text-primary">{item.step}</strong>
                                <span className="text-foreground/70">{item.text}</span>
                            </span>
                        </li>
                    ))}
                </ol>

                {/* 主交互区：高颜值拖拽 / 点击上传大卡片（Dropzone） */}
                <section className="rounded-xl border border-border bg-surface p-4" aria-label="上传对标视频">
                    <label
                        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                            dragOver ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/50"
                        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
                        onDragOver={(event) => {
                            event.preventDefault();
                            setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(event) => {
                            event.preventDefault();
                            setDragOver(false);
                            const file = event.dataTransfer.files?.[0];
                            if (file) void handleUpload(file);
                        }}
                    >
                        <Upload className="size-8 text-primary" />
                        <span className="text-sm font-medium text-foreground/80">
                            {uploading ? "上传中…" : dragOver ? "松手即上传" : "拖拽对标视频到这里，或点击选择文件"}
                        </span>
                        <span className="text-caption text-foreground/50">支持 MP4 / MOV / WEBM / MKV 等常见格式，单个视频即可反推</span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.mkv,.avi,.flv,.m4v"
                            className="sr-only"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void handleUpload(file);
                                event.target.value = "";
                            }}
                        />
                    </label>
                    {videoPath ? (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-status-success">
                            <FileVideo className="size-3.5" />
                            已就绪：{uploadedName || videoPath}
                        </p>
                    ) : null}

                    {/* 引擎与运行参数：VLM 开关 + 智能引擎下拉 + 打标上下文 + 主按钮 */}
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                        {/* 用 Checkbox 而非 antd Switch：Switch 渲染成 32×18 的 button，
                            是 G13 明令清零的「纳米按钮」；Checkbox 同语义且不产生小按钮。 */}
                        <Checkbox checked={enableVlm} onChange={(e) => setEnableVlm(e.target.checked)}>
                            VLM 语义打标
                        </Checkbox>
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
                            disabled={running}
                            loading={starting}
                            onClick={handleRunClick}
                        >
                            {running ? "分析中…" : "🔍 开始拆解爆款配方"}
                        </Button>
                    </div>

                    {/* 高级：服务端本地路径（默认收起）——带双反斜杠的磁盘路径对小白是噪音，
                        只在侧车与本机同盘、需要复用已有素材时才有用。 */}
                    <div className="mt-3 border-t border-border/50 pt-2">
                        <button
                            type="button"
                            aria-expanded={advancedOpen}
                            className="flex min-h-6 items-center gap-1 text-caption text-foreground/50 transition-colors hover:text-foreground/70"
                            onClick={() => setAdvancedOpen((open) => !open)}
                        >
                            高级：使用服务端本地路径
                            <span aria-hidden>{advancedOpen ? "▴" : "▾"}</span>
                        </button>
                        {advancedOpen ? (
                            <div className="mt-2 flex flex-col gap-1.5">
                                <Input
                                    placeholder="视频绝对路径，如 D:\\edge download\\主图\\红光坐灸仪\\主图视频\\主图视频_1.mp4"
                                    value={videoPath}
                                    onChange={(e) => setVideoPath(e.target.value)}
                                    allowClear
                                />
                                <p className="text-caption leading-5 text-foreground/45">
                                    仅在侧车服务与本机同盘时使用；填路径后无需上传，直接点「🔍 开始拆解爆款配方」。
                                </p>
                            </div>
                        ) : null}
                    </div>
                </section>

                {/* 反推产出物结构预览：三栏示例卡，消灭下半屏空白 */}
                <section className="flex flex-col gap-2" aria-label="反推产出物结构预览">
                    <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground/75">
                        <Sparkles className="size-3.5 text-primary" />
                        ✨ 反推产出物结构预览
                    </h2>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        {OUTPUT_PREVIEW.map((item) => (
                            <div key={item.title} className="flex flex-col gap-2 rounded-xl border border-line-subtle bg-surface p-3.5">
                                <strong className="flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
                                    <span aria-hidden>{item.num}</span>
                                    {item.title}
                                </strong>
                                <p className="text-caption leading-5 text-foreground/50">{item.desc}</p>
                                <ul className="flex flex-col gap-1">
                                    {item.lines.map((line) => (
                                        <li key={line} className="rounded-md bg-surface-subtle px-2 py-1 font-mono text-caption text-foreground/65">
                                            {line}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                    <p className="text-caption text-foreground/40">以上为结构示例；上传视频后按实际素材产出对应内容。</p>
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
                                        <span className="absolute bottom-0 left-0 bg-black/60 px-1 text-caption text-white">
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
                            <h3 className="mb-2 text-sm font-medium text-foreground/70">词级时间轴（点击跳转播放）</h3>
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

                        {/* 分镜表（返工令 Round 5）：按镜头列出景别 / 运镜 / 视觉提示词 / 台词，
                            数据全部来自本轮反推结果（view.scenes），VLM 未产出的字段留空不臆造。 */}
                        <div>
                            <h3 className="mb-2 text-sm font-medium text-foreground/70">分镜表（按镜头重拍用）</h3>
                            <div className="flex flex-col gap-1.5">
                                {view.scenes.map((scene) => (
                                    <div key={scene.index} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line-subtle bg-surface-subtle/40 px-2 py-1.5 text-caption">
                                        <span className="font-mono text-foreground/40">#{scene.index + 1} {formatMs(scene.startMs)}</span>
                                        <span className="font-medium text-foreground/75">
                                            {[scene.shotType, scene.cameraMovement].filter(Boolean).join(" · ") || "景别未识别"}
                                        </span>
                                        <span className="line-clamp-2 min-w-0 flex-1 text-foreground/55">
                                            {scene.visualPrompt || scene.tags.join("、") || "无视觉提示词"}
                                        </span>
                                        {scene.dialogue ? <span className="line-clamp-1 min-w-0 basis-full text-foreground/45">台词：{scene.dialogue}</span> : null}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 视觉 DNA 摘要（返工令 Round 5）：配色 / 光线 / 构图打成可读配方，
                            也是「🎨 装修直播间 / 详情页」出口带走的同一份文本。 */}
                        <div>
                            <h3 className="mb-2 text-sm font-medium text-foreground/70">视觉 DNA 摘要（复刻同款画风用）</h3>
                            <p className="rounded-md border border-line-subtle bg-surface-subtle/40 px-2.5 py-2 text-caption leading-5 text-foreground/65">
                                {visualDnaText || "本轮素材没有产出可用的视觉描述"}
                            </p>
                        </div>
                    </section>
                )}

                {/* 三大实战出口（返工令 Round 5）：反推完成后才亮；没结果时 disabled + title 说明，
                    不允许「点了没反应」。画布 / 制片台只能带到快照 + 剪贴板（页面不可改），
                    直播台参考图模块真实自动预填——toast 按目标分别如实说明。 */}
                <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4" data-yq="ereverse-exits" aria-label="一键复刻出口">
                    <strong className="text-xs font-semibold text-foreground/75">🚀 拆解完成，选一条复刻出路</strong>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="primary"
                            disabled={!view}
                            title={view ? "携带拆解结果跳画布，预填「一键复刻」/分镜节点数据（快照 + 剪贴板）" : exitDisabledReason}
                            onClick={() => void handleSendToCanvas()}
                        >
                            🎬 一键复刻同款视频
                        </Button>
                        <Button
                            disabled={!view}
                            title={view ? "携分镜脚本跳短剧 / 视频制片台，按镜头重拍" : exitDisabledReason}
                            onClick={() => void handleSendToProjects()}
                        >
                            📽️ 导入短剧 / 视频制片台
                        </Button>
                        <Button
                            disabled={!view}
                            title={view ? "携视觉 DNA 提示词与参考帧跳直播台，参考图模块自动预填" : exitDisabledReason}
                            onClick={() => void handleSendToLiveStudio()}
                        >
                            🎨 装修直播间 / 详情页
                        </Button>
                    </div>
                    <p className="text-caption leading-5 text-foreground/45">
                        直播台参考图模块会自动预填参考帧与视觉配方；画布与制片台会带入反推快照并复制分镜文本，请在目标节点的输入框里粘贴 / 选择。
                    </p>
                </section>
            </div>
        </main>
    );
}
