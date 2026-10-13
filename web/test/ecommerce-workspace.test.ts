import { expect, test } from "bun:test";

// B4 前端交互层源码断言：主流程锚点（导入→列表→详情→配置）。
// 运行方式：bun test test/ecommerce-workshop.test.ts（本机无 bun 时待环境）。

async function readSource(relativePath: string): Promise<string> {
    return Bun.file(new URL(`../src/${relativePath}`, import.meta.url)).text();
}

test("电商工坊 API 模块覆盖 B4 全部端点契约", async () => {
    const api = await readSource("services/api/ecommerce.ts");
    // 端点
    for (const fn of [
        "getEcommerceConfig", "saveEcommerceConfig",
        "listEcommercePresets", "saveEcommercePreset", "deleteEcommercePreset",
        "importEcommerceProducts", "listEcommerceProducts", "getEcommerceProductDetail",
        "renameEcommerceProduct", "deleteEcommerceProducts",
    ]) {
        expect(api).toContain(fn);
    }
    // 导入契约：items 带文件名（后端 Resource 无名字段）
    expect(api).toContain("resourceId: string; name: string");
    // 状态中文映射（桌面版同款）
    expect(api).toContain("completed_with_warnings: \"图片已完成\"");
    // 进度摘要
    expect(api).toContain("export function summarizeProgress");
});

test("三栏骨架与主流程接线", async () => {
    const [index, list, detail, config] = await Promise.all([
        readSource("pages/ecommerce/index.tsx"),
        readSource("pages/ecommerce/task-list.tsx"),
        readSource("pages/ecommerce/task-detail.tsx"),
        readSource("pages/ecommerce/config-panel.tsx"),
    ]);
    // 三栏
    expect(index).toContain("EcommerceTaskList");
    expect(index).toContain("EcommerceTaskDetail");
    expect(index).toContain("EcommerceConfigPanel");
    // 列表：导入/搜索/筛选/批量删除确认
    expect(list).toContain("EcommerceImportDialog");
    expect(list).toContain("Input.Search");
    expect(list).toContain("modal.confirm");
    expect(list).toContain("删除勾选");
    // 详情：面包屑/槽位/标题/空态
    expect(detail).toContain("SlotGroup");
    expect(detail).toContain("TitlePanel");
    // 配置：保存即生效提示 + 预设
    expect(config).toContain("保存后立即用于所有任务的后续请求");
    expect(config).toContain("savePreset");
});

test("导入对话框流程：选图→上传→反馈", async () => {
    const dialog = await readSource("pages/ecommerce/import-dialog.tsx");
    expect(dialog).toContain("uploadResourceFile");
    expect(dialog).toContain("importProducts");
    expect(dialog).toContain("跳过");
    // 失败不中断整批（逐个 try）
    expect(dialog).toContain("catch");
});

test("store 覆盖列表/详情/配置/预设全部 action", async () => {
    const store = await readSource("stores/use-ecommerce-store.ts");
    for (const action of [
        "refreshProducts", "openProduct", "refreshConfig", "saveConfig",
        "refreshPresets", "savePreset", "removePreset", "importProducts",
        "renameProduct", "removeProducts",
    ]) {
        expect(store).toContain(action);
    }
    // 错误统一入口（页面 toast 数据源）
    expect(store).toContain("errorMessage(reason");
});
