/**
 * 爆款反推 → 画布消费器 E2E 模拟（夜间施工令阶段五-3）。
 *
 * 口径：不依赖真实浏览器与 8790 侧车——用 HAPPY_DOM 门控的 localStorage 真写真读，
 * 载荷走生产端 writeEreverseHandoff 同一函数，消费端走 readEreverseHandoffOnce +
 * buildEreverseCanvasHandoff，断言《精确字段映射契约》：
 *   shot_type→shotSize、camera_movement→camera+motion、(end-start)/1000→durationSeconds、
 *   台词→dialogue、钩子+标签→narrativeIntent、negativePrompt→negativePrompt、
 *   🛡️ preferCompliance 双轨（compliancePrompt/visualPrompt 切 plotDescription）、
 *   自家主体锁定卡 + assetBindings、成本闸门（无 generation 触发字段）。
 * HAPPY_DOM=1 时由 bunfig preload 装配 DOM；不带该环境变量时整文件跳过（零负担）。
 */
import { describe, expect, test } from "bun:test";

const happyDom = process.env.HAPPY_DOM === "1";

(happyDom ? describe : describe.skip)("ereverse handoff consume (HAPPY_DOM)", () => {
    test("载荷 → 画布节点/分镜表：字段精确映射 + 主体锁定卡 + 成本闸门", async () => {
        const { writeEreverseHandoff, toHandoffShots } = await import("@/pages/ereverse/handoff");
        const { buildEreverseCanvasHandoff, readEreverseHandoffOnce, clearEreverseHandoffMark } = await import("@/lib/canvas/ereverse-handoff-consume");
        const type = (await import("@/types/canvas")).CanvasNodeType;

        const view = {
            sourceName: "测试对标视频",
            scenes: [
                { index: 0, startMs: 0, endMs: 2800, durationMs: 2800, shotType: "特写", cameraMovement: "推", visualPrompt: "物理描述A", compliancePrompt: "防封稿A", negativePrompt: "低质", dialogue: "家人们看这里", tags: ["开箱", "钩子"], keyframeUrl: null, hasSpeech: true, tagProvider: "test", leftPct: 0, widthPct: 50 },
                { index: 1, startMs: 2800, endMs: 9300, durationMs: 6500, shotType: "中景", cameraMovement: "环绕", visualPrompt: "物理描述B", compliancePrompt: "防封稿B", negativePrompt: "模糊", dialogue: "", tags: ["高潮"], keyframeUrl: null, hasSpeech: false, tagProvider: "test", leftPct: 50, widthPct: 50 },
            ],
            chunks: [],
            timelineSource: "none",
        } as never;

        const shots = toHandoffShots(view);
        writeEreverseHandoff({ target: "canvas", sourceName: "测试对标视频", shots, visualDnaText: "配方", preferCompliance: false });
        window.location.assign("http://localhost:3000/canvas/proj-1?handoff=ereverse");

        const payload = readEreverseHandoffOnce(window.location.search, "canvas");
        expect(payload).not.toBeNull();
        expect(payload!.shots).toHaveLength(2);
        // consume-once：读一次后 localStorage 必须已清
        expect(readEreverseHandoffOnce(window.location.search, "canvas")).toBeNull();

        const result = await buildEreverseCanvasHandoff(payload!, { x: 0, y: 0 });
        const batch = result.nodes.find((node) => node.type === type.BatchTable);
        expect(batch).toBeDefined();
        const table = batch!.metadata?.batchTable!;
        expect(table.contentKind).toBe("storyboard");
        expect(table.storyboardRows).toHaveLength(2);
        expect(table.rows.every((row) => !row.outputNodeId)).toBeTrue(); // 成本闸门：只建表不派发

        const row1 = table.storyboardRows![0];
        expect(row1.shotSize).toBe("特写");
        expect(row1.camera).toBe("推");
        expect(row1.motion).toBe("推");
        expect(row1.durationSeconds).toBeCloseTo(2.8, 5);
        expect(row1.dialogue).toBe("家人们看这里");
        expect(row1.narrativeIntent).toContain("钩子");
        expect(row1.negativePrompt).toBe("低质");
        expect(row1.plotDescription).toBe("物理描述A"); // 未开 🛡️ → visualPrompt
        expect(row1.characters[0].characterName).toBe("自家主体");

        const slot = result.nodes.find((node) => node.id === result.characterSlotNodeId);
        expect(slot).toBeDefined();
        expect(slot!.title).toContain("自家主体锁定卡");

        // 🛡️ 双轨：开启防封改写后 plotDescription 切 compliancePrompt
        writeEreverseHandoff({ target: "canvas", sourceName: "测试对标视频", shots, visualDnaText: "配方", preferCompliance: true });
        const payload2 = readEreverseHandoffOnce("?handoff=ereverse", "canvas");
        const result2 = await buildEreverseCanvasHandoff(payload2!, { x: 0, y: 0 });
        const table2 = result2.nodes.find((node) => node.type === type.BatchTable)!.metadata!.batchTable!;
        expect(table2.storyboardRows![0].plotDescription).toBe("防封稿A");
        expect(table2.storyboardRows![1].plotDescription).toBe("防封稿B");

        clearEreverseHandoffMark();
    });

    test("制片台消费契约：Markdown 表格可生成且行数与勾选镜一致", async () => {
        const { writeEreverseHandoff, peekEreverseHandoff, removeEreverseHandoff, ereverseHandoffMarkdownTable, toHandoffShots, goldenThreeShotIndexes } = await import("@/pages/ereverse/handoff");
        const view = {
            sourceName: "短剧对标",
            scenes: Array.from({ length: 5 }, (_, index) => ({
                index, startMs: index * 4000, endMs: index * 4000 + (index === 2 ? 7800 : 3800), durationMs: index === 2 ? 7800 : 3800,
                shotType: "中景", cameraMovement: "固定", visualPrompt: `描述${index}`, compliancePrompt: `防封${index}`,
                negativePrompt: "", dialogue: index === 0 ? "开场台词" : "", tags: ["标签"], keyframeUrl: null,
                hasSpeech: false, tagProvider: "test", leftPct: 0, widthPct: 100,
            })),
            chunks: [],
            timelineSource: "none",
        } as never;

        const golden = goldenThreeShotIndexes(view);
        expect(golden.size).toBe(3);
        expect(golden.has(0)).toBeTrue();
        expect(golden.has(4)).toBeTrue();

        const shots = toHandoffShots(view, { selectedIndexes: golden });
        expect(shots).toHaveLength(3);
        writeEreverseHandoff({ target: "projects", sourceName: "短剧对标", shots, visualDnaText: "" });
        const payload = peekEreverseHandoff("projects");
        expect(payload).not.toBeNull();
        const markdown = ereverseHandoffMarkdownTable(payload!);
        expect(markdown).toContain("| 1 |");
        expect(markdown).toContain("描述0"); // 未开 🛡️ → 画面列用 visualPrompt
        expect(markdown.split("\n")).toHaveLength(6); // 标题 + 表头 2 行 + 3 行
        removeEreverseHandoff();
        expect(peekEreverseHandoff("projects")).toBeNull();
    });
});
