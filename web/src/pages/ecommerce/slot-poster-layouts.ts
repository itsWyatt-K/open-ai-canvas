// 7 屏海报草图版式契约（返工令四-5）。
// 病灶：7 张 SlotCard 曾共用同一浅紫渐变底 + 同一位置同一大小的抠图主体——「7 胞胎克隆卡」，
// 顶栏写着「3 张 1:1 主图 + 4 张 3:4 详情」画框却全是 3:4，商业质感全无。
// 本文件只放纯数据与纯函数（不引 React、不引平台字典），单测可直接断言常量表；
// task-detail.tsx 的 SlotCard 画框区必须整框消费 slotPosterLayout 的返回值，
// 禁止在组件里散落硬编码渐变 / transform。
//
// 画框比例按平台规格注入：index < heroCount 用 heroRatio（淘宝前 3 张 1:1 主图），
// 其余用 detailRatio（后 4 张 3:4 竖版详情）——与 ECOMMERCE_PLATFORMS 同源。

/** 平台规格的结构性子集（与 EcommercePlatformSpec 对齐，但不强依赖，便于单测构造）。 */
export type SlotPosterPlatformSpec = {
    heroCount: number;
    heroRatio: string;
    detailCount: number;
    detailRatio: string;
};

/** 画框装饰（文案随数据走，组件只按 kind 渲染，不在组件里硬编码）。 */
export type SlotPosterDecoration =
    | { kind: "halo" }
    | { kind: "macroRing"; text: string }
    | { kind: "painPills"; items: Array<{ text: string; tone: "muted" | "accent" }> }
    | { kind: "benefitCapsule"; text: string }
    | { kind: "gridLines" }
    | { kind: "specRows"; rows: Array<[string, string]> }
    | { kind: "checklistCards"; items: string[] };

export type SlotPosterLayout = {
    /** 版式键（7 屏互不相同；单测断言用）。 */
    key: string;
    /** 画框右上角职能签（替代旧黑膏药，一眼区分 7 屏职能）。 */
    badge: string;
    /** 画框 CSS aspect-ratio（如 "1 / 1" / "3 / 4"），由平台规格推导。 */
    aspect: string;
    /** 画框背景 CSS。 */
    background: string;
    /** 标题文字色档：ink=亮底深字；onDark=暗底浅字。 */
    titleTone: "ink" | "onDark";
    /** 商品主体 CSS transform（left/top 固定 50%，位移与缩放全在这里）。 */
    subjectTransform: string;
    /** 商品主体最大尺寸（CSS max-width / max-height）。 */
    subjectMax: { width: string; height: string };
    /** 标题排版档（top 为画框高度百分比）。 */
    title: { align: "center" | "left"; size: "lg" | "md"; top: string };
    /** 副标题 top（画框高度百分比）。 */
    subtitleTop: string;
    /** 装饰元素。 */
    decorations: SlotPosterDecoration[];
};

type SlotPosterTemplate = Omit<SlotPosterLayout, "aspect">;

/**
 * 按屏序的版式模板表（3 主图 + 4 详情，与 DEFAULT_SLOT_PLAN 同序）。
 * aspect 不写死在这里——由 slotPosterLayout 按平台规格注入。
 */
