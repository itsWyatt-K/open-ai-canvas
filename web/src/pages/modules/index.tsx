// 固定模块大厅（拍板令阶段二：/modules）——双入口导航的模块矩阵页。
import { Link } from "react-router";
import { Clapperboard, Film, Layers3, Search, ShoppingBag, Wrench } from "lucide-react";

type ModuleCard = {
    key: string;
    icon: React.ReactNode;
    title: string;
    tags: string[];
    desc: string;
    to?: string;
    highlight?: boolean;
};

const CARDS: ModuleCard[] = [
    {
        key: "live-studio",
        icon: <Layers3 className="size-7" />,
        title: "🎬 直播间装修与透明分层台",
        tags: ["背景装修", "透明文字 Banner", "BiRefNet 抠图", "光影合成", "分层 PSD"],
        desc: "上传背景与商品，自动抠透明主体、加促销大字与接触阴影，一步合成直播间贴片并导出分层 PSD。",
        to: "/modules/live-studio",
        highlight: true,
    },
    {
        key: "ecommerce",
        icon: <ShoppingBag className="size-7" />,
        title: "🛍️ 电商详情页工坊",
        tags: ["7 屏套图", "100% 锁主体", "批量企划矩阵", "透明分层"],
        desc: "从一张商品图到一整套平台合规详情页：AI 策划、七屏出图、透明分层精修与批量派发。",
        to: "/ecommerce",
    },
    {
        key: "ereverse",
        icon: <Search className="size-7" />,
        title: "🔍 爆款视觉反推",
        tags: ["词级 ASR", "场景打标", "视觉 DNA"],
        desc: "把对标视频/图片反推为可执行的事实表与视觉基因，让爆款可复用。",
        to: "/ereverse",
    },
    {
        key: "projects",
        icon: <Clapperboard className="size-7" />,
        title: "📽️ AI 短剧制作",
        tags: ["剧本分镜", "资产台账", "视频生产"],
        desc: "从定稿剧本到分镜与成片的全流程工作台。",
        to: "/projects",
    },
    {
        key: "skills",
        icon: <Wrench className="size-7" />,
        title: "🧠 技能与插件库",
        tags: ["技能中心", "插件中心"],
        desc: "内置与社区技能、插件的管理与启用。",
        to: "/skills",
    },
];

export function ModulesPage() {
    return (
        <div className="mx-auto flex min-h-full max-w-[1200px] flex-col gap-5 px-5 py-6">
            <header className="flex flex-col gap-1">
                <h1 className="text-lg font-semibold">固定模块</h1>
                <p className="text-xs text-foreground/55">选一个模块开始创作；画布始终是它们的自由组合台。</p>
            </header>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {CARDS.map((card) => {
                    const inner = (
                        <article
                            className={`flex h-full flex-col gap-3 rounded-xl border p-4 transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:shadow-lg ${
                                card.highlight ? "border-primary/50 bg-gradient-to-br from-indigo-500/8 via-surface to-fuchsia-500/8 shadow-md" : "border-border/50 bg-surface"
                            }`}
                        >
                            <span className={`grid size-12 place-items-center rounded-lg ${card.highlight ? "bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white" : "bg-primary/10 text-primary"}`}>
                                {card.icon}
                            </span>
                            <strong className="text-sm">{card.title}</strong>
                            <p className="text-xs leading-5 text-foreground/60">{card.desc}</p>
                            <div className="mt-auto flex flex-wrap gap-1 pt-1">
                                {card.tags.map((tag) => (
                                    <span key={tag} className="rounded-full bg-foreground/6 px-2 py-0.5 text-[10px] text-foreground/60">{tag}</span>
                                ))}
                            </div>
                            <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                                进入模块 <Film className="size-3.5" />
                            </span>
                        </article>
                    );
                    return card.to ? (
                        <Link key={card.key} to={card.to} aria-label={card.title} className="block">
                            {inner}
                        </Link>
                    ) : (
                        <div key={card.key}>{inner}</div>
                    );
                })}
            </div>
        </div>
    );
}
