import type { PrCommerceScreen } from "./types";

const visualSystemSchema = {
    artDirection: "适合该产品的整组视觉方向，不照搬产品原图场景",
    palette: "主色、辅助色、点缀色及用色比例",
    lighting: "统一的光影与材质表现原则",
    typography: "字体类别、标题正文层级、文字色彩与留白规则；纯图说明不排字",
};
const visualPlanSchema = {
    subject: "本屏产品的视角、比例、姿态、数量；如需模特说明动作与产品关系，不改变产品身份",
    composition: "具体镜头景别、机位、主体位置及占比、视觉焦点与留白位置",
    environment: "具体场景、前中后景、道具及其位置；服务本屏目标而不是泛称高级背景",
    lighting: "主辅光方向、软硬度、阴影、反射与透光如何塑造产品",
    colorAndMaterials: "本屏色彩分配、背景和道具材质、与产品的对比关系",
    typography: "精确文案的放置区域、大小层级与排版；无字屏明确无排版文字",
    visualEvidence: "本屏已确认卖点通过什么可见细节、使用动作或视觉证据表达，不编造检测结论",
    variation: "相对相邻屏在景别、场景或布局上的明确变化，以及保留的统一设计元素",
};

export const commerceDetailPlanSchema = {
    productAnalysis: { identity: "从产品图识别的产品身份与需要保留的外观", visibleFeatures: ["从产品图实际看见的形态、颜色与材质表现"], confirmedSellingPoints: ["区分图像可见事实与用户明确提供的事实"], unknowns: ["无法从素材确认的参数、功效或材质；不得猜测"] },
    styleAnalysis: { palette: "参考图配色与比例", composition: "参考图构图与留白规律", lighting: "光线方向、软硬与对比", typography: "字体与信息层级；无字则明确", transferableElements: "可转化到本产品的视觉规则", excludedElements: "不可复制的参考产品、人物身份、品牌、文字及不适用元素" },
    visualSystem: visualSystemSchema,
    screens: [{ title: "具体视觉主题而非泛化栏目名", sceneType: "本屏具体场景", sellingPoints: "本屏已确认事实，无依据留空", copy: "本屏完整成品文案，纯图留空", visualPlan: visualPlanSchema }],
};

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`详情策划缺少${label}，请检查原始响应；不会自动出图`);
    return value as Record<string, unknown>;
}

function text(value: unknown, label: string) {
    if (typeof value !== "string" || !value.trim() || value.length > 6000) throw new Error(`详情策划 ${label} 须为非空具体描述（不超过 6000 字符）`);
    return value.trim();
}

function fields(value: unknown, schema: Record<string, string>, label: string) {
    const source = object(value, label);
    return Object.fromEntries(Object.keys(schema).map((key) => [key, text(source[key], `${label}.${key}`)]));
}

/** 指纹相撞时轮换使用的差异化机位描述（与后端 fingerprintDifferentiators 同序）。 */
const fingerprintDifferentiators = [
    "切换为微距特写视角，聚焦材质与工艺细节",
    "切换为场景远景视角，展示产品在使用环境中的全貌",
    "切换为 45 度俯视视角，呈现顶部结构与布局",
    "切换为平视正面视角，对称构图突出主体轮廓",
    "切换为侧面轮廓视角，强调产品线条与厚度",
    "切换为低角度仰视视角，增强产品的存在感与气势",
    "切换为斜侧光视角，通过明暗对比重塑立体感",
    "切换为拆解视角，展示内部结构或组件关系",
];

/**
 * 从模型响应中提取 JSON：剥离 ```json 外壳与首尾杂音（第一个 { 到最后一个 }）。
 * 与后端 extractPlanJSON 同构。
 */
