// 电商工坊 S5 视觉安全出口门禁（确定性过滤 + 通感改写）。
//
// 背景：可执行规则的真源在 canvas-agent/src/modules/exit-gates/（TypeScript）与
// rules/guardrail-rules.yaml（人读权威）。本文件是 **Go 侧镜像**——电商编排器
// 跑在 Go 后端，无法 import TS，也不能为每条提示词跨进程调 canvas-agent。
//
// 同步纪律（与 YAML↔TS 的同构要求一致）：
//   - 增删规则时必须三处同步：guardrail-rules.yaml / junkword-filter.ts / 本文件；
//   - exitgate_test.go 用 YAML 摘录的样例锁死行为，规则漂移会立刻红灯。
//
// S4（180° 轴线几何校验）不在此列：它需要机位三维向量（storyboardSchema 的
// cameraPosition），电商槽位提示词没有几何输入；S4 继续由 canvas-agent 的
// axis-guard 在分镜链路执行。

package ecommerce

import (
	"regexp"
	"strings"
)

// S5 确定性剥离规则（镜像 guardrail-rules.yaml 的 strip 类规则）。
var (
	// 中文虚无质量咒语词（rule_id: zh-quality-jargon）。
	reZhQualityJargon = regexp.MustCompile(`超逼真|超写实|超高清|超高画质|极高画质|顶级画质|大师之作|杰作|细节饱满|极致细节|高清画质`)
	// 英文虚无质量咒语词（rule_id: en-quality-jargon）。
	reEnQualityJargon = regexp.MustCompile(`(?i)\b(masterpiece|best quality|award[ -]?winning|ultra[ -]?realistic|hyper[ -]?realistic|insanely detailed|extremely detailed|ultra[ -]?detailed|trending on artstation)\b`)
	// 提示词内分辨率词（rule_id: resolution-in-prompt）。
	reResolutionInPrompt = regexp.MustCompile(`(?i)\b(8k|4k|uhd)\b`)
	// 画面比例规格（rule_id: aspect-ratio-conflict 的检测基础）。
	// RE2 不支持前后断言，边界校验改为在 aspectRatioConflict 内手动完成。
	reAspectRatio = regexp.MustCompile(`([1-9]\d?(?:\.\d{1,2})?)\s*[:：]\s*(\d{1,2})`)
)

// stripRule 描述一条确定性剥离规则。
type stripRule struct {
	ruleID  string
	pattern *regexp.Regexp
}

// s5StripRules 按 guardrail-rules.yaml 的顺序执行（顺序影响命中登记，不影响结果）。
var s5StripRules = []stripRule{
	{"zh-quality-jargon", reZhQualityJargon},
	{"en-quality-jargon", reEnQualityJargon},
	{"resolution-in-prompt", reResolutionInPrompt},
}

// ExitGateVerdict 是 S5 门禁判定结果。
type ExitGateVerdict struct {
	// Filtered 是剥离与改写后的提示词（可安全下发）。
	Filtered string `json:"filtered"`
	// Hits 命中清单：剥离类记录 rule_id，改写类记录被替换的红线词。
	Hits []string `json:"hits"`
	// Rejected 是否应拒绝下发（true 时调用方不得用 Filtered 兜底，必须报错）。
	Rejected bool `json:"rejected"`
	// RejectReason 拒绝原因（面向操作的稳定文案）。
	RejectReason string `json:"rejectReason,omitempty"`
}

// ComplianceGate 对提示词执行 S5：确定性剥离 → 红线词通感改写 → 残迹清理。
//
// 顺序与 TS filterJunkWords 对齐：先剥离质量咒语（避免稀释语义密度），
// 再把高危涉黄/违禁词改写为独乐岛通感隐喻，最后清理删除残迹。
func ComplianceGate(prompt string) ExitGateVerdict {
	verdict := ExitGateVerdict{Filtered: prompt}
	working := prompt
	for _, rule := range s5StripRules {
		matched := rule.pattern.FindAllString(working, -1)
		if len(matched) == 0 {
			continue
		}
		verdict.Hits = append(verdict.Hits, rule.ruleID)
		working = rule.pattern.ReplaceAllString(working, " ")
	}
	// 红线词通感改写（与 e-reverse providers.rewrite_compliance 同构）。
	rewritten := false
	for _, blocked := range complianceBlocklist {
		if strings.Contains(working, blocked) {
			verdict.Hits = append(verdict.Hits, "safety-wordlist:"+blocked)
			working = strings.ReplaceAll(working, blocked, complianceMetaphor(blocked))
			rewritten = true
		}
	}
	// 发生过改写才补高级质感锚点：干净提示词不被无意义加料。
	if rewritten && !strings.Contains(working, complianceStyleSuffix) {
		working = working + "；" + complianceStyleSuffix
	}
	verdict.Filtered = cleanupAfterStrip(working)
	// 比例规格冲突（rule_id: aspect-ratio-conflict）：≥2 个不同规格值 → 拒绝。
	if conflict, reason := aspectRatioConflict(working); conflict {
		verdict.Rejected = true
		verdict.RejectReason = reason
	}
	return verdict
}

