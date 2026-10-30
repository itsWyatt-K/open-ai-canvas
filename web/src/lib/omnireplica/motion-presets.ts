/**
 * OiiOii 全能复刻 · 预置动效模板（M2 拆解层数据源）。
 *
 * 定位（《项目交付方案 v1.2》§7 工程闭环-② 一键推荐动效）：
 * - 本模块是「一键推荐动效」的数据源，也是 degraded 补齐的推荐值来源；
 * - 纯静态数据 + TS 类型，**零副作用**（无 I/O、无模块级副作用、无运行时依赖）；
 * - 三个预置整镜模板：① 口播条 ② 产品特写 ③ 氛围过场；
 * - 每模板 = 完整 MotionBlueprint shots 片段（合法枚举值）+ CSS 关键帧定义 +
 *   人工精修说明注释。上线门槛：三模板须先过 nxf preset 回归测试
 *   （程不宕 test_code_render.py 覆盖），不过不向运营开放一键推荐。
 *
 * 契约对齐（双校对，改动必须双仓库同步）：
 * - 动效枚举词表与 e-reverse `pft_schema.py` 的 MOTION_*_TYPES 严格同源，
 *   与 nxf code-render 渲染器严格一致（不一致 = 渲染 422）；
 * - MotionBlueprint 形态见交付方案 §6.1（v1.2 冻结）；本文件只承载 shots 片段，
 *   canvas/theme/slots 由装配层（前端蓝图编辑器）合并用户工程后下发。
 * - 当前为通用电商骨架（合法枚举 + 自洽动效）；真人实拍参考片到达后按实拍
 *   校准参数（时长/字号/延迟），不改结构。
 */

// --------------------------------------------------------------------------- #
// 动效枚举词表（冻结契约 —— 与 e-reverse pft_schema.py / nxf 渲染器三方同源）
// --------------------------------------------------------------------------- #

export const MOTION_ENTER_TYPES = [
    "none",
    "fade",
    "fade-up",
    "fade-down",
    "slide-left",
    "slide-right",
    "zoom-in",
    "zoom-out",
    "pop",
    "flip-x",
    "blur-in",
] as const;

export const MOTION_EXIT_TYPES = ["none", "fade", "fade-down", "scale-down", "slide-left", "slide-right"] as const;

export const MOTION_TRANSITION_TYPES = ["none", "cut", "dip-to-white", "dip-to-black", "cross-fade"] as const;

/** 词表版本号（与 e-reverse pft_schema.MOTION_WORDLIST_VERSION 同值）。 */
export const MOTION_WORDLIST_VERSION = "motion-wordlist/v1";

export type MotionEnterType = (typeof MOTION_ENTER_TYPES)[number];
export type MotionExitType = (typeof MOTION_EXIT_TYPES)[number];
export type MotionTransitionType = (typeof MOTION_TRANSITION_TYPES)[number];

/** 动效层归属：code=代码层（包装镜头）/ live_action=真人实拍层（二阶段）。 */
export type MotionShotLayer = "code" | "live_action";

// --------------------------------------------------------------------------- #
// MotionBlueprint 结构类型（交付方案 §6.1 精要；前端装配层同构消费）
// --------------------------------------------------------------------------- #

/** 元素动效（shot 级 enter/exit 与 element 级 enter/exit 共用此形态）。 */
export interface MotionAnimation {
    type: MotionEnterType | MotionExitType;
    duration_ms: number;
    /** element 级动效的入场延迟（shot 级不用）。 */
    delay_ms?: number;
    /** shot 级动效的缓动（element 级默认渲染器 ease-out）。 */
    easing?: string;
}

export interface MotionStroke {
    /** @theme.colors.* 引用（渲染时注入 :root CSS 自定义属性，换肤零成本）。 */
    color: string;
    /** 描边宽度 / 画布宽（0.006 ≈ 6.5px @1080）。 */
    width_ratio: number;
}

/** 归一化锚点坐标：x/y ∈ (0,1]，(0.5,0.5)=画布中心。 */
export interface MotionPosition {
    x: number;
    y: number;
}

export interface MotionElementBase {
    element_id: string;
    /** 归一化尺寸：text=字号/画布宽；image/sprite=宽度占比【语义以 nxf 渲染器实作为准】。 */
    size_ratio: number;
    enter: MotionAnimation;
    exit?: MotionAnimation;
}

export interface MotionTextElement extends MotionElementBase {
    type: "text";
    text: string;
    position: MotionPosition;
    /** @theme.colors.* 引用。 */
    color: string;
    stroke?: MotionStroke;
}

