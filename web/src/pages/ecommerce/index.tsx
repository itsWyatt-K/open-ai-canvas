// 电商工坊 · 三栏骨架（B4 可操作版）：任务列表 | 任务详情 | 生成配置。
// 交互主线：导入 → 列表筛选/搜索/批量删除 → 点卡看详情 → 右侧调配置即存即用。
import { useEffect, useState } from "react";
import { App } from "antd";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";
import { EcommerceConfigPanel } from "./config-panel";
import { EcommerceTaskDetail } from "./task-detail";
import { EcommerceTaskList } from "./task-list";

export default function EcommercePage() {
    const { message } = App.useApp();
    const [activeId, setActiveId] = useState<string | null>(null);
    const [configCollapsed, setConfigCollapsed] = useState(false);
    const refreshProducts = useEcommerceWorkspaceStore((state) => state.refreshProducts);
    const openProduct = useEcommerceWorkspaceStore((state) => state.openProduct);
    const error = useEcommerceWorkspaceStore((state) => state.error);

    useEffect(() => {
        void refreshProducts();
    }, [refreshProducts]);

    // 全局错误 toast（store.error 由各 action 写入，变化即提示）
    useEffect(() => {
        if (!error) return;
        message.error(error);
    }, [error, message]);

    const handleOpen = (id: string) => {
        setActiveId(id);
        void openProduct(id);
    };

    return (
        <WorkspacePage>
            <div className="relative flex h-[calc(100vh-104px)] overflow-hidden rounded-lg border border-border/50">
                <EcommerceTaskList activeId={activeId} onOpen={handleOpen} />
                <EcommerceTaskDetail productId={activeId} onBack={() => setActiveId(null)} />
                {!configCollapsed ? <EcommerceConfigPanel collapsed={configCollapsed} onToggle={() => setConfigCollapsed(true)} /> : null}
                {configCollapsed ? (
                    <button
                        type="button"
                        className="absolute right-4 top-3 z-10 rounded-md border border-border/50 bg-surface px-3 py-1.5 text-xs text-foreground/70 shadow-sm hover:text-foreground"
                        onClick={() => setConfigCollapsed(false)}
                    >
                        生成配置
                    </button>
                ) : null}
            </div>
        </WorkspacePage>
    );
}
