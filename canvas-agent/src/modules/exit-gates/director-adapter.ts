import { validateAxis } from "./axis-guard.js";
import type { AxisGuardOptions, AxisGuardResult, AxisIssue } from "./axis-guard.js";
import type { Vec3 } from "./contracts.js";

// ─────────────────────────────────────────────────────────────────────────────
// Director 适配层：接入 web 端导演分镜模块（3D 场景）的轴线校验
//
// 与 web/src/lib/canvas/director/director-prompt-compiler.ts 消费的数据结构
// （DirectorScene / DirectorShot / DirectorObject / DirectorCamera）结构兼容：
// 通过 TypeScript 结构化类型直接对齐，无需 import 影策源码。
// 主体解析规则与编译器一致：kind === "actor" || primitive === "character"。
// ─────────────────────────────────────────────────────────────────────────────

export interface DirectorCameraLike {
    id: string;
    transform: { position: readonly [number, number, number] };
    target?: readonly [number, number, number];
}

export interface DirectorObjectLike {
    id?: string;
    name: string;
    kind?: string;
    primitive?: string;
    visible?: boolean;
    transform: { position: readonly [number, number, number] };
}

export interface DirectorSceneLike {
    cameras: readonly DirectorCameraLike[];
    objects: readonly DirectorObjectLike[];
}

export interface DirectorShotLike {
    id: string;
    cameraId: string;
}

export interface DirectorAxisSpec {
    /** 对话双方主体名（objects[].name） */
    subjectAName: string;
    subjectBName: string;
    /** 场次标识，用于问题报告定位；默认 "director-scene" */
    sceneId?: string;
}

function isActorLike(object: DirectorObjectLike): boolean {
    return object.kind === "actor" || object.primitive === "character";
}

/**
 * 对 Director 场景执行 180° 轴线校验。
 *
 * 用法（web 端或 canvas-agent 侧）：
 *   validateDirectorAxis(directorScene, shots, { subjectAName: "阿历", subjectBName: "小满" })
 * 镜头 shot.cameraId → scene.cameras[].id 解析机位坐标；
 * 主体按 name 在可见 actor/character 对象中解析坐标。
 */
export function validateDirectorAxis(
    scene: DirectorSceneLike,
    shots: ReadonlyArray<DirectorShotLike>,
    axis: DirectorAxisSpec,
    options: AxisGuardOptions = {},
): AxisGuardResult {
    const sceneId = axis.sceneId ?? "director-scene";
    const issues: AxisIssue[] = [];

    const visibleActors = scene.objects.filter((object) => (object.visible ?? true) && isActorLike(object));
    const subjectA = visibleActors.find((object) => object.name === axis.subjectAName);
    const subjectB = visibleActors.find((object) => object.name === axis.subjectBName);

    if (!subjectA || !subjectB) {
        const missing = [axis.subjectAName, axis.subjectBName].filter(
            (name) => !visibleActors.some((object) => object.name === name),
        );
        return {
            passed: false,
            issues: [
                {
                    type: "MISSING_SUBJECT",
                    sceneId,
                    shotIds: shots.map((shot) => shot.id),
                    severity: "hard",
                    detail: `Director 场景中找不到轴线主体 ${missing.map((name) => `"${name}"`).join("、")}（仅检索可见的 actor/character 对象）；请核对主体名称。`,
                },
            ],
            autofixProposals: [],
            sceneSummaries: [],
        };
    }

    const cameraById = new Map(scene.cameras.map((camera) => [camera.id, camera]));
    const resolvedShots: Array<{ shotId: string; cameraPos: Vec3 }> = [];
    const unresolved: string[] = [];
    for (const shot of shots) {
        const camera = cameraById.get(shot.cameraId);
        if (!camera) {
            unresolved.push(shot.id);
            continue;
        }
        resolvedShots.push({ shotId: shot.id, cameraPos: camera.transform.position as Vec3 });
    }
    if (unresolved.length > 0) {
        issues.push({
            type: "SCHEMA_INVALID",
            sceneId,
            shotIds: unresolved,
            severity: "hard",
            detail: `镜头 ${unresolved.join("、")} 引用的 cameraId 在场景 cameras 中不存在，无法纳入轴线判定。`,
        });
    }

    const geometric = validateAxis(
        [{ sceneId, subjectA: subjectA.transform.position as Vec3, subjectB: subjectB.transform.position as Vec3, shots: resolvedShots }],
        options,
    );
    const allIssues = [...issues, ...geometric.issues];
    return {
        passed: allIssues.every((issue) => issue.severity !== "hard"),
        issues: allIssues,
        autofixProposals: geometric.autofixProposals,
        sceneSummaries: geometric.sceneSummaries,
    };
}
