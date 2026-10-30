/**
 * 全能复刻 · MotionBlueprint v1 类型与纯函数（零成本改稿的工程文件本体）。
 *
 * 设计纪律（《项目交付方案 v1.2》冻结）：
 * - **plan 是唯一耗时数据源**：任何耗时展示从 RenderPlan 派生，禁第二套计时口径；
 * - **影响条判定按 outcome 不按 cause**：全局作用域字段变化 → 全局分支；逐镜头
 *   shot_key 快照比对 → 全未命中=全局 / 部分未命中=局部 / 全命中=零变更；
 *   theme 按 outcome 走——只废「真引用被改变量」的镜头，改无人引用的配色 = 零变更；
 * - **模板给默认值、VLM 只填槽**：blueprintFromMotion 对宽松 JSON 防御性装配，
 *   漏返字段不兜底猜动效（动效猜错比没有更糟），显式 degraded 登记。
 */

import { MOTION_ENTER_TYPES, MOTION_EXIT_TYPES, MOTION_PRESETS, MOTION_TRANSITION_TYPES, type MotionPreset } from "@/lib/omnireplica/motion-presets";

// ---------------------------------------------------------------------------
// 类型（schema: motion-blueprint/v1）
// ---------------------------------------------------------------------------

export type MotionEasing = "linear" | "ease-out" | "ease-in" | "ease-in-out" | (string & {});

export type MotionEnter = { type: string; duration_ms?: number; delay_ms?: number; easing?: MotionEasing };
export type MotionExit = { type: string; duration_ms?: number; easing?: MotionEasing };

export type MotionElement = {
    element_id: string;
    type: "text" | "image" | "sprite";
    slot?: string;
    text?: string;
    position: { x: number; y: number };
    size_ratio?: number;
    /** 实际色值或 "@theme.colors.<key>" 引用（渲染时注入 :root CSS 变量）。 */
    color?: string;
    stroke?: { color?: string; width_ratio?: number };
    enter?: MotionEnter;
};

export type MotionShot = {
    shot_id: string;
    start_ms: number;
    end_ms: number;
    /** 写实层占位：code=包装镜头（代码生成）；live_action=实拍镜头（占位，二阶段可补实拍）。 */
    layer?: "code" | "live_action";
    enter?: MotionEnter;
    exit?: MotionExit;
    elements: MotionElement[];
    /** 低置信/降级登记（degraded 三机制：预览角标 + 一键推荐补齐）。 */
    degraded?: string[];
    confidence?: number;
};

export type MotionSlot = {
    kind: "product_image" | "sprite";
    url: string;
    fit?: string;
    sprite?: { slice_index: number; frame_count: number; fps: number };
};

export type MotionBlueprint = {
    schema: "motion-blueprint/v1";
    blueprint_id: string;
    meta: {
        title: string;
        source: { type: "manual" | "ereverse-motion"; ereverse_job_id?: string };
        provenance: { generator: string; degraded: string[] };
    };
    canvas: {
        width: number;
        height: number;
        fps: number;
        duration_ms: number;
        background: { type: "solid" | "sequence"; solid: string; sequence: Array<{ at_ms: number; color: string }> };
    };
    theme: { colors: Record<string, string>; fonts: Record<string, string>; title_size_ratio: number };
    slots: Record<string, MotionSlot>;
    shots: MotionShot[];
    transitions: Array<{ after_shot: string; type: string; duration_ms: number }>;
};

// ---------------------------------------------------------------------------
// 动效枚举（集合外 → 引擎映射 none + degraded；UI 下拉只给集合内选项）
// ---------------------------------------------------------------------------

export const ENTER_TYPES = ["none", "fade", "fade-up", "fade-down", "slide-left", "slide-right", "zoom-in", "zoom-out", "pop", "flip-x", "blur-in"] as const;
export const EXIT_TYPES = ["none", "fade", "fade-down", "scale-down", "slide-left", "slide-right"] as const;
export const TRANSITION_TYPES = ["none", "cut", "dip-to-white", "dip-to-black", "cross-fade"] as const;

/** 低置信阈值：低于它镜头进「建议人工确认」清单（degraded 三机制）。 */
export const LOW_CONFIDENCE = 0.6;

// ---------------------------------------------------------------------------
// 帧率裁决（R6）：480p 试水默认 24fps；1080p 成片默认 30fps；15fps 应急档明示画质代价
// ---------------------------------------------------------------------------

