/**
 * 全能复刻预置动效模板回归（M2 一键推荐开放门槛的前置断言）。
 *
 * 口径（《项目交付方案 v1.2》§9 preset 回归）：三模板枚举合法 + 时间轴自洽 +
 * theme 引用可解析 + CSS 关键帧齐全。本文件是 bun test 门禁侧断言；
 * nxf 侧 test_code_render.py 的渲染回归由程不宕覆盖——两边都过才向运营开放。
 *
 * 枚举词表与 e-reverse pft_schema.py / nxf code-render 渲染器三方同源，
 * 本测试硬编码冻结值做双校对（不一致 = 渲染 422）。
 */
import { describe, expect, test } from "bun:test";

import {
    MOTION_ENTER_TYPES,
    MOTION_EXIT_TYPES,
    MOTION_TRANSITION_TYPES,
    MOTION_PRESETS,
    MOTION_WORDLIST_VERSION,
    OMNIREPLICA_DEFAULT_CANVAS,
    OMNIREPLICA_DEFAULT_THEME,
    getMotionPreset,
    type MotionPreset,
} from "@/lib/omnireplica/motion-presets";

const THEME_COLOR_REF = /^@theme\.colors\.([A-Za-z_][A-Za-z0-9_]*)$/;

function collectAnimationTypes(preset: MotionPreset): { kind: "enter" | "exit" | "transition"; type: string }[] {
    const found: { kind: "enter" | "exit" | "transition"; type: string }[] = [];
    for (const shot of preset.shots) {
        found.push({ kind: "enter", type: shot.enter.type });
        found.push({ kind: "exit", type: shot.exit.type });
        for (const element of shot.elements) {
            found.push({ kind: "enter", type: element.enter.type });
            if (element.exit) found.push({ kind: "exit", type: element.exit.type });
        }
    }
    for (const transition of preset.transitions) {
        found.push({ kind: "transition", type: transition.type });
    }
    return found;
}

function collectThemeColorRefs(preset: MotionPreset): string[] {
    const refs: string[] = [];
    const scan = (value: unknown) => {
        if (typeof value === "string") {
            const matched = THEME_COLOR_REF.exec(value);
            if (matched) refs.push(matched[1]);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(scan);
            return;
        }
        if (value && typeof value === "object") {
            Object.values(value as Record<string, unknown>).forEach(scan);
        }
    };
    scan(preset.shots);
    return refs;
}

