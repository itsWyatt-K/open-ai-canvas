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

/** 常用促销 Banner 预设文案（一键插入后可改；缺省字段由 nxf 默认值兜底）。 */
export const LIVE_BANNER_PRESETS: Array<{ label: string; banner: Partial<LiveBannerText> & Pick<LiveBannerText, "text"> }> = [
    { label: "限时秒杀", banner: { text: "限时秒杀", font_size: 120, color: "#FFE066", bold: true, stroke_color: "#7A1010", stroke_width: 6, shadow_blur: 8, shadow_offset_y: 6 } },
    { label: "第二件 0 元", banner: { text: "第二件 0 元", font_size: 96, color: "#FFFFFF", bold: true, stroke_color: "#123B7A", stroke_width: 5, shadow_blur: 6 } },
    { label: "直播间专享价", banner: { text: "直播间专享价", font_size: 88, color: "#FFF7E6", bold: true, stroke_color: "#B45309", stroke_width: 5, shadow_blur: 6 } },
    { label: "关注主播", banner: { text: "关注主播 不迷路", font_size: 72, color: "#FFFFFF", stroke_color: "#333333", stroke_width: 4, shadow_blur: 5 } },
];

/** 9:16 竖版画布默认尺寸。 */
export const LIVE_DEFAULT_CANVAS = { width: 1080, height: 1920 };
