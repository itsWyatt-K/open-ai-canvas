// Package director 提供 Chaoge 导演 Skill 的 Go 原生确定性校验器。
//
// 与 backend/builtin/chaoge-film-director-flex/scripts/ 下的 Python 校验器
// 逐条对齐（validate_prompt.py / validate_ledger.py）：Agent 在 Node 子进程
// 沙箱（PI_OFFLINE=1）内不执行 .py 脚本，也能对即梦/LibTV 视频提示词与项目
// 台账执行 100% 确定性的门禁自检。行为差异只允许来自 RE2 与 Python re 的
// 表达能力差（后向断言已用等价的命中后回退检查模拟）。
package director

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"
)

// 字符计数与 Python len(str) 一致：按 Unicode rune 计。
const (
	maxVideoPromptChars  = 5000
	softVideoPromptChars = 4200
)

// sectionSoftLimit 保持 Python SECTION_SOFT_LIMITS 字典的插入序（告警顺序稳定）。
type sectionSoftLimit struct {
	name  string
	limit int
}

var sectionSoftLimits = []sectionSoftLimit{
	{"风格锁定", 500},
	{"场景与空间锚点", 700},
	{"声音与音乐总则", 350},
	{"全局补充", 450},
}

// sectionsByMode 对齐 Python SECTIONS。
var sectionsByMode = map[string][]string{
	"new":    {"风格锁定", "素材映射", "场景与空间锚点", "声音与音乐总则", "镜头序列", "全局补充"},
	"extend": {"延长任务", "素材映射", "衔接与连续性锁定", "新增故事与情绪目标", "声音与音乐延续", "新增镜头序列", "全局补充"},
	"edit":   {"编辑任务", "素材映射", "生效时段", "修改要求", "保持不变", "全局补充"},
}

// topLevelSections 对齐 Python TOP_LEVEL_SECTIONS（集合语义，仅用于求最近下一个栏目）。
var topLevelSections = []string{
	"风格锁定", "素材映射", "场景与空间锚点", "声音与音乐总则", "镜头序列", "全局补充",
	"延长任务", "衔接与连续性锁定", "新增故事与情绪目标", "声音与音乐延续", "新增镜头序列",
	"编辑任务", "生效时段", "修改要求", "保持不变", "一镜到底执行声明",
}

// Python \s 对 str 匹配 Unicode 空白；RE2 的 \s 仅 ASCII。中文稿里现实可见的
// 扩展空白是不全角空格与 NBSP，统一并入院内字符类，保证与 Python 同结果。
const ws = `[\s\x{3000}\x{00A0}\x{FEFF}]`

