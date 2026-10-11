import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * 电商工作台 · 产品库：产品 = 图 + 视觉锚点 + 卖点 + 默认品牌Kit。
 * 本地持久化（zustand persist）；图片以资源 storageKey 引用，画布/生成链路直接可用。
 */

export type EcommerceProduct = {
    id: string;
    name: string;
    imageStorageKey: string;
    imageUrl: string;
    anchors: string;
    sellingPoints: string[];
    defaultKitId?: string;
    note?: string;
    createdAt: number;
};

type EcommerceState = {
    products: EcommerceProduct[];
    /** 电商工作台专属画布（Agent 运行时绑定真实画布 ID；删画布后置空重建）。 */
    workbenchCanvasId: string;
    upsertProduct: (product: EcommerceProduct) => void;
    removeProduct: (id: string) => void;
    setWorkbenchCanvasId: (id: string) => void;
};

export function newProductId() {
    return `prod-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export const useEcommerceStore = create<EcommerceState>()(
    persist(
        (set) => ({
            products: [],
            workbenchCanvasId: "",
            upsertProduct: (product) =>
                set((current) => {
                    const exists = current.products.some((item) => item.id === product.id);
                    return { products: exists ? current.products.map((item) => (item.id === product.id ? product : item)) : [product, ...current.products] };
                }),
            removeProduct: (id) => set((current) => ({ products: current.products.filter((item) => item.id !== id) })),
            setWorkbenchCanvasId: (id) => set({ workbenchCanvasId: id }),
        }),
        { name: "canvas-ecommerce-products", version: 1 },
    ),
);
