import type { GoldenTask, PipelineArtifacts, PipelineResult, CheckResult, BeatSheet } from "./contracts.js";
import { storyboardSchema } from "../exit-gates/contracts.js";
import { validateStoryboardAxis } from "../exit-gates/axis-guard.js";
import { filterJunkWords } from "../exit-gates/junkword-filter.js";

// ─────────────────────────────────────────────────────────────────────────────
// 确定性检查引擎：金标任务的程序校验层（零 LLM）
//
// 直接复用 P0 出口门禁（轴线校验、禁词过滤），并把 BS2 节拍占比、时长约束、
// 结构断言补齐为同类确定性检查。规则：可判定的下沉为程序校验。
// ─────────────────────────────────────────────────────────────────────────────

const RATIO_PATTERN = /(\d{1,2}(?:\.\d{1,2})?)\s*[:：]\s*(\d{1,2})(?!\d)/g;

interface StoryboardLike {
    shots?: Array<{ shotId?: string; clipId?: string; durationSec?: number }>;
    [key: string]: unknown;
}

export function evaluateTask(task: GoldenTask, result: PipelineResult): { checks: CheckResult[]; detPoints: number; detMax: number; hardFailures: string[] } {
    // 哨兵任务：被门禁拦截 = 预期行为，全部检查按通过计（系统正确拒绝违规输入）。
    // 普通任务：被拦截 = 流水线断裂，全部检查按失败计。
    if (result.status === "blocked") {
        const passed = task.sentinel;
        const checks: CheckResult[] = task.checks.map((check) => ({
            checkId: check.checkId,
            type: check.type,
            passed,
            blocking: check.blocking,
            points: check.points,
            detail: passed
                ? `管线在 ${result.stage} 阶段正确拦截：${result.reason}`
                : `非哨兵任务被拦截（${result.stage}）：${result.reason}，视为流水线断裂。`,
        }));
        return summarize(checks);
    }

    const artifacts = result.artifacts;
    const checks: CheckResult[] = [];
    for (const check of task.checks) {
        checks.push(evaluateCheck(task, check, artifacts));
    }
    return summarize(checks);
}

