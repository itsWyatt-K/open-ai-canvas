import { expect, test } from "bun:test";

// F2 源码断言：电商工坊入口全链路（路由带功能开关、侧边栏条件渲染、命名统一）。
// 运行方式：bun test test/ecommerce-entry.test.ts（本机无 bun 时待环境，见 impl-log）。

async function readSource(relativePath: string): Promise<string> {
    return Bun.file(new URL(`../src/${relativePath}`, import.meta.url)).text();
}

test("电商工坊路由带 RequireFeature 且侧边栏条件渲染", async () => {
    const [router, sidebar, tools] = await Promise.all([
        readSource("router.tsx"),
        readSource("components/layout/workspace-sidebar-nav.tsx"),
        readSource("constant/navigation-tools.ts"),
    ]);

    // router：/ecommerce 路由被 RequireFeature(ecommerceEnabled) 包裹
    expect(router).toContain('path: "/ecommerce"');
    expect(router).toContain('feature="ecommerceEnabled"');

    // sidebar：条件渲染 + 命名统一为「电商工坊」
    expect(sidebar).toContain('features.ecommerceEnabled ? [{ ...toolItem("ecommerce", "/ecommerce"), title: "电商工坊" }] : []');

    // navigation-tools：slug 与命名
    expect(tools).toContain('slug: "ecommerce"');
    expect(tools).toContain('label: "电商工坊"');
});

test("电商工坊占位页为空态待开放", async () => {
    const page = await readSource("pages/ecommerce/index.tsx");
    expect(page).toContain("电商工坊即将开放");
    expect(page).toContain("WorkspaceState");
});