export type FpsOption = { value: number; label: string; note?: string };

export const FPS_OPTIONS: FpsOption[] = [
    { value: 24, label: "24 fps（试水默认）", note: "截帧量 -20%，服务「改 1 个 5s 镜头 ≈ 付 1/3 成本」体感" },
    { value: 30, label: "30 fps（成片默认）", note: "交付口径统一，抖音/视频号信息流标准" },
    { value: 15, label: "15 fps（应急档）", note: "⚠️ 画质代价：运动可能呈现顿感；仅改稿 ≤30s 兜底路径使用" },
];

export function defaultFpsFor(resolution: string): number {
    if (resolution === "1080p") return 30;
    return 24; // 480p 试水 / 720p 过渡档
}

export function isEmergencyFps(fps: number): boolean {
    return fps === 15;
}

// ---------------------------------------------------------------------------
// 空蓝图 / 装配（模板给默认值，VLM 只填槽）
// ---------------------------------------------------------------------------

let blueprintSeq = 0;

function nextBlueprintId(): string {
    blueprintSeq += 1;
    const stamp = Date.now().toString(16).slice(-6);
    return `bp_${stamp}${blueprintSeq.toString(16).padStart(2, "0")}`;
}

export function emptyBlueprint(title = "未命名复刻工程"): MotionBlueprint {
    return {
        schema: "motion-blueprint/v1",
        blueprint_id: nextBlueprintId(),
        meta: { title, source: { type: "manual" }, provenance: { generator: "omnireplica-mvp/0.1", degraded: [] } },
        canvas: { width: 1080, height: 1920, fps: defaultFpsFor("480p"), duration_ms: 15_000, background: { type: "solid", solid: "#0B0B12", sequence: [] } },
        theme: { colors: { primary: "#FF4D4F", text: "#FFFFFF", stroke: "#0B0B12" }, fonts: { title: "msyhbd.ttc" }, title_size_ratio: 0.075 },
        slots: {},
        shots: [],
        transitions: [],
    };
}

