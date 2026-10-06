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

export async function exportLayeredPsd(layers: Array<{ name: string; dataUrl: string }>, width: number, height: number, filename: string): Promise<Blob> {
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
