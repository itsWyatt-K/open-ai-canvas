import {
    runExitGate,
    runExitGateAsync,
    formatAskUserMessage,
    type ExitGateInput,
    type ExitGateReport,
} from "./exit-gate.js";
import type { JunkwordRule } from "./junkword-filter.js";
import type { AxisGuardOptions } from "./axis-guard.js";
import type { SafetyJudge } from "./safety-judge.js";

// ─────────────────────────────────────────────────────────────────────────────
// 影策工位挂点接线层（S4 / S5 出口门禁 → canvas-agent 提交通道）
//
// 对应评审回复书 6.3 五步接入之三、四、五：
//   - S4 挂点：分镜产出 JSON 后调用轴线校验（web 端 Director 流程另走
//     validateDirectorAxis，见 director-adapter.ts）；
//   - S5 挂点：编译提示词产出后 / 提交前调用禁词过滤；
//   - 拦截消息经 formatAskUserMessage 生成后走既有 ask_user 通道。
//
// 契约：通过 → 返回 ExitGateReport（软警告入报告不阻断）；
//       硬违规 → 抛 GateBlockedError，其 message 即 ask_user 载荷。
// ─────────────────────────────────────────────────────────────────────────────

export class GateBlockedError extends Error {
    readonly report: ExitGateReport;
    readonly askUserMessage: string;

    constructor(report: ExitGateReport) {
        super(formatAskUserMessage(report));
        this.name = "GateBlockedError";
        this.report = report;
        this.askUserMessage = formatAskUserMessage(report);
    }
}

/** S4 挂点：结构化分镜 JSON 出口门禁（180° 轴线几何校验 + schema 契约）。 */
export function gateStoryboard(storyboard: unknown, axisOptions?: AxisGuardOptions): ExitGateReport {
    const report = runExitGate({ storyboard, axisOptions });
    if (!report.passed) throw new GateBlockedError(report);
    return report;
}

/** S5 挂点：编译提示词出口门禁（禁词确定性过滤 + 画幅冲突硬阻断）。 */
export function gateCompiledPrompt(
    prompt: string,
    junkwordRules?: ReadonlyArray<JunkwordRule>,
): ExitGateReport {
    const report = runExitGate({ prompt, junkwordRules });
    if (!report.passed) throw new GateBlockedError(report);
    return report;
}

/** 联合门禁：一次跑 S4 + S5（供工位出口统一调用）。 */
export function gateStoryboardAndPrompt(input: ExitGateInput): ExitGateReport {
    const report = runExitGate(input);
    if (!report.passed) throw new GateBlockedError(report);
    return report;
}

// ── 异步全量门禁（B2 三层）：需要接入语义判定器时用这一组 ──────────────────
//
// 与同步组的分工：
//   同步组 —— 纯确定性，零外部依赖，离线可用（质量域剥离 / 画幅冲突）。
//   异步组 —— 三域全量规则 + 第 2 层语义判定 + 第 3 层人工处置。
// 未注入 safetyJudge 时退化为 reviewOnly（候选全部转人工），安全侧不降级。

export interface AsyncGateOptions {
    junkwordRules?: ReadonlyArray<JunkwordRule>;
    safetyJudge?: SafetyJudge;
    axisOptions?: AxisGuardOptions;
}

/** S5 挂点（异步全量）：编译提示词出口门禁 + 安全三层。 */
export async function gateCompiledPromptAsync(
    prompt: string,
    options: AsyncGateOptions = {},
): Promise<ExitGateReport> {
    const report = await runExitGateAsync({
        prompt,
        junkwordRules: options.junkwordRules,
        axisOptions: options.axisOptions,
        safetyJudge: options.safetyJudge,
    });
    if (!report.passed) throw new GateBlockedError(report);
    return report;
}

/** 联合门禁（异步全量）：一次跑 S4 + S5 + 安全三层。 */
export async function gateStoryboardAndPromptAsync(input: ExitGateInput): Promise<ExitGateReport> {
    const report = await runExitGateAsync(input);
    if (!report.passed) throw new GateBlockedError(report);
    return report;
}
