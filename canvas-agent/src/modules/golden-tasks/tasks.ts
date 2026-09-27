import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { goldenTaskSchema, type GoldenTask } from "./contracts.js";

// ─────────────────────────────────────────────────────────────────────────────
// 金标任务集加载器：tasks/*.json 为唯一事实源（人可读、可版本管理、可外部
// 系统直接消费），加载时经 zod 契约校验——任务集本身也是被校验的数据。
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TASKS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "tasks");

export function loadGoldenTasks(dir: string = DEFAULT_TASKS_DIR): GoldenTask[] {
    const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort();
    const tasks: GoldenTask[] = [];
    const errors: string[] = [];
    for (const file of files) {
        const raw = JSON.parse(readFileSync(path.join(dir, file), "utf-8"));
        const entries = Array.isArray(raw) ? raw : [raw];
        for (const entry of entries) {
            const parsed = goldenTaskSchema.safeParse(entry);
            if (parsed.success) {
                tasks.push(parsed.data);
            } else {
                const first = parsed.error.issues[0];
                errors.push(`${file}/${(entry as { taskId?: string }).taskId ?? "?"}: ${first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "未知错误"}`);
            }
        }
    }
    if (errors.length > 0) {
        throw new Error(`金标任务集契约校验失败：\n${errors.join("\n")}`);
    }
    tasks.sort((a, b) => a.taskId.localeCompare(b.taskId));
    return tasks;
}

export function assertTaskSetSanity(tasks: GoldenTask[]): void {
    const ids = tasks.map((task) => task.taskId);
    if (new Set(ids).size !== ids.length) {
        throw new Error("任务 ID 重复。");
    }
    for (const task of tasks) {
        if (task.sentinel !== (task.tag === "sentinel")) {
            throw new Error(`${task.taskId} 的 sentinel 标志与 tag 不一致。`);
        }
        if (task.sentinel && !task.checks.some((check) => check.blocking)) {
            throw new Error(`${task.taskId} 哨兵任务必须至少含 1 条阻断性检查。`);
        }
        if (task.subjectiveDimensions.length > 0 && task.subjectiveDimensions.some((dim) => dim.anchors.length < 2)) {
            throw new Error(`${task.taskId} 主观维度锚点不足 2 条（无锚点 rubric 噪声大，禁止）。`);
        }
    }
}
