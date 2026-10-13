// 商品导入对话框：多选图片 → 逐个上传为资源 → 批量建任务。
// 流程设计（便于人类操作）：选图即见清单、上传有进度、结果有明确反馈
// （成功 n 个 / 跳过 m 个重复 / 失败可重试），全程不卡界面。
import { useCallback, useRef, useState } from "react";
import { App, Button, Progress } from "antd";
import { Upload } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { uploadResourceFile } from "@/services/api/resources";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";

type ImportRow = {
    file: File;
    status: "pending" | "uploading" | "done" | "failed";
    error?: string;
};

export function EcommerceImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const importProducts = useEcommerceWorkspaceStore((state) => state.importProducts);
    const [rows, setRows] = useState<ImportRow[]>([]);
    const [running, setRunning] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const reset = useCallback(() => {
        setRows([]);
        setRunning(false);
    }, []);

    const handleFiles = (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        if (images.length === 0) {
            message.warning("请选择图片文件（商品主图）");
            return;
        }
        setRows((current) => [...current, ...images.map((file) => ({ file, status: "pending" as const }))]);
    };

    const handleImport = async () => {
        const pending = rows.filter((row) => row.status !== "done");
        if (pending.length === 0) return;
        setRunning(true);
        // 逐个上传（失败不中断整批），收集成功的 resourceId + 文件名
        const items: { resourceId: string; name: string }[] = [];
        for (const row of rows) {
            if (row.status === "done") continue;
            setRows((current) => current.map((item) => (item.file === row.file ? { ...item, status: "uploading" } : item)));
            try {
                const resource = await uploadResourceFile(row.file, "image");
                items.push({ resourceId: resource.id, name: row.file.name });
                setRows((current) => current.map((item) => (item.file === row.file ? { ...item, status: "done" } : item)));
            } catch (reason) {
                const error = reason instanceof Error ? reason.message : "上传失败";
                setRows((current) => current.map((item) => (item.file === row.file ? { ...item, status: "failed", error } : item)));
            }
        }
        if (items.length === 0) {
            setRunning(false);
            message.error("没有上传成功的图片，请重试");
            return;
        }
        const result = await importProducts(items);
        setRunning(false);
        if (!result) {
            message.error("导入失败，请重试");
            return;
        }
        const parts = [`已导入 ${result.created} 个商品`];
        if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 个重复商品`);
        message.success(parts.join("，"));
        reset();
        onClose();
    };

    const doneCount = rows.filter((row) => row.status === "done").length;
    const progress = rows.length > 0 ? Math.round((doneCount / rows.length) * 100) : 0;

    return (
        <AppModal
            open={open}
            title="导入商品"
            okText={running ? "导入中…" : `导入${rows.length > 0 ? ` (${rows.length})` : ""}`}
            okButtonProps={{ disabled: running || rows.length === 0 }}
            onOk={() => void handleImport()}
            onCancel={() => {
                if (running) return;
                reset();
                onClose();
            }}
        >
            <div className="flex flex-col gap-4">
                <div
                    className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 px-4 py-8 text-center transition-colors hover:border-primary/60"
                    onClick={() => inputRef.current?.click()}
                >
                    <Upload className="size-6 text-foreground/60" />
                    <p className="text-sm text-foreground/70">点击选择商品图片（可多选，支持继续添加）</p>
                    <p className="text-xs text-foreground/50">建议使用清晰的白底或场景主图；重复导入同一图片会自动跳过</p>
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                            handleFiles(event.target.files);
                            event.target.value = "";
                        }}
                    />
                </div>
                {rows.length > 0 ? (
                    <div className="flex flex-col gap-2">
                        <Progress percent={progress} size="small" />
                        <ul className="flex max-h-52 flex-col gap-1 overflow-y-auto text-sm">
                            {rows.map((row) => (
                                <li key={`${row.file.name}-${row.file.size}`} className="flex items-center justify-between gap-2">
                                    <span className="truncate text-foreground/80">{row.file.name}</span>
                                    <span className={row.status === "failed" ? "text-destructive" : "text-foreground/50"}>
                                        {row.status === "pending" ? "待上传" : ""}
                                        {row.status === "uploading" ? "上传中…" : ""}
                                        {row.status === "done" ? "✓ 已就绪" : ""}
                                        {row.status === "failed" ? `✗ ${row.error || "失败"}` : ""}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </div>
        </AppModal>
    );
}
