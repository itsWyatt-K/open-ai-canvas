import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// 影策金标任务集契约层（P1）
//
// 目的：把达尔文 2.0 的终审判据从\u201c技能文本盲审分\u201d锚定到\u201c下游任务回归
// 增益\u201d（回应 SkillLens 46.4% 裁判失效率警示）。技能好不好，看它挂上工位
// 后真实任务产出是否变好。
//
// 设计三原则：
//   1. 可判定的下沉为程序校验（确定性检查），主观只裁决真正的判断分歧处；
//   2. 配对评审带位置轮换对消——一个完全位置偏置的裁判产出全部平局而非
//      错误胜负（噪声抑制不能挽救无效信号源，但对消能废掉偏置）；
//   3. 金标集含哨兵负向任务：管线对诱导违规的输入要么拒绝、要么干净处理，
//      让门禁覆盖度本身成为被测对象。
// ─────────────────────────────────────────────────────────────────────────────

// ── 确定性检查（程序校验层，零 LLM） ────────────────────────────────────────

export const deterministicCheckSchema = z.discriminatedUnion("type", [
    z.object({
        checkId: z.string().min(1),
        type: z.literal("schema_valid"),
        blocking: z.boolean().default(true),
        points: z.number().int().min(1).default(2),
        note: z.string().optional(),
    }),
    z.object({
        checkId: z.string().min(1),
        type: z.literal("axis_guard"),
        blocking: z.boolean().default(true),
        points: z.number().int().min(1).default(2),
        note: z.string().optional(),
    }),
    z.object({
        checkId: z.string().min(1),
        type: z.literal("junkword_free"),
        blocking: z.boolean().default(true),
        points: z.number().int().min(1).default(1),
        note: z.string().optional(),
    }),
    z.object({
        checkId: z.string().min(1),
        type: z.literal("beat_percentage"),
        beat: z.string().min(1),
        minPct: z.number().min(0).max(100),
        maxPct: z.number().min(0).max(100),
        blocking: z.boolean().default(false),
        points: z.number().int().min(1).default(1),
        note: z.string().optional(),
    }),
    z.object({
        checkId: z.string().min(1),
        type: z.literal("duration_bounds"),
        minSec: z.number().min(0),
        maxSec: z.number().min(0),
        blocking: z.boolean().default(true),
        points: z.number().int().min(1).default(1),
        note: z.string().optional(),
    }),
    z.object({
        checkId: z.string().min(1),
        type: z.literal("clip_count_bounds"),
        min: z.number().int().min(0),
        max: z.number().int().min(0),
        scope: z.enum(["shots", "clips", "prompts"]).default("clips"),
        blocking: z.boolean().default(false),
        points: z.number().int().min(1).default(1),
        note: z.string().optional(),
    }),
    z.object({
        checkId: z.string().min(1),
        type: z.literal("ratio_consistent"),
        expected: z.string().optional(),
        blocking: z.boolean().default(true),
        points: z.number().int().min(1).default(1),
        note: z.string().optional(),
    }),
    z.object({
        checkId: z.string().min(1),
        type: z.literal("required_pattern"),
        pattern: z.string().min(1),
        target: z.enum(["scriptText", "promptsJoined", "storyboardRaw"]).default("promptsJoined"),
        blocking: z.boolean().default(false),
        points: z.number().int().min(1).default(1),
        note: z.string().optional(),
    }),
    z.object({
        checkId: z.string().min(1),
        type: z.literal("forbidden_pattern"),
        pattern: z.string().min(1),
        target: z.enum(["scriptText", "promptsJoined", "storyboardRaw"]).default("promptsJoined"),
        blocking: z.boolean().default(true),
        points: z.number().int().min(1).default(1),
        note: z.string().optional(),
    }),
    z.object({
        checkId: z.string().min(1),
        type: z.literal("field_present"),
        path: z.string().min(1),
        blocking: z.boolean().default(false),
        points: z.number().int().min(1).default(1),
        note: z.string().optional(),
    }),
    z.object({
        checkId: z.string().min(1),
        type: z.literal("word_count_bounds"),
        target: z.enum(["scriptText", "promptsJoined"]).default("promptsJoined"),
        minChars: z.number().int().min(0),
        maxChars: z.number().int().min(0),
        blocking: z.boolean().default(false),
        points: z.number().int().min(1).default(1),
        note: z.string().optional(),
    }),
]);

export type DeterministicCheck = z.infer<typeof deterministicCheckSchema>;

// ── 主观维度（配对评审层，锚点式 rubric） ────────────────────────────────────

export const subjectiveDimensionSchema = z.object({
    dimId: z.string().min(1),
    name: z.string().min(1),
    weight: z.number().min(0.5).default(1),
    anchors: z.array(z.string().min(1)).min(2),
});

export type SubjectiveDimension = z.infer<typeof subjectiveDimensionSchema>;

// ── 金标任务 ─────────────────────────────────────────────────────────────────