function str(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function num(value: unknown, fallback: number): number {
    const parsed = typeof value === "string" ? Number(value) : value;
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : fallback;
}

function pickEnum(value: unknown, allowed: readonly string[], fallback: string): string {
    const text = str(value).trim();
    return allowed.includes(text) ? text : fallback;
}

/**
 * e-reverse PFT.motion 宽松块 → MotionBlueprint（防御性装配）。
 *
 * - 结构字段全部由模板给默认值；VLM 只覆盖其产出的槽位；
 * - 动效类型不在枚举内 → none + 该镜 degraded 登记（不猜、不静默）；
 * - 漏返 motion / 半返 → 返回纯模板蓝图 + provenance.degraded 明示。
 */
export function blueprintFromMotion(motion: unknown, options: { title?: string; ereverseJobId?: string; durationMs?: number; width?: number; height?: number }): MotionBlueprint {
    const blueprint = emptyBlueprint(options.title || "参考视频复刻");
    blueprint.meta.source = { type: "ereverse-motion", ...(options.ereverseJobId ? { ereverse_job_id: options.ereverseJobId } : {}) };
    if (options.durationMs && options.durationMs > 0) blueprint.canvas.duration_ms = options.durationMs;
    if (options.width && options.width > 0) blueprint.canvas.width = options.width;
    if (options.height && options.height > 0) blueprint.canvas.height = options.height;
    if (!motion || typeof motion !== "object") {
        blueprint.meta.provenance.degraded = ["motion-missing: VLM 未产出动效草案，已按通用模板装配，请人工编辑"];
        return blueprint;
    }
    const raw = motion as Record<string, unknown>;
    const degraded: string[] = [];

    // theme：VLM 只覆盖其产出的键
    const rawTheme = (raw.theme && typeof raw.theme === "object" ? raw.theme : {}) as Record<string, unknown>;
    const rawColors = (rawTheme.colors && typeof rawTheme.colors === "object" ? rawTheme.colors : {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(rawColors)) {
        if (typeof value === "string" && value.trim()) blueprint.theme.colors[key] = value.trim();
    }
    const rawFonts = (rawTheme.fonts && typeof rawTheme.fonts === "object" ? rawTheme.fonts : {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(rawFonts)) {
        if (typeof value === "string" && value.trim()) blueprint.theme.fonts[key] = value.trim();
    }
    if (rawTheme.title_size_ratio !== undefined) blueprint.theme.title_size_ratio = Math.min(0.2, Math.max(0.02, num(rawTheme.title_size_ratio, blueprint.theme.title_size_ratio)));

    // canvas：VLM 产出优先（时长/画幅是全局作用域字段）
    const rawCanvas = (raw.canvas && typeof raw.canvas === "object" ? raw.canvas : {}) as Record<string, unknown>;
    if (rawCanvas.duration_ms !== undefined) blueprint.canvas.duration_ms = Math.max(1_000, num(rawCanvas.duration_ms, blueprint.canvas.duration_ms));
    if (rawCanvas.width !== undefined) blueprint.canvas.width = Math.max(180, num(rawCanvas.width, blueprint.canvas.width));
    if (rawCanvas.height !== undefined) blueprint.canvas.height = Math.max(180, num(rawCanvas.height, blueprint.canvas.height));
    const rawBg = (rawCanvas.background && typeof rawCanvas.background === "object" ? rawCanvas.background : {}) as Record<string, unknown>;
    if (str(rawBg.type) === "sequence" && Array.isArray(rawBg.sequence)) {
        blueprint.canvas.background = {
            type: "sequence",
            solid: blueprint.canvas.background.solid,
            sequence: rawBg.sequence.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").map((item) => ({ at_ms: num(item.at_ms, 0), color: str(item.color, "#000000") })),
        };
    } else if (typeof rawBg.solid === "string" && rawBg.solid.trim()) {
        blueprint.canvas.background = { type: "solid", solid: rawBg.solid.trim(), sequence: [] };
    }

    // slots：产品图/精灵图物料
    const rawSlots = (raw.slots && typeof raw.slots === "object" ? raw.slots : {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(rawSlots)) {
        if (!value || typeof value !== "object") continue;
        const slot = value as Record<string, unknown>;
        const kind = str(slot.kind) === "sprite" ? "sprite" : "product_image";
        const sprite = slot.sprite && typeof slot.sprite === "object" ? (slot.sprite as Record<string, unknown>) : null;
        blueprint.slots[key] = {
            kind,
            url: str(slot.url),
            ...(typeof slot.fit === "string" ? { fit: slot.fit } : {}),
            ...(sprite ? { sprite: { slice_index: num(sprite.slice_index, 0), frame_count: Math.max(1, num(sprite.frame_count, 1)), fps: Math.max(1, num(sprite.fps, 12)) } } : {}),
        };
    }

    // shots：逐镜装配；动效集合外 → none + degraded
    const rawShots = Array.isArray(raw.shots) ? raw.shots : [];
    if (rawShots.length === 0) degraded.push("motion-no-shots: VLM 未产出镜头序列，已按通用模板装配，请人工编辑");
    blueprint.shots = rawShots.map((item, index) => {
        const shot = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
        const startMs = num(shot.start_ms, index * 3_000);
        const endMs = num(shot.end_ms, startMs + 3_000);
        const shotDegraded: string[] = [];
        const enterType = str(shot.enter && typeof shot.enter === "object" ? (shot.enter as Record<string, unknown>).type : "");
        const exitType = str(shot.exit && typeof shot.exit === "object" ? (shot.exit as Record<string, unknown>).type : "");
        if (enterType && !ENTER_TYPES.includes(enterType as (typeof ENTER_TYPES)[number])) shotDegraded.push(`enter 动效「${enterType}」不在受支持枚举内，已置 none`);
        if (exitType && !EXIT_TYPES.includes(exitType as (typeof EXIT_TYPES)[number])) shotDegraded.push(`exit 动效「${exitType}」不在受支持枚举内，已置 none`);
        const rawElements = Array.isArray(shot.elements) ? shot.elements : [];
        const elements: MotionElement[] = rawElements.map((el, elIndex) => {
            const element = (el && typeof el === "object" ? el : {}) as Record<string, unknown>;
            const position = element.position && typeof element.position === "object" ? (element.position as Record<string, unknown>) : {};
            const stroke = element.stroke && typeof element.stroke === "object" ? (element.stroke as Record<string, unknown>) : undefined;
            return {
                element_id: str(element.element_id, `el_${index + 1}_${elIndex + 1}`),
                type: str(element.type) === "image" ? "image" : str(element.type) === "sprite" ? "sprite" : "text",
                ...(typeof element.slot === "string" ? { slot: element.slot } : {}),
                ...(typeof element.text === "string" ? { text: element.text } : {}),
                position: { x: Math.min(1, Math.max(0, num(position.x, 0.5))), y: Math.min(1, Math.max(0, num(position.y, 0.5))) },
                ...(element.size_ratio !== undefined ? { size_ratio: Math.min(0.5, Math.max(0.01, num(element.size_ratio, 0.08))) } : {}),
                ...(typeof element.color === "string" ? { color: element.color } : {}),
                ...(stroke ? { stroke: { ...(typeof stroke.color === "string" ? { color: stroke.color } : {}), width_ratio: Math.min(0.05, Math.max(0, num(stroke.width_ratio, 0.006))) } } : {}),
                enter: {
                    type: pickEnum(element.enter && typeof element.enter === "object" ? (element.enter as Record<string, unknown>).type : "", ENTER_TYPES, "none"),
                    duration_ms: num(element.enter && typeof element.enter === "object" ? (element.enter as Record<string, unknown>).duration_ms : undefined, 300),
                    ...(num(element.enter && typeof element.enter === "object" ? (element.enter as Record<string, unknown>).delay_ms : undefined, 0) > 0 ? { delay_ms: num((element.enter as Record<string, unknown>).delay_ms, 0) } : {}),
                },
            };
        });
        if (rawElements.length === 0) shotDegraded.push("该镜头无元素清单（VLM 漏返），请人工补充");
        const confidence = shot.confidence !== undefined ? num(shot.confidence, 1) : undefined;
        if (confidence !== undefined && confidence < LOW_CONFIDENCE) shotDegraded.push(`镜头置信度 ${(confidence * 100).toFixed(0)}% 偏低，建议人工确认`);
        if (Array.isArray(shot.degraded)) for (const item of shot.degraded) if (typeof item === "string" && item.trim()) shotDegraded.push(item.trim());
        return {
            shot_id: str(shot.shot_id, `shot_${index + 1}`),
            start_ms: startMs,
            end_ms: Math.max(startMs + 200, endMs),
            layer: str(shot.layer) === "live" || str(shot.layer) === "live_action" ? "live_action" : "code",
            ...(enterType ? { enter: { type: pickEnum(enterType, ENTER_TYPES, "none"), duration_ms: num(shot.enter && typeof shot.enter === "object" ? (shot.enter as Record<string, unknown>).duration_ms : undefined, 400) } } : {}),
            ...(exitType ? { exit: { type: pickEnum(exitType, EXIT_TYPES, "none"), duration_ms: num(shot.exit && typeof shot.exit === "object" ? (shot.exit as Record<string, unknown>).duration_ms : undefined, 300) } } : {}),
            elements,
            ...(shotDegraded.length ? { degraded: shotDegraded } : {}),
            ...(confidence !== undefined ? { confidence } : {}),
        } satisfies MotionShot;
    });

    // transitions：集合外 → none + degraded
    const rawTransitions = Array.isArray(raw.transitions) ? raw.transitions : [];
    blueprint.transitions = rawTransitions
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => {
            const type = str(item.type);
            if (type && !TRANSITION_TYPES.includes(type as (typeof TRANSITION_TYPES)[number])) degraded.push(`转场「${type}」不在受支持枚举内，已置 none`);
            return { after_shot: str(item.after_shot), type: TRANSITION_TYPES.includes(type as (typeof TRANSITION_TYPES)[number]) ? type : "none", duration_ms: num(item.duration_ms, 200) };
        });

    blueprint.meta.provenance.degraded = degraded;
    return blueprint;
}

// ---------------------------------------------------------------------------
// theme 引用解析（换肤零成本关键路径：@theme.colors.X 渲染时注入 :root 变量）
// ---------------------------------------------------------------------------

const THEME_REF_RE = /^@theme\.([a-z]+)\.([A-Za-z0-9_-]+)$/;

/** "@theme.colors.primary" → { group: "colors", key: "primary" }；非引用返回 null。 */
export function parseThemeRef(ref: string | undefined): { group: string; key: string } | null {
    if (!ref) return null;
    const matched = THEME_REF_RE.exec(ref.trim());
    return matched ? { group: matched[1], key: matched[2] } : null;
}

/** 解析主题引用为实际值（非引用原样返回）。 */
export function resolveThemeValue(blueprint: MotionBlueprint, ref: string | undefined): string {
    const parsed = parseThemeRef(ref);
    if (!parsed) return ref || "";
    const group = (blueprint.theme as unknown as Record<string, Record<string, string>>)[parsed.group];
    return group?.[parsed.key] ?? (ref || "");
}

/** 蓝图内全部被引用的 theme 键（group.key），含元素 color/stroke。 */
export function usedThemeRefs(blueprint: MotionBlueprint): Set<string> {
    const used = new Set<string>();
    for (const shot of blueprint.shots) {
        for (const element of shot.elements) {
            for (const ref of [element.color, element.stroke?.color]) {
                const parsed = parseThemeRef(ref);
                if (parsed) used.add(`${parsed.group}.${parsed.key}`);
            }
        }
    }
    return used;
}

// ---------------------------------------------------------------------------
// 影响条判定（按 outcome 不按 cause；前后端同源规则的前端预估层）
// ---------------------------------------------------------------------------

export type EditImpactScope = "global" | "partial" | "none";

export type EditImpact = {
    scope: EditImpactScope;
    /** 局部分支下将重截的镜头 id（全局分支为全部镜头）。 */
    changedShotIds: string[];
    /** 全局分支的原因清单（人话，直接上影响条）。 */
    globalReasons: string[];
    /** 变更镜头时长占总时长比例（0~1；全局=1）。 */
    changedRatio: number;
    /** theme 变更键中「无人引用」的部分（改它们 = 零变更，明示不重渲）。 */
    inertThemeKeys: string[];
};

function deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function shotSignature(shot: MotionShot): unknown {
    return { shot_id: shot.shot_id, start_ms: shot.start_ms, end_ms: shot.end_ms, layer: shot.layer ?? "code", enter: shot.enter ?? null, exit: shot.exit ?? null, elements: shot.elements };
}

/**
 * 改稿影响判定（前端预估层，debounce 300ms；权威口径以 nxf 建 job 时的 plan 回填为准）。
 *
 * 判定序：
 * 1. 全局作用域字段（canvas.width/height/fps/duration_ms/background.*、transitions[]、
 *    theme.fonts、theme.title_size_ratio、引擎与字体版本）任一变化 → global；
 * 2. 逐镜头签名（shot_key 口径：@theme.* 已解析为实际值后比对）——
 *    全未命中 → global；部分未命中 → partial；全命中 → none；
 * 3. theme.colors 按 outcome：只把「真引用被改变量」的镜头算作变更；
 *    改了无人引用的配色 = 零变更（inertThemeKeys 明示）。
 */
export function classifyEditImpact(prev: MotionBlueprint, next: MotionBlueprint): EditImpact {
    const globalReasons: string[] = [];
    const globalFields: Array<[string, unknown, unknown]> = [
        ["画布宽度", prev.canvas.width, next.canvas.width],
        ["画布高度", prev.canvas.height, next.canvas.height],
        ["帧率 fps", prev.canvas.fps, next.canvas.fps],
        ["总时长", prev.canvas.duration_ms, next.canvas.duration_ms],
    ];
    for (const [label, a, b] of globalFields) {
        if (a !== b) globalReasons.push(`${label} ${a} → ${b}`);
    }
    if (!deepEqual(prev.canvas.background, next.canvas.background)) globalReasons.push("背景序列/底色变化");
    if (!deepEqual(prev.transitions, next.transitions)) globalReasons.push("转场序列变化");
    if (!deepEqual(prev.theme.fonts, next.theme.fonts)) globalReasons.push("主题字体变化（渲染引擎字体版本静默变化同样触发全局）");
    if (prev.theme.title_size_ratio !== next.theme.title_size_ratio) globalReasons.push("标题字号比例变化");

    // theme.colors：按引用关系算 outcome
    const changedColorKeys: string[] = [];
    for (const key of Object.keys(next.theme.colors)) {
        if ((prev.theme.colors[key] ?? "") !== (next.theme.colors[key] ?? "")) changedColorKeys.push(key);
    }
    const used = usedThemeRefs(next);
    const inertThemeKeys = changedColorKeys.filter((key) => !used.has(`colors.${key}`));

    // 逐镜头签名比对（theme 已按引用折算进元素色值）
    const changedShotIds: string[] = [];
    const prevById = new Map(prev.shots.map((shot) => [shot.shot_id, shotSignature(shot)]));
    for (const shot of next.shots) {
        const before = prevById.get(shot.shot_id);
        const beforeResolved = before ? resolveShotSignatureTheme(prev, before) : null;
        const afterResolved = resolveShotSignatureTheme(next, shotSignature(shot));
        if (!beforeResolved || !deepEqual(beforeResolved, afterResolved)) changedShotIds.push(shot.shot_id);
    }
    // 删除/新增镜头同样重截（新增镜头的 before 不存在 → 已计入 changedShotIds）
    const removedShotIds = prev.shots.map((shot) => shot.shot_id).filter((id) => !next.shots.some((shot) => shot.shot_id === id));
    for (const id of removedShotIds) changedShotIds.push(id);

    if (globalReasons.length > 0) {
        return { scope: "global", changedShotIds: next.shots.map((shot) => shot.shot_id), globalReasons, changedRatio: 1, inertThemeKeys };
    }

    if (changedShotIds.length === next.shots.length && next.shots.length > 0) {
        return { scope: "global", changedShotIds: next.shots.map((shot) => shot.shot_id), globalReasons: ["全部镜头均未命中上次渲染缓存"], changedRatio: 1, inertThemeKeys };
    }

    const totalMs = next.canvas.duration_ms || next.shots.reduce((sum, shot) => sum + Math.max(0, shot.end_ms - shot.start_ms), 0) || 1;
    const changedMs = next.shots.filter((shot) => changedShotIds.includes(shot.shot_id)).reduce((sum, shot) => sum + Math.max(0, shot.end_ms - shot.start_ms), 0);
    return { scope: changedShotIds.length === 0 ? "none" : "partial", changedShotIds, globalReasons: [], changedRatio: totalMs > 0 ? Math.min(1, changedMs / totalMs) : 1, inertThemeKeys };
}

/** 把镜头签名里的 @theme.* 引用解析为实际值后再比对（shot_key 同源口径：换肤不误伤未引用镜头）。 */
function resolveShotSignatureTheme(blueprint: MotionBlueprint, signature: unknown): unknown {
    const raw = JSON.parse(JSON.stringify(signature)) as { elements?: Array<{ color?: string; stroke?: { color?: string } }> };
    for (const element of raw.elements || []) {
        if (element.color) element.color = resolveThemeValue(blueprint, element.color);
        if (element.stroke?.color) element.stroke.color = resolveThemeValue(blueprint, element.stroke.color);
    }
    return raw;
}

/**
 * 本地公式预估（debounce 300ms 的实时报价层；权威值以 nxf plan 回填为准）。
 * T_改稿 ≈ T_全量 ×（变更镜头时长/总时长）+ ≤10s 固定开销。
 * fullRenderMs 未知（从未渲染过）时返回 null——页面显示「待首渲建立基线」。
 */
export function estimateLocalMs(fullRenderMs: number | null, impact: EditImpact): number | null {
    if (fullRenderMs === null || !Number.isFinite(fullRenderMs) || fullRenderMs <= 0) return null;
    if (impact.scope === "none") return 0;
    return Math.round(fullRenderMs * impact.changedRatio + 10_000);
}

// ---------------------------------------------------------------------------
// plan 格式化（唯一耗时数据源；省时间叙事三件套共用口径）
// ---------------------------------------------------------------------------

export function formatMs(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    if (total < 60) return `≈${total} 秒`;
    return `≈${Math.floor(total / 60)} 分 ${String(total % 60).padStart(2, "0")} 秒`;
}

/** 「重截 N 镜头 · 命中缓存 M · 预计 ≈Xs（全量 ≈Ys）」+ 节省百分比。 */
export function describePlan(plan: { recapture_count: number; reuse_count: number; estimated_ms: number; full_render_ms: number }): { summary: string; savingPct: number | null } {
    const savingPct = plan.full_render_ms > 0 ? Math.max(0, Math.round((1 - plan.estimated_ms / plan.full_render_ms) * 100)) : null;
    const summary = `重截 ${plan.recapture_count} 镜头 · 命中缓存 ${plan.reuse_count} · 预计 ${formatMs(plan.estimated_ms)}（全量 ${formatMs(plan.full_render_ms)}）`;
    return { summary, savingPct };
}

// ---------------------------------------------------------------------------
// 一键推荐补齐（degraded 三机制之二；模板数据源 = lib/omnireplica/motion-presets.ts，
// 由安智体交付，上线门槛：三模板先过 nxf preset 回归才向运营开放）
// ---------------------------------------------------------------------------

/** 该镜头的「待确认项」：degraded 非空 / 低置信 / 动效缺失。 */
export function shotNeedsPreset(shot: MotionShot): boolean {
    if (shot.degraded && shot.degraded.length > 0) return true;
    if (typeof shot.confidence === "number" && shot.confidence < LOW_CONFIDENCE) return true;
    const noEnter = !shot.enter || shot.enter.type === "none";
    const noElementMotion = shot.elements.every((element) => !element.enter || element.enter.type === "none");
    return noEnter && noElementMotion && shot.elements.length > 0;
}

/** 按镜头内容选适配模板：有物料图→产品特写；有文案→口播条；其余→氛围过场。 */
function presetForShot(shot: MotionShot): MotionPreset {
    const hasImage = shot.elements.some((element) => element.type === "image" || element.type === "sprite");
    const hasText = shot.elements.some((element) => element.type === "text" && Boolean((element.text || "").trim()));
    if (hasImage) return MOTION_PRESETS.find((preset) => preset.id === "product-closeup") || MOTION_PRESETS[1];
    if (hasText) return MOTION_PRESETS.find((preset) => preset.id === "speaker-bar") || MOTION_PRESETS[0];
    return MOTION_PRESETS.find((preset) => preset.id === "mood-transition") || MOTION_PRESETS[MOTION_PRESETS.length - 1];
}

export type PresetFillResult = {
    blueprint: MotionBlueprint;
    /** 本轮被补齐的镜头 id（供 UI 明示「补齐了哪几镜」）。 */
    filledShotIds: string[];
    /** 采用的模板 id 序列（与 filledShotIds 对齐，供 UI 展示精修说明）。 */
    usedPresetIds: string[];
};

/**
 * 一键「按推荐值补齐全部待确认项」：逐镜取适配模板的首个镜头版式
 * （enter/exit/elements），保留目标镜头的 shot_id / 时间窗 / layer。
 * 采用是人工决策——本函数只改本地蓝图，不触发任何渲染。
 */
export function applyRecommendedPresets(blueprint: MotionBlueprint): PresetFillResult {
    const filledShotIds: string[] = [];
    const usedPresetIds: string[] = [];
    const shots = blueprint.shots.map((shot) => {
        if (!shotNeedsPreset(shot)) return shot;
        const preset = presetForShot(shot);
        const templateShot = preset.shots[0];
        if (!templateShot) return shot;
        filledShotIds.push(shot.shot_id);
        usedPresetIds.push(preset.id);
        return {
            ...shot,
            enter: { type: templateShot.enter.type, duration_ms: templateShot.enter.duration_ms, ...(templateShot.enter.easing ? { easing: templateShot.enter.easing } : {}) },
            exit: { type: templateShot.exit.type, duration_ms: templateShot.exit.duration_ms },
            elements: templateShot.elements.map((element) => ({ ...element })),
            // 模板登记的低置信/动效类 degraded 视为已处理；其余（如物料缺失）保留
            degraded: (shot.degraded || []).filter((item) => !/置信|动效|元素清单/.test(item)),
        } satisfies MotionShot;
    });
    // 清掉 degraded 为空/未定义的显式键，保持 JSON 干净
    const cleaned = shots.map((shot) => {
        if (!shot.degraded || shot.degraded.length === 0) {
            const next = { ...shot } as Record<string, unknown>;
            delete next.degraded;
            return next as unknown as MotionShot;
        }
        return shot;
    });
    return { blueprint: { ...blueprint, shots: cleaned }, filledShotIds, usedPresetIds };
}

/** 预置模板自检：所有动效类型必须落在引擎枚举内（防模板错误放大成片缺陷的第一道闸）。 */
export function presetsWithinEnums(): boolean {
    const allowed = new Set<string>([...MOTION_ENTER_TYPES, ...MOTION_EXIT_TYPES, ...MOTION_TRANSITION_TYPES]);
    for (const preset of MOTION_PRESETS) {
        for (const shot of preset.shots) {
            const types = [shot.enter?.type, shot.exit?.type, ...shot.elements.map((element) => element.enter?.type), ...shot.elements.map((element) => element.exit?.type)];
            for (const type of types) if (type && !allowed.has(type)) return false;
        }
        for (const transition of preset.transitions) if (!MOTION_TRANSITION_TYPES.includes(transition.type)) return false;
    }
    return true;
}
