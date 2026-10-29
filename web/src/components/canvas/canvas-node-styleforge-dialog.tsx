import { Button, Input, Modal, Segmented, Select, Slider, Spin, Steps, message } from "antd";
import { AlertTriangle, Loader2, Sparkles, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { ModelPicker } from "@/components/model-picker";
import { BrandKitLoader, VisualDnaPanel } from "@/components/canvas/visual-dna-panel";
import { defaultImageParamsForModel } from "@/lib/model-selection";
import {
    analyzeVisualDna,
    batchStyleForge,
    nodeImageDataUrl,
    synthesizeStyleForge,
    STYLE_FORGE_SCENES,
    type StyleForgeProduct,
    type StyleForgePrompt,
    type StyleForgeScene,
    type VisualDna,
} from "@/services/api/visual-dna";
import { canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useBrandKitStore } from "@/stores/canvas/use-brand-kit-store";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeData } from "@/types/canvas";

export type StyleForgeGeneratePayload = {
    scene: StyleForgeScene;
    dna: VisualDna;
    anchorCard: string;
    prompts: StyleForgePrompt[];
    productNode: CanvasNodeData;
    generationConfig: Partial<Pick<AiConfig, "model" | "imageModel" | "size" | "quality" | "count" | "transparentBackground">>;
};

type StyleForgeDialogProps = {
    productNode: CanvasNodeData;
    imageNodes: CanvasNodeData[];
    config: AiConfig;
    open: boolean;
    onClose: () => void;
    onGenerate: (payload: StyleForgeGeneratePayload) => void;
};

const MAX_PROMPTS = 12;

function nodeOptionLabel(node: CanvasNodeData) {
    return `${node.title?.slice(0, 24) || "图片"}（${Math.round(node.width)}×${Math.round(node.height)}）`;
}

