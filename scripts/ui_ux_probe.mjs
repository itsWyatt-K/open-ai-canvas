#!/usr/bin/env node
/**
 * 源起 Studio · 前端 UI/UX 遥测探针（UI X-Ray Probe）
 * ---------------------------------------------------------------------------
 * 用法：
 *   node scripts/ui_ux_probe.mjs [--base http://127.0.0.1:3000] [--out reports] [--cookie <sessionCookie>]
 *
 * 依赖：playwright-cli（PATH 或 WorkBuddy 托管 node 运行时）+ 本机 Edge/Chrome。
 * 浏览器会话在单次 run-code 内完成全部采集，规避 CLI 会话不跨调用保持的问题。
 *
 * 采集 5 模块：① 空间布局 ASCII 透视与占屏比 ② 认知负荷与拥挤度 ③ 视觉层级阶梯
 *             ④ 小白动线摩擦度 ⑤ DOM 与渲染性能
 * 门禁 G0~G19：零折行 / 单卡减负 / 主次分明 / 视觉霸权 / 零脏字符 / 浅层直达 /
 *              拒绝香肠按钮 / 零破图零碰撞 / 直播台真画布 / 电商首屏高度 /
 *              禁止代点绕过(G11) / 精修台弹窗真打开(G12) / 清零蚊子字与纳米按钮(G13) /
 *              爆款反推台不孤岛(G14) / 直播台对标参考图模块(G15) /
 *              反推台状态收敛与实心CTA(G16) / 侧栏布局与定制模块(G17) /
 *              启动控制台体检(G18·Round6) /
 *              跨商品图片隔离+矩阵防重叠+反推台挂栏(G19·Round6)
 *
 * ⚠️ 返工令 Round 6 编号说明：G17 已被上一轮（夜间施工令阶段二）侧栏门禁占用，
 *    为避免同一报告出现双 G17，本轮新增的两条门禁顺延为 G18 / G19。
 *
 * ⚠️ 返工令 Round 4 反绕过加固（重点）：
 *   - 探针禁止代点：删除全部 `document.querySelector("aside ul li").click()` 式主动点击
 *     （含 #unstarted 路由态的 clickUnstarted）。页面必须靠组件自身默认选中；
 *     采不到 SlotCard 或出现「还没有选择商品任务」空态 → G11 直接 FAIL。
 *   - 静默吞错清零：所有 `.catch(() => {})` 改为把失败原因写进该页 probeErrors，
 *     并在报告里展示——上一轮「测了个寂寞」的根因就是失败被吞了。
 *
 * ⚠️ 认证说明：需要已登录会话。三种方式任选其一：
 *   1) --cookie "open_ai_canvas_session=<sid>.<token>"（推荐，见下）
 *   2) 先在本机浏览器登录过一次，探针会自动带上 storageState（若存在 .playwright-cli/auth.json）
 *   3) 不带 cookie：探针会如实报告"未认证，落在登录页"，不会伪造数据
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const argv = process.argv.slice(2);
const arg = (name, dft) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dft;
};
const BASE = arg("base", "http://127.0.0.1:3000");
const OUT_DIR = arg("out", join(ROOT, "reports"));
const COOKIE = arg("cookie", "");
// 独立 CLI 会话：多探针/多智能体并发跑时，彼此的 playwright-cli close 不会误杀本方浏览器
// （共享默认会话时「Target page, context or browser has been closed」会随机抽疯）。
const SESSION = arg("session", `probe-${process.pid}`);
const CLI = `playwright-cli -s=${SESSION}`;
const STAMP = new Date().toISOString().slice(0, 10);

const VIEWPORTS = [
    { name: "1366x768", width: 1366, height: 768 },
    { name: "1920x1080", width: 1920, height: 1080 },
];
const ROUTES = [
    { path: "/modules", label: "模块大厅" },
    { path: "/ecommerce", label: "电商工坊" },
    { path: "/ecommerce#retouch-open", label: "电商工坊·精修台开" },
    { path: "/ecommerce#unstarted", label: "电商工坊·未开始商品" },
    { path: "/ecommerce#matrix-guard", label: "电商工坊·矩阵防重叠与跨商品隔离" },
    { path: "/modules/live-studio", label: "直播装修台" },
    { path: "/ereverse", label: "爆款视觉反推" },
    { path: "/projects", label: "短剧制片台" },
];


/** 注入到页面里的采集函数（单会话一次跑完，返回 JSON 字符串）
 *  注意：本函数会被 toString 后 eval 到隔离上下文，所有依赖必须写在函数体内。 */