var (
	placeholderRE          = regexp.MustCompile(`\{\{(?:Image|Audio|Video)` + ws + `+\d+\}\}`)
	imagePlaceholderRE     = regexp.MustCompile(`\{\{Image` + ws + `+\d+\}\}`)
	jimengAtAliasRE        = regexp.MustCompile(`@(?:图片|图|音频|视频)` + ws + `*\d+`)
	bindAliasRE            = regexp.MustCompile(`绑定后简称[“"]([^”"]+)[”"]`)
	jimengSpeakerRE        = regexp.MustCompile(`^@(?:为|用于锁定)?([^，。]{1,24}?)(?:全部)?(?:台词|旁白|干声|声音|音色)`)
	libtvPlaceholderPairRE = regexp.MustCompile(`\{\{(Image|Audio|Video)` + ws + `+(\d+)\}\}`)
	libtvAssignRE          = regexp.MustCompile(`(?:图|音频|视频)` + ws + `*\d+` + ws + `*=` + ws + `*\{\{`)
	textBindImageRE        = regexp.MustCompile(`绑定后简称[“"]图` + ws + `*\d+[”"]`)
	externalMappingRowRE   = regexp.MustCompile(`(?m)^\|` + ws + `*((?:图|音频|视频)` + ws + `*\d+)` + ws + `*\|`)
	markdownHeadingRE      = regexp.MustCompile(`\n#{1,6}` + ws + `+`)
	speechTriggerRE        = regexp.MustCompile(`(?:说|说道|喊|哭喊|大喊|低语|耳语|回答|问道|念出|旁白|画外音|广播|电话)[^\n。；]{0,60}[：:]?` + ws + `*[“"]`)
	roleCueRE              = regexp.MustCompile(`[A-Za-z\x{4e00}-\x{9fff}]{1,20}` + ws + `*[（(][^）)\n]{0,100}[）)]` + ws + `*[：:]` + ws + `*[“"]`)
	dialogueBindingRE      = regexp.MustCompile(`(?P<speaker>[A-Za-z\x{4e00}-\x{9fff}]{1,20})` + ws + `*[（(][^）)\n]{0,100}?音频` + ws + `*(?P<number>\d+)[^）)\n]*[）)]`)
	audioNumberRE          = regexp.MustCompile(`音频` + ws + `*\d+`)
	styleDurationRE        = regexp.MustCompile(`总(?:长|时长)` + ws + `*[：:]?` + ws + `*\d+(?:\.\d+)?` + ws + `*秒`)
	cameraSystemRE         = regexp.MustCompile(`(?i)摄影机|胶片|film|ARRI|Alexa|RED|Sony|Kodak|Panavision|镜头|lens`)
	chineseNumberREs = []*regexp.Regexp{
		regexp.MustCompile(`[一二三四五六七八九十百千万两〇零]+` + ws + `*(?:毫米|厘米|米|度|秒|帧|档|步|记|句|倍|格|人)`),
		regexp.MustCompile(`第[一二三四五六七八九十百千万两〇零]+(?:秒|帧|镜|次|句)`),
		regexp.MustCompile(`[一二三四五六七八九十百千万两〇零]+分之[一二三四五六七八九十百千万两〇零]+`),
		regexp.MustCompile(`(?:午夜|凌晨|早上|上午|中午|下午|晚上)` + ws + `*[一二三四五六七八九十百千万两〇零]+点`),
	}
	externalContextREs = []struct {
		re      *regexp.Regexp
		message string
	}{
		{regexp.MustCompile(`(?i)\bU\d{2}\b`), "全新生成提示词不得引用U01/U02等批次编号"},
		{regexp.MustCompile(`上一条(?:视频)?|上一段|前一批|上个批次|前文`), "全新生成提示词不得引用未上传的上一批次内容"},
		{regexp.MustCompile(`(?i)硬切进入(?:新的?)?(?:动态)?画面|重新开始|延续U\d+|不重复(?:前文|上一段|U\d+)`), "全新生成提示词含有模型无法执行的剪辑或上下文说明"},
	}
	shotHeadRE          = regexp.MustCompile(`镜头` + ws + `*(\d+)` + ws + `*[（(]`)
	internalTimecodeRE  = regexp.MustCompile(`(?m)^` + ws + `*(\d+(?:\.\d+)?)` + ws + `*[—–~至到-]+` + ws + `*(\d+(?:\.\d+)?)` + ws + `*秒` + ws + `*$`)
	cutWordRE           = regexp.MustCompile(`硬切|切镜|切到|转场|遮挡转场|匹配切`)
	cutGuardRE          = regexp.MustCompile(`禁止|严禁|不得|不能|不允许|没有|无任何`)
	zoomChangeRE        = regexp.MustCompile(`(?i)定焦[^\n。；]*(?:焦段从|焦段由|焦段逐渐|变为` + ws + `*\d+` + ws + `*mm|过渡到` + ws + `*\d+` + ws + `*mm)`)
	shotSizeRE          = regexp.MustCompile(`极远景|大全景|中远景|中全景|全景|中景|近景|极特写|特写|胸像|半身|腰部|膝上|全身|过肩`)
	focusRE             = regexp.MustCompile(`焦点|景深|清晰|虚焦`)
	shotTimecodeRE      = regexp.MustCompile(`镜头` + ws + `*\d+` + ws + `*[（(][^\n）)]*?(\d+(?:\.\d+)?)` + ws + `*[—–~至到-]+` + ws + `*(\d+(?:\.\d+)?)` + ws + `*秒`)
	prohibitionWordRE   = regexp.MustCompile(`严禁|禁止|不得|不能|不允许|无字幕|无水印|无背景音乐`)
	whitespaceRE        = regexp.MustCompile(ws + `+`)
	normalizeClauseRE   = regexp.MustCompile(`[\s，、：:（）()【】\x{3000}\x{00A0}\x{FEFF}]`)
	clauseSplitRE       = regexp.MustCompile(`[。；\n]`)
	textImageRefRE      = regexp.MustCompile(`图` + ws + `*\d+`)
	aliasRefRE          = regexp.MustCompile(`(?:图|音频|视频)` + ws + `*\d+`)
)

// PromptValidateRequest 对齐 validate_prompt.py 的 CLI 参数（含默认值）。
type PromptValidateRequest struct {
	Text         string
	Platform     string
	Mode         string
	ModelVersion string
	AssetMode    string
	VoiceMode    string
}

