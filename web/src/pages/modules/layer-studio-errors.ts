/**
 * 图层精修台 · 全局错误码 → 人话映射表（拍板令阶段三 战役二）。
 *
 * 背景：精修台原来把后端原始文案直接抛给用户（「数据已被更新，请刷新后重试」
 * 「revision 冲突」「引擎 /api/... 返回 500」……），新手完全看不懂、也不知道
 * 下一步能干嘛。这里统一收敛成「标题 + 建议动作」的人话结构：
 *
 *   - 匹配按 ERROR_RULES 顺序命中，第一条规则说了算；
 *   - 冲突类（revision 冲突 / 数据已被更新）标 refreshable=true，由界面渲染
 *     「一键刷新并合并」按钮（电商工坊详情接口即对账，见 onReconcile 回调）；
 *   - raw 原文保留在 <details> 里给排查用，不直接怼用户脸。
 *
 * 新增错误类型时只改 ERROR_RULES，不要在各调用点写 if/else。
 *
 * 牌序即优先级（顺序刻意为之，勿随意上调）：
 *   冲突 → 限额 → 引擎内部错误 → 超时 → 引擎不可达 → SSRF 拦截（兜底位）。
 * SSRF 规则必须在超时/引擎规则之后：nxf 引擎本身就跑在 127.0.0.1:8823，
 * 它的报错文案（「引擎 http://127.0.0.1:8823 返回 500」「连接超时」）天然
 * 含这个地址，若 SSRF 靠前会把引擎/超时错误抢判成 blocked。真正的 SSRF
 * 是同步拒绝（「已拦截」），不伴随超时/引擎语义，放兜底位不会漏判。
 */

/** 人话错误的语气分类：决定横幅用色与是否给「一键刷新并合并」。 */
export type FriendlyErrorTone = "conflict" | "limit" | "blocked" | "service" | "network" | "unknown";

export type FriendlyError = {
    tone: FriendlyErrorTone;
    /** 人话标题：一句话说清发生了什么。 */
    title: string;
    /** 建议动作：用户现在具体能做什么。 */
    hint: string;
    /** 冲突类错误：可「一键刷新并合并」（重新拉取商品详情对账）。 */
    refreshable: boolean;
    /** 命中的后端原始文案，折叠展示给排查用。 */
    raw: string;
};

type ErrorRule = {
    /** 语义词正则（顺序即优先级）；与 test 任一命中即采用本规则。 */
    pattern?: RegExp;
    /** 需要结构化判定的补充条件（如 IPv4 字面量是否落在封禁网段内）。 */
    test?: (text: string) => boolean;
    error: Omit<FriendlyError, "raw">;
};

/** 完整 IPv4 字面量（四段都必须是 0-255，版本号 10.2 之类不会命中）。 */
const IPV4_LITERAL = /\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g;

/**
 * 文案里出现完整 IPv4 且落在后端出站守卫封禁段内才判 blocked——与 Go 侧
 * blockedOutboundIP / blockedCustomRelayPrefixes 对齐：环回 127/8、私网
 * 10/8·172.16/12·192.168/16、链路本地 169.254/16、未指定 0/8、组播 224/4、
 * 运营商级 NAT 100.64/10、192.0.0.0/24·192.0.2.0/24 保留段。
 * 只出现「10.」「192.168」这类片段不判，避免误伤「素材编号 10.2」。
 */
function hasBlockedIpv4Literal(text: string): boolean {
    IPV4_LITERAL.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IPV4_LITERAL.exec(text)) !== null) {
        const octets = [match[1], match[2], match[3], match[4]].map((part) => Number.parseInt(part, 10));
        if (octets.some((value) => value > 255)) continue;
        const [first, second] = octets;
        const blocked =
            first === 0 || // 0.0.0.0/8 未指定
            first === 10 || // 10.0.0.0/8 私网
            first === 127 || // 127.0.0.0/8 环回
            (first === 100 && second >= 64 && second <= 127) || // 100.64.0.0/10 运营商级 NAT
            (first === 169 && second === 254) || // 169.254.0.0/16 链路本地
            (first === 172 && second >= 16 && second <= 31) || // 172.16.0.0/12 私网
            (first === 192 && second === 168) || // 192.168.0.0/16 私网
            (first === 192 && second === 0) || // 192.0.0.0/24·192.0.2.0/24 保留段
            (first >= 224 && first <= 239); // 224.0.0.0/4 组播
        if (blocked) return true;
    }
    return false;
}

