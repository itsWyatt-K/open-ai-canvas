// 直播间装修平台预设（拍板令阶段三）：尺寸、安全区、角标位。
// 坐标一律 0-1 相对值，与 nxf live-compose / render-banner 对齐。
import type { LiveBannerText } from "./live-studio-types";

export type LivePlatformKey = "douyin" | "kuaishou" | "channels" | "taobao-live";

export type LivePlatformPreset = {
    key: LivePlatformKey;
    label: string;
    width: number;
    height: number;
    /** 顶部/底部安全区（0-1）：弹幕、礼物按钮、下播条不可遮挡区。 */
    safeTop: number;
    safeBottom: number;
    /** 促销角标预设位（0-1 相对中心坐标）。 */
    badgeSlots: Array<{ key: string; label: string; x: number; y: number }>;
};

export const LIVE_PLATFORMS: Record<LivePlatformKey, LivePlatformPreset> = {
    douyin: {
        key: "douyin", label: "抖音直播", width: 1080, height: 1920,
        safeTop: 0.08, safeBottom: 0.18,
        badgeSlots: [
            { key: "top-left", label: "左上角标", x: 0.16, y: 0.12 },
            { key: "top-right", label: "右上角标", x: 0.84, y: 0.12 },
            { key: "bottom-banner", label: "底部横幅", x: 0.5, y: 0.78 },
        ],
    },
    kuaishou: {
        key: "kuaishou", label: "快手直播", width: 1080, height: 1920,
        safeTop: 0.07, safeBottom: 0.16,
        badgeSlots: [
            { key: "top-left", label: "左上角标", x: 0.16, y: 0.11 },
            { key: "top-right", label: "右上角标", x: 0.84, y: 0.11 },
            { key: "bottom-banner", label: "底部横幅", x: 0.5, y: 0.8 },
        ],
    },
    channels: {
        key: "channels", label: "视频号直播", width: 1080, height: 1920,
        safeTop: 0.06, safeBottom: 0.14,
        badgeSlots: [
            { key: "top-left", label: "左上角标", x: 0.16, y: 0.1 },
            { key: "top-right", label: "右上角标", x: 0.84, y: 0.1 },
            { key: "bottom-banner", label: "底部横幅", x: 0.5, y: 0.82 },
        ],
    },
    "taobao-live": {
        key: "taobao-live", label: "淘宝直播", width: 1080, height: 1920,
        safeTop: 0.09, safeBottom: 0.2,
        badgeSlots: [
            { key: "top-left", label: "左上角标", x: 0.16, y: 0.13 },
            { key: "top-right", label: "右上角标", x: 0.84, y: 0.13 },
            { key: "bottom-banner", label: "底部横幅", x: 0.5, y: 0.76 },
        ],
    },
};

/**
 * 常用促销 Banner 预设文案（一键插入后可改；缺省字段由 nxf 默认值兜底）。
 * 全部为通用占位文案——不写死任何具体商品/品牌，换品只改字不改结构。
 *
 * 配色规范（返工令 Round 4）：统一「纯白字 + 主色描边 + 微投影」的现代花字口径，
 * 严禁暗棕黄（#4A3527 那类）低对比配色——那是 90 年代小广告感的主要来源。
 */
export const LIVE_BANNER_PRESETS: Array<{ label: string; banner: Partial<LiveBannerText> & Pick<LiveBannerText, "text"> }> = [
    { label: "限时秒杀", banner: { text: "限时秒杀", font_size: 120, color: "#FFFFFF", bold: true, stroke_color: "#E11D48", stroke_width: 6, shadow_blur: 8, shadow_offset_y: 6 } },
    { label: "第二件半价", banner: { text: "第二件半价", font_size: 96, color: "#FFFFFF", bold: true, stroke_color: "#7C3AED", stroke_width: 5, shadow_blur: 6 } },
    { label: "全场五折", banner: { text: "全场五折", font_size: 110, color: "#FFFFFF", bold: true, stroke_color: "#4F46E5", stroke_width: 5, shadow_blur: 8, shadow_offset_y: 6 } },
    { label: "周年庆典", banner: { text: "周年庆典", font_size: 110, color: "#FFFFFF", bold: true, stroke_color: "#D97706", stroke_width: 5, shadow_blur: 8, shadow_offset_y: 6 } },
];

