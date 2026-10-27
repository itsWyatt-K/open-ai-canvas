package app

// E2E 验收（2026-10-26 超哥 v3.24.0 × /projects 接线）：
// 建短剧项目 → 管线跑到段提示词就绪 → 超哥导演精修 → 门禁通过。

import (
	"strings"
	"testing"

	"yingce/backend/internal/production"
)

func TestDramaRefineEndToEndChaogeWiring(t *testing.T) {
	svc, _ := newDramaTestService(t)
	// 1) 建项目（超哥六大画风之一：真人影视风）并跑到段提示词就绪。
	settings := DramaSettings{ReviewMode: DramaReviewAuto, MediaMode: DramaMediaAuto, Concurrency: 16, Models: fakeDramaModels}
	settings.EpisodeSeconds = 60
	settings.StyleName = "真人影视风"
	settings.StylePrompt = "真人影视风：真实摄影成像，自然人体比例，有动机的方向性主光与受控反差，以明暗、色温及景深组织空间纵深，电影影调与讲究的镜头调度"
	settings.Storyboard.SegmentMode, settings.Storyboard.SegmentSeconds = production.SegmentFixed, 5
	summary, err := svc.CreateDrama("usr-drama", CreateDramaRequest{Name: "雨夜重逢", Start: true, Settings: settings, Chapters: []DramaChapterInput{
		{Title: "第一章 雨夜", Text: "她在老路口等他，伞沿滴水。"},
	}})
	if err != nil {
		t.Fatalf("create drama: %v", err)
	}
	project := summary.Project.ID
	runDramaTicks(t, svc, project, 40)
	// 分集由管线 tick 创建，CreateDrama 返回时还没有——先取最新 summary。
	summary, err = svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if len(summary.Episodes) == 0 {
		t.Fatal("管线未创建分集")
	}
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, summary.Episodes[0].ID)
	if err != nil {
		t.Fatalf("episode detail: %v", err)
	}
	if len(detail.Segments) == 0 {
		t.Fatal("管线未产出剧情段")
	}

	// 2) 等到至少一段提示词就绪。
	ready := false
	for _, seg := range detail.Segments {
		if seg.PromptStatus == "ready" && strings.TrimSpace(seg.VideoPrompt) != "" {
			ready = true
		}
	}
	if !ready {
		t.Fatal("段提示词未就绪，无法精修")
	}

	// 3) 超哥导演精修 & 门禁自检。
	var target int
	for _, seg := range detail.Segments {
		if seg.PromptStatus == "ready" && strings.TrimSpace(seg.VideoPrompt) != "" {
			target = seg.Index
			break
		}
	}
	result, err := svc.RefineDramaSegmentPrompt("usr-drama", project, summary.Episodes[0].ID, target)
	if err != nil {
		t.Fatalf("refine: %v", err)
	}
	t.Logf("精修完成：charCount=%d ok=%v notes=%v", result.Gate.CharCount, result.Gate.OK, result.Notes)
	for _, section := range []string{"【风格锁定】", "【场景与空间锚点】", "【声音与音乐总则】", "【镜头序列】", "【全局补充】"} {
		if !strings.Contains(result.Prompt, section) {
			t.Fatalf("精修稿缺少契约段 %s", section)
		}
	}
	if !result.Gate.OK {
		t.Fatalf("门禁未通过：%v", result.Gate.Errors)
	}
	if !strings.Contains(result.Prompt, "真人影视风") {
		t.Fatal("所选超哥画风未带入精修稿")
	}
}
