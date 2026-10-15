// ⚠️⚠️ 未挂载组件（防呆警告 · 2026-10-15）⚠️⚠️
// 本文件当前【没有任何路由或组件引用】——`/ecommerce/:view` 的 index.tsx 不读 view 参数，
// 因此即使访问 /ecommerce/{name} 渲染的仍是同一个三栏页，本组件永不显示。
// 2026-10-15 事故：M2 曾把「后端编排生成」按钮加在本文件，导致主人实测看不到任何入口。
// 铁律：**不要在本文件新增任何用户功能**。要加功能请改真实渲染路径上的组件：
//   router.tsx → pages/ecommerce/index.tsx → { task-list, task-detail, config-panel }
// 若要让本组件真正可用，必须先改 index.tsx 读取 view 参数并挂载，然后删掉这段警告。

import { Download, FileImage, Layers3, Loader2, Play, RefreshCw, Server } from "lucide-react";
import { Button, Empty, Input, Select, Slider, message } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";

import { batchStyleForge, buildEcommercePsdLayers, exportLayeredPsd, renderCopyLayer, synthesizeStyleForge, type StyleForgePrompt, type StyleForgeScene } from "@/services/api/visual-dna";
import {
    importEcommerceProducts,
    listEcommerceProducts,
    startEcommerceProduct,
    waitForEcommerceProduct,
    type EcommerceProductDetail,
} from "@/services/api/ecommerce";
import { createGenerationTask, waitForGenerationTask } from "@/services/api/task-center";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import { uploadImage } from "@/services/image-storage";
import { useBrandKitStore } from "@/stores/canvas/use-brand-kit-store";
import { useEcommerceStore } from "@/stores/canvas/use-ecommerce-store";
import { useConfigStore } from "@/stores/use-config-store";

/**
 * 批量生产：产品 + 品牌Kit + 六场景 → nxf 提示词 → 分批生图任务（遵守并发≤5）→ 产出画廊。
 * 画廊四动作：下载 / 导出分层PSD / 存为技能 / 送画布精修。
 */

type QueueItem = { id: string; variant: string; prompt: string; aspect: string; taskId?: string; status: "queued" | "running" | "succeeded" | "failed"; imageUrl?: string; error?: string; negative?: string };

const MAX_CONCURRENT = 5;

