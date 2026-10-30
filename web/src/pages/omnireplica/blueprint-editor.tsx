/**
 * 全能复刻 · 蓝图编辑器（MotionBlueprint JSON 可视化表单）。
 *
 * 设计要点（《交付方案 v1.2》§7）：
 * - theme 换肤区高亮「改这里=零成本」（@theme.* 引用渲染时注入 :root 变量）；
 * - 镜头列表 + 元素编辑（文本/位置/色值引用/描边/入场动效，全部枚举下拉）；
 * - 低置信镜头高亮 + 「建议人工确认」角标 + 一键「按推荐值补齐全部待确认项」；
 * - 预览逐镜标注「包装镜头（代码生成）/实拍镜头（占位）」——写实层第二阶段可补；
 * - 版本列表（render_key 短号 + 时间 + 来源）→ 选中回退（GET 快照 → PUT 覆盖，
 *   本地快照 + 引擎 PUT；死引用文件给明确警告不静默）。
 *
 * 五种状态：正常 / 空（未装配→引导回输入舱）/ 加载（保存·回退中）/ 错误（人话）/ 无权限（路由级）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Input, InputNumber, Select, Tag, Tooltip } from "antd";
import { ArrowLeft, CheckCircle2, Clapperboard, History, Palette, Save, Sparkles, Wand2, Wrench } from "lucide-react";

import { ENTER_TYPES, EXIT_TYPES, LOW_CONFIDENCE, TRANSITION_TYPES, applyRecommendedPresets, resolveThemeValue, shotNeedsPreset, type MotionBlueprint, type MotionElement, type MotionShot } from "@/lib/omnireplica/blueprint";
import { MOTION_PRESETS } from "@/lib/omnireplica/motion-presets";
import { getBlueprint, OmnireplicaApiError, putBlueprint } from "@/services/api/omnireplica";
import type { ProductImage } from "./index";

type BlueprintEditorProps = {
    blueprint: MotionBlueprint | null;
    products: ProductImage[];
    mock: boolean;
    onChange: (next: MotionBlueprint) => void;
    onGoBench: () => void;
    onGoCockpit: () => void;
    onSendToCanvas: (videoUrl: string | null, label: string) => void;
    messageApi: ReturnType<typeof App.useApp>["message"];
};

type VersionEntry = { key: string; at: number; source: string; resolution: string; fps: number; blueprint: MotionBlueprint };

const VERSION_HISTORY_KEY = "omnireplica-version-history";
const VERSION_HISTORY_LIMIT = 20;

/** 本地版本历史（引擎侧 versions/ 快照的列表端点未冻结；本地列表 + PUT 回退，三界限明示）。 */
function loadVersionHistory(): VersionEntry[] {
    try {
        const raw = window.localStorage.getItem(VERSION_HISTORY_KEY);
        const parsed = raw ? (JSON.parse(raw) as VersionEntry[]) : [];
        return Array.isArray(parsed) ? parsed.slice(0, VERSION_HISTORY_LIMIT) : [];
    } catch {
        return [];
    }
}

function saveVersionHistory(entries: VersionEntry[]): void {
    try {
        window.localStorage.setItem(VERSION_HISTORY_KEY, JSON.stringify(entries.slice(0, VERSION_HISTORY_LIMIT)));
    } catch {
        /* 超配额不阻断编辑 */
    }
}

