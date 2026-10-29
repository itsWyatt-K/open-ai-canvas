// 战役一：分镜卡减负 —— 「场景企划」轻量抽屉（antd Popover，不引新依赖）。
// 默认态卡片只留「状态徽标 + 3:4 海报画框 + 主副标题」；
// 场景描述 / 锁主体 / AI 换思路 / 构图版式 / 海报大小字 / L2 提示词全部收进这里，
// 失焦即存（后端自动重编译 L2），ai_hint 触发确定性变体。
import { useEffect, useState } from "react";
import { App, Button, Input, Popover, Select } from "antd";
import { SlidersHorizontal } from "lucide-react";

import {
    ECOMMERCE_LAYOUT_LABELS,
    type EcommerceBriefBody,
    type EcommerceProductDetail,
    type EcommerceUserBrief,
} from "@/services/api/ecommerce";

type SlotLike = EcommerceProductDetail["slots"][number];

/** 从 slot 派生企划草稿：老数据没有 brief 时回退 slot.title，锁主体默认开。 */
function briefFromSlot(slot: SlotLike): EcommerceUserBrief {
    return {
        screen_title: slot.brief?.screen_title ?? slot.title ?? "",
        sub_title: slot.brief?.sub_title ?? "",
        scene_desc: slot.brief?.scene_desc ?? "",
        layout_type: slot.brief?.layout_type ?? "",
        preserve_product_exact: slot.brief?.preserve_product_exact ?? true,
    };
}

export function SlotBriefPanel({
    slot, onSave,
}: {
    slot: SlotLike;
    /** v60：L1 企划保存（失焦即存；ai_hint 触发确定性变体）。 */
    onSave: (body: EcommerceBriefBody) => Promise<void>;
}) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState<EcommerceUserBrief>(() => briefFromSlot(slot));
    const [aiHint, setAiHint] = useState("");
    const [busy, setBusy] = useState(false);

    // 服务端刷新（Agent 改稿 / 轮询）后同步草稿，与旧卡常驻面板同一口径。
    useEffect(() => {
        setDraft(briefFromSlot(slot));
    }, [slot.brief, slot.title, slot.updatedAt]);

    const save = async (patch: Partial<EcommerceUserBrief> & { ai_hint?: string }) => {
        setBusy(true);
        try {
            await onSave({ ...draft, ...patch });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "企划保存失败");
        } finally {
            setBusy(false);
        }
    };

    const locked = slot.brief?.preserve_product_exact ?? true;
    return (
        <Popover
            trigger="click"
            placement="bottom"
            arrow={false}
            open={open}
            onOpenChange={setOpen}
            destroyOnHidden
            styles={{
                root: { zIndex: "var(--z-popover)" },
                container: {
                    padding: 0,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r-lg)",
                },
            }}
            content={
                <div className="ecommerce-slot-brief-panel">
                    <div className="ecommerce-slot-brief-panel-header">
                        <strong>🎛 场景企划</strong>
                        <span>
                            {slot.kind === "hero" ? "主图" : "详情"} {slot.slotNo} · 改完自动生效
                        </span>
                    </div>
                    <label className="ecommerce-slot-brief-field">
                        <span>海报主标题（图上大字）</span>
                        <Input
                            size="small"
                            value={draft.screen_title}
                            maxLength={80}
                            onChange={(event) => setDraft((prev) => ({ ...prev, screen_title: event.target.value }))}
                            onBlur={() => void save({})}
                            placeholder="一句话卖点（如 38dB 深度静音）"
                        />
                    </label>
                    <label className="ecommerce-slot-brief-field">
                        <span>海报副标题（图上小字）</span>
                        <Input
                            size="small"
                            value={draft.sub_title}
                            maxLength={120}
                            onChange={(event) => setDraft((prev) => ({ ...prev, sub_title: event.target.value }))}
                            onBlur={() => void save({})}
                            placeholder="支撑卖点 / 人群限定"
                        />
                    </label>
                    <label className="ecommerce-slot-brief-field">
                        <span>🖼 场景描述</span>
                        <Input.TextArea
                            size="small"
                            autoSize={{ minRows: 2, maxRows: 4 }}
                            value={draft.scene_desc}
                            maxLength={600}
                            onChange={(event) => setDraft((prev) => ({ ...prev, scene_desc: event.target.value }))}
                            onBlur={() => void save({})}
                            placeholder="背景、道具、光线氛围、商品摆哪（如 暖色儿童房，婴儿床边，柔光台灯）"
                        />
                    </label>
                    <label className="ecommerce-slot-brief-field">
                        <span>构图版式</span>
                        <Select
                            size="small"
                            value={draft.layout_type || undefined}
                            options={Object.entries(ECOMMERCE_LAYOUT_LABELS).map(([value, label]) => ({ value, label }))}
                            onChange={(value: string | undefined) => {
                                setDraft((prev) => ({ ...prev, layout_type: value ?? "" }));
                                void save({ layout_type: value ?? "" });
                            }}
                            placeholder="让 AI 定"
                            allowClear
                        />
                    </label>
                    <div className="ecommerce-slot-brief-field">
                        <span>🔒 锁商品原图</span>
                        <button
                            type="button"
                            className={`self-start rounded-full px-2 py-0.5 text-caption transition-colors ${draft.preserve_product_exact ? "bg-emerald-500/15 text-emerald-600" : "bg-foreground/8 text-foreground/50"}`}
                            title="开启后生图只画场景，商品原图像素级合成（100% 不变形）"
                            onClick={() => {
                                const next = !draft.preserve_product_exact;
                                setDraft((prev) => ({ ...prev, preserve_product_exact: next }));
                                void save({ preserve_product_exact: next });
                            }}
                        >
                            {draft.preserve_product_exact ? "🔒 100% 锁商品原图" : "🔓 锁商品原图（关）"}
                        </button>
                        <p className="ecommerce-slot-brief-hint">开启后商品原图像素不变，仅按场景重打光融合。</p>
                    </div>
                    <div className="ecommerce-slot-brief-field">
                        <span>✨ AI 换思路</span>
                        <div className="flex items-center gap-1">
                            <Input
                                size="small"
                                value={aiHint}
                                maxLength={200}
                                onChange={(event) => setAiHint(event.target.value)}
                                onPressEnter={() => { if (aiHint.trim()) { void save({ ai_hint: aiHint.trim() }); setAiHint(""); } }}
                                placeholder="如 改成户外露营草地背景"
                            />
                            <Button
                                size="small"
                                type="text"
                                className="!h-auto !px-1 text-caption"
                                loading={busy}
                                disabled={!aiHint.trim()}
                                onClick={() => { void save({ ai_hint: aiHint.trim() }); setAiHint(""); }}
                            >
                                换！
                            </Button>
                        </div>
                    </div>
                    {/* 🔧 高阶折叠：底层编译提示词（L2，默认隐藏） */}
                    <details className="text-caption text-foreground/40">
                        <summary className="cursor-pointer select-none">🔧 底层生图提示词（L2，自动编译）</summary>
                        <p className="mt-1 whitespace-pre-wrap rounded bg-background/60 px-2 py-1 leading-4">
                            {slot.promptOverride || slot.generationPrompt || "（保存企划后自动生成）"}
                        </p>
                    </details>
                </div>
            }
        >
            <button
                type="button"
                className="ecommerce-slot-brief-trigger"
                aria-expanded={open}
                title="场景描述 / 锁商品原图 / AI 换思路"
            >
                <SlidersHorizontal />
                场景企划
                {locked ? <span className="text-emerald-600">🔒</span> : null}
            </button>
        </Popover>
    );
}
