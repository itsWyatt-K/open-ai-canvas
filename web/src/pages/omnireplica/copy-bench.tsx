/**
 * 全能复刻 · 试看 / 成片 / 改稿 / 裂变操作台（copy-bench）。
 *
 * 改稿影响提示（三条常驻，单一「渲染」按钮；US-6 终稿）：
 *   ① 将重截哪些镜头（编号 + 文案预览 + 「复用」徽标）
 *   ② 预计耗时（本地公式预估 debounce 300ms → nxf 权威 plan 回填 + 「节省 X%」对比条）
 *   ③ 缓存依据（引用哪次渲染的哪些帧）
 * **plan 是唯一耗时数据源**——禁第二套计时口径。
 *
 * 裂变（US-7 终稿）：批量提交即见每版渲染计划（预报价）；进行态逐版 frames_done/total
 * 前端 fan-out 轮询（本地回环 12 版 × 1 请求/2s），无 batch 聚合端点。
 *
 * 五种状态：正常 / 空（未装配）/ 加载（轮询中）/ 错误（人话 + 重试）/ 无权限（路由级）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Input, Progress, Select, Tag, Tooltip } from "antd";
import { Clapperboard, Copy, Download, Film, Gauge, Layers, RotateCcw, Send, Sparkles, Video as VideoIcon } from "lucide-react";

import { getCodeRenderStatus, OmnireplicaApiError, submitCodeRender, submitCodeRenderBatch, codeRenderFileUrl, type CodeRenderStatus, type OmniVariation, type RenderPlan } from "@/services/api/omnireplica";
import { classifyEditImpact, defaultFpsFor, describePlan, estimateLocalMs, FPS_OPTIONS, formatMs, isEmergencyFps, type EditImpact, type MotionBlueprint } from "@/lib/omnireplica/blueprint";
import { fanoutDueJobs, isTerminalStatus, pollDeadlineExceeded, RENDER_POLL_DEADLINE_MS, RENDER_POLL_INTERVAL_MS } from "@/lib/omnireplica/polling";
import { mockGetCodeRenderStatus, mockSubmitCodeRender, mockSubmitCodeRenderBatch, OMNI_MOCK_POSTER } from "./mock";
import { appendVersionHistory } from "./blueprint-editor";
import type { ProductImage } from "./index";

/** 一次成功渲染的记录：影响条基线 + 版本历史 + 权威 plan 回填的唯一载体。 */
export type RenderRecord = {
    jobId: string;
    renderKey: string;
    resolution: string;
    fps: number;
    at: number;
    videoUrl: string | null;
    plan: RenderPlan | null;
    /** 提交时的蓝图快照（改稿影响判定的基线）。 */
    blueprint: MotionBlueprint;
    source: "试看" | "成片" | "改稿" | "裂变";
};

type BenchJob = {
    job_id: string;
    label: string;
    kind: "single" | "batch";
    status: string;
    frames_done: number;
    frames_total: number;
    queue_position?: number;
    plan?: RenderPlan;
    video_url?: string | null;
    degraded?: string[];
    error?: string;
    startedAt: number;
};

type Variation = { id: string; label: string; title: string; primary: string };

const MAX_VARIATIONS = 8;

function shotLabel(shot: { elements: Array<{ text?: string }> }): string {
    const text = shot.elements.find((element) => (element.text || "").trim())?.text;
    return (text || "").trim() || "（无文案元素）";
}

function describeError(e: unknown): string {
    if (e instanceof OmnireplicaApiError) return e.message;
    const raw = e instanceof Error ? e.message : String(e);
    if (/signal\s*is\s*aborted|AbortError|aborted\s+without\s+reason/i.test(raw)) return "连接超时：渲染引擎响应超时，请稍后重试（轮询超过 300 秒会诚实报错，不会假装在渲染）";
    return raw;
}

