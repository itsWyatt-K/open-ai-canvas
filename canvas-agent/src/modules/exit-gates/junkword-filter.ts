// ─────────────────────────────────────────────────────────────────────────────
// S5 出口门禁 · 提示词禁词确定性过滤器
//
// 设计原则：垃圾词治理是编译步骤，不是提示词指令——
// 与其在 SKILL.md 里写"不要使用 8K/杰作"，不如在编译器出口
// 用确定性正则把它剥掉。过滤只做"删除/告警/阻断"三种安全操作，
// 绝不自动改写语义（替换建议进入审计报告，由上游决定是否采纳）。
//
// 挂点：compileDirectorPrompt 输出之后 / dreamina_cli 提交之前。
// 零依赖纯函数。
// ─────────────────────────────────────────────────────────────────────────────

export type JunkwordAction = "strip" | "reject" | "warn";

export interface JunkwordRule {
    ruleId: string;
    /** 必须携带 g 标志（逐条命中收集） */
    pattern: RegExp;
    action: JunkwordAction;
    severity: "hard" | "soft";
    /** 审计说明（中文，直接进入报告与 ask_user 消息） */
    reason: string;
    /** 修复建议：只进报告，不自动改写 */
    suggestion?: string;
    /** reject 规则的触发条件：always=命中即拒；distinct=去重后≥2 才拒（规格冲突类） */
    rejectOn?: "always" | "distinct";
}

export interface JunkwordHit {
    ruleId: string;
    matchedText: string;
    /** 命中位置：按该规则处理时的文本状态计算（逐规则顺序处理） */
    index: number;
    action: JunkwordAction;
    severity: "hard" | "soft";
    reason: string;
    suggestion?: string;
}

export interface JunkwordFilterResult {
    cleanedPrompt: string;
    hits: JunkwordHit[];
    rejected: boolean;
    rejectReasons: string[];
    changed: boolean;
    stats: { totalHits: number; stripped: number; warned: number; rejected: number };
}

/**
 * 默认规则集（与 rules/guardrail-rules.yaml 同步维护）：
 * 1. 中英文质量咒语词 → strip（hard）
 * 2. 分辨率残留在提示词文本 → strip（soft）
 * 3. 画幅比规格冲突 → 单一出现告警、多个不同值阻断（hard）
 */
export const defaultJunkwordRules: ReadonlyArray<JunkwordRule> = [
    {
        ruleId: "zh-quality-jargon",
        pattern: /超逼真|超写实|超高清|超高画质|极高画质|顶级画质|大师之作|杰作|细节饱满|极致细节|高清画质/g,
        action: "strip",
        severity: "hard",
        reason: "虚无质量咒语词：对生成模型无稳定正向作用，且稀释提示词语义密度。",
        suggestion: "用具体视听参数替代：胶片型号与颗粒规格、光比、快门开角度、色温。",
    },
    {
        ruleId: "en-quality-jargon",
        pattern:
            /\b(masterpiece|best quality|award[ -]?winning|ultra[ -]?realistic|hyper[ -]?realistic|insanely detailed|extremely detailed|ultra[ -]?detailed|trending on artstation)\b/gi,
        action: "strip",
        severity: "hard",
        reason: "英文质量咒语词：源自 SD1.5 时代社区玄学，对现代模型无稳定增益。",
        suggestion: "替换为可执行的视觉指令（灯光方案、材质、构图锚点）。",
    },
    {
        ruleId: "resolution-in-prompt",
        pattern: /\b(8k|4k|uhd)\b/gi,
        action: "strip",
        severity: "soft",
        reason: "分辨率属于生成参数位（size/quality），写在提示词文本中无效且冗余。",
        suggestion: "删除，改在 dreamina_cli 的 size/quality 参数中指定。",
    },
    {
        // 画幅比候选：首段不以 0 开头（排除 00:00 时间码），支持全角冒号；
        // "12:30" 这类无前导零时间会被当作画幅候选，但仅在出现第二个不同值时才升级为冲突。
        ruleId: "aspect-ratio-conflict",
        pattern: /(?<![\d.])([1-9]\d?(?:\.\d{1,2})?)\s*[:：]\s*(\d{1,2})(?!\d)/g,
        action: "reject",
        severity: "hard",
        rejectOn: "distinct",
        reason: "提示词文本中出现多个不同画幅比，属规格冲突；画幅必须统一走参数位。",
        suggestion: "删除文本中的画幅描述，仅在 ratio/size 参数中声明一次。",
    },
];

