// ─────────────────────────────────────────────────────────────────────────────
// S5 出口门禁 · 安全域判定层（B2 三层架构之第 2 层）
//
//   第 1 层：词表廉价初筛（高召回，宁误报勿漏报）  → junkword-filter.ts
//   第 2 层：模型语义判定（谐音/拆字/变体逃逸/语境）→ 本文件
//   第 3 层：人工复核处置（ask_user）              → exit-gate.ts / yingce-gate-hooks.ts
//
// 铁律：
//   1. 本层只做"判定"，不做"处置"；处置权恒属第 3 层人工。
//   2. 判定失败 / 模型不可用 / 返回不可解析 —— 一律降级为 review（转人工），
//      绝不降级为 pass（那等于静默放行），也绝不自行 block（那等于静默硬拦）。
//   3. 实现可热替换：调用方只依赖 SafetyJudge 接口，不依赖任何具体厂商 SDK。
//      本文件零第三方依赖，模型调用通过注入函数传入。
// ─────────────────────────────────────────────────────────────────────────────

import type { JunkwordHit } from "./junkword-filter.js";

/** 判定结论：pass=非违规放行；review=证据不足转人工；block=判定违规。 */
export type SafetyJudgement = "pass" | "review" | "block";

export interface SafetyVerdict {
    /** 对应的词表初筛候选（保留 ruleId / matchedText / 上下文位置） */
    candidate: JunkwordHit;
    judgement: SafetyJudgement;
    /** 0~1，模型自评置信度；低于 reviewThreshold 强制转为 review */
    confidence: number;
    /** 中文判定理由，直进审计报告与 ask_user 消息 */
    rationale: string;
    /** 产出该判定的判定器标识（可观测：换模型/换词表要能对得上） */
    judgeId: string;
    /** true=真实模型判定；false=降级/未走模型（必定 review） */
    modelJudged: boolean;
}

export interface SafetyJudgeContext {
    /** 被判定的完整提示词（给模型足够上下文判断语义，而非孤立词组） */
    prompt: string;
}

export interface SafetyJudge {
    readonly judgeId: string;
    judge(candidates: ReadonlyArray<JunkwordHit>, ctx: SafetyJudgeContext): Promise<SafetyVerdict[]>;
}

/** 置信度低于此值一律转人工（宁误报勿漏报的兜底） */
export const DEFAULT_REVIEW_THRESHOLD = 0.7;

// ── 判定器实现 1：仅转人工（无模型时的默认实现，永远安全的一侧） ──────────────
/**
 * 默认判定器：不做任何语义判断，把所有候选原样推进人工队列。
 * 用于：未配置模型 / 模型通道不可用 / 灰度期的保守运行。
 */
export function createReviewOnlySafetyJudge(judgeId = "review-only@1"): SafetyJudge {
    return {
        judgeId,
        async judge(candidates) {
            return candidates.map((candidate) => ({
                candidate,
                judgement: "review" as SafetyJudgement,
                confidence: 0,
                rationale: `未启用语义判定器，候选词「${candidate.matchedText}」按保守策略直接转人工复核。`,
                judgeId,
                modelJudged: false,
            }));
        },
    };
}

// ── 判定器实现 2：模型语义判定（GLM-4 过渡方案，可热替换为任意厂商） ──────────
export interface ModelSafetyJudgeOptions {
    judgeId?: string;
    /**
     * 模型调用注入点。入参为已拼好的中文判定 Prompt，返回模型原始文本。
     * 由调用方注入具体渠道（GLM-4 / GPT / 本地模型），本文件不绑定厂商。
     */
    callModel: (systemPrompt: string, userPrompt: string) => Promise<string>;
    /** 低于该置信度转人工 */
    reviewThreshold?: number;
    systemPrompt?: string;
}

function buildJudgePrompt(candidates: ReadonlyArray<JunkwordHit>, prompt: string): string {
    const lines: string[] = [];
    lines.push("你是内容安全判定员。下面是一段 AI 生图/生视频提示词，以及词表廉价初筛命中的候选词。");
    lines.push("任务：逐条判断候选词在该语境下是否构成真实违规。注意谐音、拆字、拼音首字母、黑话变体逃逸。");
    lines.push("");
    lines.push("【待判定提示词全文】");
    lines.push(prompt);
    lines.push("");
    lines.push("【候选词列表】");
    candidates.forEach((item, index) => {
        lines.push(`${index + 1}. ruleId=${item.ruleId} 命中词=${item.matchedText} 初筛说明=${item.reason}`);
    });
    lines.push("");
    lines.push('只输出 JSON 数组，不要任何解释文字，格式：');
    lines.push('[{"index":1,"judgement":"pass|review|block","confidence":0.9,"rationale":"中文理由，30 字内"}]');
    return lines.join("\n");
}

