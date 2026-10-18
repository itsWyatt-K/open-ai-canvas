// 6 大电商平台规范字典（与后端 backend/internal/ecommerce/platforms.go 同构）。
//
// 用途：三步向导第 1 步的平台选择卡（名称/标签/规格），以及切换平台时
// 前端本地乐观更新 config 的默认值。**权威定义在后端**：切换平台的最终
// 效果以 POST /products/:id/apply-platform 返回的 config 为准，本文件只负责
// 渲染与即时反馈。
//
// 纪律：平台 key 与后端逐字一致；新增平台必须两边同步加。

export type EcommercePlatformKey =
    | "taobao"
    | "douyin"
    | "pinduoduo"
    | "jd"
    | "amazon"
    | "xiaohongshu";

export type EcommercePlatformSpec = {
    key: EcommercePlatformKey;
    name: string;
    /** 适用标签（平台卡片副标题）。 */
    tagline: string;
    heroCount: number;
    heroRatio: string;
    detailCount: number;
    detailRatio: string;
    /** zh（中文）| en（英文）。 */
    language: "zh" | "en";
    /** 平台强制视觉与文案规范。 */
    rules: string;
    /** 首屏强制纯白底（京东 / 亚马逊）。 */
    whiteBackgroundFirst: boolean;
};

export const ECOMMERCE_PLATFORMS: EcommercePlatformSpec[] = [
    {
        key: "taobao", name: "淘宝 / 天猫", tagline: "首屏高点击率焦点",
        heroCount: 3, heroRatio: "1:1", detailCount: 4, detailRatio: "3:4", language: "zh",
        rules: "首屏突出高点击率视觉焦点与核心利益点；第 3 张主图兼顾干净背景；详情页按「痛点引入→核心材质/科技→场景体验→规格清单」递进；整体符合天猫淘宝主图规范，无牛皮癣。",
        whiteBackgroundFirst: false,
    },
    {
        key: "douyin", name: "抖音 / 视频号", tagline: "3:4 竖屏冲击",
        heroCount: 3, heroRatio: "3:4", detailCount: 4, detailRatio: "3:4", language: "zh",
        rules: "竖屏信息流满屏构图，前 3 秒强视觉冲击；每屏画面大字文案必须极简短促（≤8 个字），强痛点对比与直播级利益点表达；避免静态平铺，多用动态感构图。",
        whiteBackgroundFirst: false,
    },
    {
        key: "pinduoduo", name: "拼多多", tagline: "高饱和高对比",
        heroCount: 3, heroRatio: "1:1", detailCount: 4, detailRatio: "3:4", language: "zh",
        rules: "高饱和度高对比度；首屏直接放大核心功能、分量或性价比卖点；画面真实直观，拒绝虚无缥缈的意识流留白；信息密度可以更高。",
        whiteBackgroundFirst: false,
    },
    {
        key: "jd", name: "京东 (JD)", tagline: "首图纯白底规范",
        heroCount: 3, heroRatio: "1:1", detailCount: 4, detailRatio: "3:4", language: "zh",
        rules: "主图第 1 张强制纯白底规范（RGB 255,255,255），商品主体居中占比 75%~85%，纯图无促销文字；附图与详情偏重品质感、参数拆解与安全背书；整体干净专业。",
        whiteBackgroundFirst: true,
    },
    {
        key: "amazon", name: "亚马逊 Amazon", tagline: "纯白底 + 英文信息图",
        heroCount: 3, heroRatio: "1:1", detailCount: 4, detailRatio: "4:3", language: "en",
        rules: "Main Hero（第 1 张主图）强制 Pure White Background, No Text, Product occupies 85% frame；其余主图为英文 Infographic（痛点图标 + 尺寸标注 + 生活场景）；全部文案使用英文输出。",
        whiteBackgroundFirst: true,
    },
    {
        key: "xiaohongshu", name: "小红书种草", tagline: "真实生活化实拍",
        heroCount: 3, heroRatio: "3:4", detailCount: 4, detailRatio: "3:4", language: "zh",
        rules: "真实生活化场景实拍质感（自然光/居家或户外手持氛围），杂志感轻量排版，弱化硬广推销感；文案口语化、有场景代入感，避免促销腔。",
        whiteBackgroundFirst: false,
    },
];

export const DEFAULT_PLATFORM_KEY: EcommercePlatformKey = "taobao";

export function platformByKey(key: string | undefined | null): EcommercePlatformSpec | undefined {
    if (!key) return undefined;
    return ECOMMERCE_PLATFORMS.find((item) => item.key === key);
}

/** 取平台规范；未知/空 key 回落淘宝天猫（与后端 PlatformSpecOrDefault 同口径）。 */
export function platformSpecOrDefault(key: string | undefined | null): EcommercePlatformSpec {
    return platformByKey(key) ?? ECOMMERCE_PLATFORMS[0];
}

/** 平台规格摘要（平台卡片第二行）：`3 张 · 1:1 主图 + 4 张 · 3:4 详情`。 */
export function platformSpecSummary(spec: EcommercePlatformSpec): string {
    return `${spec.heroCount} 张 · ${spec.heroRatio} 主图 + ${spec.detailCount} 张 · ${spec.detailRatio} 详情`;
}

/** 视觉风格快捷胶囊（第二步引导）；点选后写入 extraRequirements。 */
export const STYLE_CAPSULES: Array<{ key: string; label: string; hint: string }> = [
    { key: "auto", label: "✨ 自动匹配品类", hint: "" },
    { key: "medical", label: "🏥 专业医疗/科技净感", hint: "专业医疗/科技净感：干净冷色调、精密仪器质感、可信赖的专业布光" },
    { key: "home", label: "🌿 居家温馨自然光", hint: "居家温馨自然光：暖色调、自然光入射、生活化布景与柔软材质" },
    { key: "minimal", label: "💎 极简高级棚拍", hint: "极简高级棚拍：大留白、单一视觉重心、低饱和高级灰背景" },
    { key: "outdoor", label: "🏕️ 户外出行实拍", hint: "户外出行实拍：自然光、真实户外环境、手持实拍氛围" },
];
