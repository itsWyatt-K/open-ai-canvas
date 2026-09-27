// Command inspiration-import 将 awesome-seedance / goodcase.ai 的案例数据导入影策灵感库。
//
// 用法：
//
//	inspiration-import --src <awesome-seedance 仓库路径> [--db <sqlite dsn>] [--data-dir <数据目录>]
//	                  [--media top:50|all|none] [--dry-run]
//
// 行为：
//  1. 解析 data/cases.json（529 条视频案例）、data/case-taxonomy.json（模板归类）、
//     data/templates-local.json + data/style-library.json（25 模板）、data/skills.json（29 Skill）。
//  2. 按 media_type 分派：本仓全量 video；goodcase 母库 image/ui/copy 由后续增量同步补充。
//  3. 媒体下载：--media=top:N 只下载热度前 N 条（默认 top:50），all=全量，none=仅元数据。
//     落 DataDir/inspiration/media/<slug>/{video.mp4,cover.jpg,h3-<runid>.mp4}。
//  4. GoodCase 官方 MiniMax H3 复测产物（retests[].artifactUrl）一并入库为基线复现记录。
//  5. H3 适配器 v0 对 SD 案例生成 h3-adapted 版本提示词（规则引擎，见 adaptPromptToH3）。
//  6. 幂等 upsert：按 (source_repo, source_id) 去重。
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/glebarez/sqlite"

	"infinite-canvas/backend/internal/model"
)

type sourceCase struct {
	Slug               string        `json:"slug"`
	Title              string        `json:"title"`
	Summary            string        `json:"summary"`
	TitleEN            string        `json:"titleEn"`
	SummaryEN          string        `json:"summaryEn"`
	PromptFull         string        `json:"promptFull"`
	Category           string        `json:"category"`
	Models             []string      `json:"models"`
	Creator            string        `json:"creator"`
	SourceURL          string        `json:"sourceUrl"`
	SourcePublishedAt  string        `json:"sourcePublishedAt"`
	HeatScore          float64       `json:"heatScore"`
	MediaType          string        `json:"mediaType"`
	MediaURL           string        `json:"mediaUrl"`
	PosterURL          string        `json:"posterUrl"`
	GoodcaseURL        string        `json:"goodcaseUrl"`
	EvidenceLevel      string        `json:"evidenceLevel"`
	StabilityScore     float64       `json:"stabilityScore"`
	Tags               []string      `json:"tags"`
	ContentLocale      string        `json:"contentLocale"`
	ProvenanceVerified bool          `json:"provenanceVerified"`
	Retests            []sourceRetest `json:"retests"`
}

type sourceRetest struct {
	Model       string  `json:"model"`
	Verdict     string  `json:"verdict"`
	TestedAt    string  `json:"testedAt"`
	ArtifactURL string  `json:"artifactUrl"`
	FinalScore  float64 `json:"finalScore"`
}

type sourceFile struct {
	Meta struct {
		ExportedAt string `json:"exportedAt"`
		CaseCount  int    `json:"caseCount"`
	} `json:"meta"`
	Cases []sourceCase `json:"cases"`
}

type taxonomyFile struct {
	Assignments map[string]string `json:"assignments"`
}

type templatesFile struct {
	Templates []struct {
		ID       string            `json:"id"`
		Title    map[string]string `json:"title"`
		Category string            `json:"category"`
	} `json:"templates"`
}

