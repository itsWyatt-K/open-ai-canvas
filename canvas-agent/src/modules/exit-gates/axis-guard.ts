import { storyboardSchema, type Vec3 } from "./contracts.js";

// ─────────────────────────────────────────────────────────────────────────────
// S4 出口门禁 · 180° 轴线（越轴）几何校验器
//
// 设计原则：不请模型"不要越轴"，而是让分镜数据结构上无法越轴——
// 分镜以结构化 JSON 产出（每镜含 cameraPosition），轴线按场次声明，
// 越轴检测退化为地面平面上的叉积符号计算。10 行几何，零语义理解。
//
// 纯几何核心零依赖；storyboard 校验走 zod 契约。
// 坐标系：y 向上，x-z 为地面平面。
// ─────────────────────────────────────────────────────────────────────────────

export type AxisIssueType =
    | "CROSSED_AXIS" // 越轴（hard）：机位越过轴线到对侧
    | "SPLIT_SCENE" // 场内对半分布（hard）：疑似整体越轴，需人工复核
    | "ON_AXIS" // 机位落在轴线上（soft）：中性镜头，可作重定向镜但需确认
    | "DEGENERATE_AXIS" // 轴线两端重合（hard）：数据错误，无法判定
    | "MISSING_SUBJECT" // 轴线主体未定义（hard）
    | "SCHEMA_INVALID"; // 分镜 JSON 不符合 S4 出口契约（hard）

export interface AxisIssue {
    type: AxisIssueType;
    sceneId: string;
    shotIds: string[];
    severity: "hard" | "soft";
    detail: string;
}

export interface CameraMirrorFix {
    proposalId: string;
    kind: "mirror_camera";
    sceneId: string;
    shotId: string;
    currentCamera: Vec3;
    suggestedCamera: Vec3;
    note: string;
}

export interface AxisSceneInput {
    sceneId: string;
    /** 轴线两端主体坐标（对话双方） */
    subjectA: Vec3;
    subjectB: Vec3;
    shots: ReadonlyArray<{ shotId: string; cameraPos: Vec3 }>;
}

export interface AxisGuardOptions {
    /** 判定"机位在轴线上"的叉积容差，默认 0.001（单位与场景一致，米制即 1mm） */
    epsilon?: number;
}

export interface SceneAxisSummary {
    sceneId: string;
    shotCount: number;
    sideA: string[];
    sideB: string[];
    onAxis: string[];
}

export interface AxisGuardResult {
    /** 无 hard 违规时为 true */
    passed: boolean;
    issues: AxisIssue[];
    autofixProposals: CameraMirrorFix[];
    sceneSummaries: SceneAxisSummary[];
}

function signOf(cross: number): 1 | -1 | 0 {
    if (cross > 0) return 1;
    if (cross < 0) return -1;
    return 0;
}

/** 地面平面 (x, z) 上的叉积：轴向量 × 机位相对向量 */
function crossOnGround(subjectA: Vec3, subjectB: Vec3, camera: Vec3): number {
    const dx = subjectB[0] - subjectA[0];
    const dz = subjectB[2] - subjectA[2];
    const relx = camera[0] - subjectA[0];
    const relz = camera[2] - subjectA[2];
    return dx * relz - dz * relx;
}

/**
 * 把机位沿轴线镜像到对侧：y 保持不变，(x, z) 相对轴线做反射。
 * 镜像后机位到轴线的距离不变、俯仰机位语义不变，仅换侧。
 */
export function mirrorCameraAcrossAxis(subjectA: Vec3, subjectB: Vec3, camera: Vec3): Vec3 {
    const ax = subjectA[0];
    const az = subjectA[2];
    const dx = subjectB[0] - ax;
    const dz = subjectB[2] - az;
    const len2 = Math.max(Number.EPSILON, dx * dx + dz * dz);
    const relx = camera[0] - ax;
    const relz = camera[2] - az;
    const t = (relx * dx + relz * dz) / len2;
    const px = ax + t * dx;
    const pz = az + t * dz;
    return [2 * px - camera[0], camera[1], 2 * pz - camera[2]];
}

