/**
 * OiiOii「全能复刻」主舱（/omnireplica）。
 *
 * 三段式输入舱（《交付方案 v1.2》§7）：
 *   左：参考视频卡 1~5（缩略图 + 「参考视频」角标 + 黄金片段选区，主参考驱动拆解）
 *   右：编号产品图 [1]~[5]（上传即提示透明底预提；编号即蓝图 slot 绑定键）
 *   下：结构化指令模板（可编辑）+ 底部控制栏（引擎 / 清晰度 / 并发 + 发送）
 *
 * 硬不变量：渲染/改稿/裂变路径 0 积分（不建 Go 计费任务）——页面常驻徽标明示。
 * 契约未就绪时走标注 mock（omniApi 单点切换），联调日整旗清除。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Input, Progress, Radio, Select, Tooltip } from "antd";
import { ArrowLeft, Clapperboard, FileVideo2, ImagePlus, Info, Sparkles, Upload, Video, Wrench } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { getOmniJobStatus, OmnireplicaApiError, startOmniExtract, uploadEreverseVideo, type EreverseJobStatus, type EreverseVlmBackend } from "@/services/api/omnireplica";
import { blueprintFromMotion, defaultFpsFor, emptyBlueprint, type MotionBlueprint } from "@/lib/omnireplica/blueprint";
import { BlueprintEditor } from "./blueprint-editor";
import { CopyBench, type RenderRecord } from "./copy-bench";
import { mockGetOmniJobStatus, mockStartOmniExtract } from "./mock";
import { writeOmniHandoff } from "./handoff";

const EXTRACT_STAGES: Array<{ key: string; label: string }> = [
    { key: "queued", label: "排队中" },
    { key: "probe", label: "探测素材" },
    { key: "tracks", label: "抽取音视频轨" },
    { key: "scenes", label: "场景检测" },
    { key: "keyframes", label: "提取关键帧" },
    { key: "asr", label: "词级 ASR" },
    { key: "vlm", label: "VLM 动效打标" },
    { key: "write", label: "落盘事实表" },
];

/** 结构化复刻指令模板（可编辑；发送时作为 VLM 打标上下文）。 */
const DEFAULT_INSTRUCTION = "参考已上传的视频，制作一条 [主题] 产品展示视频。保留原视频的画幅、时长、页面布局、大标题排版、镜头顺序、产品切换方式、转场节奏及元素运动效果。【产品替换】将原视频中的主体全部替换为我上传图片 [1-5] 中的产品。";

/** 引擎选项：MVP 默认本地优先（0 积分）；Gemini 需显式选择并明示成本归属。 */
const VLM_OPTIONS: Array<{ value: EreverseVlmBackend; label: string; note: string }> = [
    { value: "hf-local", label: "🤖 本地 Qwen2.5-VL（默认 · 0 积分）", note: "本机推理，不经任何计费" },
    { value: "ollama", label: "本地 Ollama（0 积分）", note: "本机推理，不经任何计费" },
    { value: "gemini", label: "Gemini 中转（需显式选择）", note: "走本机中转，不经我方计费；额度与合规责任归属使用者" },
    { value: "auto", label: "智能多模态引擎（自动优选）", note: "可能走云端引擎（智谱等需外部 key），成本归属以引擎侧为准" },
];

const RESOLUTION_OPTIONS = [
    { value: "480p", label: "480p 试看（默认 24fps）", note: "快速验证动效与文案" },
    { value: "1080p", label: "1080p 成片（默认 30fps）", note: "交付口径统一；高清本就是全量语义" },
];

export type ReferenceVideo = {
    id: string;
    name: string;
    /** e-reverse 侧车回执路径（拆解入参）。 */
    path: string;
    /** 本会话本地预览 objectURL（不落盘）。 */
    previewUrl: string;
    durationMs: number;
    width: number;
    height: number;
    /** 黄金片段时间窗（毫秒；null=整条）。 */
    fragment: { startMs: number; endMs: number } | null;
};