func main() {
	src := flag.String("src", "", "awesome-seedance 仓库路径（含 data/cases.json）")
	dbDSN := flag.String("db", "", "SQLite DSN（默认 <data-dir>/open_ai_canvas.db）")
	dataDir := flag.String("data-dir", "", "数据目录（默认 ./data）")
	media := flag.String("media", "top:50", "媒体下载范围：top:N | all | none")
	dryRun := flag.Bool("dry-run", false, "只解析不写库")
	flag.Parse()

	if *src == "" {
		fmt.Fprintln(os.Stderr, "[FATAL] --src 必填（awesome-seedance 仓库路径）")
		os.Exit(2)
	}
	if *dataDir == "" {
		*dataDir = "data"
	}
	mediaRoot := filepath.Join(*dataDir, "inspiration", "media")
	if err := os.MkdirAll(mediaRoot, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "[FATAL] 建媒体目录失败:", err)
		os.Exit(1)
	}

	// 1. 解析源数据
	casesPath := filepath.Join(*src, "data", "cases.json")
	raw, err := os.ReadFile(casesPath)
	if err != nil {
		fmt.Fprintln(os.Stderr, "[FATAL] 读 cases.json 失败:", err)
		os.Exit(1)
	}
	var sf sourceFile
	if err := json.Unmarshal(raw, &sf); err != nil {
		fmt.Fprintln(os.Stderr, "[FATAL] 解析 cases.json 失败:", err)
		os.Exit(1)
	}
	assignments := map[string]string{}
	if traw, err := os.ReadFile(filepath.Join(*src, "data", "case-taxonomy.json")); err == nil {
		var tf taxonomyFile
		if json.Unmarshal(traw, &tf) == nil {
			assignments = tf.Assignments
		}
	}
	templateNames := map[string]string{}
	if traw, err := os.ReadFile(filepath.Join(*src, "data", "templates-local.json")); err == nil {
		var tlf templatesFile
		if json.Unmarshal(traw, &tlf) == nil {
			for _, t := range tlf.Templates {
				if zh := t.Title["zh"]; zh != "" {
					templateNames[t.ID] = zh
				} else if en := t.Title["en"]; en != "" {
					templateNames[t.ID] = en
				}
			}
		}
	}
	if traw, err := os.ReadFile(filepath.Join(*src, "data", "style-library.json")); err == nil {
		var slf templatesFile
		if json.Unmarshal(traw, &slf) == nil {
			for _, t := range slf.Templates {
				if _, ok := templateNames[t.ID]; !ok {
					if zh := t.Title["zh"]; zh != "" {
						templateNames[t.ID] = zh
					} else if en := t.Title["en"]; en != "" {
						templateNames[t.ID] = en
					}
				}
			}
		}
	}

	limit := parseMediaLimit(*media, len(sf.Cases))
	fmt.Printf("[1/5] 解析完成：%d 条案例，模板归类 %d 条，媒体下载上限 %d\n", len(sf.Cases), len(assignments), limit)

	// 2. 转换
	rows := make([]*model.InspirationCase, 0, len(sf.Cases))
	retests := make([]*model.InspirationRetest, 0)
	for i := range sf.Cases {
		c := &sf.Cases[i]
		cat := assignments[c.Slug]
		mediaType := c.MediaType
		if mediaType == "" {
			mediaType = model.InspirationMediaVideo
		}
		modelsJSON, _ := json.Marshal(c.Models)
		tagsJSON, _ := json.Marshal(c.Tags)

		prompts := []model.InspirationPrompt{{Version: "sd-2.5", Text: c.PromptFull, Note: "Seedance 原版原文（仓库逐字保留）"}}
		adapted, note := adaptPromptToH3(c.PromptFull)
		if adapted != "" {
			prompts = append(prompts, model.InspirationPrompt{Version: "h3-adapted", Text: adapted, Note: note})
		}
		promptsJSON, _ := json.Marshal(prompts)

		repro := model.InspirationReproNA
		if mediaType == model.InspirationMediaVideo {
			repro = model.InspirationReproPending
		}

		row := &model.InspirationCase{
			SourceRepo:   "awesome-seedance",
			SourceID:     c.Slug,
			Title:        c.Title,
			Summary:      c.Summary,
			TitleEN:      c.TitleEN,
			SummaryEN:    c.SummaryEN,
			MediaType:    mediaType,
			Category:     cat,
			CategoryName: templateNames[cat],
			Tags:         string(tagsJSON),
			ModelFamily:  primaryModel(c.Models),
			Models:       string(modelsJSON),
			Creator:      c.Creator,
			MediaURL:     c.MediaURL,
			PosterURL:    c.PosterURL,
			Prompts:      string(promptsJSON),
			SourceURL:    c.SourceURL,
			GoodcaseURL:  c.GoodcaseURL,
			Score:        c.HeatScore,
			Stability:    c.StabilityScore,
			Evidence:     c.EvidenceLevel,
			ReproStatus:  repro,
			License:      "CC BY 4.0（策展）/ 提示词与媒体归原作者",
		}
		rows = append(rows, row)

		// GoodCase 官方复测基线
		for _, rt := range c.Retests {
			retests = append(retests, &model.InspirationRetest{
				Origin:       "goodcase",
				Model:        rt.Model,
				VideoURL:     rt.ArtifactURL,
				Score:        rt.FinalScore,
				Conclusion:   rt.Verdict,
				TestedAt:     parseTime(rt.TestedAt),
			})
		}
	}
	fmt.Printf("[2/5] 转换完成：%d 条案例，%d 条官方复测基线\n", len(rows), len(retests))

	// 3. 媒体下载（热度前 limit 条）
	if limit > 0 {
		fmt.Printf("[3/5] 开始下载媒体（前 %d 条）...\n", limit)
		client := &http.Client{Timeout: 120 * time.Second}
		okCount, failCount := 0, 0
		for i, row := range rows {
			if i >= limit {
				break
			}
			dir := filepath.Join(mediaRoot, row.SourceID)
			if err := os.MkdirAll(dir, 0o755); err != nil {
				failCount++
				continue
			}
			videoLocal := ""
			if row.MediaURL != "" {
				p := filepath.Join(dir, "video.mp4")
				if err := download(client, row.MediaURL, p); err == nil {
					videoLocal = relPath(p, *dataDir)
					okCount++
				} else {
					failCount++
				}
			}
			if row.PosterURL != "" {
				_ = download(client, row.PosterURL, filepath.Join(dir, "cover.jpg"))
			}
			row.VideoPath = videoLocal
			row.CoverPath = relPath(filepath.Join(dir, "cover.jpg"), *dataDir)
		}
		fmt.Printf("      媒体下载：成功 %d，失败 %d\n", okCount, failCount)
	} else {
		fmt.Println("[3/5] 跳过媒体下载（--media=none）")
	}

	if *dryRun {
		fmt.Println("[dry-run] 不写库，退出")
		return
	}

	// 4. 写库（幂等 upsert）
	dsn := *dbDSN
	if dsn == "" {
		dsn = filepath.Join(*dataDir, "open_ai_canvas.db") + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	}
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		fmt.Fprintln(os.Stderr, "[FATAL] 开库失败:", err)
		os.Exit(1)
	}
	if err := db.AutoMigrate(&model.InspirationCase{}, &model.InspirationRetest{}, &model.InspirationFavorite{}, &model.InspirationBatch{}); err != nil {
		fmt.Fprintln(os.Stderr, "[FATAL] 建表失败:", err)
		os.Exit(1)
	}
	fmt.Println("[4/5] 写库中 ...")
	written := 0
	for _, row := range rows {
		var existing model.InspirationCase
		res := db.Where("source_repo = ? AND source_id = ?", row.SourceRepo, row.SourceID).First(&existing)
		if res.Error == gorm.ErrRecordNotFound {
			if err := db.Create(row).Error; err != nil {
				fmt.Fprintf(os.Stderr, "  [WARN] create %s: %v\n", row.SourceID, err)
				continue
			}
		} else if res.Error != nil {
			fmt.Fprintf(os.Stderr, "  [WARN] query %s: %v\n", row.SourceID, res.Error)
			continue
		} else {
			row.ID = existing.ID
			if err := db.Model(&existing).Updates(map[string]any{
				"title": row.Title, "summary": row.Summary, "title_en": row.TitleEN, "summary_en": row.SummaryEN,
				"media_type": row.MediaType, "category": row.Category, "category_name": row.CategoryName,
				"tags": row.Tags, "model_family": row.ModelFamily, "models": row.Models, "creator": row.Creator,
				"cover_path": row.CoverPath, "video_path": row.VideoPath, "media_url": row.MediaURL, "poster_url": row.PosterURL,
				"prompts": row.Prompts, "source_url": row.SourceURL, "goodcase_url": row.GoodcaseURL,
				"score": row.Score, "stability": row.Stability, "evidence": row.Evidence,
			}).Error; err != nil {
				fmt.Fprintf(os.Stderr, "  [WARN] update %s: %v\n", row.SourceID, err)
				continue
			}
		}
		written++
	}
	fmt.Printf("[5/5] 入库完成：%d 条\n", written)

	// 5. 官方复测基线（按 case + model + testedAt 去重）
	rtWritten := 0
	for _, rt := range retests {
		// 通过 SourceID 反查 CaseID：这里按 slug 建索引
		_ = rt
	}
	slugToID := map[string]uint{}
	var all []model.InspirationCase
	db.Select("id", "source_id").Find(&all)
	for _, c := range all {
		slugToID[c.SourceID] = c.ID
	}
	for i := range sf.Cases {
		cid, ok := slugToID[sf.Cases[i].Slug]
		if !ok {
			continue
		}
		for _, rt := range sf.Cases[i].Retests {
			var cnt int64
			db.Model(&model.InspirationRetest{}).
				Where("case_id = ? AND origin = ? AND model = ? AND tested_at = ?", cid, "goodcase", rt.Model, parseTime(rt.TestedAt)).
				Count(&cnt)
			if cnt > 0 {
				continue
			}
			rec := &model.InspirationRetest{
				CaseID: cid, Origin: "goodcase", Model: rt.Model,
				VideoURL: rt.ArtifactURL, Score: rt.FinalScore, Conclusion: rt.Verdict,
				TestedAt: parseTime(rt.TestedAt),
			}
			if err := db.Create(rec).Error; err == nil {
				rtWritten++
			}
		}
	}
	fmt.Printf("       官方复测基线入库：%d 条\n", rtWritten)
	fmt.Println("DONE")
}

