/**
 * 图层精修台 · 统一 Loading 小组件（拍板令阶段三 战役二）。
 *
 * 设计系统里现成的只有 EmptyState（@/components/ui/product/empty-state，直接复用），
 * Loading 没有通用件，这里按同目录小组件补一个，供画布浮层 / 面板内联使用：
 *   - role="status" + aria-live="polite"，读屏用户能听到进展；
 *   - animate-spin 配 motion-reduce:animate-none，尊重「减少动态效果」偏好；
 *   - 颜色只消费 token（text-muted-foreground），明暗双主题自适应。
 */
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export function LoadingState({ label, className }: { label?: string; className?: string }) {
    return (
        <div role="status" aria-live="polite" className={cn("flex flex-col items-center justify-center gap-2 text-muted-foreground", className)}>
            <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" strokeWidth={2} />
            {label ? <span className="text-caption">{label}</span> : null}
        </div>
    );
}
