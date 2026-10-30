/**
 * 蓝图编辑器 + 试看操作台 · 组件级渲染验证（HAPPY_DOM 门控，mock 蓝图直灌 props）。
 *
 * 覆盖：theme 零成本高亮 / 镜头列表 / 一键推荐补齐（degraded 三机制之二）/
 *       影响条三层（重截镜头 / 预计耗时 / 缓存依据）/ 裂变批量入口 / 15fps 应急明示。
 * 不带 HAPPY_DOM 环境变量时整文件跳过（零负担，与 ereverse-handoff-consume 同惯例）。
 */

import { describe, expect, test } from "bun:test";

const happyDom = process.env.HAPPY_DOM === "1";
const noop = () => {};

(happyDom ? describe : describe.skip)("omnireplica 编辑器与操作台渲染 (HAPPY_DOM)", () => {
    test("蓝图编辑器：theme 零成本高亮 + 镜头列表 + 一键推荐补齐 + 写实层占位明示", async () => {
        const { renderToStaticMarkup } = await import("react-dom/server");
        const { MemoryRouter } = await import("react-router");
        const { App } = await import("antd");
        const { BlueprintEditor } = await import("@/pages/omnireplica/blueprint-editor");
        const { mockBlueprint } = await import("@/pages/omnireplica/mock");
        const messageApi = { success: noop, warning: noop, info: noop, error: noop } as unknown as ReturnType<typeof App.useApp>["message"];

        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <App>
                    <BlueprintEditor blueprint={mockBlueprint()} products={[]} mock onChange={noop} onGoBench={noop} onGoCockpit={noop} onSendToCanvas={noop} messageApi={messageApi} />
                </App>
            </MemoryRouter>,
        );
        expect(markup).toContain('data-yq="omni-editor"');
        expect(markup).toContain('data-yq="omni-theme-zone"');
        expect(markup).toContain("改这里 = 零成本"); // 换肤零成本关键路径高亮
        expect(markup).toContain("画布与转场"); // 全局作用域区
        expect(markup).toContain('data-yq="omni-shot-list"');
        expect(markup).toContain("镜头列表（3）");
        expect(markup).toContain("⚠️"); // 低置信镜头角标（shot_3 置信度 42%）
        expect(markup).toContain('data-yq="omni-preset-fill-button"');
        expect(markup).toContain("按推荐值补齐全部待确认项");
        expect(markup).toContain("包装镜头（代码生成）");
        // 写实层占位明示（镜头列表头注；逐镜 Tag 随选中镜渲染）
        expect(markup).toContain("实拍镜头（占位，第二阶段可补实拍生成）");
        expect(markup).toContain("蓝图 JSON 原文");
    });

    test("蓝图编辑器空态：未装配 → 引导回输入舱", async () => {
        const { renderToStaticMarkup } = await import("react-dom/server");
        const { MemoryRouter } = await import("react-router");
        const { App } = await import("antd");
        const { BlueprintEditor } = await import("@/pages/omnireplica/blueprint-editor");
        const messageApi = { success: noop, warning: noop, info: noop, error: noop } as unknown as ReturnType<typeof App.useApp>["message"];

        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <App>
                    <BlueprintEditor blueprint={null} products={[]} mock={false} onChange={noop} onGoBench={noop} onGoCockpit={noop} onSendToCanvas={noop} messageApi={messageApi} />
                </App>
            </MemoryRouter>,
        );
        expect(markup).toContain('data-yq="omni-editor-empty"');
        expect(markup).toContain("蓝图还没装配");
        expect(markup).toContain("去输入舱");
    });

    test("操作台：影响条三层常驻 + 单一渲染按钮 + 裂变入口 + 24fps 试水口径", async () => {
        const { renderToStaticMarkup } = await import("react-dom/server");
        const { MemoryRouter } = await import("react-router");
        const { App } = await import("antd");
        const { CopyBench } = await import("@/pages/omnireplica/copy-bench");
        const { mockBlueprint } = await import("@/pages/omnireplica/mock");

        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <App>
                    <CopyBench blueprint={mockBlueprint()} lastRecord={null} products={[]} resolution="480p" fps={24} mock onRecord={noop} onBlueprintChange={noop} onGoEditor={noop} onSendToCanvas={noop} />
                </App>
            </MemoryRouter>,
        );
        expect(markup).toContain('data-yq="omni-bench"');
        // 影响条三层（三条常驻，单一渲染按钮）
        expect(markup).toContain('data-yq="omni-impact"');
        expect(markup).toContain("① 将重截哪些镜头");
        expect(markup).toContain("② 预计耗时");
        expect(markup).toContain("③ 缓存依据");
        expect(markup).toContain("首次渲染，无缓存可命中");
        // 单一渲染按钮（实心主 CTA）
        expect(markup).toContain('data-yq="omni-render-button"');
        expect(markup).toContain("试看渲染");
        // 默认 24fps 试水口径（480p）
        expect(markup).toContain("24 fps（试水默认）");
        // 裂变区 + 批量提交（提交即见预报价）
        expect(markup).toContain('data-yq="omni-batch"');
        expect(markup).toContain("批量裂变");
        expect(markup).toContain('data-yq="omni-batch-button"');
    });

    test("操作台：15fps 应急档明示画质代价（R6/C5 口径）", async () => {
        const { renderToStaticMarkup } = await import("react-dom/server");
        const { MemoryRouter } = await import("react-router");
        const { App } = await import("antd");
        const { CopyBench } = await import("@/pages/omnireplica/copy-bench");
        const { mockBlueprint } = await import("@/pages/omnireplica/mock");

        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <App>
                    <CopyBench blueprint={mockBlueprint()} lastRecord={null} products={[]} resolution="480p" fps={15} mock onRecord={noop} onBlueprintChange={noop} onGoEditor={noop} onSendToCanvas={noop} />
                </App>
            </MemoryRouter>,
        );
        expect(markup).toContain("⚠️ 15fps 应急档");
        expect(markup).toContain("画质代价");
    });

    test("操作台：有上次渲染记录 → 权威 plan 回填 + 节省对比条 + 缓存依据 + 复用徽标", async () => {
        const { renderToStaticMarkup } = await import("react-dom/server");
        const { MemoryRouter } = await import("react-router");
        const { App } = await import("antd");
        const { CopyBench } = await import("@/pages/omnireplica/copy-bench");
        const { mockBlueprint } = await import("@/pages/omnireplica/mock");

        const blueprint = mockBlueprint();
        const record = {
            jobId: "mock-render-1",
            renderKey: "rk_abcdef12",
            resolution: "480p",
            fps: 24,
            at: Date.now() - 60_000,
            videoUrl: "/omnireplica/mock/sample.mp4",
            plan: { recapture_count: 1, reuse_count: 2, estimated_ms: 25_000, full_render_ms: 75_000 },
            blueprint: structuredClone(blueprint),
            source: "试看" as const,
        };
        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <App>
                    <CopyBench blueprint={blueprint} lastRecord={record} products={[]} resolution="480p" fps={24} mock onRecord={noop} onBlueprintChange={noop} onGoEditor={noop} onSendToCanvas={noop} />
                </App>
            </MemoryRouter>,
        );
        expect(markup).toContain("命中缓存 2"); // 权威 plan 摘要
        expect(markup).toContain("节省 67%"); // 对比条
        expect(markup).toContain("rk_abcdef12"); // 缓存依据（哪次渲染）
        expect(markup).toContain("复用"); // 非变更镜头复用徽标
    });

    test("操作台空态：未装配蓝图 → 引导回蓝图编辑", async () => {
        const { renderToStaticMarkup } = await import("react-dom/server");
        const { MemoryRouter } = await import("react-router");
        const { App } = await import("antd");
        const { CopyBench } = await import("@/pages/omnireplica/copy-bench");

        const markup = renderToStaticMarkup(
            <MemoryRouter>
                <App>
                    <CopyBench blueprint={null} lastRecord={null} products={[]} resolution="480p" fps={24} mock={false} onRecord={noop} onBlueprintChange={noop} onGoEditor={noop} onSendToCanvas={noop} />
                </App>
            </MemoryRouter>,
        );
        expect(markup).toContain('data-yq="omni-bench-empty"');
        expect(markup).toContain("去蓝图编辑");
    });
});
