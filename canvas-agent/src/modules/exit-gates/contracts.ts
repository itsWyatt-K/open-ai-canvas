import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// 影策 Exit Gate 契约层
//
// 对齐 canvas-agent/src/schemas.ts 的 zod 契约风格。
// S4（导演分镜）与 S5（提示词编译）出口门禁共用的结构化数据契约。
//
// 坐标系约定：沿用 web 端 Director 三维惯例（y 向上，x-z 为地面平面）。
// 180° 轴线校验只在地面平面 (x, z) 上进行几何计算。
// ─────────────────────────────────────────────────────────────────────────────

export type Vec3 = readonly [number, number, number];

export const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);

// 景别与运镜枚举与 web 端 DirectorShot 保持一致，保证 S4 结构化分镜
// 可直接导入 Director 场景（director-prompt-compiler.ts 消费同构数据）。
export const shotSizeSchema = z.enum([
    "extreme_wide",
    "wide",
    "full",
    "medium",
    "close_up",
    "extreme_close_up",
]);

export const cameraMoveSchema = z.enum([
    "static",
    "push_in",
    "pull_out",
    "pan_left",
    "pan_right",
    "tilt_up",
    "tilt_down",
    "orbit_left",
    "orbit_right",
    "handheld",
]);

// ── S4 出口：结构化分镜 JSON 契约（九列分镜表的结构化形态）──────────────────

export const storyboardSubjectSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    position: vec3Schema,
    note: z.string().optional(),
});

// 轴线以"场次/对话单元"为单位声明：每场戏指明对话双方主体，
// 机位合法性由程序在同一轴线上判定。
export const storyboardSceneSchema = z.object({
    sceneId: z.string().min(1),
    axisSubjectIds: z.tuple([z.string().min(1), z.string().min(1)]),
    description: z.string().optional(),
});

export const storyboardShotSchema = z.object({
    shotId: z.string().min(1),
    sceneId: z.string().min(1),
    clipId: z.string().optional(),
    durationSec: z.number().positive().optional(),
    shotSize: shotSizeSchema.optional(),
    cameraMove: cameraMoveSchema.optional(),
    cameraPosition: vec3Schema,
    description: z.string().optional(),
    sound: z.string().optional(),
    note: z.string().optional(),
    narrativePurpose: z.string().optional(),
});

export const storyboardSchema = z.object({
    title: z.string().optional(),
    subjects: z.array(storyboardSubjectSchema).min(1),
    scenes: z.array(storyboardSceneSchema).min(1),
    shots: z.array(storyboardShotSchema).min(1),
});

export type Storyboard = z.infer<typeof storyboardSchema>;
export type StoryboardScene = z.infer<typeof storyboardSceneSchema>;
export type StoryboardShot = z.infer<typeof storyboardShotSchema>;

// ── L0 规则对象：供 Bundle / SKILL.md 注入的机器可读负面清单 ─────────────────
// 与 rules/guardrail-rules.yaml 同构；TS 侧是可执行形式，YAML 侧是
// 注入提示词上下文的声明形式。两份文件修改时必须同步（见 README）。

export const guardrailRuleActionSchema = z.enum(["reject", "autofix", "strip", "warn"]);

export const guardrailRuleSchema = z.object({
    rule_id: z.string().min(1),
    severity: z.enum(["hard", "soft"]),
    scope: z.enum(["S4_storyboard", "S5_prompt"]),
    condition: z.string().min(1),
    action: guardrailRuleActionSchema,
    message: z.string().min(1),
});

export type GuardrailRule = z.infer<typeof guardrailRuleSchema>;
