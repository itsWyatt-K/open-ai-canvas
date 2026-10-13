// 生成配置栏（核心配置版）：并发/执行模式/质量/三模型/主图详情页规格/标题参数
// + 预设（保存/应用/删除）+「保存并应用」。桌面版 1:1 全字段面板由 F7 细排。
import { useEffect } from "react";
import { App, Button, Input, InputNumber, Segmented, Select } from "antd";
import { PanelRightClose, PanelRightOpen, Plus, Trash2 } from "lucide-react";

import type { EcommerceConfig } from "@/services/api/ecommerce";
import { useEcommerceWorkspaceStore } from "@/stores/use-ecommerce-store";

const RATIO_OPTIONS = ["1:1", "2:3", "3:2", "3:4", "9:16"];
const TEXT_MODE_OPTIONS = [
    { label: "按需排版", value: "typeset" },
    { label: "纯图不排字", value: "none" },
];
const QUALITY_OPTIONS = [
    { label: "自动", value: "auto" },
    { label: "高", value: "high" },
    { label: "中", value: "medium" },
    { label: "低", value: "low" },
];

export function EcommerceConfigPanel({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
    const { message } = App.useApp();
    const config = useEcommerceWorkspaceStore((state) => state.config);
    const presets = useEcommerceWorkspaceStore((state) => state.presets);
    const saving = useEcommerceWorkspaceStore((state) => state.saving);
    const refreshConfig = useEcommerceWorkspaceStore((state) => state.refreshConfig);
    const refreshPresets = useEcommerceWorkspaceStore((state) => state.refreshPresets);
    const saveConfig = useEcommerceWorkspaceStore((state) => state.saveConfig);
    const savePreset = useEcommerceWorkspaceStore((state) => state.savePreset);
    const removePreset = useEcommerceWorkspaceStore((state) => state.removePreset);

    useEffect(() => {
        void refreshConfig();
        void refreshPresets();
    }, [refreshConfig, refreshPresets]);

    // 本地编辑草稿：未保存时不影响 store，保存时整体提交
    const patch = (changes: Partial<EcommerceConfig>) => {
        if (!config) return;
        void saveConfig({ ...config, ...changes });
    };
    const patchSpec = (kind: "hero" | "detail", changes: Partial<EcommerceConfig["hero"]>) => {
        if (!config) return;
        void saveConfig({ ...config, [kind]: { ...config[kind], ...changes } });
    };

    const handleSavePreset = () => {
        // 简化交互：浏览器原生 prompt 取预设名（F7 换正式弹窗）
        const name = (window.prompt("预设名称（如：抖音电商默认）") || "").trim();
        if (!name) return;
        void savePreset(name).then((ok) => {
            if (ok) message.success(`预设「${name}」已保存`);
        });
    };

    return (
        <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-border/60 bg-surface">
            <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <strong className="text-sm">生成配置</strong>
                <Button size="small" type="text" onClick={onToggle} icon={collapsed ? <PanelRightOpen className="size-4" /> : <PanelRightClose className="size-4" />} aria-label={collapsed ? "展开配置" : "收起配置"} />
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-3">
                {!config ? (
                    <p className="text-sm text-foreground/55">正在读取配置…</p>
                ) : (
                    <div className="flex flex-col gap-5 text-sm">
                        {/* 预设 */}
                        <section className="flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <span className="font-medium opacity-75">创作预设</span>
                                <Button size="small" type="text" onClick={() => void handleSavePreset()} icon={<Plus className="size-3.5" />}>
                                    保存预设
                                </Button>
                            </div>
                            {presets.length === 0 ? (
                                <p className="text-xs text-foreground/50">暂无预设，调好配置后可保存复用</p>
                            ) : (
                                <ul className="flex flex-col gap-1">
                                    {presets.map((preset) => (
                                        <li key={preset.id} className="flex items-center justify-between gap-2 rounded border border-border/40 px-2 py-1">
                                            <button
                                                type="button"
                                                className="min-w-0 flex-1 truncate text-left text-xs hover:text-primary"
                                                onClick={() => void saveConfig(preset.config).then((ok) => ok && message.success(`已应用「${preset.name}」`))}
                                            >
                                                {preset.name}
                                            </button>
                                            <Button size="small" type="text" danger onClick={() => void removePreset(preset.id)} icon={<Trash2 className="size-3" />} aria-label={`删除预设 ${preset.name}`} />
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </section>

                        {/* 执行策略 */}
                        <section className="flex flex-col gap-3">
                            <span className="font-medium opacity-75">执行策略</span>
                            <label className="flex items-center justify-between">
                                <span className="text-foreground/70">同时处理商品数</span>
                                <InputNumber min={1} max={5} size="small" value={config.taskConcurrency} onChange={(value) => patch({ taskConcurrency: Number(value) || 1 })} />
                            </label>
                            <label className="flex items-center justify-between">
                                <span className="text-foreground/70">执行模式</span>
                                <Segmented
                                    size="small"
                                    value={config.mode}
                                    options={[
                                        { label: "全自动", value: "auto" },
                                        { label: "先审方案", value: "review" },
                                    ]}
                                    onChange={(value) => patch({ mode: String(value) })}
                                />
                            </label>
                            <label className="flex items-center justify-between">
                                <span className="text-foreground/70">图片质量</span>
                                <Select size="small" className="w-28" value={config.quality} options={QUALITY_OPTIONS} onChange={(value) => patch({ quality: value })} />
                            </label>
                        </section>

                        {/* 模型 */}
                        <section className="flex flex-col gap-3">
                            <span className="font-medium opacity-75">模型（逻辑模型 ID）</span>
                            <Input size="small" placeholder="策划模型 ID" value={config.plannerModelId} onChange={(event) => patch({ plannerModelId: event.target.value })} />
                            <Input size="small" placeholder="生图模型 ID" value={config.imageModelId} onChange={(event) => patch({ imageModelId: event.target.value })} />
                            <Input size="small" placeholder="标题模型 ID（留空同策划）" value={config.titleModelId} onChange={(event) => patch({ titleModelId: event.target.value })} />
                            <p className="text-xs text-foreground/45">模型下拉选择器施工中（F7），当前可直接粘贴模型 ID；策划/标题需支持看图，生图需支持参考图</p>
                        </section>

                        {/* 主图规格 */}
                        <SpecSection
                            title="主图"
                            spec={config.hero}
                            onPatch={(changes) => patchSpec("hero", changes)}
                        />
                        <SpecSection
                            title="详情页"
                            spec={config.detail}
                            onPatch={(changes) => patchSpec("detail", changes)}
                        />

                        {/* 标题 */}
                        <section className="flex flex-col gap-3">
                            <span className="font-medium opacity-75">标题</span>
                            <label className="flex items-center justify-between">
                                <span className="text-foreground/70">生成数量</span>
                                <InputNumber min={1} max={20} size="small" value={config.titleCount} onChange={(value) => patch({ titleCount: Number(value) || 1 })} />
                            </label>
                            <label className="flex items-center justify-between">
                                <span className="text-foreground/70">最多字符</span>
                                <InputNumber min={1} max={200} size="small" value={config.titleMaxLength} onChange={(value) => patch({ titleMaxLength: Number(value) || 1 })} />
                            </label>
                        </section>
                    </div>
                )}
            </div>

            <footer className="sticky bottom-0 border-t border-border/60 bg-surface px-4 py-3">
                <Button type="primary" block loading={saving} onClick={() => void refreshConfig().then(() => message.success("配置已读取最新值"))}>
                    刷新配置
                </Button>
                <p className="mt-2 text-xs leading-5 text-foreground/45">保存后立即用于所有任务的后续请求；已发请求正常收尾，成品保留。</p>
            </footer>
        </aside>
    );
}

function SpecSection({ title, spec, onPatch }: { title: string; spec: EcommerceConfig["hero"]; onPatch: (changes: Partial<EcommerceConfig["hero"]>) => void }) {
    return (
        <section className="flex flex-col gap-3">
            <span className="font-medium opacity-75">{title}</span>
            <label className="flex items-center justify-between">
                <span className="text-foreground/70">生成数量</span>
                <InputNumber min={1} max={20} size="small" value={spec.count} onChange={(value) => onPatch({ count: Number(value) || 1 })} />
            </label>
            <label className="flex items-center justify-between">
                <span className="text-foreground/70">比例</span>
                <Select size="small" className="w-28" value={spec.ratio} options={RATIO_OPTIONS.map((item) => ({ label: item, value: item }))} onChange={(value) => onPatch({ ratio: value })} />
            </label>
            <label className="flex items-center justify-between">
                <span className="text-foreground/70">文字排版</span>
                <Select size="small" className="w-28" value={spec.textMode} options={TEXT_MODE_OPTIONS} onChange={(value) => onPatch({ textMode: value })} />
            </label>
        </section>
    );
}
