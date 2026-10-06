export type AgentCreditPhase = "idle" | "ok" | "watch" | "exceeded";

export type AgentCreditUsageView = {
    spentCredits: number;
    maxCredits?: number;
    remainingCredits?: number;
    ratio?: number;
    ring: number;
    phase: AgentCreditPhase;
    label: string;
    percentLabel: string;
    heading: string;
    detail: string;
};

export const CREDIT_PHASE_LABEL: Record<AgentCreditPhase, string> = {
    idle: "未消耗",
    ok: "预算充足",
    watch: "预算预警",
    exceeded: "预算超限",
};

export function formatCreditValue(value?: number | null, maxDecimals = 4): string {
    if (value === undefined || value === null || !Number.isFinite(value)) return "—";
    if (value === 0) return "0";
    // 如果是整数直接转字符串
    if (Number.isInteger(value)) return value.toLocaleString("zh-CN");
    // 保留合理位数并去除末尾无效0
    return value.toLocaleString("zh-CN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: maxDecimals,
    });
}

export function presentAgentCreditUsage(
    spentCredits?: number | null,
    maxCreditsRaw?: string | number | null,
): AgentCreditUsageView {
    const spent = typeof spentCredits === "number" && Number.isFinite(spentCredits) && spentCredits >= 0 ? spentCredits : 0;

    let budget: number | undefined;
    if (typeof maxCreditsRaw === "number" && Number.isFinite(maxCreditsRaw) && maxCreditsRaw > 0) {
        budget = maxCreditsRaw;
    } else if (typeof maxCreditsRaw === "string") {
        const parsed = parseFloat(maxCreditsRaw.trim());
        if (Number.isFinite(parsed) && parsed > 0) {
            budget = parsed;
        }
    }

    if (budget !== undefined && budget > 0) {
        const ratio = spent / budget;
        const ring = Math.min(1, Math.max(0, ratio));
        const remaining = Math.max(0, budget - spent);
        const percent = Math.round(ratio * 100);

        let phase: AgentCreditPhase = "ok";
        if (spent === 0) {
            phase = "idle";
        } else if (ratio >= 1) {
            phase = "exceeded";
        } else if (ratio >= 0.8) {
            phase = "watch";
        } else {
            phase = "ok";
        }

        const percentLabel = spent === 0 ? "0%" : `${percent}%`;
        const heading = spent === 0
            ? "积分未消耗"
            : phase === "exceeded"
            ? `积分预算已超限 (${percentLabel})`
            : `积分已用 ${percentLabel}`;

        const detail = phase === "exceeded"
            ? "本轮已消耗积分已达到或超过预设预算上限，后续计费操作可能会受限。"
            : phase === "watch"
            ? "本轮已消耗积分接近预算警戒线，请留意后续生成任务的花费。"
            : "生成图片、视频、图层分离及模型推理等所有收费操作累计已结算积分。";

        return {
            spentCredits: spent,
            maxCredits: budget,
            remainingCredits: remaining,
            ratio,
            ring,
            phase,
            label: formatCreditValue(spent),
            percentLabel,
            heading,
            detail,
        };
    }

    // 无预算或预算未配置
    const phase: AgentCreditPhase = spent > 0 ? "ok" : "idle";
    return {
        spentCredits: spent,
        maxCredits: undefined,
        remainingCredits: undefined,
        ratio: undefined,
        ring: 0,
        phase,
        label: formatCreditValue(spent),
        percentLabel: spent === 0 ? "0" : formatCreditValue(spent),
        heading: spent === 0 ? "积分未消耗" : `已产生 ${formatCreditValue(spent)} 积分`,
        detail: "本轮未设定有效预算上限，展示当前已结算的实际消耗积分。",
    };
}