// PromptValidateResult 对齐 Python 侧 {"ok", "errors", "warnings"}，并附带
// 工具契约要求的字符计数。
type PromptValidateResult struct {
	OK        bool     `json:"ok"`
	CharCount int      `json:"charCount"`
	Errors    []string `json:"errors"`
	Warnings  []string `json:"warnings"`
}

// ValidateVideoPrompt 是 validate_prompt.py::validate 的 Go 等价物。
func ValidateVideoPrompt(req PromptValidateRequest) PromptValidateResult {
	result := PromptValidateResult{Errors: []string{}, Warnings: []string{}}
	platform, mode, modelVersion, assetMode, voiceMode, invalid := normalizePromptRequest(req)
	if invalid != "" {
		result.Errors = append(result.Errors, invalid)
		return result
	}
	text := req.Text
	errors := &result.Errors
	warnings := &result.Warnings

	// 1. 正文提取与字符预算。
	promptPayload := extractPromptPayload(text, mode)
	promptCharCount := utf8.RuneCountInString(promptPayload)
	result.CharCount = promptCharCount
	if promptCharCount > maxVideoPromptChars {
		*errors = append(*errors, fmt.Sprintf("文生视频提示词正文共%d个字符，超过%d个字符上限", promptCharCount, maxVideoPromptChars))
	} else if promptCharCount > softVideoPromptChars {
		*warnings = append(*warnings, fmt.Sprintf("文生视频提示词正文共%d个字符，已超过%d个字符常规目标；请先去重再交付", promptCharCount, softVideoPromptChars))
	}

	// 2. 分栏软上限。
	for _, item := range sectionSoftLimits {
		body := sectionText(text, item.name)
		if body != "" && utf8.RuneCountInString(body) > item.limit {
			*warnings = append(*warnings, fmt.Sprintf("【%s】共%d个字符，超过%d个字符建议预算", item.name, utf8.RuneCountInString(body), item.limit))
		}
	}

	// 3. 【全局补充】禁止词膨胀。
	globalSupplement := sectionText(text, "全局补充")
	prohibitionCount := len(prohibitionWordRE.FindAllString(globalSupplement, -1))
	if prohibitionCount > 6 {
		*warnings = append(*warnings, fmt.Sprintf("【全局补充】检测到%d项禁止表达，通常应压缩到6项以内", prohibitionCount))
	}

	// 4. 重复长句（去标点空白后 ≥18 rune 的句子出现 >1 次）。
	normalizedClauses := map[string]int{}
	for _, clause := range clauseSplitRE.Split(promptPayload, -1) {
		normalized := normalizeClauseRE.ReplaceAllString(clause, "")
		if utf8.RuneCountInString(normalized) >= 18 {
			normalizedClauses[normalized]++
		}
	}
	repeatedClauses := 0
	for _, count := range normalizedClauses {
		if count > 1 {
			repeatedClauses++
		}
	}
	if repeatedClauses > 0 {
		*warnings = append(*warnings, fmt.Sprintf("提示词中检测到%d条重复长句，请按栏目职责去重", repeatedClauses))
	}

	// 5. 栏目存在性与顺序。
	orderedSections := make([]string, 0, len(sectionsByMode[mode]))
	for _, section := range sectionsByMode[mode] {
		if section == "素材映射" && assetMode == "text" {
			continue
		}
		orderedSections = append(orderedSections, section)
	}
	positions := make([]int, 0, len(orderedSections))
	for _, section := range orderedSections {
		marker := "【" + section + "】"
		if mode == "new" && section == "镜头序列" && strings.Contains(text, "【一镜到底执行声明】") {
			marker = "【一镜到底执行声明】"
		}
		pos := strings.Index(text, marker)
		if pos < 0 {
			*errors = append(*errors, "缺少栏目："+marker)
			continue
		}
		positions = append(positions, pos)
	}
	if len(positions) == len(orderedSections) && !sort.IntsAreSorted(positions) {
		*errors = append(*errors, "栏目顺序不符合模板")
	}

	// 6. 素材映射槽位与外部映射表。
	mappingSpan, hasMappingSpan := sectionSpan(text, "素材映射")
	mapping := sectionText(text, "素材映射")
	outside := text
	if hasMappingSpan {
		outside = text[:mappingSpan[0]] + text[mappingSpan[1]:]
	}

	mappedAliases := map[string]struct{}{}
	audioSpeakers := map[string]string{}

	if platform == "jimeng" {
		if placeholderRE.MatchString(text) {
			*errors = append(*errors, "即梦版不得出现LibTV占位符")
		}
		if strings.Contains(outside, "@") {
			*errors = append(*errors, "即梦版的@只能出现在【素材映射】")
		}
		if jimengAtAliasRE.MatchString(mapping) {
			*errors = append(*errors, "即梦素材必须使用裸@，禁止写成@图片1/@音频1/@视频1")
		}
		atLines := directorNonEmptyLines(mapping, func(line string) bool { return strings.HasPrefix(line, "@") })
		if len(atLines) == 0 && mapping != "" {
			*warnings = append(*warnings, "【素材映射】中没有检测到裸@素材")
		}
		for _, line := range atLines {
			aliasMatch := bindAliasRE.FindStringSubmatch(line)
			if aliasMatch == nil {
				*errors = append(*errors, "即梦素材缺少绑定后简称："+line)
				continue
			}
			mappedAlias := aliasMatch[1]
			mappedAliases[mappedAlias] = struct{}{}
			if strings.HasPrefix(mappedAlias, "音频") {
				if speaker := jimengSpeakerRE.FindStringSubmatch(line); speaker != nil {
					audioSpeakers[mappedAlias] = strings.Trim(speaker[1], "的 ")
				}
			}
		}
	} else {
		if strings.Contains(text, "@") {
			*errors = append(*errors, "LibTV版不得出现@素材语法")
		}
		if placeholderRE.MatchString(outside) {
			*errors = append(*errors, "LibTV占位符只能出现在【素材映射】")
		}
		if libtvAssignRE.MatchString(mapping) {
			*errors = append(*errors, "LibTV素材行必须直接以占位符开头，禁止写图1={{Image 1}}")
		}
		for _, pair := range libtvPlaceholderPairRE.FindAllStringSubmatch(mapping, -1) {
			kind, number := pair[1], pair[2]
			prefix := map[string]string{"Image": "图", "Audio": "音频", "Video": "视频"}[kind]
			mappedAlias := prefix + number
			mappedAliases[mappedAlias] = struct{}{}
			if kind == "Audio" {
				mappingLine := directorFirstLineContaining(mapping, "{{Audio "+number+"}}")
				speakerRE := regexp.MustCompile(`\{\{Audio` + ws + `+` + regexp.QuoteMeta(number) + `\}\}(?:为|用于锁定)?([^，。]{1,24}?)(?:全部)?(?:台词|旁白|干声|声音|音色)`)
				if speaker := speakerRE.FindStringSubmatch(mappingLine); speaker != nil {
					audioSpeakers[mappedAlias] = strings.Trim(speaker[1], "的 ")
				}
			}
		}
		if len(mappedAliases) == 0 && mapping != "" {
			*warnings = append(*warnings, "【素材映射】中没有检测到LibTV素材占位符")
		}
	}

	// 7. 纯文字模式的视觉占位禁令。
	if assetMode == "text" {
		if imagePlaceholderRE.MatchString(text) {
			*errors = append(*errors, "纯文生视频版不得出现{{Image N}}视觉占位符")
		}
		if directorLookbehindMiss(text, textImageRefRE) {
			*errors = append(*errors, "纯文生视频版不得引用图N")
		}
		if platform == "jimeng" {
			for _, line := range directorLines(mapping) {
				if textBindImageRE.MatchString(line) {
					*errors = append(*errors, "纯文生视频版不得映射视觉图片")
					break
				}
			}
		}
	}

	// 8. 外部【本批上传ID映射】表双向对齐。
	externalMappingAliases := map[string]struct{}{}
	for _, row := range externalMappingRowRE.FindAllStringSubmatch(text, -1) {
		externalMappingAliases[whitespaceRE.ReplaceAllString(row[1], "")] = struct{}{}
	}
	if len(mappedAliases) > 0 {
		if len(externalMappingAliases) == 0 {
			*errors = append(*errors, "提示词使用了素材槽位，但缺少外部【本批上传ID映射】表")
		} else {
			if missing := directorSortedDifference(mappedAliases, externalMappingAliases); len(missing) > 0 {
				*errors = append(*errors, "提示词素材未列入外部上传映射："+strings.Join(missing, "、"))
			}
			if unused := directorSortedDifference(externalMappingAliases, mappedAliases); len(unused) > 0 {
				*errors = append(*errors, "外部上传映射包含本批未使用槽位："+strings.Join(unused, "、"))
			}
		}
	}

	// 9. 后文引用但未映射。
	normalizedUsed := map[string]struct{}{}
	for _, alias := range directorLookbehindAll(outside, aliasRefRE) {
		normalizedUsed[whitespaceRE.ReplaceAllString(alias, "")] = struct{}{}
	}
	if missing := directorSortedDifference(normalizedUsed, mappedAliases); len(missing) > 0 {
		*errors = append(*errors, "后文引用但未映射："+strings.Join(missing, "、"))
	}

	// 10. 可辨识台词与声音模式。
	spokenScopeNames := []string{"镜头序列", "一镜到底执行声明", "新增镜头序列", "修改要求"}
	spokenParts := make([]string, 0, len(spokenScopeNames))
	for _, name := range spokenScopeNames {
		if body := sectionText(text, name); body != "" {
			spokenParts = append(spokenParts, body)
		}
	}
	spokenScope := strings.Join(spokenParts, "\n")

	var dialogueLines []string
	for _, line := range directorLines(spokenScope) {
		if speechTriggerRE.MatchString(line) || roleCueRE.MatchString(line) {
			dialogueLines = append(dialogueLines, line)
		}
	}

	mappedAudio := make([]string, 0, len(mappedAliases))
	for alias := range mappedAliases {
		if strings.HasPrefix(alias, "音频") {
			mappedAudio = append(mappedAudio, alias)
		}
	}
	sort.Strings(mappedAudio)

	switch voiceMode {
	case "mapped_dry_voice":
		if len(dialogueLines) > 0 && len(mappedAudio) == 0 {
			*errors = append(*errors, "检测到对白/旁白，但【素材映射】没有对应干声音频")
		}
		for index, line := range dialogueLines {
			localBinding := dialogueBindingRE.FindStringSubmatch(line)
			if localBinding == nil {
				preview := []rune(line)
				suffix := ""
				if len(preview) > 80 {
					preview = preview[:80]
					suffix = "…"
				}
				*errors = append(*errors, fmt.Sprintf("对白/旁白须写成‘角色/旁白（音频N，表演参数）：台词’（声音段第%d行）：%s%s", index+1, string(preview), suffix))
				continue
			}
			alias := "音频" + localBinding[2]
			localSpeaker := localBinding[1]
			if mappedSpeaker, ok := audioSpeakers[alias]; ok && mappedSpeaker != localSpeaker {
				*errors = append(*errors, fmt.Sprintf("角色音频错配：%s使用%s，但素材映射标记为%s", localSpeaker, alias, mappedSpeaker))
			}
		}
	case "model_voice":
		if len(mappedAudio) > 0 || audioNumberRE.MatchString(spokenScope) {
			*errors = append(*errors, "model_voice模式不得绑定或引用干声音频编号")
		}
		if len(dialogueLines) > 0 {
			*warnings = append(*warnings, "model_voice模式含可辨识语言：跨单元音色一致性需要实测")
		}
	case "post_dub":
		if len(mappedAudio) > 0 || audioNumberRE.MatchString(spokenScope) {
			*errors = append(*errors, "post_dub模式不得绑定或引用虚构干声音频编号")
		}
		if len(dialogueLines) > 0 && !regexp.MustCompile(`后期配音|后期替换|后期声音`).MatchString(spokenScope) {
			*errors = append(*errors, "post_dub模式的台词镜头必须声明声音由后期配音替换")
		}
	}

	// 11. 风格锁定与禁设栏目。
	styleText := sectionText(text, "风格锁定")
	if styleDurationRE.MatchString(styleText) {
		*errors = append(*errors, "【风格锁定】不得声明总长/总时长，时长由平台控制")
	}
	styleBody := strings.TrimSpace(strings.ReplaceAll(styleText, "【风格锁定】", ""))
	if mode == "new" && utf8.RuneCountInString(styleBody) < 40 {
		*warnings = append(*warnings, "【风格锁定】内容过短，可能不足以锁定摄影、光线、色彩与材质")
	}
	if mode == "new" && !cameraSystemRE.MatchString(styleBody) {
		*warnings = append(*warnings, "【风格锁定】未检测到明确的摄影或镜头系统")
	}

	for _, forbidden := range []string{"镜头设计", "角色表演与声音"} {
		if strings.Contains(text, "【"+forbidden+"】") {
			*errors = append(*errors, fmt.Sprintf("不得单设【%s】，具体要求应写入对应镜头", forbidden))
		}
	}

	for _, pattern := range chineseNumberREs {
		if pattern.MatchString(text) {
			*errors = append(*errors, "所有可量化数字须使用阿拉伯数字，不得使用中文数字")
			break
		}
	}

	if mode == "new" {
		for _, obsolete := range []string{"故事与情绪曲线", "地形、空间与连续性锁定"} {
			if strings.Contains(text, "【"+obsolete+"】") {
				*errors = append(*errors, fmt.Sprintf("全新生成不再使用【%s】；故事情绪放在提示词外，空间信息写入【场景与空间锚点】", obsolete))
			}
		}
	}

	// 12. 镜头字段、一镜到底与时间码。
	if mode == "new" {
		for _, item := range externalContextREs {
			if item.re.MatchString(text) {
				*errors = append(*errors, item.message)
			}
		}

		oneTakeHeader := strings.Contains(text, "【一镜到底执行声明】")
		sequenceName := "镜头序列"
		if oneTakeHeader {
			sequenceName = "一镜到底执行声明"
		}
		sequence := sectionText(text, sequenceName)
		shotMatches := shotHeadRE.FindAllStringSubmatchIndex(sequence, -1)
		isOneTake := oneTakeHeader
		if isOneTake {
			if len(shotMatches) > 0 {
				*errors = append(*errors, "一镜到底不设置【镜头序列】或镜头编号，直接使用【一镜到底执行声明】")
			}
			for _, section := range []string{"一镜到底执行声明", "起手式", "连续时间轴", "最终镜头落点"} {
				if !strings.Contains(sequence, "【"+section+"】") {
					*errors = append(*errors, "一镜到底缺少【"+section+"】")
				}
			}
			internalTimecodes := directorTimecodePairs(internalTimecodeRE.FindAllStringSubmatch(sequence, -1))
			if len(internalTimecodes) < 2 {
				*errors = append(*errors, "一镜到底的【连续时间轴】至少需要两个连续时间段")
			} else {
				for index, pair := range internalTimecodes {
					if pair[1] <= pair[0] {
						*errors = append(*errors, fmt.Sprintf("一镜到底第%d个时间段结束时间不大于开始时间", index+1))
					}
					if index > 0 && absFloat(pair[0]-internalTimecodes[index-1][1]) > 0.11 {
						*errors = append(*errors, fmt.Sprintf("一镜到底时间轴不连续：%s秒 → %s秒", formatG(internalTimecodes[index-1][1]), formatG(pair[0])))
					}
				}
			}
			for _, loc := range cutWordRE.FindAllStringIndex(sequence, -1) {
				runes := []rune(sequence)
				from := loc[0] - 18
				if from < 0 {
					from = 0
				}
				preceding := string(runes[from:loc[0]])
				if !cutGuardRE.MatchString(preceding) {
					*errors = append(*errors, "一镜到底的镜头序列中出现了切镜或转场指令")
					break
				}
			}
			if zoomChangeRE.MatchString(sequence) {
				*errors = append(*errors, "一镜到底使用定焦镜头时不得连续改变焦段")
			}
		}
		for index, match := range shotMatches {
			end := len(sequence)
			if index+1 < len(shotMatches) {
				end = shotMatches[index+1][0]
			}
			body := sequence[match[0]:end]
			shotNumber := sequence[match[2]:match[3]]
			missingFields := []string{}
			if !isOneTake {
				for _, field := range []string{"机位与构图：", "运镜：", "画面内容："} {
					if !strings.Contains(body, field) {
						missingFields = append(missingFields, field)
					}
				}
			}
			if len(missingFields) > 0 {
				*errors = append(*errors, fmt.Sprintf("镜头%s缺少固定字段：%s", shotNumber, strings.Join(missingFields, "、")))
			}
			if isOneTake {
				continue
			}
			cameraText, ok := directorCameraText(body)
			if !ok {
				continue
			}
			if !shotSizeRE.MatchString(cameraText) {
				*errors = append(*errors, fmt.Sprintf("镜头%s的【机位与构图】未明确景别", shotNumber))
			}
			if strings.Contains(cameraText, "景别为") {
				*errors = append(*errors, fmt.Sprintf("镜头%s请直接写景别名称，不要使用‘景别为’", shotNumber))
			}
			if !focusRE.MatchString(cameraText) {
				*errors = append(*errors, fmt.Sprintf("镜头%s的【机位与构图】未说明焦点与清晰/虚焦关系", shotNumber))
			}
			if strings.Contains(cameraText, "过肩") && !(strings.Contains(cameraText, "前景") && strings.Contains(cameraText, "虚焦") && focusRE.MatchString(cameraText)) {
				*errors = append(*errors, fmt.Sprintf("镜头%s为过肩构图，须说明前景肩膀/后脑、虚焦程度和对面焦点", shotNumber))
			}
		}
	}

	if mode == "new" || mode == "extend" {
		timecodes := directorTimecodePairs(shotTimecodeRE.FindAllStringSubmatch(text, -1))
		if len(timecodes) == 0 && !strings.Contains(text, "【一镜到底执行声明】") {
			*warnings = append(*warnings, "未检测到镜头时间码")
		} else {
			for index, pair := range timecodes {
				if pair[1] <= pair[0] {
					*errors = append(*errors, fmt.Sprintf("第%d个时间码结束时间不大于开始时间", index+1))
				}
				if index > 0 && absFloat(pair[0]-timecodes[index-1][1]) > 0.11 {
					*errors = append(*errors, fmt.Sprintf("时间码不连续：%s秒 → %s秒", formatG(timecodes[index-1][1]), formatG(pair[0])))
				}
			}
		}
	}

	durationTimecodes := directorTimecodePairs(shotTimecodeRE.FindAllStringSubmatch(text, -1))
	if strings.Contains(text, "【一镜到底执行声明】") {
		durationTimecodes = append(durationTimecodes, directorTimecodePairs(internalTimecodeRE.FindAllStringSubmatch(text, -1))...)
	}
	if (mode == "new" || mode == "extend") && len(durationTimecodes) > 0 {
		maxEnd := durationTimecodes[0][1]
		for _, pair := range durationTimecodes {
			if pair[1] > maxEnd {
				maxEnd = pair[1]
			}
		}
		maxDuration := 30.0
		if modelVersion == "2.0" {
			maxDuration = 15.0
		}
		if maxEnd > maxDuration+0.05 {
			*errors = append(*errors, fmt.Sprintf("Seedance %s单批时间码达到%s秒，超过%s秒上限", modelVersion, formatG(maxEnd), formatG(maxDuration)))
		}
	}
	if modelVersion == "2.0" && mode == "extend" {
		*warnings = append(*warnings, "Seedance 2.0不建议把视频延长作为常规衔接；优先使用自然切点或抽帧接力")
	}

	result.OK = len(result.Errors) == 0
	return result
}

