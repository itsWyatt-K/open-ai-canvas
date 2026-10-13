// 任务详情栏：面包屑 + 头部（名称/状态徽章/轮次）+ 槽位网格（主图/详情页分区）
// + 标题面板 + 底部打包下载/历史轮次入口（编排器施工中，先呈现数据与占位）。
import { App, Button, Empty } from "antd";
import { ArrowLeft, Download, History } from "lucide-react";

import {
    ECOMMERCE_SLOT_STATUS_LABELS,
    ECOMMERCE_STATUS_LABELS,
    type EcommerceProductDetail,
} from "@/services/api/ecommerce";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";

const SLOT_STATUS_TONE: Record<string, string> = {
    pending: "bg-foreground/10 text-foreground/55",
    queued: "bg-foreground/10 text-foreground/55",
    refining: "bg-purple-500/15 text-purple-600",
    running: "bg-purple-500/15 text-purple-600",
    failed: "bg-destructive/15 text-destructive",
    uncertain: "bg-amber-500/15 text-amber-600",
    completed: "bg-emerald-500/15 text-emerald-600",
};

const TITLE_STATUS_LABELS: Record<string, string> = {
    pending: "标题未生成",
    running: "标题生成中",
    completed: "标题已生成",
    failed: "标题生成失败",
    uncertain: "标题结果待确认",
};

export function EcommerceTaskDetail({ productId, onBack }: { productId: string | null; onBack: () => void }) {
    const { message } = App.useApp();
    const detail = useEcommerceWorkspaceStore((state) => (productId ? state.detailById[productId] : undefined));
    const loading = useEcommerceWorkspaceStore((state) => state.detailLoading);

    if (!productId) {
        return (
            <section className="flex flex-1 items-center justify-center bg-surface">
                <Empty description="从左侧选择一个商品任务" />
            </section>
        );
    }
    if (loading && !detail) {
        return (
            <section className="flex flex-1 items-center justify-center bg-surface">
                <p className="text-sm text-foreground/55">正在读取商品详情…</p>
            </section>
        );
    }
    if (!detail) {
        return (
            <section className="flex flex-1 items-center justify-center bg-surface">
                <Empty description="商品不存在或已删除" />
            </section>
        );
    }
    const { product } = detail;
    const heroSlots = detail.slots.filter((slot) => slot.kind === "hero");
    const detailSlots = detail.slots.filter((slot) => slot.kind === "detail");

    return (
        <section className="flex flex-1 flex-col overflow-hidden bg-surface">
            {/* 面包屑 + 头部 */}
            <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-4">
                <div className="flex items-center gap-2 text-xs text-foreground/55">
                    <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={onBack}>
                        <ArrowLeft className="size-3.5" />
                        电商工坊
                    </button>
                    <span>/</span>
                    <span className="truncate text-foreground/75">{product.name}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                        <h2 className="truncate text-base font-semibold">{product.name}</h2>
                        <span className="shrink-0 rounded bg-foreground/10 px-2 py-0.5 text-xs text-foreground/70">
                            {ECOMMERCE_STATUS_LABELS[product.status] || product.status}
                        </span>
                        {product.round > 1 ? <span className="shrink-0 text-xs text-foreground/50">第 {product.round} 轮</span> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <Button size="small" icon={<History className="size-3.5" />} onClick={() => message.info("历史轮次切换施工中（M5）")}>
                            历史轮次
                        </Button>
                        <Button
                            size="small"
                            type="primary"
                            icon={<Download className="size-3.5" />}
                            onClick={() => message.info("打包下载施工中（M5）")}
                        >
                            打包下载
                        </Button>
                    </div>
                </div>
                {product.errorMessage ? (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{product.errorMessage}</p>
                ) : null}
            </header>

            {/* 槽位网格 */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
                {detail.slots.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-center">
                        <p className="text-sm text-foreground/65">该商品还没有生成任何槽位</p>
                        <p className="text-xs text-foreground/50">策划编排器施工中（M3）——配置保存后即可派发生成</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6">
                        <SlotGroup title="主图" slots={heroSlots} emptyText="未配置主图槽位" />
                        <SlotGroup title="详情页" slots={detailSlots} emptyText="未配置详情页槽位" />
                        <TitlePanel detail={detail} />
                    </div>
                )}
            </div>
        </section>
    );
}

function SlotGroup({ title, slots, emptyText }: { title: string; slots: EcommerceProductDetail["slots"]; emptyText: string }) {
    if (slots.length === 0) {
        return (
            <div className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold text-foreground/75">{title}</h3>
                <p className="text-xs text-foreground/50">{emptyText}</p>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground/75">
                {title} <span className="font-normal text-foreground/50">· {slots.length} 张</span>
            </h3>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {slots.map((slot) => (
                    <article key={slot.id} className="flex flex-col gap-2 rounded-lg border border-border/50 p-2.5">
                        <div className="relative aspect-square overflow-hidden rounded-md bg-surface-active">
                            {slot.resourceId ? (
                                <img src={`/api/resources/${slot.resourceId}/file`} alt={slot.title || slot.slotKey} className="size-full object-cover" />
                            ) : (
                                <div className="flex size-full items-center justify-center text-xs text-foreground/45">
                                    {ECOMMERCE_SLOT_STATUS_LABELS[slot.status] || slot.status}
                                </div>
                            )}
                            {slot.currentVersion > 0 ? (
                                <span className="absolute right-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">v{slot.currentVersion}</span>
                            ) : null}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                            <strong className="truncate text-xs">{slot.title || slot.slotKey}</strong>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${SLOT_STATUS_TONE[slot.status] || SLOT_STATUS_TONE.pending}`}>
                                {ECOMMERCE_SLOT_STATUS_LABELS[slot.status] || slot.status}
                            </span>
                        </div>
                        {slot.copy ? <p className="line-clamp-2 text-xs text-foreground/55">{slot.copy}</p> : null}
                    </article>
                ))}
            </div>
        </div>
    );
}

function TitlePanel({ detail }: { detail: EcommerceProductDetail }) {
    const { product } = detail;
    return (
        <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground/75">标题</h3>
            <div className="rounded-lg border border-border/50 p-3">
                <div className="flex items-center justify-between gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${SLOT_STATUS_TONE[product.titleStatus] || SLOT_STATUS_TONE.pending}`}>
                        {TITLE_STATUS_LABELS[product.titleStatus] || product.titleStatus}
                    </span>
                </div>
                {product.titleText ? <p className="mt-2 text-sm text-foreground/80">{product.titleText}</p> : null}
            </div>
        </div>
    );
}
