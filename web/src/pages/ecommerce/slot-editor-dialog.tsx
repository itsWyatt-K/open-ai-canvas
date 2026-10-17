/**
 * 单屏编辑器弹窗（阶段 1 · 移植自 pr(1) commerce-screen-editor.tsx）。
 *
 * 与后端新增接口对接：
 *   - 「仅保存参数」→ PUT /ecommerce/slots/:id/prompt
 *   - 「生成此屏 / 重新生成」→ POST /ecommerce/slots/:id/regenerate（confirmCost=true）
 *
 * 保留 pr(1) 的核心纪律：**完整提示词覆盖（promptOverride）优先，AI 重策划不覆盖**；
 * 空文案是合法的纯图卡，不强制补文字。
 */
import { useEffect, useState } from "react";
import { App, Button, Input, Select } from "antd";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

import type { EcommerceSlotSummary } from "@/services/api/ecommerce";
import { regenerateEcommerceSlot, saveEcommerceSlotPrompt, type EcommerceSlotPromptBody } from "@/services/api/ecommerce";
import { AppModal } from "@/components/ui/product/app-modal";

const RATIO_OPTIONS = [
    { label: "跟随本组", value: "" },
    { label: "21:9", value: "21:9" },
    { label: "16:9", value: "16:9" },
    { label: "3:2", value: "3:2" },
    { label: "4:3", value: "4:3" },
    { label: "1:1", value: "1:1" },
    { label: "3:4", value: "3:4" },
    { label: "2:3", value: "2:3" },
    { label: "9:16", value: "9:16" },
];

type Props = {
    slot: EcommerceSlotSummary;
    index: number;
    total: number;
    onClose: () => void;
    onNavigate: (direction: number) => void;
    /** 保存/重生成成功后回调（刷新详情）。 */
    onChanged: () => void | Promise<void>;
};

export function EcommerceSlotEditorDialog({ slot, index, total, onClose, onNavigate, onChanged }: Props) {
    const { message, modal } = App.useApp();
    const [title, setTitle] = useState(slot.title || "");
    const [copy, setCopy] = useState(slot.copy || "");
    const [prompt, setPrompt] = useState("");
    const [promptOverride, setPromptOverride] = useState("");
    const [sceneType, setSceneType] = useState("");
    const [sellingPoints, setSellingPoints] = useState("");
    const [aspectRatio, setAspectRatio] = useState("");
    const [saving, setSaving] = useState(false);
    const [generating, setGenerating] = useState(false);

    // 切换槽位时重置表单（详情接口暂不返回 prompt 明细，画面描述留空由用户填写或保留后端值）。
    useEffect(() => {
        setTitle(slot.title || "");
        setCopy(slot.copy || "");
        setSceneType("");
        setSellingPoints("");
        setAspectRatio("");
        setPrompt("");
        setPromptOverride("");
    }, [slot.id, slot.title, slot.copy]);

    const body = (): EcommerceSlotPromptBody => ({
        title,
        copy,
        sceneType,
        sellingPoints,
        aspectRatio,
        prompt,
        promptOverride,
    });

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveEcommerceSlotPrompt(slot.id, body());
            message.success("已保存该屏参数");
            await onChanged();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const handleGenerate = () => {
        // 收费确认不可绕过（pr(1) 纪律）：重新生成会消耗积分。
        modal.confirm({
            title: "确认重新生成这一屏？",
            content: "将按当前参数提交 1 个生图任务并计入版本号；失败项不会自动重复扣费。",
            okText: "确认生成",
            cancelText: "取消",
            onOk: async () => {
                setGenerating(true);
                try {
                    await regenerateEcommerceSlot(slot.id, body());
                    message.success("已提交该屏生成任务");
                    await onChanged();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "生成任务提交失败");
                } finally {
                    setGenerating(false);
                }
            },
        });
    };

    const running = slot.status === "running" || slot.status === "uncertain";

    return (
        <AppModal
            title={`编辑第 ${index + 1} 屏 · ${slot.title || slot.slotKey}`}
            open
            width={720}
            onCancel={onClose}
            footer={
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-foreground/50">
                        {running ? "该屏正在生成或结果待确认，暂不能保存" : "修改后点「仅保存参数」落库；生成前会另行确认费用"}
                    </span>
                    <div className="flex items-center gap-2">
                        <Button onClick={onClose}>取消</Button>
                        <Button loading={saving} disabled={running} onClick={() => void handleSave()}>
                            仅保存参数
                        </Button>
                        <Button type="primary" loading={generating} disabled={running} onClick={handleGenerate}>
                            生成此屏
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="flex flex-col gap-4 text-sm">
                <div className="flex items-center justify-between">
                    <Button size="small" icon={<ChevronLeft className="size-3.5" />} disabled={index === 0} onClick={() => onNavigate(-1)}>
                        上一屏
                    </Button>
                    <span className="text-xs text-foreground/55">
                        {index + 1} / {total} · 状态 {slot.status} · 版本 v{slot.currentVersion}
                    </span>
                    <Button size="small" icon={<ChevronRight className="size-3.5" />} disabled={index === total - 1} onClick={() => onNavigate(1)}>
                        下一屏
                    </Button>
                </div>

                <label className="flex flex-col gap-1">
                    <span className="text-xs text-foreground/55">屏主题</span>
                    <Input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="具体视觉主题，不要写「详情 7」这类占位" />
                </label>

                <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1">
                        <span className="text-xs text-foreground/55">场景类型</span>
                        <Input value={sceneType} maxLength={200} onChange={(event) => setSceneType(event.target.value)} placeholder="产品特写 / 使用场景 / 参数说明" />
                    </label>
                    <label className="flex flex-col gap-1">
                        <span className="text-xs text-foreground/55">单屏比例</span>
                        <Select value={aspectRatio} options={RATIO_OPTIONS} onChange={(value) => setAspectRatio(value ?? "")} />
                    </label>
                </div>

                <label className="flex flex-col gap-1">
                    <span className="text-xs text-foreground/55">卖点绑定（仅填写已确认事实）</span>
                    <Input value={sellingPoints} onChange={(event) => setSellingPoints(event.target.value)} placeholder="如：38dB 静音 · IPX7 防水" />
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs text-foreground/55">画面文案（留空 = 本屏纯图无字）</span>
                    <Input.TextArea value={copy} rows={3} maxLength={8000} onChange={(event) => setCopy(event.target.value)} placeholder="需要上图的标题、正文与参数；留空按纯图生成" />
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs text-foreground/55">画面描述</span>
                    <Input.TextArea
                        value={prompt}
                        rows={3}
                        maxLength={12000}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="具体机位、主体占比、场景道具、光影材质、配色与文案留白"
                    />
                </label>

                <label className="flex flex-col gap-1">
                    <span className="flex items-center gap-1 text-xs text-foreground/55">
                        <Sparkles className="size-3.5" />
                        完整提示词覆盖
                        <span className="text-foreground/40">（可选；填写后优先使用，重新策划不会覆盖）</span>
                    </span>
                    <Input.TextArea
                        value={promptOverride}
                        rows={5}
                        maxLength={16000}
                        onChange={(event) => setPromptOverride(event.target.value)}
                        placeholder="留空按上述参数自动组装；填写后直接使用此处完整提示词"
                    />
                </label>
            </div>
        </AppModal>
    );
}
