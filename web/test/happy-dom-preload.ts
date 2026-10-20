// DOM 测试环境 preload（env 门控，默认完全空转）。
//
// 背景：一键详情的 UI/执行测试用 happy-dom 手工装配全局，但测试文件里的**静态 import**
// （use-config-store → @vidstack/react）会在装配之前求值，而 vidstack 在模块作用域读
// `localStorage`，于是报 "localStorage is not defined"。Bun 的 preload 运行在测试模块
// 之前，正好覆盖这个时间窗。
//
// 纪律：宿主有 313 个测试文件，其中若干断言 `typeof window === "undefined"`。
// 因此这里**只在 HAPPY_DOM=1 时才装配**，默认不改变任何既有测试的行为。

import { Window } from "happy-dom";

if (process.env.HAPPY_DOM === "1" && typeof globalThis.window === "undefined") {
    const dom = new Window({ url: "http://localhost:3000" });
    // Node 侧必须保留的能力，不能被 happy-dom 的同名属性顶掉。
    const keep = new Set([
        "process", "Buffer", "global", "globalThis", "require", "module", "exports",
        "__dirname", "__filename", "console", "setTimeout", "clearTimeout", "setInterval",
        "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "TextEncoder",
        "TextDecoder", "fetch", "URL", "URLSearchParams", "AbortController", "AbortSignal",
        "structuredClone", "performance", "crypto", "atob", "btoa", "navigator",
    ]);
    for (const key of Object.getOwnPropertyNames(dom)) {
        if (keep.has(key)) continue;
        let value: unknown;
        try {
            value = (dom as unknown as Record<string, unknown>)[key];
        } catch {
            continue; // getter 抛属性（部分宿主对象）直接跳过
        }
        if (typeof value === "undefined") continue;
        try {
            Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: false });
        } catch {
            // 只读或不可配置属性：不影响 DOM 测试主路径
        }
    }
    Object.defineProperty(globalThis, "window", { value: dom, writable: true, configurable: true });
    Object.defineProperty(globalThis, "document", { value: dom.document, writable: true, configurable: true });
    Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { value: true, writable: true, configurable: true });
}
