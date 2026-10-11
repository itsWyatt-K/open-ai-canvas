import type { GoldenTask, PairwiseJudge, PairwiseVerdict, PipelineArtifacts, SubjectiveDimension, SubjectiveResult } from "./contracts.js";

// ─────────────────────────────────────────────────────────────────────────────
// 配对评审层：锚点式 rubric + 位置轮换对消
//
// 对每个主观维度执行两次比较：A/B 与 B/A。两次结论一致才判胜负，不一致记
// 平局。效果：一个完全位置偏置的裁判（永远选第一个参数）产出全部平局而非
// 错误胜负——偏置被对消，而真信号（裁判对内容稳定的偏好）保留。
//
// 裁判跨轮次轮换：同一次比较内 judge 固定，跨棘轮轮次更换 judgeId，防单一
// 裁判的系统性口味污染棘轮。
// ─────────────────────────────────────────────────────────────────────────────

export type DimVerdict = "new_wins" | "old_wins" | "tie";

export function reconcile(roundAB: PairwiseVerdict, roundBA: PairwiseVerdict): DimVerdict {
    // roundAB: compare(new, old) —— a_better 表示 new 胜
    // roundBA: compare(old, new) —— b_better 表示 new 胜
    const newWinsAB = roundAB === "a_better";
    const newWinsBA = roundBA === "b_better";
    const oldWinsAB = roundAB === "b_better";
    const oldWinsBA = roundBA === "a_better";
    if (newWinsAB && newWinsBA) return "new_wins";
    if (oldWinsAB && oldWinsBA) return "old_wins";
    return "tie";
}

/** 双序执行单个维度的配对评审（位置轮换内建）。 */
export async function judgeDimension(
    judge: PairwiseJudge,
    dimension: SubjectiveDimension,
    task: GoldenTask,
    artifactsNew: PipelineArtifacts,
    artifactsOld: PipelineArtifacts,
): Promise<DimVerdict> {
    const roundAB = await judge.compare(dimension, task, artifactsNew, artifactsOld);
    const roundBA = await judge.compare(dimension, task, artifactsOld, artifactsNew);
    return reconcile(roundAB, roundBA);
}

export function toSubjectiveResult(dimension: SubjectiveDimension, verdict: DimVerdict): SubjectiveResult {
    return {
        dimId: dimension.dimId,
        name: dimension.name,
        weight: dimension.weight,
        verdict,
    };
}

// ── Mock 裁判：测试与本地演示用 ─────────────────────────────────────────────

/**
 * 确定性 Mock 裁判。
 * - bias="position"：永远选第一个参数——用于验证位置轮换对消（应产出全平局）。
 * - bias="longer"：永远选 compiledPrompts 总字数更多的一方——稳定的真信号，
 *   用于验证双序一致时产出明确胜负。
 */
export class MockPairwiseJudge implements PairwiseJudge {
    readonly judgeId: string;
    private readonly bias: "position" | "longer";

    constructor(judgeId = "mock-judge", bias: "position" | "longer" = "longer") {
        this.judgeId = judgeId;
        this.bias = bias;
    }

    async compare(
        _dimension: SubjectiveDimension,
        _task: GoldenTask,
        artifactsA: PipelineArtifacts,
        artifactsB: PipelineArtifacts,
    ): Promise<PairwiseVerdict> {
        if (this.bias === "position") return "a_better";
        const lenA = (artifactsA.compiledPrompts ?? []).join("").length;
        const lenB = (artifactsB.compiledPrompts ?? []).join("").length;
        if (lenA > lenB) return "a_better";
        if (lenB > lenA) return "b_better";
        return "tie";
    }
}

// ── GLM 裁判接入桩：在影策本地环境实现 ──────────────────────────────────────
//
// 接入方式（示意，需在 canvas-agent 侧实现实际模型调用）：
//
//   export class GlmPairwiseJudge implements PairwiseJudge {
//     readonly judgeId = process.env.GLM_JUDGE_ID ?? "glm-4v-round-1";
//     async compare(dim, task, a, b) {
//       const prompt = [
//         "你是影视制作质检裁判。只依据下方锚点检查点判断哪份产物更好：",
//         `维度：${dim.name}`,
//         `锚点：${dim.anchors.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
//         `任务背景：${task.title}：${task.brief.slice(0, 120)}`,
//         "产物A：<序列化 artifactsA>",
//         "产物B：<序列化 artifactsB>",
//         "只输出 A / B / TIE 三选一。",
//       ].join("\n\n");
//       // 调用 GLM-4V / 文本模型，解析 A/B/TIE
//     }
//   }
//
// 注意：锚点检查点必须原样进入裁判提示词——无锚点的评分噪声极大。
