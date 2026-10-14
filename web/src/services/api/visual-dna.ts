import { imageToDataUrl } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";

/**
 * 风格锻造 · 酿笑坊引擎（nxf :8823）客户端
 * 引擎未启动时给出可操作的错误提示；默认端口 8823，可用 localStorage["nxf-bridge-base"] 覆盖。
 */

const DEFAULT_NXF_BASE = "http://127.0.0.1:8823";

export type VisualDnaPaletteEntry = { hex: string; ratio?: number; role?: string };

export type VisualDna = {
    version?: string;
    source_summary?: string;
    layout?: { summary?: string; keywords?: string[]; notes?: string };
    color?: { summary?: string; palette?: VisualDnaPaletteEntry[]; temperature?: string };
    lighting?: { summary?: string; keywords?: string[] };
    typography?: { summary?: string; title_style?: string; body_style?: string };
    texture?: { summary?: string; keywords?: string[] };
    mood?: { summary?: string; keywords?: string[] };
    model?: { present?: boolean; summary?: string };
    props?: { summary?: string; items?: string[] };
    brand?: { summary?: string; elements?: string[] };
    channel?: string;
    confidence?: string;
    elapsed_ms?: number;
};

export type StyleForgeScene = "style_poster" | "ecom_set" | "city_poster" | "picture_book" | "brand_kit" | "text_ad";

export const STYLE_FORGE_SCENES: Array<{ value: StyleForgeScene; label: string; description: string; aspect: string }> = [
    { value: "style_poster", label: "风格海报 KV", description: "单张品牌风格营销海报", aspect: "3:4" },
    { value: "ecom_set", label: "电商七件套", description: "白底/卖点/场景×2/细节/结构/广告成稿", aspect: "1:1" },
    { value: "city_poster", label: "城市文旅海报", description: "多城市批量，风格统一", aspect: "3:4" },
    { value: "picture_book", label: "儿童绘本", description: "多页主角锁型（P1 定妆→回灌）", aspect: "16:9" },
    { value: "brand_kit", label: "Brand Kit 成稿", description: "按品牌锚点卡锁死风格", aspect: "3:4" },
    { value: "text_ad", label: "文字成稿", description: "文案烧入图内，逐字可控", aspect: "3:4" },
];

export type StyleForgeProduct = {
    name: string;
    anchors: string;
    selling_points: string[];
};

export type StyleForgePrompt = {
    index: number;
    scene: string;
    variant: string;
    aspect: string;
    prompt: string;
    negative: string;
};

export class NxfBridgeError extends Error {}

async function nxfFetch<T>(path: string, body: unknown, timeoutMs = 240_000): Promise<T> {
    const base = (typeof localStorage !== "undefined" && localStorage.getItem("nxf-bridge-base")) || DEFAULT_NXF_BASE;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
        response = await fetch(base.replace(/\/$/, "") + path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        clearTimeout(timer);
        if ((error as Error)?.name === "AbortError") throw new NxfBridgeError("酿笑坊引擎响应超时，请稍后重试");
        throw new NxfBridgeError("连不上酿笑坊引擎（nxf :8823），请先启动引擎（nxf engine_启停脚本或 启动源起 控制台）");
    }
    clearTimeout(timer);
    if (!response.ok) throw new NxfBridgeError(`引擎返回 ${response.status}：${(await response.text()).slice(0, 200)}`);
    const data = (await response.json()) as T & { ok?: boolean; error?: string };
    if (data && data.ok === false) throw new NxfBridgeError(data.error || "引擎处理失败");
    return data;
}

export async function analyzeVisualDna(referenceImage: CanvasNodeData | string, productBrief = "", hint = ""): Promise<{ dna: VisualDna; channel: string; elapsedMs: number }> {
    const dataUrl = typeof referenceImage === "string" ? referenceImage : await nodeImageDataUrl(referenceImage);
    const result = await nxfFetch<{ dna: VisualDna; channel: string; elapsed_ms: number }>("/api/nxf/visual-dna/analyze", {
        reference_image: dataUrl,
        product_brief: productBrief,
        hint,
    });
    return { dna: result.dna, channel: result.channel || "", elapsedMs: result.elapsed_ms || 0 };
}

