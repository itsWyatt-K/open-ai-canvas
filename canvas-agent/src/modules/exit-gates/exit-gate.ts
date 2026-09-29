import { validateStoryboardAxis, type AxisGuardOptions, type AxisGuardResult } from "./axis-guard.js";
import {
    defaultExitGateRules,
    filterJunkWords,
    type JunkwordFilterResult,
    type JunkwordRule,
} from "./junkword-filter.js";
import {
    createReviewOnlySafetyJudge,
    summarizeSafetyVerdicts,
    type SafetyJudge,
    type SafetySummary,
    type SafetyVerdict,
} from "./safety-judge.js";

// ─────────────────────────────────────────────────────────────────────────────
// Exit Gate 编排层：S4 / S5 出口门禁统一入口 + ask_user 载荷生成
//
// 处置路由（对齐评审回复书第三节"违规处置路由"）：
//   hard 违规 → 阻断，附自动修复提案 → 走 ask_user 让人确认；
//   soft 警告 → 放行但入审计报告；
//   门禁本体保持全自动，人机协同点只放在判断分歧处。
// ─────────────────────────────────────────────────────────────────────────────

export type ExitGateStage = "S4_storyboard" | "S5_prompt";

export interface ExitGateInput {
    /** S4 出口：结构化分镜 JSON（storyboardSchema 契约） */
    storyboard?: unknown;
    /** S5 出口：编译后的提示词全文 */
    prompt?: string;
    junkwordRules?: ReadonlyArray<JunkwordRule>;
    axisOptions?: AxisGuardOptions;
    /**
     * 安全域判定器（第 2 层）。缺省 = reviewOnly：候选全部原样转人工。
     * 仅在 runExitGateAsync 中生效（同步版 runExitGate 不碰模型）。
     */
    safetyJudge?: SafetyJudge;
}

export interface GateProposal {
    proposalId: string;
    kind: "mirror_camera" | "strip_junkwords";
    target: string;
    detail: string;
    before: string;
    after: string;
}

export interface ExitGateReport {
    stages: ExitGateStage[];
    /** true = 无 hard 违规、且无待人工处置的安全候选，可放行 */
    passed: boolean;
    axis?: AxisGuardResult;
    junkword?: JunkwordFilterResult;
    /** 安全域第 2 层判定汇总（仅 runExitGateAsync 产出） */
    safety?: SafetySummary;
    safetyVerdicts?: SafetyVerdict[];
    blockers: string[];
    warnings: string[];
    autofixProposals: GateProposal[];
}

export function runExitGate(input: ExitGateInput): ExitGateReport {
    const stages: ExitGateStage[] = [];
    const blockers: string[] = [];
    const warnings: string[] = [];
    const proposals: GateProposal[] = [];

    let axis: AxisGuardResult | undefined;
    let junkword: JunkwordFilterResult | undefined;

    if (input.storyboard !== undefined) {
        stages.push("S4_storyboard");
        axis = validateStoryboardAxis(input.storyboard, input.axisOptions ?? {});
        for (const issue of axis.issues) {
            const line = `[${issue.type}] ${issue.detail}`;
            if (issue.severity === "hard") blockers.push(line);
            else warnings.push(line);
        }
        for (const fix of axis.autofixProposals) {
            proposals.push({
                proposalId: fix.proposalId,
                kind: "mirror_camera",
                target: `镜头 ${fix.shotId}（场次 ${fix.sceneId}）`,
                detail: fix.note,
                before: `(${fix.currentCamera.map((value) => Number(value.toFixed(3))).join(", ")})`,
                after: `(${fix.suggestedCamera.map((value) => Number(value.toFixed(3))).join(", ")})`,
            });
        }
    }

    if (typeof input.prompt === "string") {
        stages.push("S5_prompt");
        junkword = filterJunkWords(input.prompt, input.junkwordRules);
        for (const reason of junkword.rejectReasons) {
            blockers.push(`[aspect-ratio-conflict] ${reason}`);
        }
        for (const hit of junkword.hits) {
            if (hit.action === "warn") {
                warnings.push(`[${hit.ruleId}] ${hit.reason}`);
            }
        }
        if (junkword.changed && junkword.stats.stripped > 0) {
            const strippedWords = junkword.hits
                .filter((hit) => hit.action === "strip")
                .map((hit) => hit.matchedText);
            proposals.push({
                proposalId: "strip-junkwords",
                kind: "strip_junkwords",
                target: "S5 编译产物",
                detail: `已确定性剥离 ${junkword.stats.stripped} 处垃圾词：${[...new Set(strippedWords)].join("、")}；剥离后文本见 after。`,
                before: input.prompt,
                after: junkword.cleanedPrompt,
            });
        }
    }

    return {
        stages,
        passed: blockers.length === 0,
        axis,
        junkword,
        blockers,
        warnings,
        autofixProposals: proposals,
    };
}

/**
 * 全量异步门禁（B2 三层完整版）：
 * 确定性层（质量域剥离 / 画幅冲突 / 竞品软警告 / 安全域初筛）
 *   → 第 2 层 SafetyJudge 语义判定
 *   → 第 3 层：block/review 一律进入人工处置队列，**不静默放行也不静默硬拦**。
 *
 * 与同步版差异：默认规则集为三域全量（defaultExitGateRules），且会产生安全判定结果。
 */