export interface MotionImageElement extends MotionElementBase {
    type: "image";
    /** 指向 blueprint.slots 的槽位键（物料层抠图/贴图资产）。 */
    slot: string;
    position: MotionPosition;
}

export interface MotionSpriteElement extends MotionElementBase {
    type: "sprite";
    /** 指向 blueprint.slots 的精灵图槽位键（steps(N) 序列帧，零 JS）。 */
    slot: string;
    position: MotionPosition;
}

export type MotionElement = MotionTextElement | MotionImageElement | MotionSpriteElement;

export interface MotionBlueprintShot {
    shot_id: string;
    start_ms: number;
    end_ms: number;
    /** M2 验收口径：默认 code（写实层 live_action 二阶段）。 */
    layer: MotionShotLayer;
    enter: MotionAnimation;
    exit: MotionAnimation;
    elements: MotionElement[];
}

export interface MotionBlueprintTransition {
    /** 转场作用于该 shot 的结尾（下一 shot 入场前）。 */
    after_shot: string;
    type: MotionTransitionType;
    duration_ms: number;
}

export interface MotionBlueprintTheme {
    colors: Record<string, string>;
    fonts: Record<string, string>;
    title_size_ratio: number;
}

export interface MotionBlueprintCanvas {
    width: number;
    height: number;
    fps: number;
    duration_ms: number;
}

/** 预置整镜模板：shots 片段 + CSS 关键帧 + 人工精修说明。 */
export interface MotionPreset {
    id: MotionPresetId;
    name: string;
    /** 一句话用途（运营一键推荐时的展示文案）。 */
    tagline: string;
    description: string;
    shots: MotionBlueprintShot[];
    transitions: MotionBlueprintTransition[];
    /** 本模板用到的全部 @keyframes（与 nxf 渲染器生成物同构，供人工审查/回归）。 */
    cssKeyframes: string;
    /** 人工精修说明（推荐值采纳后运营该看什么、调什么）。 */
    refineNotes: string[];
}

export type MotionPresetId = "speaker-bar" | "product-closeup" | "mood-transition";

// --------------------------------------------------------------------------- #
// 共享默认值（模板 theme 引用解析基准 / 装配层种子值）
// --------------------------------------------------------------------------- #

/** 默认主题：模板中 @theme.colors.* 引用的解析基准，也是一键推荐的种子主题。 */
export const OMNIREPLICA_DEFAULT_THEME: MotionBlueprintTheme = {
    colors: {
        // 电商暖调主色（节庆可换肤：只改 theme 块，零成本改稿——R3 镜头级缓存前提）
        primary: "#FF4D4F",
        text: "#FFFFFF",
        stroke: "#0B0B12",
        accent: "#FFD666",
        mood: "#1F1B2E",
    },
    fonts: { title: "msyhbd.ttc" },
    title_size_ratio: 0.075,
};

/** 默认画布：9:16 竖屏（抖音/视频号信息流），fps 24 试水默认（R6 裁决可配 24/30）。 */
export const OMNIREPLICA_DEFAULT_CANVAS: MotionBlueprintCanvas = {
    width: 1080,
    height: 1920,
    fps: 24,
    duration_ms: 0,
};

// --------------------------------------------------------------------------- #
// 模板一：口播条（底部字幕条 + 关键词弹跳放大）
//
// 版式逻辑：钩子大标题先手抓眼 → 底部字幕条跟随口播 → 关键词弹跳放大做记忆点。
// 适用：真人口播带货、功能解说、低价跑量款。节奏基准：3s 一个爆点。
// --------------------------------------------------------------------------- #

