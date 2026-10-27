/**
 * 商品透明主体资产卡（返工令一-1）：
 * 左【原始商品图】→ 右【BiRefNet 透明底主体（CSS 灰白棋盘格）】。
 * 新商品打开时自动异步提取（localStorage 按 resourceId 缓存），
 * 也提供一键「✂️ 提取透明商品主体」；提取结果通过 onCutout 回调上抛，
 * 供顶部精修台入口与 7 屏海报草图共用。
 */
import { useCallback, useEffect, useState } from "react";
import { App, Button } from "antd";
import { ArrowRight, ExternalLink, Scissors, Sparkles } from "lucide-react";

import { cacheCutout, cachedCutout, nxfPost, urlToDataUrl } from "./vision-client";

type Props = {
    sourceResourceId: string;
    onCutout: (dataUrl: string) => void;
    /** 顶部精修台主按钮（全天候可用）。 */
    onOpenRetouch: () => void;
    /** 返工令四：原图送入工作台画布（复用画布内置图片工具垫图再创作）。 */
    onSendToCanvas?: () => void;
};

const CHECKER = "bg-[conic-gradient(#00000014_90deg,#00000000_90deg_180deg,#00000014_180deg_270deg,#00000000_270deg)] bg-[length:16px_16px]";

export function ProductCutoutCard({ sourceResourceId, onCutout, onOpenRetouch, onSendToCanvas }: Props) {
    const { message } = App.useApp();
    const [cutout, setCutout] = useState(() => cachedCutout(sourceResourceId));
    const [extracting, setExtracting] = useState(false);
    const [failed, setFailed] = useState(false);

    const extract = useCallback(async (silent: boolean) => {
        if (!sourceResourceId || extracting) return;
        setExtracting(true);
        setFailed(false);
        try {
            const source = await urlToDataUrl(`/api/resources/${sourceResourceId}/file`);
            const result = await nxfPost<{ cutout_png: string; degraded: boolean; provider: string }>(
                "/api/v1/ecommerce/vision/matting",
                { image: source, feather_px: 2 },
            );
            if (!result.ok || !result.cutout_png) throw new Error(result.error || "抠图失败");
            setCutout(result.cutout_png);
            cacheCutout(sourceResourceId, result.cutout_png);
            onCutout(result.cutout_png);
            if (!silent) {
                message.success(result.degraded ? "已用兜底档提取（放置权重后自动升级）" : "透明商品主体已就绪（BiRefNet）");
            }
        } catch (error) {
            setFailed(true);
            if (!silent) message.error(error instanceof Error ? error.message : "提取透明主体失败");
        } finally {
            setExtracting(false);
        }
    }, [sourceResourceId, extracting, message, onCutout]);

    // 打开商品即自动异步提取（静默；已有缓存则直接上抛供海报草图/精修台用）。
    useEffect(() => {
        setCutout(cachedCutout(sourceResourceId));
    }, [sourceResourceId]);
    useEffect(() => {
        if (cutout) onCutout(cutout);
        else void extract(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 只按商品切换触发一次
    }, [sourceResourceId]);

    return (
        <section className="flex flex-wrap items-stretch gap-3 rounded-xl border border-border/60 bg-surface p-3">
            <div className="flex items-center gap-3">
                <figure className="relative size-28 overflow-hidden rounded-lg border border-border/50 bg-surface-active">
                    <img src={`/api/resources/${sourceResourceId}/file`} alt="原始商品图" className="size-full object-cover" />
                    <figcaption className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 text-center text-[10px] text-white">原图</figcaption>
                </figure>
                <ArrowRight className="size-4 shrink-0 text-foreground/35" />
                <figure className={`relative size-28 overflow-hidden rounded-lg border border-border/50 ${CHECKER}`}>
                    {cutout ? (
                        <img src={cutout} alt="透明商品主体" className="size-full object-contain drop-shadow-[0_6px_10px_rgba(0,0,0,0.25)]" />
                    ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center">
                            {extracting ? (
                                <>
                                    <Scissors className="size-5 animate-pulse text-primary" />
                                    <span className="text-[10px] text-foreground/55">BiRefNet 提取中…</span>
                                </>
                            ) : (
                                <>
                                    <span className="text-[10px] text-foreground/50">{failed ? "提取失败" : "尚未提取"}</span>
                                    <Button size="small" type="link" className="!h-auto !p-0 text-[11px]" onClick={() => void extract(false)}>
                                        ✂️ 立即提取
                                    </Button>
                                </>
                            )}
                        </div>
                    )}
                    <figcaption className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 text-center text-[10px] text-white">透明主体</figcaption>
                </figure>
            </div>
            <div className="flex min-w-[220px] flex-1 flex-col justify-center gap-2">
                <p className="text-xs leading-5 text-foreground/60">
                    透明主体由 BiRefNet 高精抠图生成，是七屏海报与分层导出的商品资产（100% 锁主体：生图只画场景，商品像素永不变形）。
                </p>
                <Button
                    type="primary"
                    size="large"
                    className="!inline-flex !items-center !gap-1.5 !bg-gradient-to-r !from-indigo-500 !to-fuchsia-500 !text-white !border-none"
                    icon={<Sparkles className="size-4" />}
                    onClick={onOpenRetouch}
                >
                    ✨ 透明分层精修台（抠图 / 擦除 / 打光 / PSD）
                </Button>
                {onSendToCanvas ? (
                    <Button size="small" type="link" className="!h-auto !self-start !p-0 text-[11px]" icon={<ExternalLink className="size-3" />} onClick={onSendToCanvas}>
                        原图送画布：用画布内置「创建编辑副本」垫图再创作
                    </Button>
                ) : null}
            </div>
        </section>
    );
}