/**
 * 场景包 → 文字排版主题（返工令 Round 4 改名去重）：
 * 一套完整的三层文字结构（品牌条 / 痛点 / 核心卖点），一次铺满。
 *
 * 为什么不是单条预设：卖点文案天然是分级的，单条预设只能堆叠，
 * 字号层级和行距每次都要手调；场景包把层级关系预先写死，换品只需改字。
 *
 * ⚠️ 命名口径：这里的 label 是「文字排版主题」，与左栏第 1 节的「直播间背景风格预设」
 * （温馨家居 / 科技展台 / 大促狂欢）是两套独立东西——上一轮两组胶囊同名，
 * 用户在第 1 节和第 3 节看到完全一样的三个词，根本分不清点在哪个。
 * key 保持不变（home / digital / promo，可能有持久化引用），只改展示名与配色。
 *
 * 配色规范：统一「纯白字 + 主色描边 + 微投影」的高对比现代花字，
 * 严禁暗棕黄（#4A3527 那类）——未生背景时画布是暗夜流光渐变底，
 * 白字彩边在任何背景上都清楚，且导出后不被平台 UI 吞掉。
 *
 * 坐标按 1080x1920 画布设计，已避开抖音顶部 8% 安全区；
 * 核心卖点底边约在画布 33%，不压中部主播位与产品位。
 */
export type LiveScenePack = {
    key: string;
    label: string;
    /** 适用场景说明，展示在按钮 tip 里。 */
    hint: string;
    banners: Array<Partial<LiveBannerText> & Pick<LiveBannerText, "text">>;
};

export const LIVE_SCENE_PACKS: LiveScenePack[] = [
    {
        key: "home",
        label: "🔥 爆品秒杀套组",
        hint: "文字排版主题：白字玫红描边，快节奏大促腔，适合秒杀 / 限量款",
        banners: [
            { text: "品牌名 ｜ 本周主推", font_size: 46, color: "#FFFFFF", bold: false, stroke_color: "#E11D48", stroke_width: 3, shadow_blur: 8, shadow_offset_y: 4, shadow_opacity: 0.3, x: 0.5, y: 0.115 },
            { text: "爆品秒杀 · 限量开抢", font_size: 76, color: "#FFFFFF", bold: true, stroke_color: "#E11D48", stroke_width: 5, shadow_blur: 10, shadow_offset_y: 5, shadow_opacity: 0.34, x: 0.5, y: 0.178 },
            { text: "官方直发 · 售后无忧", font_size: 42, color: "#FFFFFF", bold: false, stroke_color: "#BE123C", stroke_width: 2, shadow_blur: 6, shadow_offset_y: 3, shadow_opacity: 0.26, x: 0.5, y: 0.235 },
            { text: "核心卖点", font_size: 150, color: "#FFFFFF", bold: true, stroke_color: "#BE123C", stroke_width: 8, shadow_blur: 14, shadow_offset_y: 7, shadow_opacity: 0.38, x: 0.5, y: 0.312 },
        ],
    },
    {
        key: "digital",
        label: "🎁 周年宠粉套组",
        hint: "文字排版主题：白字紫罗兰描边，节庆氛围，适合周年庆 / 会员日",
        banners: [
            { text: "品牌名 ｜ 周年庆典", font_size: 46, color: "#FFFFFF", bold: false, stroke_color: "#7C3AED", stroke_width: 3, shadow_blur: 8, shadow_offset_y: 4, shadow_opacity: 0.3, x: 0.5, y: 0.115 },
            { text: "周年宠粉 · 好礼加赠", font_size: 76, color: "#FFFFFF", bold: true, stroke_color: "#7C3AED", stroke_width: 5, shadow_blur: 10, shadow_offset_y: 5, shadow_opacity: 0.34, x: 0.5, y: 0.178 },
            { text: "全场满减 · 今日截止", font_size: 42, color: "#FFFFFF", bold: false, stroke_color: "#6D28D9", stroke_width: 2, shadow_blur: 6, shadow_offset_y: 3, shadow_opacity: 0.26, x: 0.5, y: 0.235 },
            { text: "核心卖点", font_size: 150, color: "#FFFFFF", bold: true, stroke_color: "#6D28D9", stroke_width: 8, shadow_blur: 14, shadow_offset_y: 7, shadow_opacity: 0.38, x: 0.5, y: 0.312 },
        ],
    },
    {
        key: "promo",
        label: "✨ 品质日常套组",
        hint: "文字排版主题：白字靛蓝描边，干净克制，适合日常播 / 品牌调性款",
        banners: [
            { text: "品牌名 ｜ 品质之选", font_size: 46, color: "#FFFFFF", bold: false, stroke_color: "#4F46E5", stroke_width: 3, shadow_blur: 8, shadow_offset_y: 4, shadow_opacity: 0.3, x: 0.5, y: 0.115 },
            { text: "品质日常 · 好物精选", font_size: 76, color: "#FFFFFF", bold: true, stroke_color: "#4F46E5", stroke_width: 5, shadow_blur: 10, shadow_offset_y: 5, shadow_opacity: 0.34, x: 0.5, y: 0.178 },
            { text: "官方正品 · 极速发货", font_size: 42, color: "#FFFFFF", bold: false, stroke_color: "#4338CA", stroke_width: 2, shadow_blur: 6, shadow_offset_y: 3, shadow_opacity: 0.26, x: 0.5, y: 0.235 },
            { text: "核心卖点", font_size: 150, color: "#FFFFFF", bold: true, stroke_color: "#4338CA", stroke_width: 8, shadow_blur: 14, shadow_offset_y: 7, shadow_opacity: 0.38, x: 0.5, y: 0.312 },
        ],
    },
];

