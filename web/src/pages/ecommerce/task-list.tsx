// 任务列表栏：标题行（商品列表 N + 导入）+ 搜索 + 勾选浮现的批量工具条 + 状态筛选 + 任务卡。
// 交互原则：状态徽章一眼懂、进度摘要一行明、危险操作必确认、空态有引导。
// 返工令三：左栏固定 240px（w-60）+ overflow-hidden；顶部第一行只放标题与「+ 导入」，
// 「批量矩阵 / 批量删除」移到搜索框下方、仅在勾选商品时浮现——根治 320px 时代
// 五个控件横排溢出、撞击右栏「电商工坊」标题的病灶。
import { useMemo, useState } from "react";
import { App, Button, Checkbox, Input, Select } from "antd";
import { Grid3x3, ImageIcon, Plus, Trash2 } from "lucide-react";

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
        <aside className="flex h-full w-60 shrink-0 flex-col overflow-hidden border-r border-border/60 bg-surface">
            {/* 第一行（唯一常驻控件行）：标题 + 右对齐「+ 导入」。
                240px 下绝不换行、绝不溢出：标题 truncate，按钮 w-auto 紧凑排布。 */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
                <span className="min-w-0 truncate text-sm font-semibold">商品列表 {products.length > 0 ? `(${products.length})` : ""}</span>
                <Button
                    size="small"
                    type="primary"
                    className="!w-auto"
                    onClick={() => setImportOpen(true)}
                    icon={<Plus className="size-3.5" />}
                >
                    导入商品
                </Button>
            </div>
            {/* 搜索框 */}
            <div className="shrink-0 px-3 pt-2">
                <Input.Search
                    allowClear
                    placeholder="搜索商品名称"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onSearch={() => void useEcommerceWorkspaceStore.getState().refreshProducts()}
                />
            </div>
            {/* 批量工具条：仅勾选商品时浮现（不占常驻高度，未勾选时左栏更聚焦列表） */}
            {selectedIds.length > 0 ? (
                <div className="flex shrink-0 items-center gap-1.5 px-3 py-1.5">
                    <Checkbox
                        checked={allChecked}
                        indeterminate={selectedIds.length > 0 && !allChecked}
                        onChange={(event) => (event.target.checked ? selectAll(products.map((item) => item.id)) : clearSelected())}
                        aria-label="全选商品任务"
                    />
                    <span className="shrink-0 text-caption text-foreground/55">已选 {selectedIds.length}</span>
                    <div className="ml-auto flex shrink-0 items-center gap-1">
                        <Button
                            size="small"
                            type="text"
                            className="!w-auto"
                            disabled={products.length === 0}
                            onClick={() => setMatrixOpen(true)}
                            icon={<Grid3x3 className="size-3.5" />}
                            aria-label="批量企划矩阵"
                        >
                            矩阵
                        </Button>
                        <Button
                            size="small"
                            type="text"
                            danger
                            className="!w-auto"
                            onClick={handleDeleteSelected}
                            icon={<Trash2 className="size-3.5" />}
                            aria-label="删除勾选商品"
                        >
                            删除({selectedIds.length})
                        </Button>
                    </div>
                </div>
            ) : null}
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

            {/* 任务卡列表（返工令四-3：p-2 收紧左右留白，把宽度让给商品名首行） */}
            <div className="flex-1 overflow-y-auto p-2">
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
    // 返工令三：缩略图加载失败绝不露浏览器裂图图标——回落干净占位（虚线相框，非灰方块）。
    const [thumbFailed, setThumbFailed] = useState(false);
    const hasThumb = Boolean(product.thumbnailUrl) && !thumbFailed;
    return (
        <li
            className={`flex cursor-pointer gap-2 rounded-lg border p-2 transition-colors ${
                active ? "border-primary/60 bg-primary/5" : "border-border/50 hover:border-border"
            }`}
            onClick={onOpen}
        >
            <div className="flex items-start pt-0.5">
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
            {hasThumb ? (
                <img
                    src={product.thumbnailUrl}
                    alt=""
                    className="size-9 shrink-0 rounded-md object-cover"
                    onError={() => setThumbFailed(true)}
                />
            ) : (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-dashed border-border/70 bg-surface-active/40 text-foreground/30" aria-hidden>
                    <ImageIcon className="size-4" />
                </div>
            )}
            {/* 返工令四-3：第一行只放商品名（min-w-0 flex-1 拿满剩余宽度，240px 栏宽下
                约可完整显示 10 个汉字）；状态徽标移到第二行与进度信息并排，不再抢首行宽度。 */}
            <div className="min-w-0 flex-1">
                <strong className="block truncate text-[13px] font-medium leading-5" title={product.name}>
                    {product.name}
                </strong>
                <div className="mt-1 flex items-center gap-1.5">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${STATUS_TONE[product.status] || STATUS_TONE.draft}`}>
                        {ECOMMERCE_STATUS_LABELS[product.status] || product.status}
                    </span>
                    <span className="min-w-0 truncate text-xs text-foreground/55">{summarizeProgress(product)}</span>
                </div>
            </div>
        </li>
    );
}