// complianceBlocklist / complianceMetaphors 与 Python 侧 providers.py 的
// COMPLIANCE_METAPHORS 保持同源同序（两处引擎共用一套隐喻词库）。
var (
	complianceBlocklist = []string{
		"情色", "色情", "裸露", "裸体", "性器官", "器官", "性行为", "性爱",
		"插入", "抽插", "高潮", "呻吟", "震动", "性暗示", "诱惑",
		"成人用品", "情趣用品", "自慰", "人体",
	}
	complianceMetaphorTable = map[string]string{
		"情色":   "高奢卧室暖光",
		"色情":   "高奢卧室暖光",
		"裸露":   "真丝褶皱覆盖的静物",
		"裸体":   "真丝褶皱覆盖的静物",
		"性器官":  "鼠尾草绿鹅卵石静物",
		"器官":   "鼠尾草绿鹅卵石静物",
		"性行为":  "微距金色水波涟漪",
		"性爱":   "微距金色水波涟漪",
		"插入":   "清水缓缓漫过",
		"抽插":   "清水缓缓漫过",
		"高潮":   "暖光渐亮的情绪峰值",
		"呻吟":   "38dB 羽毛静水般的低频共振",
		"震动":   "38dB 羽毛静水般的低频共振",
		"性暗示":  "暖黄壁灯下的私密氛围",
		"诱惑":   "暖黄壁灯下的私密氛围",
		"成人用品": "私享生活器物",
		"情趣用品": "私享生活器物",
		"自慰":   "独处时的自我关怀",
		"人体":   "亚麻织物上的柔和轮廓",
	}
)

func complianceMetaphor(blocked string) string {
	if metaphor, ok := complianceMetaphorTable[blocked]; ok {
		return metaphor
	}
	return "私享生活器物"
}

// complianceStyleSuffix 是改写后统一追加的高级质感锚点（独乐岛视觉基调）。
const complianceStyleSuffix = "Aesop 极简主义构图，王家卫式暖黄壁灯侧逆光，鼠尾草绿与米白亚麻低饱和配色，微距金色水波涟漪质感，商业静物摄影，超高清"

// aspectRatioConflict 检测提示词内出现 ≥2 个不同画面比例规格（镜像
// guardrail-rules.yaml 的 aspect-ratio-conflict：去重后 ≥2 个不同值即拒绝）。
//
// YAML 原式含前后断言（(?<![\d.]) … (?!\d)），RE2 不支持，故在此手动校验边界：
// 前字符不得为数字或 '.'，比例值后不得紧跟数字。
func aspectRatioConflict(prompt string) (bool, string) {
	matches := reAspectRatio.FindAllStringSubmatchIndex(prompt, -1)
	if len(matches) < 2 {
		return false, ""
	}
	distinct := map[string]bool{}
	for _, match := range matches {
		start, end := match[0], match[1]
		if start > 0 {
			prev := prompt[start-1]
			if (prev >= '0' && prev <= '9') || prev == '.' {
				continue
			}
		}
		if end < len(prompt) {
			next := prompt[end]
			if next >= '0' && next <= '9' {
				continue
			}
		}
		normalized := strings.ReplaceAll(strings.ReplaceAll(prompt[start:end], " ", ""), "：", ":")
		distinct[normalized] = true
	}
	if len(distinct) < 2 {
		return false, ""
	}
	values := make([]string, 0, len(distinct))
	for value := range distinct {
		values = append(values, value)
	}
	return true, "提示词包含多个互相冲突的画面比例（" + strings.Join(values, " / ") + "），请只保留一个"
}

// cleanupAfterStrip 保守清理删除残迹：只修标点/空白，不改写内容
// （镜像 junkword-filter.ts 的 cleanupAfterStrip 语义）。
func cleanupAfterStrip(text string) string {
	working := text
	working = repeated.ReplaceAllString(working, "，")
	working = trailingPunct.ReplaceAllString(working, "。")
	working = lineEndPunct.ReplaceAllString(working, "")
	working = lineStartPunct.ReplaceAllString(working, "")
	working = spaces.ReplaceAllString(working, " ")
	lines := strings.Split(working, "\n")
	for index, line := range lines {
		lines[index] = strings.TrimRight(line, " \t")
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

var (
	repeated       = regexp.MustCompile(`([,，])(\s*[,，])+`)
	trailingPunct  = regexp.MustCompile(`[,，]\s*[。.]`)
	lineEndPunct   = regexp.MustCompile(`(?m)[,，;；]\s*$`)
	lineStartPunct = regexp.MustCompile(`(?m)^[,，;；、]\s*`)
	spaces         = regexp.MustCompile(`[ \t]{2,}`)
)
