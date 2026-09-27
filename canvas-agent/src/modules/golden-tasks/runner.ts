import type { GoldenTask, PipelineExecutor, PipelineResult, PairwiseJudge, PromotionConfig, PromotionReport } from "./contracts.js";
import { defaultPromotionConfig, compareTask, decidePromotion, renderPromotionReport } from "./promotion.js";

// ─────────────────────────────────────────────────────────────────────────────
// 金标回归 Runner：跑一轮新旧版本对比，产出晋级决策报告。
//
// 用法（在影策本地环境）：
//   const executor = new YingcePipelineExecutor(); // 实现 run(task, version)，
//     内部把 task.brief 喂给对应工位链路并回收 artifacts（分镜 JSON、编译
//     提示词、节拍表）。P0 门禁已在其出口生效。
//   const judge = new GlmPairwiseJudge();          // 见 judge.ts 接入桩
//   const report = await runGoldenSet(tasks, executor, judge);
//   console.log(renderPromotionReport(report));
// ─────────────────────────────────────────────────────────────────────────────

export async function runGoldenSet(
    tasks: GoldenTask[],
    executor: PipelineExecutor,
    judge: PairwiseJudge,
    config: Partial<PromotionConfig> = {},
): Promise<PromotionReport> {
    const fullConfig: PromotionConfig = { ...defaultPromotionConfig, ...config, judgeId: config.judgeId ?? judge.judgeId };
    const comparisons = [];
    for (const task of tasks) {
        comparisons.push(await compareTask(task, executor, judge));
    }
    return decidePromotion(comparisons, fullConfig);
}

export { renderPromotionReport };

// ── Mock 执行器：测试与本地演示用 ────────────────────────────────────────────

/**
 * 按 taskId + version 查表返回产物的 Mock 执行器。
 * 表项可以是 PipelineResult（正常/拦截），或抛出错误（模拟执行故障）。
 */
export class MockPipelineExecutor implements PipelineExecutor {
    readonly executorId = "mock-executor";
    private readonly table: Map<string, PipelineResult>;

    constructor(table: Record<string, PipelineResult>) {
        this.table = new Map(Object.entries(table));
    }

    async run(task: GoldenTask, version: "old" | "new"): Promise<PipelineResult> {
        const key = `${task.taskId}:${version}`;
        const entry = this.table.get(key);
        if (!entry) {
            throw new Error(`Mock 执行器缺少表项：${key}`);
        }
        return entry;
    }
}
