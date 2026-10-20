// 宿主媒体接口薄适配（PR 集成参考 05）。
//
// 上游没有二开那套 LibTV/直传/临时回显设施，这里用宿主已有的资源解析 hook 包出
// commerce 组件需要的 `{ url, thumbnail, failed }` 合同：
//   - 缩略图优先（variant="thumbnail"），避免卡片墙直接拉原图；
//   - 按视口 gate（enabled 由 use-near-viewport 控制），不在缩放时重复下载；
//   - 用户隔离与资源授权由 useNodeResourceUrl 内部保证。
import { useNodeResourceUrl } from "./canvas-node-media-content";
import type { CanvasNodeData } from "@/types/canvas";

export type CanvasImageSource = {
    url: string;
    thumbnail: boolean;
    failed: boolean;
};

export function useCanvasImageSource(node: CanvasNodeData, enabled: boolean): CanvasImageSource {
    const source = useNodeResourceUrl(node, enabled, "thumbnail");
    const hasInput = Boolean(node.metadata?.storageKey || node.metadata?.content);
    const url = enabled ? source.url : "";
    return {
        url,
        thumbnail: Boolean(url),
        // 加载已结束、确实有素材却拿不到地址 → 视为失败（卡片显示占位而不是空白）。
        failed: enabled && hasInput && !source.loading && !url,
    };
}
