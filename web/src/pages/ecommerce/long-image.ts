/**
 * 电商长图合并（移植自 pr(1) commerce-image-merge.ts，改为资源 URL 输入）。
 *
 * 与 PR 版本一致的安全边界：
 *   - 一次 1~30 屏；
 *   - 单图 ≤ 32 MiB、总量 ≤ 128 MiB、总像素 ≤ 32M、高度 ≤ 32760（超出明确报错，不静默截断）；
 *   - 顺序解码（不并发 hold 位图），支持 AbortSignal 中断；
 *   - 只在浏览器栅格化，**不自动上传**。
 */

const MAX_SCREENS = 30;
const MAX_SINGLE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_PIXELS = 32_000_000;
const MAX_HEIGHT = 32760;
const TARGET_WIDTH = 2048;

export type LongImageSource = {
    /** 可直接 fetch 的资源 URL（同源或带 cookie）。 */
    url: string;
    /** 用于错误提示的屏名。 */
    label: string;
};

export async function mergeSlotImagesToLongImage(sources: LongImageSource[], signal?: AbortSignal): Promise<Blob> {
    if (!sources.length) throw new Error("没有可合并的图片：请先完成至少一屏生成");
    if (sources.length > MAX_SCREENS) throw new Error(`一次最多合并 ${MAX_SCREENS} 屏`);
    const loaded: Array<{ blob: Blob; width: number; height: number }> = [];
    let totalBytes = 0;
    for (const source of sources) {
        signal?.throwIfAborted();
        const response = await fetch(source.url, { signal, credentials: source.url.startsWith("/") ? "include" : "same-origin" });
        if (!response.ok) throw new Error(`读取「${source.label}」失败（HTTP ${response.status}）`);
        const blob = await response.blob();
        if (blob.size > MAX_SINGLE_BYTES) throw new Error(`「${source.label}」超过 32 MiB，请先缩小后再合并`);
        totalBytes += blob.size;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error("图片总量超过 128 MiB，请分批合并");
        const bitmap = await createImageBitmap(blob);
        const { width, height } = bitmap;
        bitmap.close();
        if (!width || !height || width * height > MAX_PIXELS) throw new Error(`「${source.label}」尺寸过大，无法安全合并`);
        loaded.push({ blob, width, height });
    }
    const width = Math.min(TARGET_WIDTH, ...loaded.map((item) => item.width));
    const heights = loaded.map((item) => Math.round((item.height * width) / item.width));
    const height = heights.reduce((sum, value) => sum + value, 0);
    if (height > MAX_HEIGHT || width * height > MAX_PIXELS) throw new Error("长图超过安全尺寸，请减少屏数后重试");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    try {
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法创建长图画布");
        let y = 0;
        for (let index = 0; index < loaded.length; index += 1) {
            signal?.throwIfAborted();
            const bitmap = await createImageBitmap(loaded[index].blob);
            try {
                context.drawImage(bitmap, 0, y, width, heights[index]);
            } finally {
                bitmap.close();
            }
            y += heights[index];
        }
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("长图编码失败"))), "image/png");
        });
    } finally {
        canvas.width = 0;
        canvas.height = 0;
    }
}

/** 触发浏览器下载（不经过服务端）。 */
export function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // 延迟释放，避免部分浏览器下载未开始就失效。
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
