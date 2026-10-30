/**
 * 全能复刻 · 渲染轮询 fan-out（进行态逐版进度，零新端点）。
 *
 * 机制（《交付方案 v1.2》US-7 终稿）：批量提交后每版进度走各 job status，
 * 前端本地回环 fan-out 轮询（12 版 × 1 请求/2s 无压力），不做 batch 聚合端点。
 * 本文件只放纯函数——页面定时器 + 单测共用同一套节流口径。
 */

export type PolledJob = { job_id: string };

/**
 * 本轮应轮询的 job：每 job 独立节流（intervalMs），慢 job 不阻塞快 job。
 * lastPollAt 缺省视为「从未轮询」（立即可投）。
 */
export function fanoutDueJobs<T extends PolledJob>(jobs: T[], lastPollAt: Map<string, number>, now: number, intervalMs: number): T[] {
    return jobs.filter((job) => now - (lastPollAt.get(job.job_id) ?? Number.NEGATIVE_INFINITY) >= intervalMs);
}

/** 轮询总 deadline：单 job 从提交起超过此时长未终态 → 判超时（引擎无状态，重启即 404 语义）。 */
export const RENDER_POLL_DEADLINE_MS = 300_000;

/** 逐版轮询间隔（本地回环 12 版 × 1 请求/2s 无压力）。 */
export const RENDER_POLL_INTERVAL_MS = 2_000;

/** job 是否已终态（done/error 不再轮询）。 */
export function isTerminalStatus(status: string): boolean {
    return status === "done" || status === "error";
}

/**
 * 轮询超时判定：超过 RENDER_POLL_DEADLINE_MS 仍非终态 → 诚实报错
 * （引擎内存 job 表在重启后丢失，404 与超时同一套人话文案）。
 */
export function pollDeadlineExceeded(startedAt: number, now: number): boolean {
    return now - startedAt >= RENDER_POLL_DEADLINE_MS;
}
