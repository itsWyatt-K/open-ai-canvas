// ⚠️⚠️ 未挂载组件（防呆警告 · 2026-10-15）⚠️⚠️
// 本文件当前【没有任何路由或组件引用】——`/ecommerce/:view` 的 index.tsx 不读 view 参数，
// 因此即使访问 /ecommerce/{name} 渲染的仍是同一个三栏页，本组件永不显示。
// 2026-10-15 事故：M2 曾把「后端编排生成」按钮加在本文件，导致主人实测看不到任何入口。
// 铁律：**不要在本文件新增任何用户功能**。要加功能请改真实渲染路径上的组件：
//   router.tsx → pages/ecommerce/index.tsx → { task-list, task-detail, config-panel }
// 若要让本组件真正可用，必须先改 index.tsx 读取 view 参数并挂载，然后删掉这段警告。

import { Loader2, Sparkles } from "lucide-react";
import { Button, Empty, Input, Popconfirm, Select, Tag, message } from "antd";
import { useState } from "react";

import { VisualDnaPanel } from "@/components/canvas/visual-dna-panel";
import { analyzeVisualDna, nodeImageDataUrl } from "@/services/api/visual-dna";
import { useBrandKitStore } from "@/stores/canvas/use-brand-kit-store";
import { useEcommerceStore } from "@/stores/canvas/use-ecommerce-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { VisualDna } from "@/services/api/visual-dna";

/**
 * 风格锻造页：参考图（画布资产/产品库图/上传）→ 视觉DNA九维度分析 → 微调 → 存为品牌Kit。
 * DNA 引擎：nxf /visual-dna/analyze（VLM 反重力 gemini-3.8-flash-high；地区受限时提示切节点或用缓存）。
 */

export function StyleforgeView() {
    const products = useEcommerceStore((state) => state.products);
    const kits = useBrandKitStore((state) => state.kits);
    const saveKit = useBrandKitStore((state) => state.saveKit);
    const removeKit = useBrandKitStore((state) => state.removeKit);
    const [source, setSource] = useState<{ kind: "product"; id: string } | { kind: "upload"; dataUrl: string } | null>(null);
    const [dna, setDna] = useState<VisualDna | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [brief, setBrief] = useState("");
    const [kitName, setKitName] = useState("");

    const runAnalyze = async () => {
        if (!source) return message.warning("请先选择风格参考图");
        setAnalyzing(true);
        try {
            let dataUrl: string;
            if (source.kind === "upload") {
                dataUrl = source.dataUrl;
            } else {
                const product = products.find((item) => item.id === source.id);
                const node: Pick<CanvasNodeData, "metadata"> = {
                    metadata: { content: product?.imageUrl || "", storageKey: product?.imageStorageKey } as CanvasNodeData["metadata"],
                };
                dataUrl = await nodeImageDataUrl(node as CanvasNodeData);
            }
            const result = await analyzeVisualDna(dataUrl, brief);
            setDna(result.dna);
            message.success(`视觉DNA分析完成（${result.channel}）`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "视觉DNA分析失败");
        } finally {
            setAnalyzing(false);
        }
    };

    const saveAsKit = () => {
        if (!dna) return;
        if (!kitName.trim()) return message.warning("请填写 Kit 名称");
        saveKit(kitName.trim(), dna, "");
        setKitName("");
        message.success("已存为品牌Kit，可在批量生产与产品库中挂载");
    };

    return (
        <div className="ecommerce-styleforge-view">
            <div className="ecommerce-panel-col">
                <section className="ecommerce-section">
                    <h3><Sparkles className="size-4" /> 1 · 风格参考图</h3>
                    <Select
                        className="w-full"
                        placeholder="从产品库图选，或上传新参考图"
                        value={source?.kind === "product" ? source.id : undefined}
                        onChange={(value) => setSource({ kind: "product", id: value })}
                        options={products.filter((item) => item.imageUrl).map((item) => ({ value: item.id, label: `${item.name}（产品图）` }))}
                        notFoundContent="产品库暂无图片，先去产品库建产品或直接上传"
                    />
                    <label className="ecommerce-upload-box mt-2">
                        <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            hidden
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => setSource({ kind: "upload", dataUrl: String(reader.result) });
                                reader.readAsDataURL(file);
                            }}
                        />
                        <span className="text-xs opacity-60">{source?.kind === "upload" ? "已选上传图 ✓（点击可更换）" : "或点击上传参考图（大牌详情页/海报/竞品视觉）"}</span>
                    </label>
                    <Input.TextArea className="mt-2" rows={2} placeholder="目标产品简报（可选，帮助 VLM 理解迁移语境）" value={brief} onChange={(event) => setBrief(event.target.value)} />
                    <Button className="mt-2" type="primary" block icon={analyzing ? <Loader2 className="size-4 animate-spin" /> : undefined} disabled={!source || analyzing} onClick={() => void runAnalyze()}>
                        {analyzing ? "分析中…（约 20-40 秒）" : "分析视觉DNA"}
                    </Button>
                </section>

                <section className="ecommerce-section">
                    <h3>品牌Kit 库（{kits.length}）</h3>
                    {kits.length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="分析完成后「存为品牌Kit」" />
                    ) : (
                        <div className="space-y-2">
                            {kits.map((kit) => (
                                <div key={kit.id} className="ecommerce-kit-card">
                                    <div className="flex items-center justify-between gap-2">
                                        <strong className="truncate text-xs">{kit.name}</strong>
                                        <Popconfirm title="删除该 Kit？" onConfirm={() => removeKit(kit.id)}>
                                            <Button size="small" type="text" danger>删除</Button>
                                        </Popconfirm>
                                    </div>
                                    <div className="mt-1.5 flex overflow-hidden rounded">
                                        {(kit.dna.color?.palette || []).slice(0, 6).filter((entry) => entry.hex).map((entry, index) => (
                                            <span key={index} className="h-3.5 flex-1" style={{ backgroundColor: entry.hex }} />
                                        ))}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {(kit.dna.mood?.keywords || []).slice(0, 4).map((keyword) => (
                                            <Tag key={keyword} className="mr-0! text-[10px]!">{keyword}</Tag>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            <div className="ecommerce-dna-col">
                {dna ? (
                    <>
                        <div className="mb-2 flex items-center gap-2">
                            <Input placeholder="Kit 名称（如 YUANQI·新中式山水）" value={kitName} className="max-w-64" onChange={(event) => setKitName(event.target.value)} />
                            <Button type="primary" onClick={saveAsKit}>存为品牌Kit</Button>
                        </div>
                        <VisualDnaPanel dna={dna} onDnaChange={setDna} />
                    </>
                ) : (
                    <div className="ecommerce-empty h-full">
                        <Empty description="左侧选参考图并点击「分析视觉DNA」；九维度结果可逐条微调后存为品牌Kit" />
                    </div>
                )}
            </div>
        </div>
    );
}
