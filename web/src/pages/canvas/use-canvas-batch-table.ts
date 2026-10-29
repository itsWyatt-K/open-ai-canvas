import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { MAX_BATCH_REFERENCE_COLUMNS, batchGenerationRows, batchInputColumns, batchReferenceColumns, batchReferenceHandleId, batchTextInputColumns, insertBatchRow, createBatchRowsFromColumns, moveBatchReferenceCell, removeLastBatchReferenceColumn, reorderBatchReferenceColumns } from "@/lib/canvas/canvas-batch-table";
import { reconcileBatchCellConnections } from "@/lib/canvas/canvas-batch-references";
import { patchCanvasBatchTableData, prepareCanvasBatchTableGeneration, type CanvasBatchGenerationTarget } from "@/lib/canvas/canvas-batch-table-state";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasBatchRow, type CanvasBatchTableData, type CanvasConnection, type CanvasGenerationBatchMode, type CanvasNodeData } from "@/types/canvas";
import type { BatchGenerationSettings } from "@/components/canvas/batch-generation-settings-dialog";
import type { Asset } from "@/stores/use-asset-store";
import { commerceSnapshot, isCommerceNode } from "@/lib/canvas/commerce-workflow";

type Options = {
    readOnly?: boolean;
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    assets: Asset[];
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    enqueueGenerationBatch: (sourceNodeId: string, mode: CanvasGenerationBatchMode, targets: CanvasBatchGenerationTarget[], options?: { concurrency?: number }) => string | undefined;
};

type PendingBatchGen = {
    nodeId: string;
    rows: CanvasBatchRow[];
    concurrency: number;
    tableSnapshot: string;
    requestedRowIds?: string[];
    commerceSnapshot?: string;
};

