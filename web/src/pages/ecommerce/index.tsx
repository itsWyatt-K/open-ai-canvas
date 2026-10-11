import { WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";

// 电商工坊占位页（F2 阶段）。
// 完整版三栏工坊（任务列表/详情/配置栏 + 提示词编辑页）由后续 F4 界面任务重建；
// 旧简化版三视图（products/production/styleforge）暂存磁盘待打捞，见施工案 §2。
export default function EcommercePage() {
    return (
        <WorkspacePage>
            <WorkspaceState
                icon="empty"
                title="电商工坊即将开放"
                description="商品主图 · 详情页 · 标题，批量生成，按商品自动归档。完整工坊施工进行中——地基（数据模型 / 状态机 / 功能开关）已就位。"
            />
        </WorkspacePage>
    );
}
