import { CollectionGrid, PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { App, Button, Empty, Input, Segmented, Select, Skeleton, Switch, Tag } from "antd";
import {
    Award,
    CheckCircle2,
    Clapperboard,
    ExternalLink,
    Filter,
    Flame,
    Heart,
    HelpCircle,
    Image as ImageIcon,
    Layout,
    Layers,
    ListFilter,
    RotateCcw,
    Search,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Video,
    Volume2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
    getInspirationCase,
    getInspirationStats,
    listInspirationCases,
    toggleInspirationFavorite,
    type InspirationCase,
    type InspirationCaseDetail,
    type InspirationListQuery,
    type InspirationStats,
} from "@/services/api/inspiration";
import { InspirationCard } from "./inspiration-card";
import { InspirationDetailDrawer } from "./inspiration-detail-drawer";
import { InspirationLicenseModal } from "./inspiration-license-modal";

const mediaTypeTabs = [
    { label: "全部案例", value: "" },
    { label: "视频案例", value: "video" },
    { label: "图像生成", value: "image" },
    { label: "UI 界面", value: "ui" },
    { label: "文案创意", value: "copy" },
];

const sortOptions = [
    { label: "热度优先 (Popular)", value: "hot" },
    { label: "效果评分最高", value: "score" },
    { label: "稳定性优先", value: "stability" },
    { label: "最新收录", value: "new" },
];

const reproStatusOptions = [
    { label: "全部复现状态", value: "" },
    { label: "本地 H3 已复现 (Done)", value: "done" },
    { label: "官方基线库已测", value: "goodcase" },
    { label: "待复现 (Pending)", value: "pending" },
];

export default function InspirationPage() {
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();

    // 筛选状态
    const [mediaType, setMediaType] = useState<string>(searchParams.get("type") || "");
    const [category, setCategory] = useState<string>("");
    const [modelFamily, setModelFamily] = useState<string>("");
    const [reproStatus, setReproStatus] = useState<string>("");
    const [sort, setSort] = useState<string>("hot");
    const [search, setSearch] = useState<string>("");
    const debouncedSearch = useDebouncedValue(search, 300);
    const [onlyFavorite, setOnlyFavorite] = useState<boolean>(false);

    // 分页状态
    const [page, setPage] = useState<number>(1);
    const [pageSize, setPageSize] = useState<number>(20);

    // 数据状态
    const [loading, setLoading] = useState<boolean>(true);
    const [items, setItems] = useState<InspirationCase[]>([]);
    const [total, setTotal] = useState<number>(0);
    const [stats, setStats] = useState<InspirationStats | null>(null);

    // 抽屉与许可弹窗状态
    const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);
    const [detail, setDetail] = useState<InspirationCaseDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState<boolean>(false);
    const [licenseModalOpen, setLicenseModalOpen] = useState<boolean>(false);
    const [licenseModalSlug, setLicenseModalSlug] = useState<string>("");
    const [licenseModalSource, setLicenseModalSource] = useState<string>("");

    // 加载全局统计
    useEffect(() => {
        getInspirationStats()
            .then(setStats)
            .catch(() => {});
    }, []);

    // 加载案例列表
    const fetchCases = useCallback(async () => {
        setLoading(true);
        try {
            const query: InspirationListQuery = {
                mediaType: mediaType || undefined,
                category: category || undefined,
                modelFamily: modelFamily || undefined,
                reproStatus: reproStatus || undefined,
                keyword: debouncedSearch || undefined,
                sort,
                page,
                size: pageSize,
            };
            const result = await listInspirationCases(query);
            let finalItems = result.items || [];
            if (onlyFavorite) {
                finalItems = finalItems.filter((it) => it.favorited);
            }
            setItems(finalItems);
            setTotal(result.total || 0);
        } catch (err) {
            console.error("加载灵感库失败:", err);
            message.error("加载灵感库案例失败，请检查服务连接");
        } finally {
            setLoading(false);
        }
    }, [mediaType, category, modelFamily, reproStatus, debouncedSearch, sort, page, pageSize, onlyFavorite, message]);

    useEffect(() => {
        fetchCases();
    }, [fetchCases]);

    // 选中卡片加载详情
    const handleSelectCase = async (item: InspirationCase) => {
        setSelectedCaseId(item.id);
        setDetailLoading(true);
        try {
            const res = await getInspirationCase(item.id);
            setDetail(res);
        } catch (err) {
            message.error("加载案例详情失败");
        } finally {
            setDetailLoading(false);
        }
    };

    // 收藏切换
    const handleToggleFavorite = async (id: number) => {
        try {
            const favorited = await toggleInspirationFavorite(id);
            setItems((prev) =>
                prev.map((it) => (it.id === id ? { ...it, favorited } : it))
            );
            if (detail?.case?.id === id) {
                setDetail((prev) =>
                    prev ? { ...prev, case: { ...prev.case, favorited } } : null
                );
            }
            message.success(favorited ? "已加入我的收藏" : "已取消收藏");
        } catch (err) {
            message.error("操作失败，请重试");
        }
    };

    // 重置所有筛选
    const handleReset = () => {
        setMediaType("");
        setCategory("");
        setModelFamily("");
        setReproStatus("");
        setSort("hot");
        setSearch("");
        setOnlyFavorite(false);
        setPage(1);
    };

    // 打开许可弹窗
    const handleOpenLicense = (slug?: string, sourceUrl?: string) => {
        setLicenseModalSlug(slug || "");
        setLicenseModalSource(sourceUrl || "");
        setLicenseModalOpen(true);
    };

    return (
        <WorkspacePage className="app-inspiration-page">
            {/* 页面主标题与顶栏动作 */}
            <PageHeader
                title="AI 灵感库 & 视频画布"
                description="聚合 529+ 视频与多媒介案例 · 264 组跨模型复测基线 · 双轨视频画布沉浸式对比"
                meta={
                    <Tag color="cyan" className="font-mono text-xs font-medium">
                        Seedance × GoodCase 融合态
                    </Tag>
                }
                actions={
                    <div className="flex items-center gap-2">
                        <Button
                            type="dashed"
                            size="small"
                            icon={<ShieldCheck className="size-3.5 text-emerald-500" />}
                            onClick={() => handleOpenLicense()}
                        >
                            开源授权与版权声明
                        </Button>
                    </div>
                }
            />

            {/* 顶栏开源授权三元条款 Banner（用户第1点核心要求） */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface/70 px-4 py-2.5 backdrop-blur-sm text-xs">
                <div className="flex flex-wrap items-center gap-2 text-foreground/80">
                    <span className="font-semibold text-foreground flex items-center gap-1.5">
                        <ShieldCheck className="size-4 text-emerald-500" />
                        开源许可规范 (License Terms):
                    </span>
                    <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-blue-500">
                        代码 MIT
                    </span>
                    <span>·</span>
                    <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                        策划整理 CC BY 4.0
                    </span>
                    <span>·</span>
                    <span className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-amber-600 dark:text-amber-400">
                        提示词与媒体原作者保留版权
                    </span>
                    <span>·</span>
                    <span className="text-foreground/50">案例皆附带原帖出处</span>
                </div>

                <button
                    type="button"
                    onClick={() => handleOpenLicense()}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium"
                >
                    <span>查看完整条款与权利人下架流程 (Takedown)</span>
                    <ExternalLink className="size-3" />
                </button>
            </div>

            {/* 核心指标统计卡片 */}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-border/60 bg-surface p-3.5 flex items-center justify-between">
                    <div>
                        <span className="text-xs text-foreground/50">精选案例总库</span>
                        <div className="mt-1 text-xl font-bold font-mono text-foreground">
                            {stats?.total || 529}
                            <span className="ml-1 text-xs font-normal text-foreground/40">条</span>
                        </div>
                    </div>
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Sparkles className="size-5" />
                    </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-surface p-3.5 flex items-center justify-between">
                    <div>
                        <span className="text-xs text-foreground/50">本地视频媒体</span>
                        <div className="mt-1 text-xl font-bold font-mono text-blue-500">
                            {stats?.withVideo || 50}
                            <span className="ml-1 text-xs font-normal text-foreground/40">条</span>
                        </div>
                    </div>
                    <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                        <Video className="size-5" />
                    </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-surface p-3.5 flex items-center justify-between">
                    <div>
                        <span className="text-xs text-foreground/50">MiniMax-H3 本地复现</span>
                        <div className="mt-1 text-xl font-bold font-mono text-emerald-500">
                            {stats?.localRetests || 3}
                            <span className="ml-1 text-xs font-normal text-foreground/40">成功闭环</span>
                        </div>
                    </div>
                    <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                        <CheckCircle2 className="size-5" />
                    </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-surface p-3.5 flex items-center justify-between">
                    <div>
                        <span className="text-xs text-foreground/50">官方跨模型基线</span>
                        <div className="mt-1 text-xl font-bold font-mono text-amber-500">
                            {stats?.officialRetests || 264}
                            <span className="ml-1 text-xs font-normal text-foreground/40">组对照</span>
                        </div>
                    </div>
                    <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                        <Award className="size-5" />
                    </div>
                </div>
            </div>

            {/* 媒介类型 Tab 切换 */}
            <div className="mt-4 flex items-center justify-between border-b border-border/50 pb-2">
                <Segmented
                    value={mediaType}
                    onChange={(val) => {
                        setMediaType(val as string);
                        setPage(1);
                    }}
                    options={mediaTypeTabs}
                    className="app-inspiration-media-tabs"
                />

                <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground/50">仅看收藏</span>
                    <Switch
                        size="small"
                        checked={onlyFavorite}
                        onChange={(checked) => {
                            setOnlyFavorite(checked);
                            setPage(1);
                        }}
                    />
                </div>
            </div>

            {/* 筛选与搜索工具栏 */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-1 flex-wrap items-center gap-2 min-w-[280px]">
                    {/* 搜索框 */}
                    <Input
                        prefix={<Search className="size-3.5 text-foreground/40" />}
                        placeholder="搜索案例标题、提示词、分类..."
                        allowClear
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(1);
                        }}
                        className="w-full sm:w-64"
                    />

                    {/* 模型筛选 */}
                    <Select
                        placeholder="模型家族"
                        allowClear
                        value={modelFamily || undefined}
                        onChange={(val) => {
                            setModelFamily(val || "");
                            setPage(1);
                        }}
                        className="w-36"
                        options={[
                            { label: "全部模型", value: "" },
                            { label: "Seedance 2.5", value: "Seedance 2.5" },
                            { label: "MiniMax-H3", value: "MiniMax-H3" },
                            { label: "GPT Image", value: "GPT Image" },
                            { label: "Flux 系列", value: "Flux" },
                        ]}
                    />

                    {/* 复现状态 */}
                    <Select
                        placeholder="复现状态"
                        allowClear
                        value={reproStatus || undefined}
                        onChange={(val) => {
                            setReproStatus(val || "");
                            setPage(1);
                        }}
                        className="w-40"
                        options={reproStatusOptions}
                    />

                    {/* 排序 */}
                    <Select
                        value={sort}
                        onChange={(val) => {
                            setSort(val);
                            setPage(1);
                        }}
                        className="w-36"
                        options={sortOptions}
                    />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        size="small"
                        type="text"
                        icon={<RotateCcw className="size-3.5" />}
                        onClick={handleReset}
                    >
                        重置
                    </Button>
                    <span className="text-xs text-foreground/50">共 {total} 条</span>
                </div>
            </div>

            {/* 案例网格展示 */}
            {loading ? (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div key={i} className="rounded-xl border border-border/60 bg-surface p-3 space-y-3">
                            <Skeleton.Button active block style={{ height: 160, borderRadius: 8 }} />
                            <Skeleton active paragraph={{ rows: 2 }} />
                        </div>
                    ))}
                </div>
            ) : items.length === 0 ? (
                <div className="mt-8 rounded-xl border border-dashed border-border/60 p-12 text-center">
                    <Empty description="未找到符合条件的灵感案例" />
                    <Button type="dashed" className="mt-3" onClick={handleReset}>
                        清空筛选条件
                    </Button>
                </div>
            ) : (
                <CollectionGrid className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {items.map((it) => (
                        <InspirationCard
                            key={it.id}
                            item={it}
                            onSelect={handleSelectCase}
                            onToggleFavorite={handleToggleFavorite}
                        />
                    ))}
                </CollectionGrid>
            )}

            {/* 分页条 */}
            <div className="mt-6 flex justify-end">
                <PaginationBar
                    current={page}
                    pageSize={pageSize}
                    total={total}
                    onChange={(p, ps) => {
                        setPage(p);
                        setPageSize(ps);
                    }}
                    pageSizeOptions={[20, 40, 80]}
                    itemLabel="条案例"
                />
            </div>

            {/* 详情抽屉 */}
            <InspirationDetailDrawer
                open={selectedCaseId !== null}
                onClose={() => {
                    setSelectedCaseId(null);
                    setDetail(null);
                }}
                detail={detail}
                loading={detailLoading}
                onToggleFavorite={handleToggleFavorite}
                onOpenLicenseModal={handleOpenLicense}
            />

            {/* 开源许可与下架规范弹窗 */}
            <InspirationLicenseModal
                open={licenseModalOpen}
                onClose={() => setLicenseModalOpen(false)}
                currentSlug={licenseModalSlug}
                sourceUrl={licenseModalSource}
            />
        </WorkspacePage>
    );
}