/** 从模型回文中提取 JSON 数组：容忍 ```json 围栏与前后废话。 */
export function extractJsonArray(raw: string): unknown {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? fenced[1] : raw;
    const start = body.indexOf("[");
    const end = body.lastIndexOf("]");
    if (start < 0 || end <= start) throw new Error("模型回文中找不到 JSON 数组");
    return JSON.parse(body.slice(start, end + 1));
}

export function createModelSafetyJudge(options: ModelSafetyJudgeOptions): SafetyJudge {
    const judgeId = options.judgeId ?? "model-safety-judge@1";
    const reviewThreshold = options.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD;
    const systemPrompt =
        options.systemPrompt ??
        "你是严格但克制的内容安全判定员：只对有明确违规语义的候选给出 block；语境正当（艺术/医学/普法/影视道具）给 pass；证据不足一律 review。";

    return {
        judgeId,
        async judge(candidates, ctx) {
            if (candidates.length === 0) return [];

            const fallback: SafetyVerdict[] = candidates.map((candidate) => ({
                candidate,
                judgement: "review" as SafetyJudgement,
                confidence: 0,
                rationale: "语义判定器调用失败，保守降级为人工复核。",
                judgeId,
                modelJudged: false,
            }));

            let parsed: unknown;
            try {
                const raw = await options.callModel(systemPrompt, buildJudgePrompt(candidates, ctx.prompt));
                parsed = extractJsonArray(raw);
            } catch (error) {
                // 失败方向：转人工。不静默放行，也不自行硬拦。
                const reason = error instanceof Error ? error.message : String(error);
                return fallback.map((item) => ({
                    ...item,
                    rationale: `语义判定器调用失败（${reason}），保守降级为人工复核。`,
                }));
            }

            if (!Array.isArray(parsed) || parsed.length !== candidates.length) {
                // 部分覆盖 = 回文不完整，不可信：整批转人工（宁误报勿漏报）。
                return fallback.map((item) => ({
                    ...item,
                    rationale: `模型回文覆盖不全（候选 ${candidates.length} 条 / 回文 ${Array.isArray(parsed) ? parsed.length : "非数组"} 条），保守降级为人工复核。`,
                }));
            }

            return candidates.map((candidate, position) => {
                const entry = parsed.find(
                    (item): item is Record<string, unknown> =>
                        typeof item === "object" && item !== null && Number(item["index"]) === position + 1,
                );
                if (!entry) {
                    return {
                        candidate,
                        judgement: "review" as SafetyJudgement,
                        confidence: 0,
                        rationale: "模型未覆盖该候选词，保守转人工复核。",
                        judgeId,
                        modelJudged: false,
                    };
                }
                const rawJudgement = String(entry["judgement"] ?? "");
                const confidence = Number(entry["confidence"] ?? 0);
                const rationale = String(entry["rationale"] ?? "").slice(0, 200) || "模型未给出判定理由。";
                if (rawJudgement !== "pass" && rawJudgement !== "block" && rawJudgement !== "review") {
                    return { candidate, judgement: "review", confidence: 0, rationale: `模型返回未知结论「${rawJudgement}」，转人工。`, judgeId, modelJudged: false };
                }
                const safeConfidence = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
                const judgement: SafetyJudgement =
                    safeConfidence < reviewThreshold && rawJudgement !== "pass" ? "review" : rawJudgement;
                return {
                    candidate,
                    judgement,
                    confidence: safeConfidence,
                    rationale:
                        judgement === "review" && rawJudgement !== "review"
                            ? `置信度 ${safeConfidence.toFixed(2)} 低于阈值 ${reviewThreshold}，转人工复核。${rationale}`
                            : rationale,
                    judgeId,
                    modelJudged: true,
                };
            });
        },
    };
}

/** 汇总：把判定结果收敛成审计报告要的三态计数 + 待人工队列。 */
export interface SafetySummary {
    total: number;
    passed: number;
    review: number;
    blocked: number;
    /** 需要人工处置的判定项（review + block 都要人点头） */
    humanQueue: SafetyVerdict[];
    /** 判定器标识（可能为多个，理论上一轮只有一个） */
    judgeIds: string[];
    /** 是否存在未走模型的降级判定（true = 该轮结果不可作为模型能力证据） */
    degraded: boolean;
}

export function summarizeSafetyVerdicts(verdicts: ReadonlyArray<SafetyVerdict>): SafetySummary {
    const humanQueue = verdicts.filter((item) => item.judgement !== "pass");
    return {
        total: verdicts.length,
        passed: verdicts.filter((item) => item.judgement === "pass").length,
        review: verdicts.filter((item) => item.judgement === "review").length,
        blocked: verdicts.filter((item) => item.judgement === "block").length,
        humanQueue,
        judgeIds: [...new Set(verdicts.map((item) => item.judgeId))],
        degraded: verdicts.some((item) => !item.modelJudged),
    };
}