/** 9:16 竖版画布默认尺寸。 */
export const LIVE_DEFAULT_CANVAS = { width: 1080, height: 1920 };

// ---------------------------------------------------------------------------
// 对标参考图（返工令 Round 5）：模式 / 强度 / DNA 提示词 / 反推台外来载荷契约。
// 纯函数与常量集中放这里，live-studio.tsx 与 ereverse 出口共用同一套口径，
// 避免两边各写一份默认值后漂移。UI 状态仍在 live-studio.tsx。
// ---------------------------------------------------------------------------

/**
 * 参考图作用模式：
 *  - style  借鉴画风光影：analyzeVisualDna 提取描述拼进生图 prompt（所有生图模型可用）；
 *  - layout 跟随构图布局（垫图）：需生图接口接收参考图与 strength 参数。
 * ⚠️ 当前 requestGeneration(config, prompt, options) 只收 prompt，不收参考图/强度
 * （services 本轮不可改），因此 layout 在 UI 上明确置灰并说明原因，严禁造假参数。
 */
export type LiveReferenceMode = "style" | "layout";

/** 借鉴强度三档：映射生图 strength；style 模式下同时折算进提示词语气。 */
export type LiveReferenceStrength = 0.35 | 0.6 | 0.8;

export const LIVE_REFERENCE_MODES: Array<{ key: LiveReferenceMode; label: string; hint: string; supported: boolean }> = [
    {
        key: "style",
        label: "🎨 借鉴画风光影",
        hint: "提取参考图的色调 / 光影 / 材质 / 留白描述，拼进生图提示词（所有生图模型可用）",
        supported: true,
    },
    {
        key: "layout",
        label: "📐 跟随构图布局（垫图）",
        hint: "垫图需要生图接口接收参考图与强度参数；当前生图通道只收提示词，暂不可用——请用「🎨 借鉴画风光影」，同样吃参考图",
        supported: false,
    },
];

export const LIVE_REFERENCE_STRENGTHS: Array<{ value: LiveReferenceStrength; label: string }> = [
    { value: 0.35, label: "轻度 0.35" },
    { value: 0.6, label: "标准 0.60" },
    { value: 0.8, label: "高还原 0.80" },
];

export const LIVE_REFERENCE_DEFAULT_MODE: LiveReferenceMode = "style";
export const LIVE_REFERENCE_DEFAULT_STRENGTH: LiveReferenceStrength = 0.6;

/** style 模式下强度 → 提示词语气（接口不收 strength，就用文字把强度讲清楚，不造假参数）。 */
const LIVE_REFERENCE_STRENGTH_TONE: Record<LiveReferenceStrength, string> = {
    0.35: "整体氛围大致相近即可，保留场景预设的主体结构",
    0.6: "明确借鉴其色调与光影氛围，商品展示区保持干净留白",
    0.8: "高度还原参考图的色调、光影与材质质感",
};

