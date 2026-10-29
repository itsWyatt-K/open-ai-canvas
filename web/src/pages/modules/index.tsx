// 固定模块大厅（拍板令阶段二：/modules）——双入口导航的模块矩阵页。
// 阶段三战役三分级：第一排置顶放大三张主力工作台卡，第二排紧凑排列工具型入口。
// 返工令 Round 3 去廉价感：① 卡片标题前的系统 Emoji 全部删除（与顶部图标双图标叠加是廉价感来源）；
// ② 主力大卡封面从「渐变底 + 48×48 线条图标」升级为微缩 UI 结构示意插画（内联，零请求）；
// ③ 卡片边框柔化为 1px solid 的 border-line-subtle，hover 走 hover:shadow-card-hover。
// 返工令 Round 4 去骨架感：三张封面插画注入品牌色彩与微立体图层感
// （电商卡紫渐变更海报 + 金星标 / 短剧卡深色胶片齿孔 + 亮青播放键 / 直播卡 LIVE 红标 + 弹幕气泡），
// 远看有明确色彩对比，不再像没加载出来的占位骨架屏。
import { Link } from "react-router";
import { ArrowRight, Search, Wrench } from "lucide-react";

type ModuleCard = {
    key: string;
    /** 紧凑卡左侧图标（主力大卡改用封面骨架插画，不再叠图标）。 */
    icon?: React.ReactNode;
    /** 封面微缩 UI 结构示意插画（内联 SVG，零请求零开销）。 */
    art?: React.ReactNode;
    title: string;
    tags: string[];
    desc: string;
    to?: string;
    /** 封面渐变色（Tailwind from-/via-/to- 三段），用于卡片顶部视觉封面区。 */
    cover?: string;
};

/** 电商工坊封面插画：三张错落的海报卡（紫渐变卡体 + 白色商品剪影 + 金色星标）。
 *  返工令 Round 4 去骨架感：原版是浅灰白虚线框，远看像没加载出来的占位；
 *  现在注入品牌紫 + 金色星标，有明确的色彩对比与微立体图层感。 */
function EcommerceCoverArt() {
    const cards = [
        { x: 16, y: 22, w: 62, h: 62, rotate: -7, star: 0.9 },
        { x: 108, y: 8, w: 76, h: 78, rotate: 0, star: 1 },
        { x: 216, y: 24, w: 60, h: 60, rotate: 6, star: 0.85 },
    ];
    return (
        <svg viewBox="0 0 320 96" className="h-full w-full" role="img" aria-label="三张错落的紫色商品海报卡，带白色商品剪影与金色星标">
            <defs>
                <linearGradient id="yq-ecom-card" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#6366F1" />
                    <stop offset="55%" stopColor="#7C3AED" />
                    <stop offset="100%" stopColor="#A855F7" />
                </linearGradient>
            </defs>
            {cards.map((card) => (
                <g key={card.x} transform={`rotate(${card.rotate} ${card.x + card.w / 2} ${card.y + card.h / 2})`}>
                    {/* 卡体：紫渐变 + 白描边，微立体（底部暗压边） */}
                    <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={7} fill="url(#yq-ecom-card)" stroke="rgba(255,255,255,0.55)" strokeWidth={1} />
                    <rect x={card.x} y={card.y + card.h - 10} width={card.w} height={10} rx={5} fill="rgba(15,23,42,0.22)" />
                    {/* 商品剪影：白色瓶罐（盖 + 身 + 高光） */}
                    <rect x={card.x + card.w / 2 - 7} y={card.y + 14} width={14} height={5} rx={2} fill="#FFFFFF" fillOpacity={0.95} />
                    <rect x={card.x + card.w / 2 - 10} y={card.y + 19} width={20} height={24} rx={5} fill="#FFFFFF" fillOpacity={0.92} />
                    <rect x={card.x + card.w / 2 - 6} y={card.y + 23} width={3} height={14} rx={1.5} fill="#7C3AED" fillOpacity={0.35} />
                    {/* 文案行 */}
                    <rect x={card.x + 8} y={card.y + card.h - 22} width={card.w - 20} height={4} rx={2} fill="#FFFFFF" fillOpacity={0.85} />
                    <rect x={card.x + 8} y={card.y + card.h - 15} width={(card.w - 20) * 0.62} height={3} rx={1.5} fill="#FFFFFF" fillOpacity={0.55} />
                    {/* 金色星标 */}
                    <g transform={`translate(${card.x + card.w - 9} ${card.y + 9}) scale(${card.star})`}>
                        <path d="M0,-7 L1.7,-2.35 L6.66,-2.16 L2.76,0.9 L4.11,5.66 L0,2.9 L-4.11,5.66 L-2.76,0.9 L-6.66,-2.16 L-1.7,-2.35 Z" fill="#FBBF24" stroke="#D97706" strokeWidth={0.6} />
                    </g>
                </g>
            ))}
        </svg>
    );
}

