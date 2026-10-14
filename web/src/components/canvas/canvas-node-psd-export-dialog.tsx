import { ArrowDown, ArrowUp, Download, Layers3 } from "lucide-react";
import { Button, Checkbox, Modal, message } from "antd";
import { useEffect, useMemo, useState } from "react";

import { exportLayeredPsd, nodeImageDataUrl } from "@/services/api/visual-dna";
import type { CanvasNodeData } from "@/types/canvas";

/**
 * 导出分层 PSD：勾选画布图片节点（可排序）作为图层（列表第一项 = 最底层），
 * 尺寸自动归一到最大宽高（居中放置），由酿笑坊引擎（psd-tools）合成分层 PSD。
 * 文字建议走画布文字层后续在 Photoshop 中补排；本对话框只合图片层。
 */

type PsdExportDialogProps = {
    open: boolean;
    imageNodes: CanvasNodeData[];
    preselectNodeId?: string;
    onClose: () => void;
};

type LayerItem = { id: string; node: CanvasNodeData };

function normalizeToCanvas(dataUrl: string, width: number, height: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) return reject(new Error("画布创建失败"));
            context.drawImage(image, Math.round((width - image.width) / 2), Math.round((height - image.height) / 2));
            resolve(canvas.toDataURL("image/png"));
        };
        image.onerror = () => reject(new Error("图片解码失败"));
        image.src = dataUrl;
    });
}

function readImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.width, height: image.height });
        image.onerror = () => reject(new Error("图片解码失败"));
        image.src = dataUrl;
    });
}

export function CanvasNodePsdExportDialog({ open, imageNodes, preselectNodeId, onClose }: PsdExportDialogProps) {
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [order, setOrder] = useState<string[]>([]);
    const [exporting, setExporting] = useState(false);

    const availableNodes = useMemo(() => imageNodes.filter((node) => node.metadata?.content && node.metadata?.status !== "loading"), [imageNodes]);

    useEffect(() => {
        if (!open) return;
        const ids = availableNodes.map((node) => node.id);
        setOrder(ids);
        setSelectedIds(preselectNodeId && ids.includes(preselectNodeId) ? [preselectNodeId] : ids.slice(0, Math.min(3, ids.length)));
    }, [open, availableNodes, preselectNodeId]);

    const orderedSelection = order
        .filter((id) => selectedIds.includes(id))
        .map((id) => availableNodes.find((node) => node.id === id))
        .filter((node): node is CanvasNodeData => Boolean(node));

    const move = (id: string, delta: number) => {
        setOrder((current) => {
            const next = [...current];
            const index = next.indexOf(id);
            const target = index + delta;
            if (index < 0 || target < 0 || target >= next.length) return current;
            [next[index], next[target]] = [next[target], next[index]];
            return next;
        });
    };

    const runExport = async () => {
        if (!orderedSelection.length) return message.warning("请至少勾选一个图层");
        if (orderedSelection.length > 56) return message.error("图层数过多（>56），请精简勾选");
        setExporting(true);
        try {
            const dataUrls = await Promise.all(orderedSelection.map((node) => nodeImageDataUrl(node)));
            const sizes = await Promise.all(dataUrls.map((dataUrl) => readImageSize(dataUrl)));
            const width = Math.max(...sizes.map((size) => size.width));
            const height = Math.max(...sizes.map((size) => size.height));
            const normalized = await Promise.all(dataUrls.map((dataUrl) => normalizeToCanvas(dataUrl, width, height)));
            const layers = orderedSelection.map((node, index) => ({
                name: node.title?.slice(0, 40) || `图层 ${index + 1}`,
                data_url: normalized[index],
            }));
            const blob = await exportLayeredPsd(layers, width, height, `styleforge-${Date.now().toString(36)}`);
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = `styleforge-${new Date().toISOString().slice(0, 10)}.psd`;
            anchor.click();
            URL.revokeObjectURL(url);
            message.success("分层 PSD 已导出");
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "PSD 导出失败");
        } finally {
            setExporting(false);
        }
    };

    return (
        <Modal
            title={
                <span className="flex items-center gap-2">
                    <Layers3 className="size-4" /> 导出分层 PSD
                </span>
            }
            open={open}
            onCancel={onClose}
            width={460}
            centered
            destroyOnHidden
            footer={
                <div className="flex items-center justify-between">
                    <span className="text-xs opacity-55">列表第一项 = 最底层；尺寸自动归一到最大宽高</span>
                    <div className="flex items-center gap-2">
                        <Button onClick={onClose}>取消</Button>
                        <Button type="primary" icon={<Download className="size-4" />} loading={exporting} onClick={() => void runExport()}>
                            导出（{orderedSelection.length} 层）
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="thin-scrollbar max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
                {availableNodes.length === 0 ? (
                    <div className="py-8 text-center text-sm opacity-50">画布上暂无可用图片节点</div>
                ) : null}
                {order.map((id) => {
                    const node = availableNodes.find((item) => item.id === id);
                    if (!node) return null;
                    const checked = selectedIds.includes(id);
                    return (
                        <div key={id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${checked ? "border-primary/50 bg-primary/5" : "border-border/50"}`}>
                            <Checkbox
                                checked={checked}
                                onChange={(event) =>
                                    setSelectedIds((current) => (event.target.checked ? [...current, id] : current.filter((item) => item !== id)))
                                }
                            />
                            <div className="min-w-0 flex-1 truncate text-xs">{node.title?.slice(0, 32) || "图片"}</div>
                            <div className="flex shrink-0 items-center">
                                <button type="button" className="px-1 text-xs opacity-50 hover:opacity-100" onClick={() => move(id, -1)} disabled={checked ? order.indexOf(id) <= 0 : true}>
                                    <ArrowUp className="size-3.5" />
                                </button>
                                <button type="button" className="px-1 text-xs opacity-50 hover:opacity-100" onClick={() => move(id, 1)} disabled={checked ? order.indexOf(id) >= order.length - 1 : true}>
                                    <ArrowDown className="size-3.5" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </Modal>
    );
}
