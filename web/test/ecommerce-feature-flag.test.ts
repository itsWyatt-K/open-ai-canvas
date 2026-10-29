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

    // store：类型 + 默认值。[本地开发权宜 2026-10-12] 旧后端二进制不认识该字段、
    // 管理后台开关会被丢弃，临时置 true 保入口可见；后端重编后应还原 false
    // （源码注释即声明，测试锁定当前真实默认值而非原始设计值）。
    expect(store).toContain("ecommerceEnabled: boolean");
    expect(store).toContain("ecommerceEnabled: true");
    expect(store).toContain("后端重编后应还原为 false");

    // require-feature：union 成员 + 中文名
    expect(requireFeature).toContain('"ecommerceEnabled"');
    expect(requireFeature).toContain('ecommerceEnabled: "电商工坊"');

    // 管理面板：行定义 + editable + payload
    expect(panel).toContain('key: "ecommerceEnabled"');
    expect(panel).toContain('title: "电商工坊"');
    expect(panel).toContain('ecommerceEnabled: features.ecommerceEnabled');
    expect(panel).toContain('"ecommerceEnabled"');
});
