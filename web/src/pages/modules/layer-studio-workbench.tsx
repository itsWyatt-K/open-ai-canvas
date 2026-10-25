/**
 * LayerStudioWorkbench · 通用分层装修工作台（拍板令阶段三：LayerManifest 与电商 slot 解耦）。
 *
 * 脱离电商 slot 独立运行：接收任意 背景 / 透明主体 / 文字 Banner 输入，
 * 组合 nxf live-compose（背景+主体接触阴影+文字 Banner → 合成图）与 psd/export（分层 PSD）。
 * 电商 retouch-dialog.tsx 保留 slot 回写语义；本组件服务直播间装修台等独立场景。
 *
 * 画布交互与电商精修台同款：点击选中主体/文字 → 滑杆调位置缩放 → 框选不适用（用预览即可）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Input, Select, Slider } from "antd";
import { Download, FileImage, Layers3, Plus, Scissors, Type } from "lucide-react";

import { nxfPost, urlToDataUrl } from "@/pages/ecommerce/vision-client";
import type { LiveBannerText, LiveSubject } from "./live-studio-types";

type Props = {
    title: string;
    /** 初始背景（URL 或 dataURL）。 */
    backgroundUrl: string;
    /** 初始透明主体（URL 或 dataURL，可为空）。 */
    initialSubjects?: LiveSubject[];
    /** 初始文字 Banner。 */
    initialBanners?: LiveBannerText[];
    canvasWidth: number;
    canvasHeight: number;
    /** 安全区辅助线（0-1）。 */
    safeTop?: number;
    safeBottom?: number;
    /** 保存回调（拿到各层 PNG 与合成图；由页面决定下载/上传）。 */
    onSave?: (result: { composed: string; background: string; subjects: Array<{ name: string; data_url: string }>; banner?: string; psdBase64?: string }) => Promise<void> | void;
    onClose?: () => void;
};