/** 剥离后的标点与空白清理：保守处理，只修复删除残留，不改写内容。 */
function cleanupAfterStrip(text: string): string {
    return text
        .replace(/([,，])(\s*[,，])+/g, (match, first: string) => (match.includes("，") ? "，" : first))
        .replace(/[,，]\s*[。.]/g, "。")
        .replace(/[,，;；]\s*$/gm, "")
        .replace(/^[,，;；、]\s*/gm, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .split("\n")
        .map((line) => line.replace(/[ \t]+$/g, "").trim())
        .join("\n")
        .trim();
}

function normalizeRatio(matched: string): string {
    return matched.replace(/\s+/g, "").replace(/：/g, ":");
}

/**
 * 对编译后的提示词执行确定性过滤。
 *
 * 处理顺序：规则按数组顺序执行，每条规则在"当前已处理文本"上收集命中——
 * strip 即时删除；reject 不修改文本，只评估触发条件；
 * rejectOn="distinct" 的规则在去重后仅剩 1 个值时降级为 warn。
 */
export function filterJunkWords(
    prompt: string,
    rules: ReadonlyArray<JunkwordRule> = defaultJunkwordRules,
): JunkwordFilterResult {
    const hits: JunkwordHit[] = [];
    const rejectReasons: string[] = [];
    let working = prompt;

    for (const rule of rules) {
        if (!rule.pattern.global) {
            throw new Error(`规则 ${rule.ruleId} 的正则必须携带 g 标志，否则只能命中第一处。`);
        }
        const matches: Array<{ text: string; index: number }> = [];
        for (const match of working.matchAll(rule.pattern)) {
            matches.push({ text: match[0], index: match.index ?? 0 });
        }
        if (matches.length === 0) continue;

        if (rule.action === "strip") {
            for (const item of matches) {
                hits.push({
                    ruleId: rule.ruleId,
                    matchedText: item.text,
                    index: item.index,
                    action: "strip",
                    severity: rule.severity,
                    reason: rule.reason,
                    suggestion: rule.suggestion,
                });
            }
            for (const item of matches) {
                working = working.slice(0, item.index) + "\u0000".repeat(item.text.length) + working.slice(item.index + item.text.length);
            }
            // 用占位符逐段删除，避免同名多次命中时错位替换；
            // 全部标记完成后统一摘除占位符。
            working = working.replace(/\u0000+/g, "");
            continue;
        }

        if (rule.action === "reject") {
            const distinct = [...new Set(matches.map((item) => normalizeRatio(item.text)))];
            const triggered = rule.rejectOn === "distinct" ? distinct.length >= 2 : matches.length >= 1;
            if (triggered) {
                for (const item of matches) {
                    hits.push({
                        ruleId: rule.ruleId,
                        matchedText: item.text,
                        index: item.index,
                        action: "reject",
                        severity: rule.severity,
                        reason: rule.reason,
                        suggestion: rule.suggestion,
                    });
                }
                rejectReasons.push(
                    `${rule.reason}（命中的规格值：${distinct.join(" / ")}）${rule.suggestion ? `建议：${rule.suggestion}` : ""}`,
                );
            } else {
                for (const item of matches) {
                    hits.push({
                        ruleId: rule.ruleId,
                        matchedText: item.text,
                        index: item.index,
                        action: "warn",
                        severity: "soft",
                        reason: `${rule.reason}（当前仅出现单一值 ${normalizeRatio(item.text)}，降级为告警）`,
                        suggestion: rule.suggestion,
                    });
                }
            }
            continue;
        }

        for (const item of matches) {
            hits.push({
                ruleId: rule.ruleId,
                matchedText: item.text,
                index: item.index,
                action: "warn",
                severity: rule.severity,
                reason: rule.reason,
                suggestion: rule.suggestion,
            });
        }
    }

    const cleaned = cleanupAfterStrip(working);
    return {
        cleanedPrompt: cleaned,
        hits,
        rejected: rejectReasons.length > 0,
        rejectReasons,
        changed: cleaned !== prompt,
        stats: {
            totalHits: hits.length,
            stripped: hits.filter((hit) => hit.action === "strip").length,
            warned: hits.filter((hit) => hit.action === "warn").length,
            rejected: hits.filter((hit) => hit.action === "reject").length,
        },
    };
}