/**
 * 纯几何核心：对若干"场次（轴线 + 机位列表）"执行 180° 轴线校验。
 *
 * 判定逻辑：
 * 1. 每场戏以多数派机位一侧为基准侧；
 * 2. 少数派机位 → CROSSED_AXIS（hard），并生成镜像修复提案；
 * 3. 两侧对半 → SPLIT_SCENE（hard），整场退回人工复核；
 * 4. 机位叉积≈0 → ON_AXIS（soft），中性镜头，不阻断但提示确认。
 */
export function validateAxis(
    scenes: ReadonlyArray<AxisSceneInput>,
    options: AxisGuardOptions = {},
): AxisGuardResult {
    const epsilon = options.epsilon ?? 0.001;
    const issues: AxisIssue[] = [];
    const proposals: CameraMirrorFix[] = [];
    const summaries: SceneAxisSummary[] = [];

    for (const scene of scenes) {
        const summary: SceneAxisSummary = {
            sceneId: scene.sceneId,
            shotCount: scene.shots.length,
            sideA: [],
            sideB: [],
            onAxis: [],
        };

        const dx = scene.subjectB[0] - scene.subjectA[0];
        const dz = scene.subjectB[2] - scene.subjectA[2];
        if (dx * dx + dz * dz <= epsilon * epsilon) {
            issues.push({
                type: "DEGENERATE_AXIS",
                sceneId: scene.sceneId,
                shotIds: scene.shots.map((shot) => shot.shotId),
                severity: "hard",
                detail: `场次 ${scene.sceneId} 的轴线两端主体坐标重合，无法建立轴线；请检查主体坐标数据。`,
            });
            summaries.push(summary);
            continue;
        }

        const sideOf = new Map<string, 1 | -1 | 0>();
        for (const shot of scene.shots) {
            const cross = crossOnGround(scene.subjectA, scene.subjectB, shot.cameraPos);
            const side = Math.abs(cross) <= epsilon ? 0 : signOf(cross);
            sideOf.set(shot.shotId, side);
            if (side === 1) summary.sideA.push(shot.shotId);
            else if (side === -1) summary.sideB.push(shot.shotId);
            else summary.onAxis.push(shot.shotId);
        }

        const countA = summary.sideA.length;
        const countB = summary.sideB.length;

        if (countA === 0 && countB === 0) {
            if (scene.shots.length > 0) {
                issues.push({
                    type: "ON_AXIS",
                    sceneId: scene.sceneId,
                    shotIds: scene.shots.map((shot) => shot.shotId),
                    severity: "soft",
                    detail: `场次 ${scene.sceneId} 全部机位落在轴线上；中性机位可作重定向镜，但请人工确认是否有意为之。`,
                });
            }
        } else if (countA === countB) {
            issues.push({
                type: "SPLIT_SCENE",
                sceneId: scene.sceneId,
                shotIds: scene.shots.map((shot) => shot.shotId),
                severity: "hard",
                detail: `场次 ${scene.sceneId} 机位在轴线两侧对半分布（甲侧 ${countA} / 乙侧 ${countB}），疑似整体越轴，需人工复核或重新设计机位。`,
            });
            if (summary.onAxis.length > 0) {
                issues.push({
                    type: "ON_AXIS",
                    sceneId: scene.sceneId,
                    shotIds: [...summary.onAxis],
                    severity: "soft",
                    detail: `场次 ${scene.sceneId} 存在落在轴线上的机位（${summary.onAxis.join("、")}）。`,
                });
            }
        } else {
            const majoritySide: 1 | -1 = countA > countB ? 1 : -1;
            const minority = majoritySide === 1 ? summary.sideB : summary.sideA;
            for (const shotId of minority) {
                issues.push({
                    type: "CROSSED_AXIS",
                    sceneId: scene.sceneId,
                    shotIds: [shotId],
                    severity: "hard",
                    detail: `镜头 ${shotId} 越轴：机位越过场次 ${scene.sceneId} 的轴线到${majoritySide === 1 ? "乙" : "甲"}侧，与场内多数机位（${majoritySide === 1 ? "甲" : "乙"}侧）方向相反。`,
                });
                const shot = scene.shots.find((item) => item.shotId === shotId);
                if (shot) {
                    const mirrored = mirrorCameraAcrossAxis(scene.subjectA, scene.subjectB, shot.cameraPos);
                    proposals.push({
                        proposalId: `mirror:${scene.sceneId}:${shotId}`,
                        kind: "mirror_camera",
                        sceneId: scene.sceneId,
                        shotId,
                        currentCamera: shot.cameraPos,
                        suggestedCamera: mirrored,
                        note: `将镜头 ${shotId} 机位沿轴线镜像至 (${mirrored.map((value) => Number(value.toFixed(3))).join(", ")})，保持与场内多数机位同侧、机位距离不变。`,
                    });
                }
            }
            if (summary.onAxis.length > 0) {
                issues.push({
                    type: "ON_AXIS",
                    sceneId: scene.sceneId,
                    shotIds: [...summary.onAxis],
                    severity: "soft",
                    detail: `场次 ${scene.sceneId} 存在落在轴线上的机位（${summary.onAxis.join("、")}）；中性机位可作重定向镜，请人工确认。`,
                });
            }
        }
        summaries.push(summary);
    }

    return {
        passed: issues.every((issue) => issue.severity !== "hard"),
        issues,
        autofixProposals: proposals,
        sceneSummaries: summaries,
    };
}

