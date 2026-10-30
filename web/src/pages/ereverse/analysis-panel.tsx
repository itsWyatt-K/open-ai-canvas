/**
 * 右栏 · 模式 A「五维解析面板」（对标 AppGrowing 图 1）。
 *
 * 五个 Tab：素材概述 | AI Prompt（默认） | 口播提取 | 音频提取 | 画面解析。
 * AI Prompt 视图 = 语言显示切换 + 镜头选择胶囊 + prompt_slots JSON 树编辑框
 * （可手改，字符数统计）+ 底部主按钮「🎬 AI 仿拍」切模式 B。
 *
 * 数据纪律：所有内容来自本轮反推 view；VLM 未产出的字段显空串，不臆造。
 */

import { useCallback, useMemo, useState } from "react";
import { Alert, Button, Tag, Tooltip } from "antd";
import { Sparkles, Wand2 } from "lucide-react";

import type { EreverseSceneView, EreverseView, EreversePromptSlots } from "@/lib/canvas/ereverse-view";
import { emptyPromptSlots, formatMs } from "@/lib/canvas/ereverse-view";
import { compileSlotsPrompt, compileSlotsPromptEn, slotsCharCount } from "./slots";

// antd Tag 在本应用主题下无色 prop 会渲染成黑底，语义标签统一用可读的中性配色
const NEUTRAL_TAG_STYLE: React.CSSProperties = {
    color: "rgba(0,0,0,0.68)",
    backgroundColor: "rgba(0,0,0,0.04)",
    borderColor: "rgba(0,0,0,0.14)",
};

type AnalysisPanelProps = {
    view: EreverseView;
    /** 投送勾选（画面解析 Tab 的成本闸门，与出口联动）。 */
    selectedSceneIndexes: Set<number> | null;
    onSelectedSceneIndexesChange: (next: Set<number> | null) => void;
    onGoldenThree: () => void;
    preferCompliance: boolean;
    onPreferComplianceChange: (next: boolean) => void;
    /** 重新提炼：用当前选区重跑一次反推。 */
    onReextract: () => void;
    reextracting: boolean;
    /** 进入模式 B：携带当前镜头（或整段合并）的槽位树。 */
    onEnterStudio: (slots: EreversePromptSlots, sourceLabel: string) => void;
    onSeek: (ms: number) => void;
};

/** 整段合并：取首个有主体信息的镜头为基底，口播台词并集所有镜头。 */
function mergeScenes(scenes: EreverseSceneView[]): EreversePromptSlots {
    const base = scenes.find((scene) => scene.promptSlots.主体.身份 || scene.promptSlots.主体.外观) || scenes[0];
    const merged = base ? { ...(JSON.parse(JSON.stringify(base.promptSlots)) as EreversePromptSlots) } : emptyPromptSlots();
    merged.口播台词 = scenes
        .map((scene) => scene.promptSlots.口播台词)
        .filter(Boolean)
        .join(" ");
    return merged;
}

function tryParseSlots(text: string): EreversePromptSlots | null {
    try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") return null;
        if (!parsed.主体 || !parsed.产品 || !parsed.场景背景 || !parsed.镜头运镜) return null;
        return parsed as unknown as EreversePromptSlots;
    } catch {
        return null;
    }
}