const SLOT_POSTER_TEMPLATES: SlotPosterTemplate[] = [
    {
        // 第 1 屏 · 首屏主视觉：暖米金→极光紫放射渐变 + 主体放大 110% 居中 + 顶部居中大字。
        key: "hero_focus",
        badge: "首屏主视觉",
        background: "radial-gradient(115% 85% at 50% 14%, #f9eed6 0%, #ecd9f4 46%, #bca9ea 100%)",
        titleTone: "ink",
        subjectTransform: "translate(-50%, -50%) scale(1.1)",
        subjectMax: { width: "74%", height: "54%" },
        title: { align: "center", size: "lg", top: "6%" },
        subtitleTop: "14%",
        decorations: [{ kind: "halo" }],
    },
    {
        // 第 2 屏 · 痛点对比：左右双色分割底 + 主体偏右 + 左侧痛点对比标签。
        key: "pain_contrast",
        badge: "痛点对比",
        background: "linear-gradient(103deg, #d9e5f6 0%, #d9e5f6 45%, #f8edda 45%, #f8edda 100%)",
        titleTone: "ink",
        subjectTransform: "translate(-32%, -50%)",
        subjectMax: { width: "44%", height: "58%" },
        title: { align: "left", size: "md", top: "12%" },
        subtitleTop: "23%",
        decorations: [
            {
                kind: "painPills",
                items: [
                    { text: "✕ 老款烦恼", tone: "muted" },
                    { text: "✓ 一招解决", tone: "accent" },
                ],
            },
        ],
    },
    {
        // 第 3 屏 · 场景利益：清新柔光渐变 + 主体 95% 居中偏下 + 顶部促销利益点胶囊。
        key: "scene_benefit",
        badge: "场景利益",
        background: "linear-gradient(165deg, #edf7ec 0%, #dceef8 52%, #f7fae4 100%)",
        titleTone: "ink",
        subjectTransform: "translate(-50%, -36%) scale(0.95)",
        subjectMax: { width: "70%", height: "48%" },
        title: { align: "center", size: "md", top: "17%" },
        subtitleTop: "26%",
        decorations: [{ kind: "benefitCapsule", text: "立减 ¥30 · 顺丰包邮" }],
    },
    {
        // 第 4 屏 · 细节微距：暖灰微距底 + 主体放大 125% + 虚线放大环。
        key: "macro_detail",
        badge: "细节微距",
        background: "radial-gradient(95% 75% at 66% 28%, #f5f1ea 0%, #e3dccf 58%, #cec5b4 100%)",
        titleTone: "ink",
        subjectTransform: "translate(-50%, -50%) scale(1.25)",
        subjectMax: { width: "64%", height: "46%" },
        title: { align: "left", size: "md", top: "12%" },
        subtitleTop: "22%",
        decorations: [{ kind: "macroRing", text: "微距 ×2.5" }],
    },
    {
        // 第 5 屏 · 科技解析：暗色科技网格底（浅色标题）+ 网格暗纹与四角取景框。
        key: "tech_grid",
        badge: "科技解析",
        background: "linear-gradient(155deg, #27304a 0%, #161b29 100%)",
        titleTone: "onDark",
        subjectTransform: "translate(-50%, -50%) scale(1.02)",
        subjectMax: { width: "72%", height: "54%" },
        title: { align: "left", size: "md", top: "12%" },
        subtitleTop: "22%",
        decorations: [{ kind: "gridLines" }],
    },
    {
        // 第 6 屏 · 规格参数：浅灰参数底 + 主体偏左上 + 右侧参数表格线框。
        key: "spec_table",
        badge: "规格参数",
        background: "linear-gradient(180deg, #f4f6f9 0%, #e8ecf3 100%)",
        titleTone: "ink",
        subjectTransform: "translate(-55%, -62%) scale(0.9)",
        subjectMax: { width: "46%", height: "32%" },
        title: { align: "left", size: "md", top: "12%" },
        subtitleTop: "22%",
        decorations: [
            {
                kind: "specRows",
                rows: [
                    ["材质", "316 不锈钢"],
                    ["容量", "500 ml"],
                    ["保温", "12 小时"],
                ],
            },
        ],
    },
    {
        // 第 7 屏 · 信任收尾：暖米底 + 主体偏下缩小 + 底部清单卡片。
        key: "trust_checklist",
        badge: "信任收尾",
        background: "linear-gradient(198deg, #f3ede3 0%, #e6dccb 100%)",
        titleTone: "ink",
        subjectTransform: "translate(-50%, -40%) scale(0.85)",
        subjectMax: { width: "58%", height: "34%" },
        title: { align: "center", size: "md", top: "6%" },
        subtitleTop: "17%",
        decorations: [{ kind: "checklistCards", items: ["正品保障", "7 天无理由", "一年质保"] }],
    },
];

/** 版式模板表（单测友好：直接断言 7 屏互不相同）。 */
export const SLOT_POSTER_TEMPLATE_TABLE: readonly SlotPosterTemplate[] = SLOT_POSTER_TEMPLATES;

/** 7 屏版式键（顺序即屏序）。 */
export const SLOT_POSTER_LAYOUT_KEYS: readonly string[] = SLOT_POSTER_TEMPLATES.map((item) => item.key);

/** "1:1" → "1 / 1"（CSS aspect-ratio）；异常值回落 3:4 竖版。 */
export function ratioToAspect(ratio: string): string {
    const [w, h] = ratio.split(":");
    if (!w || !h) return "3 / 4";
    return `${w.trim()} / ${h.trim()}`;
}

/**
 * 按屏序取版式：前 heroCount 屏（主图）用 heroRatio，其余（详情）用 detailRatio。
 * 越界屏序回落最后一条详情版式，绝不为 undefined。
 */
export function slotPosterLayout(slotIndex: number, spec: SlotPosterPlatformSpec): SlotPosterLayout {
    const index = Number.isFinite(slotIndex) ? Math.max(0, Math.floor(slotIndex)) : 0;
    const template = SLOT_POSTER_TEMPLATES[index] ?? SLOT_POSTER_TEMPLATES[SLOT_POSTER_TEMPLATES.length - 1];
    const ratio = index < spec.heroCount ? spec.heroRatio : spec.detailRatio;
    return { ...template, aspect: ratioToAspect(ratio) };
}