function definedKeyframeNames(css: string): string[] {
    return [...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
}

describe("omnireplica motion presets", () => {
    test("枚举词表与冻结契约三方同源（e-reverse / nxf 双校对）", () => {
        expect([...MOTION_ENTER_TYPES]).toEqual([
            "none",
            "fade",
            "fade-up",
            "fade-down",
            "slide-left",
            "slide-right",
            "zoom-in",
            "zoom-out",
            "pop",
            "flip-x",
            "blur-in",
        ]);
        expect([...MOTION_EXIT_TYPES]).toEqual(["none", "fade", "fade-down", "scale-down", "slide-left", "slide-right"]);
        expect([...MOTION_TRANSITION_TYPES]).toEqual(["none", "cut", "dip-to-white", "dip-to-black", "cross-fade"]);
        expect(MOTION_WORDLIST_VERSION).toBe("motion-wordlist/v1");
    });

    test("恰好 3 个预置模板且 id 唯一（口播条/产品特写/氛围过场）", () => {
        expect(MOTION_PRESETS).toHaveLength(3);
        expect(MOTION_PRESETS.map((p) => p.id)).toEqual(["speaker-bar", "product-closeup", "mood-transition"]);
        expect(new Set(MOTION_PRESETS.map((p) => p.id)).size).toBe(3);
        expect(MOTION_PRESETS.every((p) => p.name && p.tagline && p.description && p.refineNotes.length > 0)).toBeTrue();
        expect(getMotionPreset("speaker-bar")?.name).toBe("口播条");
        expect(getMotionPreset("不存在的id")).toBeUndefined();
    });

    test("默认主题/画布种子值合法", () => {
        expect(Object.keys(OMNIREPLICA_DEFAULT_THEME.colors).length).toBeGreaterThanOrEqual(5);
        expect(OMNIREPLICA_DEFAULT_THEME.title_size_ratio).toBeGreaterThan(0);
        expect(OMNIREPLICA_DEFAULT_CANVAS.width).toBe(1080);
        expect(OMNIREPLICA_DEFAULT_CANVAS.height).toBe(1920);
        expect(OMNIREPLICA_DEFAULT_CANVAS.fps).toBeGreaterThan(0);
    });

    for (const preset of MOTION_PRESETS) {
        describe(`模板 ${preset.name}（${preset.id}）`, () => {
            test("动效枚举全部合法（集合外即渲染 422）", () => {
                for (const { kind, type } of collectAnimationTypes(preset)) {
                    if (kind === "enter") expect(MOTION_ENTER_TYPES).toContain(type as never);
                    if (kind === "exit") expect(MOTION_EXIT_TYPES).toContain(type as never);
                    if (kind === "transition") expect(MOTION_TRANSITION_TYPES).toContain(type as never);
                }
            });

            test("时间轴自洽：递增不重叠、时长正、layer 合法、动效时长/延迟合法", () => {
                expect(preset.shots.length).toBeGreaterThanOrEqual(2);
                let cursor = 0;
                for (const shot of preset.shots) {
                    expect(shot.start_ms).toBe(cursor);
                    expect(shot.end_ms).toBeGreaterThan(shot.start_ms);
                    expect(["code", "live_action"]).toContain(shot.layer);
                    expect(shot.enter.duration_ms).toBeGreaterThan(0);
                    expect(shot.exit.duration_ms).toBeGreaterThan(0);
                    for (const element of shot.elements) {
                        expect(element.enter.duration_ms).toBeGreaterThan(0);
                        expect(element.enter.delay_ms ?? 0).toBeGreaterThanOrEqual(0);
                        if (element.exit) expect(element.exit.duration_ms).toBeGreaterThan(0);
                    }
                    cursor = shot.end_ms;
                }
                expect(cursor).toBeGreaterThan(0);
            });

            test("transitions 引用存在的 shot 且时长合法", () => {
                const shotIds = new Set(preset.shots.map((s) => s.shot_id));
                for (const transition of preset.transitions) {
                    expect(shotIds.has(transition.after_shot)).toBeTrue();
                    expect(transition.duration_ms).toBeGreaterThanOrEqual(0);
                }
            });

            test("elements 结构自洽：id 唯一、text 非空、坐标/尺寸/描边合法", () => {
                const seen = new Set<string>();
                for (const shot of preset.shots) {
                    for (const element of shot.elements) {
                        expect(seen.has(element.element_id)).toBeFalse();
                        seen.add(element.element_id);
                        expect(element.size_ratio).toBeGreaterThan(0);
                        if (element.type === "text") {
                            expect(element.text.trim().length).toBeGreaterThan(0);
                            expect(element.position.x).toBeGreaterThan(0);
                            expect(element.position.x).toBeLessThanOrEqual(1);
                            expect(element.position.y).toBeGreaterThan(0);
                            expect(element.position.y).toBeLessThanOrEqual(1);
                            expect(element.color).toMatch(THEME_COLOR_REF);
                            if (element.stroke) {
                                expect(element.stroke.color).toMatch(THEME_COLOR_REF);
                                expect(element.stroke.width_ratio).toBeGreaterThan(0);
                            }
                        }
                        if (element.type === "image" || element.type === "sprite") {
                            expect(element.slot.length).toBeGreaterThan(0);
                            expect(element.position.x).toBeGreaterThan(0);
                            expect(element.position.x).toBeLessThanOrEqual(1);
                        }
                    }
                }
            });

            test("theme 引用可解析（@theme.colors.* 全部落在默认主题键内）", () => {
                const refs = collectThemeColorRefs(preset);
                expect(refs.length).toBeGreaterThan(0);
                for (const key of refs) {
                    expect(Object.hasOwn(OMNIREPLICA_DEFAULT_THEME.colors, key)).toBeTrue();
                }
            });

            test("CSS 关键帧齐全：每个用到的动效类型都有对应 @keyframes", () => {
                const defined = new Set(definedKeyframeNames(preset.cssKeyframes));
                expect(defined.size).toBeGreaterThan(0);
                for (const { kind, type } of collectAnimationTypes(preset)) {
                    if (type === "none") continue;
                    expect(defined.has(`omni-${kind}-${type}`)).toBeTrue();
                }
                // 不允许死 CSS：定义的关键帧必须被模板用到
                const used = new Set(
                    collectAnimationTypes(preset)
                        .filter((a) => a.type !== "none")
                        .map((a) => `omni-${a.kind}-${a.type}`),
                );
                for (const name of defined) {
                    expect(used.has(name)).toBeTrue();
                }
            });
        });
    }
});