/** VisualDna → 生图提示词片段：只摘有值的字段，空字段不占位、不臆造。 */
export function describeLiveReferenceDna(
    dna: { color?: { summary?: string; palette?: Array<{ hex?: string }>; temperature?: string }; lighting?: { summary?: string; keywords?: string[] }; texture?: { summary?: string }; layout?: { summary?: string }; mood?: { summary?: string } },
    strength: LiveReferenceStrength,
): string {
    const parts: string[] = [];
    const colorBits: string[] = [];
    if (dna.color?.summary) colorBits.push(dna.color.summary);
    const palette = (dna.color?.palette || []).map((entry) => entry?.hex).filter((hex): hex is string => Boolean(hex)).slice(0, 5);
    if (palette.length) colorBits.push(`主色调 ${palette.join(" / ")}`);
    if (dna.color?.temperature) colorBits.push(`色温${dna.color.temperature}`);
    if (colorBits.length) parts.push(`色彩：${colorBits.join("，")}`);
    if (dna.lighting?.summary) {
        const keywords = (dna.lighting.keywords || []).slice(0, 4).filter(Boolean);
        parts.push(`光影：${dna.lighting.summary}${keywords.length ? `（${keywords.join("、")}）` : ""}`);
    }
    if (dna.texture?.summary) parts.push(`材质：${dna.texture.summary}`);
    if (dna.layout?.summary) parts.push(`空间留白：${dna.layout.summary}`);
    if (dna.mood?.summary) parts.push(`氛围：${dna.mood.summary}`);
    if (!parts.length) return "";
    return `参考直播间画风 DNA（借鉴强度：${strength.toFixed(2)}，${LIVE_REFERENCE_STRENGTH_TONE[strength]}）：${parts.join("；")}。生成时沿用该色调与光影氛围，不要复制参考图里的文字与商品。`;
}

/**
 * ereverse → 直播台的外来参考图载荷。
 * URL query 只带轻量标记（from=ereverse），重负载（参考帧 dataURL + DNA 文本）走 localStorage。
 */
export const LIVE_REFERENCE_HANDOFF_KEY = "yingce:live-studio-reference";

export type LiveReferenceHandoff = {
    source: "ereverse";
    sourceName: string;
    /** 参考帧 dataURL；超体积护栏时为空，仅带提示词。 */
    dataUrl?: string;
    mode: LiveReferenceMode;
    strength: LiveReferenceStrength;
    /** 视觉配方提示词（来自反推的镜头视觉提示词聚合）。 */
    dnaText?: string;
    /** true = 参考帧超限被丢弃，只带入提示词（toast 必须说明，不静默）。 */
    frameDropped?: boolean;
    createdAt: string;
};

/** localStorage 体积护栏：超过就不写帧只写提示词，绝不静默失败。 */
export const LIVE_REFERENCE_HANDOFF_MAX_CHARS = 3_500_000;

export function parseLiveReferenceHandoff(raw: string | null): LiveReferenceHandoff | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as Partial<LiveReferenceHandoff>;
        if (!parsed || parsed.source !== "ereverse") return null;
        const strength = Number(parsed.strength);
        return {
            source: "ereverse",
            sourceName: String(parsed.sourceName || "对标爆款"),
            dataUrl: typeof parsed.dataUrl === "string" && parsed.dataUrl.startsWith("data:") ? parsed.dataUrl : undefined,
            mode: "style",
            strength: (strength === 0.35 || strength === 0.8 ? strength : 0.6) as LiveReferenceStrength,
            dnaText: typeof parsed.dnaText === "string" ? parsed.dnaText.slice(0, 4000) : undefined,
            frameDropped: Boolean(parsed.frameDropped),
            createdAt: String(parsed.createdAt || ""),
        };
    } catch {
        return null;
    }
}

/**
 * 读取并一次性消费外来参考图载荷：仅当 URL 带 from=ereverse 时才认账
 * （避免用户之后正常进直播台被陈旧载荷打扰），读后即删。
 */
export function consumeLiveReferenceHandoff(search: string): LiveReferenceHandoff | null {
    let flagged = false;
    try {
        flagged = new URLSearchParams(search).get("from") === "ereverse";
    } catch {
        return null;
    }
    if (!flagged) return null;
    let raw: string | null = null;
    try {
        raw = window.localStorage.getItem(LIVE_REFERENCE_HANDOFF_KEY);
        window.localStorage.removeItem(LIVE_REFERENCE_HANDOFF_KEY);
    } catch {
        return null;
    }
    return parseLiveReferenceHandoff(raw);
}
