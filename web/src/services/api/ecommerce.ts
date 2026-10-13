// 电商工坊 API 模块（字段与后端 /ecommerce 路由组逐字对应）。
import { http } from "@/services/api/request";

// ---------------------------------------------------------------- 类型

export type EcommerceStatus =
    | "draft"
    | "queued"
    | "running"
    | "review"
    | "failed"
    | "uncertain"
    | "completed"
    | "completed_with_warnings"
    | "paused";

export type EcommerceSlotKind = "hero" | "detail";

export type EcommerceImageSpec = {
    count: number;
    sizePreset: string;
    resolution: string;
    ratio: string;
    width: number;
    height: number;
    textMode: string;
    instruction: string;
};

export type EcommercePromptSets = {
    planningPrompt: string;
    planningRules: string;
    refinementPrompt: string;
    generationPrompt: string;
    generationRules: string;
    titlePrompt: string;
};

export type EcommerceConfig = {
    taskConcurrency: number;
    platform: string;
    market: string;
    language: string;
    titleLanguage: string;
    modelMode: string;
    font: string;
    colorRhythm: string;
    plannerModelId: string;
    imageModelId: string;
    titleModelId: string;
    style: string;
    sellingPoints: string;
    requirements: string;
    forbidden: string;
    hero: EcommerceImageSpec;
    detail: EcommerceImageSpec;
    titleInstruction: string;
    titlePrompt: string;
    titleCount: number;
    titleMaxLength: number;
    mode: string;
    quality: string;
    maxRetries: number;
    timeoutSeconds: number;
    textTimeoutSeconds: number;
    promptSets: EcommercePromptSets;
};

export type EcommercePreset = {
    id: string;
    userId: string;
    name: string;
    config: EcommerceConfig;
    createdAt: string;
    updatedAt: string;
};

export type EcommerceImportItem = { resourceId: string; name: string };

export type EcommerceProductSummary = {
    id: string;
    name: string;
    status: EcommerceStatus;
    statusReason?: string;
    round: number;
    sourceName?: string;
    thumbnailUrl?: string;
    titleStatus: string;
    heroDone: number;
    heroTotal: number;
    detailDone: number;
    detailTotal: number;
    createdAt: string;
};

export type EcommerceSlotSummary = {
    id: string;
    kind: EcommerceSlotKind;
    slotNo: number;
    slotKey: string;
    title?: string;
    copy?: string;
    status: string;
    currentVersion: number;
    resourceId?: string;
    updatedAt: string;
};

export type EcommerceProductDetail = {
    product: {
        id: string;
        name: string;
        status: EcommerceStatus;
        statusReason?: string;
        round: number;
        sourceResourceId: string;
        sourceName?: string;
        sellingPoints: string;
        extraRequirements: string;
        titleStatus: string;
        titleText?: string;
        paused: boolean;
        errorMessage?: string;
        createdAt: string;
        updatedAt: string;
    };
    slots: EcommerceSlotSummary[];
};

// ---------------------------------------------------------------- 函数

export function getEcommerceConfig() {
    return http.get<EcommerceConfig>("/ecommerce/config");
}

export function saveEcommerceConfig(config: EcommerceConfig) {
    return http.put<EcommerceConfig>("/ecommerce/config", config);
}

export function listEcommercePresets() {
    return http.get<{ items: EcommercePreset[] }>("/ecommerce/presets");
}

export function saveEcommercePreset(name: string, config: EcommerceConfig) {
    return http.post<EcommercePreset>("/ecommerce/presets", { name, config });
}

export function deleteEcommercePreset(id: string) {
    return http.delete<{ deleted: boolean }>(`/ecommerce/presets/${encodeURIComponent(id)}`);
}

export function importEcommerceProducts(items: EcommerceImportItem[]) {
    return http.post<{ items: EcommerceProductSummary[]; skipped: string[] }>("/ecommerce/products", { items });
}

export function listEcommerceProducts(query = "", status = "all") {
    const params = new URLSearchParams({ query, status });
    return http.get<{ items: EcommerceProductSummary[]; total: number }>(`/ecommerce/products?${params.toString()}`);
}

export function getEcommerceProductDetail(id: string) {
    return http.get<EcommerceProductDetail>(`/ecommerce/products/${encodeURIComponent(id)}`);
}

export function renameEcommerceProduct(id: string, name: string) {
    return http.patch<{ updated: boolean }>(`/ecommerce/products/${encodeURIComponent(id)}`, { name });
}

export function deleteEcommerceProducts(ids: string[]) {
    return http.post<{ deleted: number; refused: Record<string, string> }>("/ecommerce/products/delete", { ids });
}

// 状态中文映射（与桌面版逐字一致）。
export const ECOMMERCE_STATUS_LABELS: Record<EcommerceStatus, string> = {
    draft: "未开始",
    queued: "排队中",
    running: "进行中",
    review: "待确认方案",
    failed: "失败",
    uncertain: "结果待确认",
    completed: "已完成",
    completed_with_warnings: "图片已完成",
    paused: "已暂停",
};

// 槽位状态中文映射。
export const ECOMMERCE_SLOT_STATUS_LABELS: Record<string, string> = {
    pending: "待生成",
    queued: "排队中",
    refining: "细化中",
    running: "生图中",
    failed: "失败",
    uncertain: "结果待确认",
    completed: "已完成",
};

// 进度摘要（任务卡第二行）：「主图 3/6 · 详情页 1/5 · 标题 ✓」。
export function summarizeProgress(product: EcommerceProductSummary): string {
    const parts: string[] = [];
    if (product.heroTotal > 0) parts.push(`主图 ${product.heroDone}/${product.heroTotal}`);
    if (product.detailTotal > 0) parts.push(`详情页 ${product.detailDone}/${product.detailTotal}`);
    if (product.titleStatus === "completed") parts.push("标题 ✓");
    else if (product.titleStatus === "failed") parts.push("标题 ✗");
    else if (product.titleStatus === "uncertain") parts.push("标题 ？");
    return parts.join(" · ") || "尚未生成";
}
