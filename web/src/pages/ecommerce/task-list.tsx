// 任务列表栏：顶部工具栏（计数/全选/搜索/筛选/删除/导入/批量矩阵）+ 任务卡。
// 交互原则：状态徽章一眼懂、进度摘要一行明、危险操作必确认、空态有引导。
import { useMemo, useState } from "react";
import { App, Button, Checkbox, Input, Select } from "antd";
import { Grid3x3, Plus, Trash2 } from "lucide-react";

import { ECOMMERCE_STATUS_LABELS, summarizeProgress, type EcommerceProductSummary } from "@/services/api/ecommerce";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";
import { EcommerceImportDialog } from "./import-dialog";
import { EcommerceBatchMatrixDialog } from "./batch-matrix-dialog";

const STATUS_FILTERS = [
    { label: "全部任务", value: "all" },
    { label: "未开始", value: "draft" },
    { label: "进行中", value: "running" },
    { label: "待确认方案", value: "review" },
    { label: "失败", value: "failed" },
    { label: "结果待确认", value: "uncertain" },
    { label: "已完成", value: "completed" },
];

const STATUS_TONE: Record<string, string> = {
    draft: "bg-foreground/10 text-foreground/60",
    queued: "bg-foreground/10 text-foreground/60",
    running: "bg-purple-500/15 text-purple-600",
    review: "bg-purple-500/15 text-purple-600",
    failed: "bg-destructive/15 text-destructive",
    uncertain: "bg-amber-500/15 text-amber-600",
    completed: "bg-emerald-500/15 text-emerald-600",
    completed_with_warnings: "bg-emerald-500/15 text-emerald-600",
    paused: "bg-foreground/10 text-foreground/60",
};

