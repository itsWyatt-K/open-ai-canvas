import { Button, Input, Popconfirm, Tag, Tooltip, message } from "antd";
import { Copy, Save } from "lucide-react";
import { useState } from "react";

import type { VisualDna } from "@/services/api/visual-dna";
import { useBrandKitStore } from "@/stores/canvas/use-brand-kit-store";

/**
 * 视觉DNA九维度面板：色板（点击复制 HEX）+ 各维度摘要与关键词 + 行内微调。
 * 编辑直接改写 dna 对象（onDnaChange 回传），供后续合成提示词使用。
 */

const DIMENSIONS: Array<{ key: keyof VisualDna; label: string; hint: string }> = [
    { key: "layout", label: "① 版式构图", hint: "网格结构 / 信息层级 / 留白节奏 / 视线动线" },
    { key: "color", label: "② 配色", hint: "主辅点缀色 + 占比 + 色温" },
    { key: "lighting", label: "③ 光影", hint: "光位 / 光质 / 投影 / 高光" },
    { key: "typography", label: "④ 字体排印", hint: "标题/正文气质 / 字重对比 / 对齐" },
    { key: "texture", label: "⑤ 质感", hint: "材质关键词 / 后期风格" },
    { key: "mood", label: "⑥ 氛围情绪", hint: "情绪 / 叙事 / 人群暗示" },
    { key: "model", label: "⑦ 模特人物", hint: "有无 / 姿态策略 / 面部处理" },
    { key: "props", label: "⑧ 道具场景", hint: "场景类型 / 道具清单 / 陈设逻辑" },
    { key: "brand", label: "⑨ 品牌元素", hint: "logo 处理 / 角标 / 合规留白" },
];

function dimensionSummary(dna: VisualDna, key: keyof VisualDna): string {
    const value = dna[key] as { summary?: string; present?: boolean } | undefined;
    if (!value || typeof value !== "object") return "";
    if (key === "model") return value.present ? value.summary || "" : "无人物";
    return value.summary || "";
}

function dimensionKeywords(dna: VisualDna, key: keyof VisualDna): string[] {
    const value = dna[key] as { keywords?: string[]; items?: string[] } | undefined;
    if (!value || typeof value !== "object") return [];
    return [...(value.keywords || []), ...(value.items || [])].filter(Boolean).slice(0, 8);
}

export function VisualDnaPanel({ dna, onDnaChange }: { dna: VisualDna; onDnaChange: (dna: VisualDna) => void }) {
    const palette = dna.color?.palette || [];
    const channel = dna.channel ? `通道 ${dna.channel}` : "";
    const confidence = dna.confidence ? { high: "高置信", medium: "中置信", low: "低置信" }[dna.confidence] || dna.confidence : "";
    const [kitName, setKitName] = useState("");
    const [kitNameOpen, setKitNameOpen] = useState(false);
    const saveKit = useBrandKitStore((state) => state.saveKit);

    if (!dna || typeof dna !== "object")
        return (
            <div className="py-8 text-center text-sm opacity-50">暂无视觉DNA</div>
        );

    const updateSummary = (key: keyof VisualDna, summary: string) => {
        const current: Record<string, unknown> = { ...((dna[key] as Record<string, unknown>) || {}) };
        const next: Record<string, unknown> = { ...current, summary };
        if (key === "model") next.present = Boolean(summary) && !summary.startsWith("无");
        onDnaChange({ ...dna, [key]: next });
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                    {dna.source_summary ? <div className="truncate text-sm font-medium">{dna.source_summary}</div> : null}
                    <div className="mt-0.5 flex items-center gap-2 text-xs opacity-60">
                        {channel ? <span>{channel}</span> : null}
                        {confidence ? <span>· {confidence}</span> : null}
                    </div>
                </div>
                {kitNameOpen ? (
                    <Input
                        autoFocus
                        size="small"
                        className="w-36"
                        placeholder="Kit 名称"
                        value={kitName}
                        onChange={(event) => setKitName(event.target.value)}
                        onPressEnter={() => {
                            saveKit(kitName, dna, "");
                            setKitNameOpen(false);
                            setKitName("");
                            message.success("已存为品牌Kit，可在「从Kit加载」中复用");
                        }}
                        onBlur={() => setKitNameOpen(false)}
                    />
                ) : (
                    <Button size="small" icon={<Save className="size-3.5" />} onClick={() => setKitNameOpen(true)}>
                        存为品牌Kit
                    </Button>
                )}
            </div>

            {palette.length ? (
                <div className="flex flex-wrap gap-1.5">
                    {palette.slice(0, 8).map((entry, index) => (
                        <Tooltip key={`${entry.hex}-${index}`} title={`${entry.role || "色"} ${entry.hex}${entry.ratio ? ` · 约${Math.round((entry.ratio || 0) * 100)}%` : ""}（点击复制）`}>
                            <button
                                type="button"
                                className="flex h-8 w-14 items-end rounded-md border border-black/10 p-1 text-[10px] font-medium text-white transition-transform hover:scale-105"
                                style={{ backgroundColor: entry.hex, textShadow: "0 1px 2px rgba(0,0,0,.55)" }}
                                onClick={() => {
                                    void navigator.clipboard.writeText(entry.hex);
                                    message.success(`已复制 ${entry.hex}`);
                                }}
                            >
                                <span className="flex w-full items-center justify-between">
                                    <span>{entry.hex?.slice(1)?.toUpperCase()}</span>
                                    <Copy className="size-2.5 opacity-70" />
                                </span>
                            </button>
                        </Tooltip>
                    ))}
                </div>
            ) : null}

            <div className="space-y-2">
                {DIMENSIONS.map(({ key, label, hint }) => {
                    const summary = dimensionSummary(dna, key);
                    const keywords = dimensionKeywords(dna, key);
                    return (
                        <div key={String(key)} className="rounded-lg border border-border/50 px-2.5 py-2">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-xs font-semibold">{label}</span>
                                <span className="truncate text-[10px] opacity-40">{hint}</span>
                            </div>
                            <Input.TextArea
                                autoSize
                                bordered={false}
                                className="mt-0.5! px-0! text-xs!"
                                value={summary}
                                placeholder="（本维度未提取到内容）"
                                onChange={(event) => updateSummary(key, event.target.value)}
                            />
                            {keywords.length ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {keywords.map((keyword) => (
                                        <Tag key={keyword} className="mr-0! text-[10px]!">
                                            {keyword}
                                        </Tag>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function BrandKitLoader({ onLoad }: { onLoad: (dna: VisualDna, name: string) => void }) {
    const kits = useBrandKitStore((state) => state.kits);
    const removeKit = useBrandKitStore((state) => state.removeKit);
    if (!kits.length) return null;
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs opacity-60">从Kit加载：</span>
            {kits.slice(0, 6).map((kit) => (
                <span key={kit.id} className="inline-flex items-center overflow-hidden rounded-md border border-border/60">
                    <button
                        type="button"
                        className="px-2 py-0.5 text-xs hover:bg-surface-active"
                        onClick={() => onLoad(kit.dna, kit.name)}
                    >
                        {kit.name}
                    </button>
                    <Popconfirm title="删除该品牌Kit？" onConfirm={() => removeKit(kit.id)}>
                        <button type="button" className="border-l border-border/60 px-1 py-0.5 text-xs opacity-50 hover:opacity-100">
                            ×
                        </button>
                    </Popconfirm>
                </span>
            ))}
        </div>
    );
}
