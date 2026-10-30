import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Input, Progress, Select, Tooltip } from "antd";
import { ArrowLeft, FileVideo, PlayCircle, Sparkles, Upload } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { ereverseAssetUrl, getEreverseHealth, getEreverseJobStatus, startEreverseJob, uploadEreverseVideo, type EreverseHealth, type EreverseJobStatus, type EreverseStage, type EreverseVlmBackend } from "@/services/api/ereverse";
import { buildStoryboardShots, presentEreversePft, type EreversePromptSlots, type EreverseView } from "@/lib/canvas/ereverse-view";
import { buildVisualDnaText, copyStoryboardText, fetchKeyframeDataUrl, goldenThreeShotIndexes, toHandoffShots, writeEreverseHandoff, writeLiveReferenceHandoff } from "./handoff";
import { FragmentBar, type FragmentWindow } from "./fragment-bar";
import { AnalysisPanel } from "./analysis-panel";
import { CopyStudio } from "./copy-studio";

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
    queued: 3,
    probe: 10,
    tracks: 25,
    scenes: 40,
    keyframes: 55,
    asr: 72,
    vlm: 88,
    write: 96,
    done: 100,
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

/**
 * 返工令 Round 6：AbortController 超时的原生文案「signal is aborted without reason」
 * 对用户是黑话（侧车明明在跑却报此错 = 假死）。统一翻译成人话，页面严禁露出原文
 * （探针 G19 门禁断言页面上不存在该文本）。
 */
