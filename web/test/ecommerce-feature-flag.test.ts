import { expect, test } from "bun:test";

// F1 源码断言：ecommerceEnabled 功能开关全链路在位（后端 Go 侧由 go test 覆盖）。
// 运行方式：bun test test/ecommerce-feature-flag.test.ts（本机无 bun 时待环境，见 impl-log）。

async function readSource(relativePath: string): Promise<string> {
    return Bun.file(new URL(`../src/${relativePath}`, import.meta.url)).text();
}

test("ecommerceEnabled 开关三处前端落位", async () => {
    const [store, requireFeature, panel] = await Promise.all([
        readSource("stores/use-user-store.ts"),
        readSource("components/auth/require-feature.tsx"),
        readSource("pages/admin/components/feature-availability-panel.tsx"),
    ]);

    // store：类型 + 默认值（新功能默认关闭，由管理员开启）
    expect(store).toContain("ecommerceEnabled: boolean");
    expect(store).toContain("ecommerceEnabled: false");

    // require-feature：union 成员 + 中文名
    expect(requireFeature).toContain('"ecommerceEnabled"');
    expect(requireFeature).toContain('ecommerceEnabled: "电商工坊"');

    // 管理面板：行定义 + editable + payload
    expect(panel).toContain('key: "ecommerceEnabled"');
    expect(panel).toContain('title: "电商工坊"');
    expect(panel).toContain('ecommerceEnabled: features.ecommerceEnabled');
    expect(panel).toContain('"ecommerceEnabled"');
});