/**
 * S4 出口门禁入口：校验结构化分镜 JSON 并执行 180° 轴线几何校验。
 * 输入不满足契约（SCHEMA_INVALID）、轴线主体缺失（MISSING_SUBJECT）、
 * 镜头引用未定义场次，均按 hard 违规报告，不进入几何判定。
 */
export function validateStoryboardAxis(input: unknown, options: AxisGuardOptions = {}): AxisGuardResult {
    const parsed = storyboardSchema.safeParse(input);
    if (!parsed.success) {
        const details = parsed.error.issues
            .slice(0, 8)
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("；");
        return {
            passed: false,
            issues: [
                {
                    type: "SCHEMA_INVALID",
                    sceneId: "-",
                    shotIds: [],
                    severity: "hard",
                    detail: `分镜 JSON 不符合 S4 出口契约（subjects/scenes/shots/cameraPosition/axisSubjectIds 必填）：${details}`,
                },
            ],
            autofixProposals: [],
            sceneSummaries: [],
        };
    }

    const storyboard = parsed.data;
    const subjectById = new Map(storyboard.subjects.map((subject) => [subject.id, subject]));
    const issues: AxisIssue[] = [];
    const sceneInputs: AxisSceneInput[] = [];

    for (const scene of storyboard.scenes) {
        const subjectA = subjectById.get(scene.axisSubjectIds[0]);
        const subjectB = subjectById.get(scene.axisSubjectIds[1]);
        if (!subjectA || !subjectB) {
            const missing = [scene.axisSubjectIds[0], scene.axisSubjectIds[1]].filter(
                (id) => !subjectById.has(id),
            );
            issues.push({
                type: "MISSING_SUBJECT",
                sceneId: scene.sceneId,
                shotIds: [],
                severity: "hard",
                detail: `场次 ${scene.sceneId} 的轴线主体 ${missing.map((id) => `"${id}"`).join("、")} 未在 subjects 中定义。`,
            });
            continue;
        }
        sceneInputs.push({
            sceneId: scene.sceneId,
            subjectA: subjectA.position as Vec3,
            subjectB: subjectB.position as Vec3,
            shots: storyboard.shots
                .filter((shot) => shot.sceneId === scene.sceneId)
                .map((shot) => ({ shotId: shot.shotId, cameraPos: shot.cameraPosition as Vec3 })),
        });
    }

    const knownSceneIds = new Set(storyboard.scenes.map((scene) => scene.sceneId));
    const orphanShots = storyboard.shots.filter((shot) => !knownSceneIds.has(shot.sceneId));
    if (orphanShots.length > 0) {
        issues.push({
            type: "SCHEMA_INVALID",
            sceneId: "-",
            shotIds: orphanShots.map((shot) => shot.shotId),
            severity: "hard",
            detail: `镜头 ${orphanShots.map((shot) => shot.shotId).join("、")} 引用了未定义的场次（${orphanShots.map((shot) => shot.sceneId).join("、")}），无法纳入轴线判定。`,
        });
    }

    const geometric = validateAxis(sceneInputs, options);
    const allIssues = [...issues, ...geometric.issues];
    return {
        passed: allIssues.every((issue) => issue.severity !== "hard"),
        issues: allIssues,
        autofixProposals: geometric.autofixProposals,
        sceneSummaries: geometric.sceneSummaries,
    };
}
