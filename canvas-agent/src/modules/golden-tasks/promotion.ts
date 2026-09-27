import type {
    GoldenTask, PairwiseJudge, PipelineExecutor, PipelineResult,
    PromotionConfig, PromotionReport, SubjectiveResult, TaskComparison, TaskEvaluation,
} from "./contracts.js";
import { evaluateTask } from "./deterministic-checks.js";
import { judgeDimension, toSubjectiveResult } from "./judge.js";

// ─────────────────────────────────────────────────────────────────────────────
// 评分与晋级决策（棘轮锚点）
//
// 任务级裁决规则（确定性优先原则）：
//   detDelta = detPointsNew - detPointsOld
//   detDelta ≠ 0 → 按其符号裁决（程序可验证层说了算）；
//   detDelta = 0 → 主观配对净胜裁决（主观只打破程序层的平局）。
//
// 晋级规则：
//   1. 硬回归一票否决（新版在任何任务上丢了旧版通过的阻断性检查）；
//   2. 确定性总分不得下降；
//   3. 净胜场 ≥ netWinThreshold，或净胜 1 场且确定性分差 ≥ detPointSubstitute。
//   平局不计。符号检验 p 值仅作报告注解（增益稀疏是正常状态，不作门禁）。
// ─────────────────────────────────────────────────────────────────────────────

export const defaultPromotionConfig: PromotionConfig = {
    netWinThreshold: 2,
    detPointSubstitute: 5,
    significanceAlpha: 0.10,
    judgeId: "default",
};

export async function compareTask(
    task: GoldenTask,
    executor: PipelineExecutor,
    judge: PairwiseJudge,
): Promise<TaskComparison> {
    const [resultOld, resultNew] = await Promise.all([
        executor.run(task, "old"),
        executor.run(task, "new"),
    ]);

    const oldEvaluation = toEvaluation(task, resultOld);
    const newEvaluation = toEvaluation(task, resultNew);

    const subjectives: SubjectiveResult[] = [];
    if (resultOld.status === "completed" && resultNew.status === "completed") {
        for (const dim of task.subjectiveDimensions) {
            const verdict = await judgeDimension(judge, dim, task, resultNew.artifacts, resultOld.artifacts);
            subjectives.push(toSubjectiveResult(dim, verdict));
        }
    }

    const subjectiveNet = subjectives.reduce((sum, s) => sum + (s.verdict === "new_wins" ? s.weight : s.verdict === "old_wins" ? -s.weight : 0), 0);
    const detDelta = newEvaluation.detPoints - oldEvaluation.detPoints;

    let verdict: TaskComparison["verdict"];
    if (detDelta > 0) verdict = "new_wins";
    else if (detDelta < 0) verdict = "old_wins";
    else if (subjectiveNet > 0) verdict = "new_wins";
    else if (subjectiveNet < 0) verdict = "old_wins";
    else verdict = "tie";

    return {
        taskId: task.taskId,
        title: task.title,
        sentinel: task.sentinel,
        oldEvaluation,
        newEvaluation,
        subjectives,
        subjectiveNet,
        detDelta,
        verdict,
    };
}

function toEvaluation(task: GoldenTask, result: PipelineResult): TaskEvaluation {
    const { checks, detPoints, detMax, hardFailures } = evaluateTask(task, result);
    return {
        taskId: task.taskId,
        status: result.status,
        checks,
        detPoints,
        detMax,
        hardFailures,
    };
}

// ── 聚合与决策 ───────────────────────────────────────────────────────────────

