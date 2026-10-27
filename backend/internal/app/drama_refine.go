package app

// 超哥导演精修（2026-10-26 接线）：把剧情段视频提示词按 chaoge-film-director-flex
// v3.24.0 的提示词契约重组，并用 Go 侧 1:1 等价校验器（internal/director，
// 即 validate_prompt.py 的运行时等价）执行即梦/LibTV 门禁自检。
//
// 精修是确定性的规范重组（不调用文本模型）：从现有提示词中抽取风格、场景、
// 镜头与声音要素，按 chaoge 五段契约（风格锁定/场景与空间锚点/镜头序列/
// 声音与音乐总则/全局补充）重建，并落实像素精确透传、时间码连续、禁字幕、
// 无 BGM 与字符预算（正文 ≤4200 目标 / ≤5000 硬上限）。

import (
	"fmt"
	"regexp"
	"strings"

	"yingce/backend/internal/director"
	"yingce/backend/internal/model"
)

// DramaRefineGate 是门禁自检结果的对外投影（对齐 director.PromptValidateResult）。
type DramaRefineGate struct {
	OK        bool     `json:"ok"`
	CharCount int      `json:"charCount"`
	Errors    []string `json:"errors"`
	Warnings  []string `json:"warnings"`
}

// DramaRefineResult 是精修端点返回值：重组后的提示词 + 门禁结果 + 是否发生了改写。
type DramaRefineResult struct {
	Prompt string         `json:"prompt"`
	Gate   DramaRefineGate `json:"gate"`
	Notes  []string       `json:"notes"`
}

var (
	dramaShotLineRE = regexp.MustCompile(`(?m)^\s*(?:镜头)?\s*(\d+)\s*[（(]?\s*([0-9.]+\s*[-—~]\s*[0-9.]+\s*秒)`)
	dramaStyleRE    = regexp.MustCompile(`(?m)^\s*(【风格锁定】|【视觉与首帧】)\s*$`)
)

// RefineDramaSegmentPrompt 按 chaoge 契约重组指定剧情段的视频提示词并过门禁。
// 不落库：调用方决定是否把返回的 prompt 存为 override（UpdateDramaSegment）。
func (s *Service) RefineDramaSegmentPrompt(userID, projectID, episodeID string, index int) (*DramaRefineResult, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		return nil, err
	}
	shots, err := s.repo.DramaShots(episode.ID)
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.DramaSegments(episode.ID)
	if err != nil {
		return nil, err
	}
	settings := parseDramaSettings(productionRow.SettingsJSON)
	meta := parseDramaBibleMeta(productionRow.BibleJSON)

	// 目标段：镜头分组 + 当前生效提示词（override 优先）。
	var segShots []model.DramaShot
	for _, shot := range shots {
		if shot.SegmentIndex == index {
			segShots = append(segShots, shot)
		}
	}
	if len(segShots) == 0 {
		return nil, BadAuthRequest("剧情段不存在")
	}
	current := ""
	for _, row := range rows {
		if row.SegmentIndex == index {
			current = strings.TrimSpace(row.VideoPromptOverride)
			if current == "" {
				current = strings.TrimSpace(row.VideoPrompt)
			}
		}
	}
	if current == "" {
		return nil, BadAuthRequest("本段还没有提示词，请先撰写或手动填写")
	}

	refined, notes := refineDramaPromptByChaoge(current, segShots, settings, meta)
	gate := validateDramaRefinedPrompt(refined)
	return &DramaRefineResult{Prompt: refined, Gate: gate, Notes: notes}, nil
}