export function CanvasNodeStyleForgeDialog({ productNode, imageNodes, config, open, onClose, onGenerate }: StyleForgeDialogProps) {
    const [step, setStep] = useState(0);
    const [scene, setScene] = useState<StyleForgeScene>("style_poster");
    const [styleNodeId, setStyleNodeId] = useState<string>("");
    const [productNodeId, setProductNodeId] = useState<string>(productNode.id);
    const [productName, setProductName] = useState("");
    const [productAnchors, setProductAnchors] = useState("");
    const [productSellingPoints, setProductSellingPoints] = useState("");
    const [dna, setDna] = useState<VisualDna | null>(null);
    const [analyzing, setAnalyzing] = useState(false);
    const [analyzeError, setAnalyzeError] = useState("");
    const [cityLines, setCityLines] = useState("杭州|保俶塔|一枝桂|晨雾");
    const [bookPages, setBookPages] = useState(4);
    const [textOverlay, setTextOverlay] = useState("");
    const [count, setCount] = useState(1);
    const [size, setSize] = useState(STYLE_FORGE_SCENES[0].aspect);
    const [submitting, setSubmitting] = useState(false);
    const [generationConfig, setGenerationConfig] = useState<AiConfig>(config);
    const kits = useBrandKitStore((state) => state.kits);
    const theme = canvasThemes[useActiveTheme()];

    useEffect(() => {
        if (!open) return;
        setStep(0);
        setScene("style_poster");
        setSize(STYLE_FORGE_SCENES[0].aspect);
        setStyleNodeId("");
        setProductNodeId(productNode.id);
        setProductName(productNode.title?.slice(0, 24) || "");
        setDna(null);
        setAnalyzeError("");
        setCount(1);
        setTextOverlay("");
        setGenerationConfig(config);
    }, [open, productNode, config]);

    const selectableNodes = useMemo(
        () => imageNodes.filter((node) => node.metadata?.content && node.metadata?.status !== "loading"),
        [imageNodes],
    );

    const productSellingPointList = useMemo(
        () => productSellingPoints.split(/[、,，;；\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 6),
        [productSellingPoints],
    );

    const sceneMeta = STYLE_FORGE_SCENES.find((item) => item.value === scene);

    const runAnalyze = async () => {
        const styleNode = selectableNodes.find((node) => node.id === styleNodeId);
        if (!styleNode) return setAnalyzeError("请选择风格参考图（大牌详情页 / 海报 / 竞品视觉）");
        setAnalyzing(true);
        setAnalyzeError("");
        try {
            const brief = [productName, productAnchors].filter(Boolean).join("；");
            const { dna: nextDna } = await analyzeVisualDna(styleNode, brief);
            setDna(nextDna);
            setStep(1);
        } catch (error) {
            setAnalyzeError(error instanceof Error ? error.message : "视觉DNA分析失败");
        } finally {
            setAnalyzing(false);
        }
    };

    const buildProduct = (): StyleForgeProduct => ({
        name: productName.trim(),
        anchors: productAnchors.trim() || "以产品参考图为准",
        selling_points: productSellingPointList,
    });

    const runGenerate = async () => {
        if (!dna) return;
        setSubmitting(true);
        try {
            const product = buildProduct();
            const overlayLines = textOverlay.split(/\n/).map((line) => line.trim()).filter(Boolean);
            let prompts: StyleForgePrompt[] = [];
            let anchorCard = "";
            if (scene === "ecom_set") {
                const result = await batchStyleForge({ dna, product, scenes: ["ecom_set"] });
                prompts = result.prompts;
                anchorCard = result.anchorCard;
            } else if (scene === "city_poster") {
                const variants: string[] = [];
                const variables: Record<string, Record<string, string>> = {};
                cityLines.split(/\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
                    const [city, landmark = "", motif = "", hour = ""] = line.split("|").map((part) => part.trim());
                    if (!city) return;
                    variants.push(city);
                    variables[city] = { city, landmark, motif, hour };
                });
                if (!variants.length) throw new Error("请至少填写一座城市（每行：城市|地标|意象|时辰）");
                const result = await batchStyleForge({ dna, product, scenes: ["city_poster"], sceneParams: { city_poster: { variants, variables, size } } });
                prompts = result.prompts;
                anchorCard = result.anchorCard;
            } else if (scene === "picture_book") {
                const variants = Array.from({ length: Math.max(2, Math.min(12, bookPages)) }, (_, index) => `P${index + 1}`);
                const result = await batchStyleForge({ dna, product, scenes: ["picture_book"], sceneParams: { picture_book: { variants, size } } });
                prompts = result.prompts;
                anchorCard = result.anchorCard;
            } else {
                const result = await synthesizeStyleForge({ dna, product, scene, size, textOverlay: overlayLines, count });
                prompts = result.prompts;
                anchorCard = result.anchorCard;
            }
            prompts = prompts.slice(0, MAX_PROMPTS);
            if (!prompts.length) throw new Error("引擎没有返回提示词");
            const productTarget = selectableNodes.find((node) => node.id === productNodeId) || productNode;
            const forgeModel = generationConfig.imageModel || generationConfig.model;
            onGenerate({ scene, dna, anchorCard, prompts, productNode: productTarget, generationConfig: { model: forgeModel, imageModel: forgeModel, size, quality: generationConfig.quality, count: "1", transparentBackground: generationConfig.transparentBackground } });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提示词合成失败");
        } finally {
            setSubmitting(false);
        }
    };

    const canAnalyze = Boolean(styleNodeId) && !analyzing;
    const needStyleRef = true;

    return (
        <Modal
            className="workspace-modal workspace-modal-wide"
            title={null}
            open={open}
            onCancel={onClose}
            footer={null}
            centered
            destroyOnHidden
        >
            <div className="grid gap-5 lg:grid-cols-[minmax(380px,1fr)_340px]">
                <div className="flex max-h-[72vh] min-h-[420px] flex-col overflow-hidden">
                    <div className="flex items-center gap-2 pb-2">
                        <Sparkles className="size-4 text-primary" />
                        <h2 className="text-lg font-semibold">风格锻造</h2>
                        <span className="text-xs opacity-50">视觉DNA九维度 · 风格迁移</span>
                    </div>
                    <Steps
                        size="small"
                        current={step}
                        items={[{ title: "模式与素材" }, { title: "视觉DNA" }, { title: "生成" }]}
                        className="pb-3!"
                    />
                    <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                        {step === 0 ? (
                            <>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                    {STYLE_FORGE_SCENES.map((item) => (
                                        <button
                                            key={item.value}
                                            type="button"
                                            className={`rounded-lg border p-2.5 text-left transition-colors ${scene === item.value ? "border-primary bg-primary/5" : "border-border/60 hover:border-primary/40"}`}
                                            onClick={() => {
                                                setScene(item.value);
                                                setSize(item.aspect);
                                            }}
                                        >
                                            <div className="text-sm font-medium">{item.label}</div>
                                            <div className="mt-0.5 text-caption leading-snug opacity-55">{item.description}</div>
                                        </button>
                                    ))}
                                </div>

                                <div className="space-y-2">
                                    <div className="text-sm font-medium opacity-75">风格参考图（只取风格，不带入内容）</div>
                                    <Select
                                        className="w-full"
                                        placeholder="选择画布上的参考图节点"
                                        value={styleNodeId || undefined}
                                        onChange={setStyleNodeId}
                                        options={selectableNodes.map((node) => ({ value: node.id, label: nodeOptionLabel(node) }))}
                                        notFoundContent="画布上暂无可用图片节点，请先上传参考图"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="text-sm font-medium opacity-75">产品图（外形保真基准）</div>
                                    <Select
                                        className="w-full"
                                        value={productNodeId}
                                        onChange={setProductNodeId}
                                        options={selectableNodes.map((node) => ({ value: node.id, label: nodeOptionLabel(node) }))}
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <Input placeholder="产品名称" value={productName} onChange={(event) => setProductName(event.target.value)} />
                                        <Input placeholder="视觉锚点（颜色/材质/形状）" value={productAnchors} onChange={(event) => setProductAnchors(event.target.value)} />
                                    </div>
                                    <Input.TextArea
                                        rows={2}
                                        placeholder="卖点（顿号/换行分隔，可留空）"
                                        value={productSellingPoints}
                                        onChange={(event) => setProductSellingPoints(event.target.value)}
                                    />
                                </div>

                                {scene === "city_poster" ? (
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium opacity-75">城市变量（每行：城市|地标|意象|时辰）</div>
                                        <Input.TextArea rows={3} value={cityLines} onChange={(event) => setCityLines(event.target.value)} />
                                    </div>
                                ) : null}
                                {scene === "picture_book" ? (
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium opacity-75">绘本页数（P1 定妆页 + 回灌页）</div>
                                        <Slider min={2} max={12} value={bookPages} onChange={setBookPages} marks={{ 2: "2", 4: "4", 8: "8", 12: "12" }} />
                                    </div>
                                ) : null}
                                {analyzeError ? (
                                    <div className="flex items-start gap-1.5 text-xs font-medium text-destructive">
                                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                        <span>{analyzeError}</span>
                                    </div>
                                ) : null}
                            </>
                        ) : null}

                        {step === 1 && dna ? (
                            <>
                                <BrandKitLoader onLoad={(kitDna) => { setDna(kitDna); message.success("已加载品牌Kit，可继续微调"); }} />
                                <VisualDnaPanel dna={dna} onDnaChange={setDna} />
                            </>
                        ) : null}

                        {step === 2 ? (
                            <>
                                <div className="space-y-2">
                                    <div className="text-sm font-medium opacity-75">画面比例</div>
                                    <Segmented
                                        value={size}
                                        onChange={(value) => setSize(value as string)}
                                        options={["1:1", "3:4", "4:5", "9:16", "16:9"]}
                                    />
                                    <div className="text-xs opacity-50">当前模式 {sceneMeta?.label} · 比例可改；电商七件套内部自动混排比例</div>
                                </div>
                                {scene === "style_poster" || scene === "brand_kit" || scene === "text_ad" ? (
                                    <div className="space-y-2">
                                        <div className="text-sm font-medium opacity-75">生成张数</div>
                                        <Slider min={1} max={4} value={count} onChange={setCount} marks={{ 1: "1", 2: "2", 3: "3", 4: "4" }} />
                                    </div>
                                ) : null}
                                {scene === "text_ad" || scene === "style_poster" ? (
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium opacity-75">烧入文字（每行一条，留空=无文字）</div>
                                        <Input.TextArea rows={2} value={textOverlay} onChange={(event) => setTextOverlay(event.target.value)} placeholder={"主标题：晨光里的从容\n角标：限时直降500元"} />
                                    </div>
                                ) : null}
                                <div className="rounded-lg border border-dashed border-border/60 px-3 py-2 text-xs opacity-70">
                                    将按 DNA 生成 <b>{scene === "ecom_set" ? 7 : scene === "city_poster" ? cityLines.split(/\n/).filter(Boolean).length : scene === "picture_book" ? Math.max(2, Math.min(12, bookPages)) : count}</b> 条提示词，
                                    逐张调用当前生成模型出图（参考图=产品图，产品保真优先）。
                                </div>
                            </>
                        ) : null}
                    </div>

                    <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-border/50 pt-3">
                        <div>
                            {step > 0 ? <Button onClick={() => setStep(step - 1)}>上一步</Button> : <span />}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button icon={<WandSparkles className="size-4" />} onClick={onClose}>取消</Button>
                            {step === 0 ? (
                                <Button type="primary" disabled={!canAnalyze && needStyleRef} onClick={() => void runAnalyze()}>
                                    {analyzing ? <><Loader2 className="size-4 animate-spin" /> 分析中…</> : "分析视觉DNA"}
                                </Button>
                            ) : null}
                            {step === 1 ? (
                                <Button type="primary" onClick={() => setStep(2)}>下一步：生成设置</Button>
                            ) : null}
                            {step === 2 ? (
                                <Button type="primary" loading={submitting} onClick={() => void runGenerate()}>
                                    生成到画布
                                </Button>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="flex max-h-[72vh] min-h-[420px] flex-col overflow-hidden rounded-xl border border-border/50 p-3">
                    <div className="text-sm font-medium opacity-75">生成模型与参数</div>
                    <div className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                        <ModelPicker
                            config={generationConfig}
                            value={generationConfig.imageModel || generationConfig.model}
                            capability="image"
                            fullWidth
                            showSelectedPrice={false}
                            onChange={(model) => setGenerationConfig((current) => ({ ...current, model, imageModel: model, ...defaultImageParamsForModel(current, model) }))}
                        />
                        <ImageSettingsPanel
                            config={generationConfig}
                            showTitle={false}
                            showCount={false}
                            bypassPriceGuard
                            className="space-y-3"
                            theme={theme}
                            onConfigChange={(key, value) => setGenerationConfig((current) => ({ ...current, [key]: value }))}
                        />
                        {dna ? (
                            <div className="rounded-lg bg-surface-active p-2 text-caption leading-relaxed opacity-70">
                                DNA 来源：{dna.channel || "未知通道"}；锚点卡将在生成时作为公共锚点复用。
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 rounded-lg bg-surface-active p-2 text-caption opacity-60">
                                <Spin size="small" /> 完成分析后此处显示 DNA 摘要
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
}