const SPEAKER_BAR_PRESET: MotionPreset = {
    id: "speaker-bar",
    name: "口播条",
    tagline: "底部字幕条 + 关键词弹跳放大，口播带货黄金版式",
    description:
        "钩子大标题抓眼 → 底部字幕条跟随口播（建议与词级 ASR 台词对齐）→ 关键词弹跳放大制造记忆点。适合真人口播带货与功能解说，3s 一个爆点。",
    shots: [
        {
            shot_id: "shot_1",
            start_ms: 0,
            end_ms: 3000,
            layer: "code",
            enter: { type: "fade", duration_ms: 300, easing: "ease-out" },
            exit: { type: "fade", duration_ms: 300 },
            elements: [
                {
                    element_id: "title_1",
                    type: "text",
                    text: "家人们谁懂啊",
                    position: { x: 0.5, y: 0.16 },
                    size_ratio: 0.072,
                    color: "@theme.colors.text",
                    stroke: { color: "@theme.colors.stroke", width_ratio: 0.006 },
                    enter: { type: "pop", duration_ms: 320, delay_ms: 180 },
                },
                {
                    element_id: "subtitle_1",
                    type: "text",
                    text: "今天这条真的绝",
                    position: { x: 0.5, y: 0.84 },
                    size_ratio: 0.042,
                    color: "@theme.colors.text",
                    stroke: { color: "@theme.colors.stroke", width_ratio: 0.005 },
                    enter: { type: "fade-up", duration_ms: 400, delay_ms: 520 },
                },
            ],
        },
        {
            shot_id: "shot_2",
            start_ms: 3000,
            end_ms: 6000,
            layer: "code",
            enter: { type: "fade", duration_ms: 250, easing: "ease-out" },
            exit: { type: "fade", duration_ms: 300 },
            elements: [
                {
                    element_id: "keyword_1",
                    type: "text",
                    text: "闭眼入",
                    position: { x: 0.5, y: 0.44 },
                    size_ratio: 0.115,
                    color: "@theme.colors.primary",
                    stroke: { color: "@theme.colors.stroke", width_ratio: 0.008 },
                    enter: { type: "pop", duration_ms: 360, delay_ms: 140 },
                    exit: { type: "scale-down", duration_ms: 280 },
                },
            ],
        },
    ],
    transitions: [{ after_shot: "shot_1", type: "cross-fade", duration_ms: 200 }],
    cssKeyframes: `/* 口播条模板关键帧（与 nxf code-render 生成物同构；enter/exit 命名空间隔离） */
@keyframes omni-enter-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes omni-enter-fade-up { from { opacity: 0; transform: translateY(12%); } to { opacity: 1; transform: translateY(0); } }
@keyframes omni-enter-pop {
    0% { opacity: 0; transform: scale(0.6); }
    60% { opacity: 1; transform: scale(1.08); }
    100% { opacity: 1; transform: scale(1); }
}
@keyframes omni-exit-fade { from { opacity: 1; } to { opacity: 0; } }
@keyframes omni-exit-scale-down { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.72); } }
@keyframes omni-transition-cross-fade { from { opacity: 0; } to { opacity: 1; } }`,
    refineNotes: [
        "字幕文本建议与词级 ASR 窗内台词对齐（e-reverse PFT.words 双源注入），subtitle 的 delay_ms ≈ 该镜台词起始偏移；",
        "关键词弹跳每镜只保留 1 个（超过 2 个显乱），text 建议 ≤6 字，size_ratio 0.115 ≈ 124px @1080 宽；",
        "长标题（>10 字）把 title size_ratio 降到 0.055 防出屏；字幕条底色当前用 text+stroke 描边表达（契约内），若渲染器支持元素底色可换实体条【待 nxf 确认】；",
        "整段时长按口播实际时长伸缩：shot_2 起点 = 关键词台词出现点，避免声画错位。",
    ],
};

// --------------------------------------------------------------------------- #
// 模板二：产品特写（居中大图 + 推近 + 卖点文字逐条飞出）
//
// 版式逻辑：产品大图推近抓眼 → 卖点逐条飞出（节奏等差）→ CTA 收尾。
// 适用：单品卖点讲解、礼盒/小家电、需要聚焦商品主体的镜头。
// --------------------------------------------------------------------------- #