export function ProductionView({ canvasId }: { canvasId: string }) {
    const products = useEcommerceStore((state) => state.products);
    const kits = useBrandKitStore((state) => state.kits);
    const config = useConfigStore((state) => state.config);
    const [productId, setProductId] = useState("");
    const [kitId, setKitId] = useState("");
    const [scene, setScene] = useState("ecom_set");
    const [size, setSize] = useState("1:1");
    const [count, setCount] = useState(1);
    const [cityLines, setCityLines] = useState("");
    const [pages, setPages] = useState(4);
    const [textOverlay, setTextOverlay] = useState("");
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [submitting, setSubmitting] = useState(false);
    /** 后端编排产出的商品透明主体层资源（三层 PSD 的商品主体层）。 */
    const [subjectLayerResourceId, setSubjectLayerResourceId] = useState("");
    const runningRef = useRef(0);
    const lastModelRef = useRef("");
    const lastProductRef = useRef<Array<{ storageKey: string }>>([]);
    const retryCountsRef = useRef(new Map<string, number>());

    useEffect(() => {
        if (!productId && products.length) setProductId(products[0].id);
    }, [products, productId]);

    const submitOne = useCallback(async (item: QueueItem, model: string, productReference: Array<{ storageKey: string }>) => {
        setQueue((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "running" } : entry)));
        try {
            // 系统渠道路径：channelId 从模型编码串解析；顶层/config 的 model 用裸 key（后端按渠道模型 key 校验）
            const { resolveModelRequestConfig, modelOptionName } = await import("@/stores/use-config-store");
            const requestConfig = resolveModelRequestConfig(config, model);
            const bareModel = modelOptionName(model);
            const task = await createGenerationTask({
                type: "canvas_image",
                operation: "image",
                prompt: item.prompt,
                model: bareModel,
                input: {
                    mode: "image",
                    prompt: item.prompt,
                    // M1 起契约支持 negativePrompt：把 nxf 合成的负向词真正下发（此前被丢弃）。
                    ...(item.negative ? { negativePrompt: item.negative } : {}),
                    config: { channelId: requestConfig.channelId, model: bareModel, size: item.aspect, quality: "auto", count: "1" },
                    referenceImages: productReference,
                    metadata: { source: "ecommerce-production", variant: item.variant },
                },
            });
            setQueue((current) => current.map((entry) => (entry.id === item.id ? { ...entry, taskId: task.id } : entry)));
            const done = await waitForGenerationTask(task.id);
            const result = JSON.parse(done.resultJson || "{}") as { images?: Array<{ url?: string; dataUrl?: string }> };
            const url = result.images?.[0]?.url || result.images?.[0]?.dataUrl;
            if (!url) throw new Error("任务没有返回图片");
            setQueue((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "succeeded", imageUrl: url } : entry)));
        } catch (error) {
            setQueue((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "failed", error: error instanceof Error ? error.message : String(error) } : entry)));
        } finally {
            runningRef.current -= 1;
        }
    }, []);

    const runProduction = async () => {
        const product = products.find((item) => item.id === productId);
        if (!product) return message.warning("请先选择产品");
        const kit = kits.find((item) => item.id === (kitId || product.defaultKitId));
        if (!kit) return message.warning("没有可用的品牌Kit——先去「风格锻造」页分析并保存一个 Kit");
        const imageModel = config.imageModel;
        if (!imageModel) return message.error("未配置生图模型，请到设置选择");

        setSubmitting(true);
        try {
            let prompts: StyleForgePrompt[] = [];
            const forgeScene = scene as StyleForgeScene;
            if (scene === "ecom_set") {
                const result = await batchStyleForge({ dna: kit.dna, product: toForgeProduct(product), scenes: ["ecom_set"] });
                prompts = result.prompts;
            } else if (scene === "city_poster") {
                const variants: string[] = [];
                const variables: Record<string, Record<string, string>> = {};
                cityLines.split(/\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => {
                    const [city, landmark = "", motif = "", hour = ""] = line.split("|").map((part) => part.trim());
                    if (!city) return;
                    variants.push(city);
                    variables[city] = { city, landmark, motif, hour };
                });
                if (!variants.length) throw new Error("请填写城市变量（每行：城市|地标|意象|时辰）");
                const result = await batchStyleForge({ dna: kit.dna, product: toForgeProduct(product), scenes: ["city_poster"], sceneParams: { city_poster: { variants, variables, size } } });
                prompts = result.prompts;
            } else if (scene === "picture_book") {
                const variants = Array.from({ length: Math.max(2, Math.min(12, pages)) }, (_, index) => `P${index + 1}`);
                const result = await batchStyleForge({ dna: kit.dna, product: toForgeProduct(product), scenes: ["picture_book"], sceneParams: { picture_book: { variants, size } } });
                prompts = result.prompts;
            } else {
                const overlayLines = textOverlay.split(/\n/).map((line) => line.trim()).filter(Boolean);
                const result = await synthesizeStyleForge({ dna: kit.dna, product: toForgeProduct(product), scene: forgeScene, size, textOverlay: overlayLines, count });
                prompts = result.prompts;
            }
            prompts = prompts.slice(0, 12);
            const items: QueueItem[] = prompts.map((prompt, index) => ({
                id: `q-${Date.now().toString(36)}-${index}`,
                variant: prompt.variant || `图 ${index + 1}`,
                prompt: prompt.prompt,
                aspect: prompt.aspect || size,
                status: "queued",
                negative: prompt.negative,
            }));
            setQueue(items);
            // 分批并发（≤5，间隔 2.5s 降低 SQLite 写锁概率），参考图=产品图（resource: 存储键）
            runningRef.current = 0;
            const productReference = product.imageStorageKey ? [{ storageKey: product.imageStorageKey }] : [];
            lastModelRef.current = imageModel;
            lastProductRef.current = productReference;
            retryCountsRef.current.clear();
            for (const item of items) {
                while (runningRef.current >= MAX_CONCURRENT) await new Promise((resolve) => setTimeout(resolve, 1500));
                runningRef.current += 1;
                void submitOne(item, imageModel, productReference);
                await new Promise((resolve) => setTimeout(resolve, 2500));
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "批量生产失败");
        } finally {
            setSubmitting(false);
        }
    };

    const succeeded = queue.filter((item) => item.status === "succeeded");
    const failed = queue.filter((item) => item.status === "failed");

    /** 后端对账结果 → 画廊条目（槽位终态回填产物 + 记录透明主体层）。 */
    const applyBackendDetail = useCallback((detail: EcommerceProductDetail) => {
        if (detail.subjectLayerResourceId) setSubjectLayerResourceId(detail.subjectLayerResourceId);
        setQueue((current) =>
            current.map((entry) => {
                const slot = detail.slots.find((item) => item.title === entry.variant);
                if (!slot) return entry;
                const mapped: QueueItem["status"] =
                    slot.status === "completed" ? "succeeded" : slot.status === "failed" || slot.status === "uncertain" ? "failed" : "running";
                return {
                    ...entry,
                    status: mapped,
                    imageUrl: slot.resourceId ? resourceFileUrl(slot.resourceId) : entry.imageUrl,
                    error: mapped === "failed" ? entry.error || "槽位未产出成品" : undefined,
                };
            }),
        );
    }, []);

    /** 后端编排（M3）：服务端合成提示词 + 派发槽位任务 + 对账回写。 */
    const runOrchestrated = async () => {
        const product = products.find((item) => item.id === productId);
        if (!product) return message.warning("请先选择产品");
        const imageModel = config.imageModel;
        if (!imageModel) return message.error("未配置生图模型，请到设置选择");
        const resourceId = resourceIdFromStorageKey(product.imageStorageKey);
        if (!resourceId) return message.error("产品图尚未上传为资源（需 resource: 存储键），无法走后端编排");
        setSubmitting(true);
        try {
            const { resolveModelRequestConfig, modelOptionName } = await import("@/stores/use-config-store");
            const requestConfig = resolveModelRequestConfig(config, imageModel);
            const bareModel = modelOptionName(imageModel);
            const backendId = await ensureBackendProduct(product.name, resourceId);
            const started = await startEcommerceProduct(backendId, {
                channelId: requestConfig.channelId,
                model: bareModel,
                size,
                quality: "auto",
                sellingPoints: (product.sellingPoints || []).join("、"),
                extraRequirements: product.anchors || "",
                projectId: canvasId || undefined,
            });
            if (started.degraded?.length) message.warning(started.degraded.join("；"));
            setQueue(
                started.slots.map((slot, index) => ({
                    id: `s-${slot.slotId || index}`,
                    variant: slot.title,
                    prompt: slot.prompt,
                    aspect: size,
                    status: slot.status === "failed" ? "failed" : "running",
                    taskId: slot.childTaskId,
                    error: slot.error,
                })),
            );
            message.success(`已派发 ${started.dispatched} 个槽位任务${started.failed ? `（失败 ${started.failed}）` : ""}`);
            const detail = await waitForEcommerceProduct(backendId, { onTick: applyBackendDetail });
            applyBackendDetail(detail);
            message.success("后端编排完成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "后端编排失败");
        } finally {
            setSubmitting(false);
        }
    };

    // 失败自动补交（SQLITE_BUSY 等瞬时错误）：无在跑任务时重交失败项，每项最多重试 2 次。
    const retryingRef = useRef(false);
    const queueRef = useRef(queue);
    queueRef.current = queue;
    useEffect(() => {
        const failedItems = queueRef.current.filter((item) => item.status === "failed");
        if (!failedItems.length || runningRef.current > 0 || retryingRef.current) return;
        const retryable = failedItems.filter((item) => (retryCountsRef.current.get(item.id) || 0) < 2);
        if (!retryable.length || !lastModelRef.current) return;
        retryingRef.current = true;
        const timer = setTimeout(() => {
            for (const item of retryable) {
                retryCountsRef.current.set(item.id, (retryCountsRef.current.get(item.id) || 0) + 1);
                setQueue((current) => current.map((entry) => (entry.id === item.id ? { ...entry, status: "queued", error: undefined } : entry)));
                runningRef.current += 1;
                void submitOne(item, lastModelRef.current, lastProductRef.current);
            }
            retryingRef.current = false;
        }, 3000);
        return () => clearTimeout(timer);
    });

    return (
        <div className="ecommerce-production-view">
            <section className="ecommerce-section ecommerce-production-form">
                <h3>生产配置</h3>
                <Select className="w-full" placeholder="选择产品" value={productId || undefined} onChange={setProductId} options={products.map((item) => ({ value: item.id, label: item.name }))} notFoundContent="先去产品库新建产品" />
                <Select className="w-full" placeholder="品牌Kit" value={kitId || undefined} onChange={setKitId} options={kits.map((item) => ({ value: item.id, label: item.name }))} notFoundContent="先去风格锻造页存 Kit" />
                <Select className="w-full" value={scene} onChange={(value) => { setScene(value); setSize(value === "ecom_set" ? "1:1" : value === "picture_book" ? "16:9" : "3:4"); }} options={[
                    { value: "ecom_set", label: "电商七件套（自动混排比例）" },
                    { value: "style_poster", label: "风格海报 KV" },
                    { value: "city_poster", label: "城市文旅海报批量" },
                    { value: "picture_book", label: "儿童绘本" },
                    { value: "brand_kit", label: "Brand Kit 成稿" },
                    { value: "text_ad", label: "文字成稿" },
                ]} />
                {scene === "city_poster" ? <Input.TextArea rows={3} placeholder="每行：城市|地标|意象|时辰" value={cityLines} onChange={(event) => setCityLines(event.target.value)} /> : null}
                {scene === "picture_book" ? <Slider min={2} max={12} value={pages} onChange={setPages} marks={{ 2: "2", 4: "4", 8: "8", 12: "12" }} /> : null}
                {scene !== "ecom_set" ? (
                    <>
                        <div className="flex items-center justify-between text-xs opacity-70"><span>比例</span><span>{size}</span></div>
                        <Select className="w-full" value={size} onChange={setSize} options={["1:1", "3:4", "4:5", "9:16", "16:9"].map((value) => ({ value, label: value }))} />
                        {scene === "style_poster" || scene === "brand_kit" || scene === "text_ad" ? (
                            <div className="flex items-center justify-between text-xs opacity-70"><span>张数</span><span>{count}</span></div>
                        ) : null}
                        {scene === "style_poster" || scene === "brand_kit" || scene === "text_ad" ? <Slider min={1} max={4} value={count} onChange={setCount} /> : null}
                        {scene === "text_ad" || scene === "style_poster" ? <Input.TextArea rows={2} placeholder="烧入文字（每行一条，留空=无文字）" value={textOverlay} onChange={(event) => setTextOverlay(event.target.value)} /> : null}
                    </>
                ) : null}
                <Button type="primary" block loading={submitting} icon={<Play className="size-4" />} onClick={() => void runProduction()}>
                    开始批量生产
                </Button>
                <Button block loading={submitting} icon={<Server className="size-4" />} onClick={() => void runOrchestrated()}>
                    后端编排生成（独乐岛 7 屏 + 透明主体层）
                </Button>
                <p className="m-0 text-xs leading-relaxed opacity-55">
                    前端直连：浏览器合成提示词并逐张排队；后端编排：服务端融合上游预设铁律、下发负向词与主体强控，产出可三层导出的成品。
                </p>
            </section>

            <section className="ecommerce-production-result">
                <div className="mb-2 flex items-center gap-3 text-sm">
                    <span className="font-medium">产出</span>
                    <span className="opacity-60">{succeeded.length} 成功{failed.length ? ` · ${failed.length} 失败` : ""}{queue.some((item) => item.status === "running") ? " · 生成中…" : ""}</span>
                    {queue.length ? (
                        <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => setQueue([])}>清空</Button>
                    ) : null}
                </div>
                {queue.length === 0 ? (
                    <div className="ecommerce-empty h-40"><Empty description="配置好产品与 Kit 后点「开始批量生产」；产物可下载 / 导出分层PSD / 存为技能 / 送画布精修" /></div>
                ) : (
                    <div className="ecommerce-gallery">
                        {queue.map((item) => (
                            <div key={item.id} className="ecommerce-gallery-card" data-status={item.status}>
                                <div className="ecommerce-gallery-cover">
                                    {item.status === "running" || item.status === "queued" ? <Loader2 className="size-5 animate-spin opacity-50" /> : null}
                                    {item.status === "failed" ? <span className="text-xs text-destructive">{item.error?.slice(0, 60) || "失败"}</span> : null}
                                    {item.imageUrl ? <img src={item.imageUrl} alt={item.variant} /> : null}
                                </div>
                                <div className="ecommerce-gallery-body">
                                    <span className="truncate text-xs font-medium">{item.variant}</span>
                                    {item.imageUrl ? (
                                        <div className="flex gap-1">
                                            <Button size="small" type="text" title="下载" icon={<Download className="size-3.5" />} onClick={() => downloadDataUrl(item.imageUrl!, item.variant)} />
                                            <Button size="small" type="text" title={subjectLayerResourceId ? "导出三层PSD（背景/商品主体/文案）" : "导出分层PSD"} icon={<Layers3 className="size-3.5" />} onClick={() => void exportPsd(item.imageUrl!, item.variant, queue.indexOf(item) + 1, textOverlay.split("\n").map((line) => line.trim()).filter(Boolean), subjectLayerResourceId ? resourceFileUrl(subjectLayerResourceId) : undefined)} />
                                            <Button size="small" type="text" title="存入资产库" icon={<FileImage className="size-3.5" />} onClick={() => void saveToAssets(item.imageUrl!, item.variant)} />
                                            <Button size="small" type="text" title="送画布精修" disabled={!canvasId} onClick={() => void sendToCanvas(item.imageUrl!, item.variant, canvasId)} />
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function toForgeProduct(product: ReturnType<typeof useEcommerceStore.getState>["products"][number]) {
    return { name: product.name, anchors: product.anchors || "以产品参考图为准", selling_points: product.sellingPoints };
}

function downloadDataUrl(url: string, name: string) {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ecom-${name}-${new Date().toISOString().slice(0, 10)}.png`;
    anchor.click();
}

/**
 * 确保后端存在对应商品任务（本地产品库与后端 55 号表解耦）。
 * 导入接口同源去重：已导入时返回 skipped，此时按名称回查已有任务。
 */
async function ensureBackendProduct(name: string, resourceId: string): Promise<string> {
    const imported = await importEcommerceProducts([{ resourceId, name }]);
    const created = imported.items?.[0]?.id;
    if (created) return created;
    const listed = await listEcommerceProducts(name);
    const matched = listed.items.find((item) => item.name === name);
    if (!matched) throw new Error("后端商品任务导入失败，请重试");
    return matched.id;
}

async function exportPsd(imageUrl: string, name: string, slotIndex = 1, copyLines: string[] = [], subjectUrl?: string) {
    try {
        message.loading({ content: "正在合成 layered PSD…", key: "psd" });
        const dataUrl = await fetchAsDataUrl(imageUrl);
        const size = await readDataUrlSize(dataUrl);
        let layers;
        if (subjectUrl) {
            // 后端编排产出透明主体层 → 美工级三层：背景成图(可见) + 商品主体(隐藏) + 文案(隐藏)。
            const subject = await fetchAsDataUrl(subjectUrl);
            const copy = await renderCopyLayer(copyLines, size.width, size.height);
            layers = buildEcommercePsdLayers({
                slotIndex,
                slotLabel: name,
                compositeDataUrl: dataUrl,
                subjectDataUrl: subject,
                copyDataUrl: copy ?? undefined,
            });
        } else {
            // 无抠图层 → 回退两层（纯白底 + 成图）；成图已含烧入文案，不再叠加文案层以免双影。
            layers = buildEcommercePsdLayers({
                slotIndex,
                slotLabel: name,
                backgroundDataUrl: await solidLayer(size.width, size.height, "#ffffff"),
                compositeDataUrl: dataUrl,
            });
        }
        if (!layers.length) throw new Error("没有可导出的图层");
        const psd = await exportLayeredPsd(layers, size.width, size.height, `ecom-${name}`);
        const url = URL.createObjectURL(psd);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `ecom-${name}.psd`;
        anchor.click();
        URL.revokeObjectURL(url);
        message.success({ content: `分层 PSD 已导出（${layers.length} 层）`, key: "psd" });
    } catch (error) {
        message.error({ content: error instanceof Error ? error.message : "PSD 导出失败", key: "psd" });
    }
}

async function fetchAsDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("图片读取失败"));
        reader.readAsDataURL(blob);
    });
}

async function readDataUrlSize(dataUrl: string): Promise<{ width: number; height: number }> {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.width, height: image.height });
        image.onerror = () => reject(new Error("图片解码失败"));
        image.src = dataUrl;
    });
}

async function solidLayer(width: number, height: number, color: string): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context) {
        context.fillStyle = color;
        context.fillRect(0, 0, width, height);
    }
    return canvas.toDataURL("image/png");
}

async function saveToAssets(imageUrl: string, name: string) {
    try {
        const { uploadImage } = await import("@/services/image-storage");
        const uploaded = await uploadImage(imageUrl);
        message.success(`已存入资产库：${name}（${uploaded.storageKey}）`);
    } catch (error) {
        message.error(error instanceof Error ? error.message : "存入资产库失败");
    }
}

async function sendToCanvas(imageUrl: string, name: string, canvasId: string) {
    try {
        const [{ uploadImage }, { loadCanvasProjectForEditing, saveRemoteUserDataNow }, { useCanvasStore, flushCanvasStorePersistence }, { createCanvasNode }, { CanvasNodeType }, { nanoid }] = await Promise.all([
            import("@/services/image-storage"),
            import("@/services/user-data-sync"),
            import("@/stores/canvas/use-canvas-store"),
            import("@/lib/canvas/canvas-project-domain"),
            import("@/types/canvas"),
            import("nanoid"),
        ]);
        const uploaded = await uploadImage(imageUrl);
        const project = await loadCanvasProjectForEditing(canvasId);
        if (!project) throw new Error("工作台画布不存在，请刷新电商页重建");
        const node = createCanvasNode(CanvasNodeType.Image, { x: 80 + (project.nodes.length % 4) * 260, y: 80 + Math.floor(project.nodes.length / 4) * 240 }, {
            content: uploaded.url,
            storageKey: uploaded.storageKey,
            status: "success",
            prompt: name,
        });
        useCanvasStore.getState().updateProject(canvasId, { nodes: [...project.nodes, { ...node, id: nanoid(), title: name.slice(0, 24) || "电商产物" }] });
        await flushCanvasStorePersistence();
        try {
            await saveRemoteUserDataNow();
        } catch {
            // 同步失败不阻塞：本地已落，画布页打开时会再同步
        }
        message.success(`已送到工作台画布：${name}`);
    } catch (error) {
        message.error(error instanceof Error ? `送画布失败：${error.message}` : "送画布失败");
    }
}
