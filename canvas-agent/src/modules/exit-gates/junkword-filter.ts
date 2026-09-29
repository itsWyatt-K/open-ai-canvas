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

export type JunkwordAction = "strip" | "reject" | "warn" | "flag";

/**
 * 规则域分离（B2 / 智谱回执 ○Q7）：
 * - quality   质量域：质量咒语词/分辨率残留/画幅冲突。确定性剥离是 P0 原设计。
 * - safety    安全域：涉政涉黄词表仅作廉价初筛（高召回、宁误报勿漏报），
 *             命中只产"候选"（flag），判定走 SafetyJudge（模型级），
 *             处置路由人工复核，**不得静默硬拦**。
 * - competitor 竞品域：竞品名提示。降级为软警告（不阻断、不剥离）。
 */
export type JunkwordDomain = "quality" | "safety" | "competitor";

export interface JunkwordRule {
    ruleId: string;
    /** 必须携带 g 标志（逐条命中收集） */
    pattern: RegExp;
    action: JunkwordAction;
    severity: "hard" | "soft";
    /** 规则域（缺省 quality，保持旧规则零改动兼容） */
    domain?: JunkwordDomain;
    /** 审计说明（中文，直接进入报告与 ask_user 消息） */
    reason: string;
    /** 修复建议：只进报告，不自动改写 */
    suggestion?: string;
    /** reject 规则的触发条件：always=命中即拒；distinct=去重后≥2 才拒（规格冲突类） */
    rejectOn?: "always" | "distinct";
}