/** AI 短剧封面插画：深色胶片条（上下两排齿孔）+ 亮青播放键的分镜轨。
 *  返工令 Round 4 去骨架感：原版是浅灰虚线框 + 灰节点，现在胶片是深色实体、
 *  帧是亮青渐变、播放键高对比，远看就是一块电影胶片。 */
function DramaCoverArt() {
    const frames = [30, 112, 194];
    return (
        <svg viewBox="0 0 320 96" className="h-full w-full" role="img" aria-label="深色电影胶片齿孔与亮色播放键的分镜时间轴">
            <defs>
                <linearGradient id="yq-drama-frame" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#38BDF8" />
                    <stop offset="100%" stopColor="#22D3EE" />
                </linearGradient>
            </defs>
            {/* 胶片条本体 */}
            <rect x={6} y={8} width={308} height={80} rx={8} fill="#0F172A" stroke="rgba(148,163,184,0.4)" strokeWidth={1} />
            {/* 齿孔：上下两排 */}
            {Array.from({ length: 12 }, (_, i) => 16 + i * 25).map((x) => (
                <g key={`holes-${x}`}>
                    <rect x={x} y={13} width={9} height={5} rx={2} fill="#E2E8F0" fillOpacity={0.85} />
                    <rect x={x} y={78} width={9} height={5} rx={2} fill="#E2E8F0" fillOpacity={0.85} />
                </g>
            ))}
            {/* 分镜轨：三个亮青帧 + 连接线 */}
            <line x1={40} y1={48} x2={284} y2={48} stroke="rgba(226,232,240,0.5)" strokeWidth={1.5} strokeDasharray="3 3" />
            {frames.map((x, index) => (
                <g key={x}>
                    <rect x={x} y={28} width={70} height={40} rx={4} fill="url(#yq-drama-frame)" stroke="rgba(255,255,255,0.6)" strokeWidth={1} />
                    <rect x={x + 5} y={33} width={60} height={22} rx={3} fill="rgba(8,47,73,0.35)" />
                    <circle cx={x + 12} cy={62} r={3} fill="#FFFFFF" fillOpacity={0.9} />
                    <rect x={x + 19} y={60} width={index === 1 ? 40 : 30} height={4} rx={2} fill="#FFFFFF" fillOpacity={0.75} />
                </g>
            ))}
            {/* 亮色播放键：落在中帧上 */}
            <circle cx={147} cy={48} r={12} fill="#22D3EE" stroke="#FFFFFF" strokeWidth={1.5} />
            <path d="M143 42 L154 48 L143 54 Z" fill="#FFFFFF" />
        </svg>
    );
}

/** 直播装修封面插画：9:16 手机屏（暖色渐变）+ LIVE 红标 + 弹幕气泡 + 商品位。
 *  返工令 Round 4 去骨架感：原版是浅灰虚线手机框，现在是暖流光直播间实感，
 *  红标与弹幕气泡提供强色彩对比，一眼就是「正在直播的手机」。 */
