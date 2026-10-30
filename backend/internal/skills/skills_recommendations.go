package skills

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
)

//go:embed seed/recommendations.json
var builtinSkillRecommendationsJSON []byte

// 按行业推荐的内置技能（只读目录，随技能种子发布）。推荐只决定“建议安装什么”，
// 安装与否、安装后是否允许 Agent 自动使用，仍由用户在技能库里决定。

type skillRecommendationSeed struct {
	SkillID string `json:"skillId"`
	Reason  string `json:"reason"`
}

type skillRecommendationIndustrySeed struct {
	IndustryID  string                    `json:"industryId"`
	Name        string                    `json:"name"`
	Description string                    `json:"description"`
	Icon        string                    `json:"icon"`
	Skills      []skillRecommendationSeed `json:"skills"`
}

type skillRecommendationsFile struct {
	Version    int                               `json:"version"`
	Note       string                            `json:"note"`
	Industries []skillRecommendationIndustrySeed `json:"industries"`
}

type SkillRecommendationItem struct {
	SkillID     string `json:"skillId"`
	SkillName   string `json:"skillName"`
	Description string `json:"description"`
	Tag         string `json:"tag"`
	Reason      string `json:"reason"`
	IsAdded     bool   `json:"isAdded"`
}

type SkillRecommendationIndustry struct {
	IndustryID     string                    `json:"industryId"`
	Name           string                    `json:"name"`
	Description    string                    `json:"description"`
	Icon           string                    `json:"icon"`
	Skills         []SkillRecommendationItem `json:"skills"`
	InstalledCount int                       `json:"installedCount"`
}

type SkillRecommendationList struct {
	Industries []SkillRecommendationIndustry `json:"industries"`
	// InstalledTotal 是用户技能库里可用技能的总数，前端据此决定是否主动展示推荐入口。
	InstalledTotal int `json:"installedTotal"`
}

type SkillRecommendationInstallRequest struct {
	SkillIDs []string `json:"skillIds"`
}

type SkillRecommendationInstallResult struct {
	IndustryID string   `json:"industryId"`
	Installed  []string `json:"installed"`
	Skipped    []string `json:"skipped"`
}

const skillRecommendationMaxPerIndustry = 12

var skillRecommendationIcons = map[string]struct{}{
	"shapes": {}, "film": {}, "shopping-bag": {}, "megaphone": {}, "landmark": {}, "palette": {}, "users": {}, "wrench": {},
}

func loadSkillRecommendations() (skillRecommendationsFile, error) {
	var file skillRecommendationsFile
	if err := json.Unmarshal(builtinSkillRecommendationsJSON, &file); err != nil {
		return file, fmt.Errorf("解析行业推荐技能失败: %w", err)
	}
	if file.Version != 1 {
		return file, fmt.Errorf("行业推荐技能版本必须为 1，当前 %d", file.Version)
	}
	if len(file.Industries) == 0 {
		return file, fmt.Errorf("行业推荐技能不能为空")
	}
	seenIndustry := map[string]struct{}{}
	for _, industry := range file.Industries {
		id := strings.TrimSpace(industry.IndustryID)
		if !skillPresetIDPattern.MatchString(id) {
			return file, fmt.Errorf("行业推荐 ID 非法: %q", industry.IndustryID)
		}
		if _, dup := seenIndustry[id]; dup {
			return file, fmt.Errorf("行业推荐 ID 重复: %s", id)
		}
		seenIndustry[id] = struct{}{}
		if strings.TrimSpace(industry.Name) == "" || utf8.RuneCountInString(industry.Name) > 20 {
			return file, fmt.Errorf("行业推荐 %s 的名称为空或过长", id)
		}
		if _, ok := skillRecommendationIcons[industry.Icon]; !ok {
			return file, fmt.Errorf("行业推荐 %s 的图标非法: %q", id, industry.Icon)
		}
		if len(industry.Skills) == 0 || len(industry.Skills) > skillRecommendationMaxPerIndustry {
			return file, fmt.Errorf("行业推荐 %s 的技能数 %d 超出 1-%d", id, len(industry.Skills), skillRecommendationMaxPerIndustry)
		}
		seenSkill := map[string]struct{}{}
		for _, skill := range industry.Skills {
			if strings.TrimSpace(skill.SkillID) == "" {
				return file, fmt.Errorf("行业推荐 %s 含空技能 ID", id)
			}
			if _, dup := seenSkill[skill.SkillID]; dup {
				return file, fmt.Errorf("行业推荐 %s 的技能重复: %s", id, skill.SkillID)
			}
			seenSkill[skill.SkillID] = struct{}{}
			if reason := strings.TrimSpace(skill.Reason); reason == "" || utf8.RuneCountInString(reason) > 60 {
				return file, fmt.Errorf("行业推荐 %s 的技能 %s 推荐理由为空或超过 60 字", id, skill.SkillID)
			}
		}
	}
	return file, nil
}