const collectFn = async (page, ctx) => {
    const { base, viewports, routes, cookie } = ctx;
    if (cookie) {
        await page.context().addCookies(
            cookie.split(";").map((pair) => {
                const [name, ...rest] = pair.trim().split("=");
                return { name: name.trim(), value: rest.join("=").trim(), domain: "127.0.0.1", path: "/" };
            }),
        );
    }
    const out = { base, collectedAt: new Date().toISOString(), pages: [] };

    // 返工令 Round 6：dev 模块图预热——首访路由的按需编译要 10~30s（多智能体并发编辑
    // 导致 HMR churn 后更慢，实测冷图下 /ecommerce 要 ~20s 才出卡片）。不预热会把
    // 「编译延迟」误报成「左栏未挂载 / SlotCard 未挂载」（昨晚基线跑 600s 超时、
    // G10/G11 假阴性的根因之一）。先在页面上下文把重路由 chunk import 一遍，
    // vite 编译缓存热之后再进正式采集。预热失败不阻断采集（各页等待会兜底）。
    try {
        await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForSelector(".app-workspace-sidebar-nav, .app-workspace-stage, main", { timeout: 20000 });
        for (const mod of [
            "/src/pages/ecommerce/index.tsx",
            "/src/pages/modules/index.tsx",
            "/src/pages/modules/live-studio.tsx",
            "/src/pages/ereverse/index.tsx",
            "/src/pages/projects/index.tsx",
        ]) {
            await page.evaluate((m) => import(m).then(() => undefined, () => undefined), mod);
        }
    } catch (e) {
        out.warmupError = String(e).slice(0, 140);
    }

    for (const vp of viewports) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        for (const route of routes) {
            const rec = { viewport: vp.name, route: route.path, label: route.label, ok: false };
            // 本页采集期的显式失败记录（返工令 Round 4：清零 .catch(()=>{}) 静默吞错）
            const probeErrors = [];
            try {
                await page.goto(base + route.path.split("#")[0], { waitUntil: "domcontentloaded", timeout: 20000 });
                // 水合竞态修正：固定 sleep 会让同一路由在两个视口下采到不同进度
                // （/modules 在 1366 下曾只采到 26 个节点）。改为等待侧栏骨架挂载后再采集。
                try {
                    await page.waitForSelector(".app-workspace-sidebar-nav, .app-workspace-stage, main", { timeout: 20000 });
                } catch (e) {
                    probeErrors.push(`等待工作台骨架超时（.app-workspace-sidebar-nav/.app-workspace-stage/main 20s 未出现）：${String(e).slice(0, 80)}`);
                }
                await page.waitForTimeout(900);
                // 直播装修台：常驻 9:16 画布是懒加载 chunk，首次编译可达数秒，
                // 必须等它挂载再采集，否则 G9 会采到空骨架（假阴性）。
                if (route.path === "/modules/live-studio") {
                    try {
                        await page.waitForSelector(".yq-live-canvas", { timeout: 20000 });
                    } catch (e) {
                        probeErrors.push(`等待 .yq-live-canvas 超时（G9 可能假阴性）：${String(e).slice(0, 80)}`);
                    }
                    await page.waitForTimeout(600);
                }
                // /ereverse：健康检查（侧车 8790）与 dev 首编译可能要几秒，状态点不到场就采，
                // G16 会把「等待延迟」误报成「状态未收敛」——等到状态点或侧车告警再采。
                if (route.path === "/ereverse") {
                    try {
                        await page.waitForSelector(".yq-ereverse-status-dot, .ant-alert", { timeout: 20000 });
                    } catch (e) {
                        probeErrors.push(`等待 /ereverse 状态点超时（.yq-ereverse-status-dot/.ant-alert 20s 未出现，G16 可能假阴性）：${String(e).slice(0, 80)}`);
                    }
                    await page.waitForTimeout(400);
                }

                // ⚠️ G11 反绕过（返工令 Round 4）：删掉全部 `aside ul li` 代点击。
                // 上一轮探针主动点左栏第一个商品任务来"进入选中态"——页面自身没有默认
                // 选中也能采到 7 张 SlotCard，G2/G3/G4/G10 全是假绿。现在只等待：
                // 选中态必须由组件自身提供；采不到就如实记失败原因。
                if (route.path.startsWith("/ecommerce")) {
                    try {
                        await page.waitForSelector("aside ul li", { timeout: 20000 });
                    } catch (e) {
                        probeErrors.push(`左栏商品列表未挂载（aside ul li 20s 等待超时）：${String(e).slice(0, 80)}`);
                    }
                    try {
                        await page.waitForFunction(
                            () => document.querySelectorAll(".ecommerce-slot-card-title").length >= 7,
                            { timeout: 25000 },
                        );
                    } catch (e) {
                        // 显式区分两种失败：空态（组件没默认选中）vs 竞态（选中但卡没挂载）
                        const stuckEmpty = await page.evaluate(() => /还没有选择商品任务/.test(document.body.innerText || ""));
                        probeErrors.push(
                            stuckEmpty
                                ? "页面停在「还没有选择商品任务」空态：组件没有默认选中商品（G11 FAIL 的根因，需页面侧修复）"
                                : `等待 7 张 SlotCard 超时（页面已默认选中但分镜卡未挂载）：${String(e).slice(0, 80)}`,
                        );
                    }
                    await page.waitForTimeout(1000);
                    // 布局稳定复核：首排卡片顶边可能因图片/骨架异步撑高而位移，
                    // 轮询到 y 连续两次不变再采（否则会采到布局中间态，G10 假失败）。
                    // 没有卡片时不空转——直接进采集，让 G10/G11 如实报失败。
                    const hasSlotCard = await page.evaluate(() => Boolean(document.querySelector(".ecommerce-slot-card-title")));
                    if (hasSlotCard) {
                        let lastY = -1;
                        for (let i = 0; i < 12; i += 1) {
                            const y = await page.evaluate(() => {
                                const t = document.querySelector(".ecommerce-slot-card-title");
                                const card = t ? t.closest("article") || t.closest("[class*='yq-slot-card-virtual']") : null;
                                return card ? Math.round(card.getBoundingClientRect().top) : -1;
                            });
                            if (y >= 0 && y === lastY) break;
                            lastY = y;
                            await page.waitForTimeout(350);
                        }
                    }
                    // #unstarted 路由态：不再代点。页面默认选中什么就如实采什么——
                    // 默认选中的不是未开始商品时，G10「覆盖未开始态」会如实判失败。
                }
                // 批量企划矩阵防重叠 + 跨商品图片隔离（返工令 Round 6 · G19）。
                // ⚠️ 与 G11「禁止代点绕过」的区别（重要，避免被误判为代点作弊）：
                //   G11 禁的是「为了伪造选中态而代点」——选中态必须由组件自身默认选中提供；
                //   而这里的点击是「跨商品图片隔离 / 矩阵弹窗」这些待测功能本身的用户动线
                //   （与 G12 点开精修台同理）：依次打开第 1、2 个商品核对透明主体图是否串台，
                //   勾选商品打开批量矩阵量单元格重叠。采不到就记显式失败，绝不伪造数据。
                if (route.path === "/ecommerce#matrix-guard") {
                    const guard = { ok: false, reasons: [] };
                    rec.matrixGuard = guard; // 先挂记录，后续异常也能在报告里看到原因
                    let activeIndex = 0; // 页面默认选中的商品下标，收尾还原用
                    const cutoutSrc = () =>
                        page.evaluate(() => {
                            const img = document.querySelector("img[alt='透明商品主体']");
                            return img && img.getAttribute("src") ? String(img.getAttribute("src")) : "";
                        });
                    // 等「透明商品主体」图落定；expectDifferentFrom 非空时还要等它换成新 src
                    // （切商品后旧图的 dataURL 会残留一帧，必须等到不同才算数）
                    const waitCutout = async (expectDifferentFrom, timeoutMs) => {
                        const deadline = Date.now() + timeoutMs;
                        let last = "";
                        while (Date.now() < deadline) {
                            last = await cutoutSrc();
                            if (last && (!expectDifferentFrom || last !== expectDifferentFrom)) return last;
                            await page.waitForTimeout(700);
                        }
                        return "";
                    };
                    const clickProduct = (index) =>
                        page.evaluate((i) => {
                            const li = document.querySelectorAll("aside ul li")[i];
                            if (li) li.click();
                        }, index);
                    try {
                        // 先记录当前默认选中的商品下标（收尾要还原回去，静态采集才干净）
                        activeIndex = await page.evaluate(() => {
                            const lis = Array.from(document.querySelectorAll("aside ul li"));
                            const i = lis.findIndex((li) => /bg-primary/.test(li.className || ""));
                            return i >= 0 ? i : 0;
                        });
                        const names = await page.evaluate(() =>
                            Array.from(document.querySelectorAll("aside ul li"))
                                .slice(0, 4)
                                .map((li) => (li.innerText || "").trim().split("\n")[0].slice(0, 24)),
                        );
                        if (names.length < 2) {
                            guard.reasons.push(`左栏商品不足 2 个（${names.length} 个），无法验证跨商品隔离`);
                        } else {
                            // 从第 1 个商品起依次点开，收集两个健康（src 非空且互异）的
                            // 「透明商品主体」图。某个商品源文件缺失/抠图失败时顺延下一个并
                            // 如实记 reason——是容错，不是伪造（选中态始终来自真实点击）。
                            const found = [];
                            const skipped = [];
                            for (let i = 0; i < Math.min(4, names.length) && found.length < 2; i += 1) {
                                await clickProduct(i);
                                const src = await waitCutout(found[0] ? found[0].src : "", i === 0 ? 30_000 : 25_000);
                                if (src) found.push({ index: i, src });
                                else skipped.push(`第 ${i + 1} 个商品「${names[i]}」透明主体图未出（源文件缺失或抠图失败），已顺延`);
                            }
                            guard.productIndexes = found.map((f) => f.index);
                            guard.productNames = found.map((f) => names[f.index]);
                            guard.src1Len = found[0] ? found[0].src.length : 0;
                            guard.src2Len = found[1] ? found[1].src.length : 0;
                            guard.isolated = found.length === 2 && found[0].src !== found[1].src;
                            guard.skipped = skipped;
                            if (found.length < 2) guard.reasons.push(...skipped, `只收集到 ${found.length} 个可用商品主体图，无法验证跨商品隔离`);
                            if (found.length === 2 && found[0].src === found[1].src) guard.reasons.push("两个商品的透明主体 img src 完全相同——跨商品图片串台！");
                            // 还原默认选中态
                            await clickProduct(activeIndex);
                            await page.waitForTimeout(800);
                        }
                    } catch (e) {
                        guard.reasons.push(`跨商品隔离采集异常：${String(e).slice(0, 120)}`);
                    }
                    // ③ 勾选商品 → 批量工具条浮现 → 全选 → 打开「批量企划矩阵」→ 量单元格重叠
                    if (!guard.reasons.length) {
                        try {
                            await page.evaluate(() => {
                                const li = document.querySelectorAll("aside ul li")[0];
                                const box = li.querySelector("input[type='checkbox']");
                                if (box && !box.checked) box.click();
                            });
                            await page.waitForSelector("button[aria-label='批量企划矩阵']", { timeout: 10_000 });
                            // 全选：把左栏所有商品都纳入矩阵——长商品名可能在任意一行，
                            // 只有全部入表才能覆盖到「超长名捅穿屏 1」这个待测场景。
                            await page.evaluate(() => {
                                const all = document.querySelector("input[aria-label='全选商品任务']");
                                if (all && !all.checked) all.click();
                            });
                            await page.waitForTimeout(600);
                            await page.evaluate(() => {
                                const btn = document.querySelector("button[aria-label='批量企划矩阵']");
                                if (btn) btn.click();
                            });
                            // ⚠️ 选择器口径：本仓 antd v6 的 Modal 渲染为
                            // .ant-modal-wrap > .ant-modal[role=dialog] > .ant-modal-container，
                            // 没有 .ant-modal-content 类（G12 靠 [role='dialog'] 兜底才没漏）。
                            // 且矩阵行带 content-visibility:auto，视口外行内容被跳过——
                            // 必须等 DOM 挂载 + 等屏序列加载完（details 拉完前 maxSlots=0，
                            // 整表只有「商品」一列，量不到「屏 1」），不能用默认的 'visible'。
                            await page.waitForSelector(".ant-modal-wrap .ant-table-tbody tr", { state: "attached", timeout: 30_000 });
                            await page.waitForFunction(
                                () => Array.from(document.querySelectorAll(".ant-modal-wrap .ant-table-tbody tr"))
                                    .some((r) => r.querySelectorAll("td").length >= 2),
                                { timeout: 30_000 },
                            );
                            await page.waitForTimeout(1200);
                            // 逐行量「商品名」与「屏 1」的重叠：超长名可能在任意一行，
                            // 取全表最大值判定（最强口径），并回报最宽那一行的明细。
                            // content-visibility 跳过的行没有按钮/文本容器，记 skipped 不计入。
                            const overlap = await page.evaluate(() => {
                                const rows = Array.from(document.querySelectorAll(".ant-modal-wrap .ant-table-tbody tr"));
                                if (!rows.length) return { ok: false, reason: "矩阵表格无数据行" };
                                const perRow = [];
                                let skipped = 0;
                                for (const row of rows) {
                                    const tds = Array.from(row.querySelectorAll("td"));
                                    const nameTd = tds[0];
                                    const shotTd = tds[1];
                                    if (!nameTd || !shotTd) { skipped += 1; continue; }
                                    const nameBtn = nameTd.querySelector("button");
                                    const shotBox = shotTd.querySelector("div, span");
                                    if (!nameBtn || !shotBox) { skipped += 1; continue; }
                                    // 商品名「可见文本盒」：Range 文本 rect 与按钮盒取交——
                                    // truncate 裁剪后用户真实能看到的部分；不取交会把裁剪前的
                                    // 完整文本宽度算进来，修好了也误判成重叠。
                                    const rg = document.createRange();
                                    rg.selectNodeContents(nameBtn);
                                    const textRects = Array.from(rg.getClientRects());
                                    const br = nameBtn.getBoundingClientRect();
                                    const vis = textRects.length
                                        ? {
                                              left: Math.max(br.left, ...textRects.map((r) => r.left)),
                                              right: Math.min(br.right, ...textRects.map((r) => r.right)),
                                              top: Math.max(br.top, ...textRects.map((r) => r.top)),
                                              bottom: Math.min(br.bottom, ...textRects.map((r) => r.bottom)),
                                          }
                                        : { left: br.left, right: br.right, top: br.top, bottom: br.bottom };
                                    const sr = shotBox.getBoundingClientRect();
                                    const ox = Math.min(vis.right, sr.right) - Math.max(vis.left, sr.left);
                                    const oy = Math.min(vis.bottom, sr.bottom) - Math.max(vis.top, sr.top);
                                    const textOverlap = ox > 0 && oy > 0 ? ox * oy : 0;
                                    const ntr = nameTd.getBoundingClientRect();
                                    const cellOx = Math.min(ntr.right, sr.right) - Math.max(ntr.left, sr.left);
                                    const cellOy = Math.min(ntr.bottom, sr.bottom) - Math.max(ntr.top, sr.top);
                                    const cellOverlap = cellOx > 0 && cellOy > 0 ? cellOx * cellOy : 0;
                                    perRow.push({
                                        ok: true,
                                        nameText: (nameBtn.textContent || "").trim().slice(0, 20),
                                        nameBtnW: Math.round(br.width),
                                        shotText: (shotBox.textContent || "").trim().slice(0, 16),
                                        textOverlap: Math.round(textOverlap * 10) / 10,
                                        cellOverlap: Math.round(cellOverlap * 10) / 10,
                                    });
                                }
                                if (!perRow.length) return { ok: false, reason: `所有行都量不到单元格（${skipped} 行被 content-visibility 跳过或结构缺失）` };
                                const widest = perRow.reduce((a, b) => (b.nameBtnW > a.nameBtnW ? b : a));
                                return {
                                    ok: true,
                                    rowCount: rows.length,
                                    measuredRows: perRow.length,
                                    skippedRows: skipped,
                                    maxTextOverlap: Math.max(...perRow.map((r) => r.textOverlap)),
                                    maxCellOverlap: Math.max(...perRow.map((r) => r.cellOverlap)),
                                    widestName: widest.nameText,
                                    widestNameBtnW: widest.nameBtnW,
                                    widestRowTextOverlap: widest.textOverlap,
                                };
                            });
                            guard.matrix = overlap;
                            if (!overlap.ok) guard.reasons.push(String(overlap.reason));
                        } catch (e) {
                            guard.reasons.push(`矩阵弹窗采集异常：${String(e).slice(0, 120)}`);
                        }
                        // ④ 收尾还原：关弹窗 → 取消勾选 → 点回第 1 个商品，把页面恢复到
                        //    与基础 /ecommerce 记录一致的状态（默认选中 + 无勾选），
                        //    后续静态采集（G10/G11）量的才是干净页面。
                        try {
                            await page.keyboard.press("Escape");
                            await page.waitForTimeout(400);
                            await page.evaluate(() => {
                                const all = document.querySelector("input[aria-label='全选商品任务']");
                                if (all && all.checked) all.click();
                            });
                            await clickProduct(activeIndex);
                            await page.waitForTimeout(800);
                            // 布局稳定复核（与基础 /ecommerce 同口径）：切回商品 1 后卡片异步
                            // 重排，轮询到首排 y 连续两次不变再进静态采集，防 G10 采到中间态。
                            let lastY = -1;
                            for (let i = 0; i < 12; i += 1) {
                                const y = await page.evaluate(() => {
                                    const t = document.querySelector(".ecommerce-slot-card-title");
                                    const card = t ? t.closest("article") || t.closest("[class*='yq-slot-card-virtual']") : null;
                                    return card ? Math.round(card.getBoundingClientRect().top) : -1;
                                });
                                if (y >= 0 && y === lastY) break;
                                lastY = y;
                                await page.waitForTimeout(350);
                            }
                        } catch (e) {
                            probeErrors.push(`矩阵 Guard 收尾还原异常（静态采集状态可能被污染）：${String(e).slice(0, 100)}`);
                        }
                    }
                    guard.ok = guard.reasons.length === 0 && guard.isolated === true && Boolean(guard.matrix && guard.matrix.ok);
                }
                // 精修台开：点第一屏卡内的「分层精修」打开弹窗。
                // ⚠️ 这不是 G11 禁止的"代点伪造选中态"——选中态由页面默认选中提供，
                // 这里点的是待测功能本身（弹窗开合）的用户动线；打不开就记显式失败。
                if (route.path === "/ecommerce#retouch-open") {
                    let opened = false;
                    for (let attempt = 0; attempt < 4 && !opened; attempt += 1) {
                        opened = await page.evaluate(() => {
                            const cards = Array.from(document.querySelectorAll(".ecommerce-slot-card-title"));
                            const firstCard = cards[0]?.closest("article");
                            if (!firstCard) return false;
                            const btns = Array.from(firstCard.querySelectorAll("button"));
                            // 文案要连 aria-label 一起看：「⋯」更多菜单是图标按钮，textContent 为空
                            const say = (b) => `${b.textContent || ""} ${b.getAttribute("aria-label") || ""}`;
                            const direct = btns.find((b) => /分层精修/.test(say(b)));
                            if (direct) { direct.click(); return true; }
                            const menu = btns.find((b) => /更多|⋯|\.\.\.|操作/.test(say(b)) || b.getAttribute("aria-haspopup") === "menu");
                            if (menu) { menu.click(); return true; }
                            return false;
                        });
                        if (opened) {
                            await page.waitForTimeout(700);
                            opened = await page.evaluate(() => {
                                // 「⋯」是 antd Popover 行式菜单（.ecommerce-slot-more-item），不是 Dropdown
                                const items = Array.from(document.querySelectorAll(".ant-dropdown-menu-item, [role='menuitem'], .ant-popover-inner button, .ecommerce-slot-more-item, li"));
                                const hit = items.find((b) => /精修|分层/.test(b.textContent || ""));
                                if (hit) { hit.click(); return true; }
                                return false;
                            });
                        }
                        await page.waitForTimeout(1200);
                    }
                    if (!opened) probeErrors.push("未找到可打开精修台的入口（首屏卡内「分层精修」按钮 / ⋯ 更多菜单均未命中）");
                    try {
                        await page.waitForSelector(".ant-modal-content, [role='dialog'], .ant-drawer-content", { timeout: 20000 });
                    } catch (e) {
                        probeErrors.push(`精修台弹窗容器未出现（.ant-modal-content / [role='dialog'] 20s 等待超时）：${String(e).slice(0, 80)}`);
                    }
                    await page.waitForTimeout(1800);
                }
                // 图片落定：等视口内 img 加载完再采集，避免把「还在加载」误报成破图
                // （G8 查的是真破图；加载中的图 decode() 会 pending，race 兜底 4s）。
                // 解码失败的图不再静默吞掉——记进 probeErrors 供 G8 排查。
                const decodeFailures = await page.evaluate(async () => {
                    const imgs = Array.from(document.querySelectorAll("img")).filter((img) => {
                        const r = img.getBoundingClientRect();
                        return r.width > 0 && r.height > 0 && r.bottom >= 0 && r.top <= window.innerHeight && r.right >= 0 && r.left <= window.innerWidth;
                    });
                    const failed = [];
                    const settle = (img) => (img.complete ? Promise.resolve() : img.decode().then(() => undefined, () => failed.push((img.currentSrc || img.src || "").slice(0, 80))));
                    await Promise.race([
                        Promise.all(imgs.map(settle)),
                        // 返工令 Round 6：4s 在多智能体并发编辑 + 双侧车 + 探针浏览器的高负载下
                        // 会把「还在加载」的 500KB+ 商品图误报成破图（G8 假阳性），放宽到 6s。
                        new Promise((resolve) => setTimeout(resolve, 6000)),
                    ]);
                    return failed;
                }).catch((e) => [`图片预检本身异常：${String(e).slice(0, 80)}`]);
                for (const failure of decodeFailures) probeErrors.push(`图片解码失败：${failure}`);
                const data = await page.evaluate(() => {
                    // 必须在回调内定义：page.evaluate 会把本函数序列化到浏览器上下文执行，
                    // 外层闭包变量（含 collectFn 里的常量）在浏览器侧不可见。
                    // ⚠️ 返工令 Round 4：裸 500|502 会把商品名里的合法规格（如「500 ml」）
                    // 误判成脏字符——那是用户数据不是泄漏的错误文案。5xx 改成只在
                    // 「像错误文案」的上下文里命中（HTTP 5xx / status code 5xx / 5xx 错误…）。
                    const DIRTY_RE = /\*\*|###|undefined|null|NaN|revision\s*冲突|Error|Internal Server|Bad Gateway|HTTP\s*5\d\d|(?:status\s*code|状态码|错误|失败)\s*[：:]?\s*5\d\d|5\d\d\s*(?:Internal Server|Error|错误)/i;
                    const q = (s) => Array.from(document.querySelectorAll(s));
                    const rect = (el) => {
                        const r = el.getBoundingClientRect();
                        return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
                    };
                    const vw = window.innerWidth, vh = window.innerHeight;

                    // ① 一级/二级容器几何
                    const containers = q("main, [class*='layout'], [class*='workspace'], [class*='shell'], aside, header")
                        .slice(0, 12)
                        .map((el) => ({
                            tag: el.tagName.toLowerCase(),
                            cls: (el.className || "").toString().slice(0, 60),
                            ...rect(el),
                        }));

                    // ② 单卡密度 + 折行/溢出抓拍
                    // 卡片选择器：除 slot-card/module-card 外，补上模块大厅的真实结构
                    // （Link > article.rounded-xl.border，类名里没有 "card" 字样）。
                    // 排除 -title/-subtitle 后缀：.ecommerce-slot-card-title/subtitle 是卡内文本触发器，
                    // 不是卡片容器（此前把它们也算成卡，7 张分镜卡被虚报成 21 张）。
                    const cards = q("article, [class*='tile'], [class*='slot-card']:not([class*='-title']):not([class*='-subtitle']), [class*='SlotCard'], [class*='module-card'], [class*='card']:not([class*='-title']):not([class*='-subtitle'])")
                        .slice(0, 24)
                        .map((el) => ({
                            cls: (el.className || "").toString().slice(0, 50),
                            ...rect(el),
                            buttons: q("button").filter((b) => el.contains(b)).length,
                    // 可见按钮 = 有实底或有边框的按钮；透明无边的文本触发器（如「点击原位改字」的
                    // 主副标题）不算——战役一规范明确要求主副标题可点击原位改字，那是文本态可供性。
                    // 底部操作区按钮：取 article 最后一个「含 ≥2 个按钮」的直接子容器（即控制栏），
                    // 只数其中的可见按钮。卡片其他位置的可见按钮（如「🎛 场景企划」抽屉触发器）
                    // 归为 panelTriggers 单独报——战役一规范明确要求「底部 1 主 + 1 次 + 1 ⋯」
                    // 且把场景企划触发器列为必要件，两者是不同类别，不能混为一个个数。
                    actionButtons: (() => {
                        const kids = Array.from(el.children).filter((k) => k.querySelectorAll("button").length >= 2);
                        const bar = kids[kids.length - 1];
                        const scope = bar || el;
                        return q("button").filter((b) => {
                            if (!scope.contains(b)) return false;
                            const cs = getComputedStyle(b);
                            const bg = cs.backgroundColor || "";
                            const hasBg = /rgb\(/.test(bg) && !/rgba\(0, 0, 0, 0\)/.test(bg);
                            const hasBorder = parseFloat(cs.borderTopWidth || "0") > 0;
                            const hasGradient = /gradient/.test(cs.backgroundImage || "");
                            return hasBg || hasBorder || hasGradient || b.classList.contains("ant-btn");
                        }).length;
                    })(),
                    panelTriggers: q("button").filter((b) => {
                        if (!el.contains(b)) return false;
                        const cs = getComputedStyle(b);
                        const bg = cs.backgroundColor || "";
                        const visible = (/rgb\(/.test(bg) && !/rgba\(0, 0, 0, 0\)/.test(bg)) || parseFloat(cs.borderTopWidth || "0") > 0 || /gradient/.test(cs.backgroundImage || "") || b.classList.contains("ant-btn");
                        if (!visible) return false;
                        const kids = Array.from(el.children).filter((k) => k.querySelectorAll("button").length >= 2);
                        const bar = kids[kids.length - 1];
                        return bar ? !bar.contains(b) : false;
                    }).length,
                            inputs: el.querySelectorAll("input,textarea,select").length,
                            badges: el.querySelectorAll("[class*='badge'],[class*='tag'],[class*='Badge'],[class*='Tag']").length,
                            chars: (el.innerText || "").replace(/\s+/g, "").length,
                        }));

                    const wrapped = [];
                    // 选择器修正：原 [class*='tag'] 会误中 "app-workspace-stage"（stage 含子串 tag），
                    // 把 1720×1080 的主舞台容器当成徽标采集。改用显式类名 + 大写 Tag（大小写敏感，不匹配 stage）。
                    // E5 内容容器豁免：卡片/模块卡的 title+desc 多行是设计意图，不算控件折行。
                    // 只测「控件」：button/a/th/徽标，且排除位于卡片描述区（非 CTA）的元素。
                    for (const el of q("button, a, th, .ant-tag, .ant-badge, [class*='badge'], [class*='Badge'], [class*='Tag'], [class*='Pill'], [class*='pill']")) {
                        // 跳过卡片正文描述：含 desc/description/content 类的容器内的纯文本链接
                        if (el.closest("[class*='desc'], [class*='description'], [class*='card-body'], [class*='module-card']") && !el.closest("button")) continue;
                        const cs = getComputedStyle(el);
                        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 || r.height === 0) continue;
                        const text = (el.innerText || "").trim();
                        if (!text) continue;
                        // G1 正确口径：量文字叶子的可视行盒数，天然免疫 padding / min-height /
                        // 图标 / 兄弟堆叠。原公式 r.height > lh*1.5 量的是控件盒子高度，
                        // 会把「单行 + 12px padding」的侧栏导航项误判成折行。
                        const isSrOnly = (n) => {
                            const cs2 = getComputedStyle(n);
                            return cs2.position === "absolute" && (cs2.width === "1px" || /inset\(50%\)|rect\(0/.test(cs2.clipPath + cs2.clip));
                        };
                        // 只取「控件级」文本叶子：排除嵌套在内容容器（p / desc / li / td）里的散文文本。
                        // 否则卡片描述（<a> 的后代 <p>）的多行会被算到链接控头上，误判成按钮折行。
                        const leaves = Array.from(el.querySelectorAll("*")).filter((n) =>
                            Array.from(n.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim()) &&
                            !isSrOnly(n) &&
                            !n.closest("p, [class*='desc'], [class*='description'], li, td, blockquote"),
                        );
                        if (!leaves.length) continue; // 纯图标控件（文字在 sr-only/title）不测
                        let hit = null;
                        for (const leaf of leaves) {
                            const lcs = getComputedStyle(leaf);
                            const nowrap = lcs.whiteSpace === "nowrap" || lcs.whiteSpace === "pre";
                            if (nowrap) {
                                // truncate 结构上不可折行；超长省略属内容密度，降级为 warning
                                if (leaf.scrollWidth > leaf.clientWidth + 1) hit = { kind: "ellipsis", text: (leaf.textContent || "").trim().slice(0, 24), leafW: leaf.clientWidth };
                                continue;
                            }
                            // 只对「文本节点」建 Range：inline-flex 的 icon(svg) 与文字高度不同，
                            // selectNodeContents 会把两者都算进来，top 差 1~2px 就假造出"两行"。
                            const rg = document.createRange();
                            let started = false;
                            for (const cn of leaf.childNodes) {
                                if (cn.nodeType === 3 && cn.textContent.trim()) {
                                    if (!started) { rg.setStartBefore(cn); started = true; }
                                    rg.setEndAfter(cn);
                                }
                            }
                            const tops = started ? new Set(Array.from(rg.getClientRects()).map((x) => Math.round(x.top))) : new Set();
                            if (tops.size > 1) { hit = { kind: "wrapped", text: (leaf.textContent || "").trim().slice(0, 24), lines: tops.size }; break; }
                            if (leaf.scrollWidth > leaf.clientWidth + 1 && lcs.textOverflow !== "ellipsis" && !/auto|scroll/.test(lcs.overflowX)) {
                                hit = { kind: "overflow", text: (leaf.textContent || "").trim().slice(0, 24), scrollW: leaf.scrollWidth, clientW: leaf.clientWidth };
                            }
                        }
                        if (hit) wrapped.push(hit);
                    }
                    const hScroll = document.documentElement.scrollWidth > vw + 1;

                    // ③ 视觉层级阶梯
                    const ladder = {};
                    for (const el of q("h1,h2,h3,h4,p,span,button,[class*='title'],[class*='label']")) {
                        const text = (el.innerText || "").trim();
                        // h1/h2/h3 允许更长文本（此前 >40 字一律跳过，导致页面大标题被漏采、字号阶梯塌陷）
                        if (!text) continue;
                        if (text.length > 40 && !/^h[1-3]$/i.test(el.tagName)) continue;
                        const cs = getComputedStyle(el);
                        const key = `${cs.fontSize}|${cs.fontWeight}|${cs.color}`;
                        ladder[key] = (ladder[key] || 0) + 1;
                    }
                    // 实心主按钮判定：backgroundColor 实色 或 backgroundImage 含渐变（皮肤系统用渐变填充，
                    // 经 background 简写后 backgroundColor 仍为透明，只查前者会漏报真主 CTA）。
                    const isSolidFilled = (el) => {
                        const cs = getComputedStyle(el);
                        const bg = cs.backgroundColor || "";
                        const solidColor = /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && !/rgba\(0, 0, 0, 0\)/.test(bg);
                        const gradient = /gradient/.test(cs.backgroundImage || "");
                        return solidColor || gradient;
                    };
                    // 选中态排除：单选组/tab 当前项按设计就该用主色填充，不算 CTA。
                    const isSelectedState = (el) => {
                        if (el.getAttribute("aria-pressed") === "true") return true;
                        if (el.getAttribute("aria-selected") === "true") return true;
                        if (el.getAttribute("aria-checked") === "true") return true;
                        const role = el.getAttribute("role");
                        if ((role === "tab" || role === "radio") && (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-checked") === "true")) return true;
                        return !!el.closest("[aria-selected='true'], [aria-checked='true'], [aria-pressed='true']");
                    };
                    // [class*='primary'] 裸子串会误中 bg-primary/10、hover:border-primary/50、text-primary 等
                    // Tailwind 工具类，把单选胶囊和悬停态算成 CTA。改为只认 antd 主按钮类与显式 cta 类。
                    // AI 魔法按钮单列：Design Token 规范明确把「indigo→fuchsia 渐变」指定为 AI 算子
                    // 专属视觉（✨AI 换思路 / ✂️提取透明主体 / 🎨按草图生成正式图），与主行动点
                    // （保存/确认类实心 primary）是不同语义类别。若混在一起数，G3 会把每个合规的
                    // AI 按钮都判成"第二个主 CTA"。故渐变按钮归 aiMagicCtas，不进主 CTA 判定。
                    const isAiMagic = (el) => {
                        const cs = getComputedStyle(el);
                        const bi = cs.backgroundImage || "";
                        return /gradient/.test(bi) && /(indigo|violet|fuchsia|purple|oklab\(0\.[5-9]|color\(srgb 0\.(4|5|6))/.test(bi + " " + (el.className || ""));
                    };
                    const ctaCandidates = q("button.ant-btn-primary, [class*='cta'], button[type='submit']")
                        .filter((el) => !isSelectedState(el) && !isAiMagic(el));
                    const aiMagicCtas = q("button.ant-btn-primary, [class*='cta'], button[type='submit']")
                        .filter((el) => !isSelectedState(el) && isAiMagic(el)).length;
                    const solidCtas = ctaCandidates.filter(isSolidFilled).length;
                    const primaryBtns = q("button").filter(isSolidFilled).length;
                    // G3 按操作区分组：每个 section/article/浮层根各自应至多 1 个实心主按钮。
                    const allZones = q("section, article, form, [class*='panel'], [class*='Panel'], [class*='modal'], [class*='Modal'], [class*='drawer'], [class*='Drawer']");
                    // 只数「叶子操作区」：外层 section 会把内层 7 张分镜卡的 CTA 聚合成本区 7 个，
                    // 那是统计假象不是设计违规。叶子区 = 不含另一个 zone 的 zone。
                    const zones = allZones.filter((z) => !allZones.some((o) => o !== z && z.contains(o)));
                    const zoneList = zones.length ? zones : [document.body];
                    let ctaZones = 0, ctaZonesOk = 0;
                    for (const zone of zoneList) {
                        const found = ctaCandidates.filter((el) => zone.contains(el) && isSolidFilled(el));
                        if (!found.length) continue;
                        ctaZones += 1;
                        if (found.length === 1) ctaZonesOk += 1;
                    }

                    // ④ 脏字符
                    const bodyText = document.body.innerText || "";
                    const dirty = [];
                    const lines = bodyText.split("\n");
                    for (const line of lines) {
                        if (DIRTY_RE.test(line) && line.trim().length > 0 && line.trim().length < 120) {
                            dirty.push(line.trim().slice(0, 60));
                        }
                    }

                    // ⑤ 性能
                    const perf = {
                        domNodes: document.querySelectorAll("*").length,
                        maxDepth: (function depth(el, d = 0) {
                            let m = d;
                            for (const c of el.children) m = Math.max(m, depth(c, d + 1));
                            return m;
                        })(document.body),
                        conic: q("[style*='repeating-conic-gradient'], [class*='repeating-conic']").length,
                        dropShadow: q("[style*='drop-shadow'], [class*='drop-shadow']").length,
                        contentVisibility: q("[class*='yq-slot-card-virtual'], [style*='content-visibility']").length,
                    };

                    // 占屏比账本（按可见区域粗分）
                    // 视觉区统计：除 img/canvas/video 外，还必须统计「div + background-image」型预览区
                    // （直播装修台/精修台的画布就是这种渲染方式，只数 img/canvas 会恒为 0，导致 G4 假失败）。
                    // ⚠️ 2026-10-28 返工修正（总架构师审计）：此前把 [class*='stage']/[class*='frame'] 也算进来，
                    // 再把 roots 取最外层，结果整个 .app-workspace-stage（1166×768，恰占 1366 视口 85.4%）
                    // 被当成"视觉预览区"——四个页面 vis% 完全相同（85.9/89.9）就是这个漏洞的指纹。
                    // 现在只认真正的视觉媒介容器，且单项面积不得为主舞台的 80% 以上（主舞台是布局容器不是预览区）。
                    // 视觉媒介 = 显式媒介标签 + 视觉类名容器 + 「div/section 带 background-image」。
                    // 最后一条不可省：未出图分镜卡的 3:4 画框是「渐变底 div」，没有 img/canvas，
                    // 不认它会把整页视觉区判成 0%（返工令 Round 3 后 G4 假失败的根因）。
                    const visualEls = q("img,canvas,video,svg.yq-preview-svg,.yq-checkerboard,[class*='poster-box'],[class*='preview-canvas'],[class*='preview'],[class*='poster']");
                    for (const el of q("div,section,figure")) {
                        const cs = getComputedStyle(el);
                        if (cs.backgroundImage && cs.backgroundImage !== "none" && /url\(|gradient/.test(cs.backgroundImage)) visualEls.push(el);
                    }
                    for (const el of q("div,section")) {
                        const cs = getComputedStyle(el);
                        if (cs.backgroundImage && cs.backgroundImage !== "none" && /url\(/.test(cs.backgroundImage)) visualEls.push(el);
                    }
                    // 去重：① 剔除占地 ≥85% 视口的页面外壳（那是 app 背景，不是预览区）；
                    //       ② 剔除「包含另一个候选」的祖先，只留最内层，避免父子重复计面积。
                    const viewportArea = vw * vh;
                    // 聚焦态判定：排除被 aria-hidden / inert 隐藏、或祖先 display:none 的画布
                    // （工作台与自由画布双实例共存，只有一个是用户当前聚焦的）。
                    // 可见性用原生 checkVisibility（准确处理 display:none / visibility:hidden /
                    // content-visibility / aria-hidden 继承），替代手写祖先遍历——手写版本会把
                    // aria-hidden 无脑传播到所有后代，把活跃路由里的预览区全部误杀（vis% 恒 0.6）。
                    const isHidden = (el) => {
                        if (el.getAttribute("aria-hidden") === "true") return true;
                        try {
                            if (typeof el.checkVisibility === "function") {
                                return !el.checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true, opacityProperty: true });
                            }
                        } catch { /* 老浏览器走回落 */ }
                        const cs = getComputedStyle(el);
                        return cs.display === "none" || cs.visibility === "hidden";
                    };
                    // 排除规则不能用面积阈值：预览根容器本身就占视口 95%+，与 App 外壳几乎等大，
                    // 用「<85% 视口」会把真正的预览区和外壳一起杀掉（vis% 掉到 0.6）。
                    // 改用语义排除：只排除包含侧栏导航/顶栏的真外壳（body/html/app-shell）。
                    // 只排除「含侧栏导航」的真外壳。⚠️ 不能把 .app-top-nav/header 也算进去：
                    // 顶栏实际渲染在 app-workspace-stage 内部（app-top-nav.tsx:107），
                    // 那样会把主舞台容器本人误判成外壳而排除掉（vis% 恒 0.6 的根因）。
                    const isAppShell = (el) =>
                        el === document.body || el === document.documentElement ||
                        !!el.querySelector(".app-workspace-sidebar-nav");
                    // 主舞台是布局外壳，其 80% 以上的单项一律视为布局容器而非预览区
                    const stageEl = document.querySelector(".app-workspace-stage");
                    const stageArea = stageEl ? stageEl.getBoundingClientRect().width * stageEl.getBoundingClientRect().height : viewportArea;
                    const mediaCap = Math.max(4000, stageArea * 0.8);
                    const candidates = visualEls.filter((el) => {
                        const r = el.getBoundingClientRect();
                        return r.width * r.height > 4000 && r.width * r.height < mediaCap && !isHidden(el) && !isAppShell(el);
                    });
                    // 取聚焦态「根」容器：保留不被其他候选包含的最外层元素。
                    // （此前写成取最内层，结果只留下小图标，vis% 掉到 0.6——方向反了。
                    //   根容器才是用户感知的"预览区"，其内部的图片/棋盘格是它的组成部分，不应再单独计。）
                    const roots = candidates.filter((el) => !candidates.some((other) => other !== el && other.contains(el)));
                    const visual = roots.reduce((s, el) => { const r = el.getBoundingClientRect(); return s + r.width * r.height; }, 0);
                    const controls = q("input,textarea,select,button").reduce((s, el) => {
                        const r = el.getBoundingClientRect(); return s + r.width * r.height;
                    }, 0);
                    const area = vw * vh;

                    // ⑥ G7 香肠按钮：全页可见按钮宽度明细（>300px 且未豁免即 FAIL）。
                    // 「可见按钮」口径与 G2 一致（实底/有边框/渐变/antd 按钮）——透明无边的
                    // 文本触发器（如分镜卡主副标题原位改字）按战役一规范是文本态可供性，不是按钮。
                    // 豁免：侧栏导航菜单项（aside / .app-workspace-sidebar* 内）、
                    // 折叠手风琴标题（<summary> 或 aria-expanded 控件）；
                    // 宽度由 flex-1 撑开的控件（flexGrow>0）单独说明，不计失败。
                    const sidebarClosest = (el) => !!el.closest("aside, [class*='app-workspace-sidebar']");
                    const isAccordionCtl = (el) => el.tagName === "SUMMARY" || el.getAttribute("aria-expanded") !== null;
                    const isVisibleBtn = (b) => {
                        if (b.classList.contains("ant-btn")) return true;
                        const cs = getComputedStyle(b);
                        const bg = cs.backgroundColor || "";
                        const hasBg = /rgb\(/.test(bg) && !/rgba\(0, 0, 0, 0\)/.test(bg);
                        const hasBorder = parseFloat(cs.borderTopWidth || "0") > 0;
                        const hasGradient = /gradient/.test(cs.backgroundImage || "");
                        return hasBg || hasBorder || hasGradient;
                    };
                    const buttons = q("button")
                        .filter((b) => {
                            const r = b.getBoundingClientRect();
                            if (r.width === 0 || r.height === 0) return false;
                            return !isHidden(b);
                        })
                        .map((b) => {
                            const r = b.getBoundingClientRect();
                            const cs = getComputedStyle(b);
                            return {
                                text: (b.innerText || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 30),
                                w: Math.round(r.width),
                                h: Math.round(r.height),
                                visibleBtn: isVisibleBtn(b),
                                sidebar: sidebarClosest(b),
                                accordion: isAccordionCtl(b),
                                flexStretched: parseFloat(cs.flexGrow || "0") > 0,
                            };
                        });

                    // ⑦ G8 零破图：视口内可见 img 必须 complete && naturalWidth > 0
                    const brokenImages = q("img")
                        .filter((img) => {
                            const r = img.getBoundingClientRect();
                            if (r.width === 0 || r.height === 0) return false;
                            if (isHidden(img)) return false;
                            // 视口外（含懒加载未启动）不算「可见」，只查与视口有交集的
                            if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) return false;
                            return !(img.complete && img.naturalWidth > 0);
                        })
                        .map((img) => ({
                            src: (img.currentSrc || img.src || "").slice(0, 120),
                            alt: (img.alt || "").slice(0, 30),
                        }));

                    // ⑧ G8 零碰撞：顶栏与工具栏内可见按钮/标题，两两非父子元素
                    // BoundingClientRect 交集面积 > 4px² 即 FAIL
                    const collisionEls = [];
                    const collisionSeen = new Set();
                    for (const scope of q("header, [class*='top-bar'], [class*='topbar'], [class*='toolbar'], [class*='Toolbar']")) {
                        for (const el of Array.from(scope.querySelectorAll("button, h1, h2, h3, strong"))) {
                            if (collisionSeen.has(el)) continue;
                            collisionSeen.add(el);
                            const r = el.getBoundingClientRect();
                            if (r.width === 0 || r.height === 0) continue;
                            if (isHidden(el)) continue;
                            const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
                            if (!text) continue;
                            collisionEls.push({ el, text: text.slice(0, 24) });
                        }
                    }
                    const overlaps = [];
                    for (let i = 0; i < collisionEls.length; i += 1) {
                        for (let j = i + 1; j < collisionEls.length; j += 1) {
                            const a = collisionEls[i];
                            const b = collisionEls[j];
                            if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
                            const ra = a.el.getBoundingClientRect();
                            const rb = b.el.getBoundingClientRect();
                            const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
                            const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
                            if (ox > 0 && oy > 0 && ox * oy > 4) {
                                overlaps.push({ a: a.text, b: b.text, area: Math.round(ox * oy) });
                            }
                        }
                    }

                    // ⑨ G9 直播台真画布：常驻 9:16 容器（.yq-live-canvas）+ 右栏占屏比。
                    // 背景已生成时画布在精修台内，退回找右栏里比例 0.5~0.62 且高度足够的 img。
                    const stageCol = document.querySelector(".yq-live-stage-col");
                    const canvasFrame = document.querySelector(".yq-live-canvas");
                    const liveStage = { stageAspect: null, stageHeight: 0, stageColPct: null, canvasFound: false };
                    if (stageCol) {
                        const cr = stageCol.getBoundingClientRect();
                        liveStage.stageColPct = Math.round((cr.width / vw) * 1000) / 10;
                    }
                    if (canvasFrame) {
                        const r = canvasFrame.getBoundingClientRect();
                        liveStage.stageAspect = Math.round((r.width / r.height) * 1000) / 1000;
                        liveStage.stageHeight = Math.round(r.height);
                        liveStage.canvasFound = true;
                    } else if (stageCol) {
                        for (const img of Array.from(stageCol.querySelectorAll("img"))) {
                            const r = img.getBoundingClientRect();
                            if (r.height >= 360 && r.width / r.height >= 0.5 && r.width / r.height <= 0.62) {
                                liveStage.stageAspect = Math.round((r.width / r.height) * 1000) / 1000;
                                liveStage.stageHeight = Math.round(r.height);
                                liveStage.canvasFound = true;
                                break;
                            }
                        }
                    }

                    // ⑩ G10 电商首屏：SlotCard 数量 + 第一排顶边 y + 当前选中商品状态
                    const slotTitles = q(".ecommerce-slot-card-title");
                    // 必须量「卡片根」而非标题元素：标题在卡内，其 top 会比卡片顶边大；
                    // 且标题外层还包着 flex 行，量错元素会系统性低估高度。
                    const firstSlotCard = slotTitles.length
                        ? slotTitles[0].closest("article") || slotTitles[0].closest("[class*='yq-slot-card-virtual']") || slotTitles[0]
                        : null;
                    const activeLi = q("aside ul li").find((li) => /bg-primary/.test(li.className || ""));
                    const activeStatusMatch = activeLi
                        ? /未开始|排队中|进行中|待确认方案|失败|结果待确认|已完成|图片已完成|已暂停/.exec(activeLi.innerText || "")
                        : null;
                    const slotCardEls = q(".yq-slot-card-virtual, article");
                    const slotCards = {
                        count: slotTitles.length,
                        firstCardY: firstSlotCard ? Math.round(firstSlotCard.getBoundingClientRect().top) : null,
                        activeStatus: activeStatusMatch ? activeStatusMatch[0] : "",
                        // 返工令 Round 6：默认选中商品名——两个视口间若不一致即「选中态漂移」
                        // （后端列表排序随时间变化所致），在 G10 详情里点名，不静默放过。
                        activeProduct: activeLi ? (activeLi.innerText || "").trim().split("\n")[0].slice(0, 24) : "",
                        // 首屏可见海报卡数：G4 画廊型用它衡量「视觉霸权」——3:4 竖版小卡占屏比有几何上限，
                        // 「用户一进来看见几张海报」才是画廊型页面的真实视觉霸权指标。
                        visibleSlotCards: slotCardEls.filter((el) => {
                            const r = el.getBoundingClientRect();
                            return r.top < vh && r.bottom > 0 && r.height > 80;
                        }).length,
                    };

                    // ⑪ G13 蚊子字：全页扫描 computed fontSize 为 10px/11px 的可见文本叶子
                    // （ladder 只取 top14，10/11px 条目若排不进 top14 会被漏采，必须单独全量扫）。
                    const tinyFonts = [];
                    let tinyFontTotal = 0;
                    for (const el of q("h1,h2,h3,h4,p,span,button,a,li,strong,label,div")) {
                        const text = (el.innerText || "").trim();
                        if (!text || text.length > 40) continue;
                        const r = el.getBoundingClientRect();
                        if (r.width === 0 || r.height === 0) continue;
                        if (isHidden(el)) continue;
                        // 只量「自身直接持有文本节点」的元素，避免容器把子孙字号算到自己头上
                        const ownsText = Array.from(el.childNodes).some((c) => c.nodeType === 3 && c.textContent.trim());
                        if (!ownsText) continue;
                        const size = getComputedStyle(el).fontSize;
                        if (size === "10px" || size === "11px") {
                            tinyFontTotal += 1;
                            if (tinyFonts.length < 20) tinyFonts.push({ text: text.slice(0, 20), size, tag: el.tagName.toLowerCase() });
                        }
                    }

                    // ⑫ G12 精修台弹窗：可见弹窗容器实测尺寸（宽高 ≥600×400 才算真打开）
                    const modalEl = q(".ant-modal-content, [role='dialog'], .ant-drawer-content").find((el) => {
                        if (isHidden(el)) return false;
                        const r = el.getBoundingClientRect();
                        return r.width > 0 && r.height > 0;
                    });
                    const modal = modalEl
                        ? (() => { const r = modalEl.getBoundingClientRect(); return { found: true, w: Math.round(r.width), h: Math.round(r.height) }; })()
                        : { found: false, w: 0, h: 0 };

                    // ⑬ G14 /ereverse 去孤岛：左侧导航栏或醒目返回入口（含返回文案）
                    const backEls = q("a, button").filter((el) => /返回|模块大厅/.test((el.innerText || "").trim()));
                    const ereverseNav = {
                        hasSidebar: Boolean(document.querySelector(".app-workspace-sidebar-nav")),
                        hasBack: backEls.length > 0,
                        backText: backEls.length ? (backEls[0].innerText || "").trim().slice(0, 20) : "",
                    };

                    // ⑭ G11 电商空态文案（「还没有选择商品任务」出现即视为未默认选中）
                    const emptyStateText = /还没有选择商品任务/.test(document.body.innerText || "");

                    // ⑮ G15 直播台对标参考图模块 + 画布冗余气泡移除（返工令 Round 5）
                    const refSlotEl = document.querySelector("[data-yq='live-reference-slot']");
                    const refPressedAttr = (selector, attr) => {
                        const el = refSlotEl ? refSlotEl.querySelector(selector) : null;
                        return el ? el.getAttribute(attr) || "" : "";
                    };
                    const referenceSlot = refSlotEl
                        ? {
                              present: true,
                              hasPasteHint: /Ctrl\+V|粘贴/.test(refSlotEl.innerText || ""),
                              modeCapsules: refSlotEl.querySelectorAll("[data-yq-ref-mode]").length,
                              strengthCapsules: refSlotEl.querySelectorAll("[data-yq-ref-strength]").length,
                              defaultMode: refPressedAttr("[data-yq-ref-mode][aria-pressed='true']", "data-yq-ref-mode"),
                              defaultStrength: refPressedAttr("[data-yq-ref-strength][aria-pressed='true']", "data-yq-ref-strength"),
                          }
                        : { present: false, hasPasteHint: false, modeCapsules: 0, strengthCapsules: 0, defaultMode: "", defaultStrength: "" };
                    const canvasFrameEl = document.querySelector(".yq-live-canvas");
                    const canvasBubbleRemoved = canvasFrameEl ? !/默认夜景底可直接开播/.test(canvasFrameEl.innerText || "") : true;

                    // ⑯ G16 反推台状态收敛 + 实心主 CTA（返工令 Round 5）
                    const statusZoneEl = document.querySelector("[data-yq='ereverse-status-zone']");
                    const statusDotEl = document.querySelector(".yq-ereverse-status-dot");
                    const ereverseStatus = {
                        statusDotText: statusDotEl ? (statusDotEl.innerText || "").trim().replace(/\s+/g, " ").slice(0, 24) : "",
                        statusTagsInZone: statusZoneEl ? statusZoneEl.querySelectorAll(".ant-tag").length : 0,
                        statusTagsCollapsed: Boolean(statusDotEl) && (!statusZoneEl || statusZoneEl.querySelectorAll(".ant-tag").length < 3),
                        exitButtons: document.querySelectorAll("[data-yq='ereverse-exits'] button").length,
                        stepsPresent: Boolean(document.querySelector("[data-yq='ereverse-steps']")),
                    };
                    // G19：/ereverse 假死根治断言——页面不得出现 AbortController 超时的
                    // 原生文案（signal is aborted without reason / AbortError）。
                    const abortedErrorText = /signal\s*is\s*aborted|AbortError/i.test(bodyText);

                    // ⑰ G17 侧栏「上游原生 + 定制模块」门禁（夜间施工令阶段二）
                    const sidebarEl = document.querySelector("aside");
                    const sidebarLinks = sidebarEl ? Array.from(sidebarEl.querySelectorAll("a")).map((a) => a.getAttribute("href") || "") : [];
                    const sidebarText = sidebarEl ? sidebarEl.innerText || "" : "";
                    const sidebarG17 = {
                        present: Boolean(sidebarEl && sidebarLinks.length > 0),
                        nativeItems: ["/", "/projects", "/canvas", "/skills", "/assets"].every((to) => sidebarLinks.includes(to)),
                        customGroup: /定制模块/.test(sidebarText),
                        customEntries: ["/modules", "/ecommerce", "/modules/live-studio", "/ereverse"].every((to) => sidebarLinks.includes(to)),
                        legacyTextGone: !/固定模块/.test(document.body.innerText || ""),
                    };

                    return {
                        url: location.pathname,
                        title: document.title,
                        authenticated: !/login|登录/.test(document.body.innerText.slice(0, 200)) || !!document.querySelector("[class*='workspace'],[class*='sidebar']"),
                        containers, cards,
                        wrapped: wrapped.slice(0, 30), wrappedTotal: wrapped.length,
                        hScroll,
                        ladder: Object.entries(ladder).sort((a, b) => b[1] - a[1]).slice(0, 14),
                        primaryBtns, solidCtas,
                        ctaZones, ctaZonesOk, aiMagicCtas,
                        dirty: Array.from(new Set(dirty)).slice(0, 12),
                        perf,
                        buttons, brokenImages, overlaps, liveStage, slotCards,
                        tinyFonts, tinyFontTotal, modal, ereverseNav, emptyStateText,
                        referenceSlot, canvasBubbleRemoved, ereverseStatus, sidebarG17, abortedErrorText,
                        area: {
                            visualPct: Math.round((visual / area) * 1000) / 10,
                            controlPct: Math.round((controls / area) * 1000) / 10,
                        },
                    };
                });
                Object.assign(rec, data, { ok: true, ctaZones: data.ctaZones ?? 0, ctaZonesOk: data.ctaZonesOk ?? 0 });
                // probeErrors 显式落账：等待超时 / 弹窗没打开 / 图片解码失败都不再被静默吞掉
                rec.probeErrors = probeErrors;
                // 返工令 Round 6：/ereverse 已移入 AuthenticatedWorkspaceLayout，与电商工坊、
                // 直播装修台一样是已认证工作台页——G0 的认证分母不再把这 2 页剔掉。
                // （旧代码在这里强制 rec.authenticated = false，理由正是"路由在布局外"。）
            } catch (e) {
                rec.error = String(e).slice(0, 160);
                // 整页采集异常也显式落账（不再只留一个 error 字符串）
                rec.probeErrors = [...probeErrors, `整页采集异常：${String(e).slice(0, 120)}`];
            }
            out.pages.push(rec);
        }
    }

    // 启动控制台体检（返工令 Round 6 · G18）：:17580 面板无明文密码、按钮栏单行不折行、
    // 服务卡片 2×2 网格 + 隧道双列紧凑条、运行中服务只留 重启/停止/日志、整页零纵向滚动。
    // 控制台没起时如实记失败（它是全栈的一部分，不静默跳过）。
    const consoleRec = { ok: false, pages: [] };
    for (const vp of [
        { name: "1366x768", width: 1366, height: 768 },
        { name: "1440x900", width: 1440, height: 900 },
    ]) {
        const crec = { viewport: vp.name, ok: false };
        try {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.goto("http://127.0.0.1:17580/", { waitUntil: "domcontentloaded", timeout: 15000 });
            await page.waitForSelector("#cards .card", { timeout: 12000 });
            await page.waitForTimeout(2200); // 等一次 3s 心跳刷新把卡片渲染落定
            const c = await page.evaluate(() => {
                const tb = document.getElementById("toolbar");
                const btns = tb ? Array.from(tb.querySelectorAll("button")) : [];
                const tops = btns.map((b) => Math.round(b.getBoundingClientRect().top));
                const cards = document.querySelectorAll("#cards .card");
                const grid = document.getElementById("cards");
                const tracks = grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0;
                const compactBars = document.querySelectorAll("#cards .card.compact").length;
                const svcCards = Array.from(cards).filter((el) => !el.classList.contains("compact"));
                const svcInfo = svcCards.map((el) => ({
                    on: el.classList.contains("on"),
                    actions: Array.from(el.querySelectorAll(".card-actions button")).map((b) => (b.textContent || "").trim()),
                }));
                const runningCards = svcInfo.filter((s) => s.on);
                const pwdPill = document.getElementById("pwdPill");
                const labels = btns.map((b) => (b.textContent || "").trim());
                return {
                    plaintextPassword: /jinji666/.test(document.body.innerText || ""),
                    pwdPillMasked: Boolean(pwdPill) && /•/.test((pwdPill || {}).textContent || ""),
                    toolbarSingleRow: tops.length > 0 && new Set(tops).size <= 1,
                    toolbarOverflow: tb ? tb.scrollWidth - tb.clientWidth : -1,
                    labels,
                    requiredLabelsOk: ["一键启动全栈", "进入源起工作台 (:3000)", "全栈健康自检", "刷新", "全部停止", "退出面板"].every((t) => labels.some((l) => l.includes(t))),
                    legacyLabelsGone: !labels.some((l) => /打开源起创作画布|进入工作台首页|接入自检|E-Reverse 事实表/.test(l)),
                    cardCount: cards.length,
                    serviceCards: svcCards.length,
                    compactBars,
                    gridTracks: tracks,
                    runningCards: runningCards.length,
                    runningNoStart: runningCards.length > 0 && runningCards.every((s) => !s.actions.some((t) => /启动/.test(t)) && s.actions.some((t) => /重启/.test(t)) && s.actions.some((t) => /停止/.test(t))),
                    vScroll: document.documentElement.scrollHeight > window.innerHeight + 2,
                    scrollH: document.documentElement.scrollHeight,
                    innerH: window.innerHeight,
                };
            });
            Object.assign(crec, c, { ok: true });
        } catch (e) {
            crec.error = String(e).slice(0, 140);
        }
        consoleRec.pages.push(crec);
    }
    consoleRec.ok = consoleRec.pages.length > 0 && consoleRec.pages.every((p) => p.ok);
    out.console = consoleRec;
    return out;
};

/**
 * G10 前置：确保左栏存在「未开始/待确认」商品——没有就用一个尚未导入过的
 * 图片资源 seed 一个 draft 商品（探针样本）。否则电商首屏高度只能量到
 * 已完成态，覆盖不到未开始商品态（总架构师门禁要求）。
 * 只在缺失时 seed 一次；失败不阻断采集，G10 会如实报告未开始态未覆盖。
 */
async function ensureUnstartedProduct() {
    if (!COOKIE) return;
    const base = BASE.replace(/\/$/, "");
    const headers = { Cookie: COOKIE, "Content-Type": "application/json" };
    try {
        const listRes = await fetch(`${base}/api/ecommerce/products?page=1&page_size=50`, { headers });
        const listJson = await listRes.json();
        const items = listJson?.data?.items || [];
        if (items.some((item) => item.status === "draft" || item.status === "review")) return;
        if (items.length === 0) return; // 空库无可复用资源，不 seed
        const resRes = await fetch(`${base}/api/resources?page=1&page_size=20`, { headers });
        const resJson = await resRes.json();
        const candidates = (resJson?.data?.resources || []).filter((r) => r.kind === "image" && r.status === "ready");
        for (const candidate of candidates) {
            const postRes = await fetch(`${base}/api/ecommerce/products`, {
                method: "POST",
                headers,
                body: JSON.stringify({ items: [{ resourceId: candidate.id, name: "探针样本·未开始态" }] }),
            });
            const postJson = await postRes.json();
            const created = (postJson?.data?.items || []).length > 0;
            if (created) {
                console.log("[probe] 左栏无未开始态商品，已 seed 一个 draft 样本（G10 覆盖用）");
                return;
            }
        }
        console.log("[probe] 未找到可用的未导入资源，跳过 seed（G10 将报告未开始态未覆盖）");
    } catch (e) {
        console.log("[probe] seed 未开始态商品失败（不阻断采集）：", String(e).slice(0, 120));
    }
}

function run() {
    mkdirSync(OUT_DIR, { recursive: true });
    const tmpJson = join(OUT_DIR, `.probe-raw-${STAMP}.json`);

    // 1) 开浏览器 + 2) 单会话采集，必须在同一 shell 生命周期内完成：
    //    playwright-cli 的会话不跨进程保持（浏览器会随父 shell 退出被回收），
    //    故用一条 shell 命令把 open 与 run-code 串起来。
    const payloadFile = join(OUT_DIR, `.probe-payload-${STAMP}.json`);
    writeFileSync(
        payloadFile,
        JSON.stringify({ src: collectFn.toString(), ctx: { base: BASE, viewports: VIEWPORTS, routes: ROUTES, cookie: COOKIE } }),
    );
    // wrapper 通过 file:// 让浏览器自己读载荷：run-code 的 eval 上下文无 require、
    // 也不支持动态 import，且 Windows 命令行上限 8191 字符放不下大载荷。
    const wrapper =
        "async page => { await page.goto('file:///" + payloadFile.replace(/\\/g, "/").replace(/^\/?/, "") + "');" +
        " const text = await page.evaluate(() => document.body.innerText);" +
        " const p = JSON.parse(text); const fn = eval('(' + p.src + ')');" +
        " await page.goto('about:blank'); return JSON.stringify(await fn(page, p.ctx)); }";

    let opened = "";
    for (const browser of ["msedge", "chrome", "chromium"]) {
        try {
            execFileSync(`${CLI} open --browser=${browser} about:blank`, { shell: true, stdio: "pipe", timeout: 90000 });
            opened = browser;
            console.log(`[probe] 浏览器已启动：${browser}`);
            break;
        } catch {
            console.log(`[probe] ${browser} 不可用，尝试下一个`);
        }
    }    if (!opened) {
        console.error("[probe] 没有可用浏览器（需要 Edge/Chrome/Chromium）");
        process.exit(2);
    }

    let raw;
    try {
        raw = execFileSync(
            `${CLI} run-code "${wrapper}"`,
            // 返工令 Round 6：新增 #matrix-guard 交互动线与启动控制台体检后共 16 页，
            // 600s 曾把上一轮基线跑掐死在超时上（无报告产出）。放宽到 15 分钟。
            { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900_000 },
        );
    } catch (e) {
        console.error("[probe] 采集失败：", String(e).slice(0, 300));
        try { execFileSync(`${CLI} close`, { shell: true, stdio: "ignore" }); } catch {}
        process.exit(3);
    }
    try { execFileSync(`${CLI} close`, { shell: true, stdio: "ignore" }); } catch {}

    // 3) 解析 run-code 输出：playwright-cli 以 `### Result` 段落返回，值是被引号包裹的 JSON 字符串
    let data;
    try {
        const resultBlock = raw.split("### Result")[1] || raw;
        const firstLine = resultBlock.split("\n").map((l) => l.trim()).find((l) => l.startsWith('"')) || "";
        const inner = firstLine ? JSON.parse(firstLine) : null;
        data = inner ? JSON.parse(inner) : JSON.parse(resultBlock);
    } catch {
        const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        const text = m ? m[1] : raw;
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        data = JSON.parse(text.slice(start, end + 1));
    }
    writeFileSync(tmpJson, JSON.stringify(data, null, 2));
    console.log(`[probe] 原始数据 → ${tmpJson}`);

    // 4) G1~G10 门禁
    const gates = [];
    const gate = (id, name, pass, detail) => gates.push({ id, name, pass, detail });
    const scanned = data.pages.filter((p) => p.ok);
    const failed = data.pages.filter((p) => !p.ok);
    const authPages = scanned.filter((p) => p.authenticated);
    // G9/G10 的页面集合在报告段也要用，提到函数作用域（else 块内 const 出了块不可见）。
    const livePages = scanned.filter((p) => p.route === "/modules/live-studio");
    const g10pages = scanned.filter((p) => p.route === "/ecommerce" || p.route.startsWith("/ecommerce#"));

    // 硬前提：一页都没扫到时，任何"通过"都是零数据空转，必须整体判失败。
    if (scanned.length === 0) {
        for (const g of [
            ["G1", "零折行（1366×768 按钮/标签单行）"],
            ["G2", "单卡减负（默认态可见按钮 ≤3、输入 ≤1）"],
            ["G3", "主次分明（每操作区实心主按钮唯一）"],
            ["G4", "视觉霸权（预览区 ≥45%、错误条 ≤5%）"],
            ["G5", "零脏字符"],
            ["G6", "浅层直达 + 渲染健康（无高开销滤镜）"],
            ["G7", "拒绝香肠按钮（可见按钮宽度 ≤300px）"],
            ["G8", "零破图零碰撞（img 全加载 + 顶栏/工具栏无重叠）"],
            ["G9", "直播台真画布（9:16 常驻画布，无空态豁免）"],
            ["G10", "电商首屏高度（SlotCard≥7 且首排 y≤260，覆盖未开始态）"],
            ["G11", "禁止代点绕过（电商工坊组件自身默认选中，无空态）"],
            ["G12", "精修台弹窗真打开（可见弹窗 ≥600×400 且 DOM 增量 ≥50）"],
            ["G13", "清零蚊子字与纳米按钮（无 10/11px 文本；按钮 ≥24×22）"],
            ["G14", "爆款反推台不孤岛（/ereverse 有侧栏导航或返回按钮）"],
            ["G15", "直播间对标参考图模块（槽位/粘贴提示/双模式/三档强度/默认值/气泡已删）"],
            ["G16", "反推台状态收敛（单状态点+Tooltip）与实心主 CTA（≥1）"],
            ["G17", "侧栏布局与定制模块门禁（原生项齐全+定制模块组+全站无旧词）"],
            ["G18", "启动控制台体检（密码脱敏/按钮单行/2×2卡片网格/智能按钮/零滚动）"],
            ["G19", "跨商品图片隔离 + 矩阵防重叠 + 反推台挂栏"],
        ]) gate(g[0], g[1], false, "未采集到任何页面，无法判定");
        const blocker = failed.map((f) => `${f.route}: ${(f.error || "").slice(0, 80)}`).join("；");
        gates.push({ id: "G0", name: "采集有效性（至少 1 页可测）", pass: false, detail: `16 组合全部失败。${blocker || "未知原因"}` });
    } else {
        // G1 只算真折行（非 nowrap 文本叶子的行盒数 >1）。ellipsis 属内容密度（truncate 生效），
        // overflow 属裁切，二者都不算 G1 折行——分别计入 warning 供参考。
        const trueWrapped = scanned.reduce((s, p) => s + ((p.wrapped || []).filter((w) => w.kind === "wrapped").length), 0);
        const ellipsisCount = scanned.reduce((s, p) => s + ((p.wrapped || []).filter((w) => w.kind === "ellipsis").length), 0);
        const overflowCount = scanned.reduce((s, p) => s + ((p.wrapped || []).filter((w) => w.kind === "overflow").length), 0);
        gate("G1", "零折行（按钮/标签文字单行）", trueWrapped === 0, `真折行 ${trueWrapped} 处；ellipsis ${ellipsisCount}、overflow ${overflowCount}（后两者为 warning 不计入门禁）`);
        const maxAction = Math.max(0, ...scanned.map((p) => Math.max(0, ...p.cards.map((c) => c.actionButtons ?? 0))));
        const maxAll = Math.max(0, ...scanned.map((p) => Math.max(0, ...p.cards.map((c) => c.buttons))));
        const maxInputs = Math.max(0, ...scanned.map((p) => Math.max(0, ...p.cards.map((c) => c.inputs))));
        const maxPanel = Math.max(0, ...scanned.map((p) => Math.max(0, ...p.cards.map((c) => c.panelTriggers ?? 0))));
        const cardless = scanned.filter((p) => p.cards.length === 0).map((p) => p.route);
        gate("G2", "单卡减负（默认态可见按钮 ≤3、输入 ≤1）", maxAction <= 3 && maxInputs <= 1,
            `底部操作区按钮最多 ${maxAction} 个（≤3）、面板触发器最多 ${maxPanel} 个、文本触发器共 ${maxAll - maxAction - maxPanel} 个、输入框最多 ${maxInputs} 个${cardless.length ? `；⚠️ 未采到卡片：${Array.from(new Set(cardless)).join(",")}` : ""}`);
        // G3 按操作区分组判定（原按整页计数会误报：live-studio 5 个命中里 4 个是单选胶囊/选中态）。
        // 实心判定必须含 backgroundImage 渐变分支：皮肤系统把 --button-primary-bg 设为
        // linear-gradient，经 background 简写后 backgroundColor 仍是透明，只查 backgroundColor 会漏报真主 CTA。
        const g3detail = scanned.map((p) => `${p.route} ${p.ctaZones ? `主CTA区${p.ctaZonesOk}/${p.ctaZones}` : "无主CTA区"}`).join("；");
        const g3zones = scanned.reduce((s2, p) => s2 + (p.ctaZones || 0), 0);
        gate("G3", "主次分明（每操作区实心主按钮唯一）",
            g3zones > 0 && scanned.every((p) => p.ctaZonesOk === p.ctaZones),
            g3zones > 0 ? `${g3detail}；AI 魔法按钮（渐变，单列不计入主 CTA）共 ${scanned.reduce((s2, p) => s2 + (p.aiMagicCtas || 0), 0)} 个` : `⚠️ 未识别到任何含主 CTA 的操作区（共 ${g3zones} 个）——G3 为空转，需检查 ctaCandidates 选择器`);
        // G4 只统计「聚焦态根预览容器」：App 布局是双画布共存（工作台 + 画布都在 DOM 里、同时 display:flex），
        // 原口径把两个画布面积相加，必然虚高。聚焦态由 [aria-hidden] / [inert] / display:none 判定，
        // 并排除占地 ≥85% 视口的 App 根容器（那是布局外壳不是预览区）。
        // 列表型页面（模块大厅是卡片列表、电商工坊空态）不套 45% 门槛，改用「首屏有可操作内容」。
        // G4 分页面类型定门槛（2026-10-29 Round 3 二次修正）：
        //   studio  创作画布型（直播装修台）→ 视觉媒介占屏 ≥45%
        //   gallery 画廊型（电商工坊）       → 首屏可见 3:4 海报卡 ≥ 6 张（实测 7 张全可见时占屏约 25%，
        //                                      3:4 竖版小卡的固有几何决定它到不了 30%——用占屏比衡量
        //                                      画廊型等于要求把海报卡撑爆，故改用「可见卡数」）
        //   hall    列表型（模块大厅/短剧库） → 不套占屏比，改用「首屏有可操作内容」
        const G4_TIERS = { "/modules/live-studio": "studio", "/ecommerce": "gallery", "/ecommerce#retouch-open": "gallery", "/ecommerce#unstarted": "gallery", "/modules": "hall", "/projects": "hall" };
        const visibleOf = (p) => p.slotCards?.visibleSlotCards ?? null;
        const g4detail = scanned.map((p) => `${p.route} ${p.area.visualPct}%/${visibleOf(p) ?? "未采"}卡可见(${G4_TIERS[p.route] || "hall"})`).join("；");
        // 空态记 N/A：无商品任务的电商工坊等本就该是空态。
        // ⚠️ 直播装修台废除 N/A(空态) 豁免：返工令后右栏常驻 9:16 画布，不存在空态。
        const isEmpty = (p) => p.route !== "/modules/live-studio" && (/还没有|暂无|空态|导入第一张|选择小说|拖入/.test((p.dirty || []).join("")) || (p.cards.length === 0 && p.area.visualPct === 0 && p.perf.domNodes < 340));
        const g4items = scanned.map((p) => {
            if (isEmpty(p)) return { p, state: "N/A", ok: true };
            const tier = G4_TIERS[p.route] || "hall";
            // gallery 型用「首屏可见海报卡数」；studio 型用占屏比；hall 型用有可操作内容。
            // 严禁 fallback：gallery 型若没采到可见卡数（null），一律判 FAIL——不得用 cards.length 蒙混，
            // 否则会出现「0 卡可见却 PASS」的假绿（返工令 Round 3 实测抓到过一次）。
            const visible = visibleOf(p);
            const ok = tier === "gallery"
                ? (visible !== null && visible >= 6)
                : tier === "studio"
                  ? p.area.visualPct >= 45
                  : p.cards.length > 0 || p.perf.domNodes > 100;
            return { p, state: ok ? "PASS" : "FAIL", ok };
        });
        gate("G4", "视觉霸权（创作型≥45% / 画廊型≥6卡可见 / 列表型有内容 / 空态 N/A）",
            g4items.every((i) => i.ok),
            `${g4detail}｜${g4items.map((i) => `${i.p.route}=${i.state}`).join("；")}`);
        gate("G5", "零脏字符", scanned.every((p) => (p.dirty || []).length === 0), `命中 ${scanned.reduce((s, p) => s + (p.dirty || []).length, 0)} 处`);
        const perfBad = scanned.filter((p) => p.perf.conic > 0 || p.perf.dropShadow > 0);
        gate("G6", "浅层直达 + 渲染健康（无高开销滤镜）", perfBad.length === 0,
            `残留 conic/drop-shadow 页面 ${perfBad.length} 个${perfBad.length ? `：${perfBad.map((p) => `${p.route}@${p.viewport}(conic ${p.perf.conic}/drop-shadow ${p.perf.dropShadow})`).join("；")}` : ""}`);
        // G7 拒绝香肠按钮：可见按钮（实底/边框/渐变/antd，与 G2 同口径）宽度 > 300 即 FAIL。
        // 豁免：侧栏导航菜单项、折叠手风琴标题（<summary> / aria-expanded）；
        // flex-1 撑开的控件单独说明不计失败；透明无边文本触发器按 G2 同口径不算按钮。
        const allButtons = scanned.flatMap((p) => (p.buttons || []).map((b) => ({ ...b, route: p.route })));
        const realButtons = allButtons.filter((b) => b.visibleBtn);
        const sausages = realButtons.filter((b) => b.w > 300 && !b.sidebar && !b.accordion && !b.flexStretched);
        const flexWide = realButtons.filter((b) => b.w > 300 && b.flexStretched && !b.sidebar && !b.accordion);
        const textTriggerWide = allButtons.filter((b) => !b.visibleBtn && b.w > 300);
        const maxBtnWidth = Math.max(0, ...realButtons.map((b) => b.w));
        const widestBtn = realButtons.find((b) => b.w === maxBtnWidth);
        gate("G7", "拒绝香肠按钮（可见按钮宽度 ≤300px）", sausages.length === 0,
            `最宽可见按钮 ${maxBtnWidth}px「${widestBtn ? widestBtn.text : "-"}」@${widestBtn ? widestBtn.route : "-"}；超宽未豁免 ${sausages.length} 个${sausages.length ? `：${sausages.slice(0, 5).map((b) => `「${b.text}」${b.w}px@${b.route}`).join("；")}` : ""}；flex-1 撑开的宽控件 ${flexWide.length} 个（单独说明：${flexWide.slice(0, 3).map((b) => `「${b.text}」${b.w}px`).join("；") || "无"}，不计失败）；透明无边文本触发器超宽 ${textTriggerWide.length} 个（按 G2 同口径豁免：${textTriggerWide.slice(0, 3).map((b) => `「${b.text}」${b.w}px`).join("；") || "无"}）`);
        // G8 零破图零碰撞：① 可见 img 必须 complete && naturalWidth>0；
        // ② 顶栏与工具栏内可见按钮/标题两两非父子交集面积 > 4px² 即 FAIL。
        const brokenTotal = scanned.reduce((s, p) => s + (p.brokenImages || []).length, 0);
        const overlapTotal = scanned.reduce((s, p) => s + (p.overlaps || []).length, 0);
        const brokenDetail = scanned.flatMap((p) => (p.brokenImages || []).map((i) => `${p.route} 「${i.alt || "无alt"}」${i.src}`)).slice(0, 5);
        const overlapDetail = scanned.flatMap((p) => (p.overlaps || []).map((o) => `${p.route} 「${o.a}」×「${o.b}」${o.area}px²`)).slice(0, 5);
        gate("G8", "零破图零碰撞（img 全加载 + 顶栏/工具栏无重叠）", brokenTotal === 0 && overlapTotal === 0,
            `破图 ${brokenTotal} 张${brokenDetail.length ? `（${brokenDetail.join("；")}）` : ""}；重叠对 ${overlapTotal} 组${overlapDetail.length ? `（${overlapDetail.join("；")}）` : ""}`);
        // G9 直播台真画布：仅 /modules/live-studio，废除此页 N/A(空态) 豁免。
        // 必须检测到宽高比 0.5~0.62 且 height≥360px 的常驻画布容器，右栏占屏 ≥55%，visualPct ≥35%。
        const g9items = livePages.map((p) => {
            const s = p.liveStage || {};
            const aspectOk = typeof s.stageAspect === "number" && s.stageAspect >= 0.5 && s.stageAspect <= 0.62;
            const heightOk = (s.stageHeight || 0) >= 360;
            const colOk = (s.stageColPct || 0) >= 55;
            const visualOk = (p.area?.visualPct || 0) >= 35;
            return { p, ok: aspectOk && heightOk && colOk && visualOk, aspectOk, heightOk, colOk, visualOk, s };
        });
        gate("G9", "直播台真画布（9:16 常驻画布 + 右栏≥55% + visualPct≥35%）",
            livePages.length > 0 && g9items.every((i) => i.ok),
            livePages.length === 0
                ? "未采集到直播装修台（/modules/live-studio）"
                : g9items.map((i) => `${i.p.route}@${i.p.viewport} 比例 ${i.s.stageAspect ?? "未检测到"}${i.aspectOk ? "✓" : "✗"} · 高 ${i.s.stageHeight ?? 0}px${i.heightOk ? "✓" : "✗"} · 右栏占屏 ${i.s.stageColPct ?? 0}%${i.colOk ? "✓" : "✗"} · visualPct ${i.p.area?.visualPct ?? 0}%${i.visualOk ? "✓" : "✗"}`).join("；"));
        // G10 电商首屏高度：/ecommerce（含 #retouch-open 与 #unstarted）SlotCard ≥7，
        // 且 1366×768 下第一排 SlotCard 顶边 y ≤260；必须覆盖未开始商品态。
        const g10items = g10pages.map((p) => {
            const count = p.slotCards?.count ?? 0;
            const y = p.slotCards?.firstCardY ?? null;
            const yOk = p.viewport === "1366x768" ? y !== null && y <= 260 : true;
            return { p, ok: count >= 7 && yOk, count, y, yOk };
        });
        const unstartedCovered = g10items.some((i) => /未开始|待确认方案/.test(i.p.slotCards?.activeStatus || ""));
        gate("G10", "电商首屏高度（SlotCard≥7 + 1366×768 首排 y≤260 + 覆盖未开始态）",
            g10pages.length > 0 && g10items.every((i) => i.ok) && unstartedCovered,
            g10pages.length === 0
                ? "未采集到电商工坊"
                : `${g10items.map((i) => `${i.p.route}@${i.p.viewport} ${i.count} 卡·首排 y=${i.y ?? "未采到"}${i.yOk ? "✓" : "✗"}·选中「${i.p.slotCards?.activeProduct || "未知"}」(${i.p.slotCards?.activeStatus || "?"})`).join("；")}；未开始态覆盖${unstartedCovered ? "✓" : "✗"}；选中态跨视口一致性${new Set(g10items.map((i) => `${i.p.route}|${i.p.slotCards?.activeProduct || ""}`)).size === g10items.length ? "✓ 无漂移" : "⚠️ 存在漂移（同一路由两个视口选中商品不同，见上方明细）"}`);
        // G11 禁止代点绕过（返工令 Round 4 重点）：探针已删除全部 `aside ul li` 代点击，
        // 选中态必须来自组件自身默认选中。slotCards 为 0 或页面含「还没有选择商品任务」→ FAIL。
        // 判定只看采集结果，不看探针怎么点的——探针这轮根本不点。
        const g11items = g10pages.map((p) => {
            const count = p.slotCards?.count ?? 0;
            const empty = Boolean(p.emptyStateText);
            return { p, ok: count > 0 && !empty, count, empty };
        });
        gate("G11", "禁止代点绕过（电商工坊组件自身默认选中，无空态）",
            g10pages.length > 0 && g11items.every((i) => i.ok),
            g10pages.length === 0
                ? "未采集到电商工坊"
                : `${g11items.map((i) => `${i.p.route}@${i.p.viewport} SlotCard ${i.count} 张${i.empty ? "·空态「还没有选择商品任务」" : ""}${i.ok ? "✓" : "✗"}`).join("；")}｜本轮探针已移除全部左栏代点，选中态 100% 来自页面自身`);
        // G12 精修台弹窗真打开：/ecommerce#retouch-open 必须有可见弹窗容器（宽高 ≥600×400），
        // 且该页 domNodes 比同视口 /ecommerce 基础态多 ≥50。上一轮两页 DOM 都是 669
        // （弹窗根本没打开，失败还被 .catch(()=>{}) 吞了）——这轮失败原因逐条列。
        const baseNodesByViewport = new Map();
        for (const p of scanned.filter((p) => p.route === "/ecommerce")) baseNodesByViewport.set(p.viewport, p.perf?.domNodes ?? 0);
        const g12pages = scanned.filter((p) => p.route === "/ecommerce#retouch-open");
        const g12items = g12pages.map((p) => {
            const baseNodes = baseNodesByViewport.get(p.viewport) ?? 0;
            const delta = (p.perf?.domNodes ?? 0) - baseNodes;
            const m = p.modal || { found: false, w: 0, h: 0 };
            const modalOk = m.found && m.w >= 600 && m.h >= 400;
            const deltaOk = delta >= 50;
            return { p, ok: modalOk && deltaOk, modalOk, deltaOk, baseNodes, delta, m, reasons: (p.probeErrors || []).join("；") };
        });
        gate("G12", "精修台弹窗真打开（可见弹窗 ≥600×400 且 DOM 增量 ≥50）",
            g12pages.length > 0 && g12items.every((i) => i.ok),
            g12pages.length === 0
                ? "未采集到 /ecommerce#retouch-open"
                : `${g12items.map((i) => `${i.p.route}@${i.p.viewport} 弹窗 ${i.m.found ? `${i.m.w}×${i.m.h}` : "未出现"}${i.modalOk ? "✓" : "✗"} · DOM ${i.p.perf?.domNodes ?? 0} vs 基础态 ${i.baseNodes}（+${i.delta}）${i.deltaOk ? "✓" : "✗"}${i.reasons ? `｜失败原因：${i.reasons}` : ""}`).join("；")}`);
        // G13 清零蚊子字与纳米按钮：全页可见文本 computed fontSize 为 10px/11px 即 FAIL
        // （ladder 的 top14 会漏采，故单独全量扫并附条目与计数）；
        // 可见按钮 w<24 或 h<22 即 FAIL（附文案与尺寸）。
        const tinyFontItems = scanned.flatMap((p) => (p.tinyFonts || []).map((f) => ({ ...f, route: p.route, viewport: p.viewport })));
        const tinyFontTotal = scanned.reduce((s, p) => s + (p.tinyFontTotal || 0), 0);
        const tinyBtnItems = scanned.flatMap((p) => (p.buttons || []).filter((b) => b.w < 24 || b.h < 22).map((b) => ({ ...b, route: p.route })));
        gate("G13", "清零蚊子字与纳米按钮（无 10/11px 文本；可见按钮 ≥24×22）",
            tinyFontTotal === 0 && tinyBtnItems.length === 0,
            `蚊子字 ${tinyFontTotal} 处（10px/11px）${tinyFontItems.length ? `：${tinyFontItems.slice(0, 8).map((f) => `${f.route}@${f.viewport} 「${f.text}」${f.size}<${f.tag}>`).join("；")}${tinyFontTotal > tinyFontItems.length ? ` 等 ${tinyFontTotal} 处` : ""}` : ""}；纳米按钮 ${tinyBtnItems.length} 个${tinyBtnItems.length ? `：${tinyBtnItems.slice(0, 8).map((b) => `${b.route} 「${b.text || "无文案"}」${b.w}×${b.h}`).join("；")}` : ""}`);
        // G14 爆款反推台不孤岛：/ereverse 必须接入左侧导航栏，或有醒目返回入口。
        // （返工令 Round 6 起 /ereverse 已挂入 AuthenticatedWorkspaceLayout，侧栏常态在位；
        //  真正的"挂栏"硬断言在 G19，这里保留"侧栏或返回入口"的宽松口径兜底。）
        const erevPages = scanned.filter((p) => p.route === "/ereverse");
        const g14items = erevPages.map((p) => {
            const nav = p.ereverseNav || {};
            return { p, ok: Boolean(nav.hasSidebar || nav.hasBack), nav };
        });
        gate("G14", "爆款反推台不孤岛（/ereverse 有侧栏导航或返回按钮）",
            erevPages.length > 0 && g14items.every((i) => i.ok),
            erevPages.length === 0
                ? "未采集到 /ereverse"
                : `${g14items.map((i) => `${i.p.route}@${i.p.viewport} 侧栏${i.nav.hasSidebar ? "✓" : "✗"} · 返回入口${i.nav.hasBack ? `✓「${i.nav.backText}」` : "✗"}${i.ok ? " ✓" : " ✗"}`).join("；")}`);
        // G15 直播间对标参考图模块（返工令 Round 5）：槽位存在 + Ctrl+V 粘贴提示 +
        // 双模式胶囊 + 三档强度胶囊 + 默认值（style / 0.6）+ 画布冗余气泡已删。
        // FAIL 时逐条打印缺失项，不只报布尔。
        const g15pages = scanned.filter((p) => p.route === "/modules/live-studio");
        const g15items = g15pages.map((p) => {
            const s = p.referenceSlot || {};
            const missing = [];
            if (!s.present) missing.push("参考图槽位缺失（[data-yq='live-reference-slot']）");
            if (s.present && !s.hasPasteHint) missing.push("无 Ctrl+V 粘贴提示文案");
            if ((s.modeCapsules || 0) < 2) missing.push(`模式胶囊 ${s.modeCapsules ?? 0}/2`);
            if ((s.strengthCapsules || 0) < 3) missing.push(`强度胶囊 ${s.strengthCapsules ?? 0}/3`);
            if (s.defaultMode !== "style") missing.push(`默认模式「${s.defaultMode || "未采到"}」≠ style`);
            if (s.defaultStrength !== "0.6") missing.push(`默认强度「${s.defaultStrength || "未采到"}」≠ 0.6`);
            if (p.canvasBubbleRemoved === false) missing.push("画布仍残留「💡 默认夜景底可直接开播」气泡");
            return { p, ok: missing.length === 0, missing, s };
        });
        gate("G15", "直播间对标参考图模块（槽位/粘贴提示/双模式/三档强度/默认值/气泡已删）",
            g15pages.length > 0 && g15items.every((i) => i.ok),
            g15pages.length === 0
                ? "未采集到直播装修台（/modules/live-studio）"
                : g15items.map((i) => `${i.p.route}@${i.p.viewport} 槽位${i.s.present ? "✓" : "✗"} · 粘贴提示${i.s.hasPasteHint ? "✓" : "✗"} · 模式胶囊 ${i.s.modeCapsules ?? 0} · 强度胶囊 ${i.s.strengthCapsules ?? 0} · 默认 ${i.s.defaultMode || "未采到"}/${i.s.defaultStrength || "未采到"} · 画布气泡${i.p.canvasBubbleRemoved ? "已删 ✓" : "残留 ✗"}${i.missing.length ? `｜缺失：${i.missing.join("；")}` : ""}`).join("；"));
        // G16 反推台状态收敛与实心主 CTA（返工令 Round 5）：顶部不得直接铺开 ≥3 个技术 Tag，
        // 应收敛为单个状态点（🟢/🟡 + 文案，模型列表进 Tooltip）；主按钮必须实心（≥1）。
        const g16pages = scanned.filter((p) => p.route === "/ereverse");
        const g16items = g16pages.map((p) => {
            const s = p.ereverseStatus || {};
            const missing = [];
            if (!s.statusTagsCollapsed) missing.push(`顶部技术 Tag 未收敛（状态区内可见 Tag ${s.statusTagsInZone ?? "?"} 个）`);
            if ((p.solidCtas || 0) < 1) missing.push(`实心主 CTA ${p.solidCtas ?? 0} 个（<1）`);
            if (!s.statusDotText) missing.push("未采到状态点文案");
            return { p, ok: missing.length === 0, missing, s };
        });
        gate("G16", "反推台状态收敛（单状态点+Tooltip）与实心主 CTA（≥1）",
            g16pages.length > 0 && g16items.every((i) => i.ok),
            g16pages.length === 0
                ? "未采集到 /ereverse"
                : g16items.map((i) => `${i.p.route}@${i.p.viewport} 状态点「${i.s.statusDotText || "未采到"}」${i.s.statusTagsCollapsed ? "✓" : "✗"} · 状态区 Tag ${i.s.statusTagsInZone ?? 0} 个 · 实心 CTA ${i.p.solidCtas ?? 0} 个${(i.p.solidCtas ?? 0) >= 1 ? "✓" : "✗"} · 出口按钮 ${i.s.exitButtons ?? 0} 个 · 步骤条${i.s.stepsPresent ? "✓" : "✗"}${i.missing.length ? `｜缺失：${i.missing.join("；")}` : ""}`).join("；"));
        if (authPages.length === 0) {
            gate("G0", "采集有效性（至少 1 页可测）", false, "页面可达但未识别到已认证工作台（疑似落在登录页）——数据不代表真实工坊");
        } else {
            gate("G0", "采集有效性（至少 1 页可测）", true, `已认证页面 ${authPages.length}/${scanned.length}`);
        }
        // G17 侧栏布局与定制模块门禁（夜间施工令阶段二）：上游原生导航项齐全 + 「定制模块」
        // 分组与三大定制工作台直达入口在位 + 全站不再出现旧词「固定模块」。
        // 返工令 Round 6：/ereverse 已挂栏，也是带侧栏的已认证页，计入本门禁分母。
        const g17pages = scanned.filter((p) => p.sidebarG17 && p.sidebarG17.present);
        const g17items = g17pages.map((p) => {
            const s = p.sidebarG17;
            const missing = [];
            if (!s.nativeItems) missing.push("上游原生导航项缺失（创作/短剧制作/自由画布/技能/资产）");
            if (!s.customGroup) missing.push("「定制模块」分组缺失");
            if (!s.customEntries) missing.push("定制入口组缺失（/modules、/ecommerce、/modules/live-studio、/ereverse）");
            if (!s.legacyTextGone) missing.push("页面仍残留旧词「固定模块」");
            return { p, ok: missing.length === 0, missing, s };
        });
        gate("G17", "侧栏布局与定制模块门禁（原生项齐全+定制模块组+全站无旧词）",
            g17pages.length > 0 && g17items.every((i) => i.ok),
            g17pages.length === 0
                ? "未采集到带侧栏的已认证页面"
                : g17items.map((i) => `${i.p.route}@${i.p.viewport} 原生项${i.s.nativeItems ? "✓" : "✗"} · 定制分组${i.s.customGroup ? "✓" : "✗"} · 定制入口${i.s.customEntries ? "✓" : "✗"} · 旧词清除${i.s.legacyTextGone ? "✓" : "✗"}${i.missing.length ? `｜缺失：${i.missing.join("；")}` : ""}`).join("；"));
        // G18 启动控制台体检（返工令 Round 6）：:17580 面板密码脱敏（无明文常驻）、
        // 按钮栏单行不折行、服务卡片 2×2 网格 + 隧道紧凑条、运行中服务只留
        // 重启/停止/日志（无「启动」）、整页零纵向滚动。双视口都要过。
        const cp = (data.console && data.console.pages) || [];
        const g18items = cp.map((p) => {
            const missing = [];
            if (p.plaintextPassword) missing.push("页面出现明文密码 jinji666");
            if (!p.pwdPillMasked) missing.push("密码脱敏胶囊缺失或未掩码");
            if (!p.toolbarSingleRow || (p.toolbarOverflow ?? 0) > 2) missing.push(`按钮栏非单行（tops 去重后 >1 或溢出 ${p.toolbarOverflow}px）`);
            if (!p.requiredLabelsOk) missing.push(`按钮栏缺规定按钮：${(p.labels || []).join("/")}`);
            if (!p.legacyLabelsGone) missing.push("仍残留旧按钮（打开源起创作画布/进入工作台首页/接入自检/E-Reverse 事实表）");
            if (p.gridTracks !== 2) missing.push(`服务卡片网格列数 ${p.gridTracks} ≠ 2`);
            if ((p.serviceCards || 0) < 4) missing.push(`服务卡片 ${p.serviceCards ?? 0} 张（<4）`);
            if ((p.compactBars || 0) < 1) missing.push("隧道紧凑条缺失");
            if (!p.runningNoStart) missing.push("运行中服务仍显示「启动」按钮（应只留 重启/停止/日志）");
            if (p.vScroll) missing.push(`整页出现纵向滚动（scrollHeight ${p.scrollH} > innerHeight ${p.innerH}）`);
            return { p, ok: missing.length === 0, missing };
        });
        gate("G18", "启动控制台体检（密码脱敏/按钮单行/2×2卡片网格/智能按钮/零滚动）",
            cp.length > 0 && g18items.every((i) => i.ok),
            cp.length === 0
                ? "未采集到启动控制台（127.0.0.1:17580，控制台未运行或不可达）"
                : g18items.map((i) => `@${i.p.viewport} 明文密码${i.p.plaintextPassword ? "有✗" : "无✓"} · 脱敏胶囊${i.p.pwdPillMasked ? "✓" : "✗"} · 按钮单行${i.p.toolbarSingleRow ? "✓" : "✗"} · 网格${i.p.gridTracks}列 · 服务卡${i.p.serviceCards}张 · 隧道条${i.p.compactBars} · 运行中服务${i.p.runningCards}个按钮${i.p.runningNoStart ? "仅重启/停止/日志✓" : "异常✗"} · 纵向滚动${i.p.vScroll ? `有✗(${i.p.scrollH}>${i.p.innerH})` : "无✓"}${i.missing.length ? `｜缺失：${i.missing.join("；")}` : ""}`).join("；"));
        // G19 跨商品图片隔离 + 矩阵防重叠 + 反推台挂栏（返工令 Round 6，建筑师点名必做）。
        // 三项断言：① 依次点开第 1、2 个商品，两者「透明主体」img src 绝不相同（禁串台）；
        // ② 批量企划矩阵第 1 列商品名与第 2 列「屏 1」文本 BoundingClientRect 交集 ≤4px²；
        // ③ /ereverse 左侧导航栏真实出现（hasSidebar）且无「signal is aborted」假死文案。
        const g19pages = scanned.filter((p) => p.route === "/ecommerce#matrix-guard");
        const g19erev = scanned.filter((p) => p.route === "/ereverse");
        const g19items = g19pages.map((p) => {
            const g = p.matrixGuard || {};
            const m = g.matrix || {};
            const missing = [];
            if (g.isolated !== true) missing.push(`跨商品隔离未通过（${(g.reasons || []).join("；") || "未采集"}）`);
            if (!m.ok) missing.push(`矩阵单元格未测到（${m.reason || "弹窗未打开/无屏列"}）`);
            else {
                if ((m.maxTextOverlap ?? 0) > 4) missing.push(`商品名文本与「屏 1」文本最大重叠 ${m.maxTextOverlap}px²（>4，最宽行「${m.widestName}」）`);
                if ((m.maxCellOverlap ?? 0) > 4) missing.push(`商品名单元格与「屏 1」单元格最大重叠 ${m.maxCellOverlap}px²（>4）`);
                if ((m.widestNameBtnW ?? 0) > 182) missing.push(`最宽商品名按钮 ${m.widestNameBtnW}px（>182，未收敛到 max-w-[180px]，行「${m.widestName}」）`);
            }
            return { p, ok: missing.length === 0, missing, g, m };
        });
        const erevHasSidebar = g19erev.length > 0 && g19erev.every((p) => (p.ereverseNav || {}).hasSidebar);
        const erevNoAbort = g19erev.length > 0 && g19erev.every((p) => !p.abortedErrorText);
        gate("G19", "跨商品图片隔离 + 矩阵防重叠 + 反推台挂栏",
            g19pages.length > 0 && g19items.every((i) => i.ok) && erevHasSidebar && erevNoAbort,
            [
                g19pages.length === 0
                    ? "未采集到 /ecommerce#matrix-guard"
                    : g19items.map((i) => `@${i.p.viewport} 隔离${i.g.isolated ? "✓" : "✗"}(主体图 ${i.g.src1Len || 0}B vs ${i.g.src2Len || 0}B) · 矩阵${i.m.measuredRows ?? 0}行最大重叠 文本${i.m.maxTextOverlap ?? "未测"}px²/单元格${i.m.maxCellOverlap ?? "未测"}px² · 最宽按钮${i.m.widestNameBtnW ?? "?"}px「${i.m.widestName || ""}」${i.missing.length ? `｜缺失：${i.missing.join("；")}` : ""}`).join("；"),
                `/ereverse@双视口 侧栏${erevHasSidebar ? "✓" : "✗"} · abort 假死文案${erevNoAbort ? "无✓" : "有✗"}`,
            ].join("｜"));
    }

    // 5) 报告
    const lines = [];
    lines.push(`# 前端 UI/UX 空间透视与交互体检报告（${STAMP}）`, "");
    lines.push(`- 基线：\`${BASE}\`　采集时间：${data.collectedAt}`);
    lines.push(`- 视口：${VIEWPORTS.map((v) => v.name).join(" / ")}　路由：${ROUTES.map((r) => r.path).join(" / ")}`);
    lines.push(`- 认证状态：${authPages.length ? `✅ 已认证（${authPages.length} 页）` : "⚠️ 未认证或未识别到工作台骨架——以下数据可能落在登录页，请带 --cookie 重跑"}`);
    lines.push("", "## 【总架构师体验门禁总表】", "");
    lines.push("| 门禁 | 指标 | 结果 | 实测 |", "|---|---|---|---|");
    for (const g of gates) lines.push(`| ${g.id} | ${g.name} | ${g.pass ? "✅ PASS" : "❌ FAIL"} | ${g.detail} |`);
    lines.push("", `**总判定：${gates.every((g) => g.pass) ? `✅ ${gates.length} 项全绿（G0~G${gates.length - 1}）` : "❌ 存在红线，需修复后重跑"}**`, "");

    // 采集期显式失败清单（返工令 Round 4：清零 .catch(()=>{}) 静默吞错）
    const allProbeErrors = scanned.flatMap((p) => (p.probeErrors || []).map((e) => `\`${p.route}\`@${p.viewport} ${e}`));
    lines.push("## 〇、采集期显式失败记录（probeErrors，原 .catch(()=>{}) 吞掉的部分）", "");
    if (allProbeErrors.length) lines.push(...allProbeErrors.map((s) => `- ${s}`));
    else lines.push("- ✅ 无：所有等待/弹窗/解码步骤均未静默失败");
    lines.push("");

    lines.push("## 一、视口空间布局与占屏比账本", "");
    for (const p of scanned) {
        lines.push(`### ${p.label}（\`${p.route}\` @ ${p.viewport}）`, "");
        lines.push(`- URL：\`${p.url}\`　标题：${p.title}　DOM 节点 ${p.perf.domNodes}　最大嵌套 ${p.perf.maxDepth}`);
        lines.push(`- 占屏比：视觉预览区 **${p.area.visualPct}%**、控件区 ${p.area.controlPct}%、其余为留白/文字`);
        lines.push(`- 一级容器：${p.containers.slice(0, 6).map((c) => `\`${c.tag}\` ${c.w}×${c.h}`).join("　")}`);
        lines.push("");
    }

    lines.push("## 二、认知负荷与拥挤度扫描", "");
    lines.push("| 页面 | 卡片数 | 单卡最多按钮 | 单卡最多输入 | 徽标峰值 | 折行/溢出 | 横向滚动 |", "|---|---|---|---|---|---|---|");
    for (const p of scanned) {
        lines.push(`| ${p.label}@${p.viewport} | ${p.cards.length} | ${Math.max(0, ...p.cards.map((c) => c.buttons), 0)} | ${Math.max(0, ...p.cards.map((c) => c.inputs), 0)} | ${Math.max(0, ...p.cards.map((c) => c.badges), 0)} | ${p.wrappedTotal} | ${p.hScroll ? "⚠️ 有" : "无"} |`);
    }
    // 字段名与采集端对齐（此前写成 w.w×w.h，而采集端已改为 leafW/lines，导致打印 undefined×undefined）
    const wrapSamples = scanned.flatMap((p) => (p.wrapped || []).slice(0, 5).map((w) => {
        const size = w.leafW ? `leafW=${w.leafW}` : w.lines ? `lines=${w.lines}` : w.scrollW ? `scrollW=${w.scrollW}>clientW=${w.clientW}` : "";
        return `\`${p.route}\` ${w.kind} 「${w.text}」 ${size}`;
    }));
    if (wrapSamples.length) lines.push("", "折行/溢出明细：", ...wrapSamples.map((s) => `- ${s}`));
    lines.push("");

    lines.push("## 三、视觉层级阶梯（fontSize|weight|color → 出现次数）", "");
    for (const p of scanned) {
        lines.push(`### ${p.label}@${p.viewport}`, "");
        for (const [k, n] of p.ladder.slice(0, 10)) lines.push(`- \`${k}\` × ${n}`);
        lines.push(`- 实心主按钮（Primary CTA）候选：${p.solidCtas}　带底按钮总数：${p.primaryBtns}`, "");
    }

    lines.push("## 四、小白核心动线摩擦度", "");
    lines.push("> 探针以静态扫描为主；点击动线需在栈可用后由 `--journey` 模式补测（见脚本头部 TODO）。", "");
    lines.push("| 页面 | 可达性观察 |", "|---|---|");
    for (const p of scanned) {
        const deep = p.perf.maxDepth;
        lines.push(`| ${p.label}@${p.viewport} | DOM 嵌套 ${deep} 层；卡片 ${p.cards.length} 张；首屏控件占比 ${p.area.controlPct}% |`);
    }
    lines.push("");

    lines.push("## 五、DOM 与渲染性能体检", "");
    lines.push("| 页面 | DOM 节点 | 最大嵌套 | conic-gradient | drop-shadow | content-visibility |", "|---|---|---|---|---|---|");
    for (const p of scanned) {
        lines.push(`| ${p.label}@${p.viewport} | ${p.perf.domNodes} | ${p.perf.maxDepth} | ${p.perf.conic} | ${p.perf.dropShadow} | ${p.perf.contentVisibility} |`);
    }
    lines.push("", "## 六、脏字符扫描", "");
    const allDirty = scanned.flatMap((p) => (p.dirty || []).map((d) => `\`${p.route}\` 「${d}」`));
    if (allDirty.length) lines.push(...allDirty.map((s) => `- ${s}`));
    else lines.push("- ✅ 未发现裸露 Markdown 符号或技术黑话");
    lines.push("");

    lines.push("## 七、反丑陋门禁明细（G7~G10）", "");
    lines.push("### G7 香肠按钮（宽度 >300px 的可见按钮）", "");
    const wideBtns = scanned.flatMap((p) => (p.buttons || []).filter((b) => b.w > 300).map((b) => ({ ...b, route: p.route })));
    if (wideBtns.length) {
        lines.push("| 页面 | 文案 | 宽×高 | 豁免原因 |", "|---|---|---|---|");
        for (const b of wideBtns) {
            const why = !b.visibleBtn
                ? "透明无边文本触发器（按 G2 同口径豁免）"
                : b.sidebar ? "侧栏导航菜单项（豁免）"
                : b.accordion ? "折叠手风琴标题（豁免）"
                : b.flexStretched ? "flex-1 撑开的控件（单独说明）"
                : "⚠️ 未豁免，计入 FAIL";
            lines.push(`| ${b.route} | 「${b.text}」 | ${b.w}×${b.h} | ${why} |`);
        }
    } else lines.push("- ✅ 无宽度 >300px 的可见按钮");
    lines.push("", "### G8 破图与碰撞", "");
    const brokenRows = scanned.flatMap((p) => (p.brokenImages || []).map((i) => `- \`${p.route}\` 「${i.alt || "无alt"}」 ${i.src}`));
    lines.push(brokenRows.length ? brokenRows.join("\n") : "- ✅ 可见图片全部加载完成（complete && naturalWidth>0）");
    const overlapRows = scanned.flatMap((p) => (p.overlaps || []).map((o) => `- \`${p.route}\` 「${o.a}」×「${o.b}」 交集 ${o.area}px²`));
    lines.push(...(overlapRows.length ? overlapRows : ["- ✅ 顶栏/工具栏无元素碰撞（非父子交集 ≤4px²）"]));
    lines.push("", "### G9 直播装修台画布", "");
    for (const p of livePages) {
        const s = p.liveStage || {};
        lines.push(`- \`${p.route}\`@${p.viewport}：画布容器 ${s.canvasFound ? `比例 ${s.stageAspect} · 高 ${s.stageHeight}px` : "未检测到"}，右栏占屏 ${s.stageColPct ?? 0}%，visualPct ${p.area?.visualPct ?? 0}%`);
    }
    lines.push("", "### G10 电商首屏 SlotCard", "");
    for (const p of g10pages) {
        const s = p.slotCards || {};
        lines.push(`- \`${p.route}\`@${p.viewport}：SlotCard ${s.count ?? 0} 张，第一排顶边 y=${s.firstCardY ?? "未采到"}，默认选中商品「${s.activeProduct || "未知"}」（${s.activeStatus || "?"}）`);
    }
    // 返工令 Round 6：选中态跨视口漂移显式化——同一路由在两个视口下默认选中的商品
    // 应一致；不一致说明后端列表排序随时间变化（会话漂移），在此点名。
    const driftPairs = [];
    for (const route of Array.from(new Set(g10pages.map((p) => p.route)))) {
        const names = Array.from(new Set(g10pages.filter((p) => p.route === route).map((p) => p.slotCards?.activeProduct || "")));
        if (names.length > 1) driftPairs.push(`\`${route}\`：${names.join(" ↔ ")}`);
    }
    lines.push(...(driftPairs.length ? ["", "⚠️ 选中态跨视口漂移：", ...driftPairs.map((s) => `- ${s}`)] : ["", "- ✅ 选中态跨视口无漂移（同一路由两个视口默认选中商品一致）"]));
    lines.push("");

    lines.push("## 八、反绕过加固明细（G11~G19）", "");
    lines.push("### G11 禁止代点绕过", "");
    lines.push("- 探针已删除全部 `document.querySelector(\"aside ul li\")` 主动点击（含 `#unstarted` 的 clickUnstarted 代点）；保留的只有 waitForSelector / waitForFunction 等待。");
    for (const p of g10pages) {
        const s = p.slotCards || {};
        lines.push(`- \`${p.route}\`@${p.viewport}：SlotCard ${s.count ?? 0} 张${p.emptyStateText ? "，页面含「还没有选择商品任务」空态" : ""}`);
    }
    lines.push("", "### G12 精修台弹窗真打开", "");
    for (const p of scanned.filter((p) => p.route === "/ecommerce#retouch-open")) {
        const m = p.modal || { found: false, w: 0, h: 0 };
        const base = scanned.find((b) => b.route === "/ecommerce" && b.viewport === p.viewport);
        lines.push(`- \`${p.route}\`@${p.viewport}：弹窗容器 ${m.found ? `${m.w}×${m.h}` : "未出现"}；DOM ${p.perf?.domNodes ?? 0} vs 基础态 ${base?.perf?.domNodes ?? "未采"}（增量 ${(p.perf?.domNodes ?? 0) - (base?.perf?.domNodes ?? 0)}）`);
    }
    lines.push("", "### G13 蚊子字与纳米按钮", "");
    const tinyFontRows = scanned.flatMap((p) => (p.tinyFonts || []).map((f) => `- \`${p.route}\`@${p.viewport} 「${f.text}」 ${f.size} <${f.tag}>`));
    lines.push(tinyFontRows.length ? tinyFontRows.join("\n") : "- ✅ 未发现 10px/11px 可见文本");
    const tinyBtnRows = scanned.flatMap((p) => (p.buttons || []).filter((b) => b.w < 24 || b.h < 22).map((b) => `- \`${p.route}\`@${p.viewport} 「${b.text || "无文案"}」 ${b.w}×${b.h}`));
    lines.push(...(tinyBtnRows.length ? tinyBtnRows : ["- ✅ 未发现 <24×22 的可见按钮"]));
    lines.push("", "### G14 爆款反推台不孤岛", "");
    for (const p of scanned.filter((p) => p.route === "/ereverse")) {
        const nav = p.ereverseNav || {};
        lines.push(`- \`${p.route}\`@${p.viewport}：左侧导航栏 ${nav.hasSidebar ? "有" : "无"}；返回入口 ${nav.hasBack ? `有「${nav.backText}」` : "无"}`);
    }
    lines.push("", "### G15 直播台对标参考图模块（返工令 Round 5）", "");
    for (const p of scanned.filter((p) => p.route === "/modules/live-studio")) {
        const s = p.referenceSlot || {};
        lines.push(`- \`${p.route}\`@${p.viewport}：槽位 ${s.present ? "有" : "无"} · Ctrl+V 粘贴提示 ${s.hasPasteHint ? "有" : "无"} · 模式胶囊 ${s.modeCapsules ?? 0} 个（默认 ${s.defaultMode || "未采到"}） · 强度胶囊 ${s.strengthCapsules ?? 0} 个（默认 ${s.defaultStrength || "未采到"}） · 画布冗余气泡 ${p.canvasBubbleRemoved ? "已删" : "仍残留"}`);
    }
    lines.push("", "### G16 反推台状态收敛与实心 CTA（返工令 Round 5）", "");
    for (const p of scanned.filter((p) => p.route === "/ereverse")) {
        const s = p.ereverseStatus || {};
        lines.push(`- \`${p.route}\`@${p.viewport}：状态点「${s.statusDotText || "未采到"}」 · 状态区直接铺开的技术 Tag ${s.statusTagsInZone ?? 0} 个 · 实心主 CTA ${p.solidCtas ?? 0} 个 · 复刻出口按钮 ${s.exitButtons ?? 0} 个 · 3 步引导条 ${s.stepsPresent ? "有" : "无"}`);
    }
    lines.push("", "### G17 侧栏布局与定制模块（夜间施工令阶段二）", "");
    for (const p of scanned.filter((p) => p.sidebarG17 && p.sidebarG17.present)) {
        const s = p.sidebarG17;
        lines.push(`- \`${p.route}\`@${p.viewport}：原生项 ${s.nativeItems ? "✓" : "✗"} · 定制分组 ${s.customGroup ? "✓" : "✗"} · 定制入口 ${s.customEntries ? "✓" : "✗"} · 旧词「固定模块」已清 ${s.legacyTextGone ? "✓" : "✗"}`);
    }
    lines.push("", "### G18 启动控制台体检（返工令 Round 6）", "");
    for (const p of (data.console && data.console.pages) || []) {
        lines.push(`- @${p.viewport}：明文密码 ${p.plaintextPassword ? "有 ✗" : "无 ✓"} · 脱敏胶囊 ${p.pwdPillMasked ? "✓" : "✗"} · 按钮单行 ${p.toolbarSingleRow ? "✓" : "✗"}（溢出 ${p.toolbarOverflow}px） · 按钮 ${(p.labels || []).join(" / ")} · 服务卡片 ${p.serviceCards ?? 0} 张（网格 ${p.gridTracks} 列） · 隧道紧凑条 ${p.compactBars ?? 0} · 运行中服务 ${p.runningCards ?? 0} 个${p.runningNoStart ? "（仅 重启/停止/日志 ✓）" : "（按钮异常 ✗）"} · 纵向滚动 ${p.vScroll ? `有 ✗（${p.scrollH}>${p.innerH}）` : "无 ✓"}${p.error ? `｜采集失败：${p.error}` : ""}`);
    }
    lines.push("", "### G19 跨商品隔离 / 矩阵防重叠 / 反推台挂栏（返工令 Round 6）", "");
    for (const p of scanned.filter((p) => p.route === "/ecommerce#matrix-guard")) {
        const g = p.matrixGuard || {};
        const m = g.matrix || {};
        lines.push(`- \`${p.route}\`@${p.viewport}：跨商品隔离 ${g.isolated ? "✓" : "✗"}（商品「${(g.productNames || []).join("」「")}」主体图 ${g.src1Len || 0}B vs ${g.src2Len || 0}B） · 矩阵 ${m.measuredRows ?? 0} 行最大重叠 文本 ${m.maxTextOverlap ?? "未测"}px² / 单元格 ${m.maxCellOverlap ?? "未测"}px² · 最宽商品名 ${m.widestNameBtnW ?? "?"}px「${m.widestName || ""}」${(g.reasons || []).length ? `｜未过项：${g.reasons.join("；")}` : ""}`);
    }
    for (const p of scanned.filter((p) => p.route === "/ereverse")) {
        const nav = p.ereverseNav || {};
        lines.push(`- \`${p.route}\`@${p.viewport}：左侧导航栏 ${nav.hasSidebar ? "有 ✓" : "无 ✗"} · 「signal is aborted」假死文案 ${p.abortedErrorText ? "有 ✗" : "无 ✓"}`);
    }
    lines.push("");

    const report = join(OUT_DIR, `前端UI_UX遥测体检报告_${STAMP}.md`);
    writeFileSync(report, lines.join("\n"));
    console.log(`[probe] 报告 → ${report}`);
    console.log(`[probe] 门禁：${gates.map((g) => `${g.id}:${g.pass ? "PASS" : "FAIL"}`).join("  ")}`);
    process.exit(gates.every((g) => g.pass) ? 0 : 1);
}

// G10 前置：先确保左栏有未开始态商品（必要时 seed），再开浏览器采集。
await ensureUnstartedProduct();
run();
