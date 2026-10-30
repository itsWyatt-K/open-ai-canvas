package skills

import "testing"

func TestSkillRecommendationsReferenceBuiltinSkills(t *testing.T) {
	if err := ValidateSkillRecommendations(); err != nil {
		t.Fatal(err)
	}
	file, err := loadSkillRecommendations()
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, industry := range file.Industries {
		if len(industry.Skills) == 0 {
			t.Fatalf("industry %s has no recommended skills", industry.IndustryID)
		}
		seen[industry.IndustryID] = true
	}
	for _, id := range []string{"drama", "ecommerce", "creative", "social"} {
		if !seen[id] {
			t.Fatalf("missing industry %s", id)
		}
	}
}

// 退役治理门禁：19 个退役短剧包的目录名与稳定 skillId 双键都必须重定向到
// 8 大核心包，且任何核心包 ID 不得反过来成为重定向键（防止循环改写）。
func TestRetiredSkillRedirectMapCoversConsolidatedPackages(t *testing.T) {
	retiredKeys := []string{
		"影策短剧制作工作流", "yingce-short-drama-workflow", "三幕式短剧工厂", "14811816983308", "剧本撰写", "14811816982796",
		"一图成片-电影广告全能导演", "14811816981772", "一镜到底短剧流水线", "16000000000077", "剧本资产视频一条龙创作", "14811816970252",
		"剧本工业化机器", "16000000000076",
		"故事开发", "14811816983052", "短片五阶段结构", "16000000000080",
		"ai-表演实验室", "16000000000086", "ai演员微表情导演", "14889899552012", "系列弧光规划", "16000000000079", "角色设计", "14811816982284",
		"情景喜剧工坊", "16000000000082", "相声手艺", "16000000000085", "脱口秀手艺", "16000000000083",
		"剪辑节奏", "16000000000088", "叙事短片导演分镜", "14811816970508", "视听理论基础", "16000000000087",
	}
	cores := []string{
		"yingshi-drama-workshop", "chaoge-film-director-flex", "16000000000081", "16000000000084",
		"16000000000073", "16000000000075", "16000000000094", "14811816982540",
	}
	for _, key := range retiredKeys {
		target, ok := retiredSkillRedirectMap[key]
		if !ok {
			t.Fatalf("退役键 %q 缺少重定向映射", key)
		}
		if !containsString(cores, target) {
			t.Fatalf("退役键 %q 重定向到非核心包 %q", key, target)
		}
	}
	for _, core := range cores {
		if _, ok := retiredSkillRedirectMap[core]; ok {
			t.Fatalf("核心包 %q 不应成为重定向键", core)
		}
	}
}

func containsString(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

// 容错过滤行为：退役引用重定向到核心包、重定向后去重、仍非现役的引用剔除并计数。
func TestSanitizeSkillRecommendationsRedirectsDedupesAndDrops(t *testing.T) {
	seeded := map[string]struct{}{
		"yingshi-drama-workshop": {}, "chaoge-film-director-flex": {}, "16000000000081": {},
		"16000000000084": {}, "16000000000073": {}, "16000000000075": {}, "16000000000094": {},
		"14811816982540": {},
	}
	file := skillRecommendationsFile{Industries: []skillRecommendationIndustrySeed{
		{IndustryID: "drama", Skills: []skillRecommendationSeed{
			{SkillID: "yingce-short-drama-workflow", Reason: "旧包引用"},
			{SkillID: "16000000000086", Reason: "AI 演员"},
			{SkillID: "16000000000088", Reason: "剪辑"},
			{SkillID: "16000000000081", Reason: "实战手册"},
			{SkillID: "99999999999", Reason: "上游脏数据"},
		}},
	}}
	dropped := sanitizeSkillRecommendations(&file, seeded)
	if dropped != 1 {
		t.Fatalf("dropped = %d, want 1", dropped)
	}
	got := []string{}
	for _, seed := range file.Industries[0].Skills {
		got = append(got, seed.SkillID)
	}
	want := []string{"yingshi-drama-workshop", "16000000000073", "16000000000094", "16000000000081"}
	if len(got) != len(want) {
		t.Fatalf("skills = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("skills = %v, want %v", got, want)
		}
	}
	if file.Industries[0].Skills[0].Reason != "旧包引用" {
		t.Fatalf("reason 丢失: %q", file.Industries[0].Skills[0].Reason)
	}
}

func TestNormalizeSkillAgentModeDefaultsToAuto(t *testing.T) {
	for input, want := range map[string]string{"": "auto", "auto": "auto", "manual": "manual", "bogus": "auto"} {
		if got := NormalizeSkillAgentMode(input); got != want {
			t.Fatalf("NormalizeSkillAgentMode(%q)=%q want %q", input, got, want)
		}
	}
}