// retiredSkillRedirectMap 登记 2026-10-25「短剧 27 进 8」收敛时收编退役的 19 个
// 旧短剧包（目录名与稳定 skillId 双键），统一映射到保留的 8 大核心短剧包
// （2 主核：影视剧作工坊 / chaoge-film-director-flex；6 专项：短剧实战手册 /
// 故事结构引擎 / 角色锻造工坊 / 对白工坊 / 分镜语法 / 世界观美术设定）。
// 上游 recommendations.json 历史版本引用过这些退役 ID（如 v1.7.3.2 合流事故）；
// 校验与读取路径都先走本表重定向，保证用户端看到的是收敛后的 8 大核。
var retiredSkillRedirectMap = map[string]string{
	// 主核·影视剧作工坊（剧本打磨与导演链路校验）
	"影策短剧制作工作流":            "yingshi-drama-workshop",
	"yingce-short-drama-workflow": "yingshi-drama-workshop",
	"三幕式短剧工厂":               "yingshi-drama-workshop",
	"14811816983308":             "yingshi-drama-workshop",
	"剧本撰写":                   "yingshi-drama-workshop",
	"14811816982796":             "yingshi-drama-workshop",
	// 主核·chaoge-film-director-flex（定稿剧本接 AI 导演出片）
	"一图成片-电影广告全能导演": "chaoge-film-director-flex",
	"14811816981772":         "chaoge-film-director-flex",
	"一镜到底短剧流水线":       "chaoge-film-director-flex",
	"16000000000077":         "chaoge-film-director-flex",
	"剧本资产视频一条龙创作":    "chaoge-film-director-flex",
	"14811816970252":         "chaoge-film-director-flex",
	// 专项·短剧实战手册（钩子/反转/卡点）
	"剧本工业化机器":  "16000000000081",
	"16000000000076": "16000000000081",
	// 专项·故事结构引擎（幕/节拍/高潮；吸收故事开发与弧光规划）
	"故事开发":       "16000000000084",
	"14811816983052": "16000000000084",
	"短片五阶段结构":   "16000000000084",
	"16000000000080": "16000000000084",
	// 专项·角色锻造工坊（人物/表演/声音；吸收 AI 表演实验室与角色设计）
	"ai-表演实验室":   "16000000000073",
	"16000000000086": "16000000000073",
	"ai演员微表情导演":  "16000000000073",
	"14889899552012": "16000000000073",
	"系列弧光规划":     "16000000000073",
	"16000000000079": "16000000000073",
	"角色设计":       "16000000000073",
	"14811816982284": "16000000000073",
	// 专项·对白工坊（潜台词/声口；吸收情景喜剧、相声、脱口秀）
	"情景喜剧工坊":  "16000000000075",
	"16000000000082": "16000000000075",
	"相声手艺":    "16000000000075",
	"16000000000085": "16000000000075",
	"脱口秀手艺":   "16000000000075",
	"16000000000083": "16000000000075",
	// 专项·分镜语法（镜头语言/剪辑；吸收叙事短片导演分镜与视听理论）
	"剪辑节奏":       "16000000000094",
	"16000000000088": "16000000000094",
	"叙事短片导演分镜":  "16000000000094",
	"14811816970508": "16000000000094",
	"视听理论基础":    "16000000000094",
	"16000000000087": "16000000000094",
}

