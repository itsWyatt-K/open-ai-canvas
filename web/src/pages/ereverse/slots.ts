/**
 * 片段仿拍 · 五维槽位树前端同构助手（与侧车 providers.py 一一对应）。
 *
 * 铁律：换模特/换产品/换背景/换口播四个傻瓜按钮**只改对应键值**，
 * "主体.动作" 与 "镜头运镜" 100% 锁定原片（换肉不换骨）。
 * 编译式与侧车 compile_slots_prompt 逐字同构：
 *   【景别/运镜】+ 场景背景 + 主体身份与外观正在做主体动作 + 展示产品 + 口播
 *
 * 本文件为纯函数，无 React 依赖——单测见 test/ereverse-slots.test.ts。
 */

import { emptyPromptSlots, type EreversePromptSlots } from "@/lib/canvas/ereverse-view";

export type SwapKind = "model" | "product" | "background" | "dialogue";

/** 四个换装按钮各自允许改写的键（白名单之外一律不许碰）。 */
const SWAP_KEYS: Record<SwapKind, Array<{ slot: keyof EreversePromptSlots; field: string }>> = {
    model: [
        { slot: "主体", field: "身份" },
        { slot: "主体", field: "外观" },
    ],
    product: [{ slot: "产品", field: "名称与外观" }],
    background: [
        { slot: "场景背景", field: "环境" },
        { slot: "场景背景", field: "光影色调" },
    ],
    dialogue: [{ slot: "口播台词", field: "" }],
};

export const SWAP_LABELS: Record<SwapKind, { button: string; hint: string; placeholder: string }> = {
    model: { button: "👤 换模特", hint: "只改「主体.身份/外观」——动作与运镜 100% 保留原片", placeholder: "新模特描述，如：25岁阳光女主播，米色针织衫，丸子头" },
    product: { button: "📦 换产品", hint: "只改「产品.名称与外观」——人物动作与运镜 100% 保留", placeholder: "新产品描述，如：梦百合零压床垫，浅灰褶皱面料" },
    background: { button: "🖼️ 换背景", hint: "只改「场景背景.环境/光影色调」——人物与产品 100% 保留", placeholder: "新背景描述，如：奶油风卧室，晨光斜照，暖白基调" },
    dialogue: { button: "🎙️ 换口播", hint: "只改「口播台词」——画面与动作 100% 保留", placeholder: "新口播台词，如：家人们，今天这款真的杀疯了" },
};

function str(value: unknown): string {
    return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

/**
 * 换装手术：按白名单替换键值，返回新槽位树（不改入参）。
 * 锁定断言由单测保障：主体.动作 / 镜头运镜在任何 swap 后逐字不变。
 */
export function swapSlot(slots: EreversePromptSlots, kind: SwapKind, value: string): EreversePromptSlots {
    const next: EreversePromptSlots = JSON.parse(JSON.stringify(slots)) as EreversePromptSlots;
    const text = str(value);
    for (const { slot, field } of SWAP_KEYS[kind]) {
        if (slot === "口播台词") {
            next["口播台词"] = text;
        } else {
            (next[slot] as Record<string, string>)[field] = text;
        }
    }
    return next;
}

/** 槽位树 → 模型提示词（与侧车 compile_slots_prompt 同构；空段跳过不留病句）。 */
export function compileSlotsPrompt(slots: EreversePromptSlots): string {
    const parts: string[] = [];
    const shot = [slots.镜头运镜.景别, slots.镜头运镜.运镜].filter(Boolean).join("、");
    const scene = [slots.场景背景.环境, slots.场景背景.光影色调].filter(Boolean).join("、");
    const subject = [slots.主体.身份, slots.主体.外观].filter(Boolean).join("、");
    const action = slots.主体.动作;
    const product = [slots.产品.名称与外观, slots.产品.展示方式].filter(Boolean).join("、");
    const dialogue = slots.口播台词;
    if (shot) parts.push(`【${shot}】`);
    if (scene) parts.push(scene);
    if (subject && action) parts.push(`${subject}正在做${action}`);
    else if (subject) parts.push(subject);
    else if (action) parts.push(action);
    if (product) parts.push(`展示${product}`);
    if (dialogue) parts.push(`口播：${dialogue}`);
    return parts.join("，");
}

/** 槽位树 JSON 序列化字符数（编辑框底部统计用）。 */
export function slotsCharCount(slots: EreversePromptSlots): number {
    return JSON.stringify(slots, null, 2).length;
}

/**
 * 英文结构编译式（「语言显示：英文」时用；槽位内容保持原样，
 * 只把合成骨架译成英文——内容翻译不臆造，交给用户手改）。
 */
export function compileSlotsPromptEn(slots: EreversePromptSlots): string {
    const parts: string[] = [];
    const shot = [slots.镜头运镜.景别, slots.镜头运镜.运镜].filter(Boolean).join(", ");
    const scene = [slots.场景背景.环境, slots.场景背景.光影色调].filter(Boolean).join(", ");
    const subject = [slots.主体.身份, slots.主体.外观].filter(Boolean).join(", ");
    const action = slots.主体.动作;
    const product = [slots.产品.名称与外观, slots.产品.展示方式].filter(Boolean).join(", ");
    const dialogue = slots.口播台词;
    if (shot) parts.push(`[${shot}]`);
    if (scene) parts.push(scene);
    if (subject && action) parts.push(`${subject} ${action}`);
    else if (subject) parts.push(subject);
    else if (action) parts.push(action);
    if (product) parts.push(`showcasing ${product}`);
    if (dialogue) parts.push(`voiceover: ${dialogue}`);
    return parts.join(", ");
}

/** 锁定校验：换装手术不得触碰的键（供 UI 徽章与单测共用）。 */
export const LOCKED_FIELDS: ReadonlyArray<{ slot: keyof EreversePromptSlots; field: string }> = [
    { slot: "主体", field: "动作" },
    { slot: "镜头运镜", field: "景别" },
    { slot: "镜头运镜", field: "运镜" },
];

/** 深比较两个槽位树的锁定键是否逐字一致。 */
export function lockedFieldsIntact(before: EreversePromptSlots, after: EreversePromptSlots): boolean {
    return LOCKED_FIELDS.every(({ slot, field }) => (before[slot] as Record<string, string>)[field] === (after[slot] as Record<string, string>)[field]);
}

export { emptyPromptSlots };