export function BlueprintEditor({ blueprint, products, mock, onChange, onGoBench, onGoCockpit, onSendToCanvas, messageApi }: BlueprintEditorProps) {
    const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [versions, setVersions] = useState<VersionEntry[]>(() => loadVersionHistory());
    const [jsonOpen, setJsonOpen] = useState(false);

    // 操作台每次成功渲染落档后刷新列表（appendVersionHistory 派发 CustomEvent）
    useEffect(() => {
        const refresh = () => setVersions(loadVersionHistory());
        window.addEventListener("omnireplica-version-history", refresh);
        return () => window.removeEventListener("omnireplica-version-history", refresh);
    }, []);

    const shots = blueprint?.shots || [];
    const currentShot = useMemo(() => shots.find((shot) => shot.shot_id === selectedShotId) || shots[0] || null, [shots, selectedShotId]);
    const pendingShots = useMemo(() => shots.filter(shotNeedsPreset), [shots]);

    const patchShot = useCallback(
        (shotId: string, patch: (shot: MotionShot) => MotionShot) => {
            if (!blueprint) return;
            onChange({ ...blueprint, shots: blueprint.shots.map((shot) => (shot.shot_id === shotId ? patch(shot) : shot)) });
        },
        [blueprint, onChange],
    );

    const patchElement = useCallback(
        (shotId: string, elementId: string, patch: (element: MotionElement) => MotionElement) => {
            patchShot(shotId, (shot) => ({ ...shot, elements: shot.elements.map((element) => (element.element_id === elementId ? patch(element) : element)) }));
        },
        [patchShot],
    );

    /** 保存蓝图到引擎（PUT /api/v1/omnireplica/blueprint?job=<blueprint_id>，16MB 上限）。 */
    const handleSave = useCallback(async () => {
        if (!blueprint) return;
        setSaving(true);
        setSaveError(null);
        try {
            if (mock) {
                await new Promise((resolve) => setTimeout(resolve, 400));
                messageApi.success("（Mock）蓝图已保存到引擎资产目录");
            } else {
                await putBlueprint(blueprint.blueprint_id, blueprint);
                messageApi.success("蓝图已保存到引擎资产目录");
            }
        } catch (e) {
            setSaveError(e instanceof OmnireplicaApiError ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    }, [blueprint, mock, messageApi]);

    /** 一键按推荐值补齐全部待确认项（人工决策；只改本地蓝图，不触发渲染）。 */
    const handlePresetFill = useCallback(() => {
        if (!blueprint) return;
        const result = applyRecommendedPresets(blueprint);
        onChange(result.blueprint);
        if (result.filledShotIds.length === 0) messageApi.info("没有待确认镜头需要补齐");
        else messageApi.success(`已按推荐值补齐 ${result.filledShotIds.length} 个待确认镜头（采用模板：${result.usedPresetIds.map((id) => MOTION_PRESETS.find((preset) => preset.id === id)?.name || id).join("、")}）`);
    }, [blueprint, onChange, messageApi]);

    /** 回退到历史版本（本地快照 → PUT 覆盖；死引用警告不静默）。 */
    const handleRollback = useCallback(
        async (entry: VersionEntry) => {
            const deadRefs = Object.values(entry.blueprint.slots).filter((slot) => /^file:|^https?:/.test(slot.url || ""));
            if (deadRefs.length > 0) {
                messageApi.warning(`该版本引用 ${deadRefs.length} 个外部/文件路径资产：引擎重启或文件移动后会成为死引用，渲染时将明示降级`);
            }
            onChange(entry.blueprint);
            if (!mock) {
                try {
                    await putBlueprint(entry.blueprint.blueprint_id, entry.blueprint);
                } catch (e) {
                    messageApi.warning(`本地已回退，但引擎侧保存失败：${e instanceof OmnireplicaApiError ? e.message : String(e)}`);
                }
            }
            messageApi.success(`已回退到 ${entry.key}（${new Date(entry.at).toLocaleString()} · ${entry.source}）`);
        },
        [onChange, mock, messageApi],
    );

    /** 从引擎读回蓝图（GET 同路径；用于联调日核对落盘）。 */
    const handleReload = useCallback(async () => {
        if (!blueprint) return;
        setSaving(true);
        try {
            if (mock) {
                messageApi.info("（Mock）引擎读取暂不可用");
            } else {
                const raw = await getBlueprint(blueprint.blueprint_id);
                onChange(raw as MotionBlueprint);
                messageApi.success("已从引擎读回最新蓝图");
            }
        } catch (e) {
            setSaveError(e instanceof OmnireplicaApiError ? e.message : String(e));
        } finally {
            setSaving(false);
        }
    }, [blueprint, mock, onChange, messageApi]);

    // ---- 空态：未装配蓝图 ----
    if (!blueprint) {
        return (
            <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-16 text-center" data-yq="omni-editor-empty" aria-label="蓝图编辑器空态">
                <Wrench className="size-10 text-foreground/30" />
                <strong className="text-sm font-semibold text-foreground/75">蓝图还没装配</strong>
                <p className="max-w-md text-caption leading-5 text-foreground/50">先回输入舱上传参考视频并点「🚀 开始拆解动效蓝图」；VLM 漏返时也会按通用模板装配一份可编辑蓝图。</p>
                <Button type="primary" onClick={onGoCockpit}>
                    去输入舱
                </Button>
            </section>
        );
    }

    const theme = blueprint.theme;

    return (
        <div className="flex flex-col gap-4" data-yq="omni-editor">
            {/* ---- 编辑器头：标题 / 保存 / 读回 / 去试看 / 送画布 ---- */}
            <section className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-3">
                <Button size="small" icon={<ArrowLeft className="size-3.5" />} onClick={onGoCockpit}>
                    回输入舱
                </Button>
                <Input className="max-w-72" value={blueprint.meta.title} onChange={(event) => onChange({ ...blueprint, meta: { ...blueprint.meta, title: event.target.value } })} aria-label="工程标题" addonBefore="工程" />
                <span className="font-mono text-caption text-foreground/45">{blueprint.blueprint_id}</span>
                <span className="flex-1" />
                <Button size="small" icon={<Save className="size-3.5" />} loading={saving} onClick={() => void handleSave()}>
                    保存到引擎
                </Button>
                <Button size="small" onClick={() => void handleReload()} loading={saving}>
                    从引擎读回
                </Button>
                <Button size="small" icon={<Clapperboard className="size-3.5" />} onClick={() => onSendToCanvas(null, blueprint.meta.title)}>
                    送画布（蓝图快照）
                </Button>
                <Button type="primary" size="small" icon={<Sparkles className="size-3.5" />} onClick={onGoBench} data-yq="omni-go-bench">
                    去试看 / 成片 →
                </Button>
            </section>

            {saveError ? <Alert type="error" showIcon closable message="引擎保存失败" description={saveError} onClose={() => setSaveError(null)} /> : null}

            {/* ---- degraded 三机制之二：一键推荐补齐 ---- */}
            {pendingShots.length > 0 ? (
                <section className="flex flex-wrap items-center gap-2 rounded-xl border border-status-warning/40 bg-status-warning/5 p-3" data-yq="omni-preset-fill">
                    <Alert
                        style={{ flex: 1, minWidth: 260 }}
                        type="warning"
                        showIcon
                        message={`${pendingShots.length} 个镜头待人工确认（低置信 / 动效缺失 / degraded）`}
                        description="推荐值来自 3 个预置整镜模板（口播条 / 产品特写 / 氛围过场，均受引擎枚举约束）；采纳是人工决策，只改蓝图不触发渲染。"
                    />
                    <Button type="primary" icon={<Wand2 className="size-4" />} onClick={handlePresetFill} data-yq="omni-preset-fill-button">
                        按推荐值补齐全部待确认项
                    </Button>
                </section>
            ) : null}

            <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[38%_62%]">
                {/* ---- 左列：theme 换肤区（零成本高亮）+ canvas + slots ---- */}
                <div className="flex flex-col gap-3">
                    <section className="rounded-xl border border-primary/40 bg-primary/5 p-3.5" data-yq="omni-theme-zone" aria-label="主题换肤区">
                        <strong className="flex items-center gap-1.5 text-sm font-semibold text-primary">
                            <Palette className="size-4" /> 主题换肤区
                            <Tooltip title="@theme.* 引用渲染时注入 :root CSS 自定义属性——改配色只改 theme 块，未引用被改变量的镜头连 HTML 都不重新生成（零成本）">
                                <Tag color="gold" className="!ml-1">
                                    改这里 = 零成本
                                </Tag>
                            </Tooltip>
                        </strong>
                        <div className="mt-2.5 flex flex-col gap-2">
                            {Object.entries(theme.colors).map(([key, value]) => (
                                <label key={key} className="flex items-center gap-2 text-caption">
                                    <input
                                        type="color"
                                        value={resolveThemeValue(blueprint, value)}
                                        onChange={(event) => onChange({ ...blueprint, theme: { ...theme, colors: { ...theme.colors, [key]: event.target.value } } })}
                                        className="size-7 cursor-pointer rounded border border-border/60"
                                        aria-label={`主题色 ${key}`}
                                    />
                                    <span className="w-20 shrink-0 font-mono text-foreground/70">{key}</span>
                                    <Input size="small" value={value} onChange={(event) => onChange({ ...blueprint, theme: { ...theme, colors: { ...theme.colors, [key]: event.target.value } } })} />
                                </label>
                            ))}
                            <label className="flex items-center gap-2 text-caption">
                                <span className="w-20 shrink-0 text-foreground/70">标题字号比</span>
                                <InputNumber
                                    size="small"
                                    min={0.02}
                                    max={0.2}
                                    step={0.005}
                                    value={theme.title_size_ratio}
                                    onChange={(value) => onChange({ ...blueprint, theme: { ...theme, title_size_ratio: typeof value === "number" ? value : theme.title_size_ratio } })}
                                />
                                <span className="text-foreground/40">（改它 = 全局重渲）</span>
                            </label>
                        </div>
                    </section>

                    <section className="rounded-xl border border-border bg-surface p-3.5" aria-label="画布与转场（全局作用域）">
                        <strong className="text-sm font-semibold text-foreground/80">画布与转场</strong>
                        <p className="mt-0.5 text-caption text-foreground/45">以下字段属全局作用域：任一变化 → 全片重截。</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="flex items-center gap-1.5 text-caption">
                                宽
                                <InputNumber size="small" min={180} max={4096} value={blueprint.canvas.width} onChange={(value) => onChange({ ...blueprint, canvas: { ...blueprint.canvas, width: Number(value) || blueprint.canvas.width } })} />
                            </label>
                            <label className="flex items-center gap-1.5 text-caption">
                                高
                                <InputNumber size="small" min={180} max={4096} value={blueprint.canvas.height} onChange={(value) => onChange({ ...blueprint, canvas: { ...blueprint.canvas, height: Number(value) || blueprint.canvas.height } })} />
                            </label>
                            <label className="flex items-center gap-1.5 text-caption">
                                时长 ms
                                <InputNumber
                                    size="small"
                                    min={1000}
                                    max={120_000}
                                    step={500}
                                    value={blueprint.canvas.duration_ms}
                                    onChange={(value) => onChange({ ...blueprint, canvas: { ...blueprint.canvas, duration_ms: Number(value) || blueprint.canvas.duration_ms } })}
                                />
                            </label>
                            <label className="flex items-center gap-1.5 text-caption">
                                底色
                                <input
                                    type="color"
                                    value={blueprint.canvas.background.solid}
                                    onChange={(event) => onChange({ ...blueprint, canvas: { ...blueprint.canvas, background: { ...blueprint.canvas.background, solid: event.target.value } } })}
                                    className="size-7 cursor-pointer rounded border border-border/60"
                                    aria-label="画布底色"
                                />
                            </label>
                        </div>
                        <div className="mt-2 flex flex-col gap-1.5">
                            <span className="text-caption text-foreground/60">转场序列</span>
                            {blueprint.transitions.map((transition, index) => (
                                <div key={`${transition.after_shot}-${index}`} className="flex items-center gap-1.5">
                                    <span className="text-caption text-foreground/50">{transition.after_shot} 后</span>
                                    <Select
                                        size="small"
                                        className="min-w-32"
                                        value={transition.type}
                                        options={TRANSITION_TYPES.map((item) => ({ value: item, label: item }))}
                                        onChange={(value) => onChange({ ...blueprint, transitions: blueprint.transitions.map((item, i) => (i === index ? { ...item, type: value } : item)) })}
                                    />
                                    <InputNumber
                                        size="small"
                                        min={0}
                                        max={2000}
                                        step={50}
                                        value={transition.duration_ms}
                                        onChange={(value) => onChange({ ...blueprint, transitions: blueprint.transitions.map((item, i) => (i === index ? { ...item, duration_ms: Number(value) || 0 } : item)) })}
                                    />
                                    <Button size="small" type="text" danger onClick={() => onChange({ ...blueprint, transitions: blueprint.transitions.filter((_, i) => i !== index) })}>
                                        删
                                    </Button>
                                </div>
                            ))}
                            <Button size="small" onClick={() => onChange({ ...blueprint, transitions: [...blueprint.transitions, { after_shot: shots[shots.length - 1]?.shot_id || "shot_1", type: "cut", duration_ms: 200 }] })}>
                                + 加一条转场
                            </Button>
                        </div>
                    </section>

                    <section className="rounded-xl border border-border bg-surface p-3.5" aria-label="物料槽位">
                        <strong className="text-sm font-semibold text-foreground/80">物料槽位（slots）</strong>
                        <div className="mt-2 flex flex-col gap-1.5">
                            {Object.entries(blueprint.slots).length === 0 ? <p className="text-caption text-foreground/45">暂无槽位（VLM 未产出）</p> : null}
                            {Object.entries(blueprint.slots).map(([key, slot]) => (
                                <div key={key} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/50 p-2">
                                    <span className="font-mono text-caption text-foreground/70">{key}</span>
                                    <Tag>{slot.kind === "sprite" ? "精灵图" : "产品图"}</Tag>
                                    {slot.kind === "product_image" ? (
                                        <Select
                                            size="small"
                                            className="min-w-36"
                                            value={products.some((product) => product.dataUrl === slot.url) ? slot.url : undefined}
                                            placeholder="绑定编号产品图"
                                            options={products.map((product, index) => ({ value: product.dataUrl, label: `[${index + 1}] ${product.name}` }))}
                                            onChange={(value) => onChange({ ...blueprint, slots: { ...blueprint.slots, [key]: { ...slot, url: value } } })}
                                        />
                                    ) : (
                                        <span className="text-caption text-foreground/50">
                                            切片 {slot.sprite?.slice_index ?? 0} · {slot.sprite?.frame_count ?? 1} 帧 @ {slot.sprite?.fps ?? 12}fps
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>
                </div>

                {/* ---- 右列：镜头列表 + 元素编辑 ---- */}
                <div className="flex flex-col gap-3">
                    <section className="rounded-xl border border-border bg-surface p-3.5" data-yq="omni-shot-list" aria-label="镜头列表">
                        <strong className="text-sm font-semibold text-foreground/80">镜头列表（{shots.length}）</strong>
                        <p className="mt-0.5 text-caption text-foreground/45">逐镜标注：包装镜头（代码生成）/ 实拍镜头（占位，第二阶段可补实拍生成）。</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {shots.map((shot, index) => {
                                const lowConfidence = typeof shot.confidence === "number" && shot.confidence < LOW_CONFIDENCE;
                                const pending = shotNeedsPreset(shot);
                                return (
                                    <button
                                        key={shot.shot_id}
                                        type="button"
                                        className={`min-h-8 rounded-lg border px-2.5 text-caption transition-colors ${currentShot?.shot_id === shot.shot_id ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-foreground/65 hover:border-primary/40"} ${pending ? "ring-1 ring-status-warning/60" : ""}`}
                                        onClick={() => setSelectedShotId(shot.shot_id)}
                                    >
                                        #{index + 1} {Math.round(shot.start_ms / 1000)}s-{Math.round(shot.end_ms / 1000)}s{lowConfidence ? <span className="ml-1 text-status-warning">⚠️</span> : null}
                                        {shot.layer === "live_action" ? <span className="ml-1 text-foreground/45">实拍</span> : null}
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    {currentShot ? (
                        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3.5" aria-label={`镜头 ${currentShot.shot_id} 编辑`}>
                            <div className="flex flex-wrap items-center gap-2">
                                <strong className="text-sm font-semibold text-foreground/80">{currentShot.shot_id}</strong>
                                <Tag color={currentShot.layer === "live_action" ? "orange" : "blue"}>{currentShot.layer === "live_action" ? "实拍镜头（占位）" : "包装镜头（代码生成）"}</Tag>
                                <Select
                                    size="small"
                                    className="min-w-32"
                                    value={currentShot.layer || "code"}
                                    options={[
                                        { value: "code", label: "包装镜头（代码生成）" },
                                        { value: "live_action", label: "实拍镜头（占位）" },
                                    ]}
                                    onChange={(value) => patchShot(currentShot.shot_id, (shot) => ({ ...shot, layer: value as "code" | "live_action" }))}
                                />
                                <span className="flex-1" />
                                <label className="flex items-center gap-1.5 text-caption text-foreground/60">
                                    起
                                    <InputNumber size="small" min={0} max={blueprint.canvas.duration_ms} step={100} value={currentShot.start_ms} onChange={(value) => patchShot(currentShot.shot_id, (shot) => ({ ...shot, start_ms: Number(value) || 0 }))} />
                                </label>
                                <label className="flex items-center gap-1.5 text-caption text-foreground/60">
                                    止
                                    <InputNumber size="small" min={0} max={blueprint.canvas.duration_ms} step={100} value={currentShot.end_ms} onChange={(value) => patchShot(currentShot.shot_id, (shot) => ({ ...shot, end_ms: Number(value) || 0 }))} />
                                </label>
                            </div>

                            {currentShot.degraded?.length || (typeof currentShot.confidence === "number" && currentShot.confidence < LOW_CONFIDENCE) ? (
                                <Alert
                                    type="warning"
                                    showIcon
                                    message="建议人工确认"
                                    description={
                                        <span className="flex flex-col gap-0.5">
                                            {typeof currentShot.confidence === "number" ? <span>置信度 {(currentShot.confidence * 100).toFixed(0)}%</span> : null}
                                            {(currentShot.degraded || []).map((item) => (
                                                <span key={item}>· {item}</span>
                                            ))}
                                        </span>
                                    }
                                />
                            ) : null}

                            <div className="flex flex-wrap items-center gap-2">
                                <label className="flex items-center gap-1.5 text-caption text-foreground/60">
                                    入场
                                    <Select
                                        size="small"
                                        className="min-w-32"
                                        value={currentShot.enter?.type || "none"}
                                        options={ENTER_TYPES.map((item) => ({ value: item, label: item }))}
                                        onChange={(value) => patchShot(currentShot.shot_id, (shot) => ({ ...shot, enter: { ...shot.enter, type: value } }))}
                                    />
                                </label>
                                <label className="flex items-center gap-1.5 text-caption text-foreground/60">
                                    出场
                                    <Select
                                        size="small"
                                        className="min-w-32"
                                        value={currentShot.exit?.type || "none"}
                                        options={EXIT_TYPES.map((item) => ({ value: item, label: item }))}
                                        onChange={(value) => patchShot(currentShot.shot_id, (shot) => ({ ...shot, exit: { ...shot.exit, type: value } }))}
                                    />
                                </label>
                            </div>

                            <div className="flex flex-col gap-2">
                                <span className="text-caption font-medium text-foreground/65">元素（{currentShot.elements.length}）</span>
                                {currentShot.elements.map((element) => (
                                    <div key={element.element_id} className="flex flex-col gap-1.5 rounded-lg border border-border/50 p-2">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Tag>{element.type === "text" ? "文本" : element.type === "sprite" ? "精灵图" : "图片"}</Tag>
                                            <Input
                                                size="small"
                                                className="max-w-40"
                                                value={element.element_id}
                                                onChange={(event) => patchElement(currentShot.shot_id, element.element_id, (item) => ({ ...item, element_id: event.target.value }))}
                                                aria-label="元素 id"
                                            />
                                            <label className="flex items-center gap-1 text-caption text-foreground/55">
                                                x
                                                <InputNumber
                                                    size="small"
                                                    min={0}
                                                    max={1}
                                                    step={0.01}
                                                    value={element.position.x}
                                                    onChange={(value) => patchElement(currentShot.shot_id, element.element_id, (item) => ({ ...item, position: { ...item.position, x: Number(value) || 0 } }))}
                                                />
                                            </label>
                                            <label className="flex items-center gap-1 text-caption text-foreground/55">
                                                y
                                                <InputNumber
                                                    size="small"
                                                    min={0}
                                                    max={1}
                                                    step={0.01}
                                                    value={element.position.y}
                                                    onChange={(value) => patchElement(currentShot.shot_id, element.element_id, (item) => ({ ...item, position: { ...item.position, y: Number(value) || 0 } }))}
                                                />
                                            </label>
                                            <span className="flex-1" />
                                            <Button size="small" type="text" danger onClick={() => patchShot(currentShot.shot_id, (shot) => ({ ...shot, elements: shot.elements.filter((item) => item.element_id !== element.element_id) }))}>
                                                删元素
                                            </Button>
                                        </div>
                                        {element.type === "text" ? (
                                            <Input size="small" value={element.text || ""} placeholder="大标题文案" onChange={(event) => patchElement(currentShot.shot_id, element.element_id, (item) => ({ ...item, text: event.target.value }))} />
                                        ) : null}
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <Select
                                                size="small"
                                                className="min-w-36"
                                                value={element.color && element.color.startsWith("@theme.") ? element.color : "@theme.colors.text"}
                                                options={Object.keys(theme.colors).map((key) => ({ value: `@theme.colors.${key}`, label: `@theme.colors.${key}` }))}
                                                onChange={(value) => patchElement(currentShot.shot_id, element.element_id, (item) => ({ ...item, color: value }))}
                                            />
                                            <span className="text-caption text-foreground/40">→ {resolveThemeValue(blueprint, element.color)}</span>
                                            <Select
                                                size="small"
                                                className="min-w-28"
                                                value={element.enter?.type || "none"}
                                                options={ENTER_TYPES.map((item) => ({ value: item, label: item }))}
                                                onChange={(value) => patchElement(currentShot.shot_id, element.element_id, (item) => ({ ...item, enter: { ...item.enter, type: value } }))}
                                            />
                                        </div>
                                    </div>
                                ))}
                                <Button
                                    size="small"
                                    onClick={() =>
                                        patchShot(currentShot.shot_id, (shot) => ({
                                            ...shot,
                                            elements: [
                                                ...shot.elements,
                                                { element_id: `el_${shot.shot_id}_${shot.elements.length + 1}`, type: "text", text: "新文案", position: { x: 0.5, y: 0.5 }, color: "@theme.colors.text", enter: { type: "fade-up", duration_ms: 300 } },
                                            ],
                                        }))
                                    }
                                >
                                    + 加一个文本元素
                                </Button>
                            </div>
                        </section>
                    ) : null}
                </div>
            </div>

            {/* ---- 版本列表与回退 ---- */}
            <section className="rounded-xl border border-border bg-surface p-3.5" aria-label="蓝图版本历史">
                <strong className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80">
                    <History className="size-4" /> 版本历史（本地快照 ≤{VERSION_HISTORY_LIMIT} 条）
                </strong>
                <p className="mt-0.5 text-caption text-foreground/45">三界限：① 渲染时点粒度（回退=回到那次渲染提交的蓝图）② 死引用文件明确警告不静默 ③ 超上限自动淘汰最旧。试看操作台每次成功渲染自动落一条。</p>
                {versions.length === 0 ? (
                    <p className="mt-1.5 text-caption text-foreground/45">还没有版本——去试看操作台完成一次渲染即自动落档。</p>
                ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {versions.map((entry) => (
                            <Tooltip key={entry.key} title={`${new Date(entry.at).toLocaleString()} · ${entry.source} · ${entry.resolution}@${entry.fps}fps · 蓝图 ${entry.blueprint.blueprint_id}`}>
                                <Button size="small" onClick={() => void handleRollback(entry)}>
                                    <span className="font-mono">{entry.key}</span>
                                    <span className="ml-1.5 text-foreground/50">{entry.source}</span>
                                </Button>
                            </Tooltip>
                        ))}
                    </div>
                )}
            </section>

            {/* ---- JSON 原文（可审计）---- */}
            <section className="rounded-xl border border-border bg-surface p-3.5">
                <button type="button" aria-expanded={jsonOpen} className="flex min-h-6 items-center gap-1 text-caption text-foreground/55 transition-colors hover:text-foreground/75" onClick={() => setJsonOpen((open) => !open)}>
                    蓝图 JSON 原文（可审计 diff）<span aria-hidden>{jsonOpen ? "▴" : "▾"}</span>
                </button>
                {jsonOpen ? <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-surface-subtle p-2.5 font-mono text-caption leading-5 text-foreground/70">{JSON.stringify(blueprint, null, 2)}</pre> : null}
            </section>

            {/* ---- 预置模板说明（上线门槛提示）---- */}
            <p className="flex items-center gap-1.5 text-caption text-foreground/40">
                <CheckCircle2 className="size-3.5" /> 一键推荐补齐的三模板（{MOTION_PRESETS.map((preset) => preset.name).join(" / ")}）须先过 nxf preset 回归测试才向运营开放——未过回归时按钮不渲染（当前为开发期形态）。
            </p>
        </div>
    );
}

/** 由外部（操作台）写入版本历史——成功渲染即落档，供编辑器回退。 */
export function appendVersionHistory(entry: Omit<VersionEntry, "at">): void {
    const next: VersionEntry = { ...entry, at: Date.now() };
    const merged = [next, ...loadVersionHistory().filter((item) => item.key !== next.key)];
    saveVersionHistory(merged);
    // 同页多组件共享：派发事件让编辑器刷新列表
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("omnireplica-version-history"));
}
