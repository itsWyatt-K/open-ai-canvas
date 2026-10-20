// 任务临时预览图 store（宿主薄适配）。
//
// 二开版本用它在「任务已提交、成品尚未落盘」时展示临时预览。宿主没有这套设施，
// 这里保持同一订阅合同（useSyncExternalStore 可用），但恒无预览：
// commerce 组件会退化为直接读节点资源 URL，功能不受影响，也不会多打请求。
type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeTaskImagePreviews(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function taskImagePreview(_scope: string, _taskId?: string): string | null {
    return null;
}
