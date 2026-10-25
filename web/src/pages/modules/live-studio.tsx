// 直播间装修与透明分层台（拍板令阶段三：/modules/live-studio）。
// 流程：选平台预设 → 上传/生成背景 → 上传商品原图自动 BiRefNet 抠主体 → 加文字 Banner →
//      合成预览（接触阴影/安全区）→ 导出 PNG + 分层 PSD。
import { useCallback, useMemo, useState } from "react";
import { App, Button } from "antd";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Link } from "react-router";

import { LayerStudioWorkbench } from "./layer-studio-workbench";
import { LIVE_BANNER_PRESETS, LIVE_DEFAULT_CANVAS, LIVE_PLATFORMS, type LivePlatformKey } from "./platforms-live";
import type { LiveBannerText } from "./live-studio-types";

export function LiveStudioPage() {
    const { message } = App.useApp();
    const [platform, setPlatform] = useState<LivePlatformKey>("douyin");
    const preset = LIVE_PLATFORMS[platform];
    const [banners, setBanners] = useState<LiveBannerText[]>(() => [
        // 预设是 Partial：用完整默认值兜底后再铺开。
        {
            text: "直播间限时秒杀", font_size: 120, color: "#FFE066", bold: true, font: "",
            stroke_color: "#7A1010", stroke_width: 6, shadow_blur: 8, shadow_offset_x: 0, shadow_offset_y: 6,
            shadow_opacity: 0.5, shadow_color: "#000000", align: "center", line_spacing: 1.25,
            x: 0.5, y: 0.18,
        },
    ]);
    const [subjects, setSubjects] = useState<Array<{ image: string; name: string; x: number; y: number; scale: number; shadow: boolean }>>([]);
    const [backgroundUrl, setBackgroundUrl] = useState("");

    const insertPreset = useCallback((label: string) => {
        const presetDef = LIVE_BANNER_PRESETS.find((item) => item.label === label);
        if (!presetDef) return;
        const slot = preset.badgeSlots.find((slot2) => slot2.label === label) || preset.badgeSlots[0];
        setBanners((prev) => [...prev, {
            shadow_opacity: 0.5, shadow_color: "#000000", shadow_offset_x: 0,
            font: "", align: "center", line_spacing: 1.25,
            ...presetDef.banner, x: slot.x, y: slot.y,
        } as LiveBannerText]);
        message.success(`已插入预设「${label}」（${slot.label}位）`);
    }, [preset, message]);

    const handleSave = useCallback(async (result: { composed: string; psdBase64?: string }) => {
        const png = document.createElement("a");
        png.href = result.composed;
        png.download = `live-${platform}.png`;
        png.click();
        if (result.psdBase64) {
            const psd = document.createElement("a");
            psd.href = "data:application/x-photoshop;base64," + result.psdBase64;
            psd.download = `live-${platform}.psd`;
            psd.click();
        }
        message.success("已导出合成 PNG 与分层 PSD");
    }, [platform, message]);

    const platformButtons = useMemo(() => Object.values(LIVE_PLATFORMS), []);

    return (
        <div className="mx-auto flex min-h-full max-w-[1200px] flex-col gap-4 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <Link to="/modules" className="flex items-center gap-1 text-xs text-foreground/55 hover:text-primary">
                        <ArrowLeft className="size-3.5" /> 返回模块大厅
                    </Link>
                    <h1 className="text-base font-semibold">🎬 直播间装修与透明分层台</h1>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    {platformButtons.map((item) => (
                        <Button key={item.key} size="small" type={item.key === platform ? "primary" : "default"} onClick={() => setPlatform(item.key)}>
                            {item.label}（{item.width}x{item.height}）
                        </Button>
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-foreground/50">促销 Banner 预设：</span>
                {LIVE_BANNER_PRESETS.map((item) => (
                    <Button key={item.label} size="small" icon={<Sparkles className="size-3" />} onClick={() => insertPreset(item.label)}>
                        {item.label}
                    </Button>
                ))}
                <span className="self-center text-[10px] text-foreground/40">（插入后落在本平台角标位，可再拖动微调）</span>
            </div>

            {backgroundUrl ? (
                <LayerStudioWorkbench
                    key={`${platform}-${backgroundUrl.slice(-24)}`}
                    title={`直播间装修 · ${preset.label}`}
                    backgroundUrl={backgroundUrl}
                    initialSubjects={subjects}
                    initialBanners={banners}
                    canvasWidth={preset.width}
                    canvasHeight={preset.height}
                    safeTop={preset.safeTop}
                    safeBottom={preset.safeBottom}
                    onSave={handleSave}
                />
            ) : (
                <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/60 bg-surface px-6 py-16 text-center">
                    <p className="text-sm font-medium">第一步：准备直播间背景图（{preset.width}x{preset.height} 竖版）</p>
                    <p className="max-w-[520px] text-xs leading-5 text-foreground/55">
                        上传一张背景图（可用画布生成后下载），再上传商品原图自动 BiRefNet 抠透明主体，
                        加促销 Banner 文字，一键合成并导出分层 PSD。
                    </p>
                    <label className="cursor-pointer rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white hover:bg-primary/90">
                        上传直播间背景图
                        <input type="file" accept="image/*" className="sr-only" onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = () => { setBackgroundUrl(String(reader.result)); event.target.value = ""; };
                            reader.readAsDataURL(file);
                        }} />
                    </label>
                    <p className="text-[10px] text-foreground/40">
                        MVP 提示：AI 背景生图可在「自由画布」生成后下载回传；本页专注 抠图/文字 Banner/合成/分层导出。
                    </p>
                </div>
            )}
        </div>
    );
}