// normalizePromptRequest 对齐 CLI 默认值：空串取默认，非空但不在枚举内报错。
func normalizePromptRequest(req PromptValidateRequest) (platform, mode, modelVersion, assetMode, voiceMode, invalid string) {
	platform, mode, modelVersion, assetMode, voiceMode = req.Platform, req.Mode, req.ModelVersion, req.AssetMode, req.VoiceMode
	if platform == "" {
		platform = "jimeng"
	}
	if mode == "" {
		mode = "new"
	}
	if modelVersion == "" {
		modelVersion = "2.5"
	}
	if assetMode == "" {
		assetMode = "mapped"
	}
	if voiceMode == "" {
		voiceMode = "mapped_dry_voice"
	}
	switch platform {
	case "jimeng", "libtv":
	default:
		invalid = fmt.Sprintf("platform 无效：%s（仅支持 jimeng/libtv）", platform)
		return
	}
	switch mode {
	case "new", "extend", "edit":
	default:
		invalid = fmt.Sprintf("mode 无效：%s（仅支持 new/extend/edit）", mode)
		return
	}
	switch modelVersion {
	case "2.5", "2.0":
	default:
		invalid = fmt.Sprintf("modelVersion 无效：%s（仅支持 2.5/2.0）", modelVersion)
		return
	}
	switch assetMode {
	case "mapped", "text", "hybrid":
	default:
		invalid = fmt.Sprintf("assetMode 无效：%s（仅支持 mapped/text/hybrid）", assetMode)
		return
	}
	switch voiceMode {
	case "mapped_dry_voice", "model_voice", "post_dub":
	default:
		invalid = fmt.Sprintf("voiceMode 无效：%s（仅支持 mapped_dry_voice/model_voice/post_dub）", voiceMode)
		return
	}
	return
}