function LiveCoverArt() {
    return (
        <svg viewBox="0 0 320 96" className="h-full w-full" role="img" aria-label="正在直播的手机屏幕，带 LIVE 红标与弹幕气泡">
            <defs>
                <linearGradient id="yq-live-screen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FB7185" />
                    <stop offset="45%" stopColor="#F472B6" />
                    <stop offset="100%" stopColor="#FDBA74" />
                </linearGradient>
            </defs>
            {/* 两侧氛围光斑 */}
            <circle cx={64} cy={40} r={26} fill="#FDA4AF" fillOpacity={0.35} />
            <circle cx={258} cy={62} r={30} fill="#FDBA74" fillOpacity={0.3} />
            {/* 手机屏 */}
            <rect x={122} y={6} width={76} height={84} rx={11} fill="url(#yq-live-screen)" stroke="rgba(255,255,255,0.65)" strokeWidth={1.5} />
            <rect x={150} y={10} width={20} height={4} rx={2} fill="rgba(15,23,42,0.35)" />
            {/* LIVE 红标（红底白点 + 白字） */}
            <rect x={128} y={17} width={34} height={12} rx={6} fill="#FF2C55" />
            <circle cx={135} cy={23} r={2.4} fill="#FFFFFF" />
            <text x={140} y={26} fontSize={8} fontWeight={700} fill="#FFFFFF" fontFamily="system-ui, sans-serif">LIVE</text>
            {/* 右上在线人数 */}
            <rect x={152} y={17} width={26} height={12} rx={6} fill="rgba(15,23,42,0.4)" />
            <circle cx={159} cy={23} r={2.2} fill="#FDE68A" />
            <rect x={163} y={21} width={12} height={4} rx={2} fill="#FFFFFF" fillOpacity={0.85} />
            {/* 商品主位（画面中部圆 + 投影） */}
            <ellipse cx={160} cy={66} rx={16} ry={4} fill="rgba(76,5,25,0.3)" />
            <circle cx={160} cy={54} r={13} fill="#FFFFFF" fillOpacity={0.92} />
            <circle cx={160} cy={54} r={8} fill="#FB7185" fillOpacity={0.55} />
            {/* 弹幕气泡：半透明毛玻璃条 */}
            <g>
                <rect x={128} y={34} width={44} height={10} rx={5} fill="rgba(255,255,255,0.55)" />
                <rect x={132} y={37.5} width={26} height={3.5} rx={1.75} fill="rgba(15,23,42,0.45)" />
            </g>
            <g>
                <rect x={140} y={76} width={50} height={10} rx={5} fill="rgba(255,255,255,0.45)" />
                <rect x={144} y={79.5} width={30} height={3.5} rx={1.75} fill="rgba(15,23,42,0.4)" />
            </g>
            {/* 底部评论输入条 + 点赞 */}
            <rect x={128} y={82} width={40} height={5} rx={2.5} fill="rgba(255,255,255,0.5)" />
            <circle cx={186} cy={84.5} r={4} fill="#FF2C55" />
            <path d="M186 82.5 L187.8 84.8 L186 86.8 L184.2 84.8 Z" fill="#FFFFFF" />
        </svg>
    );
}

/** 第一排：主力工作台（日常创作主线，置顶放大）。 */
const HERO_CARDS: ModuleCard[] = [
    {
        key: "ecommerce",
        art: <EcommerceCoverArt />,
        title: "电商详情页工坊",
        cover: "from-indigo-500/25 via-violet-500/15 to-fuchsia-500/25",
        tags: ["7 屏套图", "100% 锁主体", "批量企划矩阵", "四层 PSD"],
        desc: "从一张商品图到一整套平台合规详情页：AI 策划、七屏出图、透明分层精修与批量派发。",
        to: "/ecommerce",
    },
    {
        key: "projects",
        art: <DramaCoverArt />,
        title: "AI 短剧制作",
        cover: "from-sky-500/25 via-cyan-500/15 to-blue-500/25",
        tags: ["剧本分镜", "资产台账", "视频生产"],
        desc: "从定稿剧本到分镜与成片的全流程工作台。",
        to: "/projects",
    },
    {
        key: "live-studio",
        art: <LiveCoverArt />,
        title: "直播间装修台",
        cover: "from-rose-500/25 via-orange-500/15 to-amber-500/25",
        tags: ["AI 背景", "透明文字 Banner", "BiRefNet 抠图", "分层 PSD"],
        desc: "一句话生成 9:16 直播间背景，自动抠透明主体、加促销大字与接触阴影，一步合成直播间贴片并导出分层 PSD。",
        to: "/modules/live-studio",
    },
];

