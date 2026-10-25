/**
 * 背景图 → 平台画布尺寸适配（cover 裁切）。
 *
 * 为什么需要：nxf 的 live-compose 直接用背景图原始尺寸当画布尺寸
 * （`width, height = bg.size`），于是传 2048x3640 的背景，导出就是 2048x3640，
 * 平台预设的 1080x1920 完全不生效，font_size 的视觉比例也会跟着错。
 * 在进引擎之前先把背景 cover 到目标画布，引擎输出即平台规格，
 * 且不必改动外部 nxf 仓库、不必重启它的服务。
 */

export type FittedBackground = {
    /** cover 到目标尺寸后的图（喂给引擎 / 导出用）。 */
    dataUrl: string;
    /** 实际被裁掉的横向 / 纵向占比（0-1），用于提示。
     *  cover 只会裁掉一个方向，另一个方向为 0。 */
    croppedX: number;
    croppedY: number;
};

function loadImage(source: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("背景图解码失败"));
        image.src = source;
    });
}

/** 等比放大到覆盖整个画布，居中裁掉多余部分（不留黑边、不拉伸）。 */
export async function fitCoverToSize(source: string, width: number, height: number): Promise<FittedBackground> {
    const image = await loadImage(source);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) throw new Error("背景图尺寸无效");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画布初始化失败");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const scale = Math.max(width / naturalWidth, height / naturalHeight);
    const drawWidth = naturalWidth * scale;
    const drawHeight = naturalHeight * scale;
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);

    // 画布尺寸已经是终稿，画质优先；JPEG 0.96 在这类平滑室内图上肉眼无损，
    // 但体积比 PNG 小一个量级，避免几 MB 的 base64 拖慢每一次合成。
    return {
        dataUrl: canvas.toDataURL("image/jpeg", 0.96),
        croppedX: Math.max(0, (drawWidth - width) / drawWidth),
        croppedY: Math.max(0, (drawHeight - height) / drawHeight),
    };
}
