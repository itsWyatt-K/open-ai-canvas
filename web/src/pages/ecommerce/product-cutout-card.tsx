/**
 * 商品透明主体资产条（返工令一-1 + 返工令三紧凑化）：
 * 左【原始商品图 64×64】→ 右【BiRefNet 透明底主体 64×64（灰白棋盘格）】+ 右侧工具组。
 * 新商品打开时自动异步提取（localStorage 按 resourceId 缓存），
 * 也提供一键「✂️ 提取透明商品主体」；提取结果通过 onCutout 回调上抛，
 * 供顶部精修台入口与 7 屏海报草图共用。
 *
 * 返工令三：原卡片是「两张 112px 大图 + 整段说明 + 拉通整行的香肠按钮」，
 * 把 7 屏画廊挤出首屏；现压缩为一行 64px 资产条：
 *   - 「✨ 分层精修台」宽约 160px（w-auto px-4 py-2），放资产条右侧工具组。
 * 返工令四-4：原图兜底三级回退（URL 缺失 / 加载失败 → 回退展示透明主体；
 * 透明主体也没有 → 隐藏空原图框只留棋盘格主体卡），绝不露裂图灰框；
 * 「✂️ 提取」恢复标准 28px 胶囊（曾被 !h-auto !p-0 压成 14px）。
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
    // 返工令四-4：原图裂图兜底状态（URL 为空或 onError，绝不露浏览器 Broken Image）。
    const [sourceFailed, setSourceFailed] = useState(false);

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
        setSourceFailed(false);
    }, [sourceResourceId]);
    useEffect(() => {
        if (cutout) onCutout(cutout);
        else void extract(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- 只按商品切换触发一次
    }, [sourceResourceId]);

    // 返工令四-4：原图兜底三级回退——
    //   ① URL 正常 → 展示原图；
    //   ② URL 缺失 / 加载失败 → 原图框回退展示透明主体图（有抠图结果时）；
    //   ③ 连透明主体也没有 → 隐藏空原图框（连同箭头），只保留高颜值棋盘格主体卡。
    // 严禁留带裂图图标的灰框。
    const sourceMissing = !sourceResourceId || sourceFailed;
    const showSourceBox = !sourceMissing || Boolean(cutout);

    return (
        <section className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-line-subtle bg-surface-card px-2.5 py-1.5 shadow-card">
            {showSourceBox ? (
                <>
                    {/* 原图 64×64：失败/空 URL 时回退展示透明主体（caption 改为「主体」）。
                        注意 !mb-0：antd reset.css 的 figure{margin:0 0 1em} 是无层规则，
                        会压过 Tailwind 分层工具类，把资产条撑高 13px（返工令三实测）。 */}
                    <figure className="relative !mb-0 size-16 shrink-0 overflow-hidden rounded-control border border-line-subtle bg-surface-active">
                        {sourceMissing ? (
                            <img src={cutout} alt="商品主体（原图缺失，回退展示透明主体）" className="size-full object-contain" />
                        ) : (
                            <img
                                src={`/api/resources/${sourceResourceId}/file`}
                                alt="原始商品图"
                                className="size-full object-cover"
                                onError={() => setSourceFailed(true)}
                            />
                        )}
                        <figcaption className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 text-center text-caption leading-none text-white">
                            {sourceMissing ? "主体" : "原图"}
                        </figcaption>
                    </figure>
                    <ArrowRight className="size-4 shrink-0 text-foreground/35" />
                </>
            ) : null}
            {/* 透明主体 64×64：棋盘格 + 提取状态（提取中 / 失败可重试 / 未提取） */}
            <figure className={`relative !mb-0 size-16 shrink-0 overflow-hidden rounded-control border border-line-subtle ${CHECKER}`}>
                {cutout ? (
                    // object-contain 非矩形阴影必须跟随形状，box-shadow 只能跟矩形；已收敛模糊半径
                    <img src={cutout} alt="透明商品主体" className="size-full object-contain drop-shadow-[0_4px_7px_rgba(0,0,0,0.22)]" />
                ) : (
                    <div className="flex size-full flex-col items-center justify-center gap-1 px-1 text-center">
                        {extracting ? (
                            <>
                                <Scissors className="size-4 animate-pulse text-primary" />
                                <span className="text-caption leading-none text-foreground/55">提取中</span>
                            </>
                        ) : (
                            <>
                                <span className="text-caption leading-none text-foreground/50">{failed ? "提取失败" : "未提取"}</span>
                                {/* 返工令四-4：曾被 !h-auto !p-0 压成 14px 纳米钮；恢复标准 28px 胶囊热区。 */}
                                <Button size="small" type="link" className="!h-7 !px-2.5 !text-caption !leading-none" onClick={() => void extract(false)}>
                                    ✂️ 提取
                                </Button>
                            </>
                        )}
                    </div>
                )}
                <figcaption className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 text-center text-caption leading-none text-white">透明主体</figcaption>
            </figure>
            {/* 右侧工具组：分层精修台（约 160px）+ 送画布（返工令四-6：由 16px 图标链
                改为带文案的标准小按钮，热区 ≥32×28） */}
            <div className="flex shrink-0 items-center gap-2">
                <Button
                    type="primary"
                    size="small"
                    className="!w-auto !px-4 !py-2 !bg-gradient-to-r !from-indigo-500 !to-fuchsia-500 !text-white !border-none"
                    icon={<Sparkles className="size-3.5" />}
                    onClick={onOpenRetouch}
                >
                    ✨ 分层精修台
                </Button>
                {onSendToCanvas ? (
                    <Button
                        size="small"
                        className="!h-7 !w-auto"
                        icon={<ExternalLink className="size-3.5" />}
                        title="原图送画布：用画布内置「创建编辑副本」垫图再创作"
                        onClick={onSendToCanvas}
                    >
                        送画布
                    </Button>
                ) : null}
            </div>
        </section>
    );
}
