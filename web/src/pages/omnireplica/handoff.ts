/**
 * 全能复刻 · 画布出口快照（与 /ereverse 出口同 pattern）。
 *
 * 纪律：画布页面本轮不可改——重负载走 localStorage 快照 + URL 轻量标记，
 * toast 如实告知「已带入快照，请在节点中粘贴/选择」，严禁造假「已自动填入」。
 * 快照只含蓝图摘要与成片 URL，不含大体积 base64 资产（5MB localStorage 预算）。
 */

export const OMNI_HANDOFF_KEY = "omnireplica-handoff";

export type OmniHandoffShot = { shotId: string; text: string; startMs: number; endMs: number };

export type OmniHandoff = {
    source: "omnireplica";
    at: string;
    title: string;
    blueprintId: string;
    renderKey?: string;
    videoUrl?: string;
    label: string;
    shots: OmniHandoffShot[];
};

const MAX_VIDEO_URL = 2_000;

export function writeOmniHandoff(input: { title: string; blueprintId: string; renderKey?: string; videoUrl?: string | null; label: string; shots: OmniHandoffShot[] }): void {
    const payload: OmniHandoff = {
        source: "omnireplica",
        at: new Date().toISOString(),
        title: input.title,
        blueprintId: input.blueprintId,
        ...(input.renderKey ? { renderKey: input.renderKey } : {}),
        ...(input.videoUrl && input.videoUrl.length <= MAX_VIDEO_URL ? { videoUrl: input.videoUrl } : {}),
        label: input.label,
        shots: input.shots,
    };
    try {
        window.localStorage.setItem(OMNI_HANDOFF_KEY, JSON.stringify(payload));
    } catch {
        // 超配额时丢成片 URL 保摘要（5MB 预算；data: 视频可能超限）
        try {
            window.localStorage.setItem(OMNI_HANDOFF_KEY, JSON.stringify({ ...payload, videoUrl: undefined }));
        } catch {
            /* 快照写入失败不阻断主流程，toast 已如实说明 */
        }
    }
}

/** 画布粘贴用分镜文本（复制进剪贴板，让「粘贴」真实可执行）。 */
export function omniHandoffText(handoff: Pick<OmniHandoff, "title" | "shots">): string {
    const lines = [`【全能复刻】${handoff.title}`, ...handoff.shots.map((shot) => `${shot.shotId} ${Math.round(shot.startMs / 1000)}s-${Math.round(shot.endMs / 1000)}s ${shot.text}`)];
    return lines.join("\n");
}
