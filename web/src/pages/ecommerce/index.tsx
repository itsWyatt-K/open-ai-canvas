import { Button, Segmented, Tooltip } from "antd";
import { Bot, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useEffect, useState } from "react";

import { AgentWorkbenchPanel, useEcommerceWorkbenchCanvas } from "./agent-panel-adapter";
import { ProductsView } from "./products";
import { StyleforgeView } from "./styleforge";
import { ProductionView } from "./production";
import { useEcommerceStore } from "@/stores/canvas/use-ecommerce-store";
import { WorkspacePage } from "@/components/layout/workspace-page";
import "./ecommerce.css";

/**
 * 电商工作台 hub：产品库 / 风格锻造 / 批量生产 三视图（URL 切换）+ 右侧电商 Agent。
 * 布局仿 projects/detail 的 views[] 切换模式；Agent 绑定专属「电商工作台」画布。
 */

const VIEWS = [
    { key: "products", label: "产品库" },
    { key: "styleforge", label: "风格锻造" },
    { key: "production", label: "批量生产" },
] as const;

type EcommerceView = (typeof VIEWS)[number]["key"];

function isEcommerceView(value: string | undefined): value is EcommerceView {
    return VIEWS.some((view) => view.key === value);
}

export default function EcommercePage() {
    const { view } = useParams();
    const navigate = useNavigate();
    const activeView: EcommerceView = isEcommerceView(view) ? view : "products";
    const productCount = useEcommerceStore((state) => state.products.length);
    const { canvasId, ensureCanvas, canvasState } = useEcommerceWorkbenchCanvas();
    const [agentExpanded, setAgentExpanded] = useState(true);

    // 进入模块即确保工作台画布存在（Agent 运行时依赖真实画布 ID）。
    useEffect(() => {
        void ensureCanvas();
    }, [ensureCanvas]);

    return (
        <WorkspacePage className="ecommerce-workbench-page !overflow-hidden" fluid>
            <div className="ecommerce-shell">
                <div className="ecommerce-main">
                    <header className="ecommerce-header">
                        <div className="ecommerce-header-copy">
                            <h1>电商工作台</h1>
                            <p>产品库 · 风格锻造 · 批量生产 · 电商 Agent，一条链路出成稿</p>
                        </div>
                        <Segmented
                            value={activeView}
                            onChange={(value) => navigate(`/ecommerce/${value}`)}
                            options={VIEWS.map((item) => ({ value: item.key, label: item.label }))}
                        />
                    </header>
                    <div className="ecommerce-view-scroll thin-scrollbar">
                        {activeView === "products" ? <ProductsView /> : null}
                        {activeView === "styleforge" ? <StyleforgeView /> : null}
                        {activeView === "production" ? <ProductionView canvasId={canvasId} /> : null}
                    </div>
                </div>

                {agentExpanded ? (
                    <aside className="ecommerce-agent-dock">
                        <div className="ecommerce-agent-dock-header">
                            <span className="flex items-center gap-2 text-sm font-medium">
                                <Bot className="size-4" /> 电商助手
                            </span>
                            <div className="flex items-center gap-1">
                                <Tooltip title="去画布精修（Agent 产物所在画布）">
                                    <Button
                                        size="small"
                                        type="text"
                                        disabled={!canvasId}
                                        icon={<PanelRightOpen className="size-3.5" />}
                                        onClick={() => canvasId && navigate(`/canvas/${canvasId}?agent=1`)}
                                    />
                                </Tooltip>
                                <Tooltip title="收起">
                                    <Button size="small" type="text" icon={<PanelRightClose className="size-3.5" />} onClick={() => setAgentExpanded(false)} />
                                </Tooltip>
                            </div>
                        </div>
                        <div className="ecommerce-agent-dock-body">
                            {canvasId ? (
                                <AgentWorkbenchPanel canvasId={canvasId} canvasState={canvasState} productCount={productCount} />
                            ) : (
                                <div className="ecommerce-agent-placeholder">{canvasState || "工作台画布准备中…"}</div>
                            )}
                        </div>
                    </aside>
                ) : (
                    <Tooltip title="打开电商助手">
                        <Button
                            type="primary"
                            shape="circle"
                            size="large"
                            className="ecommerce-agent-fab"
                            icon={<Bot className="size-5" />}
                            onClick={() => setAgentExpanded(true)}
                        />
                    </Tooltip>
                )}
            </div>
        </WorkspacePage>
    );
}

export function EcommerceIndexRedirect() {
    return <Navigate to="/ecommerce/products" replace />;
}