function describeEreverseError(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    if (/signal\s*is\s*aborted|AbortError|aborted\s+without\s+reason/i.test(raw)) {
        return "连接超时：拆片引擎响应超过 15 秒（首次检查可能仍在加载模型），请点「重新检测连接」重试";
    }
    return raw;
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
    // 镜头筛选与成本闸门（夜间施工令阶段三）：null=全选；防 8×N 盲目扣费，投送只带走勾选镜。
    const [selectedSceneIndexes, setSelectedSceneIndexes] = useState<Set<number> | null>(null);
    // 🛡️ 敏感品类防封改写：开启时分镜行画面描述用 compliancePrompt 双轨稿。
    const [preferCompliance, setPreferCompliance] = useState(false);
    // 返工令 Round 6：侧车告警框右侧的补救动作态（重新检测 / 一键启动）
    const [sidecarAction, setSidecarAction] = useState<"idle" | "checking" | "starting">("idle");
    // 片段仿拍双模面板：analysis=五维解析（默认） / studio=AI 仿拍创作台
    const [mode, setMode] = useState<"analysis" | "studio">("analysis");
    const [studioSlots, setStudioSlots] = useState<EreversePromptSlots | null>(null);
    const [studioSourceLabel, setStudioSourceLabel] = useState("");
    // 已提交拆解的时间窗（回执对齐；null=整条）
    const [committedWindow, setCommittedWindow] = useState<FragmentWindow | null>(null);
    const videoRef = useRef<HTMLVideoElement>(null);

    const running = Boolean(jobId) && (!status || !TERMINAL.includes(status.stage));

    useEffect(() => {
        getEreverseHealth()
            .then((h) => {
                setHealth(h);
                setHealthError(null);
            })
            .catch((e: unknown) => setHealthError(describeEreverseError(e)));
    }, []);

    /** 重新检测连接：手动重跑一次健康检查，不等页面刷新。 */
    const recheckHealth = useCallback(async () => {
        setSidecarAction("checking");
        try {
            const h = await getEreverseHealth();
            setHealth(h);
            setHealthError(null);
        } catch (e: unknown) {
            setHealthError(describeEreverseError(e));
        } finally {
            setSidecarAction("idle");
        }
    }, []);

    /**
     * 一键启动拆片服务：经 vite 代理 `/yuanqi-console` 调本地控制台 (:17580) 的
     * start/ereverse 接口——控制台负责拉起 E-Reverse 侧车（最长等 30s），
     * 这里轮询健康检查直到就绪。控制台没开时如实告知走 启动源起.vbs。
     */
    const startSidecar = useCallback(async () => {
        setSidecarAction("starting");
        try {
            const res = await fetch("/yuanqi-console/api/start/ereverse", { method: "POST" });
            if (!res.ok) throw new Error(`控制台返回 HTTP ${res.status}`);
            const deadline = Date.now() + 50_000;
            let lastErr = "";
            while (Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 2_500));
                try {
                    const h = await getEreverseHealth();
                    setHealth(h);
                    setHealthError(null);
                    message.success("拆片服务已启动，引擎自检完成");
                    return;
                } catch (e: unknown) {
                    lastErr = describeEreverseError(e);
                }
            }
            setHealthError(lastErr || "拆片服务启动超时：请打开控制台 (127.0.0.1:17580) 在 E-Reverse 卡片查看日志");
        } catch (e: unknown) {
            setHealthError(`无法连接本地控制台（127.0.0.1:17580）：${e instanceof Error ? e.message : String(e)}。请双击「启动源起.vbs」打开控制台，在 E-Reverse 卡片点「▶ 启动」`);
        } finally {
            setSidecarAction("idle");
        }
    }, [message]);

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
                        setSelectedSceneIndexes(null);
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
            setHealthError(describeEreverseError(e));
        } finally {
            setUploading(false);
        }
    }, []);

    /** 启动反推：window 缺省=整条；传入=片段仿拍时间窗（毫秒，侧车裁剪后时间戳回正总轴）。 */
    const handleRun = useCallback(
        async (window?: FragmentWindow) => {
            setStarting(true);
            setView(null);
            setStatus(null);
            setMode("analysis");
            try {
                const { id } = await startEreverseJob({
                    video: videoPath.trim(),
                    enable_vlm: enableVlm,
                    vlm_backend: vlmBackend,
                    context: context.trim(),
                    ...(window ? { start_ms: window.startMs, end_ms: window.endMs } : {}),
                });
                setCommittedWindow(window ?? null);
                setJobId(id);
            } catch (e) {
                setHealthError(describeEreverseError(e));
            } finally {
                setStarting(false);
            }
        },
        [videoPath, enableVlm, vlmBackend, context],
    );

    /** 视觉配方提示词（结果区摘要 + 直播台出口共用一份口径）。 */
    const visualDnaText = useMemo(() => (view ? buildVisualDnaText(view) : ""), [view]);
    /** 画布 / 制片台出口的镜头序列快照（只带勾选镜——成本闸门，防 8×N 盲目扣费）。 */
    const handoffShots = useMemo(() => (view ? toHandoffShots(view, { selectedIndexes: selectedSceneIndexes ?? undefined }) : []), [view, selectedSceneIndexes]);
    /** 画布分镜 builder 产物（复制到剪贴板供「粘贴」动线）。 */
    const storyboardShots = useMemo(() => (view ? buildStoryboardShots(view) : []), [view]);
    /** 侧车原视频绝对地址（参考视频必须是 http(s)，相对 URL 会被资源上传层拒绝）。 */
    const sourceVideoUrl = useMemo(() => (jobId && typeof window !== "undefined" ? `${window.location.origin}${ereverseAssetUrl(jobId, "video")}` : null), [jobId]);

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
        writeEreverseHandoff({ target: "canvas", sourceName: view.sourceName, shots: handoffShots, visualDnaText, sourceVideoUrl: /^https?:\/\//.test(videoPath) ? videoPath : undefined, preferCompliance });
        const copied = await copyStoryboardText(storyboardShots);
        navigate("/canvas?handoff=ereverse");
        message.success(copied ? `已带入 ${handoffShots.length} 镜并复制分镜文本：画布将自动落出关键帧参考、自家主体锁定卡与分镜表（不自动生成、不扣费）` : "已带入反推配方：画布将自动落出关键帧参考、自家主体锁定卡与分镜表（不自动生成、不扣费）");
    }, [view, handoffShots, storyboardShots, visualDnaText, videoPath, preferCompliance, navigate, message]);

    const handleSendToProjects = useCallback(async () => {
        if (!view) return;
        writeEreverseHandoff({ target: "projects", sourceName: view.sourceName, shots: handoffShots, visualDnaText, preferCompliance });
        const copied = await copyStoryboardText(storyboardShots);
        navigate("/projects?handoff=ereverse");
        message.success(copied ? `已带入 ${handoffShots.length} 镜：制片台分镜导入处提供「从爆款反推导入」一键按钮` : "已带入反推配方：制片台分镜导入处提供「从爆款反推导入」一键按钮");
    }, [view, handoffShots, storyboardShots, visualDnaText, preferCompliance, navigate, message]);

    // R2 联动（OiiOii 全能复刻）：把参考视频路径 + 勾选时间窗 + 分镜语义带入 /omnireplica，
    // 那边 consumes 后可直接「开始拆解」（0 积分本地引擎）；不伪造「已自动出片」。
    const handleSendToOmniReplica = useCallback(() => {
        if (!view) return;
        const selected = handoffShots;
        if (!selected.length) {
            message.warning("当前勾选镜头为 0：至少勾选一镜再送入全能复刻");
            return;
        }
        const startMs = Math.min(...selected.map((shot) => shot.startMs));
        const endMs = Math.max(...selected.map((shot) => shot.endMs));
        const payload = {
            sourceName: view.sourceName,
            // 服务端本地路径（e-reverse 同源；omnireplica 拆解管线直接可吃，免二次上传）
            videoPath: videoPath.trim(),
            startMs,
            endMs,
            visualDnaText,
            shots: selected.map((shot) => ({ index: shot.index, title: shot.title, startMs: shot.startMs, endMs: shot.endMs, shotType: shot.shotType, cameraMovement: shot.cameraMovement, visualPrompt: shot.visualPrompt, compliancePrompt: shot.compliancePrompt, dialogue: shot.dialogue })),
            at: new Date().toISOString(),
        };
        try {
            window.localStorage.setItem("ereverse-to-omnireplica", JSON.stringify(payload));
        } catch {
            message.error("本地快照写入失败，无法带入全能复刻");
            return;
        }
        navigate("/omnireplica?from=ereverse");
        message.success(`已带入《${view.sourceName}》与 ${selected.length} 镜时间窗：全能复刻台可直接开始拆解（0 积分本地引擎）`);
    }, [view, handoffShots, videoPath, visualDnaText, navigate, message]);

    const handleSendToLiveStudio = useCallback(async () => {
        if (!view) return;
        const firstKeyframe = view.scenes.find((scene) => scene.keyframeUrl)?.keyframeUrl || null;
        const referenceFrame = firstKeyframe ? await fetchKeyframeDataUrl(firstKeyframe) : null;
        const { frameDropped } = writeLiveReferenceHandoff({
            sourceName: view.sourceName,
            referenceFrame: referenceFrame || undefined,
            dnaText: visualDnaText,
        });
        navigate("/modules/live-studio?from=ereverse");        message.success(referenceFrame && !frameDropped ? "已带入参考帧与视觉配方，直播台「🎯 对标参考图」模块已自动预填" : "参考帧过大或缺失，已带入视觉配方提示词，直播台参考图模块已自动预填");
    }, [view, visualDnaText, navigate, message]);

    /** 进入仿拍创作台：携带当前镜头（或整段合并）的槽位树。 */
    const handleEnterStudio = useCallback((slots: EreversePromptSlots, label: string) => {
        setStudioSlots(slots);
        setStudioSourceLabel(label);
        setMode("studio");
    }, []);

    /** 仿拍成片送入画布：在勾选镜快照后追加一条带 videoUrl 的合成镜头。 */
    const handleSendVideoToCanvas = useCallback(
        (videoUrl: string, prompt: string) => {
            if (!view) return;
            const videoShot = {
                index: handoffShots.length,
                title: `仿拍成片（${studioSourceLabel || "片段仿拍"}）`,
                startMs: 0,
                endMs: 0,
                durationMs: 0,
                shotType: "",
                cameraMovement: "",
                prompt,
                visualPrompt: prompt,
                compliancePrompt: "",
                negativePrompt: "",
                dialogue: "",
                keyframeUrl: null,
                videoUrl,
            };
            writeEreverseHandoff({
                target: "canvas",
                sourceName: view.sourceName,
                shots: [...handoffShots, videoShot],
                visualDnaText,
                preferCompliance,
            });
            navigate("/canvas?handoff=ereverse");
            message.success("已带入仿拍成片与提示词：画布将落出参考，请在节点里粘贴/选择（不自动生成、不扣费）");
        },
        [view, handoffShots, visualDnaText, preferCompliance, studioSourceLabel, navigate, message],
    );

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
    // 施工包一：侧车 /health 透出 warmingUp（首个任务加载模型中），状态点如实标注
    const warmingUp = Boolean(health && (health as { warmingUp?: boolean }).warmingUp);

    return (
        <main className="app-user-content app-workspace-scroll h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
                <header className="relative flex flex-col gap-2">
                    {/* 侧栏已提供全局导航，这里保留一个返回「定制模块」的快捷入口（二级便利，非唯一出路）。 */}
                    <Link
                        to="/modules"
                        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border/60 bg-surface px-3 py-1.5 text-xs font-medium text-foreground/70 shadow-sm transition-colors hover:border-primary/50 hover:text-primary"
                    >
                        <ArrowLeft className="size-3.5" /> 返回定制模块
                    </Link>
                    {/* 返工令 Round 6 · 状态收敛：原来这里一排 6 个技术 Tag（ffmpeg / ASR / 四个引擎名）
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
                                {warmingUp && !healthError && <span className="text-foreground/40">（模型加载中）</span>}
                            </button>
                        </Tooltip>
                    </div>
                    <h1 className="flex items-center gap-2 text-xl font-semibold">
                        <Sparkles className="size-5 text-primary" />
                        爆款视觉反推
                    </h1>
                    <p className="max-w-2xl text-sm text-foreground/60">上传爆款对标视频或图片，AI 自动拆解分镜脚本、台词时间戳与视觉 DNA 配方，一键复刻同款。</p>
                </header>

                {healthError && (
                    <Alert
                        type="warning"
                        showIcon
                        message="侧车服务不可用"
                        description={
                            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <span>{healthError} —— 请先启动：工具\e-reverse\.venv\Scripts\python.exe 工具\e-reverse\server.py</span>
                                <Button size="small" loading={sidecarAction === "checking"} onClick={() => void recheckHealth()}>
                                    重新检测连接
                                </Button>
                                <Button size="small" type="primary" loading={sidecarAction === "starting"} onClick={() => void startSidecar()}>
                                    ⚡ 一键启动拆片服务
                                </Button>
                            </span>
                        }
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
                            {index > 0 ? (
                                <span aria-hidden className="text-foreground/30">
                                    ➔
                                </span>
                            ) : null}
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
                        <span className="text-sm font-medium text-foreground/80">{uploading ? "上传中…" : dragOver ? "松手即上传" : "拖拽对标视频到这里，或点击选择文件"}</span>
                        <span className="text-caption text-foreground/50">支持 MP4 / MOV / WEBM / MKV 等常见格式，单个视频即可反推</span>
                        <input
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
                        <Select className="min-w-64" size="small" value={vlmBackend} disabled={!enableVlm} options={VLM_OPTIONS} onChange={(v) => setVlmBackend(v as EreverseVlmBackend)} />
                        <Input className="max-w-64" size="small" placeholder="打标上下文（如：短剧第1集）" value={context} onChange={(e) => setContext(e.target.value)} disabled={!enableVlm} />
                        <Button type="primary" icon={<PlayCircle className="size-4" />} disabled={running} loading={starting} onClick={handleRunClick}>
                            {running ? "分析中…" : "🔍 开始拆解爆款配方"}
                        </Button>
                    </div>

                    {/* 高级：服务端本地路径（默认收起）——带双反斜杠的磁盘路径对小白是噪音，
                        只在侧车与本机同盘、需要复用已有素材时才有用。 */}
                    <div className="mt-3 border-t border-border/50 pt-2">
                        <button type="button" aria-expanded={advancedOpen} className="flex min-h-6 items-center gap-1 text-caption text-foreground/50 transition-colors hover:text-foreground/70" onClick={() => setAdvancedOpen((open) => !open)}>
                            高级：使用服务端本地路径
                            <span aria-hidden>{advancedOpen ? "▴" : "▾"}</span>
                        </button>
                        {advancedOpen ? (
                            <div className="mt-2 flex flex-col gap-1.5">
                                <Input placeholder="视频绝对路径，如 D:\\edge download\\主图\\红光坐灸仪\\主图视频\\主图视频_1.mp4" value={videoPath} onChange={(e) => setVideoPath(e.target.value)} allowClear />
                                <p className="text-caption leading-5 text-foreground/45">仅在侧车服务与本机同盘时使用；填路径后无需上传，直接点「🔍 开始拆解爆款配方」。</p>
                            </div>
                        ) : null}
                    </div>
                </section>

                {/* 反推产出物结构预览：三栏示例卡，消灭下半屏空白 */}
                {!view && (
                    <section className="flex flex-col gap-2" aria-label="反推产出物结构预览">
                        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground/75">
                            <Sparkles className="size-3.5 text-primary" />✨ 反推产出物结构预览
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
                )}

                {jobId && status && (
                    <section className="rounded-xl border border-border bg-surface p-4">
                        <div className="mb-2 flex items-center justify-between text-sm">
                            <span>
                                {stage === "error" ? "任务失败" : STAGE_LABEL[stage ?? "queued"]}
                                <span className="ml-2 font-mono text-xs text-foreground/40">{jobId}</span>
                            </span>
                            <span className="text-xs text-foreground/50">{progressPct}%</span>
                        </div>
                        <Progress percent={progressPct} status={stage === "error" ? "exception" : stage === "done" ? "success" : "active"} />
                        {stage === "error" && status.error && <Alert className="mt-3" type="error" showIcon message={status.error} />}
                    </section>
                )}

                {/* 双模工作台（对标 AppGrowing）：左栏 42% 视频+黄金分段轴 ｜ 右栏 58% 解析/仿拍 */}
                {view && jobId && (
                    <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[42%_58%]" data-yq="ereverse-workbench">
                        <FragmentBar
                            videoRef={videoRef}
                            videoUrl={ereverseAssetUrl(jobId, "video")}
                            durationMs={view.durationMs}
                            committed={committedWindow}
                            scenes={view.scenes}
                            running={running}
                            onSeek={seekTo}
                            onCommit={(window) => void handleRun(window)}
                        />
                        <div className="min-h-[560px]">
                            {mode === "studio" && studioSlots ? (
                                <CopyStudio slots={studioSlots} sourceLabel={studioSourceLabel} sourceVideoUrl={sourceVideoUrl} onBack={() => setMode("analysis")} onGoCanvas={() => void handleSendToCanvas()} onSendToCanvas={handleSendVideoToCanvas} />
                            ) : (
                                <AnalysisPanel
                                    view={view}
                                    selectedSceneIndexes={selectedSceneIndexes}
                                    onSelectedSceneIndexesChange={setSelectedSceneIndexes}
                                    onGoldenThree={() => view && setSelectedSceneIndexes(goldenThreeShotIndexes(view))}
                                    preferCompliance={preferCompliance}
                                    onPreferComplianceChange={setPreferCompliance}
                                    onReextract={() => void handleRun(committedWindow ?? undefined)}
                                    reextracting={running}
                                    onEnterStudio={handleEnterStudio}
                                    onSeek={seekTo}
                                />
                            )}
                        </div>
                    </div>
                )}

                {/* 三大实战出口（返工令 Round 5）：反推完成后才亮；没结果时 disabled + title 说明，
                    不允许「点了没反应」。画布 / 制片台只能带到快照 + 剪贴板（页面不可改），
                    直播台参考图模块真实自动预填——toast 按目标分别如实说明。 */}
                <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4" data-yq="ereverse-exits" aria-label="一键复刻出口">
                    <strong className="text-xs font-semibold text-foreground/75">🚀 拆解完成，选一条复刻出路</strong>
                    <Checkbox checked={preferCompliance} onChange={(event) => setPreferCompliance(event.target.checked)} title="开启后分镜行画面描述改用敏感品类防封改写稿（无改写稿的镜头自动回退物理描述）">
                        🛡️ 敏感品类防封改写（投送时分镜画面描述用 compliance 稿）
                    </Checkbox>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button type="primary" disabled={!view} title={view ? "携带拆解结果跳画布，预填「一键复刻」/分镜节点数据（快照 + 剪贴板）" : exitDisabledReason} onClick={() => void handleSendToCanvas()}>
                            🎬 一键复刻同款视频
                        </Button>
                        <Button disabled={!view} title={view ? "携分镜脚本跳短剧 / 视频制片台，按镜头重拍" : exitDisabledReason} onClick={() => void handleSendToProjects()}>
                            📽️ 导入短剧 / 视频制片台
                        </Button>
                        <Button disabled={!view} title={view ? "携视觉 DNA 提示词与参考帧跳直播台，参考图模块自动预填" : exitDisabledReason} onClick={() => void handleSendToLiveStudio()}>
                            🎨 装修直播间 / 详情页
                        </Button>
                        <Button disabled={!view} title={view ? "携参考视频路径与勾选时间窗跳全能复刻台：动效蓝图 + 精灵图 + 代码渲染成片（0 积分）" : exitDisabledReason} onClick={handleSendToOmniReplica}>
                            🌛 送入全能复刻（代码+精灵图）
                        </Button>
                    </div>
                    <p className="text-caption leading-5 text-foreground/45">直播台参考图模块会自动预填参考帧与视觉配方；画布与制片台会带入反推快照并复制分镜文本，请在目标节点的输入框里粘贴 / 选择。</p>
                </section>
            </div>
        </main>
    );
}