// sanitizeSkillRecommendations 对内存中的推荐目录执行「退役重定向 + 容错过滤」：
// 命中 retiredSkillRedirectMap 的引用改写为保留核心包并按行业去重；重定向后
// 仍不在现役 builtin 集合的引用从内存列表剔除并打 log.Warn——绝不向上返回
// 致命错误。上游 recommendations.json 未来再引入失效 ID 时后端仍可正常启动。
// 返回被剔除的引用数。
func sanitizeSkillRecommendations(file *skillRecommendationsFile, seeded map[string]struct{}) int {
	dropped := 0
	for industryIndex := range file.Industries {
		industry := &file.Industries[industryIndex]
		kept := make([]skillRecommendationSeed, 0, len(industry.Skills))
		seen := make(map[string]struct{}, len(industry.Skills))
		for _, seed := range industry.Skills {
			id := seed.SkillID
			if target, retired := retiredSkillRedirectMap[id]; retired {
				id = target
			}
			if _, ok := seeded[id]; !ok {
				log.Printf("行业推荐 %s 剔除失效技能引用 %q（重定向后仍非现役内置技能）", industry.IndustryID, seed.SkillID)
				dropped++
				continue
			}
			if _, dup := seen[id]; dup {
				continue
			}
			seen[id] = struct{}{}
			seed.SkillID = id
			kept = append(kept, seed)
		}
		industry.Skills = kept
	}
	return dropped
}

// ValidateSkillRecommendations 确认推荐目录只引用内置技能，启动时校验，坏数据不上线。
// 退役技能先走 retiredSkillRedirectMap 重定向到保留核心包；重定向后仍非现役内置
// 技能的引用在内存中剔除并告警，不再返回致命错误阻断后端启动。
func ValidateSkillRecommendations() error {
	file, err := loadSkillRecommendations()
	if err != nil {
		return err
	}
	seedIDs, err := builtinSeedSkillIDs()
	if err != nil {
		return fmt.Errorf("校验行业推荐引用失败: %w", err)
	}
	seeded := make(map[string]struct{}, len(seedIDs))
	for _, id := range seedIDs {
		seeded[id] = struct{}{}
	}
	if dropped := sanitizeSkillRecommendations(&file, seeded); dropped > 0 {
		log.Printf("行业推荐目录已容错过滤 %d 个失效技能引用（退役技能已重定向到保留核心包）", dropped)
	}
	return nil
}