const PRODUCT_CLOSEUP_PRESET: MotionPreset = {
    id: "product-closeup",
    name: "产品特写",
    tagline: "居中大图推近 + 卖点逐条飞出 + CTA 收尾",
    description:
        "产品大图 zoom-in 推近抓眼，卖点文字按等差延迟逐条飞出，结尾大字 CTA + 产品回归。适合单品卖点讲解与商品主体聚焦。",
    shots: [
        {
            shot_id: "shot_1",
            start_ms: 0,
            end_ms: 2600,
            layer: "code",
            enter: { type: "zoom-in", duration_ms: 900, easing: "ease-out" },
            exit: { type: "fade", duration_ms: 260 },
            elements: [
                {
                    element_id: "product_1",
                    type: "image",
                    slot: "product_main",
                    position: { x: 0.5, y: 0.52 },
                    size_ratio: 0.62,
                    enter: { type: "zoom-in", duration_ms: 900 },
                },
                {
                    element_id: "selling_1",
                    type: "text",
                    text: "3秒读懂它",
                    position: { x: 0.5, y: 0.13 },
                    size_ratio: 0.062,
                    color: "@theme.colors.text",
                    stroke: { color: "@theme.colors.stroke", width_ratio: 0.006 },
                    enter: { type: "fade-down", duration_ms: 400, delay_ms: 500 },
                },
            ],
        },
        {
            shot_id: "shot_2",
            start_ms: 2600,
            end_ms: 5400,
            layer: "code",
            enter: { type: "fade", duration_ms: 300, easing: "ease-out" },
            exit: { type: "fade", duration_ms: 300 },
            elements: [
                {
                    element_id: "selling_2",
                    type: "text",
                    text: "卖点一 · 颜值即正义",
                    position: { x: 0.5, y: 0.3 },
                    size_ratio: 0.048,
                    color: "@theme.colors.text",
                    stroke: { color: "@theme.colors.stroke", width_ratio: 0.005 },
                    enter: { type: "slide-left", duration_ms: 420, delay_ms: 0 },
                },
                {
                    element_id: "selling_3",
                    type: "text",
                    text: "卖点二 · 实力能打",
                    position: { x: 0.5, y: 0.42 },
                    size_ratio: 0.048,
                    color: "@theme.colors.text",
                    stroke: { color: "@theme.colors.stroke", width_ratio: 0.005 },
                    enter: { type: "slide-left", duration_ms: 420, delay_ms: 320 },
                },
                {
                    element_id: "selling_4",
                    type: "text",
                    text: "卖点三 · 价格真香",
                    position: { x: 0.5, y: 0.54 },
                    size_ratio: 0.048,
                    color: "@theme.colors.text",
                    stroke: { color: "@theme.colors.stroke", width_ratio: 0.005 },
                    enter: { type: "slide-left", duration_ms: 420, delay_ms: 640 },
                },
            ],
        },
        {
            shot_id: "shot_3",
            start_ms: 5400,
            end_ms: 8000,
            layer: "code",
            enter: { type: "fade", duration_ms: 300, easing: "ease-out" },
            exit: { type: "fade", duration_ms: 300 },
            elements: [
                {
                    element_id: "cta_1",
                    type: "text",
                    text: "立即抢购",
                    position: { x: 0.5, y: 0.4 },
                    size_ratio: 0.095,
                    color: "@theme.colors.primary",
                    stroke: { color: "@theme.colors.stroke", width_ratio: 0.008 },
                    enter: { type: "pop", duration_ms: 380, delay_ms: 200 },
                    exit: { type: "scale-down", duration_ms: 300 },
                },
                {
                    element_id: "product_2",
                    type: "image",
                    slot: "product_main",
                    position: { x: 0.5, y: 0.64 },
                    size_ratio: 0.46,
                    enter: { type: "zoom-in", duration_ms: 600, delay_ms: 300 },
                },
            ],
        },
    ],
    transitions: [
        { after_shot: "shot_1", type: "cross-fade", duration_ms: 180 },
        { after_shot: "shot_2", type: "dip-to-black", duration_ms: 240 },
    ],
    cssKeyframes: `/* 产品特写模板关键帧（与 nxf code-render 生成物同构；enter/exit/transition 命名空间隔离） */
@keyframes omni-enter-zoom-in { from { opacity: 0; transform: scale(0.72); } to { opacity: 1; transform: scale(1); } }
@keyframes omni-enter-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes omni-enter-fade-down { from { opacity: 0; transform: translateY(-12%); } to { opacity: 1; transform: translateY(0); } }
@keyframes omni-enter-slide-left { from { opacity: 0; transform: translateX(24%); } to { opacity: 1; transform: translateX(0); } }
@keyframes omni-enter-pop {
    0% { opacity: 0; transform: scale(0.6); }
    60% { opacity: 1; transform: scale(1.08); }
    100% { opacity: 1; transform: scale(1); }
}
@keyframes omni-exit-fade { from { opacity: 1; } to { opacity: 0; } }
@keyframes omni-exit-scale-down { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.72); } }
@keyframes omni-transition-cross-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes omni-transition-dip-to-black {
    0% { opacity: 0; }
    50% { opacity: 1; background: #000; }
    100% { opacity: 0; }
}`,
    refineNotes: [
        "卖点逐条飞出节奏：delay 等差 320ms；单镜卖点 ≤4 条，超出拆镜（每条 0.8~1.2s）；",
        "product_main 槽由物料层抠图提供（matting 透明底）；size_ratio 语义以 nxf 渲染器实作为准【待程不宕确认】；",
        "zoom-in 推近 900ms 配 ease-out；产品图预留 12% 安全边距，防推近末端裁切边缘；",
        "CTA 前 dip-to-black 240ms 制造停顿；快节奏带货可改 cut（0ms）提节奏；换肤只改 theme.colors.primary 即变 CTA 色（零成本改稿）。",
    ],
};

