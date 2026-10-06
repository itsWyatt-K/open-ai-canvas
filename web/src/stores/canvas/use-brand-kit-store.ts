import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { VisualDna } from "@/services/api/visual-dna";

/**
 * 品牌Kit（Brand Kit）本地资产：视觉DNA + 锚点卡，挂载后批量出图风格锁死。
 * v1 持久化在浏览器本地（zustand persist）；后续可升级为后端资产。
 */

export type BrandKit = {
    id: string;
    name: string;
    dna: VisualDna;
    anchorCard: string;
    createdAt: number;
};

type BrandKitState = {
    kits: BrandKit[];
    saveKit: (name: string, dna: VisualDna, anchorCard: string) => BrandKit;
    removeKit: (id: string) => void;
};

function compactName(name: string) {
    return name.trim().slice(0, 40) || "未命名 Kit";
}

export const useBrandKitStore = create<BrandKitState>()(
    persist(
        (set) => ({
            kits: [],
            saveKit: (name, dna, anchorCard) => {
                const kit: BrandKit = {
                    id: `kit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                    name: compactName(name),
                    dna,
                    anchorCard,
                    createdAt: Date.now(),
                };
                set((current) => ({ kits: [kit, ...current.kits].slice(0, 50) }));
                return kit;
            },
            removeKit: (id) => set((current) => ({ kits: current.kits.filter((kit) => kit.id !== id) })),
        }),
        { name: "canvas-brand-kits", version: 1 },
    ),
);
