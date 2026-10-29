import { expect, test } from "bun:test";

// F2 源码断言：电商工坊入口全链路（路由带功能开关、入口reachability、命名统一）。
// 运行方式：bun test test/ecommerce-entry.test.ts（本机无 bun 时待环境，见 impl-log）。

async function readSource(relativePath: string): Promise<string> {
    return Bun.file(new URL(`../src/${relativePath}`, import.meta.url)).text();
}

test("电商工坊路由带 RequireFeature 且入口经模块大厅可达", async () => {
    const [router, sidebar, tools, modules] = await Promise.all([
        readSource("router.tsx"),
        readSource("components/layout/workspace-sidebar-nav.tsx"),
        readSource("constant/navigation-tools.ts"),
        readSource("pages/modules/index.tsx"),
    ]);

    // router：/ecommerce 路由被 RequireFeature(ecommerceEnabled) 包裹
    expect(router).toContain('path: "/ecommerce"');
    expect(router).toContain('feature="ecommerceEnabled"');

    // sidebar：夜间施工令阶段二——恢复上游原生导航布局 + 新增「定制模块」入口组，
    // 电商详情工坊作为定制工作台直达项回到侧边栏（独立高亮，不再只藏大厅）。
    expect(sidebar).toContain('heading: "定制模块"');
    expect(sidebar).toContain('{ id: "custom-modules", title: "✨ 定制模块", icon: LayoutGridIcon, to: "/modules" }');
    expect(sidebar).toContain('{ id: "custom-ecommerce", title: "🛍️ 电商详情工坊", icon: ShoppingBagIcon, to: "/ecommerce" }');

    // 入口可达性：模块大厅第一排置顶「电商详情工坊」并链到 /ecommerce。
    // 2026-10-29 Round 3 返工令：卡片标题前的系统 Emoji 已全部删除（与封面图标双图标叠加是廉价感来源）
    expect(modules).toContain("电商详情页工坊");
    expect(modules).toContain('to: "/ecommerce"');

    // navigation-tools：slug 与命名
    expect(tools).toContain('slug: "ecommerce"');
    expect(tools).toContain('label: "电商工坊"');
});

test("电商工坊主界面为三栏工作台（功能已上线，占位页已退役）", async () => {
    const page = await readSource("pages/ecommerce/index.tsx");
    // F2 时期的「电商工坊即将开放」占位页已被 B4 可操作版三栏工作台取代，
    // 后经历阶段 5 小白向返工；占位页契约随功能上线自然失效。
    expect(page).not.toContain("电商工坊即将开放");
    expect(page).not.toContain("WorkspaceState");
    expect(page).toContain("EcommerceTaskList");
    expect(page).toContain("EcommerceTaskDetail");
    expect(page).toContain("EcommerceConfigPanel");
});
