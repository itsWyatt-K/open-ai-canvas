import { validateStoryboardAxis, type AxisGuardOptions, type AxisGuardResult } from "./axis-guard.js";
import { filterJunkWords, type JunkwordFilterResult, type JunkwordRule } from "./junkword-filter.js";

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
    /** true = 无 hard 违规，可放行 */
    passed: boolean;
    axis?: AxisGuardResult;
    junkword?: JunkwordFilterResult;
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
    if (report.warnings.length > 0) {
        lines.push("[3] 忽略软警告放行（硬违规不可忽略）");
    }
    return lines.join("\n");
}