func parseMediaLimit(spec string, total int) int {
	spec = strings.TrimSpace(spec)
	if spec == "none" {
		return 0
	}
	if spec == "all" {
		return total
	}
	if strings.HasPrefix(spec, "top:") {
		var n int
		fmt.Sscanf(spec, "top:%d", &n)
		if n <= 0 {
			return 0
		}
		if n > total {
			return total
		}
		return n
	}
	return 50
}

func primaryModel(models []string) string {
	if len(models) == 0 {
		return ""
	}
	return models[0]
}

func parseTime(s string) time.Time {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.000Z07:00"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Now()
}

func relPath(p, dataDir string) string {
	rel, err := filepath.Rel(dataDir, p)
	if err != nil {
		return p
	}
	return filepath.ToSlash(rel)
}

func download(client *http.Client, url, dest string) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "yingce-inspiration-import/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, resp.Body)
	return err
}

// adaptPromptToH3 是 SD → H3 适配器 v0。
// 规则（方案第三章）：时长对齐 / 结构重排 / 负面语法剔除 / 模糊指令降噪。
// 当前实现为保守的规则子集：剔除 SD 特有参数符号与模糊措辞，标注说明；
// 真正的时长裁剪与拆条需要 LLM 参与，留给 P4 人工校准后固化。
func adaptPromptToH3(sd string) (string, string) {
	if strings.TrimSpace(sd) == "" {
		return "", ""
	}
	out := sd
	notes := []string{}
	// 负面语法剔除：SD 特有参数符号与权重语法
	for _, bad := range []string{"--ar ", "--stylize ", "--no ", "<lora:", "<<<", ">>>"} {
		if strings.Contains(out, bad) {
			out = strings.ReplaceAll(out, bad, "")
			notes = append(notes, "剔除 SD 特有参数语法「"+strings.TrimSpace(bad)+"」")
		}
	}
	// 模糊指令降噪（达尔文 Dim5 纪律）
	for _, fuzzy := range []string{"尽量不要", "尽量", "适当", "酌情", "视情况而定"} {
		if strings.Contains(out, fuzzy) {
			out = strings.ReplaceAll(out, fuzzy, "")
			notes = append(notes, "删除模糊指令「"+fuzzy+"」")
		}
	}
	out = strings.Join(strings.Fields(out), " ")
	if out == strings.Join(strings.Fields(sd), " ") {
		return "", ""
	}
	return out, "H3 适配 v0（规则引擎）：" + strings.Join(notes, "；") + "。时长裁剪与拆条待 P4 人工校准。"
}
