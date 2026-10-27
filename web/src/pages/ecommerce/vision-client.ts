// 电商视觉算子（nxf :8823）前端客户端：图层精修台 / 透明主体提取共用。
// nxf 服务 CORS 全开（本机无鉴权），前端直连；基址可用 VITE_NXF_BASE 覆盖。
export const NXF_BASE = (import.meta.env.VITE_NXF_BASE as string | undefined) ?? "http://127.0.0.1:8823";

export async function nxfPost<T extends object>(path: string, body: unknown): Promise<T & { ok: boolean; error?: string }> {
    const response = await fetch(NXF_BASE + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`引擎 ${path} 返回 ${response.status}`);
    return (await response.json()) as T & { ok: boolean; error?: string };
}

/** 站内资源 URL → data URL（喂给 nxf 算子用）。 */
export async function urlToDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`读取图片失败（${response.status}）`);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

/** dataURL → 三段式上传为站内资源，返回 resourceId（精修台草图垫图/参考图用）。 */
export async function uploadDataUrlAsResource(dataUrl: string, fileName: string): Promise<string> {
    const blob = await (await fetch(dataUrl)).blob();
    const create = await fetch("/api/resources/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, size: blob.size }),
    }).then((r) => r.json());
    if (!create?.data?.uploadId) throw new Error(create?.msg || "创建上传会话失败");
    const put = await fetch(`/api/resources/uploads/${create.data.uploadId}/chunks/0`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
    });
    if (!put.ok) throw new Error(`上传失败（${put.status}）`);
    const done = await fetch(`/api/resources/uploads/${create.data.uploadId}/complete`, { method: "POST" }).then((r) => r.json());
    if (!done?.data?.resource?.id) throw new Error(done?.msg || "资源落库失败");
    return done.data.resource.id;
}

/** 商品透明主体提取（BiRefNet）结果缓存：localStorage 按 resourceId 存 dataURL。 */
const CUTOUT_PREFIX = "ecom-cutout:";

export function cachedCutout(resourceId: string): string {
    try {
        return localStorage.getItem(CUTOUT_PREFIX + resourceId) || "";
    } catch {
        return "";
    }
}

export function cacheCutout(resourceId: string, dataUrl: string): void {
    try {
        localStorage.setItem(CUTOUT_PREFIX + resourceId, dataUrl);
    } catch {
        // 超配额（dataURL 大）时静默放弃缓存，仅本次会话可用。
    }
}