export async function synthesizeStyleForge(input: {
    dna: VisualDna;
    product: StyleForgeProduct;
    scene: StyleForgeScene;
    size?: string;
    textOverlay?: string[];
    variant?: string;
    variables?: Record<string, unknown>;
    count?: number;
    /** 附加负向词库（品牌/品类防封词，顿号分隔）。 */
    negativeExtra?: string;
}): Promise<{ prompts: StyleForgePrompt[]; anchorCard: string }> {
    const result = await nxfFetch<{ prompts: StyleForgePrompt[]; anchor_card: string }>("/api/nxf/visual-dna/synthesize", {
        dna: input.dna,
        product: input.product,
        scene: input.scene,
        size: input.size || "",
        text_overlay: input.textOverlay || [],
        variant: input.variant || "",
        variables: input.variables || {},
        count: input.count ?? 1,
        negative_extra: input.negativeExtra || "",
    });
    return { prompts: result.prompts, anchorCard: result.anchor_card || "" };
}

export async function batchStyleForge(input: {
    dna: VisualDna;
    product: StyleForgeProduct;
    scenes: StyleForgeScene[];
    sceneParams?: Record<string, Record<string, unknown>>;
}): Promise<{ prompts: StyleForgePrompt[]; anchorCard: string; groups: Array<{ scene: string; label: string; count: number }> }> {
    const result = await nxfFetch<{ prompts: StyleForgePrompt[]; anchor_card: string; groups: Array<{ scene: string; label: string; count: number }> }>("/api/nxf/visual-dna/batch", {
        dna: input.dna,
        product: input.product,
        scenes: input.scenes,
        scene_params: input.sceneParams || {},
    });
    return { prompts: result.prompts, anchorCard: result.anchor_card || "", groups: result.groups || [] };
}

/** 分层 PSD 的单个图层。字段名与引擎契约一致（snake_case `data_url`）。 */
export type PsdLayerInput = {
    name: string;
    data_url: string;
    /** 图层不透明度 0-255，默认 255。 */
    opacity?: number;
    /** 图层可见性，默认 true。 */
    visible?: boolean;
};

/** 电商详情页分层 PSD 的标准图层名：`01_情绪首屏_商品主体`（保留中文语义）。 */
export function psdLayerName(slotIndex: number, slotLabel: string, role: "背景成图" | "背景" | "商品主体" | "文案" | "成图"): string {
    const order = String(Math.max(1, slotIndex)).padStart(2, "0");
    const label = slotLabel.trim().slice(0, 20) || "未命名";
    return `${order}_${label}_${role}`;
}

/**
 * 组装电商详情页分层 PSD（自底向上）。
 *
 * 两种形态：
 *  1. **有商品透明主体层**（后端编排产出）→
 *     [背景成图(可见) · 商品主体(隐藏) · 文案(隐藏)]：
 *     成图与生成结果一致，美工点亮「商品主体」即可替换/挪动商品，点亮「文案」即可改字。
 *  2. **无抠图层** → [背景(可见) · 成图(可见)] 或 [背景成图]：
 *     回退为整图分层，不叠加文案层（成图已含烧入文案，避免双影）。
 *
 * 空层自动跳过；无任何有效层时返回空数组，由调用方决定是否报错。
 */
