// 展示层 Markdown 剥离：DB 历史数据曾把整份 markdown 报告灌进卖点/名称字段
//（后端 L1 入口已加 SanitizeSellingPoints 清洗，但旧数据仍在库）——
// 前端展示层统一过这一层防御，禁止 **、##、` 等符号裸露在界面上。
export function stripMarkdown(raw: string | undefined | null): string {
    if (!raw) return "";
    return raw
        .replace(/```[\s\S]*?```/g, "") // 整段代码块直接丢
        .replace(/^\s{0,3}#{1,6}\s+/gm, "") // 标题井号
        .replace(/\*\*([^*]*)\*\*/g, "$1") // 加粗
        .replace(/__([^_]*)__/g, "$1")
        .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, "$1$2") // 斜体（避开乘号场景按词界匹配）
        .replace(/`([^`]*)`/g, "$1") // 行内代码
        .replace(/^\s{0,3}>\s?/gm, "") // 引用
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接保留锚文本
        .replace(/^\s*[-*•+]\s+/gm, "") // 列表标记
        .replace(/^\s*\|[-:\s|]+\|\s*$/gm, "") // 表格分隔行
        .replace(/\|/g, " ") // 表格竖线折空格
        .replace(/\s{2,}/g, " ")
        .trim();
}

/** 卖点拆胶囊：按换行/顿号/分号/逗号切，剥 markdown，最多 limit 条。 */
export function sellingPointPills(raw: string | undefined | null, limit = 5): string[] {
    const clean = stripMarkdown(raw);
    if (!clean) return [];
    const parts = clean
        .split(/[\n、；;，,]+/)
        .map((part) => part.trim())
        .filter((part) => part.length > 1 && part.length <= 40);
    return parts.slice(0, limit);
}
