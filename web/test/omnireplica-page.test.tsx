/**
 * 全能复刻主舱 · 渲染冒烟（HAPPY_DOM 门控）。
 *
 * 口径：不依赖真实浏览器与后端——用 HAPPY_DOM=1 门控的 happy-dom 验证页面树：
 * 0 积分徽标常驻 / 契约 mock 标注 / 三视图可达 / 三段式输入舱 / 控制栏齐全 / 空态不装死。
 * 不带 HAPPY_DOM 环境变量时整文件跳过（零负担，与 ereverse-handoff-consume 同惯例）。
 */

import { describe, expect, test } from "bun:test";

const happyDom = process.env.HAPPY_DOM === "1";

(happyDom ? describe : describe.skip)("omnireplica 主舱渲染 (HAPPY_DOM)", () => {
    test("主舱渲染：0 积分徽标 / mock 标注 / 三视图 / 控制栏 / 空态全要素（mock 契约数据）", async () => {
        const { renderToStaticMarkup } = await import("react-dom/server");
        const { MemoryRouter } = await import("react-router");
        const { App } = await import("antd");
        const { default: OmnireplicaPage } = await import("@/pages/omnireplica");

        // DEV 默认开 mock；这里显式 ?mock=1 保证任何 NODE_ENV 下口径一致
        window.history.replaceState({}, "", "/omnireplica?mock=1");
        const markup = renderToStaticMarkup(
            <MemoryRouter initialEntries={["/omnireplica"]}>
                <App>
                    <OmnireplicaPage />
                </App>
            </MemoryRouter>,
        );

        // 0 积分硬不变量徽标（渲染/改稿/裂变路径）
        expect(markup).toContain('data-yq="omni-zero-credit"');
        expect(markup).toContain("本地渲染 · 0 积分");

        // 契约 mock 标注（source: mock，联调日整旗清除——不允许伪装真引擎）
        expect(markup).toContain('data-yq="omni-mock-banner"');
        expect(markup).toContain("契约 Mock 数据");

        // 三视图：输入舱 / 蓝图编辑 / 试看操作台（编辑器可达 = tab 存在且可切）
        expect(markup).toContain("① 输入舱");
        expect(markup).toContain("② 蓝图编辑");
        expect(markup).toContain("③ 试看 / 成片 / 裂变");
        expect(markup).toContain('data-yq="omni-view-editor"');
        expect(markup).toContain('data-yq="omni-view-bench"');

        // 三段式输入舱骨架
        expect(markup).toContain('data-yq="omni-cockpit"');
        expect(markup).toContain("参考视频（1~5，主参考驱动拆解）");
        expect(markup).toContain("产品图（[1]~[5]，编号即蓝图绑定键）");
        expect(markup).toContain("还没有产品图"); // 空态不装死

        // 结构化指令模板（可编辑，默认模板含产品替换语义）
        expect(markup).toContain('data-yq="omni-instruction"');
        expect(markup).toContain("【产品替换】");

        // 底部控制栏：引擎（默认本地 0 积分）/ 清晰度 / 并发 + 实心发送 CTA
        expect(markup).toContain('data-yq="omni-control-bar"');
        expect(markup).toContain("本地 Qwen2.5-VL（默认 · 0 积分）");
        expect(markup).toContain("480p 试看（默认 24fps）");
        expect(markup).toContain("引擎并发 1（稳）");
        expect(markup).toContain('data-yq="omni-extract-button"');
        expect(markup).toContain("开始拆解动效蓝图");

        // 蓝图未装配时视图 tab 明示「（未装配）」——不装死
        expect(markup).toContain("（未装配）");

        // 无黑话：页面严禁露出 AbortController 原生 abort 文案
        expect(markup).not.toMatch(/signal\s*is\s*aborted/i);
    });
});