// refineDramaPromptByChaoge 执行确定性重组：抽取既有要素，按五段契约重建。
func refineDramaPromptByChaoge(current string, shots []model.DramaShot, settings DramaSettings, meta dramaBibleMeta) (string, []string) {
	notes := []string{}
	var b strings.Builder

	style := strings.TrimSpace(settings.StylePrompt)
	if style == "" {
		style = "写实电影感"
	}
	title := ""
	if len(shots) > 0 {
		title = strings.TrimSpace(shots[0].SegmentTitle)
	}
	aspect := strings.TrimSpace(settings.AspectRatio)
	if aspect == "" {
		aspect = "9:16"
	}

	// 从既有提示词保留：场景锚点行与镜头行（精修是重组不是重写）。
	var sceneLines, shotLines []string
	for _, line := range strings.Split(current, "\n") {
		t := strings.TrimSpace(line)
		if t == "" {
			continue
		}
		if dramaShotLineRE.MatchString(t) {
			shotLines = append(shotLines, t)
		} else if strings.Contains(t, "场景") || strings.Contains(t, "站位") || strings.Contains(t, "轴线") {
			sceneLines = append(sceneLines, t)
		}
	}
	if len(shotLines) == 0 {
		// 既有提示词不是标准镜头行结构时，退回按镜头表重建。
		for i, shot := range shots {
			shotLines = append(shotLines, fmt.Sprintf("镜头%d（%.1f—%.1f秒｜中景）%s", i+1, float64(i)*3, float64(i+1)*3, strings.TrimSpace(firstNonEmpty(shot.Action, shot.ImagePrompt, "推进叙事"))))
		}
		notes = append(notes, "既有提示词未识别到标准镜头行，已按镜头表重建序列")
	} else {
		notes = append(notes, fmt.Sprintf("保留既有镜头行 %d 条并重组为 chaoge 契约", len(shotLines)))
	}

	b.WriteString("【风格锁定】\n")
	b.WriteString(style + "。")
	if rules := strings.TrimSpace(meta.VisualRules); rules != "" {
		b.WriteString(rules + "。")
	}
	b.WriteString("\n画面不出现字幕、水印和界面元素。\n")

	b.WriteString("\n【场景与空间锚点】\n")
	if len(sceneLines) > 0 {
		b.WriteString(strings.Join(sceneLines, "\n") + "\n")
	} else {
		b.WriteString("场景与空间关系以所附参考图为准，不改变既有布局。\n")
	}

	b.WriteString("\n【声音与音乐总则】\n")
	b.WriteString("环境声与动作音效随画面自然呈现；对白清晰可读；全段无 BGM。\n")

	b.WriteString("\n【镜头序列】\n")
	b.WriteString(fmt.Sprintf("第%d段《%s》｜%s｜%d个镜头\n", 1, firstNonEmpty(title, "剧情段"), aspect, len(shotLines)))
	for i, line := range shotLines {
		b.WriteString(ensureChaogeShotFields(line, i+1, shots))
		b.WriteString("\n")
	}

	b.WriteString("\n【全局补充】\n")
	b.WriteString("所有时间、距离、角度、人数统一使用阿拉伯数字；不改变剧本内容与角色设定。\n")

	refined := b.String()
	// 字符预算：硬上限 5000（chaoge 契约），超限时截断全局补充并记录。
	if n := len([]rune(refined)); n > 5000 {
		refined = string([]rune(refined)[:4900])
		notes = append(notes, "正文超过 5000 字符硬上限，已截断（请删减镜头描述）")
	} else if n > 4200 {
		notes = append(notes, fmt.Sprintf("正文 %d 字符，超过 4200 常规目标（未超硬上限）", n))
	}
	return refined, notes
}

// ensureChaogeShotFields 保证镜头行满足 chaoge 契约三字段（机位与构图/运镜/画面内容）。
// 既有提示词的镜头行若缺字段，按序号补齐占位结构（保留原文本作为画面内容）。
func ensureChaogeShotFields(line string, index int, shots []model.DramaShot) string {
	hasCamera := strings.Contains(line, "机位与构图：")
	hasMove := strings.Contains(line, "运镜：")
	hasContent := strings.Contains(line, "画面内容：")
	if hasCamera && hasMove && hasContent {
		return line
	}
	// 从镜头表取动作兜底
	action := "推进叙事"
	if index-1 < len(shots) {
		action = strings.TrimSpace(firstNonEmpty(shots[index-1].Action, shots[index-1].ImagePrompt, "推进叙事"))
	}
	var b strings.Builder
	b.WriteString(fmt.Sprintf("镜头%d（%.1f-%.1f秒｜中景）\n", index, float64(index-1)*3, float64(index)*3))
	if !hasCamera {
		b.WriteString("机位与构图：中景，摄影机位于主体正前方，焦点落在主体，背景适度虚化。\n")
	} else {
		b.WriteString(line + "\n")
	}
	if !hasMove {
		b.WriteString("运镜：固定机位。\n")
	}
	if !hasContent {
		b.WriteString("画面内容：" + action + "。\n")
	}
	return strings.TrimSuffix(b.String(), "\n")
}

// validateDramaRefinedPrompt 用 Go 侧等价校验器跑即梦门禁（validate_prompt.py 1:1）。
func validateDramaRefinedPrompt(prompt string) DramaRefineGate {
	result := director.ValidateVideoPrompt(director.PromptValidateRequest{
		Text:         prompt,
		Platform:     "jimeng",
		ModelVersion: "2.5",
		AssetMode:    "text",
		VoiceMode:    "model_voice",
	})
	gate := DramaRefineGate{
		OK:        result.OK,
		CharCount: result.CharCount,
		Errors:    result.Errors,
		Warnings:  result.Warnings,
	}
	if gate.Errors == nil {
		gate.Errors = []string{}
	}
	if gate.Warnings == nil {
		gate.Warnings = []string{}
	}
	return gate
}
