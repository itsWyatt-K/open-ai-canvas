import { Button, Modal, Tag } from "antd";
import copy from "copy-to-clipboard";
import { Check, Copy, ExternalLink, FileText, Info, ShieldCheck } from "lucide-react";
import { useState } from "react";

interface InspirationLicenseModalProps {
    open: boolean;
    onClose: () => void;
    currentSlug?: string;
    sourceUrl?: string;
}

export function InspirationLicenseModal({ open, onClose, currentSlug, sourceUrl }: InspirationLicenseModalProps) {
    const [copied, setCopied] = useState(false);

    const handleCopyTemplate = () => {
        const template = `[Takedown Request / 下架更正申请]
Entry Slug: ${currentSlug || "<填入案例 Slug>"}
Original Source: ${sourceUrl || "<填入原帖链接>"}
Reason / 理由: 我是该作品的合法权利人，申请下架/更正该案例条目。
Verification / 权属证明: <请提供证明材料或发布账号证明>`;
        copy(template);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={[
                <Button key="close" type="primary" onClick={onClose}>
                    我知道了
                </Button>,
            ]}
            width={720}
            title={
                <div className="flex items-center gap-2">
                    <ShieldCheck className="size-5 text-emerald-500" />
                    <span className="font-semibold">灵感库开源许可、来源出处与版权保护规范</span>
                </div>
            }
        >
            <div className="space-y-4 pt-2 text-sm leading-relaxed text-foreground/80">
                <div className="rounded-lg border border-border/60 bg-surface/50 p-3.5">
                    <p className="text-xs text-foreground/70">
                        本项目灵感库汲取并融合了 <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-primary">awesome-seedance</code> 与{" "}
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-primary">goodcase.ai</code>{" "}
                        开源生态。本仓库遵循相同版本的开源许可三元条款，严格保护原作者权益、尊重开源整理劳动，并合规开放工具代码：
                    </p>
                </div>

                {/* 三元条款 */}
                <div className="grid gap-3">
                    <div className="rounded-lg border border-border/70 p-3.5 bg-background">
                        <div className="flex items-center justify-between pb-1.5 border-b border-border/40">
                            <span className="font-semibold text-foreground flex items-center gap-1.5">
                                <span className="inline-flex size-5 items-center justify-center rounded-full bg-blue-500/10 text-xs font-bold text-blue-500">1</span>
                                源代码与工程工具链 (Code)
                            </span>
                            <Tag color="blue">MIT License</Tag>
                        </div>
                        <p className="pt-2 text-xs text-foreground/75">
                            代码（生成器脚本、Agent 技能、工具链、前后端服务）以 <strong>MIT 许可证</strong> 发布。MIT 许可证仅涵盖代码本身，不涵盖受版权保护的创意提示词及媒体资产。
                        </p>
                        <p className="mt-1 text-[11px] text-foreground/50 font-mono">
                            Code (generator scripts, Agent Skill, tooling) is released under the MIT License. Covers code only.
                        </p>
                    </div>

                    <div className="rounded-lg border border-border/70 p-3.5 bg-background">
                        <div className="flex items-center justify-between pb-1.5 border-b border-border/40">
                            <span className="font-semibold text-foreground flex items-center gap-1.5">
                                <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-500/10 text-xs font-bold text-emerald-500">2</span>
                                内容策划与整理 (Curation)
                            </span>
                            <Tag color="green">CC BY 4.0</Tag>
                        </div>
                        <p className="pt-2 text-xs text-foreground/75">
                            内容策划与整理（案例甄选、结构化组织、跨模型度量统计、模板分类提取、中文摘要与提示词汉化）采用 <strong>知识共享 署名 4.0 国际许可协议 (CC BY 4.0)</strong> 授权。如需重复使用，须署名指向 <code className="text-primary font-mono">awesome-seedance / goodcase.ai</code> 及本项目。
                        </p>
                        <p className="mt-1 text-[11px] text-foreground/50 font-mono">
                            Curation (selection, organization, statistics, template extraction, summaries) is licensed under CC BY 4.0. Reuse it with attribution.
                        </p>
                    </div>

                    <div className="rounded-lg border border-border/70 p-3.5 bg-background">
                        <div className="flex items-center justify-between pb-1.5 border-b border-border/40">
                            <span className="font-semibold text-foreground flex items-center gap-1.5">
                                <span className="inline-flex size-5 items-center justify-center rounded-full bg-amber-500/10 text-xs font-bold text-amber-500">3</span>
                                提示词与多媒体内容 (Prompts & Media)
                            </span>
                            <Tag color="orange">原作者保留版权</Tag>
                        </div>
                        <p className="pt-2 text-xs text-foreground/75">
                            <strong>提示词和多媒体内容的版权均严格归属于其原始创作者所有</strong>。提示词文本、创作者摘要、海报图片和视频参考均引用自公开发布的帖子，仅供文档记录、模型复现评估和个人学习之用；每条案例条目均明确附带原始来源出处链接（Source Link）以及对应的 goodcase.ai 档案记录。本平台不授予对基础提示词或多媒体内容的任何超出原帖许可范围的授权。
                        </p>
                        <p className="mt-1 text-[11px] text-foreground/50 font-mono">
                            Prompts and media remain the copyright of their original creators. Quoted from public posts for documentation and study. Every entry links back to source.
                        </p>
                    </div>
                </div>

                {/* 下架与权利人纠错流程 */}
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5">
                    <div className="flex items-center justify-between">
                        <span className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5 text-xs">
                            <Info className="size-4" />
                            权利人下架与更正通道 (Takedown Process)
                        </span>
                        <Button
                            size="small"
                            type="dashed"
                            icon={copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
                            onClick={handleCopyTemplate}
                        >
                            {copied ? "已复制申请模板" : "复制下架申请模板"}
                        </Button>
                    </div>
                    <p className="mt-2 text-xs text-foreground/75 leading-relaxed">
                        如果您是案例材料的合法权利人并希望移除或更正某条目，请提交 Issue 或直接联系我们，并附上该条目的 <strong>Slug 标识符</strong>（如详情页所示）及原始出处链接。平台核实原帖后将立即响应并予以满足：该条目将从底层数据库中彻底下架，并从后续静态生成的所有文件中永久清除。
                    </p>
                    {currentSlug && (
                        <div className="mt-2.5 flex items-center gap-2 rounded bg-background/80 px-2.5 py-1.5 text-xs border border-border/40">
                            <span className="text-foreground/50">当前案例 Slug:</span>
                            <code className="font-mono text-primary font-medium">{currentSlug}</code>
                        </div>
                    )}
                </div>
            </div>
        </Modal>
    );
}