// sectionSpan 对齐 Python section_span：返回 [start, end)，end 为下一个顶级栏目或文末。
func sectionSpan(text, name string) (span [2]int, ok bool) {
	marker := "【" + name + "】"
	start := strings.Index(text, marker)
	if start < 0 {
		return span, false
	}
	tail := text[start+len(marker):]
	end := len(text)
	for _, section := range topLevelSections {
		next := "\n【" + section + "】"
		if at := strings.Index(tail, next); at >= 0 && start+len(marker)+at < end {
			end = start + len(marker) + at
		}
	}
	return [2]int{start, end}, true
}

// sectionText 对齐 Python section_text。
func sectionText(text, name string) string {
	span, ok := sectionSpan(text, name)
	if !ok {
		return ""
	}
	return text[span[0]:span[1]]
}

// extractPromptPayload 对齐 Python extract_prompt_payload。
func extractPromptPayload(text, mode string) string {
	first := sectionsByMode[mode][0]
	marker := "【" + first + "】"
	start := strings.Index(text, marker)
	if start < 0 {
		return strings.TrimSpace(text)
	}
	payload := text[start:]
	if loc := markdownHeadingRE.FindStringIndex(payload); loc != nil {
		payload = payload[:loc[0]]
	}
	return strings.TrimSpace(payload)
}