export function extractPlanJSON(raw: string): string {
    let trimmed = (raw || "").trim();
    if (!trimmed) return "";
    const fence = trimmed.indexOf("```");
    if (fence >= 0) {
        let after = trimmed.slice(fence + 3).replace(/^json/i, "");
        const end = after.indexOf("```");
        after = (end >= 0 ? after.slice(0, end) : after).trim();
        if (after) trimmed = after;
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return "";
    return trimmed.slice(start, end + 1).trim();
}

/** 已知字段的规范化查找（小写去分隔符 → 规范 camelCase），与后端 planKeyAliases 同构。 */
const planKeyAliases: Record<string, string> = {};
for (const name of [
    "productAnalysis", "styleAnalysis", "visualSystem", "screens",
    "identity", "visibleFeatures", "confirmedSellingPoints", "unknowns",
    "palette", "composition", "lighting", "typography", "transferableElements", "excludedElements",
    "artDirection", "title", "sceneType", "sellingPoints", "copy", "visualPlan",
    "subject", "environment", "colorAndMaterials", "visualEvidence", "variation",
]) {
    planKeyAliases[name.toLowerCase().replace(/[-_ ]/g, "")] = name;
}

function normalizePlanKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalizePlanKeys);
    if (value && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            out[planKeyAliases[key.toLowerCase().replace(/[-_ ]/g, "")] ?? key] = normalizePlanKeys(child);
        }
        return out;
    }
    return value;
}

/** 智能缺省兜底上下文（与后端 PlanFallback 同构）。 */
export type PlanFallback = {
    slotTitles?: string[];
    slotSceneTypes?: string[];
    productName?: string;
    sellingPoints?: string;
    styleSeed?: string;
};

const defaultStyleAnalysis = (seed: string) => {
    const composition = seed ? `遵循平台规范与所选风格（${seed}）；干净现代的商业摄影，主体清晰、背景克制` : "主体清晰、居中或三分法构图，留白充足，背景克制";
    return {
        palette: "以产品固着色为主色，中性背景（白/浅灰/米白），点缀色不超过一种",
        composition,
        lighting: "柔和主光加轻微侧逆光勾勒轮廓，阴影干净",
        typography: "现代无衬线，标题与正文层级分明；纯图屏不排字",
        transferableElements: "干净背景、统一光影与克制造型的商业摄影规则",
        excludedElements: "参考图中的人物、品牌、产品与功效信息，不迁移到当前商品",
    };
};

const templateTitle = (fallback: PlanFallback, index: number) =>
    fallback.slotTitles?.[index] || `第 ${index + 1} 屏`;
const templateSceneType = (fallback: PlanFallback, index: number) =>
    fallback.slotSceneTypes?.[index] || "产品展示";
const templateVisual = (key: string, index: number) => {
    const marker = `（第 ${index + 1} 屏默认方案）`;
    switch (key) {
        case "subject": return `商品主体占画面 70%，完整可见、不变形${marker}`;
        case "composition": return `中心构图，主体清晰，背景克制${marker}`;
        case "environment": return `干净中性背景，无干扰元素${marker}`;
        case "lighting": return `柔和均匀商业摄影光，阴影干净${marker}`;
        case "colorAndMaterials": return `以产品固有色为主，中性背景衬托材质${marker}`;
        case "typography": return `本屏默认不排字，纯图呈现${marker}`;
        case "visualEvidence": return `通过商品实拍可见的外观与材质细节表达${marker}`;
        default: return `本屏为第 ${index + 1} 屏默认机位，与相邻屏景别不同${marker}`;
    }
};

/**
 * 剥掉画布任务结果包装：{"mode":"text","text":"<模型原文>"} → 原文。
 * 与后端 ecommerce.UnwrapPlanText 同构。非包装/解析失败原样返回。
 */
export function unwrapPlanText(raw: string): string {
    const trimmed = (raw || "").trim();
    if (!trimmed.startsWith("{")) return raw;
    try {
        const wrapper = JSON.parse(trimmed) as { mode?: string; text?: string };
        if (typeof wrapper.text === "string" && wrapper.text.trim()) return wrapper.text;
    } catch {
        return raw;
    }
    return raw;
}

/**
 * Compile structured visual decisions into the existing editable prompt contract.
 *
 * 阶段 5 容错版（与后端 CompileDetailPlanWithFallback 同构）：
 *   - 剥离 Markdown 外壳；键名兼容 snake_case/大小写差异；
 *   - styleAnalysis / productAnalysis / visualSystem 缺失 → 智能缺省；
 *   - screens 少于期望屏数按模板补齐、多于截断；
 *   - 相邻屏指纹相撞 → 自动追加差异化机位描述；
 *   - 仍硬失败：空响应、非法 JSON、screens 为空、单屏超长。
 */