export interface JunkwordHit {
    ruleId: string;
    domain: JunkwordDomain;
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
    stats: { totalHits: number; stripped: number; warned: number; rejected: number; flagged: number };
    /** 安全域词表初筛候选（flag 命中）：送 SafetyJudge 判定的输入，不进 cleanedPrompt 流程 */
    safetyCandidates: JunkwordHit[];
    /** 按域分列的命中统计（审计报告按域分列的依据） */
    byDomain: Record<JunkwordDomain, number>;
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

/**
 * 安全域词表（B2 三层架构之第 1 层：廉价高召回初筛）。
 *
 * 铁律：本词表只产"候选"（action=flag），**绝不静默硬拦、绝不改写文本**。
 * 阈值偏召回——漏报代价远大于误报代价，宁误报勿漏报。
 * 误报由第 2 层 SafetyJudge 语义复判（处理谐音/拆字/变体逃逸）与第 3 层人工复核吸收。
 *
 * 此处仅内置中性、可公开审计的泛类词（涉黄/违禁品/博彩/血腥暴力）。
 * 涉政等需合规维护的专项词表不入库，走 `loadSafetyWordlist()` 从
 * `rules/safety-wordlist.json`（不随仓库分发）外部挂载，避免词表与代码耦合。
 */
export const defaultSafetyWordlist: ReadonlyArray<JunkwordRule> = [
    {
        ruleId: "safety-porn-generic",
        pattern: /色情|情色|成人内容|成人影片|裸露|全裸|性暗示|擦边|露骨|艳照/gi,
        action: "flag",
        severity: "hard",
        domain: "safety",
        reason: "安全域初筛：疑似涉黄泛词。仅为候选，需 SafetyJudge 语义复判 + 人工复核，禁止静默硬拦。",
        suggestion: "正当艺术/医学语境由人工复核放行；否则改写措辞或撤稿。",
    },
    {
        ruleId: "safety-illegal-goods",
        pattern: /毒品|吸毒|贩毒|制毒|枪支|弹药|爆炸物|管制刀具/g,
        action: "flag",
        severity: "hard",
        domain: "safety",
        reason: "安全域初筛：疑似违禁品词。仅为候选，需复判 + 人工复核。",
        suggestion: "确认是否为反诈/普法/影视道具语境；否则移除。",
    },
    {
        ruleId: "safety-gambling",
        pattern: /赌博|博彩|赌场|下注|押注|开奖/g,
        action: "flag",
        severity: "soft",
        domain: "safety",
        reason: "安全域初筛：疑似博彩词。仅为候选，需复判 + 人工复核。",
        suggestion: "非博彩语义（如\"赌一把\"口语）由人工复核放行。",
    },
    {
        ruleId: "safety-violence-gore",
        pattern: /血腥|虐杀|残肢|肢解|尸体特写/g,
        action: "flag",
        severity: "soft",
        domain: "safety",
        reason: "安全域初筛：疑似血腥暴力词。仅为候选，需复判 + 人工复核。",
        suggestion: "刑侦/医学/历史叙事语境由人工复核放行。",
    },
];

/**
 * 竞品域词表（B2：降级为软警告——不阻断、不剥离、不改写一个字）。
 * 目的只是"让主人看见"，处置权完全在人。
 */
export const defaultCompetitorWordlist: ReadonlyArray<JunkwordRule> = [
    {
        ruleId: "competitor-vendor-name",
        pattern: /\b(midjourney|stable ?diffusion|dall[·\-]?e|sora|runway(?:ml)?|pika|luma|ideogram|flux)\b/gi,
        action: "warn",
        severity: "soft",
        domain: "competitor",
        reason: "提示词中出现竞品/第三方模型名，可能是风格借代，也可能是串台残留。仅提示，不阻断。",
        suggestion: "若确为风格借代可保留；若为模板串台请改为本产线的风格描述。",
    },
];

/**
 * 出口门禁默认全量规则集 = 质量域（确定性剥离）+ 安全域（初筛候选）+ 竞品域（软警告）。
 * 单独调用 filterJunkWords 时仍默认仅质量域（保持既有调用点与测试零改动）。
 */
export const defaultExitGateRules: ReadonlyArray<JunkwordRule> = [
    ...defaultJunkwordRules,
    ...defaultSafetyWordlist,
    ...defaultCompetitorWordlist,
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
        const domain: JunkwordDomain = rule.domain ?? "quality";
        const matches: Array<{ text: string; index: number }> = [];
        for (const match of working.matchAll(rule.pattern)) {
            matches.push({ text: match[0], index: match.index ?? 0 });
        }
        if (matches.length === 0) continue;

        // 安全域：词表初筛只产候选，绝不静默硬拦（判定走 SafetyJudge）
        if (domain === "safety" && rule.action !== "flag") {
            throw new Error(`安全域规则 ${rule.ruleId} 的 action 必须为 flag（初筛不判定、不阻断）。`);
        }

        // 竞品域：强制降级为 warn（B2：软警告，不阻断不剥离）
        const effectiveAction: JunkwordAction =
            domain === "competitor" && rule.action !== "warn" ? "warn" : rule.action;

        if (effectiveAction === "strip") {
            for (const item of matches) {
                hits.push({
                    ruleId: rule.ruleId,
                    domain,
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

        // 安全域初筛：只记录候选，不改写文本、不阻断、不进 rejectReasons
        if (effectiveAction === "flag") {
            for (const item of matches) {
                hits.push({
                    ruleId: rule.ruleId,
                    domain,
                    matchedText: item.text,
                    index: item.index,
                    action: "flag",
                    severity: rule.severity,
                    reason: rule.reason,
                    suggestion: rule.suggestion,
                });
            }
            continue;
        }

        if (effectiveAction === "reject") {
            const distinct = [...new Set(matches.map((item) => normalizeRatio(item.text)))];
            const triggered = rule.rejectOn === "distinct" ? distinct.length >= 2 : matches.length >= 1;
            if (triggered) {
                for (const item of matches) {
                    hits.push({
                        ruleId: rule.ruleId,
                        domain,
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
                        domain,
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
                domain,
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
    const safetyCandidates = hits.filter((hit) => hit.action === "flag");
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
            flagged: safetyCandidates.length,
        },
        safetyCandidates,
        byDomain: {
            quality: hits.filter((hit) => hit.domain === "quality").length,
            safety: hits.filter((hit) => hit.domain === "safety").length,
            competitor: hits.filter((hit) => hit.domain === "competitor").length,
        },
    };
}