export type ProductImage = {
    id: string;
    name: string;
    dataUrl: string;
    /** 透明底预提提示（渲染管线按需处理；不伪造接口调用）。 */
    mattingNote: string;
};

export type OmniView = "cockpit" | "editor" | "bench";

const HOOK_MS = 11_000;

function formatMs(ms: number): string {
    const total = Math.max(0, ms);
    const s = Math.floor(total / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function describeError(e: unknown): string {
    if (e instanceof OmnireplicaApiError) return e.message;
    const raw = e instanceof Error ? e.message : String(e);
    if (/signal\s*is\s*aborted|AbortError|aborted\s+without\s+reason/i.test(raw)) return "连接超时：引擎响应超时（首次调用可能仍在加载模型），请稍后重试";
    return raw;
}

/** 拆解阶段 → 进度百分比（与 STAGE_PCT 同口径，不引入第二套计时）。 */
function extractPct(stage: string): number {
    const index = EXTRACT_STAGES.findIndex((item) => item.key === stage);
    if (stage === "done") return 100;
    if (stage === "error") return 100;
    return index <= 0 ? 3 : Math.round((index / (EXTRACT_STAGES.length - 1)) * 96) + 2;
}

export default function OmnireplicaPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();

    // ---- mock 模式（DEV 默认开；?mock=0 关；?mock=1 强制开；联调日整旗清除）----
    const [mock, setMock] = useState<boolean>(() => {
        if (typeof window === "undefined") return false;
        const param = new URLSearchParams(window.location.search).get("mock");
        if (param === "0") return false;
        if (param === "1") return true;
        return import.meta.env.DEV;
    });

    // ---- 素材 ----
    const [videos, setVideos] = useState<ReferenceVideo[]>([]);
    const [mainVideoId, setMainVideoId] = useState<string | null>(null);
    const [products, setProducts] = useState<ProductImage[]>([]);
    const [uploadingVideo, setUploadingVideo] = useState(false);
    const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
    const [enableVlm, setEnableVlm] = useState(true);
    const [vlmBackend, setVlmBackend] = useState<EreverseVlmBackend>("hf-local");
    const [resolution, setResolution] = useState<"480p" | "1080p">("480p");
    const [concurrency, setConcurrency] = useState<"1" | "2">("1");

    // ---- 拆解 ----
    const [extractJobId, setExtractJobId] = useState<string | null>(null);
    const [extractStatus, setExtractStatus] = useState<EreverseJobStatus | null>(null);
    const [extractError, setExtractError] = useState<string | null>(null);

    // ---- 蓝图与渲染记录 ----
    const [blueprint, setBlueprint] = useState<MotionBlueprint | null>(null);
    const [lastRecord, setLastRecord] = useState<RenderRecord | null>(null);
    const [view, setView] = useState<OmniView>("cockpit");
    const videoSeq = useRef(0);
    const productSeq = useRef(0);

    // ---- R2 联动：/ereverse 「送入全能复刻」带入参考视频路径 + 时间窗（consume-once）----
    const [fromEreverseNotice, setFromEreverseNotice] = useState<string | null>(null);
    useEffect(() => {
        if (!new URLSearchParams(window.location.search).has("from")) return;
        try {
            const raw = window.localStorage.getItem("ereverse-to-omnireplica");
            if (raw) {
                const payload = JSON.parse(raw) as { sourceName?: string; videoPath?: string; startMs?: number; endMs?: number; visualDnaText?: string };
                if (payload.videoPath) {
                    videoSeq.current += 1;
                    const item: ReferenceVideo = {
                        id: `v${videoSeq.current}`,
                        name: payload.sourceName || "反推台参考视频",
                        path: payload.videoPath,
                        previewUrl: "",
                        durationMs: 0,
                        width: 0,
                        height: 0,
                        fragment: payload.startMs !== undefined && payload.endMs !== undefined ? { startMs: payload.startMs, endMs: payload.endMs } : null,
                    };
                    setVideos((prev) => (prev.some((existing) => existing.path === item.path) ? prev : [...prev, item]));
                    setMainVideoId((prev) => prev || item.id);
                    const windowText = item.fragment ? `，时间窗 ${Math.round(item.fragment.startMs / 1000)}s-${Math.round(item.fragment.endMs / 1000)}s` : "";
                    setFromEreverseNotice(`已从爆款反推台带入《${item.name}》${windowText}：直接点「开始拆解动效蓝图」即可（0 积分本地引擎）`);
                }
            }
        } catch {
            /* 载荷损坏：静默跳过，用户仍可手动上传 */
        } finally {
            try {
                window.localStorage.removeItem("ereverse-to-omnireplica");
            } catch {
                /* 忽略 */
            }
            const params = new URLSearchParams(window.location.search);
            if (params.has("from")) {
                params.delete("from");
                const rest = params.toString();
                window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
            }
        }
    }, []);

    const mainVideo = useMemo(() => videos.find((item) => item.id === mainVideoId) || null, [videos, mainVideoId]);
    const extracting = Boolean(extractJobId) && (!extractStatus || !["done", "error"].includes(extractStatus.stage));

    // ---- 拆解轮询（fan-out：单 job，1.5s 回环；超时 300s 诚实报错）----
    useEffect(() => {
        if (!extractJobId || !extracting) return;
        let cancelled = false;
        const startedAt = Date.now();
        const tick = () => {
            const fetchStatus = mock ? mockGetOmniJobStatus : getOmniJobStatus;
            fetchStatus(extractJobId)
                .then((status) => {
                    if (cancelled) return;
                    setExtractStatus(status as EreverseJobStatus);
                    if (status.stage === "done") {
                        const motion = (status as { pft?: { motion?: unknown } | null }).pft?.motion;
                        const next = motion
                            ? blueprintFromMotion(motion, { title: mainVideo ? `复刻《${mainVideo.name}》` : "参考视频复刻", ereverseJobId: extractJobId, durationMs: mainVideo?.durationMs, width: mainVideo?.width, height: mainVideo?.height })
                            : emptyBlueprint(mainVideo ? `复刻《${mainVideo.name}》` : "参考视频复刻");
                        // 模板默认绑定：VLM 未产出 slot 时，把第 1 张产品图绑到 product_main（UI 明示，可改）
                        if (Object.keys(next.slots).length === 0 && products.length > 0) next.slots.product_main = { kind: "product_image", url: products[0].dataUrl, fit: "contain" };
                        setBlueprint(next);
                        setView("editor");
                        message.success(motion ? "动效蓝图已装配：请人工核对低置信镜头后进入试看" : "未拿到动效草案（VLM 漏返）：已按通用模板装配并登记 degraded，请人工编辑");
                    }
                    if (status.stage === "error") setExtractError(status.error || "拆解失败");
                })
                .catch((e: unknown) => {
                    if (!cancelled) setExtractError(describeError(e));
                });
            if (Date.now() - startedAt > 300_000 && !cancelled) setExtractError("拆解轮询超时（超过 300 秒）：引擎可能仍在加载模型，请点「重新拆解」重试");
        };
        tick();
        const timer = setInterval(tick, 1_500);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [extractJobId, extracting, mock, message, products]);

    // ---- 视频上传（e-reverse 侧车 PUT /upload）----
    const handleVideoUpload = useCallback(
        async (file: File) => {
            if (videos.length >= 5) {
                message.warning("参考视频最多 5 个（MVP 输入边界）");
                return;
            }
            setUploadingVideo(true);
            try {
                const previewUrl = URL.createObjectURL(file);
                // 元数据本地探测（不新增端点）：时长/画幅进蓝图 canvas 与影响条口径
                const meta = await new Promise<{ durationMs: number; width: number; height: number }>((resolve) => {
                    const probe = document.createElement("video");
                    probe.preload = "metadata";
                    probe.onloadedmetadata = () => resolve({ durationMs: Math.round((probe.duration || 0) * 1000), width: probe.videoWidth || 0, height: probe.videoHeight || 0 });
                    probe.onerror = () => resolve({ durationMs: 0, width: 0, height: 0 });
                    probe.src = previewUrl;
                });
                const { path } = await uploadEreverseVideo(file);
                videoSeq.current += 1;
                const item: ReferenceVideo = { id: `v${videoSeq.current}`, name: file.name, path, previewUrl, durationMs: meta.durationMs, width: meta.width, height: meta.height, fragment: null };
                setVideos((prev) => [...prev, item]);
                setMainVideoId((prev) => prev || item.id);
            } catch (e) {
                setExtractError(describeError(e));
            } finally {
                setUploadingVideo(false);
            }
        },
        [videos.length, message],
    );

    // ---- 产品图上传（本地 dataURL；透明底预提仅提示，不伪造接口）----
    const handleProductUpload = useCallback(
        async (file: File) => {
            if (products.length >= 5) {
                message.warning("产品图最多 5 张（MVP 输入边界）");
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                message.warning("单张产品图 ≤10MB（MVP 输入边界）");
                return;
            }
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error("图片读取失败"));
                reader.readAsDataURL(file);
            }).catch((e: unknown) => {
                message.warning(describeError(e));
                return null;
            });
            if (!dataUrl) return;
            productSeq.current += 1;
            setProducts((prev) => [...prev, { id: `p${productSeq.current}`, name: file.name, dataUrl, mattingNote: `编号 [${productSeq.current}] · 透明底将在渲染管线按需处理（第二阶段可补实拍生成）` }]);
        },
        [products.length, message],
    );

    // ---- 触发拆解（主参考 + 黄金片段时间窗 + 指令上下文）----
    const handleExtract = useCallback(async () => {
        if (!mainVideo) {
            message.warning("先上传参考视频（左侧第 1 卡），再开始拆解动效蓝图");
            return;
        }
        setExtractError(null);
        setExtractStatus(null);
        setExtractJobId(null);
        try {
            const extractInput = { video: mainVideo.path, enable_vlm: enableVlm, vlm_backend: vlmBackend, context: instruction.trim(), ...(mainVideo.fragment ? { start_ms: mainVideo.fragment.startMs, end_ms: mainVideo.fragment.endMs } : {}) };
            const started = mock ? await mockStartOmniExtract() : await startOmniExtract(extractInput);
            setExtractJobId(started.id);
        } catch (e) {
            setExtractError(describeError(e));
        }
    }, [mainVideo, mock, enableVlm, vlmBackend, instruction, message]);

    /** 拆解进度区（五种状态之「加载」在本区呈现）。 */
    const extractStage = extractStatus?.stage;
    const extractPctValue = extractPct(extractStage || "queued");

    // ---- 送画布占位（快照 + 剪贴板，不自动生成不扣费；与 ereverse 出口同pattern）----
    const handleSendToCanvas = useCallback(
        (videoUrl: string | null, label: string) => {
            if (!blueprint) return;
            writeOmniHandoff({
                title: blueprint.meta.title,
                blueprintId: blueprint.blueprint_id,
                renderKey: lastRecord?.renderKey,
                videoUrl,
                label,
                shots: blueprint.shots.map((shot) => ({ shotId: shot.shot_id, text: shot.elements.find((element) => (element.text || "").trim())?.text || "（无文案元素）", startMs: shot.start_ms, endMs: shot.end_ms })),
            });
            navigate("/canvas?handoff=omnireplica");
            message.success(`已带入「${label}」快照：画布将落出成片参考与镜头清单（不自动生成、不扣费）`);
        },
        [blueprint, lastRecord, navigate, message],
    );

    return (
        <main className="app-user-content app-workspace-scroll h-full overflow-y-auto bg-background text-foreground">
            <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-8">
                {/* ---- 页头：返回 + 标题 + 0 积分徽标（硬不变量常驻）---- */}
                <header className="relative flex flex-col gap-2">
                    <Link
                        to="/modules"
                        className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-border/60 bg-surface px-3 py-1.5 text-xs font-medium text-foreground/70 shadow-sm transition-colors hover:border-primary/50 hover:text-primary"
                    >
                        <ArrowLeft className="size-3.5" /> 返回定制模块
                    </Link>
                    <div className="absolute right-0 top-0 flex flex-col items-end gap-1.5">
                        <Tooltip title="渲染 / 改稿 / 裂变路径硬不变量：不建计费任务，credits_used 恒 0（可审计）；拆解默认本地引擎同样 0 积分">
                            <span data-yq="omni-zero-credit" className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-status-success/40 bg-status-success/10 px-2.5 py-1 text-caption font-medium text-status-success">
                                🧮 本地渲染 · 0 积分
                            </span>
                        </Tooltip>
                        {mock ? (
                            <span data-yq="omni-mock-banner" className="inline-flex min-h-6 items-center gap-1.5 rounded-full border border-status-warning/40 bg-status-warning/10 px-2.5 py-1 text-caption text-status-warning">
                                ⚠️ 契约 Mock 数据（source: mock，联调日整旗清除）
                            </span>
                        ) : null}
                    </div>
                    <h1 className="flex items-center gap-2 text-xl font-semibold">
                        <Clapperboard className="size-5 text-primary" />
                        全能复刻
                    </h1>
                    <p className="max-w-2xl text-sm text-foreground/60">上传参考视频 + 产品图 → AI 拆解动效蓝图 → 本地代码渲染成片 → 改变量零成本改稿 → 多版本裂变。写实层（实拍生成）第二阶段可补。</p>
                </header>

                {/* ---- 视图切换（输入舱 → 蓝图编辑 → 试看操作台）---- */}
                <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="全能复刻工作台视图">
                    {(
                        [
                            { key: "cockpit", label: "① 输入舱", icon: Upload },
                            { key: "editor", label: "② 蓝图编辑", icon: Wrench },
                            { key: "bench", label: "③ 试看 / 成片 / 裂变", icon: Video },
                        ] as Array<{ key: OmniView; label: string; icon: typeof Upload }>
                    ).map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            role="tab"
                            aria-selected={view === item.key}
                            data-yq={`omni-view-${item.key}`}
                            className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-3 text-caption font-medium transition-colors ${view === item.key ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-surface text-foreground/65 hover:border-primary/40 hover:text-foreground/85"}`}
                            onClick={() => setView(item.key)}
                        >
                            <item.icon className="size-3.5" />
                            {item.label}
                            {item.key !== "cockpit" && !blueprint ? <span className="text-foreground/40">（未装配）</span> : null}
                        </button>
                    ))}
                </div>

                {extractError ? <Alert type="error" showIcon message="拆解 / 引擎异常" description={<span className="break-all">{extractError}</span>} closable onClose={() => setExtractError(null)} /> : null}

                {/* ---- 拆解进度（加载态）---- */}
                {extractJobId && extractStatus ? (
                    <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4" data-yq="omni-extract-progress" aria-label="拆解进度">
                        <div className="flex items-center justify-between text-sm">
                            <span>
                                {extractStage === "error" ? "拆解失败" : extractStage === "done" ? "拆解完成" : EXTRACT_STAGES.find((item) => item.key === extractStage)?.label || "处理中"}
                                <span className="ml-2 font-mono text-caption text-foreground/40">{extractJobId}</span>
                            </span>
                            <span className="text-caption text-foreground/50">{extractPctValue}%</span>
                        </div>
                        <Progress percent={extractPctValue} status={extractStage === "error" ? "exception" : extractStage === "done" ? "success" : "active"} />
                        {extractStage === "error" && extractStatus.error ? <Alert type="error" showIcon message={extractStatus.error} /> : null}
                    </section>
                ) : null}

                {/* ================= 视图一：输入舱 ================= */}
                {view === "cockpit" ? (
                    <>
                        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5" aria-label="复刻三步">
                            {[
                                { step: "Step 1", text: "上传参考视频 + 编号产品图" },
                                { step: "Step 2", text: "AI 拆解动效蓝图（可人工编辑）" },
                                { step: "Step 3", text: "本地代码渲染成片，零成本改稿 / 裂变" },
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

                        {/* ---- 三段式：左参考视频 | 右编号产品图 ---- */}
                        <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[42%_58%]" data-yq="omni-cockpit">
                            {/* 左：参考视频卡 1~5 */}
                            <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4" aria-label="参考视频">
                                <strong className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80">
                                    <FileVideo2 className="size-4 text-primary" /> 参考视频（1~5，主参考驱动拆解）
                                </strong>
                                {fromEreverseNotice ? (
                                    <Alert type="success" showIcon message="已从爆款反推台带入" description={fromEreverseNotice} data-yq="omni-from-ereverse" />
                                ) : null}
                                {videos.length === 0 ? (
                                    <label
                                        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${uploadingVideo ? "pointer-events-none opacity-60" : "border-border/60 hover:border-primary/50"}`}
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            const file = event.dataTransfer.files?.[0];
                                            if (file) void handleVideoUpload(file);
                                        }}
                                    >
                                        <Upload className="size-8 text-primary" />
                                        <span className="text-sm font-medium text-foreground/80">{uploadingVideo ? "上传中…" : "拖拽对标视频到这里，或点击选择文件"}</span>
                                        <span className="text-caption text-foreground/50">支持 MP4 / MOV / WEBM / MKV；时长 ≤120s（MVP 边界）</span>
                                        <input
                                            type="file"
                                            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.mkv"
                                            className="sr-only"
                                            onChange={(event) => {
                                                const file = event.target.files?.[0];
                                                if (file) void handleVideoUpload(file);
                                                event.target.value = "";
                                            }}
                                        />
                                    </label>
                                ) : (
                                    <div className="flex flex-col gap-2">
                                        {videos.map((video) => (
                                            <div key={video.id} className={`flex flex-col gap-2 rounded-lg border p-2.5 ${video.id === mainVideoId ? "border-primary/60 bg-primary/5" : "border-border/60"}`}>
                                                <div className="flex items-center gap-2.5">
                                                    <Radio checked={video.id === mainVideoId} onChange={() => setMainVideoId(video.id)} aria-label={`设为主参考：${video.name}`} />
                                                    {video.previewUrl ? (
                                                        <video className="h-16 w-12 shrink-0 rounded bg-black object-cover" src={video.previewUrl} muted playsInline preload="metadata" />
                                                    ) : (
                                                        <div className="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-black/80 text-[10px] text-white/70">路径</div>
                                                    )}
                                                    <div className="min-w-0 flex-1">
                                                        <p className="truncate text-caption font-medium text-foreground/80" title={video.name}>
                                                            {video.name}
                                                        </p>
                                                        <p className="text-caption text-foreground/50">
                                                            {video.width > 0 ? `${video.width}×${video.height}` : "画幅待探测"} · {formatMs(video.durationMs)}
                                                            {video.id === mainVideoId ? <span className="ml-1.5 text-primary">· 主参考</span> : null}
                                                        </p>
                                                    </div>
                                                </div>
                                                {/* 黄金片段选区（复用 /ereverse fragment-bar 模式；侧车时间窗已建成） */}
                                                {video.id === mainVideoId ? (
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        {(
                                                            [
                                                                { label: `🔥 片头钩子 00:00 - ${formatMs(Math.min(HOOK_MS, video.durationMs))}`, window: { startMs: 0, endMs: Math.min(HOOK_MS, video.durationMs) } },
                                                                { label: `📈 核心转化段 ${formatMs(Math.min(HOOK_MS, video.durationMs))} - ${formatMs(video.durationMs)}`, window: { startMs: Math.min(HOOK_MS, video.durationMs), endMs: video.durationMs } },
                                                                { label: "🎬 全片", window: null },
                                                            ] as Array<{ label: string; window: { startMs: number; endMs: number } | null }>
                                                        ).map((capsule) => {
                                                            const active = video.fragment === null ? capsule.window === null : capsule.window !== null && video.fragment.startMs === capsule.window.startMs && video.fragment.endMs === capsule.window.endMs;
                                                            return (
                                                                <button
                                                                    key={capsule.label}
                                                                    type="button"
                                                                    className={`min-h-7 rounded-full border px-2.5 text-caption transition-colors ${active ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-foreground/65 hover:border-primary/40"}`}
                                                                    onClick={() => setVideos((prev) => prev.map((item) => (item.id === video.id ? { ...item, fragment: capsule.window } : item)))}
                                                                >
                                                                    {capsule.label}
                                                                </button>
                                                            );
                                                        })}
                                                        <span className="text-caption text-foreground/45">
                                                            {video.fragment ? `选区 ${formatMs(video.fragment.startMs)} - ${formatMs(video.fragment.endMs)}（侧车裁剪后时间戳回正总轴）` : "当前：整条视频"}
                                                        </span>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}
                                        {videos.length < 5 ? (
                                            <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-border/60 px-3 py-1.5 text-caption text-foreground/60 transition-colors hover:border-primary/50 hover:text-primary">
                                                <Upload className="size-3.5" /> 再传一个（{videos.length}/5）
                                                <input
                                                    type="file"
                                                    accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.mkv"
                                                    className="sr-only"
                                                    onChange={(event) => {
                                                        const file = event.target.files?.[0];
                                                        if (file) void handleVideoUpload(file);
                                                        event.target.value = "";
                                                    }}
                                                />
                                            </label>
                                        ) : null}
                                    </div>
                                )}
                            </section>

                            {/* 右：编号产品图 [1]~[5] */}
                            <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4" aria-label="编号产品图">
                                <strong className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80">
                                    <ImagePlus className="size-4 text-primary" /> 产品图（[1]~[5]，编号即蓝图绑定键）
                                </strong>
                                {products.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/60 px-6 py-10 text-center">
                                        <ImagePlus className="size-8 text-primary/70" />
                                        <span className="text-sm font-medium text-foreground/80">还没有产品图</span>
                                        <span className="text-caption text-foreground/50">上传后自动编号 [1] 起；透明底在渲染管线按需处理</span>
                                        <label className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-caption font-medium text-white shadow-sm transition-opacity hover:opacity-90">
                                            <Upload className="size-3.5" /> 上传产品图
                                            <input
                                                type="file"
                                                accept="image/png,image/jpeg,image/webp"
                                                className="sr-only"
                                                onChange={(event) => {
                                                    const file = event.target.files?.[0];
                                                    if (file) void handleProductUpload(file);
                                                    event.target.value = "";
                                                }}
                                            />
                                        </label>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                        {products.map((product, index) => (
                                            <div key={product.id} className="relative flex flex-col gap-1.5 rounded-lg border border-border/60 p-2" title={product.mattingNote}>
                                                <img src={product.dataUrl} alt={`产品图 ${index + 1}`} className="h-24 w-full rounded bg-black/5 object-contain" />
                                                <span className="absolute left-2.5 top-2.5 rounded bg-primary px-1.5 py-0.5 text-caption font-bold text-white">[{index + 1}]</span>
                                                <p className="truncate text-caption text-foreground/60" title={product.name}>
                                                    {product.name}
                                                </p>
                                            </div>
                                        ))}
                                        {products.length < 5 ? (
                                            <label className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border/60 py-6 text-caption text-foreground/55 transition-colors hover:border-primary/50 hover:text-primary">
                                                <ImagePlus className="size-5" />
                                                再传一张（{products.length}/5）
                                                <input
                                                    type="file"
                                                    accept="image/png,image/jpeg,image/webp"
                                                    className="sr-only"
                                                    onChange={(event) => {
                                                        const file = event.target.files?.[0];
                                                        if (file) void handleProductUpload(file);
                                                        event.target.value = "";
                                                    }}
                                                />
                                            </label>
                                        ) : null}
                                    </div>
                                )}
                                <p className="flex items-start gap-1.5 text-caption leading-5 text-foreground/45">
                                    <Info className="mt-0.5 size-3.5 shrink-0" />
                                    编号用于结构化指令里的「[1-5] 产品替换」指代；蓝图装配时自动把 [1] 绑到 product_main 槽（编辑器里可改）。透明底预提由渲染管线按需处理——本页不虚构抠图接口调用。
                                </p>
                            </section>
                        </div>

                        {/* ---- 结构化指令模板（可编辑）---- */}
                        <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4" data-yq="omni-instruction" aria-label="结构化复刻指令">
                            <strong className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80">
                                <Sparkles className="size-4 text-primary" /> 结构化复刻指令（VLM 打标上下文，可编辑）
                            </strong>
                            <Input.TextArea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={3} autoSize={{ minRows: 3, maxRows: 8 }} />
                            <p className="text-caption text-foreground/45">指令随拆解任务送侧车；动效类型受引擎枚举强约束（集合外自动置 none 并登记 degraded）。</p>
                        </section>

                        {/* ---- 底部控制栏：引擎 / 清晰度 / 并发 + 发送 ---- */}
                        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4" data-yq="omni-control-bar" aria-label="控制栏">
                            <Checkbox checked={enableVlm} onChange={(event) => setEnableVlm(event.target.checked)}>
                                VLM 动效打标
                            </Checkbox>
                            <Tooltip title={VLM_OPTIONS.find((item) => item.value === vlmBackend)?.note || ""}>
                                <Select className="min-w-56" value={vlmBackend} disabled={!enableVlm} options={VLM_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => setVlmBackend(value as EreverseVlmBackend)} />
                            </Tooltip>
                            <Tooltip title={RESOLUTION_OPTIONS.find((item) => item.value === resolution)?.note || ""}>
                                <Select
                                    className="min-w-44"
                                    value={resolution}
                                    options={RESOLUTION_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                                    onChange={(value) => {
                                        setResolution(value as "480p" | "1080p");
                                        message.info(`已切${value === "1080p" ? "成片 30fps" : "试看 24fps"}口径（默认帧率，试看操作台可改）`);
                                    }}
                                />
                            </Tooltip>
                            <Tooltip title="渲染队列由引擎侧 FIFO 串行调度（默认并发 1~2 可配）；前端无需传参，批量裂变按提交序排队">
                                <Select
                                    className="min-w-36"
                                    value={concurrency}
                                    options={[
                                        { value: "1", label: "引擎并发 1（稳）" },
                                        { value: "2", label: "引擎并发 2（快·吃内存）" },
                                    ]}
                                    onChange={(value) => setConcurrency(value as "1" | "2")}
                                />
                            </Tooltip>
                            <span className="text-caption text-foreground/45">默认帧率：{resolution === "1080p" ? "30 fps" : "24 fps"}（15fps 应急档在试看操作台）</span>
                            <Button type="primary" size="large" icon={<Sparkles className="size-4" />} loading={extracting} onClick={() => void handleExtract()} data-yq="omni-extract-button">
                                {extracting ? "拆解中…" : "🚀 开始拆解动效蓝图"}
                            </Button>
                        </section>
                    </>
                ) : null}

                {/* ================= 视图二：蓝图编辑器 ================= */}
                {view === "editor" ? (
                    <BlueprintEditor blueprint={blueprint} products={products} mock={mock} onChange={setBlueprint} onGoBench={() => setView("bench")} onGoCockpit={() => setView("cockpit")} onSendToCanvas={handleSendToCanvas} messageApi={message} />
                ) : null}

                {/* ================= 视图三：试看 / 成片 / 改稿 / 裂变操作台 ================= */}
                {view === "bench" ? (
                    <CopyBench
                        blueprint={blueprint}
                        lastRecord={lastRecord}
                        products={products}
                        resolution={resolution}
                        fps={defaultFpsFor(resolution)}
                        mock={mock}
                        onRecord={(record) => setLastRecord(record)}
                        onBlueprintChange={setBlueprint}
                        onGoEditor={() => setView("editor")}
                        onSendToCanvas={handleSendToCanvas}
                    />
                ) : null}
            </div>
        </main>
    );
}
