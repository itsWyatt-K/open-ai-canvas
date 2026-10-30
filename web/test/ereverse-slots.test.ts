/**
 * 片段仿拍 · 五维槽位树单测（施工包四门禁）。
 *
 * 核心不变量（对标 AppGrowing「换肉不换骨」）：
 * 换模特 / 换产品 / 换背景 / 换口播 四个手术**只改白名单键**，
 * 「主体.动作」与「镜头运镜」在任何 swap 后逐字不变。
 * 另覆盖：compile 同构（中/英）、空段跳过、normalize 兜底。
 */

import { describe, expect, test } from "bun:test";

import { emptyPromptSlots, type EreversePromptSlots } from "@/lib/canvas/ereverse-view";
import { LOCKED_FIELDS, SWAP_LABELS, compileSlotsPrompt, compileSlotsPromptEn, lockedFieldsIntact, slotsCharCount, swapSlot, type SwapKind } from "@/pages/ereverse/slots";

const BASE: EreversePromptSlots = {
    主体: { 身份: "穿西装的愤怒男子", 外观: "黑色西装，白衬衫，深色领带", 动作: "站立，伸手指向身后屏幕，握拳挥动，身体前倾" },
    产品: { 名称与外观: "红光坐灸仪", 展示方式: "手持展示" },
    场景背景: { 环境: "直播间，背景有促销横幅", 光影色调: "暖黄侧光，高对比" },
    镜头运镜: { 景别: "中景", 运镜: "极速推镜" },
    口播台词: "家人们谁懂啊，这个价格真的假的",
};

const SWAPS: Array<{ kind: SwapKind; value: string; expect: (slots: EreversePromptSlots) => void }> = [
    {
        kind: "model",
        value: "25岁阳光女主播，米色针织衫，丸子头",
        expect: (slots) => {
            expect(slots.主体.身份).toBe("25岁阳光女主播，米色针织衫，丸子头");
            expect(slots.主体.外观).toBe("25岁阳光女主播，米色针织衫，丸子头");
        },
    },
    {
        kind: "product",
        value: "梦百合零压床垫，浅灰褶皱面料",
        expect: (slots) => {
            expect(slots.产品.名称与外观).toBe("梦百合零压床垫，浅灰褶皱面料");
            expect(slots.产品.展示方式).toBe("手持展示"); // 未在白名单，保持原值
        },
    },
    {
        kind: "background",
        value: "奶油风卧室，晨光斜照",
        expect: (slots) => {
            expect(slots.场景背景.环境).toBe("奶油风卧室，晨光斜照");
            expect(slots.场景背景.光影色调).toBe("奶油风卧室，晨光斜照");
        },
    },
    {
        kind: "dialogue",
        value: "家人们，今天这款真的杀疯了",
        expect: (slots) => {
            expect(slots.口播台词).toBe("家人们，今天这款真的杀疯了");
        },
    },
];

describe("片段仿拍槽位树 · 换装锁定不变量", () => {
    for (const item of SWAPS) {
        test(`${item.kind} 换装：锁定键逐字不变`, () => {
            const before = JSON.parse(JSON.stringify(BASE)) as EreversePromptSlots;
            const after = swapSlot(BASE, item.kind, item.value);
            // 核心断言：主体.动作 / 镜头运镜.景别 / 镜头运镜.运镜 100% 锁定
            expect(lockedFieldsIntact(before, after)).toBe(true);
            for (const { slot, field } of LOCKED_FIELDS) {
                expect((after[slot] as Record<string, string>)[field]).toBe((before[slot] as Record<string, string>)[field]);
            }
            // 白名单键确实被改写
            item.expect(after);
            // 入参不被修改（纯函数）
            expect(BASE.主体.身份).toBe("穿西装的愤怒男子");
        });
    }

    test("四个换装按钮齐全且带锁定提示", () => {
        const kinds: SwapKind[] = ["model", "product", "background", "dialogue"];
        for (const kind of kinds) {
            expect(SWAP_LABELS[kind]).toBeDefined();
            expect(SWAP_LABELS[kind].button.length).toBeGreaterThan(0);
            expect(SWAP_LABELS[kind].hint).toContain("100%");
        }
    });

    test("空串换装不产生病句（清空合法，锁定仍生效）", () => {
        const after = swapSlot(BASE, "model", "");
        expect(after.主体.身份).toBe("");
        expect(after.主体.外观).toBe("");
        expect(lockedFieldsIntact(BASE, after)).toBe(true);
    });
});

describe("片段仿拍槽位树 · 编译式（与侧车 compile_slots_prompt 同构）", () => {
    test("中文编译式：冠部+正在做+展示+口播", () => {
        const compiled = compileSlotsPrompt(BASE);
        expect(compiled.startsWith("【中景、极速推镜】")).toBe(true);
        expect(compiled).toContain("穿西装的愤怒男子、黑色西装，白衬衫，深色领带正在做站立，伸手指向身后屏幕，握拳挥动，身体前倾");
        expect(compiled).toContain("展示红光坐灸仪、手持展示");
        expect(compiled.endsWith("口播：家人们谁懂啊，这个价格真的假的")).toBe(true);
    });

    test("英文编译式：结构对齐、内容保留", () => {
        const compiled = compileSlotsPromptEn(BASE);
        expect(compiled.startsWith("[中景, 极速推镜]")).toBe(true);
        expect(compiled).toContain("showcasing 红光坐灸仪, 手持展示");
        expect(compiled).toContain("voiceover: 家人们谁懂啊，这个价格真的假的");
    });

    test("空段跳过：只有主体时不留「正在做」空挂", () => {
        const slots = emptyPromptSlots();
        slots.主体 = { 身份: "仅身份", 外观: "", 动作: "" };
        expect(compileSlotsPrompt(slots)).toBe("仅身份");
        expect(compileSlotsPrompt(slots)).not.toContain("正在做");
    });

    test("全空树编译为空串", () => {
        expect(compileSlotsPrompt(emptyPromptSlots())).toBe("");
    });
});

describe("片段仿拍槽位树 · 序列化与计量", () => {
    test("字符数 = JSON.stringify(缩进2) 长度", () => {
        expect(slotsCharCount(BASE)).toBe(JSON.stringify(BASE, null, 2).length);
    });

    test("swap 结果可 JSON 往返（画布快照安全）", () => {
        const after = swapSlot(BASE, "product", "新品");
        const round = JSON.parse(JSON.stringify(after)) as EreversePromptSlots;
        expect(round.产品.名称与外观).toBe("新品");
        expect(lockedFieldsIntact(BASE, round)).toBe(true);
    });
});
