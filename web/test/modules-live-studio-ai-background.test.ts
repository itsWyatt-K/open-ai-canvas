import { expect, test } from "bun:test";

// 战役三源码断言：直播间 AI 背景面板 / 模块大厅分级 / 分镜矩阵渲染提速 / 门禁脚本前端分片。
// 运行方式：bun test test/modules-live-studio-ai-background.test.ts

async function readSource(relativePath: string): Promise<string> {
    return Bun.file(new URL(`../src/${relativePath}`, import.meta.url)).text();
}

async function readScript(relativePath: string): Promise<string> {
    return Bun.file(new URL(`../../${relativePath}`, import.meta.url)).text();
}

test("直播间装修台提供 AI 生成 9:16 背景极简面板", async () => {
    const page = await readSource("pages/modules/live-studio.tsx");

    // 三个场景预设胶囊 + 一句补充输入 + 生成按钮。
    for (const label of ["温馨家居", "科技展台", "大促狂欢"]) {
        expect(page).toContain(`label: "${label}"`);
    }
    expect(page).toContain("直播间背景");
    expect(page).toContain("补充一句（可选）");
    expect(page).toContain("生成背景");

    // 走项目现有生图通道：requestGeneration + useConfigStore 鉴权，不新造轮子。
    expect(page).toContain('from "@/services/api/image"');
    expect(page).toContain("requestGeneration(");
    expect(page).toContain("useConfigStore");
    expect(page).toContain("store.isAiConfigReady(");
    // 9:16 尺寸随请求带上；跨域 URL 结果转 dataURL 后再进画布。
    expect(page).toContain('size: "9:16"');
    expect(page).toContain("urlToDataUrl(");

    // 生成成功自动置为底层背景，并允许替换 / 移除。
    expect(page).toContain("setBackgroundUrl(dataUrl)");
    expect(page).toContain("换一张");
    expect(page).toContain("已移除背景，可重新生成或上传");
});

test("精修台对账/送画布在直播场景接线", async () => {
    const page = await readSource("pages/modules/live-studio.tsx");

    // onReconcile：一键刷新并合并 = nonce 重挂工作台（直播间无远端详情接口，
    // 页面 state 即最新态；Banner 受控不丢，背景/主体回到页面值）。
    expect(page).toContain("reconcileNonce");
    expect(page).toContain("setReconcileNonce((value) => value + 1)");
    expect(page).toContain("onReconcile={handleReconcile}");

    // onSendToCanvas：直播场景接管且不跳走（默认路径 navigate 会整页卸载丢装修进度）。
    expect(page).toContain("onSendToCanvas={handleSendToCanvas}");
    expect(page).toContain("uploadDataUrlAsResource(composed,");
    expect(page).toContain("本页不跳走，装修进度保留");
});

test("模块大厅第一排置顶三张主力工作台、第二排紧凑工具入口", async () => {
    const page = await readSource("pages/modules/index.tsx");

    // 主力工作台：电商详情工坊 / AI 短剧制作 / 直播间装修台（放大卡）。
    expect(page).toContain("const HERO_CARDS");
    expect(page).toContain("电商详情页工坊");
    expect(page).toContain("AI 短剧制作");
    expect(page).toContain("直播间装修台");
    expect(page).toContain("主力工作台");

    // 工具型入口紧凑排列：E-Reverse 反推 / 技能与插件库。
    expect(page).toContain("const COMPACT_CARDS");
    expect(page).toContain("爆款视觉反推");
    expect(page).toContain("技能与插件库");
    expect(page).toContain("工具与反推");

    // 三个主力卡都放大（size-8 图标 + 大间距 + Token 阴影），紧凑卡收敛为单行。
    // 2026-10-28：原断言锁裸类 "p-5 shadow-md"，返工令要求改用 Design Token（shadow-card），
    // 且卡片改为「渐变封面 + 内容区 p-4」结构，故断言随之更新为 Token 类名。
    // Round 3：主力大卡封面从「渐变底 + 48×48 图标」升级为内联 SVG 骨架插画（零请求），
    // size-8 不再出现；紧凑卡图标 size-5 保留。
    expect(page).toContain("svg");
    expect(page).toContain("shadow-card");
    expect(page).toContain("size-5");
});

test("分镜矩阵列表用 content-visibility 与轻量 SVG 棋盘格替代昂贵样式", async () => {
    const [css, dialog] = await Promise.all([
        readSource("pages/ecommerce/ecommerce.css"),
        readSource("pages/ecommerce/batch-matrix-dialog.tsx"),
    ]);

    // 列表行级跳渲：content-visibility + contain-intrinsic-size（auto 记住真实行高）。
    expect(css).toContain("content-visibility: auto");
    expect(css).toContain("contain-intrinsic-size: auto 40px");
    expect(css).toContain("contain-intrinsic-size: auto 240px");

    // 棋盘格换成 SVG data-uri，不再用多层 repeating-conic-gradient（断言函数调用形态，
    // 注释里提到的历史写法不算数）。
    expect(css).toContain("data:image/svg+xml");
    expect(css).not.toContain("repeating-conic-gradient(");

    // 批量企划矩阵表把行级跳渲类挂到每一行。
    expect(dialog).toContain('rowClassName={() => "ecommerce-matrix-row"}');
    expect(dialog).toContain('import "./ecommerce.css"');
});

test("分片门禁脚本包含前端 bun test 独立分片", async () => {
    const script = await readScript("scripts/run_backend_tests_sharded.py");

    expect(script).toContain('FRONTEND_LABEL = "F1-前端(bun test)"');
    expect(script).toContain('run([bun, "test"], WEB, timeout)');
    // bun 缺失按 FAIL 处理，不静默跳过。
    expect(script).toContain("不静默跳过");
    expect(script).toContain("--skip-frontend");
    expect(script).toContain("--frontend-only");
});