export function useCanvasBatchTable({ readOnly, nodesRef, connectionsRef, assets, setNodes, setConnections, setSelectedNodeIds, enqueueGenerationBatch }: Options) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);

    const [batchGenDialog, setBatchGenDialog] = useState<{ open: boolean; pending: PendingBatchGen | null }>({ open: false, pending: null });

    const patchTable = useCallback((nodeId: string, patch: Partial<CanvasBatchTableData>) => {
        const next = nodesRef.current.map((node) => {
            if (node.id !== nodeId || node.metadata?.locked) return node;
            return { ...node, metadata: { ...node.metadata, batchTable: patchCanvasBatchTableData(node.metadata?.batchTable, patch) } };
        });
        const edges = reconcileBatchCellConnections(next, connectionsRef.current);
        setNodes(next); setConnections(edges);
    }, [nodesRef, connectionsRef, setNodes, setConnections]);

    const updateRow = useCallback((nodeId: string, rowId: string, patch: Partial<CanvasBatchRow>) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node?.metadata?.batchTable) return;
        patchTable(nodeId, { rows: node.metadata.batchTable.rows.map((row) => row.id === rowId ? { ...row, ...patch } : row) });
    }, [nodesRef, patchTable]);

    const addRow = useCallback((nodeId: string, afterRowId?: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const inserted = insertBatchRow(table, afterRowId);
        if (!inserted) return;
        patchTable(nodeId, { rows: inserted.rows });
        return inserted.row.id;
    }, [nodesRef, patchTable]);

    const removeRow = useCallback((nodeId: string, rowId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        patchTable(nodeId, { rows: table.rows.filter((row) => row.id !== rowId) });
    }, [nodesRef, patchTable]);

    const addReferenceColumn = useCallback((nodeId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const columns = batchReferenceColumns(table);
        if (columns.length >= MAX_BATCH_REFERENCE_COLUMNS) return message.info("最多支持 10 组参考图");
        const nextIndex = columns.length + 1;
        patchTable(nodeId, { referenceColumns: [...columns, { id: `reference-${nanoid()}`, label: `参考图 ${nextIndex}` }] });
    }, [message, nodesRef, patchTable]);

    const removeReferenceColumn = useCallback((nodeId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const columns = batchReferenceColumns(table);
        const nextTable = removeLastBatchReferenceColumn(table);
        if (!nextTable) return message.info("至少保留 1 组参考图");
        patchTable(nodeId, nextTable);
        const removed = columns.at(-1);
        if (removed) {
            const handleId = batchReferenceHandleId(removed.id);
            setConnections((current) => current.filter((connection) => !(connection.toNodeId === nodeId && connection.toHandleId === handleId)));
        }
    }, [message, nodesRef, patchTable, setConnections]);

    const addTextColumn = useCallback((nodeId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const columns = table.textColumns || [];
        if (columns.length >= 4) return message.info("最多支持 4 组文字");
        patchTable(nodeId, { textColumns: [...columns, { id: `text-${nanoid()}`, label: `文字 ${columns.length + 1}` }] });
    }, [message, nodesRef, patchTable]);

    const syncRowsFromConnections = useCallback((nodeId: string, silent = false) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        const table = node?.metadata?.batchTable;
        if (!node || !table) return false;
        // AI 列表模式已经根据用户要求生成了独立行；参考图连线只负责
        // 提供素材，不能在保存/连线刷新时把 N 行重置成“每张图一行”。
        if (table.aiGenerated || table.referenceMode === "cells") return false;
        const nodeById = new Map(nodesRef.current.map((item) => [item.id, item]));
        const columns = batchInputColumns(node, connectionsRef.current).map((column) => column.filter((inputNodeId) => {
            const input = nodeById.get(inputNodeId);
            return input?.type === CanvasNodeType.Image && Boolean(input.metadata?.content || input.metadata?.storageKey);
        }));
        if (!columns.some((column) => column.length)) {
            if (!silent) message.warning("请先把图片节点连接到批量创作表");
            return false;
        }
        const rows = createBatchRowsFromColumns(table.operation, columns, table.rows);
        const textColumns = batchTextInputColumns(node, connectionsRef.current).map((column) => column.filter((inputNodeId) => {
            const input = nodeById.get(inputNodeId);
            return input?.type === CanvasNodeType.Text && Boolean(input.metadata?.content || input.metadata?.prompt);
        }));
        const rowsWithText = rows.map((row, index) => ({
            ...row,
            textNodeIds: textColumns.some((column) => column.length) ? textColumns.flatMap((column) => {
                const input = column.length === 1 ? column[0] : column[index];
                return input ? [input] : [];
            }) : row.textNodeIds,
        }));
        if (!rows.length) {
            if (!silent) message.warning("批量换装至少需要一张人物图和一张服装图");
            return false;
        }
        const rowsChanged = JSON.stringify(table.rows) !== JSON.stringify(rowsWithText);
        if (!rowsChanged) return false;
        patchTable(nodeId, { rows: rowsWithText });
        if (!silent) message.success(`已按连线创建 ${rows.length} 行任务`);
        return true;
    }, [connectionsRef, message, nodesRef, patchTable]);

    const fillRowsFromConnections = useCallback((nodeId: string) => {
        syncRowsFromConnections(nodeId);
    }, [syncRowsFromConnections]);

    const reorderReferenceColumns = useCallback((nodeId: string, fromColumnId: string, toColumnId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const nextTable = reorderBatchReferenceColumns(table, fromColumnId, toColumnId);
        if (nextTable !== table) patchTable(nodeId, nextTable);
    }, [nodesRef, patchTable]);

    const moveReferenceCell = useCallback((nodeId: string, sourceRowId: string, sourceColumnIndex: number, targetRowId: string, targetColumnIndex: number) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const nextTable = moveBatchReferenceCell(table, sourceRowId, sourceColumnIndex, targetRowId, targetColumnIndex);
        if (nextTable !== table) patchTable(nodeId, { rows: nextTable.rows });
    }, [nodesRef, patchTable]);

    const executeBatchGeneration = useCallback((pending: PendingBatchGen, settings: BatchGenerationSettings) => {
        const { nodeId, rows, concurrency } = pending;
        const sourceNode = nodesRef.current.find((item) => item.id === nodeId);
        const table = sourceNode?.metadata?.batchTable;
        if (!sourceNode || !table) return;
        // commerce 守卫：参考图/文案快照变化即拒绝（本地铁律，防串屏串商品）。
        if (isCommerceNode(sourceNode) && (readOnly || sourceNode.metadata?.locked || pending.commerceSnapshot !== commerceSnapshot(sourceNode, nodesRef.current, connectionsRef.current))) {
            message.warning("电商工作流已变化，请重新打开生成设置后提交");
            return;
        }

        const selectableRowIds = new Set(batchGenerationRows(sourceNode, nodesRef.current, pending.requestedRowIds).map((row) => row.id));
        if (JSON.stringify(table) !== pending.tableSnapshot || !rows.every((row) => selectableRowIds.has(row.id))) {
            message.warning("表格、素材或任务状态已变化，请重新打开生成设置后提交");
            return;
        }

        const mergedConfig = { ...effectiveConfig, ...settings };
        if (!isAiConfigReady(mergedConfig, mergedConfig.imageModel || mergedConfig.model)) {
            message.error("所选图片模型尚未配置，未提交生成任务");
            return;
        }

        let prepared: ReturnType<typeof prepareCanvasBatchTableGeneration>;
        try {
            prepared = prepareCanvasBatchTableGeneration({ nodes: nodesRef.current, connections: connectionsRef.current, sourceNodeId: nodeId, rows, config: effectiveConfig, settings, assets });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "任务输入快照保存失败，未加入生成队列");
            return;
        }
        const { nodes: nextNodes, connections: nextConnections, targets } = prepared;
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        setSelectedNodeIds(new Set(targets.map((target) => target.nodeId)));
        // 回归上游 prepareCanvasBatchTableGeneration 时不能丢布尔契约：
        // generateConfirmedCommerceRows 以 Boolean(executeBatchGeneration(...)) 判断是否入队成功，
        // 漏写 return true 会让电商工作流在任务已入队后仍抛「图片任务未提交」。
        if (enqueueGenerationBatch(nodeId, "batch_image", targets, { concurrency })) {
            message.success(`${targets.length} 个任务已加入并发队列`);
            return true;
        }
        return false;
    }, [assets, connectionsRef, effectiveConfig, enqueueGenerationBatch, isAiConfigReady, message, nodesRef, setConnections, setNodes, setSelectedNodeIds]);

    const generateRows = useCallback((nodeId: string, requestedRowIds?: string[]) => {
        const sourceNode = nodesRef.current.find((item) => item.id === nodeId);
        const table = sourceNode?.metadata?.batchTable;
        if (!sourceNode || !table) return;
        const imageModel = effectiveConfig.imageModel || effectiveConfig.model;
        if (!isAiConfigReady(effectiveConfig, imageModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const rows = batchGenerationRows(sourceNode, nodesRef.current, requestedRowIds);
        if (!rows.length) return message.info("没有可提交的未完成任务，请检查参考图和提示词");

        setBatchGenDialog({ open: true, pending: { nodeId, rows, concurrency: table.concurrency, tableSnapshot: JSON.stringify(table), requestedRowIds } });
    }, [effectiveConfig, isAiConfigReady, message, nodesRef]);

    const closeBatchGenDialog = useCallback(() => {
        setBatchGenDialog({ open: false, pending: null });
    }, []);

    // commerce 专用入口：模型与两个付费阶段已在配置节点里确认过，直接入队不再弹设置窗。
    // 不能拿它绕过其它入口的收费确认。
    const generateConfirmedCommerceRows = useCallback((nodeId: string, requestedRowIds?: string[]) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        const table = source?.metadata?.batchTable;
        if (!source || !table || !isCommerceNode(source) || readOnly || source.metadata?.locked) return false;
        const rows = batchGenerationRows(source, nodesRef.current, requestedRowIds);
        if (!rows.length) return false;
        const model = source.metadata?.model || effectiveConfig.imageModel || effectiveConfig.model;
        return Boolean(executeBatchGeneration({ nodeId, rows, requestedRowIds, concurrency: table.concurrency,
            tableSnapshot: JSON.stringify(table), commerceSnapshot: commerceSnapshot(source, nodesRef.current, connectionsRef.current) },
        { model, imageModel: model, size: source.metadata?.size || effectiveConfig.size, quality: source.metadata?.quality || effectiveConfig.quality,
            imageResolution: effectiveConfig.imageResolution, count: "1", transparentBackground: effectiveConfig.transparentBackground }));
    }, [nodesRef, connectionsRef, effectiveConfig, executeBatchGeneration, readOnly]);

    const confirmBatchGenDialog = useCallback((settings: BatchGenerationSettings) => {
        if (batchGenDialog.pending) {
            executeBatchGeneration(batchGenDialog.pending, settings);
        }
        setBatchGenDialog({ open: false, pending: null });
    }, [batchGenDialog.pending, executeBatchGeneration]);

    const dialogConfig = useMemo(() => {
        const source = nodesRef.current.find((node) => node.id === batchGenDialog.pending?.nodeId);
        return source && isCommerceNode(source)
            ? { ...effectiveConfig, model: source.metadata?.model || effectiveConfig.imageModel, imageModel: source.metadata?.model || effectiveConfig.imageModel,
                size: source.metadata?.size || effectiveConfig.size, quality: source.metadata?.quality || effectiveConfig.quality }
            : effectiveConfig;
    }, [batchGenDialog.pending, effectiveConfig, nodesRef]);

    return {
        addReferenceColumn,
        addTextColumn,
        addRow,
        fillRowsFromConnections,
        generateRows,
        generateConfirmedCommerceRows,
        moveReferenceCell,
        patchTable,
        removeReferenceColumn,
        removeRow,
        reorderReferenceColumns,
        syncRowsFromConnections,
        updateRow,
        batchGenDialogOpen: batchGenDialog.open,
        batchGenDialogRowCount: batchGenDialog.pending?.rows.length ?? 0,
        batchGenDialogConcurrency: batchGenDialog.pending?.concurrency ?? 1,
        batchGenDialogConfig: dialogConfig,
        closeBatchGenDialog,
        confirmBatchGenDialog,
    };
}