function summarize(checks: CheckResult[]) {
    const detPoints = checks.filter((c) => c.passed).reduce((sum, c) => sum + c.points, 0);
    const detMax = checks.reduce((sum, c) => sum + c.points, 0);
    const hardFailures = checks.filter((c) => !c.passed && c.blocking).map((c) => `${c.checkId}: ${c.detail}`);
    return { checks, detPoints, detMax, hardFailures };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function evaluateCheck(task: GoldenTask, check: any, artifacts: PipelineArtifacts): CheckResult {
    const base = { checkId: check.checkId, type: check.type, blocking: check.blocking, points: check.points };
    const fail = (detail: string): CheckResult => ({ ...base, passed: false, detail });
    const pass = (detail: string): CheckResult => ({ ...base, passed: true, detail });

    switch (check.type) {
        case "schema_valid": {
            if (artifacts.storyboard === undefined) return fail("未产出分镜 JSON（storyboard 缺失）。");
            const parsed = storyboardSchema.safeParse(artifacts.storyboard);
            if (!parsed.success) {
                const first = parsed.error.issues[0];
                return fail(`分镜 JSON 不符合 S4 契约：${first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "未知错误"}`);
            }
            return pass(`分镜契约校验通过（${parsed.data.shots.length} 镜 / ${parsed.data.scenes.length} 场）。`);
        }
        case "axis_guard": {
            if (artifacts.storyboard === undefined) return fail("未产出分镜 JSON，无法执行轴线校验。");
            const axis = validateStoryboardAxis(artifacts.storyboard);
            if (axis.passed) return pass("轴线校验通过：无越轴硬违规。");
            const hard = axis.issues.filter((issue) => issue.severity === "hard");
            return fail(`轴线校验失败：${hard.map((issue) => issue.detail).join("；")}`);
        }
        case "junkword_free": {
            const prompts = artifacts.compiledPrompts ?? [];
            if (prompts.length === 0) return fail("未产出编译提示词，无法执行禁词检查。");
            const filtered = filterJunkWords(prompts.join("\n"));
            if (filtered.rejected) return fail(`提示词含硬阻断违规：${filtered.rejectReasons.join("；")}`);
            if (filtered.stats.stripped > 0) {
                return fail(`提示词残留 ${filtered.stats.stripped} 处质量咒语词（如 ${filtered.hits[0]!.matchedText}），S5 门禁未生效或未接入。`);
            }
            return pass("提示词零垃圾词，S5 门禁生效。");
        }
        case "beat_percentage": {
            const sheet = artifacts.beatSheet as BeatSheet | undefined;
            if (!sheet) return fail("未产出节拍表（beatSheet 缺失）。");
            const beat = sheet.beats.find((b) => beatMatches(b.beatName, check.beat));
            if (!beat) return fail(`节拍表中未找到节拍 ${check.beat}（现有：${sheet.beats.map((b) => b.beatName).join("、")}）。`);
            const pct = (beat.atUnit / sheet.totalUnits) * 100;
            if (pct < check.minPct || pct > check.maxPct) {
                return fail(`节拍 ${check.beat} 落位 ${pct.toFixed(1)}%，超出 [${check.minPct}, ${check.maxPct}]% 区间。`);
            }
            return pass(`节拍 ${check.beat} 落位 ${pct.toFixed(1)}%，符合 [${check.minPct}, ${check.maxPct}]%。`);
        }
        case "duration_bounds": {
            const board = artifacts.storyboard as StoryboardLike | undefined;
            const shots = board?.shots ?? [];
            const withDuration = shots.filter((s) => typeof s.durationSec === "number");
            if (withDuration.length === 0) return fail("分镜无 durationSec 字段，时长约束无从校验。");
            const bad = withDuration.filter((s) => (s.durationSec as number) < check.minSec || (s.durationSec as number) > check.maxSec);
            if (bad.length > 0) {
                return fail(`${bad.length} 个镜头时长越界（允许 ${check.minSec}~${check.maxSec}s，越界镜：${bad.map((s) => `${s.shotId ?? "?"}@${s.durationSec}s`).join("、")}）。`);
            }
            return pass(`全部 ${withDuration.length} 镜时长在 ${check.minSec}~${check.maxSec}s 区间内。`);
        }
        case "clip_count_bounds": {
            let count: number | null = null;
            let label = "";
            if (check.scope === "prompts") {
                count = (artifacts.compiledPrompts ?? []).length;
                label = "提示词条数";
            } else if (check.scope === "shots") {
                count = ((artifacts.storyboard as StoryboardLike | undefined)?.shots ?? []).length;
                label = "镜头数";
            } else {
                const shots = (artifacts.storyboard as StoryboardLike | undefined)?.shots ?? [];
                const clipIds = new Set(shots.map((s) => s.clipId ?? s.shotId ?? ""));
                count = clipIds.size;
                label = "Clip 数";
            }
            if (count === null || count === 0) return fail(`${label}为零或缺失，无法校验。`);
            if (count < check.min || count > check.max) {
                return fail(`${label} ${count}，超出 [${check.min}, ${check.max}] 区间。`);
            }
            return pass(`${label} ${count}，符合 [${check.min}, ${check.max}]。`);
        }
        case "ratio_consistent": {
            const prompts = artifacts.compiledPrompts ?? [];
            if (prompts.length === 0) return fail("未产出编译提示词，无法校验画幅一致性。");
            const mentions = collectRatioMentions(prompts.join("\n"));
            if (mentions.length > 1) {
                return fail(`提示词中出现多个不同画幅比：${mentions.join("、")}，规格冲突未被门禁拦截。`);
            }
            if (check.expected && mentions.length === 1 && mentions[0] !== check.expected) {
                return fail(`画幅比 ${mentions[0]} 与任务约束 ${check.expected} 不一致。`);
            }
            return pass(mentions.length === 0 ? "提示词未夹带画幅比（规格走参数位），一致。" : `画幅比 ${mentions[0]} 唯一且一致。`);
        }
        case "required_pattern": {
            const text = resolveTextTarget(check.target, artifacts);
            if (text === null) return fail(`目标产物 ${check.target} 缺失，无法匹配必需模式。`);
            const re = compilePattern(check.pattern);
            if (!re) return fail(`必需模式正则编译失败：${check.pattern}`);
            const match = re.test(text);
            re.lastIndex = 0;
            return match ? pass(`必需模式命中：${check.pattern}`) : fail(`必需模式未命中：${check.pattern}（目标 ${check.target}）。`);
        }
        case "forbidden_pattern": {
            const text = resolveTextTarget(check.target, artifacts);
            if (text === null) return pass("目标产物缺失，禁用模式自然未出现（放行，缺失由其他检查负责）。");
            const re = compilePattern(check.pattern);
            if (!re) return fail(`禁用模式正则编译失败：${check.pattern}`);
            const match = re.test(text);
            re.lastIndex = 0;
            return match ? fail(`命中禁用模式：${check.pattern}（目标 ${check.target}）。`) : pass(`未命中禁用模式：${check.pattern}。`);
        }
        case "field_present": {
            if (artifacts.storyboard === undefined) return fail("未产出分镜 JSON，字段断言无从校验。");
            const value = getPath(artifacts.storyboard, check.path);
            if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
                return fail(`分镜字段 ${check.path} 缺失或为空。`);
            }
            return pass(`分镜字段 ${check.path} 存在且非空。`);
        }
        case "word_count_bounds": {
            const text = resolveTextTarget(check.target, artifacts);
            if (text === null) return fail(`目标产物 ${check.target} 缺失，无法统计字数。`);
            const chars = text.replace(/\s/g, "").length;
            if (chars < check.minChars || chars > check.maxChars) {
                return fail(`字数 ${chars} 超出 [${check.minChars}, ${check.maxChars}]（目标 ${check.target}）。`);
            }
            return pass(`字数 ${chars} 符合 [${check.minChars}, ${check.maxChars}]。`);
        }
        default:
            return fail(`未知检查类型：${check.type}`);
    }
}

function resolveTextTarget(target: string, artifacts: PipelineArtifacts): string | null {
    switch (target) {
        case "scriptText": return artifacts.scriptText ?? null;
        case "promptsJoined": return (artifacts.compiledPrompts ?? []).join("\n") || null;
        case "storyboardRaw": return artifacts.storyboard === undefined ? null : JSON.stringify(artifacts.storyboard);
        default: return null;
    }
}

function compilePattern(source: string): RegExp | null {
    try {
        return new RegExp(source, "i");
    } catch {
        return null;
    }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPath(obj: any, dotPath: string): unknown {
    return dotPath.split(".").reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

function beatMatches(actual: string, pattern: string): boolean {
    try {
        return new RegExp(pattern, "i").test(actual);
    } catch {
        return actual.toLowerCase().includes(pattern.toLowerCase());
    }
}

function collectRatioMentions(text: string): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(RATIO_PATTERN)) {
        if (match[1]!.startsWith("0")) continue; // 时间码豁免（与 P0 过滤器同规则）
        found.add(`${match[1]}:${match[2]}`);
    }
    return [...found];
}