// --------------------------------------------------------------------------- #
// 模板三：氛围过场（全屏色块切换 + 精灵图飞入 + 标题淡入）
//
// 版式逻辑：全屏色块定调 → dip-to-white 切换 → 精灵图飞入活跃气氛 → 标题淡入。
// 适用：章节分隔、情绪铺垫、多 SKU 场景串联、片头片尾包装。
// --------------------------------------------------------------------------- #

const MOOD_TRANSITION_PRESET: MotionPreset = {
    id: "mood-transition",
    name: "氛围过场",
    tagline: "全屏色块切换 + 精灵图飞入 + 标题淡入",
    description:
        "全屏色块定调，转场切白/切黑过场，精灵图序列帧飞入活跃气氛，标题淡入收束。适合章节分隔、情绪铺垫与片头片尾包装。",
    shots: [
        {
            shot_id: "shot_1",
            start_ms: 0,
            end_ms: 2000,
            layer: "code",
            enter: { type: "fade", duration_ms: 300, easing: "ease-out" },
            exit: { type: "fade", duration_ms: 260 },
            elements: [
                {
                    element_id: "mood_block_1",
                    type: "image",
                    slot: "mood_block",
                    position: { x: 0.5, y: 0.5 },
                    size_ratio: 1,
                    enter: { type: "fade", duration_ms: 300 },
                },
                {
                    element_id: "mood_title_1",
                    type: "text",
                    text: "氛围标题",
                    position: { x: 0.5, y: 0.5 },
                    size_ratio: 0.09,
                    color: "@theme.colors.text",
                    stroke: { color: "@theme.colors.stroke", width_ratio: 0.006 },
                    enter: { type: "fade", duration_ms: 600, delay_ms: 300 },
                },
            ],
        },
        {
            shot_id: "shot_2",
            start_ms: 2000,
            end_ms: 5000,
            layer: "code",
            enter: { type: "fade", duration_ms: 300, easing: "ease-out" },
            exit: { type: "fade", duration_ms: 300 },
            elements: [
                {
                    element_id: "sprite_1",
                    type: "sprite",
                    slot: "mood_sprite",
                    position: { x: 0.5, y: 0.58 },
                    size_ratio: 0.34,
                    enter: { type: "slide-right", duration_ms: 500, delay_ms: 200 },
                },
                {
                    element_id: "mood_title_2",
                    type: "text",
                    text: "第二幕标题",
                    position: { x: 0.5, y: 0.2 },
                    size_ratio: 0.075,
                    color: "@theme.colors.accent",
                    stroke: { color: "@theme.colors.stroke", width_ratio: 0.005 },
                    enter: { type: "fade", duration_ms: 500, delay_ms: 600 },
                },
            ],
        },
    ],
    transitions: [{ after_shot: "shot_1", type: "dip-to-white", duration_ms: 260 }],
    cssKeyframes: `/* 氛围过场模板关键帧（与 nxf code-render 生成物同构；enter/transition 命名空间隔离） */
@keyframes omni-enter-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes omni-enter-slide-right { from { opacity: 0; transform: translateX(-24%); } to { opacity: 1; transform: translateX(0); } }
@keyframes omni-exit-fade { from { opacity: 1; } to { opacity: 0; } }
@keyframes omni-transition-dip-to-white {
    0% { opacity: 0; }
    50% { opacity: 1; background: #FFF; }
    100% { opacity: 0; }
}`,
    refineNotes: [
        "mood_block 为全屏色块占位（物料层生成纯色 PNG 走 image 槽，或渲染器背景通道就位后改背景属性）；size_ratio 1=满幅【语义以 nxf 渲染器实作为准】；",
        "sprite 走 background-position + steps(N) 序列帧（零 JS）；飞入用 slide-right，需要环绕感可换 flip-x；",
        "dip-to-white 260ms 用于明快切换；暗调视频改 dip-to-black，时长保持 240~280ms 防拖沓；",
        "标题淡入 delay 建议 ≥ 色块/精灵入场时长（本模板 600ms），避免元素叠噪；节庆换肤只改 theme.colors.mood/primary。",
    ],
};

// --------------------------------------------------------------------------- #
// 模板注册表（一键推荐数据源；顺序 = 运营推荐位顺序）
// --------------------------------------------------------------------------- #

export const MOTION_PRESETS: MotionPreset[] = [SPEAKER_BAR_PRESET, PRODUCT_CLOSEUP_PRESET, MOOD_TRANSITION_PRESET];

/** 按 id 取模板（一键推荐入口；未命中返回 undefined，由调用方走人工编辑）。 */
export function getMotionPreset(id: string): MotionPreset | undefined {
    return MOTION_PRESETS.find((preset) => preset.id === id);
}
