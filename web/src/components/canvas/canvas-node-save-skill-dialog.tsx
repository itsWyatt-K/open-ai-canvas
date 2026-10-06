import { Button, Checkbox, Input, Modal, Select, message } from "antd";
import { BookmarkPlus } from "lucide-react";
import { useEffect, useState } from "react";

import { createSkill } from "@/services/api/skills";
import type { CanvasNodeData } from "@/types/canvas";

/**
 * 存为技能：把画布图片节点的提示词 + 生成配置沉淀为可复用技能（Lovart「Create Skill」落法）。
 * 生成配置写进指令模板，技能在 Agent 对话中被触发时按模板复现该工作流。
 */

const TAG_OPTIONS = [
    { value: "ecommerce", label: "电商营销" },
    { value: "creative", label: "创意设计" },
    { value: "drama", label: "短剧影视" },
    { value: "social", label: "社媒内容" },
    { value: "others", label: "其他" },
];

function buildInstruction(node: CanvasNodeData) {
    const lines: string[] = [];
    lines.push(`# ${node.title?.slice(0, 30) || "自定义工作流"}`);
    lines.push("");
    lines.push("复现以下画布图片生成工作流。用户提供素材后，按本模板组装提示词并调用图片生成工具。");
    lines.push("");
    lines.push("## 提示词模板");
    lines.push("");
    lines.push(node.metadata?.prompt?.trim() || node.metadata?.content?.slice(0, 400) || "（原图未记录提示词，请与用户确认画面要求）");
    const configBits = [
        node.metadata?.size ? `尺寸 ${node.metadata.size}` : "",
        node.metadata?.quality ? `质量 ${node.metadata.quality}` : "",
    ].filter(Boolean);
    if (configBits.length) {
        lines.push("");
        lines.push("## 默认生成配置");
        lines.push("");
        lines.push(configBits.join("；") + "（用户明确指定时以用户为准）");
    }
    lines.push("");
    lines.push("## 铁律");
    lines.push("");
    lines.push("1. 参考图走 referenceNodeIds，不在提示词里干写产品名；2. 产品外形以用户产品图为准，风格化让位；3. 生成后自查：主体、风格、文字合规。");
    return lines.join("\n");
}

type SaveSkillDialogProps = {
    open: boolean;
    node: CanvasNodeData | null;
    onClose: () => void;
};

export function CanvasNodeSaveSkillDialog({ open, node, onClose }: SaveSkillDialogProps) {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [tag, setTag] = useState("ecommerce");
    const [isPrivate, setIsPrivate] = useState(true);
    const [instruction, setInstruction] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open || !node) return;
        setName(node.title?.slice(0, 30) || "");
        setDescription(`由画布节点「${node.title?.slice(0, 20) || "图片"}」沉淀的复用工作流。${node.metadata?.prompt ? `提示词要点：${node.metadata.prompt.slice(0, 120)}` : ""}`);
        setInstruction(buildInstruction(node));
        setIsPrivate(true);
    }, [open, node]);

    const runSave = async () => {
        if (!node) return;
        if (!name.trim()) return message.warning("请填写技能名称");
        if (!description.trim()) return message.warning("请填写描述（含触发语，便于 Agent 识别何时调用）");
        setSaving(true);
        try {
            await createSkill({
                skillName: name.trim(),
                description: description.trim(),
                instruction: instruction.trim(),
                tag,
                isPrivate,
                markdownUrl: "",
                showcaseMedia: [],
                extraInfo: "",
            });
            message.success("已存入技能中心，可在技能中心「我的创建」查看");
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? `保存失败：${error.message}` : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            title={
                <span className="flex items-center gap-2">
                    <BookmarkPlus className="size-4" /> 存为技能
                </span>
            }
            open={open}
            onCancel={onClose}
            width={560}
            centered
            destroyOnHidden
            footer={
                <div className="flex items-center justify-end gap-2">
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" loading={saving} onClick={() => void runSave()}>
                        保存到技能中心
                    </Button>
                </div>
            }
        >
            <div className="space-y-3">
                <Input placeholder="技能名称" value={name} maxLength={30} onChange={(event) => setName(event.target.value)} />
                <Input.TextArea
                    rows={2}
                    placeholder="描述（写清何时触发，例如「当用户要求白底主图批量出图时调用」）"
                    value={description}
                    maxLength={400}
                    onChange={(event) => setDescription(event.target.value)}
                />
                <div className="flex items-center gap-3">
                    <Select className="w-40" value={tag} onChange={setTag} options={TAG_OPTIONS} />
                    <Checkbox checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)}>
                        仅自己可见
                    </Checkbox>
                </div>
                <div className="space-y-1">
                    <div className="text-xs font-medium opacity-60">指令模板（由节点提示词自动生成，可改）</div>
                    <Input.TextArea rows={8} value={instruction} onChange={(event) => setInstruction(event.target.value)} className="font-mono! text-xs!" />
                </div>
            </div>
        </Modal>
    );
}
