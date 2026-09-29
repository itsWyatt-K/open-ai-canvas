// 契约三件套 · 静态两件生成器（不需要起后端）
//  ① 节点 schema 快照：从 canvas-agent/src/modules/exit-gates/contracts.ts 的 zod 契约静态提取结构
//  ② 本地依赖 API 路由清单：静态扫描 (a) 后端 gin 路由注册全表 (b) 本地侧（canvas-agent + web）依赖路径
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "D:/AlcheMvision/open-ai-canvas";
// 输出先落 _work_tmp：正式目录 docs/contract-trio 下的同名文件由上层工具写入，
// 规避本机"已存在文件不可被进程覆盖"的安全策略（覆盖按删除语义拦截）。
const OUT_DIR = "D:/AlcheMvision/_work_tmp/contract-trio-out";

// ── ① schema 快照：用 tsx 动态 import zod 契约并序列化结构 ──────────────────
async function buildSchemaSnapshot() {
    const mod = await import(
        pathToFileURL(path.join(REPO, "canvas-agent/src/modules/exit-gates/contracts.ts")).href
    );
    const wanted = [
        "vec3Schema", "shotSizeSchema", "cameraMoveSchema",
        "storyboardSubjectSchema", "storyboardSceneSchema", "storyboardShotSchema",
        "storyboardSchema", "guardrailRuleActionSchema", "guardrailRuleSchema",
    ];
    const describe = (schema, depth = 0) => {
        if (depth > 6) return "<max depth>";
        const def = schema?._def ?? schema?.def;
        const typeName = def?.typeName ?? def?.type ?? "unknown";
        const out = { type: String(typeName).replace(/^Zod/, "") };
        try {
            if (def?.innerType) out.inner = describe(def.innerType, depth + 1);
            if (def?.type) out.item = describe(def.type, depth + 1);
            if (def?.valueType) out.value = describe(def.valueType, depth + 1);
            if (Array.isArray(def?.options)) out.options = def.options.map((o) => (o?.value ?? String(o)));
            if (Array.isArray(def?.values)) out.values = def.values;
            if (def?.checks) out.checks = def.checks.map((c) => c.kind ?? String(c));
            let shape = def?.shape ?? schema?.shape;
            if (typeof shape === "function") shape = shape(); // zod v3：_def.shape() 是函数
            if (shape && typeof shape === "object") {
                out.fields = Object.fromEntries(
                    Object.entries(shape).map(([k, v]) => [k, describe(v, depth + 1)]),
                );
            }
        } catch { /* 结构探测失败就停在当前层 */ }
        return out;
    };

    const snapshot = {};
    const missing = [];
    for (const name of wanted) {
        if (mod[name]) snapshot[name] = describe(mod[name]);
        else missing.push(name);
    }
    if (missing.length) console.log("  [warn] 未找到 schema:", missing.join(", "));

    const header = [
        "# 契约三件套 · 之一：节点 schema 快照（S4 分镜 / S5 守卫规则）",
        "",
        `> 生成时间：${new Date().toISOString()}`,
        "> 来源：`canvas-agent/src/modules/exit-gates/contracts.ts`（zod 契约，静态导入，不启动后端）",
        "> 用途：合并窗口变更时比对节点契约是否发生不兼容漂移。",
        "",
        "## 字段结构（JSON）",
        "",
        "```json",
        JSON.stringify(snapshot, null, 2),
        "```",
        "",
    ].join("\n");
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, "schema-snapshot.md"), header, "utf8");
    fs.writeFileSync(path.join(OUT_DIR, "schema-snapshot.json"), JSON.stringify(snapshot, null, 2), "utf8");
    console.log(`[①] schema 快照：${wanted.length - missing.length}/${wanted.length} 个契约已序列化`);
}