export function buildEcommercePsdLayers(input: {
    slotIndex?: number;
    slotLabel?: string;
    /** 生成成图（含背景 + 商品 + 可能的烧入文案）→ 作为最底「背景成图」层。 */
    compositeDataUrl?: string;
    /** 纯背景环境层（无商品）；有抠图层时可选。 */
    backgroundDataUrl?: string;
    /** 商品透明主体层（默认隐藏）。 */
    subjectDataUrl?: string;
    /** 文案层（默认隐藏）。 */
    copyDataUrl?: string;
}): PsdLayerInput[] {
    const index = input.slotIndex ?? 1;
    const label = input.slotLabel ?? "详情页";
    const layers: PsdLayerInput[] = [];
    const hasSubject = Boolean(input.subjectDataUrl);
    // 底层：优先用「背景环境层」；无独立背景时用生成成图兜底。
    if (input.backgroundDataUrl) {
        layers.push({ name: psdLayerName(index, label, "背景"), data_url: input.backgroundDataUrl });
    }
    if (input.compositeDataUrl) {
        layers.push({ name: psdLayerName(index, label, "背景成图"), data_url: input.compositeDataUrl });
    }
    if (!layers.length && !hasSubject) return [];
    // 拆层：商品主体 + 文案默认隐藏，成图观感与生成结果一致。
    if (hasSubject) {
        layers.push({ name: psdLayerName(index, label, "商品主体"), data_url: input.subjectDataUrl!, visible: false });
    }
    if (input.copyDataUrl) {
        layers.push({ name: psdLayerName(index, label, "文案"), data_url: input.copyDataUrl, visible: !hasSubject && !input.compositeDataUrl });
    }
    return layers;
}

/**
 * 把文案行渲染成透明文案层（PNG data URL），供美工在 PS 里单独改字。
 * 返回 null 表示无有效文案。字体/描边可按需覆盖。
 */
export async function renderCopyLayer(
    lines: string[],
    width: number,
    height: number,
    options?: { fontSize?: number; color?: string; bottomRatio?: number; align?: CanvasTextAlign },
): Promise<string | null> {
    const text = lines.map((line) => line.trim()).filter(Boolean);
    if (!text.length || width <= 0 || height <= 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const fontSize = options?.fontSize ?? Math.max(18, Math.round(width * 0.045));
    const lineHeight = Math.round(fontSize * 1.45);
    context.font = `600 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    context.fillStyle = options?.color ?? "#ffffff";
    context.textAlign = options?.align ?? "center";
    context.textBaseline = "bottom";
    context.shadowColor = "rgba(0,0,0,0.35)";
    context.shadowBlur = Math.round(fontSize * 0.3);
    const x = context.textAlign === "left" ? Math.round(width * 0.08) : context.textAlign === "right" ? Math.round(width * 0.92) : Math.round(width / 2);
    const bottom = Math.round(height * (options?.bottomRatio ?? 0.92));
    text.forEach((line, indexFromEnd) => {
        const y = bottom - indexFromEnd * lineHeight;
        context.fillText(line, x, y);
    });
    return canvas.toDataURL("image/png");
}

export async function exportLayeredPsd(layers: PsdLayerInput[], width: number, height: number, filename: string): Promise<Blob> {
    const base = (typeof localStorage !== "undefined" && localStorage.getItem("nxf-bridge-base")) || DEFAULT_NXF_BASE;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    let response: Response;
    try {
        response = await fetch(base.replace(/\/$/, "") + "/api/nxf/psd/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ layers, width, height, filename }),
            signal: controller.signal,
        });
    } catch (error) {
        clearTimeout(timer);
        throw new NxfBridgeError("连不上酿笑坊引擎（nxf :8823），无法导出 PSD");
    }
    clearTimeout(timer);
    if (!response.ok) throw new NxfBridgeError(`PSD 导出失败（${response.status}）`);
    return await response.blob();
}

/** 节点图片 → data URL（data: 直用；storageKey 走 IndexedDB；http(s)/相对路径 fetch 拉取）。 */
export async function nodeImageDataUrl(node: CanvasNodeData): Promise<string> {
    const content = String(node.metadata?.content || "");
    if (!content) throw new NxfBridgeError("该节点没有图片内容");
    if (content.startsWith("data:")) return content;
    if (content.startsWith("http:") || content.startsWith("https:") || content.startsWith("/")) {
        try {
            const response = await fetch(content);
            if (!response.ok) throw new Error(String(response.status));
            const blob = await response.blob();
            return await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(new Error("read failed"));
                reader.readAsDataURL(blob);
            });
        } catch {
            throw new NxfBridgeError("图片素材读取失败，请重新上传或替换该图片");
        }
    }
    try {
        return await imageToDataUrl({ dataUrl: content, storageKey: node.metadata?.storageKey });
    } catch {
        throw new NxfBridgeError("图片素材读取失败，请重新上传或替换该图片");
    }
}
