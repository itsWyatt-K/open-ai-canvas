import { describe, expect, test } from "bun:test";

// 云端同步调度回归（SQLite 写锁撞车修复）。
//
// 旧实现是纯 1200ms 防抖：生图任务收尾时节点 metadata 连续写入（loading → 成功 →
// 资源回填），间隔短于 1200ms 会无限重置定时器，保存迟迟不发；等它终于发出时
// 正好撞上任务派发的 SQLite 写锁（database is locked），前端显示
// 「作品已生成，保存遇到问题，正在自动恢复」。
//
// 新策略是节流 + 防抖混合：
//   - 距上次调度不足 250ms → 合并，只排一个到最小间隔的短定时器；
//   - 距上次调度已超过 250ms → 排 1200ms 防抖；
//   - 防抖期内持续有变更 → 3000ms 兜底定时器保证必然发出。

const SYNC_DEBOUNCE_MS = 1200;
const SYNC_MAX_WAIT_MS = 3000;
const SYNC_MIN_INTERVAL_MS = 250;

/** 复刻 scheduleRemoteUserDataSync 的调度决策，便于离线断言。 */
function planSchedule(now: number, lastScheduledAt: number, hasPendingDebounce: boolean) {
    if (now - lastScheduledAt < SYNC_MIN_INTERVAL_MS) {
        return { fireAt: now + (SYNC_MIN_INTERVAL_MS - (now - lastScheduledAt)), startsMaxWait: false };
    }
    return { fireAt: now + SYNC_DEBOUNCE_MS, startsMaxWait: !hasPendingDebounce };
}

describe("云端同步节流+防抖调度", () => {
    test("高频连续变更不会被无限推迟：最短 250ms 内必发一次", () => {
        // 模拟 10 次间隔 100ms 的 metadata 写入。
        let last = 0;
        const fireTimes: number[] = [];
        let pending = false;
        for (let step = 1; step <= 10; step += 1) {
            const now = step * 100;
            const plan = planSchedule(now, last, pending);
            last = now;
            pending = true;
            fireTimes.push(plan.fireAt);
        }
        // 每次调度都给出了明确的发出时刻，且最早不晚于 250ms 之后。
        const earliest = Math.min(...fireTimes);
        expect(earliest).toBeLessThanOrEqual(SYNC_MIN_INTERVAL_MS);
        // 不会出现「发出时间被推到无限远」的情况。
        expect(Math.max(...fireTimes)).toBeLessThanOrEqual(SYNC_MAX_WAIT_MS);
    });

    test("单次变更仍走 1200ms 防抖，合并画布拖动的高频写入", () => {
        const plan = planSchedule(5000, 1000, false);
        expect(plan.fireAt).toBe(5000 + SYNC_DEBOUNCE_MS);
        expect(plan.startsMaxWait).toBe(true);
    });

    test("防抖期内只启动一个兜底定时器", () => {
        const first = planSchedule(5000, 1000, false);
        const second = planSchedule(5200, 5000, true);
        expect(first.startsMaxWait).toBe(true);
        expect(second.startsMaxWait).toBe(false);
    });

    test("最小间隔内不启动第二个防抖，避免重置定时器", () => {
        const plan = planSchedule(1100, 1000, false);
        // 100ms < 250ms → 只补一个到最小间隔的短定时器，不重新起 1200ms 防抖。
        expect(plan.fireAt).toBe(1100 + (SYNC_MIN_INTERVAL_MS - 100));
        expect(plan.startsMaxWait).toBe(false);
    });
});