// ── ② 路由清单：后端全表 + 本地依赖子集 ─────────────────────────────────────
function walk(dir, filter, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === "node_modules" || entry.name === ".git") continue;
            walk(p, filter, acc);
        } else if (filter(p)) acc.push(p);
    }
    return acc;
}

function buildRouteManifest() {
    const goFiles = walk(path.join(REPO, "backend"), (p) => p.endsWith(".go"));
    const routeRe = /\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\(\s*"([^"]+)"/g;
    const backendRoutes = [];
    const owner = new Map();
    for (const file of goFiles) {
        const src = fs.readFileSync(file, "utf8");
        let m;
        while ((m = routeRe.exec(src))) {
            const method = m[1];
            const route = m[2];
            backendRoutes.push({ method, route });
            owner.set(`${method} ${route}`, path.relative(REPO, file).replace(/\\/g, "/"));
        }
    }

    // 本地依赖：canvas-agent 里的 /api 硬编码 + web services 的 http.<verb>(...) 模板串
    const localDeps = [];
    const agentFiles = [
        ...walk(path.join(REPO, "canvas-agent/src"), (p) => p.endsWith(".ts")),
    ];
    const apiRe = /\/api\/[a-zA-Z0-9_/\-]+/g;
    for (const file of agentFiles) {
        const src = fs.readFileSync(file, "utf8");
        let m;
        while ((m = apiRe.exec(src))) {
            localDeps.push({ side: "canvas-agent", call: m[0], file: path.relative(REPO, file).replace(/\\/g, "/") });
        }
    }
    const webFiles = walk(path.join(REPO, "web/src/services"), (p) => p.endsWith(".ts") || p.endsWith(".tsx"));
    const httpRe = /http\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*[`"]([^`"]+)[`"]/g;
    for (const file of webFiles) {
        const src = fs.readFileSync(file, "utf8");
        let m;
        while ((m = httpRe.exec(src))) {
            localDeps.push({ side: "web", method: m[1].toUpperCase(), call: m[2], file: path.relative(REPO, file).replace(/\\/g, "/") });
        }
    }

    // 归并去重
    const seen = new Set();
    const deps = localDeps.filter((d) => {
        const key = `${d.side}|${d.method ?? ""}|${d.call}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const lines = [
        "# 契约三件套 · 之二：本地依赖 API 路由清单",
        "",
        `> 生成时间：${new Date().toISOString()}`,
        "> 生成方式：静态扫描（gin 路由注册 + 本地调用点），**未启动后端**",
        "> 用途：合并窗口变更时，判断上游路由改动是否命中本地依赖面。",
        "",
        `## 概览`,
        "",
        `| 项 | 数量 |`,
        `|---|---|`,
        `| 后端已注册路由（静态可扫） | ${backendRoutes.length} |`,
        `| 本地依赖调用点（canvas-agent + web） | ${deps.length} |`,
        "",
        "## 本地依赖调用点",
        "",
        "| 侧 | 方法 | 路径 | 调用文件 |",
        "|---|---|---|---|",
        ...deps.map((d) => `| ${d.side} | ${d.method ?? "-"} | \`${d.call}\` | ${d.file} |`),
        "",
        "## 后端路由全表（按文件归属）",
        "",
        "| 方法 | 路由 | 注册文件 |",
        "|---|---|---|",
        ...backendRoutes.map((r) => `| ${r.method} | \`${r.route}\` | ${owner.get(`${r.method} ${r.route}`)} |`),
        "",
    ];
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, "local-api-route-manifest.md"), lines.join("\n"), "utf8");
    fs.writeFileSync(
        path.join(OUT_DIR, "local-api-route-manifest.json"),
        JSON.stringify({ backendRoutes, localDependencies: deps }, null, 2),
        "utf8",
    );
    console.log(`[②] 路由清单：后端 ${backendRoutes.length} 条，本地依赖 ${deps.length} 个调用点`);
}

await buildSchemaSnapshot();
buildRouteManifest();
console.log("静态两件完成 →", OUT_DIR);
