/**
 * 批量企划矩阵（电商实战升级 · 阶段三 Step 2 视图 B）。
 *
 * 行 = 商品，列 = 屏序（主图 N + 详情页 M）。单元格：状态色块 + L1 主标题；
 * 异常（失败/无源图/无企划）标红拦截。底部「批量确认并派发」对全部
 * draft/review 商品循环 confirm-plan（模型口径与任务详情页同源 use-config-store）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { App, Button, Table, type TableColumnsType } from "antd";
import { Grid3x3 } from "lucide-react";

import {
    confirmEcommercePlan,
    getEcommerceProductDetail,
    type EcommerceProductDetail,
    type EcommerceProductSummary,
} from "@/services/api/ecommerce";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";
import { useConfigStore } from "@/stores/use-config-store";
import { AppModal } from "@/components/ui/product/app-modal";
// 模块私有样式（含 .ecommerce-matrix-row：content-visibility 行级跳渲，见文件尾注释）。
import "./ecommerce.css";

const CELL_TONE: Record<string, string> = {
    completed: "bg-emerald-500/10 text-emerald-600",
    completed_with_warnings: "bg-emerald-500/10 text-emerald-600",
    failed: "bg-destructive/10 text-destructive",
    uncertain: "bg-amber-500/10 text-amber-600",
    running: "bg-purple-500/10 text-purple-600",
    refining: "bg-purple-500/10 text-purple-600",
    queued: "bg-foreground/5 text-foreground/55",
    draft: "bg-foreground/5 text-foreground/55",
    pending: "bg-foreground/5 text-foreground/55",
};

const MAX_MATRIX_PRODUCTS = 25;

export function EcommerceBatchMatrixDialog({
    open,
    products,
    onClose,
    onOpenProduct,
}: {
    open: boolean;
    products: EcommerceProductSummary[];
    onClose: () => void;
    onOpenProduct: (id: string) => void;
}) {
    const { message, modal } = App.useApp();
    const [details, setDetails] = useState<Record<string, EcommerceProductDetail>>({});
    const [loading, setLoading] = useState(false);
    const [dispatching, setDispatching] = useState(false);

    // 打开时拉详情（详情接口自带对账，屏级状态即最新）。选中商品优先，否则全量（≤25）。
    const targets = useMemo(() => {
        const selected = useEcommerceWorkspaceStore.getState().selectedIds;
        const picked = selected.length > 0 ? products.filter((item) => selected.includes(item.id)) : products;
        return picked.slice(0, MAX_MATRIX_PRODUCTS);
    }, [products, open]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        (async () => {
            const loaded: Record<string, EcommerceProductDetail> = {};
            for (const item of targets) {
                try {
                    loaded[item.id] = await getEcommerceProductDetail(item.id);
                } catch {
                    // 单品失败不拖垮矩阵：行内标红。
                }
                if (cancelled) return;
            }
            if (!cancelled) setDetails(loaded);
        })().finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [open, targets]);

    // 列 = 屏序（按首个商品的槽位序列展开；不同平台屏数不同，取最大列数）。
    const columns: TableColumnsType<EcommerceProductSummary> = useMemo(() => {
        const maxSlots = Math.max(0, ...Object.values(details).map((detail) => detail.slots.length));
        const base: TableColumnsType<EcommerceProductSummary> = [
            {
                title: "商品",
                dataIndex: "name",
                key: "name",
                width: 200,
                render: (name: string, record: EcommerceProductSummary) => (
                    <button className="max-w-full truncate text-left text-xs font-medium hover:text-primary" onClick={() => onOpenProduct(record.id)} title={name}>
                        {name}
                    </button>
                ),
            },
        ];
        for (let i = 0; i < maxSlots; i += 1) {
            base.push({
                title: `屏 ${i + 1}`,
                key: `slot-${i}`,
                width: 130,
                render: (_: unknown, record: EcommerceProductSummary) => {
                    const slot = details[record.id]?.slots[i];
                    if (!slot) return <span className="text-caption text-foreground/30">—</span>;
                    const abnormal = slot.status === "failed" || (!slot.brief && slot.status !== "completed");
                    return (
                        <div
                            className={`rounded px-1.5 py-1 text-caption leading-4 ${CELL_TONE[slot.status] ?? "bg-foreground/5"} ${abnormal ? "ring-1 ring-destructive/40" : ""}`}
                            title={`${slot.kind === "hero" ? "主图" : "详情"} ${slot.slotNo} · ${slot.brief?.screen_title ?? slot.title ?? ""}${slot.errorMessage ? ` · ${slot.errorMessage}` : ""}`}
                        >
                            <div className="truncate font-medium">{slot.brief?.screen_title ?? slot.title ?? slot.slotKey}</div>
                            <div className="opacity-70">{slot.kind === "hero" ? "主图" : "详情"} · {slot.status}</div>
                        </div>
                    );
                },
            });
        }
        return base;
    }, [details, onOpenProduct]);

    const dispatchable = targets.filter((item) => {
        const status = details[item.id]?.product.status ?? item.status;
        return status === "draft" || status === "review";
    });

    const handleBatchConfirm = useCallback(() => {
        if (dispatchable.length === 0) {
            message.info("没有「未开始/待确认」状态的商品可批量派发");
            return;
        }
        modal.confirm({
            title: `批量确认 ${dispatchable.length} 个商品并派发生图？`,
            content: "按当前生成配置的模型口径逐个确认方案并派发；在途满额的屏会自动顺延补派。确认后开始计费。",
            okText: "批量派发",
            cancelText: "取消",
            onOk: async () => {
                setDispatching(true);
                const { resolveModelRequestConfig, modelOptionName } = await import("@/stores/use-config-store");
                // 与任务详情页确认派发同一口径：config + isAiConfigReady 均取自 store 实例。
                const store = useConfigStore.getState();
                const config = store.config;
                if (!config.imageModel || !store.isAiConfigReady(config, config.imageModel)) {
                    message.error("请先在生成配置选择可用生图模型");
                    setDispatching(false);
                    return;
                }
                await useEcommerceWorkspaceStore.getState().flushConfig();
                const requestConfig = resolveModelRequestConfig(config, config.imageModel);
                const options = { channelId: requestConfig.channelId, model: modelOptionName(config.imageModel) };
                let okCount = 0;
                const failures: string[] = [];
                for (const item of dispatchable) {
                    try {
                        await confirmEcommercePlan(item.id, options);
                        okCount += 1;
                    } catch (error) {
                        failures.push(`${item.name}：${error instanceof Error ? error.message : "派发失败"}`);
                    }
                }
                setDispatching(false);
                if (okCount > 0) message.success(`已派发 ${okCount} 个商品`);
                if (failures.length) message.warning(`派发失败 ${failures.length} 个：${failures.slice(0, 3).join("；")}`);
                await useEcommerceWorkspaceStore.getState().refreshProducts();
            },
        });
    }, [dispatchable, message, modal]);

    return (
        <AppModal
            open={open}
            title={
                <span className="flex items-center gap-2">
                    <Grid3x3 className="size-4" />
                    批量企划矩阵（商品 × 屏序）
                    <span className="text-xs font-normal text-foreground/45">标红单元格 = 失败或缺企划，批量派发前请先处理</span>
                </span>
            }
            width={1180}
            onCancel={onClose}
            footer={
                <div className="flex w-full items-center justify-between">
                    <span className="text-xs text-foreground/45">
                        {targets.length} 个商品 · {dispatchable.length} 个待确认
                        {products.length > MAX_MATRIX_PRODUCTS ? `（仅显示前 ${MAX_MATRIX_PRODUCTS}，可用勾选缩小范围）` : ""}
                    </span>
                    <div className="flex gap-1.5">
                        <Button onClick={onClose}>关闭</Button>
                        <Button type="primary" loading={dispatching} disabled={dispatchable.length === 0} onClick={handleBatchConfirm}>
                            批量确认并派发（{dispatchable.length}）
                        </Button>
                    </div>
                </div>
            }
        >
            <Table
                size="small"
                rowKey="id"
                loading={loading}
                dataSource={targets}
                columns={columns}
                pagination={false}
                scroll={{ y: 520 }}
                // 渲染提速：25 商品 × 8 屏的矩阵在低端机滚动逐格重排会掉帧、整页截图超时。
                // 行级 content-visibility: auto 让视口外行只占位不渲染（类定义在 ecommerce.css）。
                rowClassName={() => "ecommerce-matrix-row"}
            />
        </AppModal>
    );
}