// SkillRecommendations 返回按行业分组的推荐技能及当前用户的安装状态；已删除或停用的技能不出现。
// 推荐目录先经 retiredSkillRedirectMap 重定向与容错过滤，用户端看到的永远是收敛后的保留技能。
func (s *Service) SkillRecommendations(userID string) (*SkillRecommendationList, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	file, err := loadSkillRecommendations()
	if err != nil {
		return nil, err
	}
	seedIDs, err := builtinSeedSkillIDs()
	if err != nil {
		return nil, fmt.Errorf("读取行业推荐引用失败: %w", err)
	}
	seeded := make(map[string]struct{}, len(seedIDs))
	for _, id := range seedIDs {
		seeded[id] = struct{}{}
	}
	sanitizeSkillRecommendations(&file, seeded)
	ids := make([]string, 0, 48)
	for _, industry := range file.Industries {
		for _, skill := range industry.Skills {
			ids = append(ids, skill.SkillID)
		}
	}
	rows, err := s.repo.AgentSkillCatalogRowsByIDs(userID, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]int, len(rows))
	for index, row := range rows {
		byID[row.ID] = index
	}
	states, err := s.repo.UserSkillStatesBySkillIDs(userID, ids)
	if err != nil {
		return nil, err
	}
	added := make(map[string]bool, len(states))
	for _, state := range states {
		added[state.SkillID] = state.Added
	}
	installed, err := s.repo.AgentSkillCatalogRows(userID)
	if err != nil {
		return nil, err
	}
	list := &SkillRecommendationList{Industries: make([]SkillRecommendationIndustry, 0, len(file.Industries)), InstalledTotal: len(installed)}
	for _, industry := range file.Industries {
		group := SkillRecommendationIndustry{IndustryID: industry.IndustryID, Name: industry.Name, Description: industry.Description, Icon: industry.Icon, Skills: []SkillRecommendationItem{}}
		for _, seed := range industry.Skills {
			index, ok := byID[seed.SkillID]
			if !ok {
				continue
			}
			row := rows[index]
			isAdded := added[row.ID] || row.OwnerID == userID
			if isAdded {
				group.InstalledCount++
			}
			group.Skills = append(group.Skills, SkillRecommendationItem{
				SkillID: row.ID, SkillName: row.Name, Description: row.Description, Tag: row.Tag, Reason: seed.Reason, IsAdded: isAdded,
			})
		}
		if len(group.Skills) > 0 {
			list.Industries = append(list.Industries, group)
		}
	}
	return list, nil
}

// InstallSkillRecommendations 安装某个行业的推荐技能；skillIds 为空时安装该行业全部推荐。
// 已安装、已删除或不在该行业推荐里的技能计入 skipped，不报错。
func (s *Service) InstallSkillRecommendations(userID, industryID string, req SkillRecommendationInstallRequest) (*SkillRecommendationInstallResult, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	file, err := loadSkillRecommendations()
	if err != nil {
		return nil, err
	}
	seedIDs, err := builtinSeedSkillIDs()
	if err != nil {
		return nil, fmt.Errorf("读取行业推荐引用失败: %w", err)
	}
	seeded := make(map[string]struct{}, len(seedIDs))
	for _, id := range seedIDs {
		seeded[id] = struct{}{}
	}
	sanitizeSkillRecommendations(&file, seeded)
	industryID = strings.TrimSpace(industryID)
	var target *skillRecommendationIndustrySeed
	for index := range file.Industries {
		if file.Industries[index].IndustryID == industryID {
			target = &file.Industries[index]
			break
		}
	}
	if target == nil {
		return nil, kernel.NotFound("行业推荐不存在")
	}
	if len(req.SkillIDs) > skillRecommendationMaxPerIndustry {
		return nil, kernel.BadAuthRequest("一次最多安装 12 个推荐技能")
	}
	allowed := make(map[string]struct{}, len(target.Skills))
	for _, skill := range target.Skills {
		allowed[skill.SkillID] = struct{}{}
	}
	wanted := make([]string, 0, len(target.Skills))
	if len(req.SkillIDs) == 0 {
		for _, skill := range target.Skills {
			wanted = append(wanted, skill.SkillID)
		}
	} else {
		seen := map[string]struct{}{}
		for _, id := range req.SkillIDs {
			id = strings.TrimSpace(id)
			if _, dup := seen[id]; dup || id == "" {
				continue
			}
			seen[id] = struct{}{}
			wanted = append(wanted, id)
		}
	}
	result := &SkillRecommendationInstallResult{IndustryID: industryID, Installed: []string{}, Skipped: []string{}}
	for _, id := range wanted {
		if _, ok := allowed[id]; !ok {
			result.Skipped = append(result.Skipped, id)
			continue
		}
		item, err := s.SkillDetail(userID, id)
		if err != nil || item.Status != skillStatusEnabled {
			result.Skipped = append(result.Skipped, id)
			continue
		}
		if item.IsAdded {
			result.Skipped = append(result.Skipped, id)
			continue
		}
		if _, err := s.SetSkillAdded(userID, id, true); err != nil {
			return nil, err
		}
		result.Installed = append(result.Installed, id)
	}
	return result, nil
}
