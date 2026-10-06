import { Layers3, Trash2 } from "lucide-react";
import { Popconfirm, Tooltip } from "antd";

import type { VisualDna } from "@/services/api/visual-dna";
import { useBrandKitStore } from "@/stores/canvas/use-brand-kit-store";

/**
 * 资产库 · 品牌Kit区块：展示视觉DNA品牌Kit（色板 + 关键词），风格锻造向导内可加载复用。
 * Kit 生成入口在画布「风格锻造」向导第三步（存为品牌Kit）。
 */

function kitPalette(dna: VisualDna) {
    return (dna.color?.palette || []).filter((entry) => entry.hex).slice(0, 6);
}

function kitKeywords(dna: VisualDna) {
    return [...(dna.mood?.keywords || []), ...(dna.texture?.keywords || [])].filter(Boolean).slice(0, 4);
}

export function BrandKitsSection() {
    const kits = useBrandKitStore((state) => state.kits);
    const removeKit = useBrandKitStore((state) => state.removeKit);
    if (!kits.length) return null;
    return (
        <section className="brand-kits-section mt-3 rounded-xl border border-border/50 p-3" aria-label="品牌Kit">
            <div className="flex items-center gap-2 text-sm font-medium">
                <Layers3 className="size-4" />
                品牌Kit
                <span className="text-xs font-normal opacity-50">视觉DNA预设 · 画布「风格锻造」向导中加载，批量出图风格锁死</span>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {kits.map((kit) => (
                    <div key={kit.id} className="rounded-lg border border-border/50 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 truncate text-xs font-semibold">{kit.name}</div>
                            <Popconfirm title="删除该品牌Kit？" onConfirm={() => removeKit(kit.id)}>
                                <button type="button" aria-label={`删除 ${kit.name}`} className="opacity-40 transition-opacity hover:opacity-100">
                                    <Trash2 className="size-3.5" />
                                </button>
                            </Popconfirm>
                        </div>
                        <div className="mt-1.5 flex overflow-hidden rounded">
                            {kitPalette(kit.dna).map((entry, index) => (
                                <Tooltip key={`${kit.id}-${index}`} title={`${entry.role || "色"} ${entry.hex}`}>
                                    <span className="h-4 flex-1" style={{ backgroundColor: entry.hex }} />
                                </Tooltip>
                            ))}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] opacity-60">
                            {kitKeywords(kit.dna).map((keyword) => (
                                <span key={keyword} className="rounded border border-border/50 px-1">
                                    {keyword}
                                </span>
                            ))}
                            <span className="ml-auto">{new Date(kit.createdAt).toLocaleDateString()}</span>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