const ERROR_RULES: ErrorRule[] = [
    {
        // revision 冲突 / 数据已被更新（后端 ErrCreationConflict 等并发写冲突）。
        pattern: /数据已被更新|revision|冲突|conflict|stale|已被.*(修改|更新|覆盖)/i,
        error: {
            tone: "conflict",
            title: "画面刚被更新过，你的操作没保存",
            hint: "可能是另一个页面或同事改了同一台精修画面。点「一键刷新并合并」重新拉取最新商品详情（你的图层修改会尽量保留）；暂不想合并就先关掉本面板，别反复点保存。",
            refreshable: true,
        },
    },
    {
        // 上传体积 / 额度超限。后端真实口径（backend/internal/app/upload_quota.go）：
        // 单个上传文件必须小于 ResourceUploadMB（默认 50MB，管理后台「运行策略」可调），
        // 分片超长报「分片 N 超过大小限制」，另有日上传额度与账号存储容量两类配额错误。
        pattern: /文件过大|文件大小|超过|超限|体积|太大|too large|exceeds|payload|请求体|max.*size|size.*limit|413|单个上传文件|分片.*超过|额度|配额|存储容量|账号文件容量|清理素材|购买存储空间/i,
        error: {
            tone: "limit",
            title: "图片太大或额度用满了，传不上去",
            hint: "单张图片需小于 50MB（上限以管理后台「运行策略」为准，可联系管理员调整）；也可能是撞了每日上传额度或账号存储容量——先压缩图片、清理不用的素材后再试。",
            refreshable: false,
        },
    },
    {
        // 模型 / 引擎内部不可用（含 nxf 返回 5xx：引擎活着但内部出错——
        // 与下面「连不上视觉引擎」区分：能返回状态码说明引擎还在）。
        pattern: /模型.*(不可用|不存在|下线|维护|无可用|没有可用)|无可用模型|模型不可用|no available model|model.*(unavailable|not found)|channel.*(unavailable|error)|上游.*(不可用|异常|错误)|引擎.*(返回|出错|错误|异常|失败)/i,
        error: {
            tone: "service",
            title: "抠图 / 合成引擎暂时不可用",
            hint: "视觉引擎（模型）暂时不可用，稍等 1-2 分钟再试；如果反复出现，请联系管理员检查模型配置。",
            refreshable: false,
        },
    },
    {
        // 超时（引擎响应超时 / 网关超时）。
        pattern: /超时|timeout|timed out|deadline/i,
        error: {
            tone: "network",
            title: "等太久了，这步操作超时",
            hint: "引擎响应超时。直接重试一次；大图建议先缩小尺寸再合成，能省一半时间。",
            refreshable: false,
        },
    },
    {
        // 引擎不可达（nxf 没起 / 连接失败；返回了状态码的归上面 service）。
        pattern: /引擎|nxf|fetch failed|network|连接失败|无法连接|refused/i,
        error: {
            tone: "network",
            title: "连不上视觉引擎",
            hint: "本地视觉引擎（nxf）可能没启动或正忙。检查引擎服务后重试；本机能打开 http://127.0.0.1:8823 说明引擎还在。",
            refreshable: false,
        },
    },
    {
        // SSRF / 内网地址拦截（后端出站守卫：本机、内网、链路本地、保留地址一律拒绝）。
        // 兜底位：判定收紧为语义词命中，或完整 IPv4 落在封禁网段内；不裸匹配 10./192.168 片段。
        pattern: /ssrf|内网|私网|环回|链路本地|保留地址|特殊用途|不允许访问|localhost|blocked (?:url|address|host)|address.*(?:blocked|not allowed)/i,
        test: hasBlockedIpv4Literal,
        error: {
            tone: "blocked",
            title: "这个图片地址不被允许",
            hint: "为了防护内网安全，本机 / 内网 / 保留地址的图片链接会被系统拦截。请改用页面上传，或换一个公网 HTTPS 图片地址。",
            refreshable: false,
        },
    },
];

const UNKNOWN_ERROR: Omit<FriendlyError, "raw"> = {
    tone: "unknown",
    title: "操作失败",
    hint: "系统开了点小差。请重试一次；若反复出现，请把下方「技术详情」截图发给管理员。",
    refreshable: false,
};

/** 后端原始文案 → 人话错误；命中不了规则时给通用兜底（仍保留 raw 供排查）。 */
export function toFriendlyError(raw: string): FriendlyError {
    const text = (raw || "").trim();
    const hit = ERROR_RULES.find((rule) => rule.pattern?.test(text) || rule.test?.(text));
    return { ...(hit?.error ?? UNKNOWN_ERROR), raw: text };
}

/** 渲染函数：人话错误 → 一行可读文案（toast / 日志 / 埋点用）。 */
export function friendlyErrorText(error: FriendlyError): string {
    return `${error.title}。${error.hint}`;
}

/** 人话语气 → Callout tone（error/network/warning 走 warning，避免满屏通红）。 */
export function friendlyErrorCalloutTone(tone: FriendlyErrorTone): "info" | "success" | "warning" | "error" {
    if (tone === "conflict" || tone === "limit" || tone === "network") return "warning";
    if (tone === "blocked" || tone === "service" || tone === "unknown") return "error";
    return "info";
}