// directorCameraText 模拟 Python re.search(r"机位与构图：(.*?)(?=\n运镜：)", body, re.DOTALL)：
// 取首个「机位与构图：」之后、下一个「\n运镜：」之前的内容；没有下一个运镜字段
// 时后向断言失败，等价于无匹配。
func directorCameraText(body string) (string, bool) {
	start := strings.Index(body, "机位与构图：")
	if start < 0 {
		return "", false
	}
	rest := body[start+len("机位与构图："):]
	end := strings.Index(rest, "\n运镜：")
	if end < 0 {
		return "", false
	}
	return rest[:end], true
}

// directorLookbehindMiss 模拟 Python re.search(r"(?<![A-Za-z{])图\s*\d+", text)：
// RE2 无后向断言，命中后回退一个字节检查前字符（A-Za-z{ 均为 ASCII，字节级判定安全）。
func directorLookbehindMiss(text string, re *regexp.Regexp) bool {
	for _, loc := range re.FindAllStringIndex(text, -1) {
		if loc[0] == 0 {
			return true
		}
		if prev := text[loc[0]-1]; !((prev >= 'A' && prev <= 'Z') || (prev >= 'a' && prev <= 'z') || prev == '{') {
			return true
		}
	}
	return false
}

// directorLookbehindAll 模拟 Python re.findall(r"(?<![A-Za-z{])(?:图|音频|视频)\s*\d+", outside)。
func directorLookbehindAll(text string, re *regexp.Regexp) []string {
	var hits []string
	for _, loc := range re.FindAllStringIndex(text, -1) {
		if loc[0] > 0 {
			if prev := text[loc[0]-1]; (prev >= 'A' && prev <= 'Z') || (prev >= 'a' && prev <= 'z') || prev == '{' {
				continue
			}
		}
		hits = append(hits, text[loc[0]:loc[1]])
	}
	return hits
}