export function EcommerceTaskList({ activeId, onOpen }: { activeId: string | null; onOpen: (id: string) => void }) {
    const { message, modal } = App.useApp();
    const products = useEcommerceWorkspaceStore((state) => state.products);
    const query = useEcommerceWorkspaceStore((state) => state.query);
    const status = useEcommerceWorkspaceStore((state) => state.status);
    const selectedIds = useEcommerceWorkspaceStore((state) => state.selectedIds);
    const setQuery = useEcommerceWorkspaceStore((state) => state.setQuery);
    const setStatus = useEcommerceWorkspaceStore((state) => state.setStatus);
    const toggleSelected = useEcommerceWorkspaceStore((state) => state.toggleSelected);
    const selectAll = useEcommerceWorkspaceStore((state) => state.selectAll);
    const clearSelected = useEcommerceWorkspaceStore((state) => state.clearSelected);
    const removeProducts = useEcommerceWorkspaceStore((state) => state.removeProducts);
    const [importOpen, setImportOpen] = useState(false);
    // v60：批量企划矩阵（商品 × 屏序）。
    const [matrixOpen, setMatrixOpen] = useState(false);

    const allChecked = products.length > 0 && selectedIds.length === products.length;
    const selectedNames = useMemo(
        () => products.filter((item) => selectedIds.includes(item.id)).map((item) => item.name),
        [products, selectedIds],
    );

    const handleDeleteSelected = () => {
        if (selectedIds.length === 0) return;
        modal.confirm({
            title: `删除勾选的 ${selectedIds.length} 个商品任务？`,
            content: `将删除：${selectedNames.slice(0, 5).join("、")}${selectedNames.length > 5 ? ` 等 ${selectedNames.length} 个` : ""}。已生成的成品图会保留，删除后不可恢复。`,
            okText: "确认删除",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                const refused = await removeProducts(selectedIds);
                const refusedCount = Object.keys(refused).length;
                if (refusedCount > 0) {
                    message.warning(`${refusedCount} 个任务进行中或待确认，已保留；其余已删除`);
                } else {
                    message.success("已删除");
                }
            },
        });
    };

    return (
        <aside className="flex h-full w-[320px] shrink-0 flex-col border-r border-border/60 bg-surface">
            {/* 顶部工具栏：标题禁止换行，按钮紧凑排布，避免 300px 下被压成竖排 */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 p-4">
                <div className="flex shrink-0 items-center gap-2">
                    <Checkbox
                        checked={allChecked}
                        indeterminate={selectedIds.length > 0 && !allChecked}
                        onChange={(event) => (event.target.checked ? selectAll(products.map((item) => item.id)) : clearSelected())}
                        aria-label="全选商品任务"
                    />
                    <span className="whitespace-nowrap text-sm font-medium">商品任务 {products.length > 0 ? `(${products.length})` : ""}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button
                        size="small"
                        type="text"
                        disabled={products.length === 0}
                        onClick={() => setMatrixOpen(true)}
                        icon={<Grid3x3 className="size-3.5" />}
                        aria-label="批量企划矩阵"
                    >
                        矩阵
                    </Button>
                    <Button size="small" type="text" danger disabled={selectedIds.length === 0} onClick={handleDeleteSelected} icon={<Trash2 className="size-3.5" />} aria-label="删除勾选商品">
                        删除{selectedIds.length > 0 ? `(${selectedIds.length})` : ""}
                    </Button>
                    <Button size="small" type="primary" onClick={() => setImportOpen(true)} icon={<Plus className="size-3.5" />}>
                        导入商品
                    </Button>
                </div>
            </div>
            <Input.Search
                allowClear
                placeholder="搜索商品名称"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onSearch={() => void useEcommerceWorkspaceStore.getState().refreshProducts()}
            />
            {/* 状态筛选：改为全宽 Select，彻底消除 7 项状态在 Segmented 中的文字截断 */}
            <div className="shrink-0 border-b border-border/60 px-3 py-2">
                <Select
                    className="w-full"
                    size="small"
                    value={status}
                    options={STATUS_FILTERS}
                    onChange={(value) => {
                        setStatus(String(value));
                        void useEcommerceWorkspaceStore.getState().refreshProducts();
                    }}
                />
            </div>

            {/* 任务卡列表 */}
            <div className="flex-1 overflow-y-auto p-3">
                {products.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
                        <p className="text-base font-semibold">从一张商品图，到一套完整成品</p>
                        <p className="text-xs leading-5 text-foreground/55">
                            01 在右侧「生成配置」选模型与规格
                            <br />
                            02 导入商品图
                            <br />
                            03 批量生成主图 · 详情页 · 标题
                        </p>
                        <Button type="primary" onClick={() => setImportOpen(true)} icon={<Plus className="size-4" />}>
                            导入第一张商品图
                        </Button>
                    </div>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {products.map((product) => (
                            <TaskCard
                                key={product.id}
                                product={product}
                                active={product.id === activeId}
                                selected={selectedIds.includes(product.id)}
                                onToggle={() => toggleSelected(product.id)}
                                onOpen={() => onOpen(product.id)}
                            />
                        ))}
                    </ul>
                )}
            </div>

            <EcommerceImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
            <EcommerceBatchMatrixDialog open={matrixOpen} products={products} onClose={() => setMatrixOpen(false)} onOpenProduct={onOpen} />
        </aside>
    );
}

function TaskCard({ product, active, selected, onToggle, onOpen }: { product: EcommerceProductSummary; active: boolean; selected: boolean; onToggle: () => void; onOpen: () => void }) {
    return (
        <li
            className={`flex cursor-pointer gap-3 rounded-lg border p-2.5 transition-colors ${
                active ? "border-primary/60 bg-primary/5" : "border-border/50 hover:border-border"
            }`}
            onClick={onOpen}
        >
            <div className="flex items-start pt-1">
                {/* 阶段 0 修复：勾选商品时同步在中间栏打开该商品详情，消除勾选与预览割裂 */}
                <Checkbox
                    checked={selected}
                    onChange={(event) => {
                        onToggle();
                        if (event.target.checked) onOpen();
                    }}
                    aria-label={`选择 ${product.name}`}
                />
            </div>
            {product.thumbnailUrl ? (
                <img src={product.thumbnailUrl} alt="" className="size-12 shrink-0 rounded-md object-cover" />
            ) : (
                <div className="size-12 shrink-0 rounded-md bg-surface-active" />
            )}
            <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                    <strong className="truncate text-sm">{product.name}</strong>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${STATUS_TONE[product.status] || STATUS_TONE.draft}`}>
                        {ECOMMERCE_STATUS_LABELS[product.status] || product.status}
                    </span>
                </div>
                <p className="mt-1 truncate text-xs text-foreground/55">{summarizeProgress(product)}</p>
            </div>
        </li>
    );
}
