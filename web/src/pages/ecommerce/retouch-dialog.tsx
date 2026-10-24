/**
 * 图层精修弹窗（电商实战升级 · 阶段三 Step 4 MVP）。
 *
 * 四层结构（文字层 / 商品主体层 / 光影阴影层 / 背景层）+ 小白四工具：
 *   ✂️ 精细抠图（nxf matting，重提商品主体）
 *   🪄 魔棒消除/局部重绘（框选区域 → nxf inpaint-erase）
 *   💡 智能重打光（nxf relight-compose，六向光源 + 接触阴影）
 *   🔤 文字与角标（独立文字层，双击改字；彻底告别 AI 文字乱码）
 *
 * 导出：合成高清 PNG / 分层 PSD（复用 nxf /api/nxf/psd/export）。
 * 精修结果（四层清单）回写后端 layer_manifest（PUT /ecommerce/slots/:id/layers）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Select } from "antd";
import { Eraser, Lightbulb, Scissors, Type, Download, Layers } from "lucide-react";

import {
    ECOMMERCE_LAYOUT_LABELS,
    saveEcommerceSlotLayers,
    type EcommerceLayerManifest,
    type EcommerceSlotSummary,
    type EcommerceTextLayer,
} from "@/services/api/ecommerce";
import { AppModal } from "@/components/ui/product/app-modal";

const NXF_BASE = (import.meta.env.VITE_NXF_BASE as string | undefined) ?? "http://127.0.0.1:8823";

const LIGHT_OPTIONS = [
    { label: "左上光", value: "left-top" },
    { label: "右上光", value: "right-top" },
    { label: "顶光", value: "top" },
    { label: "影棚光", value: "studio" },
    { label: "左下光", value: "left-bottom" },
    { label: "右下光", value: "right-bottom" },
];

type Props = {
    slot: EcommerceSlotSummary;
    productSourceResourceId: string;
    onClose: () => void;
    onChanged: () => void | Promise<void>;
};

async function nxfPost<T>(path: string, body: unknown): Promise<T & { ok: boolean; error?: string }> {
    const response = await fetch(NXF_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`引擎 ${path} 返回 ${response.status}`);
    return (await response.json()) as T & { ok: boolean; error?: string };
}

async function urlToDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

export function EcommerceRetouchDialog({ slot, productSourceResourceId, onClose, onChanged }: Props) {
    const { message } = App.useApp();
    const [manifest, setManifest] = useState<EcommerceLayerManifest>(() => ({
        background_layer_url: slot.layerManifest?.background_layer_url ?? "",
        shadow_layer_url: slot.layerManifest?.shadow_layer_url ?? "",
        product_cutout_url: slot.layerManifest?.product_cutout_url ?? "",
        product_rect: slot.layerManifest?.product_rect ?? [0, 0, 0, 0],
        text_layers: slot.layerManifest?.text_layers?.slice() ?? [],
        composed_image_url: slot.layerManifest?.composed_image_url ?? "",
    }));
    const composedImage = manifest.composed_image_url || (slot.resourceId ? `/api/resources/${slot.resourceId}/file` : "");
    const [busy, setBusy] = useState<string>("");
    const [light, setLight] = useState("studio");
    const [selectedLayer, setSelectedLayer] = useState("text");
    // 框选蒙版（相对坐标 0-1）。
    const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
    const drawingRef = useRef<{ x: number; y: number } | null>(null);
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const imgRef = useRef<HTMLImageElement | null>(null);

    useEffect(() => {
        if (!composedImage) return;
        const image = new Image();
        image.onload = () => setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
        image.src = composedImage;
        imgRef.current = image;
    }, [composedImage]);

    const patchManifest = useCallback((patch: Partial<EcommerceLayerManifest>) => {
        setManifest((prev) => ({ ...prev, ...patch }));
    }, []);

    // ---------------- ✂️ 一键重抠（商品主体层） ----------------
    const handleMatting = useCallback(async () => {
        if (!productSourceResourceId) {
            message.error("缺少商品原图资源");
            return;
        }
        setBusy("matting");
        try {
            const source = await urlToDataUrl(`/api/resources/${productSourceResourceId}/file`);
            const result = await nxfPost<{ cutout_png: string; mask_png: string; degraded: boolean; note?: string }>(
                "/api/v1/ecommerce/vision/matting",
                { image: source, feather_px: 2 },
            );
            if (!result.ok) throw new Error(result.error || "抠图失败");
            patchManifest({ product_cutout_url: result.cutout_png });
            message.success(result.degraded ? "已用兜底档抠图（放置 BiRefNet 权重后自动升级）" : "商品主体已重新提取");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "抠图失败");
        } finally {
            setBusy("");
        }
    }, [productSourceResourceId, patchManifest, message]);

    // ---------------- 🪄 魔棒消除（框选 → 无痕擦除） ----------------
    const handleErase = useCallback(async () => {
        if (!rect || !composedImage) {
            message.info("先在图上拖出一个框选区域");
            return;
        }
        setBusy("erase");
        try {
            const image = await urlToDataUrl(composedImage);
            // 相对框选 → 全尺寸白底黑底蒙版 PNG。
            const canvas = document.createElement("canvas");
            canvas.width = imageSize.width;
            canvas.height = imageSize.height;
            const context = canvas.getContext("2d")!;
            context.fillStyle = "#000";
            context.fillRect(0, 0, canvas.width, canvas.height);
            const x = Math.min(rect.x0, rect.x1) * canvas.width;
            const y = Math.min(rect.y0, rect.y1) * canvas.height;
            const w = Math.abs(rect.x1 - rect.x0) * canvas.width;
            const h = Math.abs(rect.y1 - rect.y0) * canvas.height;
            context.fillStyle = "#fff";
            context.fillRect(x, y, w, h);
            const mask = canvas.toDataURL("image/png");
            const result = await nxfPost<{ result_png: string }>("/api/v1/ecommerce/vision/inpaint-erase", {
                image, mask, mode: "erase",
            });
            if (!result.ok) throw new Error(result.error || "擦除失败");
            patchManifest({ composed_image_url: result.result_png, background_layer_url: result.result_png });
            setRect(null);
            message.success("已无痕擦除选中区域");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "擦除失败");
        } finally {
            setBusy("");
        }
    }, [rect, composedImage, imageSize, patchManifest, message]);

    // ---------------- 💡 智能重打光（锁主体合成） ----------------
    const handleRelight = useCallback(async () => {
        if (!manifest.product_cutout_url) {
            message.info("先执行「一键抠图」得到商品主体层，再重打光");
            return;
        }
        if (!composedImage) {
            message.error("缺少底图");
            return;
        }
        setBusy("relight");
        try {
            const background = await urlToDataUrl(composedImage);
            const result = await nxfPost<{ composed_png: string; shadow_layer_png: string; placement: { center: number[] } }>(
                "/api/v1/ecommerce/vision/relight-compose",
                {
                    product_cutout: manifest.product_cutout_url,
                    background,
                    light,
                    position: { x: 0.5, y: 0.55, scale: 0.6 },
                },
            );
            if (!result.ok) throw new Error(result.error || "重打光失败");
            const [cx, cy] = result.placement.center;
            patchManifest({
                composed_image_url: result.composed_png,
                shadow_layer_url: result.shadow_layer_png,
                product_rect: [cx / imageSize.width, cy / imageSize.height, 0.5, 0.5],
            });
            message.success("已按新光源完成锁主体融合");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "重打光失败");
        } finally {
            setBusy("");
        }
    }, [manifest.product_cutout_url, composedImage, light, imageSize, patchManifest, message]);

    // ---------------- 🔤 文字层 ----------------
    const patchTextLayer = useCallback((index: number, patch: Partial<EcommerceTextLayer>) => {
        setManifest((prev) => {
            const layers = prev.text_layers.slice();
            layers[index] = { ...layers[index], ...patch };
            return { ...prev, text_layers: layers };
        });
    }, []);
    const addTextLayer = useCallback(() => {
        setManifest((prev) => ({
            ...prev,
            text_layers: [...prev.text_layers, { text: "双击改字", color: "#E02020", x: 0.5, y: 0.12, size: 64 }],
        }));
    }, []);

    // ---------------- 保存与导出 ----------------
    const handleSave = useCallback(async () => {
        try {
            await saveEcommerceSlotLayers(slot.id, manifest);
            message.success("四层清单已保存");
            await onChanged();
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        }
    }, [slot.id, manifest, onChanged, onClose, message]);

    const handleExportPng = useCallback(() => {
        if (!manifest.composed_image_url) {
            message.info("尚无合成图可导出");
            return;
        }
        const anchor = document.createElement("a");
        anchor.href = manifest.composed_image_url;
        anchor.download = `${slot.slotKey}-v${slot.currentVersion}.png`;
        anchor.click();
    }, [manifest.composed_image_url, slot, message]);

    const handleExportPsd = useCallback(async () => {
        setBusy("psd");
        try {
            // 文字层渲染成独立 PNG 图层（canvas 绘制，粗排版即可保住「可改字」语义）。
            const textLayerImages = await Promise.all(
                manifest.text_layers.map(async (layer) => {
                    const canvas = document.createElement("canvas");
                    canvas.width = imageSize.width || 1024;
                    canvas.height = imageSize.height || 1024;
                    const context = canvas.getContext("2d")!;
                    context.fillStyle = layer.color || "#E02020";
                    context.font = `${layer.size || 64}px sans-serif`;
                    context.textAlign = "center";
                    context.fillText(layer.text, layer.x * canvas.width, layer.y * canvas.height);
                    return { name: `文字层-${layer.text.slice(0, 8)}`, data_url: canvas.toDataURL("image/png") };
                }),
            );
            const layers = [
                ...(manifest.background_layer_url ? [{ name: "背景层", data_url: await urlToDataUrl(manifest.background_layer_url) }] : []),
                ...(manifest.shadow_layer_url ? [{ name: "阴影光效层", data_url: await urlToDataUrl(manifest.shadow_layer_url) }] : []),
                ...(manifest.product_cutout_url ? [{ name: "商品主体层", data_url: manifest.product_cutout_url }] : []),
                ...textLayerImages,
            ];
            if (layers.length === 0) throw new Error("还没有任何图层（先抠图或擦除）");
            const response = await fetch(`${NXF_BASE}/api/nxf/psd/export`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ layers, width: imageSize.width || 1024, height: imageSize.height || 1024, filename: `${slot.slotKey}-v${slot.currentVersion}` }),
            });
            if (!response.ok) throw new Error(`PSD 导出失败（${response.status}）`);
            const blob = await response.blob();
            const anchor = document.createElement("a");
            anchor.href = URL.createObjectURL(blob);
            anchor.download = `${slot.slotKey}-v${slot.currentVersion}.psd`;
            anchor.click();
            message.success("分层 PSD 已导出");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "PSD 导出失败");
        } finally {
            setBusy("");
        }
    }, [manifest, imageSize, slot, message]);

    const relativeHandlers = useMemo(() => ({
        onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            drawingRef.current = { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
            setRect({ x0: drawingRef.current.x, y0: drawingRef.current.y, x1: drawingRef.current.x, y1: drawingRef.current.y });
        },
        onMouseMove: (event: React.MouseEvent<HTMLDivElement>) => {
            if (!drawingRef.current) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
            const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
            setRect((prev) => (prev ? { ...prev, x1: x, y1: y } : prev));
        },
        onMouseUp: () => { drawingRef.current = null; },
    }), []);

    const rectStyle = rect ? {
        left: `${Math.min(rect.x0, rect.x1) * 100}%`,
        top: `${Math.min(rect.y0, rect.y1) * 100}%`,
        width: `${Math.abs(rect.x1 - rect.x0) * 100}%`,
        height: `${Math.abs(rect.y1 - rect.y0) * 100}%`,
    } : undefined;

    return (
        <AppModal
            open
            title={`图层精修 · ${slot.title || slot.slotKey}`}
            width={1080}
            onCancel={onClose}
            footer={
                <div className="flex w-full flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                        <Button size="small" icon={<Download className="size-3.5" />} onClick={handleExportPng}>导出合成 PNG</Button>
                        <Button size="small" icon={<Layers className="size-3.5" />} loading={busy === "psd"} onClick={() => void handleExportPsd()}>导出分层 PSD</Button>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Button onClick={onClose}>取消</Button>
                        <Button type="primary" onClick={() => void handleSave()}>保存四层清单</Button>
                    </div>
                </div>
            }
        >
            <div className="flex gap-3">
                {/* 画布区：框选消除 + 文字层预览 */}
                <div className="relative min-w-0 flex-1 select-none overflow-hidden rounded-lg bg-surface-active" {...relativeHandlers}>
                    {composedImage ? (
                        <img src={composedImage} alt={slot.title || slot.slotKey} className="block w-full" draggable={false} />
                    ) : (
                        <div className="flex h-72 items-center justify-center text-xs text-foreground/45">该屏尚未出图</div>
                    )}
                    {manifest.text_layers.map((layer, index) => (
                        <span
                            key={index}
                            className="pointer-events-none absolute -translate-x-1/2 whitespace-pre"
                            style={{ left: `${layer.x * 100}%`, top: `${layer.y * 100}%`, color: layer.color || "#E02020", fontSize: Math.max(12, (layer.size || 64) * ((imgRef.current?.clientWidth ?? 600) / (imageSize.width || 600))) }}
                        >
                            {layer.text}
                        </span>
                    ))}
                    {rectStyle ? <div className="pointer-events-none absolute border-2 border-primary bg-primary/15" style={rectStyle} /> : null}
                </div>

                {/* 右侧：图层树 + 工具 + 属性 */}
                <div className="flex w-[340px] shrink-0 flex-col gap-3">
                    <div className="rounded-lg border border-border/50 p-2.5">
                        <p className="mb-1.5 text-xs font-semibold text-foreground/70">图层（自上而下）</p>
                        {[
                            { key: "text", label: `🔤 文字层（${manifest.text_layers.length}）`, has: manifest.text_layers.length > 0 },
                            { key: "product", label: "📦 商品主体层", has: Boolean(manifest.product_cutout_url) },
                            { key: "shadow", label: "✨ 阴影与光效层", has: Boolean(manifest.shadow_layer_url) },
                            { key: "bg", label: "🖼️ 场景背景层", has: Boolean(manifest.background_layer_url) },
                        ].map((layer) => (
                            <button
                                key={layer.key}
                                className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${selectedLayer === layer.key ? "bg-primary/10 text-primary" : "hover:bg-surface-active"} ${layer.has ? "" : "opacity-45"}`}
                                onClick={() => setSelectedLayer(layer.key)}
                            >
                                <span>{layer.label}</span>
                                <span className="text-[10px] text-foreground/40">{layer.has ? "✓" : "未产出"}</span>
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                        <Button size="small" icon={<Scissors className="size-3.5" />} loading={busy === "matting"} onClick={() => void handleMatting()}>
                            一键抠图
                        </Button>
                        <Button size="small" icon={<Eraser className="size-3.5" />} loading={busy === "erase"} onClick={() => void handleErase()}>
                            框选消除
                        </Button>
                        <Select size="small" value={light} options={LIGHT_OPTIONS} onChange={setLight} className="col-span-1" />
                        <Button size="small" icon={<Lightbulb className="size-3.5" />} loading={busy === "relight"} onClick={() => void handleRelight()}>
                            重打光
                        </Button>
                    </div>
                    <p className="text-[10px] leading-4 text-foreground/40">
                        抠图后点「重打光」完成锁主体合成（商品像素 100% 保真）。消除 = 在图上拖框再点按钮。
                    </p>

                    {/* 文字层编辑 */}
                    <div className="flex-1 overflow-y-auto rounded-lg border border-border/50 p-2.5">
                        <div className="mb-1.5 flex items-center justify-between">
                            <p className="text-xs font-semibold text-foreground/70">文字与角标（独立图层）</p>
                            <Button size="small" type="text" icon={<Type className="size-3.5" />} onClick={addTextLayer}>加一条</Button>
                        </div>
                        {manifest.text_layers.length === 0 ? (
                            <p className="text-[11px] text-foreground/40">暂无文字层——比烧图文字更清晰，且随时可改。</p>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {manifest.text_layers.map((layer, index) => (
                                    <div key={index} className="flex flex-col gap-1 rounded bg-surface-active/60 p-1.5">
                                        <Input
                                            size="small"
                                            value={layer.text}
                                            onChange={(event) => patchTextLayer(index, { text: event.target.value })}
                                            placeholder="文案（双击画布可改）"
                                        />
                                        <div className="flex items-center gap-1">
                            <input
                                type="color"
                                value={layer.color || "#E02020"}
                                onChange={(event) => patchTextLayer(index, { color: event.target.value })}
                                className="h-6 w-8 cursor-pointer rounded border border-border/50 bg-transparent"
                                aria-label="文字颜色"
                            />
                                            <Input size="small" type="number" value={layer.size || 64} onChange={(event) => patchTextLayer(index, { size: Number(event.target.value) || 64 })} addonAfter="px" className="flex-1" />
                                            <Button size="small" type="text" danger onClick={() => setManifest((prev) => ({ ...prev, text_layers: prev.text_layers.filter((_, i) => i !== index) }))}>
                                                删
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-1 text-[10px] text-foreground/45">
                                            位置 X
                                            <input type="range" min={0} max={1} step={0.01} value={layer.x} onChange={(event) => patchTextLayer(index, { x: Number(event.target.value) })} className="flex-1" />
                                            Y
                                            <input type="range" min={0} max={1} step={0.01} value={layer.y} onChange={(event) => patchTextLayer(index, { y: Number(event.target.value) })} className="flex-1" />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <p className="text-[10px] text-foreground/35">版式参考：{ECOMMERCE_LAYOUT_LABELS[slot.brief?.layout_type ?? ""] ?? slot.sceneType ?? "—"}</p>
                </div>
            </div>
        </AppModal>
    );
}