/** 第二排：工具型入口（按需使用，紧凑排列）。 */
const COMPACT_CARDS: ModuleCard[] = [
    {
        key: "ereverse",
        icon: <Search className="size-5" />,
        title: "爆款视觉反推",
        tags: ["词级 ASR", "场景打标", "视觉 DNA"],
        desc: "把对标视频/图片反推为可执行的事实表与视觉基因，让爆款可复用。",
        to: "/ereverse",
    },
    {
        key: "skills",
        icon: <Wrench className="size-5" />,
        title: "技能与插件库",
        tags: ["技能中心", "插件中心"],
        desc: "内置与社区技能、插件的管理与启用。",
        to: "/skills",
    },
];

export function ModulesPage() {
    return (
        // Design Token 绑定（2026-10-28 返工修正）：页面根容器与文字显式引用语义 Token，
        // 而不是靠继承默认色——此前变量定义了却没绑定，实测颜色仍是旧版 rgb(29,29,33)/oklab。
        <div className="mx-auto flex min-h-full max-w-[1200px] flex-col gap-5 bg-surface-base px-5 py-6 text-ink-primary">
            <header className="flex flex-col gap-1">
                <h1 className="text-page-title font-semibold tracking-tight">固定模块大厅</h1>
                <p className="text-body text-ink-secondary">选一个模块开始创作；画布始终是它们的自由组合台。</p>
            </header>

            {/* 第一排：主力工作台（置顶放大） */}
            <section className="flex flex-col gap-2" aria-label="主力工作台">
                <h2 className="text-card-title text-ink-secondary">主力工作台</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {HERO_CARDS.map((card) => (
                        <Link key={card.key} to={card.to ?? "/modules"} aria-label={card.title} className="block">
                            <article className="flex h-full flex-col overflow-hidden rounded-card border border-line-subtle bg-surface-card shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card-hover">
                                {/* 微缩 UI 结构示意封面：内联 SVG 骨架插画，零请求零开销 */}
                                <div className={`relative grid h-24 place-items-center bg-gradient-to-br ${card.cover ?? "from-indigo-500/25 to-fuchsia-500/25"}`}>
                                    <div className="h-full w-full px-4">{card.art}</div>
                                </div>
                                <div className="flex flex-1 flex-col gap-2.5 p-4">
                                    <strong className="text-section-title font-semibold text-ink-primary">{card.title}</strong>
                                    <p className="text-body text-ink-secondary">{card.desc}</p>
                                    {/* 能力胶囊徽标 */}
                                    <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
                                        {card.tags.map((tag) => (
                                            <span key={tag} className="rounded-pill bg-brand-soft px-2 py-0.5 text-caption text-brand">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                    <span className="mt-1 inline-flex items-center gap-1 text-ui-control text-brand">
                                        进入工坊 <ArrowRight className="size-3.5" />
                                    </span>
                                </div>
                            </article>
                        </Link>
                    ))}
                </div>
            </section>

            {/* 第二排：工具型入口（紧凑） */}
            <section className="flex flex-col gap-2" aria-label="工具与反推">
                <h2 className="text-card-title text-ink-secondary">工具与反推</h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {COMPACT_CARDS.map((card) => (
                        <Link key={card.key} to={card.to ?? "/modules"} aria-label={card.title} className="block">
                            <article className="flex h-full items-center gap-3 rounded-card border border-line-subtle bg-surface-card p-3.5 shadow-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-card-hover">
                                <span className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-soft text-brand">
                                    {card.icon}
                                </span>
                                <div className="flex min-w-0 flex-1 flex-col gap-1">
                                    <strong className="text-section-title font-semibold text-ink-primary">{card.title}</strong>
                                    <p className="truncate text-body text-ink-secondary">{card.desc}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {card.tags.map((tag) => (
                                            <span key={tag} className="rounded-pill bg-surface-subtle px-2 py-0.5 text-caption text-ink-secondary">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <ArrowRight className="size-4 shrink-0 text-ink-tertiary" />
                            </article>
                        </Link>
                    ))}
                </div>
            </section>
        </div>
    );
}
