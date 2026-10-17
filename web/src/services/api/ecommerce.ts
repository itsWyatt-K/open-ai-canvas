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
    /** 商品透明主体层资源（三层 PSD 的商品主体层）；为空时前端回退两层导出。 */
    subjectLayerResourceId?: string;
    /** 编排降级标记（如 nxf 不可用已回落上游模板）。 */
    planDegraded?: string[];
};

/** M3 编排器启动参数（channelId + model 必填，服务端不猜测模型）。 */
export type EcommerceStartOptions = {
    presetId?: string;
    channelId: string;
    model: string;
    size?: string;
    quality?: string;
    count?: number;
    slotKeys?: string[];
    projectId?: string;
    /** 是否额外派发「商品透明主体层」任务（三层 PSD 用），默认 true。 */
    withSubjectLayer?: boolean;
    /** 卖点与视觉锚点：导入接口只带名称，编排前需同步落库。 */
    sellingPoints?: string;
    extraRequirements?: string;
};

/** 单槽位派发结果。 */
export type EcommerceSlotDispatch = {
    slotId: string;
    slotKey: string;
    title: string;
    kind: EcommerceSlotKind;
    slotNo: number;
    version: number;
    versionId: string;
    childTaskId?: string;
    status: string;
    prompt: string;
    negative?: string;
    error?: string;
};

/** 启动结果（编排概览 + 降级标记）。 */
export type EcommerceStartResult = {
    productId: string;
    status: EcommerceStatus;
    presetKey?: string;
    presetName?: string;
    anchorCard?: string;
    degraded?: string[];
    slots: EcommerceSlotDispatch[];
    dispatched: number;
    failed: number;
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

/** 启动 M3 编排器：服务端合成各槽位提示词并派发 canvas_image 子任务。 */
export function startEcommerceProduct(id: string, options: EcommerceStartOptions) {
    return http.post<EcommerceStartResult>(`/ecommerce/products/${encodeURIComponent(id)}/start`, options);
}

/** 对账：把子任务终态回写到槽位版本与商品状态。 */
export function syncEcommerceProduct(id: string) {
    return http.post<EcommerceProductDetail>(`/ecommerce/products/${encodeURIComponent(id)}/sync`);
}

/** 单屏可编辑字段（分屏编辑器保存体，与后端 EcommerceSlotPromptPatch 对齐）。 */
export type EcommerceSlotPromptBody = {
    title: string;
    copy: string;
    sceneType: string;
    sellingPoints: string;
    aspectRatio: string;
    prompt: string;
    promptOverride: string;
};

/** 仅保存单屏参数（不派发子任务、不动已生成图）。 */
export function saveEcommerceSlotPrompt(slotId: string, body: EcommerceSlotPromptBody) {
    return http.put<{ ok: boolean }>(`/ecommerce/slots/${encodeURIComponent(slotId)}/prompt`, body);
}

/** 保存并重新生成该屏（version+1；后端强制 confirmCost=true）。 */
export function regenerateEcommerceSlot(slotId: string, body: EcommerceSlotPromptBody) {
    return http.post<{ ok: boolean }>(`/ecommerce/slots/${encodeURIComponent(slotId)}/regenerate`, { ...body, confirmCost: true });
}

/** 审核模式确认整组方案：review → running 并派发所有待生成槽位。 */
export function confirmEcommercePlan(id: string) {
    return http.post<EcommerceProductDetail>(`/ecommerce/products/${encodeURIComponent(id)}/confirm-plan`);
}

/** 暂停派发（在途子任务不取消）。 */
export function pauseEcommerceProduct(id: string) {
    return http.post<{ id: string; status: string }>(`/ecommerce/products/${encodeURIComponent(id)}/pause`);
}

/** AI 策划轨：派发一次视觉文本策划任务（不直接出图）。 */
export function startEcommercePlanning(id: string, options: { channelId: string; model: string; styleReferenceIds?: string[] }) {
    return http.post<{ productId: string; taskId: string; screens: number; message?: string }>(
        `/ecommerce/products/${encodeURIComponent(id)}/plan`,
        options,
    );
}

/** 把策划原始文本编译并写入各屏（结构不完整会被服务端拒绝，不产出半成品）。 */
export function applyEcommercePlan(id: string, raw: string) {
    return http.post<EcommerceProductDetail>(`/ecommerce/products/${encodeURIComponent(id)}/apply-plan`, { raw });
}

/**
 * 轮询商品详情直到全部槽位收尾（或超时）。
 * 详情接口本身会对账，因此轮询即可拿到最新状态。
 */
export async function waitForEcommerceProduct(
    id: string,
    options?: { intervalMs?: number; timeoutMs?: number; onTick?: (detail: EcommerceProductDetail) => void },
): Promise<EcommerceProductDetail> {
    const intervalMs = options?.intervalMs ?? 3000;
    const timeoutMs = options?.timeoutMs ?? 15 * 60 * 1000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const detail = await getEcommerceProductDetail(id);
        options?.onTick?.(detail);
        const status = detail.product.status;
        if (status === "completed" || status === "completed_with_warnings" || status === "failed" || status === "uncertain" || status === "paused") {
            return detail;
        }
        if (Date.now() > deadline) return detail;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
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
