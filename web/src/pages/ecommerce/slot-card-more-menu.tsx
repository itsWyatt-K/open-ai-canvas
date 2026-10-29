// 战役一：按钮三级收敛 —— 卡片底部「⋯」更多菜单（antd Popover 行式菜单，不引新依赖）。
// 「详细编辑」不再是平铺按钮，与「送入自由画布深加工」（带场景提示文案）一起收进这里。
import { useState } from "react";
import { Button, Popover } from "antd";
import { MoreHorizontal } from "lucide-react";

export function SlotMoreMenu({
    generated, onEdit, onRetouch, onSendToCanvas,
}: {
    /** 已出图（有 resourceId）：主按钮是「分层精修」，画布深加工进菜单；未出图则精修台进菜单。 */
    generated: boolean;
    onEdit: () => void;
    onRetouch: () => void;
    onSendToCanvas: () => void;
}) {
    const [open, setOpen] = useState(false);
    const items: { key: string; label: string; hint: string; run: () => void }[] = [
        {
            key: "edit",
            label: "🔧 详细编辑",
            hint: "改标题 / 画面文案 / 底层提示词 / 尺寸比例",
            run: onEdit,
        },
        ...(generated
            ? [{
                key: "canvas",
                label: "🎨 送入自由画布深加工",
                hint: "要大改构图或换风格时用：画布内有垫图再创作、画质增强、方向校正等全套工具",
                run: onSendToCanvas,
            }]
            : [{
                key: "retouch",
                label: "📑 分层 / 精修台",
                hint: "未出图也能进：透明主体 + 文字层草图，先排版再生成",
                run: onRetouch,
            }]),
    ];
    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            arrow={false}
            open={open}
            onOpenChange={setOpen}
            destroyOnHidden
            styles={{
                root: { zIndex: "var(--z-popover)" },
                container: {
                    padding: 4,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--r-md)",
                },
            }}
            content={
                <div className="ecommerce-slot-more-menu">
                    {items.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            className="ecommerce-slot-more-item"
                            onClick={() => {
                                setOpen(false);
                                item.run();
                            }}
                        >
                            <strong>{item.label}</strong>
                            <span>{item.hint}</span>
                        </button>
                    ))}
                </div>
            }
        >
            <Button
                size="small"
                className="!px-1.5"
                aria-label="更多操作"
                title="更多操作"
                icon={<MoreHorizontal className="size-4" />}
            />
        </Popover>
    );
}