// directorLines 对齐 Python str.splitlines() 在 LF 文本上的行为。
func directorLines(text string) []string {
	if text == "" {
		return nil
	}
	return strings.Split(text, "\n")
}

// directorNonEmptyLines 返回 strip 后非空且满足 keep 的行（strip 后比较）。
func directorNonEmptyLines(text string, keep func(line string) bool) []string {
	var lines []string
	for _, line := range directorLines(text) {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if keep != nil && !keep(trimmed) {
			continue
		}
		lines = append(lines, trimmed)
	}
	return lines
}

// directorFirstLineContaining 对齐 Python next((line.strip() for line in ... if marker in line), "")。
func directorFirstLineContaining(text, marker string) string {
	for _, line := range directorLines(text) {
		trimmed := strings.TrimSpace(line)
		if strings.Contains(trimmed, marker) {
			return trimmed
		}
	}
	return ""
}

// directorTimecodePairs 把 FindAllStringSubmatch 的 (start, end) 字符串对转 float 对。
func directorTimecodePairs(matches [][]string) [][2]float64 {
	pairs := make([][2]float64, 0, len(matches))
	for _, match := range matches {
		start, errStart := strconv.ParseFloat(match[1], 64)
		end, errEnd := strconv.ParseFloat(match[2], 64)
		if errStart != nil || errEnd != nil {
			continue
		}
		pairs = append(pairs, [2]float64{start, end})
	}
	return pairs
}

// directorSortedDifference 对齐 Python sorted(a - b)：按 code point 排序的差集。
func directorSortedDifference(from, without map[string]struct{}) []string {
	diff := make([]string, 0, len(from))
	for key := range from {
		if _, ok := without[key]; !ok {
			diff = append(diff, key)
		}
	}
	sort.Strings(diff)
	return diff
}

func absFloat(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}

// formatG 对齐 Python f"{value:g}"。
func formatG(value float64) string {
	return strconv.FormatFloat(value, 'g', -1, 64)
}
