// 电商工坊完整版 store（服务端数据源；本地不持久化业务数据）。
// 错误统一经 error 字段（文案取 ApiError.message），供页面 toast。
import { create } from "zustand";

import {
    deleteEcommerceProducts,
    deleteEcommercePreset,
    getEcommerceConfig,
    getEcommerceProductDetail,
    importEcommerceProducts,
    listEcommercePresets,
    listEcommerceProducts,
    renameEcommerceProduct,
    saveEcommerceConfig,
    saveEcommercePreset,
    type EcommerceConfig,
    type EcommerceImportItem,
    type EcommercePreset,
    type EcommerceProductDetail,
    type EcommerceProductSummary,
} from "@/services/api/ecommerce";

type EcommerceWorkspaceState = {
    // 列表
    products: EcommerceProductSummary[];
    total: number;
    query: string;
    status: string;
    selectedIds: string[];
    // 详情缓存
    detailById: Record<string, EcommerceProductDetail>;
    // 配置
    config: EcommerceConfig | null;
    presets: EcommercePreset[];
    // 状态
    loading: boolean;
    detailLoading: boolean;
    saving: boolean;
    error: string;

    refreshProducts: () => Promise<void>;
    setQuery: (query: string) => void;
    setStatus: (status: string) => void;
    toggleSelected: (id: string) => void;
    selectAll: (ids: string[]) => void;
    clearSelected: () => void;

    openProduct: (id: string) => Promise<void>;

    refreshConfig: () => Promise<void>;
    saveConfig: (config: EcommerceConfig) => Promise<boolean>;
    refreshPresets: () => Promise<void>;
    savePreset: (name: string) => Promise<boolean>;
    removePreset: (id: string) => Promise<void>;

    importProducts: (items: EcommerceImportItem[]) => Promise<{ created: number; skipped: number } | null>;
    renameProduct: (id: string, name: string) => Promise<boolean>;
    removeProducts: (ids: string[]) => Promise<Record<string, string>>;
};

function errorMessage(reason: unknown, fallback: string) {
    return reason instanceof Error ? reason.message : fallback;
}

export const useEcommerceWorkspaceStore = create<EcommerceWorkspaceState>((set, get) => ({
    products: [],
    total: 0,
    query: "",
    status: "all",
    selectedIds: [],
    detailById: {},
    config: null,
    presets: [],
    loading: false,
    detailLoading: false,
    saving: false,
    error: "",

    refreshProducts: async () => {
        const { query, status } = get();
        set({ loading: true, error: "" });
        try {
            const result = await listEcommerceProducts(query, status);
            set({ products: result.items, total: result.total, loading: false });
        } catch (reason) {
            set({ loading: false, error: errorMessage(reason, "读取商品列表失败") });
        }
    },

    setQuery: (query) => set({ query }),
    setStatus: (status) => set({ status }),

    toggleSelected: (id) =>
        set((current) => ({
            selectedIds: current.selectedIds.includes(id)
                ? current.selectedIds.filter((item) => item !== id)
                : [...current.selectedIds, id],
        })),
    selectAll: (ids) => set({ selectedIds: ids }),
    clearSelected: () => set({ selectedIds: [] }),

    openProduct: async (id) => {
        if (get().detailById[id]) return; // 已缓存
        set({ detailLoading: true, error: "" });
        try {
            const detail = await getEcommerceProductDetail(id);
            set((current) => ({ detailById: { ...current.detailById, [id]: detail }, detailLoading: false }));
        } catch (reason) {
            set({ detailLoading: false, error: errorMessage(reason, "读取商品详情失败") });
        }
    },

    refreshConfig: async () => {
        try {
            const config = await getEcommerceConfig();
            set({ config });
        } catch (reason) {
            set({ error: errorMessage(reason, "读取生成配置失败") });
        }
    },
    saveConfig: async (config) => {
        set({ saving: true, error: "" });
        try {
            const saved = await saveEcommerceConfig(config);
            set({ config: saved, saving: false });
            return true;
        } catch (reason) {
            set({ saving: false, error: errorMessage(reason, "保存配置失败") });
            return false;
        }
    },
    refreshPresets: async () => {
        try {
            const result = await listEcommercePresets();
            set({ presets: result.items });
        } catch (reason) {
            set({ error: errorMessage(reason, "读取预设列表失败") });
        }
    },
    savePreset: async (name) => {
        const config = get().config;
        if (!config) return false;
        set({ saving: true, error: "" });
        try {
            await saveEcommercePreset(name, config);
            const result = await listEcommercePresets();
            set({ presets: result.items, saving: false });
            return true;
        } catch (reason) {
            set({ saving: false, error: errorMessage(reason, "保存预设失败") });
            return false;
        }
    },
    removePreset: async (id) => {
        try {
            await deleteEcommercePreset(id);
            set((current) => ({ presets: current.presets.filter((item) => item.id !== id) }));
        } catch (reason) {
            set({ error: errorMessage(reason, "删除预设失败") });
        }
    },

    importProducts: async (items) => {
        set({ loading: true, error: "" });
        try {
            const result = await importEcommerceProducts(items);
            const { query, status } = get();
            const refreshed = await listEcommerceProducts(query, status);
            set({ products: refreshed.items, total: refreshed.total, loading: false });
            return { created: result.items.length, skipped: result.skipped.length };
        } catch (reason) {
            set({ loading: false, error: errorMessage(reason, "导入商品失败") });
            return null;
        }
    },
    renameProduct: async (id, name) => {
        set({ saving: true, error: "" });
        try {
            await renameEcommerceProduct(id, name);
            set((current) => ({
                products: current.products.map((item) => (item.id === id ? { ...item, name } : item)),
                saving: false,
            }));
            return true;
        } catch (reason) {
            set({ saving: false, error: errorMessage(reason, "重命名失败") });
            return false;
        }
    },
    removeProducts: async (ids) => {
        set({ loading: true, error: "" });
        try {
            const result = await deleteEcommerceProducts(ids);
            const { query, status } = get();
            const refreshed = await listEcommerceProducts(query, status);
            set({ products: refreshed.items, total: refreshed.total, selectedIds: [], loading: false });
            return result.refused;
        } catch (reason) {
            set({ loading: false, error: errorMessage(reason, "删除失败") });
            return {};
        }
    },
}));