export async function runExitGateAsync(input: ExitGateInput): Promise<ExitGateReport> {
    const base = runExitGate({
        ...input,
        junkwordRules: input.junkwordRules ?? defaultExitGateRules,
    });

    const candidates = base.junkword?.safetyCandidates ?? [];
    if (candidates.length === 0) return base;

    const judge = input.safetyJudge ?? createReviewOnlySafetyJudge();
    const verdicts = await judge.judge(candidates, { prompt: input.prompt ?? "" });
    const summary = summarizeSafetyVerdicts(verdicts);

    const blockers = [...base.blockers];
    if (summary.humanQueue.length > 0) {
        blockers.push(
            `[safety-review] 安全域待人工处置 ${summary.humanQueue.length} 项` +
                `（已定 ${summary.blocked} 项判定违规 / ${summary.review} 项证据不足，` +
                `判定器 ${summary.judgeIds.join(",")}${summary.degraded ? "，含降级结果" : ""}）`,
        );
    }
    for (const verdict of summary.humanQueue) {
        if (verdict.judgement === "block") {
            blockers.push(
                `[safety-block] 「${verdict.candidate.matchedText}」：${verdict.rationale}（判定器 ${verdict.judgeId}，置信度 ${verdict.confidence.toFixed(2)}）`,
            );
        } else {
            base.warnings.push(
                `[safety-review] 「${verdict.candidate.matchedText}」：${verdict.rationale}（判定器 ${verdict.judgeId}）`,
            );
        }
    }

    return {
        ...base,
        passed: blockers.length === 0,
        safety: summary,
        safetyVerdicts: verdicts,
        blockers,
    };
}

function truncate(text: string, maxLines: number): string {
    const lines = text.split("\n");
    if (lines.length <= maxLines) return text;
    return `${lines.slice(0, maxLines).join("\n")}\n…（其余 ${lines.length - maxLines} 行略）`;
}

/**
 * 生成 ask_user 载荷：把门禁结果渲染成一段人能直接决策的中文消息。
 * 选项设计：应用全部修复 / 仅放行软警告 / 人工修改后重跑。
 */
export function formatAskUserMessage(report: ExitGateReport, promptPreviewLines = 12): string {
    if (report.passed) {
        const warnLines = report.warnings.length > 0 ? `\n软警告 ${report.warnings.length} 项（已放行，见审计报告）` : "";
        return `【出口门禁通过】${report.stages.join(" + ")} 无硬违规。${warnLines}`;
    }

    const lines: string[] = [];
    lines.push(`【出口门禁拦截】${report.stages.join(" + ")}`);
    lines.push("");
    lines.push(`硬违规 ${report.blockers.length} 项：`);
    report.blockers.forEach((blocker, index) => {
        lines.push(`${index + 1}. ${blocker}`);
    });
    if (report.autofixProposals.length > 0) {
        lines.push("");
        lines.push(`自动修复提案 ${report.autofixProposals.length} 项：`);
        report.autofixProposals.forEach((proposal, index) => {
            lines.push(`${index + 1}. [${proposal.kind}] ${proposal.target}`);
            lines.push(`   ${proposal.detail}`);
            if (proposal.kind === "mirror_camera") {
                lines.push(`   机位 ${proposal.before} → ${proposal.after}`);
            } else {
                lines.push(`   修复后提示词预览：`);
                lines.push(truncate(proposal.after, promptPreviewLines)
                    .split("\n")
                    .map((line) => `   | ${line}`)
                    .join("\n"));
            }
        });
    }
    const hasHumanOption = report.safety !== undefined || report.warnings.length > 0;

    // 安全域必须显式列出每一条候选：让人一眼看到"为什么被拦 + 谁判的 + 依据"。
    if (report.safety && report.safety.humanQueue.length > 0) {
        lines.push("");
        lines.push(`安全域待人工处置 ${report.safety.humanQueue.length} 项（词表初筛仅候选，处置权在你）：`);
        report.safety.humanQueue.forEach((verdict, index) => {
            const tag = verdict.judgement === "block" ? "判定违规" : "证据不足";
            lines.push(
                `${index + 1}. [${tag}] 「${verdict.candidate.matchedText}」（规则 ${verdict.candidate.ruleId}）`,
            );
            lines.push(
                `   ${verdict.rationale}${verdict.modelJudged ? `｜置信度 ${verdict.confidence.toFixed(2)}` : "｜未走模型，保守转人工"}`,
            );
            if (verdict.candidate.suggestion) {
                lines.push(`   建议：${verdict.candidate.suggestion}`);
            }
        });
        if (report.safety.degraded) {
            lines.push("");
            lines.push("注意：本轮含未走模型的降级判定，结果不可作为安全策略有效性证据，仅作线索。");
        }
    }
    if (report.warnings.length > 0) {
        lines.push("");
        lines.push(`软警告 ${report.warnings.length} 项：`);
        report.warnings.slice(0, 5).forEach((warning) => {
            lines.push(`- ${warning}`);
        });
    }
    lines.push("");
    lines.push("请选择处置方式（回复序号）：");
    lines.push("[1] 应用全部自动修复并重跑门禁");
    lines.push("[2] 人工修改后重新提交");
    if (hasHumanOption) {
        lines.push("[3] 确认无风险，人工放行（软警告与安全候选一并放行，硬违规不可忽略）");
    }
    return lines.join("\n");
}
