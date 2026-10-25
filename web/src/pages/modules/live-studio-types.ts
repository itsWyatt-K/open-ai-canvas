// 直播间装修台类型（与 nxf /api/v1/ecommerce/vision/render-banner、live-compose 对齐）。
export type LiveBannerText = {
    text: string;
    font_size: number;
    color: string;
    bold: boolean;
    font: string;
    stroke_color: string;
    stroke_width: number;
    shadow_blur: number;
    shadow_offset_x: number;
    shadow_offset_y: number;
    shadow_opacity: number;
    shadow_color: string;
    x: number;
    y: number;
    align: string;
    line_spacing: number;
};

export type LiveSubject = {
    image: string;
    name: string;
    x: number;
    y: number;
    scale: number;
    shadow: boolean;
};

export type LiveComposeResult = {
    ok: boolean;
    error?: string;
    composed_png?: string;
    banner_png?: string;
    width?: number;
    height?: number;
    subject_layers?: string[];
    psd_base64?: string;
    psd_bytes?: number;
};