export function LayerStudioWorkbench({ title, backgroundUrl, initialSubjects, initialBanners, canvasWidth, canvasHeight, safeTop, safeBottom, onSave, onClose }: Props) {
    const { message } = App.useApp();
    const [background, setBackground] = useState(backgroundUrl);
    const [subjects, setSubjects] = useState<LiveSubject[]>(() => (initialSubjects ?? []).slice());
    const [banners, setBanners] = useState<LiveBannerText[]>(() => (initialBanners ?? []).slice());
    const [composed, setComposed] = useState("");
    const [psdBase64, setPsdBase64] = useState("");
    const [busy, setBusy] = useState("");
    const [selected, setSelected] = useState<{ kind: "subject" | "text"; index: number } | null>(null);
    const bgRef = useRef<HTMLImageElement | null>(null);

    useEffect(() => {
        const image = new Image();
        image.onload = () => { bgRef.current = image; };
        image.src = background;
    }, [background]);

    const patchSubject = useCallback((index: number, patch: Partial<LiveSubject>) => {
        setSubjects((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
    }, []);
    const patchBanner = useCallback((index: number, patch: Partial<LiveBannerText>) => {
        setBanners((prev) => prev.map((b, i) => (i === index ? { ...b, ...patch } : b)));
    }, []);

    const addSubjectFromFile = useCallback(async (file: File, name?: string) => {
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("读取失败"));
            reader.readAsDataURL(file);
        });
        setSubjects((prev) => [...prev, { image: dataUrl, name: name || file.name.replace(/\.[^.]+$/, ""), x: 0.5, y: 0.6, scale: 0.5, shadow: true }]);
        message.success("主体/贴片已加入图层");
    }, [message]);

    const mattingFromUpload = useCallback(async (file: File) => {
        // 商品原图 → BiRefNet 透明主体（画布上传即抠）。
        setBusy("matting");
        try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error("读取失败"));
                reader.readAsDataURL(file);
            });
            const result = await nxfPost<{ cutout_png: string; degraded: boolean }>("/api/v1/ecommerce/vision/matting", { image: dataUrl, feather_px: 2 });
            if (!result.ok) throw new Error(result.error || "抠图失败");
            setSubjects((prev) => [...prev, { image: result.cutout_png, name: file.name.replace(/\.[^.]+$/, ""), x: 0.5, y: 0.6, scale: 0.5, shadow: true }]);
            message.success(result.degraded ? "已用兜底档抠图" : "透明主体已生成（BiRefNet）");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "抠图失败");
        } finally {
            setBusy("");
        }
    }, [message]);

    const compose = useCallback(async () => {
        setBusy("compose");
        try {
            const result = await nxfPost<{ composed_png: string; banner_png?: string; psd_base64?: string; psd_bytes?: number; width?: number; height?: number }>(
                "/api/v1/ecommerce/vision/live-compose",
                {
                    background, export_psd: true, filename: "live-studio",
                    subjects: subjects.map((s) => ({ image: s.image, name: s.name, x: s.x, y: s.y, scale: s.scale, shadow: s.shadow })),
                    banners,
                },
            );
            if (!result.ok) throw new Error(result.error || "合成失败");
            setComposed(result.composed_png || "");
            setPsdBase64(result.psd_base64 || "");
            message.success(`合成完成（${result.width}x${result.height}${result.psd_bytes ? `，PSD ${(result.psd_bytes / 1024 / 1024).toFixed(1)}MB` : ""}）`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "合成失败");
        } finally {
            setBusy("");
        }
    }, [background, subjects, banners, message]);

    const handleSave = useCallback(async () => {
        if (!composed) {
            message.info("先点「合成预览」生成合成图");
            return;
        }
        if (onSave) {
            await onSave({
                composed, background,
                subjects: subjects.map((s, i) => ({ name: s.name || `主体层 ${i + 1}`, data_url: s.image })),
                banner: banners.length ? composed : undefined,
                psdBase64,
            });
            return;
        }
        // 默认：下载 PNG 与 PSD。
        const pngAnchor = document.createElement("a");
        pngAnchor.href = composed;
        pngAnchor.download = "live-studio.png";
        pngAnchor.click();
        if (psdBase64) {
            const psdAnchor = document.createElement("a");
            psdAnchor.href = "data:application/x-photoshop;base64," + psdBase64;
            psdAnchor.download = "live-studio.psd";
            psdAnchor.click();
        }
        message.success("已导出 PNG" + (psdBase64 ? " 与分层 PSD" : ""));
    }, [composed, psdBase64, banners.length, subjects, background, onSave, message]);

    const scaleValue = selected?.kind === "subject" ? subjects[selected.index].scale : 0.5;
    const selectedLabel = selected
        ? selected.kind === "subject"
            ? subjects[selected.index]?.name || `主体 ${selected.index + 1}`
            : `文字 ${selected.index + 1}`
        : "未选中";

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="flex items-center gap-1.5 text-sm"><Layers3 className="size-4" /> {title}</strong>
                <div className="flex flex-wrap items-center gap-1.5">
                    <label className="cursor-pointer rounded border border-border/50 px-2 py-1 text-xs hover:border-primary/50">
                        上传背景
                        <input type="file" accept="image/*" className="sr-only" onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void urlToDataUrl(URL.createObjectURL(file)).then((data) => { setBackground(data); event.target.value = ""; });
                        }} />
                    </label>
                    <label className="cursor-pointer rounded border border-border/50 px-2 py-1 text-xs hover:border-primary/50">
                        <Scissors className="mr-1 inline size-3" />上传商品原图并抠图
                        <input type="file" accept="image/*" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void mattingFromUpload(file); event.target.value = ""; }} />
                    </label>
                    <Button size="small" type="primary" loading={busy === "compose"} onClick={() => void compose()}>合成预览</Button>
                    <Button size="small" icon={<Download className="size-3.5" />} disabled={!composed} onClick={() => void handleSave()}>导出</Button>
                    {onClose ? <Button size="small" onClick={onClose}>关闭</Button> : null}
                </div>
            </div>

            <div className="flex gap-3">
                {/* 画布预览：安全区辅助线 + 合成图/图层叠放 */}
                <div className="relative min-w-0 flex-1 select-none overflow-hidden rounded-lg bg-surface-active">
                    <img src={composed || background} alt={title} className="mx-auto block max-h-[68vh] w-auto max-w-full" draggable={false} />
                    {typeof safeTop === "number" && !composed ? (
                        <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-amber-400/60" style={{ top: `${safeTop * 100}%` }}>
                            <span className="absolute left-1 top-0.5 rounded bg-amber-400/80 px-1 text-[9px] text-black">顶部安全区</span>
                        </div>
                    ) : null}
                    {typeof safeBottom === "number" && !composed ? (
                        <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-amber-400/60" style={{ top: `${(1 - safeBottom) * 100}%` }}>
                            <span className="absolute left-1 top-0.5 rounded bg-amber-400/80 px-1 text-[9px] text-black">底部互动区</span>
                        </div>
                    ) : null}
                </div>

                {/* 右侧：图层与属性 */}
                <div className="flex w-[320px] shrink-0 flex-col gap-2.5">
                    <div className="rounded-lg border border-border/50 p-2.5">
                        <p className="mb-1.5 text-xs font-semibold text-foreground/70">图层（自上而下）</p>
                        {banners.map((banner, index) => (
                            <button key={`t${index}`} className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${selected?.kind === "text" && selected.index === index ? "bg-primary/10 text-primary" : "hover:bg-surface-active"}`} onClick={() => setSelected({ kind: "text", index })}>
                                <span className="truncate">🔤 {banner.text.slice(0, 12) || `文字 ${index + 1}`}</span>
                                <span className="text-[10px] opacity-50" onClick={(event) => { event.stopPropagation(); setBanners((prev) => prev.filter((_, i) => i !== index)); }}>✕</span>
                            </button>
                        ))}
                        {subjects.map((subject, index) => (
                            <button key={`s${index}`} className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs ${selected?.kind === "subject" && selected.index === index ? "bg-primary/10 text-primary" : "hover:bg-surface-active"}`} onClick={() => setSelected({ kind: "subject", index })}>
                                <span className="truncate">📦 {subject.name || `主体 ${index + 1}`}</span>
                                <span className="text-[10px] opacity-50" onClick={(event) => { event.stopPropagation(); setSubjects((prev) => prev.filter((_, i) => i !== index)); }}>✕</span>
                            </button>
                        ))}
                        <button className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-foreground/60 hover:bg-surface-active" onClick={() => setBanners((prev) => [...prev, { text: "新文字", font_size: 88, color: "#FFE066", bold: true, font: "", stroke_color: "#7A1010", stroke_width: 5, shadow_blur: 6, shadow_offset_x: 0, shadow_offset_y: 5, shadow_opacity: 0.5, shadow_color: "#000000", x: 0.5, y: 0.25, align: "center", line_spacing: 1.25 }])}>
                            <Plus className="size-3.5" /> 文字 Banner
                        </button>
                    </div>

                    {selected?.kind === "subject" && subjects[selected.index] ? (
                        <div className="flex flex-col gap-2 rounded-lg border border-border/50 p-2.5 text-xs">
                            <strong className="text-foreground/75">主体：{selectedLabel}</strong>
                            <label className="flex items-center gap-2">位置 X<Slider className="flex-1" min={0} max={1} step={0.01} value={subjects[selected.index].x} onChange={(v) => patchSubject(selected.index, { x: v })} /></label>
                            <label className="flex items-center gap-2">位置 Y<Slider className="flex-1" min={0} max={1} step={0.01} value={subjects[selected.index].y} onChange={(v) => patchSubject(selected.index, { y: v })} /></label>
                            <label className="flex items-center gap-2">缩放<Slider className="flex-1" min={0.05} max={2} step={0.01} value={subjects[selected.index].scale} onChange={(v) => patchSubject(selected.index, { scale: v })} /><span className="w-10 text-right tabular-nums">{Math.round(scaleValue * 100)}%</span></label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={subjects[selected.index].shadow} onChange={(e) => patchSubject(selected.index, { shadow: e.target.checked })} />接触阴影</label>
                        </div>
                    ) : null}

                    {selected?.kind === "text" && banners[selected.index] ? (
                        <div className="flex flex-col gap-2 rounded-lg border border-border/50 p-2.5 text-xs">
                            <strong className="text-foreground/75">文字：{selectedLabel}</strong>
                            <Input size="small" value={banners[selected.index].text} onChange={(e) => patchBanner(selected.index, { text: e.target.value })} placeholder="Banner 文案" />
                            <div className="flex items-center gap-2">
                                <input type="color" value={banners[selected.index].color} onChange={(e) => patchBanner(selected.index, { color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-border/50 bg-transparent" aria-label="文字颜色" />
                                <Type className="size-3.5 text-foreground/50" />
                                <Slider className="flex-1" min={24} max={400} step={4} value={banners[selected.index].font_size} onChange={(v) => patchBanner(selected.index, { font_size: v })} />
                                <span className="w-10 text-right tabular-nums">{banners[selected.index].font_size}</span>
                            </div>
                            <label className="flex items-center gap-2">描边宽<Slider className="flex-1" min={0} max={20} step={1} value={banners[selected.index].stroke_width} onChange={(v) => patchBanner(selected.index, { stroke_width: v })} />
                                <input type="color" value={banners[selected.index].stroke_color} onChange={(e) => patchBanner(selected.index, { stroke_color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-border/50 bg-transparent" aria-label="描边颜色" />
                            </label>
                            <label className="flex items-center gap-2">投影<Slider className="flex-1" min={0} max={30} step={1} value={banners[selected.index].shadow_blur} onChange={(v) => patchBanner(selected.index, { shadow_blur: v })} />
                                <input type="checkbox" checked={banners[selected.index].bold} onChange={(e) => patchBanner(selected.index, { bold: e.target.checked })} />加粗
                            </label>
                            <div className="flex items-center gap-2">
                                位置 X<Slider className="flex-1" min={0} max={1} step={0.01} value={banners[selected.index].x} onChange={(v) => patchBanner(selected.index, { x: v })} />
                                Y<Slider className="flex-1" min={0} max={1} step={0.01} value={banners[selected.index].y} onChange={(v) => patchBanner(selected.index, { y: v })} />
                            </div>
                        </div>
                    ) : null}

                    <p className="text-[10px] leading-4 text-foreground/40">
                        画布 {canvasWidth}x{canvasHeight} · 文字 Banner 由 nxf Pillow 光栅化（描边/投影/多行），合成走 alpha 分层，导出 PSD 保留每层。
                    </p>
                </div>
            </div>
        </div>
    );
}