export function compileCommerceDetailPlan(value: unknown, expected: PrCommerceScreen[], fallback: PlanFallback = {}) {
    const plan = object(normalizePlanKeys(value), "产品与风格分析");
    const product = object(plan.productAnalysis ?? {}, "产品分析 productAnalysis");
    if (typeof product.identity !== "string" || !product.identity.trim()) {
        product.identity = `产品：${fallback.productName || "当前商品"}；外观、形态、颜色与材质以商品实拍图为唯一依据`;
    }
    for (const key of ["visibleFeatures", "confirmedSellingPoints", "unknowns"]) {
        if (!Array.isArray(product[key]) || product[key].length === 0) {
            product[key] = key === "confirmedSellingPoints"
                ? (fallback.sellingPoints ? fallback.sellingPoints.split(/[\n、,，;；]/).map((item) => item.trim()).filter(Boolean).slice(0, 5) : ["以商品实拍图可见的外观、材质与形态为准"])
                : key === "unknowns" ? ["未提供的参数、功效、认证与价格信息；不得猜测"] : ["外观、形态、颜色与材质表现以商品实拍图为唯一依据"];
        }
    }
    const style: Record<string, string> = { ...defaultStyleAnalysis(fallback.styleSeed || ""), ...(object(plan.styleAnalysis ?? {}, "风格分析 styleAnalysis") as Record<string, string>) };
    const system = { ...(plan.visualSystem as Record<string, string> | undefined) };
    for (const key of Object.keys(visualSystemSchema)) {
        if (typeof system[key] !== "string" || !system[key].trim()) system[key] = style[key] ?? "";
    }
    if (!Array.isArray(plan.screens) || plan.screens.length === 0) {
        throw new Error("策划未包含任何屏幕方案（screens 为空），请检查原始响应");
    }
    const wantCount = expected.length;
    const rows = (plan.screens as unknown[]).slice(0, wantCount);
    const seen = new Map<string, number>();
    const screens = [];
    for (let index = 0; index < wantCount; index++) {
        const row = rows[index] ? object(rows[index], `第 ${index + 1} 屏`) : {};
        for (const [key, limit] of [["title", 200], ["copy", 8000], ["sceneType", 200], ["sellingPoints", 4000]] as const) {
            const value = (row as Record<string, unknown>)[key];
            if (typeof value === "string" && value.length > limit) {
                throw new Error(`第 ${index + 1} 屏 ${key} 超过 ${limit} 字符，不会截断执行`);
            }
            if ((["title", "sceneType"] as const).includes(key as never) && (typeof value !== "string" || !value.trim())) {
                (row as Record<string, unknown>)[key] = key === "title" ? templateTitle(fallback, index) : templateSceneType(fallback, index);
            }
        }
        const visualSource = object((row as Record<string, unknown>).visualPlan ?? {}, `第 ${index + 1} 屏 visualPlan`);
        const visual: Record<string, string> = {};
        for (const key of Object.keys(visualPlanSchema)) {
            const value = visualSource[key];
            visual[key] = typeof value === "string" && value.trim() ? value.trim() : templateVisual(key, index);
        }
        const fingerprintOf = () => JSON.stringify([visual.subject, visual.composition, visual.environment, visual.lighting, visual.colorAndMaterials, visual.visualEvidence]).replace(/\s/g, "");
        let fingerprint = fingerprintOf();
        const previous = seen.get(fingerprint);
        if (previous !== undefined) {
            const differentiator = fingerprintDifferentiators[(index - 1) % fingerprintDifferentiators.length];
            for (const key of ["variation", "composition"] as const) {
                if (!visual[key].includes(differentiator)) {
                    visual[key] = visual[key] ? `${visual[key]}；${differentiator}` : differentiator;
                }
            }
            fingerprint = fingerprintOf();
        }
        seen.set(fingerprint, index);
        const prompt = [
            `整组视觉方向：${system.artDirection}`, `统一配色：${system.palette}`, `统一光影：${system.lighting}`, `统一字体：${system.typography}`,
            `产品与主体：${visual.subject}`, `镜头与构图：${visual.composition}`, `环境与道具：${visual.environment}`, `光线与质感：${visual.lighting}`,
            `色彩与材质：${visual.colorAndMaterials}`, `文字与留白：${visual.typography}`, `卖点的视觉表达：${visual.visualEvidence}`, `本屏差异与连续性：${visual.variation}`,
        ].join("\n\n");
        if (prompt.length > 12000) throw new Error(`第 ${index + 1} 屏视觉方案过长，请精简后再生成，不会截断执行`);
        screens.push({ ...(row as Record<string, unknown>), prompt, fingerprint } as unknown as PrCommerceScreen & { prompt: string; fingerprint: string });
    }
    return { screens };
}