export const goldenTaskSchema = z.object({
    taskId: z.string().regex(/^GT-[A-Z]\d{2}$/),
    title: z.string().min(1),
    tag: z.enum(["drama", "social", "ecommerce", "creative", "others", "sentinel"]),
    targetSkills: z.array(z.string().min(1)).min(1),
    sentinel: z.boolean().default(false),
    brief: z.string().min(10),
    constraints: z.object({
        ratio: z.string().optional(),
        durationSec: z.tuple([z.number(), z.number()]).optional(),
        totalDurationSec: z.tuple([z.number(), z.number()]).optional(),
        style: z.string().optional(),
        language: z.enum(["zh", "en", "bilingual"]).optional(),
        seed: z.number().optional(),
        targetModels: z.array(z.string()).optional(),
    }).default({}),
    expectedArtifacts: z.array(
        z.enum(["scriptText", "beatSheet", "storyboard", "compiledPrompts", "assetList", "stageLog"]),
    ).min(1),
    checks: z.array(deterministicCheckSchema).min(1),
    subjectiveDimensions: z.array(subjectiveDimensionSchema).default([]),
    notes: z.string().optional(),
});

export type GoldenTask = z.infer<typeof goldenTaskSchema>;

// ── 管线产物（执行器返回） ───────────────────────────────────────────────────

export const beatSheetSchema = z.object({
    totalUnits: z.number().int().min(1),
    beats: z.array(z.object({
        beatName: z.string().min(1),
        atUnit: z.number().min(0),
    })).min(1),
});

export type BeatSheet = z.infer<typeof beatSheetSchema>;

export const pipelineArtifactsSchema = z.object({
    scriptText: z.string().optional(),
    beatSheet: beatSheetSchema.optional(),
    storyboard: z.unknown().optional(),
    compiledPrompts: z.array(z.string()).optional(),
    assetList: z.array(z.string()).optional(),
    stageLog: z.array(z.string()).default([]),
});

export type PipelineArtifacts = z.infer<typeof pipelineArtifactsSchema>;

/** 执行结果：正常完成，或被门禁拦截（哨兵任务上的合法结局）。 */
export const pipelineResultSchema = z.union([
    z.object({ status: z.literal("completed"), artifacts: pipelineArtifactsSchema }),
    z.object({ status: z.literal("blocked"), stage: z.string().min(1), reason: z.string().min(1) }),
]);

export type PipelineResult = z.infer<typeof pipelineResultSchema>;

export interface PipelineExecutor {
    executorId: string;
    run(task: GoldenTask, bundleVersion: "old" | "new"): Promise<PipelineResult>;
}

// ── 配对裁判 ─────────────────────────────────────────────────────────────────

export type PairwiseVerdict = "a_better" | "b_better" | "tie";

export interface PairwiseJudge {
    judgeId: string;
    compare(
        dimension: SubjectiveDimension,
        task: GoldenTask,
        artifactsA: PipelineArtifacts,
        artifactsB: PipelineArtifacts,
    ): Promise<PairwiseVerdict>;
}

// ── 评测报告 ─────────────────────────────────────────────────────────────────

export interface CheckResult {
    checkId: string;
    type: string;
    passed: boolean;
    blocking: boolean;
    points: number;
    detail: string;
}

export interface TaskEvaluation {
    taskId: string;
    status: "completed" | "blocked";
    checks: CheckResult[];
    detPoints: number;
    detMax: number;
    hardFailures: string[];
}

export interface SubjectiveResult {
    dimId: string;
    name: string;
    weight: number;
    verdict: "new_wins" | "old_wins" | "tie";
}

export interface TaskComparison {
    taskId: string;
    title: string;
    sentinel: boolean;
    oldEvaluation: TaskEvaluation;
    newEvaluation: TaskEvaluation;
    subjectives: SubjectiveResult[];
    subjectiveNet: number;
    detDelta: number;
    verdict: "new_wins" | "old_wins" | "tie";
}

export interface PromotionConfig {
    /** 净胜场数晋级门槛（默认 2） */
    netWinThreshold: number;
    /** 确定性分差替代门槛：净胜 1 场且确定性分差 ≥ 该值亦可晋级 */
    detPointSubstitute: number;
    /** 符号检验显著水平（仅作注解，不作门禁） */
    significanceAlpha: number;
    /** 本轮裁判标识（跨棘轮轮次轮换记录） */
    judgeId: string;
}

export interface PromotionReport {
    config: PromotionConfig;
    judgeId: string;
    taskCount: number;
    winsNew: number;
    winsOld: number;
    ties: number;
    hardRegressions: Array<{ taskId: string; checkId: string; detail: string }>;
    detPointsOld: number;
    detPointsNew: number;
    detMaxTotal: number;
    decisiveCount: number;
    signTestP: number | null;
    comparisons: TaskComparison[];
    decision: "promote" | "keep_old" | "inconclusive";
    rationale: string;
}
