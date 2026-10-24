package ecommerce

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// MaxSellingPointsRunes 卖点文本硬上限（rune 计）。
// 超过会原样进入生图提示词，浪费 token 且干扰出图（返工令 B 遗留 2：
// 「核心卖点」曾被灌入数千字 markdown 参数报告）。
const MaxSellingPointsRunes = 500

var (
	sellingMarkdownLink   = regexp.MustCompile(`\[([^\]]*)\]\([^)]*\)`)
	sellingListMarker     = regexp.MustCompile(`^[-*•+]\s+`)
	sellingHeadingMarker  = regexp.MustCompile(`^#{1,6}\s*`)
	sellingQuoteMarker    = regexp.MustCompile(`^>\s?`)
	sellingTableSeparator = regexp.MustCompile(`^[\s|:\-+_=｜]+$`)
	sellingSpaceRun       = regexp.MustCompile(`\s{2,}`)
)

// SanitizeSellingPoints 清洗卖点文本（导入/保存与提示词编译层共用的守卫）：
//   - 逐行剥离 Markdown 复杂格式：标题井号、加粗/行内代码星号与反引号、
//     链接（保留锚文本）、引用、列表标记、表格分隔行；表格竖线折为空格；
//   - 丢弃清洗后为空的行（分隔线/纯符号行），保留有内容的行结构
//     （下游 ecommerceProductPayload 按 \n/;/，切分卖点条目）；
//   - 全文超长按 rune 硬截断到 MaxSellingPointsRunes，以「…」收尾。
//
// 该函数是最终防线：即使数据库里已存在历史脏数据（如 bc33eb98 一批），
// 提示词编译前也会再过一遍。
func SanitizeSellingPoints(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	lines := make([]string, 0, 8)
	for _, line := range strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || sellingTableSeparator.MatchString(line) {
			continue
		}
		line = sellingHeadingMarker.ReplaceAllString(line, "")
		line = sellingListMarker.ReplaceAllString(line, "")
		line = sellingQuoteMarker.ReplaceAllString(line, "")
		line = sellingMarkdownLink.ReplaceAllString(line, "$1")
		line = strings.ReplaceAll(line, "**", "")
		line = strings.ReplaceAll(line, "```", "")
		line = strings.ReplaceAll(line, "`", "")
		line = strings.ReplaceAll(line, "|", " ")
		line = strings.ReplaceAll(line, "｜", " ")
		// 全角空格/不换行空格不在 \s 内，先归一成普通空格再折叠连续空白。
		line = strings.Map(func(r rune) rune {
			if r == '\u3000' || r == '\u00a0' {
				return ' '
			}
			return r
		}, line)
		line = sellingSpaceRun.ReplaceAllString(line, " ")
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		lines = append(lines, line)
	}
	out := strings.Join(lines, "\n")
	if utf8.RuneCountInString(out) > MaxSellingPointsRunes {
		runes := []rune(out)
		out = string(runes[:MaxSellingPointsRunes-1]) + "…"
	}
	return out
}

// SellingPointsOverLimit 报告超长量（供前端文案与日志口径一致）。
func SellingPointsOverLimit(raw string) int {
	over := utf8.RuneCountInString(raw) - MaxSellingPointsRunes
	if over < 0 {
		return 0
	}
	return over
}
