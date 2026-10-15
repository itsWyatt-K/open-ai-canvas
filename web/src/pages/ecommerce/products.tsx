// ⚠️⚠️ 未挂载组件（防呆警告 · 2026-10-15）⚠️⚠️
// 本文件当前【没有任何路由或组件引用】——`/ecommerce/:view` 的 index.tsx 不读 view 参数，
// 因此即使访问 /ecommerce/{name} 渲染的仍是同一个三栏页，本组件永不显示。
// 2026-10-15 事故：M2 曾把「后端编排生成」按钮加在本文件，导致主人实测看不到任何入口。
// 铁律：**不要在本文件新增任何用户功能**。要加功能请改真实渲染路径上的组件：
//   router.tsx → pages/ecommerce/index.tsx → { task-list, task-detail, config-panel }
// 若要让本组件真正可用，必须先改 index.tsx 读取 view 参数并挂载，然后删掉这段警告。

import { Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Button, Drawer, Empty, Input, Popconfirm, Tag, message } from "antd";
import { useEffect, useState } from "react";

import { newProductId, useEcommerceStore, type EcommerceProduct } from "@/stores/canvas/use-ecommerce-store";
import { useBrandKitStore } from "@/stores/canvas/use-brand-kit-store";

/**
 * 产品库：产品 = 产品图 + 视觉锚点 + 卖点 + 默认品牌Kit。
 * 产品图经 uploadResourceFile 上传（resource: 存储），画布/生成链路直接可用。
 */

export function ProductsView() {
    const products = useEcommerceStore((state) => state.products);
    const removeProduct = useEcommerceStore((state) => state.removeProduct);
    const kits = useBrandKitStore((state) => state.kits);
    const [editing, setEditing] = useState<EcommerceProduct | "new" | null>(null);

    return (
        <div className="ecommerce-products-view">
            <div className="mb-3 flex items-center justify-between">
                <span className="text-sm opacity-60">{products.length} 个产品 · 生成任务与 Agent 都从这里取产品锚点</span>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
                    新建产品
                </Button>
            </div>
            {products.length === 0 ? (
                <div className="ecommerce-empty">
                    <Empty description="还没有产品。新建一个产品，或让电商助手帮你录入。" />
                </div>
            ) : (
                <div className="ecommerce-product-grid">
                    {products.map((product) => {
                        const kit = kits.find((item) => item.id === product.defaultKitId);
                        return (
                            <div key={product.id} className="ecommerce-product-card" onClick={() => setEditing(product)}>
                                <div className="ecommerce-product-cover">
                                    {product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <ShoppingBag className="size-8 opacity-30" />}
                                </div>
                                <div className="ecommerce-product-body">
                                    <div className="flex items-center justify-between gap-2">
                                        <strong className="truncate">{product.name}</strong>
                                        <Popconfirm title="删除该产品？" onConfirm={(event) => { event?.stopPropagation(); removeProduct(product.id); }} onCancel={(event) => event?.stopPropagation()}>
                                            <Button
                                                size="small"
                                                type="text"
                                                aria-label={`删除 ${product.name}`}
                                                icon={<Trash2 className="size-3.5" />}
                                                onClick={(event) => event.stopPropagation()}
                                            />
                                        </Popconfirm>
                                    </div>
                                    <div className="truncate text-xs opacity-60">{product.anchors || "（未填视觉锚点）"}</div>
                                    <div className="mt-1.5 flex flex-wrap gap-1">
                                        {kit ? <Tag className="mr-0! text-[10px]!">{kit.name}</Tag> : null}
                                        {product.sellingPoints.slice(0, 3).map((point) => (
                                            <Tag key={point} className="mr-0! text-[10px]!">{point}</Tag>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            <ProductFormDrawer product={editing === "new" ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
        </div>
    );
}

function ProductFormDrawer({ product, open, onClose }: { product: EcommerceProduct | null; open: boolean; onClose: () => void }) {
    const upsertProduct = useEcommerceStore((state) => state.upsertProduct);
    const kits = useBrandKitStore((state) => state.kits);
    const [name, setName] = useState("");
    const [imageUrl, setImageUrl] = useState("");
    const [imageStorageKey, setImageStorageKey] = useState("");
    const [anchors, setAnchors] = useState("");
    const [sellingPoints, setSellingPoints] = useState("");
    const [kitId, setKitId] = useState("");
    const [note, setNote] = useState("");
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        if (!open) return;
        setName(product?.name || "");
        setImageUrl(product?.imageUrl || "");
        setImageStorageKey(product?.imageStorageKey || "");
        setAnchors(product?.anchors || "");
        setSellingPoints((product?.sellingPoints || []).join("、"));
        setKitId(product?.defaultKitId || "");
        setNote(product?.note || "");
    }, [open, product]);

    const handleUpload = async (file: File) => {
        setUploading(true);
        try {
            const { uploadResourceFile } = await import("@/services/api/resources");
            const resource = await uploadResourceFile(file, "image");
            setImageStorageKey(`resource:${resource.id}`);
            setImageUrl(`/api/resources/${resource.id}/file`);
            message.success("产品图已上传");
        } catch (error) {
            message.error(error instanceof Error ? `上传失败：${error.message}` : "上传失败");
        } finally {
            setUploading(false);
        }
        return false;
    };

    const submit = () => {
        if (!name.trim()) return message.warning("请填写产品名称");
        upsertProduct({
            id: product?.id || newProductId(),
            name: name.trim(),
            imageStorageKey,
            imageUrl,
            anchors: anchors.trim(),
            sellingPoints: sellingPoints.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 6),
            defaultKitId: kitId || undefined,
            note: note.trim() || undefined,
            createdAt: product?.createdAt || Date.now(),
        });
        message.success("产品已保存");
        onClose();
    };

    return (
        <Drawer title={product ? "编辑产品" : "新建产品"} open={open} onClose={onClose} width={420} destroyOnHidden>
            <div className="space-y-3">
                <Input placeholder="产品名称" value={name} maxLength={30} onChange={(event) => setName(event.target.value)} />
                <label className="ecommerce-upload-box">
                    <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        hidden
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void handleUpload(file);
                        }}
                    />
                    {imageUrl ? (
                        <img src={imageUrl} alt="产品图" className="max-h-40 rounded-lg" />
                    ) : (
                        <span className="text-xs opacity-60">{uploading ? "上传中…" : "点击上传产品图（白底/实拍皆可，生成时作为保真基准）"}</span>
                    )}
                </label>
                <Input.TextArea rows={2} placeholder="视觉锚点：颜色/材质/形状/标志特征（如 白色车身、香槟金饰件、环形LED）" value={anchors} onChange={(event) => setAnchors(event.target.value)} />
                <Input.TextArea rows={2} placeholder="卖点（顿号/换行分隔）" value={sellingPoints} onChange={(event) => setSellingPoints(event.target.value)} />
                <select className="ecommerce-select" value={kitId} onChange={(event) => setKitId(event.target.value)}>
                    <option value="">默认品牌Kit：不指定</option>
                    {kits.map((kit) => (
                        <option key={kit.id} value={kit.id}>{kit.name}</option>
                    ))}
                </select>
                <Input.TextArea rows={2} placeholder="备注（可选）" value={note} onChange={(event) => setNote(event.target.value)} />
                <Button type="primary" block onClick={submit}>
                    保存产品
                </Button>
            </div>
        </Drawer>
    );
}