type CopyBenchProps = {
    blueprint: MotionBlueprint | null;
    lastRecord: RenderRecord | null;
    products: ProductImage[];
    resolution: "480p" | "1080p";
    fps: number;
    mock: boolean;
    onRecord: (record: RenderRecord) => void;
    onBlueprintChange: (next: MotionBlueprint) => void;
    onGoEditor: () => void;
    onSendToCanvas: (videoUrl: string | null, label: string) => void;
};

export function CopyBench({ blueprint, lastRecord, products, resolution, fps, mock, onRecord, onBlueprintChange, onGoEditor, onSendToCanvas }: CopyBenchProps) {
    const { message } = App.useApp();

    const [target, setTarget] = useState<"480p" | "1080p">(resolution);
    const [fpsValue, setFpsValue] = useState(fps);
    const [jobs, setJobs] = useState<BenchJob[]>([]);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [variations, setVariations] = useState<Variation[]>([]);
    const [localEstimate, setLocalEstimate] = useState<number | null>(null);

    const jobsRef = useRef<BenchJob[]>([]);
    jobsRef.current = jobs;
    const lastPollAt = useRef(new Map<string, number>());

    // ---- 影响条：本地预估（debounce 300ms）+ 权威 plan 回填 ----
    const impact: EditImpact | null = useMemo(() => (blueprint && lastRecord ? classifyEditImpact(lastRecord.blueprint, blueprint) : null), [blueprint, lastRecord]);

    useEffect(() => {
        if (!impact || !lastRecord || !lastRecord.plan) {
            setLocalEstimate(null);
            return;
        }
        // 闭包内窄化：prop 在定时器期间可能变化，先取本地常量（权威 plan 口径不变）
        const plan = lastRecord.plan;
        const timer = setTimeout(() => setLocalEstimate(estimateLocalMs(plan.full_render_ms, impact)), 300);
        return () => clearTimeout(timer);
    }, [impact, lastRecord]);

    // ---- fan-out 轮询：单 Interval，逐 job 独立节流；deadline ≥300s 诚实报错 ----
    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now();
            const due = fanoutDueJobs(
                jobsRef.current.filter((job) => !isTerminalStatus(job.status)),
                lastPollAt.current,
                now,
                RENDER_POLL_INTERVAL_MS,
            );
            for (const job of due) {
                lastPollAt.current.set(job.job_id, now);
                if (pollDeadlineExceeded(job.startedAt, now)) {
                    setJobs((prev) =>
                        prev.map((item) => (item.job_id === job.job_id ? { ...item, status: "error", error: `渲染轮询超时（超过 ${RENDER_POLL_DEADLINE_MS / 1000} 秒）：引擎无状态 job 表可能已重启，请重新提交（命中缓存的镜头不会重截）` } : item)),
                    );
                    continue;
                }
                const fetchStatus = mock ? mockGetCodeRenderStatus : getCodeRenderStatus;
                fetchStatus(job.job_id)
                    .then((status: CodeRenderStatus) => {
                        setJobs((prev) =>
                            prev.map((item) =>
                                item.job_id === job.job_id
                                    ? {
                                          ...item,
                                          status: status.status,
                                          frames_done: status.frames_done,
                                          frames_total: status.frames_total,
                                          queue_position: status.queue_position,
                                          plan: status.plan || item.plan,
                                          video_url: status.video_url ?? item.video_url,
                                          degraded: status.degraded || item.degraded,
                                          error: status.error,
                                      }
                                    : item,
                            ),
                        );
                    })
                    .catch((e: unknown) => {
                        setJobs((prev) => prev.map((item) => (item.job_id === job.job_id ? { ...item, status: "error", error: describeError(e) } : item)));
                    });
            }
        }, 500);
        return () => clearInterval(timer);
    }, [mock]);

    // ---- 单次渲染（试看/成片同一按钮；清晰度+fps 为参数）----
    const handleRender = useCallback(async () => {
        if (!blueprint) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const label = target === "1080p" ? "成片" : "试看";
            let jobId: string;
            if (mock) {
                const result = await mockSubmitCodeRender({ blueprint, resolution: target, fps: fpsValue, label });
                jobId = result.job_id;
            } else {
                const result = await submitCodeRender({ blueprint, resolution: target, fps: fpsValue });
                jobId = result.job_id;
            }
            setJobs((prev) => [{ job_id: jobId, label, kind: "single", status: "queued", frames_done: 0, frames_total: Math.round((blueprint.canvas.duration_ms / 1000) * fpsValue), startedAt: Date.now() }, ...prev]);
        } catch (e) {
            setSubmitError(describeError(e));
        } finally {
            setSubmitting(false);
        }
    }, [blueprint, target, fpsValue, mock]);

    // ---- 单次渲染完成 → 落版本历史 + 回填权威 plan ----
    useEffect(() => {
        const done = jobs.find((job) => job.kind === "single" && job.status === "done" && job.video_url);
        if (!done || !blueprint) return;
        if (lastRecord && lastRecord.jobId === done.job_id) return;
        const record: RenderRecord = {
            jobId: done.job_id,
            renderKey: done.plan ? `rk_${done.job_id.slice(-8)}` : "",
            resolution: target,
            fps: fpsValue,
            at: Date.now(),
            videoUrl: done.video_url ?? null,
            plan: done.plan || null,
            blueprint,
            source: target === "1080p" ? "成片" : "试看",
        };
        onRecord(record);
        appendVersionHistory({ key: record.renderKey || done.job_id.slice(-8), source: record.source, resolution: record.resolution, fps: record.fps, blueprint });
        setJobs((prev) => prev.map((item) => (item.job_id === done.job_id ? { ...item, video_url: done.video_url } : item)));
        message.success(`${done.label}完成：${done.plan ? describePlan(done.plan).summary : "已生成成片"}`);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobs, blueprint]);

    // ---- 批量裂变提交（提交即见每版预报价）----
    const handleBatch = useCallback(async () => {
        if (!blueprint || variations.length === 0) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            const payload: OmniVariation[] = variations.map((variation) => ({ label: variation.label, ...(variation.title.trim() ? { title: variation.title } : {}), ...(variation.primary ? { theme: { colors: { primary: variation.primary } } } : {}) }));
            const result = mock ? await mockSubmitCodeRenderBatch({ blueprint, variations: payload, resolution: target, fps: fpsValue }) : await submitCodeRenderBatch({ blueprint, variations: payload, resolution: target, fps: fpsValue });
            const batchJobs: BenchJob[] = result.jobs.map((job, index) => ({
                job_id: job.job_id,
                label: variations[index]?.label || `版本 ${index + 1}`,
                kind: "batch",
                status: "queued",
                frames_done: 0,
                frames_total: Math.round((blueprint.canvas.duration_ms / 1000) * fpsValue),
                plan: job.plan,
                startedAt: Date.now(),
            }));
            setJobs((prev) => [...batchJobs, ...prev]);
            message.success(`已提交 ${batchJobs.length} 版裂变：每版渲染计划已列在下方进度网格（预报价）`);
        } catch (e) {
            setSubmitError(describeError(e));
        } finally {
            setSubmitting(false);
        }
    }, [blueprint, variations, target, fpsValue, mock, message]);

    // ---- 空态：未装配 ----
    if (!blueprint) {
        return (
            <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-16 text-center" data-yq="omni-bench-empty" aria-label="操作台空态">
                <Film className="size-10 text-foreground/30" />
                <strong className="text-sm font-semibold text-foreground/75">蓝图还没装配</strong>
                <p className="max-w-md text-caption leading-5 text-foreground/50">先完成输入舱拆解并装配蓝图，再回来试看 / 成片 / 改稿 / 裂变。</p>
                <Button type="primary" onClick={onGoEditor}>
                    去蓝图编辑
                </Button>
            </section>
        );
    }

    const authoritativePlan = lastRecord?.plan || null;
    const planQuote = authoritativePlan ? describePlan(authoritativePlan) : null;
    const singleDone = jobs.filter((job) => job.kind === "single" && job.status === "done");
    const batchJobs = jobs.filter((job) => job.kind === "batch");
    const runningJobs = jobs.filter((job) => !isTerminalStatus(job.status));

    return (
        <div className="flex flex-col gap-4" data-yq="omni-bench">
            {/* ---- 渲染控制：清晰度 + fps + 单一「渲染」按钮 ---- */}
            <section className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-3.5" aria-label="渲染控制">
                <Select
                    className="min-w-44"
                    value={target}
                    options={[
                        { value: "480p", label: "480p 试看（快）" },
                        { value: "1080p", label: "1080p 成片（高清）" },
                    ]}
                    onChange={(value) => {
                        setTarget(value as "480p" | "1080p");
                        setFpsValue(defaultFpsFor(value));
                    }}
                />
                <Tooltip title={FPS_OPTIONS.find((item) => item.value === fpsValue)?.note || ""}>
                    <Select className="min-w-48" value={fpsValue} options={FPS_OPTIONS.map((item) => ({ value: item.value, label: item.label }))} onChange={(value) => setFpsValue(value)} />
                </Tooltip>
                {isEmergencyFps(fpsValue) ? <Tag color="orange">⚠️ 15fps 应急档（画质代价：运动可能呈现顿感），仅改稿兜底使用</Tag> : null}
                <span className="flex-1" />
                <Button type="primary" size="large" icon={<Sparkles className="size-4" />} loading={submitting || runningJobs.length > 0} onClick={() => void handleRender()} data-yq="omni-render-button">
                    {target === "1080p" ? "🎬 渲染成片" : "👀 试看渲染"}
                </Button>
                <Button onClick={onGoEditor}>回蓝图编辑</Button>
            </section>

            {submitError ? <Alert type="error" showIcon closable message="渲染提交失败" description={submitError} onClose={() => setSubmitError(null)} /> : null}

            {/* ---- 改稿影响提示三条（常驻；单一渲染按钮）---- */}
            <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5" data-yq="omni-impact" aria-label="改稿影响提示">
                <strong className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80">
                    <Gauge className="size-4 text-primary" /> 改稿影响提示（点「渲染」前常驻）
                    {impact ? <Tag color={impact.scope === "global" ? "red" : impact.scope === "partial" ? "gold" : "green"}>{impact.scope === "global" ? "全局重渲" : impact.scope === "partial" ? "局部重渲" : "零变更"}</Tag> : <Tag>首次渲染</Tag>}
                </strong>

                {/* ① 将重截哪些镜头 */}
                <div className="flex flex-col gap-1.5" data-yq="omni-impact-shots">
                    <span className="text-caption font-medium text-foreground/65">① 将重截哪些镜头</span>
                    <div className="flex flex-wrap gap-1.5">
                        {blueprint.shots.map((shot, index) => {
                            const changed = !impact || impact.scope === "global" || impact.changedShotIds.includes(shot.shot_id);
                            return (
                                <Tooltip key={shot.shot_id} title={`${shot.shot_id} · ${Math.round(shot.start_ms / 1000)}s-${Math.round(shot.end_ms / 1000)}s · ${shotLabel(shot)}`}>
                                    <span className={`inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-caption ${changed ? "border-status-warning/50 bg-status-warning/10 text-status-warning" : "border-border/50 text-foreground/50"}`}>
                                        #{index + 1} {shotLabel(shot).slice(0, 10)}
                                        {changed ? null : (
                                            <Tag className="!ml-0.5" color="green">
                                                复用
                                            </Tag>
                                        )}
                                    </span>
                                </Tooltip>
                            );
                        })}
                    </div>
                    {impact?.scope === "global" && impact.globalReasons.length > 0 ? <span className="text-caption text-status-warning">全局原因：{impact.globalReasons.join("；")}</span> : null}
                    {impact && impact.inertThemeKeys.length > 0 ? <span className="text-caption text-foreground/45">改了无人引用的主题色（{impact.inertThemeKeys.join("、")}）——按 outcome 判定不计重截。</span> : null}
                </div>

                {/* ② 预计耗时（本地预估 → 权威 plan 回填 + 节省对比条）---- */}
                <div className="flex flex-col gap-1.5" data-yq="omni-impact-time">
                    <span className="text-caption font-medium text-foreground/65">② 预计耗时</span>
                    {planQuote ? (
                        <div className="flex flex-col gap-1.5">
                            <span className="text-caption text-foreground/75">
                                {planQuote.summary}
                                {localEstimate !== null && planQuote.savingPct !== null ? <span className="ml-1.5 text-foreground/45">（本地公式预估 {formatMs(localEstimate)}，以权威 plan 为准）</span> : null}
                            </span>
                            {planQuote.savingPct !== null && planQuote.savingPct > 0 ? (
                                <div className="flex items-center gap-2">
                                    <Progress percent={100 - planQuote.savingPct} showInfo={false} size={[8, 6]} />
                                    <span className="text-caption font-medium text-status-success">节省 {planQuote.savingPct}%</span>
                                </div>
                            ) : (
                                <span className="text-caption text-foreground/45">本次相对全量无节省（变更覆盖全部镜头或全局字段）。</span>
                            )}
                        </div>
                    ) : (
                        <span className="text-caption text-foreground/55">
                            {localEstimate !== null ? `本地公式预估 ${formatMs(localEstimate)}（首渲无基线，按全量口径；权威 plan 建 job 时回填）` : "首渲无基线：本地公式预估不可用，权威渲染计划将在提交后由引擎回填（唯一耗时数据源）。"}
                        </span>
                    )}
                </div>

                {/* ③ 缓存依据 */}
                <div className="flex flex-col gap-1" data-yq="omni-impact-cache">
                    <span className="text-caption font-medium text-foreground/65">③ 缓存依据</span>
                    {lastRecord ? (
                        <span className="text-caption text-foreground/70">
                            命中上次渲染 <span className="font-mono">{lastRecord.renderKey || lastRecord.jobId.slice(-8)}</span>（{new Date(lastRecord.at).toLocaleString()} · {lastRecord.source} · {lastRecord.resolution}@{lastRecord.fps}fps）的{" "}
                            {authoritativePlan?.reuse_count ?? 0} 个镜头帧；帧目录即缓存（_work_tmp/omnireplica/&lt;id&gt;/shots/&lt;shot_key&gt;/）。
                        </span>
                    ) : (
                        <span className="text-caption text-foreground/55">首次渲染，无缓存可命中——全量截帧。完成后本区将显示下次改稿的缓存依据。</span>
                    )}
                </div>
            </section>

            {/* ---- 单次渲染结果 ---- */}
            <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5" aria-label="试看/成片结果">
                <strong className="text-sm font-semibold text-foreground/80">试看 / 成片</strong>
                {jobs.filter((job) => job.kind === "single").length === 0 ? (
                    <p className="text-caption text-foreground/45">还没有渲染记录——设好清晰度与帧率，点上方「{target === "1080p" ? "🎬 渲染成片" : "👀 试看渲染"}」。</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {jobs
                            .filter((job) => job.kind === "single")
                            .map((job) => {
                                const pct = job.frames_total > 0 ? Math.round((job.frames_done / job.frames_total) * 100) : 0;
                                return (
                                    <div key={job.job_id} className="flex flex-col gap-1.5 rounded-lg border border-border/50 p-2.5" data-yq="omni-render-card">
                                        <div className="flex flex-wrap items-center gap-2 text-caption">
                                            <Tag color={job.status === "done" ? "green" : job.status === "error" ? "red" : "blue"}>{job.label}</Tag>
                                            <span className="font-mono text-foreground/45">{job.job_id}</span>
                                            {job.status === "done" ? <span className="text-status-success">完成</span> : null}
                                            {job.status === "running" ? (
                                                <span className="text-foreground/60">
                                                    截帧 {job.frames_done}/{job.frames_total}（{pct}%）
                                                </span>
                                            ) : null}
                                            {job.status === "queued" ? <span className="text-foreground/60">排队中（第 {(job.queue_position ?? 0) + 1} 位）</span> : null}
                                            <span className="flex-1" />
                                            {job.plan ? <span className="text-foreground/50">{describePlan(job.plan).summary}</span> : null}
                                        </div>
                                        {!isTerminalStatus(job.status) ? <Progress percent={pct} size={[6, 4]} /> : null}
                                        {job.status === "error" && job.error ? <Alert type="error" showIcon message={job.error} /> : null}
                                        {job.degraded?.length ? <Alert type="warning" showIcon message="引擎降级登记" description={job.degraded.join("；")} /> : null}
                                        {job.status === "done" && job.video_url ? (
                                            <div className="flex flex-col gap-1.5">
                                                <video className="max-h-72 w-full rounded-lg bg-black" src={job.video_url} controls playsInline preload="metadata" poster={mock ? OMNI_MOCK_POSTER : undefined} />
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <Button size="small" icon={<Download className="size-3.5" />} href={job.video_url} download={`${blueprint.meta.title || "omnireplica"}-${target}.mp4`}>
                                                        下载 MP4
                                                    </Button>
                                                    <Button size="small" icon={<Send className="size-3.5" />} onClick={() => onSendToCanvas(job.video_url ?? null, `${job.label}成片`)}>
                                                        送画布（快照 + 提示）
                                                    </Button>
                                                    <span className="text-caption text-foreground/40">本地文件直出：{codeRenderFileUrl(job.job_id)}</span>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                    </div>
                )}
            </section>

            {/* ---- 批量裂变 ---- */}
            <section className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-3.5" data-yq="omni-batch" aria-label="多版本裂变">
                <strong className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80">
                    <Layers className="size-4 text-primary" /> 多版本裂变（同蓝图 + 变量差集，≤{MAX_VARIATIONS} 版）
                </strong>
                <p className="text-caption text-foreground/45">每版只放差异（标题 / 主题主色）；提交即见每版渲染计划（预报价），引擎 FIFO 串行排队。时间按 worst case 报价——同蓝图裂变多数镜头命中缓存，实际明显更快。</p>
                <div className="flex flex-col gap-2">
                    {variations.map((variation, index) => (
                        <div key={variation.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 p-2">
                            <span className="text-caption text-foreground/50">v{index + 1}</span>
                            <Input
                                size="small"
                                className="max-w-32"
                                placeholder="版本名（如：圣诞版）"
                                value={variation.label}
                                onChange={(event) => setVariations((prev) => prev.map((item) => (item.id === variation.id ? { ...item, label: event.target.value } : item)))}
                            />
                            <Input
                                size="small"
                                className="max-w-52"
                                placeholder="标题差异（留空=不改变体）"
                                value={variation.title}
                                onChange={(event) => setVariations((prev) => prev.map((item) => (item.id === variation.id ? { ...item, title: event.target.value } : item)))}
                            />
                            <input
                                type="color"
                                value={variation.primary || "#FF4D4F"}
                                onChange={(event) => setVariations((prev) => prev.map((item) => (item.id === variation.id ? { ...item, primary: event.target.value } : item)))}
                                className="size-7 cursor-pointer rounded border border-border/60"
                                aria-label={`版本 ${index + 1} 主色`}
                            />
                            <Button size="small" type="text" danger onClick={() => setVariations((prev) => prev.filter((item) => item.id !== variation.id))}>
                                删
                            </Button>
                        </div>
                    ))}
                    <div className="flex flex-wrap items-center gap-2">
                        <Button size="small" disabled={variations.length >= MAX_VARIATIONS} onClick={() => setVariations((prev) => [...prev, { id: `var_${Date.now().toString(36)}`, label: `版本 ${prev.length + 1}`, title: "", primary: "" }])}>
                            + 加一个版本（{variations.length}/{MAX_VARIATIONS}）
                        </Button>
                        <Button type="primary" icon={<Layers className="size-4" />} disabled={variations.length === 0} loading={submitting || runningJobs.length > 0} onClick={() => void handleBatch()} data-yq="omni-batch-button">
                            🚀 批量裂变（{variations.length} 版）
                        </Button>
                    </div>
                </div>
            </section>

            {/* ---- 批量进度网格（1~8 视频卡；提交即见预报价）---- */}
            {batchJobs.length > 0 ? (
                <section className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3.5" data-yq="omni-batch-grid" aria-label="裂变进度网格">
                    <strong className="text-sm font-semibold text-foreground/80">裂变进度（逐版 fan-out 轮询 · {batchJobs.length} 版）</strong>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                        {batchJobs.map((job) => {
                            const pct = job.frames_total > 0 ? Math.round((job.frames_done / job.frames_total) * 100) : 0;
                            const quote = job.plan ? describePlan(job.plan) : null;
                            return (
                                <div key={job.job_id} className="flex flex-col gap-1.5 rounded-lg border border-border/60 p-2.5" data-yq="omni-batch-card">
                                    <div className="flex items-center gap-1.5">
                                        <Tag color={job.status === "done" ? "green" : job.status === "error" ? "red" : "blue"}>{job.label}</Tag>
                                        <span className="flex-1" />
                                        <span className="font-mono text-caption text-foreground/40">{job.job_id.slice(-8)}</span>
                                    </div>
                                    {quote ? <span className="text-caption text-foreground/60">{quote.summary}</span> : null}
                                    {!isTerminalStatus(job.status) ? (
                                        <>
                                            <Progress percent={pct} size={[6, 4]} />
                                            <span className="text-caption text-foreground/50">{job.status === "queued" ? `排队中（第 ${(job.queue_position ?? 0) + 1} 位）` : `截帧 ${job.frames_done}/${job.frames_total}`}</span>
                                        </>
                                    ) : null}
                                    {job.status === "error" && job.error ? <Alert type="error" showIcon message={job.error} /> : null}
                                    {job.status === "done" && job.video_url ? (
                                        <>
                                            <video className="w-full rounded bg-black" src={job.video_url} controls playsInline preload="metadata" poster={mock ? OMNI_MOCK_POSTER : undefined} />
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <Button size="small" type="link" icon={<Download className="size-3.5" />} href={job.video_url} download={`${job.label}.mp4`}>
                                                    下载
                                                </Button>
                                                <Button size="small" type="link" icon={<Send className="size-3.5" />} onClick={() => onSendToCanvas(job.video_url ?? null, job.label)}>
                                                    送画布
                                                </Button>
                                            </div>
                                        </>
                                    ) : null}
                                    {job.status === "done" && !job.video_url ? <span className="text-caption text-status-success">渲染完成（成片文件经引擎文件端点获取）</span> : null}
                                </div>
                            );
                        })}
                    </div>
                </section>
            ) : null}

            {/* ---- 物料提示：产品图绑定 ---- */}
            {products.length > 0 ? (
                <p className="flex items-center gap-1.5 text-caption text-foreground/40">
                    <VideoIcon className="size-3.5" /> 已绑定 {Object.keys(blueprint.slots).length} 个物料槽位；产品图编号见输入舱。[1] 号图的透明底在渲染管线按需处理（写实层第二阶段可补实拍生成）。
                </p>
            ) : null}

            {/* ---- 重试入口（错误态恢复）---- */}
            {jobs.some((job) => job.status === "error") ? (
                <Button icon={<RotateCcw className="size-4" />} onClick={() => setJobs((prev) => prev.filter((job) => job.status !== "error"))}>
                    清除失败记录
                </Button>
            ) : null}

            {/* ---- 裂变复制出口（文案兜底：分镜文本进剪贴板）---- */}
            {singleDone.length > 0 ? (
                <Button
                    size="small"
                    icon={<Copy className="size-3.5" />}
                    onClick={() => void navigator.clipboard?.writeText(`${blueprint.meta.title}\n${blueprint.shots.map((shot, index) => `#${index + 1} ${shotLabel(shot)}`).join("\n")}`).then(() => message.success("分镜文本已复制"))}
                >
                    复制分镜文本
                </Button>
            ) : null}

            <span className="flex items-center gap-1.5 text-caption text-foreground/35">
                <Clapperboard className="size-3.5" /> 渲染路径 0 积分（硬不变量）；上传与拆解默认本地引擎同样 0 积分。
            </span>
        </div>
    );
}
