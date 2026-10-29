// 电商工坊 · 三栏骨架（B4 可操作版）：任务列表 | 任务详情 | 生成配置。
// 交互主线：导入 → 列表筛选/搜索/批量删除 → 点卡看详情 → 右侧调配置即存即用。
//
// 阶段 5 返工：右侧「模型与高级设置」默认折叠（小白第一步只需要「平台 + 卖点 + 确认生图」），
// 折叠态只在右上角留一个带当前模型名的入口按钮，把屏幕高度让给分镜卡。
import { useEffect, useRef, useState } from "react";
import { App } from "antd";

import { WorkspacePage } from "@/components/layout/workspace-page";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";
import { modelOptionName, useConfigStore } from "@/stores/use-config-store";
import { EcommerceConfigPanel } from "./config-panel";
import { EcommerceTaskDetail } from "./task-detail";
import { EcommerceTaskList } from "./task-list";

export default function EcommercePage() {
    const { message } = App.useApp();
    const [activeId, setActiveId] = useState<string | null>(null);
    const [configCollapsed, setConfigCollapsed] = useState(true);
    const products = useEcommerceWorkspaceStore((state) => state.products);
    const refreshProducts = useEcommerceWorkspaceStore((state) => state.refreshProducts);
    const openProduct = useEcommerceWorkspaceStore((state) => state.openProduct);
    const error = useEcommerceWorkspaceStore((state) => state.error);
    const aiConfig = useConfigStore((state) => state.config);

    useEffect(() => {
        void refreshProducts();
    }, [refreshProducts]);

    // 返工令四-1（根治项）：组件级默认选中——进 /ecommerce 不点任何东西，
    // 商品列表就绪后自动选中第一个并打开详情，右侧直接出现 7 屏画廊。
    // 旧病灶：只有 handleOpen（用户点击）才 setActiveId，真人视角进页面看到的是
    // 「还没有选择商品任务」大白板（探针脚本代点曾把它掩盖掉）。
    // 兜底口径：
    //   ① 列表就绪且无选中项 → 选中第一个；
    //   ② 列表刷新后原选中项被删除/不再存在 → 重新选中第一个；
    //   ③ 用户点「返回商品列表」主动清空 → 本轮暂停自动选中（clearedByUser），
    //      列表再次变化（导入/删除/刷新）或用户重新点选后自动恢复。
    const clearedByUser = useRef(false);
    useEffect(() => {
        clearedByUser.current = false;
    }, [products]);
    useEffect(() => {
        if (products.length === 0) {
            if (activeId) setActiveId(null);
            return;
        }
        const activeMissing = Boolean(activeId) && !products.some((item) => item.id === activeId);
        if ((!activeId || activeMissing) && !clearedByUser.current) {
            const first = products[0].id;
            setActiveId(first);
            void openProduct(first);
        }
    }, [products, activeId, openProduct]);

    // 全局错误 toast（store.error 由各 action 写入，变化即提示）
    useEffect(() => {
        if (!error) return;
        message.error(error);
    }, [error, message]);

    const handleOpen = (id: string) => {
        clearedByUser.current = false;
        setActiveId(id);
        void openProduct(id);
    };

    const handleBack = () => {
        clearedByUser.current = true;
        setActiveId(null);
    };

    // 折叠态入口上的「当前模型」摘要（文案/生图各自取真实选用模型名）。
    const textModelName = modelOptionName(aiConfig?.textModel || "") || "未选";
    const imageModelName = modelOptionName(aiConfig?.imageModel || "") || "未选";

    return (
        <WorkspacePage>
            <div className="relative flex h-[calc(100vh-104px)] overflow-hidden rounded-lg border border-border/50">
                <EcommerceTaskList activeId={activeId} onOpen={handleOpen} />
                <EcommerceTaskDetail
                    productId={activeId}
                    onBack={handleBack}
                    onOpenConfig={() => setConfigCollapsed(false)}
                />
                {!configCollapsed ? <EcommerceConfigPanel collapsed={configCollapsed} onToggle={() => setConfigCollapsed(true)} /> : null}
                {/* 返工令 B：任务详情 Header 第二行已内置「⚙️ 模型与尺寸设置」入口，
                    这里只在「还没选中商品」时才留一个悬浮入口（避免与详情顶部按钮重叠）。 */}
                {configCollapsed && !activeId ? (
                    <button
                        type="button"
                        className="absolute right-4 top-3 z-10 max-w-[calc(100%-2rem)] truncate rounded-md border border-border/50 bg-surface px-3 py-1.5 text-xs text-foreground/70 shadow-sm hover:text-foreground"
                        onClick={() => setConfigCollapsed(false)}
                        title="展开模型与高级设置"
                    >
                        ⚙️ 模型与高级设置（当前：{textModelName} / {imageModelName}）
                    </button>
                ) : null}
            </div>
        </WorkspacePage>
    );
}