export function AnalysisPanel({ view, selectedSceneIndexes, onSelectedSceneIndexesChange, onGoldenThree, preferCompliance, onPreferComplianceChange, onReextract, reextracting, onEnterStudio, onSeek }: AnalysisPanelProps) {
    const [tab, setTab] = useState<string>("prompt");
    const [lang, setLang] = useState<"zh" | "en">("zh");
    const [shotKey, setShotKey] = useState<string>("0");
    const [draft, setDraft] = useState<string>("");
    const [draftScene, setDraftScene] = useState<string>("0");

    const scenes = view.scenes;
    const currentScene = useMemo(() => (shotKey === "merged" ? null : scenes.find((scene) => String(scene.index) === shotKey) || scenes[0] || null), [shotKey, scenes]);
    const baseSlots = useMemo(() => (shotKey === "merged" ? mergeScenes(scenes) : currentScene?.promptSlots || emptyPromptSlots()), [shotKey, currentScene, scenes]);

    // 编辑框草稿：镜头切换或新回执时重置为该镜头的格式化 JSON
    const draftKey = `${shotKey}|${view.generatedAt}`;
    if (draftScene !== draftKey) {
        setDraftScene(draftKey);
        setDraft(JSON.stringify(baseSlots, null, 2));
    }
    const parsedDraft = useMemo(() => tryParseSlots(draft), [draft]);
    const draftInvalid = !parsedDraft;
    const effectiveSlots = parsedDraft || baseSlots;
    const compiled = lang === "zh" ? compileSlotsPrompt(effectiveSlots) : compileSlotsPromptEn(effectiveSlots);

    const handleEnterStudio = useCallback(() => {
        if (!parsedDraft) return;
        onEnterStudio(parsedDraft, shotKey === "merged" ? "整段合并" : `镜头 ${Number(shotKey) + 1}`);
    }, [parsedDraft, onEnterStudio, shotKey]);

    const tabs = [
        { key: "overview", label: "素材概述" },
        { key: "prompt", label: "AI Prompt" },
        { key: "dialogue", label: "口播提取" },
        { key: "audio", label: "音频提取" },
        { key: "visual", label: "画面解析" },
    ];

    return (
        <section className="flex h-full flex-col rounded-xl border border-border bg-surface" aria-label="五维解析面板">
            {/* Tab 头 */}
            <div className="flex flex-wrap items-center gap-1 border-b border-border/60 px-3 py-2" role="tablist">
                {tabs.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        role="tab"
                        aria-selected={tab === item.key}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${tab === item.key ? "bg-primary/10 text-primary" : "text-foreground/60 hover:text-foreground/85"}`}
                        onClick={() => setTab(item.key)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
                {/* ---------- 素材概述 ---------- */}
                {tab === "overview" && (
                    <div className="flex flex-col gap-3 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-foreground/75">{view.sourceName}</span>
                            <Tag color="blue">
                                {view.width}×{view.height} · {view.fps}fps
                            </Tag>
                            <Tag color="blue">总时长 {formatMs(view.durationMs)}</Tag>
                            {view.fragment && (
                                <Tag color="purple">
                                    本次窗 {formatMs(view.fragment.startMs)} - {formatMs(view.fragment.endMs)}
                                </Tag>
                            )}
                            <Tag color="green">词级 {view.wordCount} 词</Tag>
                            {view.vlmProvider && <Tag color="purple">VLM {view.vlmProvider}</Tag>}
                        </div>
                        <div>
                            <h4 className="mb-1 text-xs font-semibold text-foreground/70">视觉 DNA 摘要（复刻同款画风用）</h4>
                            <p className="rounded-md border border-line-subtle bg-surface-subtle/40 px-2.5 py-2 leading-5 text-foreground/65">
                                {scenes
                                    .map((scene) => [scene.shotType, scene.cameraMovement, scene.visualPrompt].filter(Boolean).join(" · "))
                                    .filter(Boolean)
                                    .join(" ｜ ") || "本轮素材没有产出可用的视觉描述"}
                            </p>
                        </div>
                        <div>
                            <h4 className="mb-1 text-xs font-semibold text-foreground/70">溯源与降级（诚实登记）</h4>
                            <div className="flex flex-wrap gap-1">
                                <Tag>ASR {view.asrProvider || "无"}</Tag>
                                <Tag>时间轴 {view.timelineSource}</Tag>
                                {view.degraded.map((item) => (
                                    <Tag key={item} color="orange">
                                        {item}
                                    </Tag>
                                ))}
                                {!view.degraded.length && <Tag color="green">无降级项</Tag>}
                            </div>
                        </div>
                    </div>
                )}

                {/* ---------- AI Prompt（默认） ---------- */}
                {tab === "prompt" && (
                    <div className="flex h-full flex-col gap-2">
                        {/* 工具行：语言显示 / 镜头选择 / 重新提炼 */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-caption text-foreground/45">语言显示</span>
                            {(["zh", "en"] as const).map((code) => (
                                <button
                                    key={code}
                                    type="button"
                                    className={`rounded-md border px-2 py-0.5 text-caption transition-colors ${lang === code ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 text-foreground/55"}`}
                                    onClick={() => setLang(code)}
                                >
                                    {code === "zh" ? "中文" : "英文"}
                                </button>
                            ))}
                            <span className="mx-1 text-foreground/20">|</span>
                            {scenes.map((scene) => (
                                <button
                                    key={scene.index}
                                    type="button"
                                    className={`rounded-md border px-2 py-0.5 text-caption transition-colors ${shotKey === String(scene.index) ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 text-foreground/55"}`}
                                    onClick={() => setShotKey(String(scene.index))}
                                >
                                    镜头 {scene.index + 1}
                                </button>
                            ))}
                            <button
                                type="button"
                                className={`rounded-md border px-2 py-0.5 text-caption transition-colors ${shotKey === "merged" ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 text-foreground/55"}`}
                                onClick={() => setShotKey("merged")}
                            >
                                整段合并
                            </button>
                            <Tooltip title="重新跑一次反推（用当前选区刷新全部字段）">
                                <Button size="small" type="text" loading={reextracting} icon={<Wand2 className="size-3.5" />} onClick={onReextract}>
                                    🔄 重新提炼
                                </Button>
                            </Tooltip>
                        </div>

                        {/* 槽位 JSON 编辑框 */}
                        <textarea
                            className="min-h-[220px] flex-1 resize-none rounded-md border border-border bg-surface-subtle/40 p-2.5 font-mono text-caption leading-5 text-foreground/80 outline-none focus:border-primary/50"
                            value={draft}
                            spellCheck={false}
                            onChange={(event) => setDraft(event.target.value)}
                            aria-label="prompt_slots JSON 编辑框"
                        />
                        {draftInvalid && <Alert type="warning" showIcon message="JSON 格式不合法（改完这处才能进仿拍台）" className="!py-1 text-caption" />}

                        {/* 编译预览 + 字符数 */}
                        <div className="rounded-md border border-line-subtle bg-surface-subtle/40 px-2.5 py-2">
                            <div className="mb-1 flex items-center justify-between text-caption text-foreground/45">
                                <span>编译预览（{lang === "zh" ? "中文式" : "English"}，送模型的最终提示词）</span>
                                <span className="font-mono">{slotsCharCount(effectiveSlots)} 字符</span>
                            </div>
                            <p className="text-caption leading-5 text-foreground/70">{compiled || "（槽位全空）"}</p>
                        </div>

                        <Button type="primary" block icon={<Sparkles className="size-4" />} disabled={draftInvalid} onClick={handleEnterStudio}>
                            🎬 AI 仿拍
                        </Button>
                    </div>
                )}

                {/* ---------- 口播提取 ---------- */}
                {tab === "dialogue" && (
                    <div className="flex flex-col gap-2">
                        {view.chunks.length === 0 && <p className="text-xs text-foreground/40">无词级时间戳（素材可能无语音或 ASR 降级为语音段）</p>}
                        <div className="flex flex-wrap gap-1.5">
                            {view.chunks.map((chunk, index) => (
                                <button
                                    key={`${chunk.startMs}-${index}`}
                                    type="button"
                                    onClick={() => onSeek(chunk.startMs)}
                                    className="rounded-md border border-border bg-surface-hover px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
                                >
                                    <span className="mr-1 font-mono text-caption text-foreground/40">{formatMs(chunk.startMs)}</span>
                                    {chunk.text}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* ---------- 音频提取 ---------- */}
                {tab === "audio" && (
                    <div className="flex flex-col gap-3 text-xs">
                        <div>
                            <h4 className="mb-1 text-xs font-semibold text-foreground/70">音视频轨（ffprobe 实测）</h4>
                            <div className="flex flex-col gap-1">
                                {view.tracks.length === 0 && <span className="text-foreground/40">无轨信息</span>}
                                {view.tracks.map((track, index) => (
                                    <div key={`${track.kind}-${index}`} className="flex items-center gap-2 rounded-md bg-surface-subtle/40 px-2 py-1">
                                        <Tag color={track.kind === "audio" ? "green" : "blue"}>{track.kind}</Tag>
                                        <span className="font-mono text-foreground/60">{track.codec || "未知编码"}</span>
                                        {track.note && <span className="text-foreground/45">{track.note}</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div>
                            <h4 className="mb-1 text-xs font-semibold text-foreground/70">语音段（silencedetect 实测，{view.speechSpans.filter((s) => !s.isSilence).length} 段有声）</h4>
                            <div className="flex flex-wrap gap-1">
                                {view.speechSpans
                                    .filter((span) => !span.isSilence)
                                    .map((span, index) => (
                                        <Tag key={index} color="orange">
                                            {formatMs(span.startMs)} - {formatMs(span.endMs)}
                                        </Tag>
                                    ))}
                                {!view.speechSpans.some((span) => !span.isSilence) && <span className="text-foreground/40">无有声段</span>}
                            </div>
                        </div>
                    </div>
                )}

                {/* ---------- 画面解析 ---------- */}
                {tab === "visual" && (
                    <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-xs font-semibold text-foreground/70">分镜表（按镜头重拍用）</h4>
                            <Button size="small" type="text" onClick={onGoldenThree} title="只投送前 3 秒钩子镜 + 最长镜 + 收尾镜">
                                ⚡ 仅选黄金三镜
                            </Button>
                            <Button size="small" type="text" onClick={() => onSelectedSceneIndexesChange(null)}>
                                全选
                            </Button>
                            <label className="flex items-center gap-1 text-caption text-foreground/55">
                                <input type="checkbox" checked={preferCompliance} onChange={(event) => onPreferComplianceChange(event.target.checked)} />
                                🛡️ 防封改写稿
                            </label>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            {scenes.map((scene) => {
                                const checked = !selectedSceneIndexes || selectedSceneIndexes.has(scene.index);
                                return (
                                    <div key={scene.index} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line-subtle bg-surface-subtle/40 px-2 py-1.5 text-caption">
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            aria-label={`选择镜头 ${scene.index + 1} 投送`}
                                            onChange={(event) => {
                                                const base = selectedSceneIndexes ?? new Set(scenes.map((item) => item.index));
                                                const next = new Set(base);
                                                if (event.target.checked) next.add(scene.index);
                                                else next.delete(scene.index);
                                                onSelectedSceneIndexesChange(next);
                                            }}
                                        />
                                        <button type="button" className="font-mono text-foreground/40 hover:text-primary" onClick={() => onSeek(scene.startMs)}>
                                            #{scene.index + 1} {formatMs(scene.startMs)}
                                        </button>
                                        <span className="font-medium text-foreground/75">{[scene.shotType, scene.cameraMovement].filter(Boolean).join(" · ") || "景别未识别"}</span>
                                        <span className="line-clamp-2 min-w-0 flex-1 text-foreground/55">{(preferCompliance && scene.compliancePrompt) || scene.visualPrompt || scene.tags.join("、") || "无视觉提示词"}</span>
                                        {scene.tags.length > 0 && (
                                            <span className="flex flex-wrap gap-1 basis-full">
                                                {scene.tags.map((tag) => (
                                                    <Tag key={tag} className="!mr-0" style={NEUTRAL_TAG_STYLE}>
                                                        {tag}
                                                    </Tag>
                                                ))}
                                            </span>
                                        )}
                                        {scene.dialogue && <span className="line-clamp-1 min-w-0 basis-full text-foreground/45">台词：{scene.dialogue}</span>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