export function decidePromotion(comparisons: TaskComparison[], config: PromotionConfig): PromotionReport {
    const winsNew = comparisons.filter((c) => c.verdict === "new_wins").length;
    const winsOld = comparisons.filter((c) => c.verdict === "old_wins").length;
    const ties = comparisons.filter((c) => c.verdict === "tie").length;

    // 硬回归：新版在旧版通过的阻断性检查上失败。
    const hardRegressions: PromotionReport["hardRegressions"] = [];
    for (const comparison of comparisons) {
        const oldPass = new Set(comparison.oldEvaluation.checks.filter((c) => c.passed).map((c) => c.checkId));
        for (const check of comparison.newEvaluation.checks) {
            if (!check.passed && check.blocking && oldPass.has(check.checkId)) {
                hardRegressions.push({
                    taskId: comparison.taskId,
                    checkId: check.checkId,
                    detail: check.detail,
                });
            }
        }
    }

    const detPointsOld = comparisons.reduce((sum, c) => sum + c.oldEvaluation.detPoints, 0);
    const detPointsNew = comparisons.reduce((sum, c) => sum + c.newEvaluation.detPoints, 0);
    const detMaxTotal = comparisons.reduce((sum, c) => sum + c.oldEvaluation.detMax, 0);

    const netWins = winsNew - winsOld;
    const decisiveCount = winsNew + winsOld;
    const signTestP = decisiveCount > 0 ? binomialTail(winsNew, decisiveCount) : null;

    let decision: PromotionReport["decision"];
    let rationale: string;
    if (hardRegressions.length > 0) {
        decision = "keep_old";
        rationale = `一票否决：新版在 ${hardRegressions.length} 处阻断性检查上出现硬回归（${hardRegressions.map((r) => `${r.taskId}/${r.checkId}`).join("、")}）。棘轮松一扣即退化为自恋打分机，任何硬回归都不放行。`;
    } else if (detPointsNew < detPointsOld) {
        decision = "keep_old";
        rationale = `确定性总分下降（旧 ${detPointsOld} → 新 ${detPointsNew} / ${detMaxTotal}）：程序可验证层的绝对质量不允许净损失。`;
    } else if (netWins >= config.netWinThreshold || (netWins >= 1 && detPointsNew - detPointsOld >= config.detPointSubstitute)) {
        decision = "promote";
        rationale = `净胜 ${netWins} 场（${winsNew} 胜 / ${winsOld} 负 / ${ties} 平），确定性总分 ${detPointsOld} → ${detPointsNew}，无硬回归。${significanceNote(signTestP, config)}`;
    } else if (netWins <= 0 && detPointsNew === detPointsOld) {
        decision = "inconclusive";
        rationale = `净胜 ${netWins} 场且确定性总分持平。增益稀疏是技能自进化的正常状态（SkillOpt 结论），本轮维持旧版，下轮再战。`;
    } else {
        decision = "inconclusive";
        rationale = `净胜 ${netWins} 场，未达晋级门槛（${config.netWinThreshold}），确定性分差 ${detPointsNew - detPointsOld} 未达替代门槛（${config.detPointSubstitute}）。证据不足，维持旧版。`;
    }

    return {
        config,
        judgeId: config.judgeId,
        taskCount: comparisons.length,
        winsNew,
        winsOld,
        ties,
        hardRegressions,
        detPointsOld,
        detPointsNew,
        detMaxTotal,
        decisiveCount,
        signTestP,
        comparisons,
        decision,
        rationale,
    };
}

function significanceNote(p: number | null, config: PromotionConfig): string {
    if (p === null) return "无决定性任务，无统计注解。";
    return p <= config.significanceAlpha
        ? `符号检验 p=${p.toFixed(3)} ≤ ${config.significanceAlpha}，胜负倾向具统计显著性（注解项，非门禁）。`
        : `符号检验 p=${p.toFixed(3)} > ${config.significanceAlpha}，显著性不足，以工程门槛为准（注解项，非门禁）。`;
}

/** 精确二项尾概率 P(X ≥ k | n, p=0.5)（符号检验单侧）。 */
export function binomialTail(k: number, n: number): number {
    if (k <= 0) return 1;
    if (k > n) return 0;
    // C(n, i) 递推 + 累加，n ≤ 任务数，无溢出风险
    let c = 1;
    let sum = 0;
    for (let i = 0; i <= n; i++) {
        if (i > 0) c = (c * (n - i + 1)) / i;
        if (i >= k) sum += c;
    }
    return sum / 2 ** n;
}

// ── 报告渲染（中文审计文本） ─────────────────────────────────────────────────

export function renderPromotionReport(report: PromotionReport): string {
    const decisionLabel = report.decision === "promote" ? "推荐晋级" : report.decision === "keep_old" ? "维持旧版（否决）" : "证据不足，维持旧版";
    const lines: string[] = [];
    lines.push(`【达尔文棘轮 · 下游任务回归报告】裁判：${report.judgeId}`);
    lines.push(`结论：${decisionLabel}`);
    lines.push(`任务集：${report.taskCount} 条 | 新版 ${report.winsNew} 胜 / 旧版 ${report.winsOld} 胜 / ${report.ties} 平`);
    lines.push(`确定性总分：旧 ${report.detPointsOld} → 新 ${report.detPointsNew}（满分 ${report.detMaxTotal}）`);
    if (report.signTestP !== null) {
        lines.push(`符号检验：p=${report.signTestP.toFixed(3)}（决定性任务 ${report.decisiveCount} 条）`);
    }
    lines.push("");
    lines.push(`理由：${report.rationale}`);
    if (report.hardRegressions.length > 0) {
        lines.push("");
        lines.push(`硬回归清单（一票否决项）：`);
        for (const regression of report.hardRegressions) {
            lines.push(`- ${regression.taskId} / ${regression.checkId}：${regression.detail}`);
        }
    }
    lines.push("");
    lines.push("任务明细：");
    for (const comparison of report.comparisons) {
        const verdictLabel = comparison.verdict === "new_wins" ? "新版胜" : comparison.verdict === "old_wins" ? "旧版胜" : "平";
        const sentinelLabel = comparison.sentinel ? " [哨兵]" : "";
        lines.push(`- ${comparison.taskId}${sentinelLabel} ${comparison.title}：${verdictLabel}（确定性 ${comparison.oldEvaluation.detPoints}→${comparison.newEvaluation.detPoints}，主观净 ${comparison.subjectiveNet > 0 ? "+" : ""}${comparison.subjectiveNet}）`);
        for (const failed of comparison.newEvaluation.hardFailures) {
            lines.push(`    ⚠ ${failed}`);
        }
    }
    lines.push("");
    lines.push("处置建议：promote → 新版 Bundle 影子部署后切换工位挂载；keep_old / inconclusive → 旧版不动，候选进入下一轮变异。");
    return lines.join("\n");
}
