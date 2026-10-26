package director

import (
	"io/fs"
	"regexp"
	"sort"
	"strings"

	builtinAssets "yingce/backend/builtin"
)

// LedgerValidateResult 对齐 validate_ledger.py 的 {"ok","errors","warnings"}，
// 并附带工具契约要求的记录类型、阶段与路线回显。
type LedgerValidateResult struct {
	OK         bool     `json:"ok"`
	RecordType string   `json:"recordType"`
	Stage      string   `json:"stage"`
	Route      string   `json:"route"`
	Errors     []string `json:"errors"`
	Warnings   []string `json:"warnings"`
}

// 对齐 Python REQUIRED_FRONTMATTER（集合语义；差集按 code point 排序输出）。
var requiredLedgerFrontmatter = []string{
	"record_schema", "record_type", "skill_version", "project_title", "script_version",
	"current_stage", "platform", "model_version", "production_route", "batch_material_mode", "voice_mode",
}

// v3.24.0 合流（2026-10-26）：栏目表对齐上游新模板（record_schema 1.4）。
var fullLedgerSections = []string{
	"当前摘要", "创作基准", "角色资产与人物信息版", "道具与场景资产", "独立预演进度", "场景彩图制作进度",
	"声音准备", "当前场景故事节点", "当前AI导演分析", "决策与采用记录", "执行状态",
}

var lightStateSections = []string{
	"当前摘要", "创作基准", "B路线提示词进度", "独立预演进度", "场景彩图制作进度",
	"声音准备", "当前场景故事节点", "当前AI导演分析", "决策与采用记录", "执行状态",
}

var validLedgerStages = map[string]struct{}{
	"P0": {}, "P0R": {}, "P0S": {}, "P0A": {}, "P1": {}, "P2": {}, "P2S": {}, "P2V": {},
	"P3A": {}, "P3B": {}, "P3": {}, "P4": {}, "P5": {}, "P6": {}, "P7": {}, "COMPLETE": {},
}

var validLedgerRecordTypes = map[string]struct{}{"full_ledger": {}, "light_state": {}}
var validLedgerRoutes = map[string]struct{}{"待确认": {}, "A_full": {}, "B_prompt_only": {}, "C_direct_video": {}}
var validLedgerMaterialModes = map[string]struct{}{"待确认": {}, "mapped": {}, "text": {}, "hybrid": {}}
var validLedgerVoiceModes = map[string]struct{}{"待确认": {}, "reference_or_generated": {}, "mapped_dry_voice": {}, "model_voice": {}, "post_dub": {}}

const expectedLedgerRecordSchema = "1.4" // v3.24.0 合流：上游新记录结构

var (
	ledgerFrontmatterRE = regexp.MustCompile(`\A---` + ws + `*\n(?s:(.*?))\n---` + ws + `*\n`)
	ledgerAssetIDRE     = regexp.MustCompile(`\b(?:CHR|SCN|PRP|DYN|CNT|AUD|VID)-[A-Za-z0-9_\-\x{4e00}-\x{9fff}]+`)
	ledgerStatusRE      = regexp.MustCompile(`\|` + ws + `*(待生成|候选|待修改|已确认|已采用|弃用|待输出|待确认|需修改)` + ws + `*\|`)
	ledgerSnapshotRE    = regexp.MustCompile(`## 当前连续性快照[\s\S]+人物位置与朝向：\S+`)
)

// ledgerSectionREs 预编译全部必选栏目的行级匹配（对齐 Python re.MULTILINE 语义）。
var ledgerSectionREs = func() map[string]*regexp.Regexp {
	compiled := map[string]*regexp.Regexp{}
	for _, section := range append(append([]string{}, fullLedgerSections...), lightStateSections...) {
		if _, exists := compiled[section]; exists {
			continue
		}
		// v3.24.0 合流：标题允许括注后缀，前缀命中即算存在。
		compiled[section] = regexp.MustCompile(`(?m)^##` + ws + `+` + regexp.QuoteMeta(section))
	}
	return compiled
}()

// expectedSkillVersion 对齐 Python 侧从 VERSION 文件读取期望版本：
// 优先读嵌入的内置技能包，读不到时退回编译期常量。
func expectedSkillVersion() string {
	if data, err := fs.ReadFile(builtinAssets.FS, "chaoge-film-director-flex/VERSION"); err == nil {
		if version := strings.TrimSpace(string(data)); version != "" {
			return version
		}
	}
	return "2.0.0"
}

// ValidateProjectLedger 是 validate_ledger.py::validate 的 Go 等价物。
func ValidateProjectLedger(text string) LedgerValidateResult {
	result := LedgerValidateResult{Errors: []string{}, Warnings: []string{}}
	errors := &result.Errors
	warnings := &result.Warnings

	fields := parseLedgerFrontmatter(text)
	if len(fields) == 0 {
		result.Errors = append(result.Errors, "缺少有效YAML前置区")
		result.OK = false
		return result
	}

	fieldSet := make(map[string]struct{}, len(fields))
	for key := range fields {
		fieldSet[key] = struct{}{}
	}
	var missing []string
	for _, key := range requiredLedgerFrontmatter {
		if _, ok := fieldSet[key]; !ok {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		*errors = append(*errors, "缺少前置字段："+strings.Join(missing, "、"))
	}

	if fields["record_schema"] != expectedLedgerRecordSchema {
		*warnings = append(*warnings, "记录结构版本为"+ledgerFieldOrEmpty(fields, "record_schema")+"，当前Skill期望"+expectedLedgerRecordSchema)
	}
	expectedVersion := expectedSkillVersion()
	if fields["skill_version"] != expectedVersion {
		*warnings = append(*warnings, "记录Skill版本"+ledgerFieldOrEmpty(fields, "skill_version")+"，当前为"+expectedVersion)
	}
	if _, ok := validLedgerStages[fields["current_stage"]]; !ok {
		*errors = append(*errors, "current_stage不是有效阶段："+ledgerFieldOrEmpty(fields, "current_stage"))
	}

	enumChecks := []struct {
		field   string
		allowed map[string]struct{}
	}{
		{"record_type", validLedgerRecordTypes},
		{"production_route", validLedgerRoutes},
		{"batch_material_mode", validLedgerMaterialModes},
		{"voice_mode", validLedgerVoiceModes},
	}
	for _, check := range enumChecks {
		value, present := fields[check.field]
		if !present {
			continue
		}
		if _, ok := check.allowed[value]; !ok {
			*errors = append(*errors, check.field+"不是有效值："+value)
		}
	}

	recordType := fields["record_type"]
	route := fields["production_route"]
	if recordType == "full_ledger" && route != "A_full" && route != "待确认" {
		*errors = append(*errors, "完整资产台账只能用于A_full路线")
	}
	if recordType == "light_state" && route == "A_full" {
		*errors = append(*errors, "A_full路线必须使用完整资产台账")
	}

	requiredSections := fullLedgerSections
	if recordType != "full_ledger" {
		requiredSections = lightStateSections
	}
	for _, section := range requiredSections {
		if !matchLedgerSection(text, section) {
			*errors = append(*errors, "缺少栏目：## "+section)
		}
	}

	if recordType == "light_state" {
		forbidden := []string{"本地路径", "文件哈希", "目录扫描", "已验证文件"}
		var found []string
		for _, token := range forbidden {
			if strings.Contains(text, token) {
				found = append(found, token)
			}
		}
		if len(found) > 0 {
			*errors = append(*errors, "轻量制作状态不得包含本地核验字段："+strings.Join(found, "、"))
		}
	}

	ids := ledgerAssetIDRE.FindAllString(text, -1)
	idCounts := map[string]int{}
	for _, id := range ids {
		idCounts[id]++
	}
	var duplicateIDs []string
	for id, count := range idCounts {
		if count > 1 {
			duplicateIDs = append(duplicateIDs, id)
		}
	}
	if len(duplicateIDs) > 0 {
		sort.Strings(duplicateIDs)
		*warnings = append(*warnings, "稳定ID重复出现，请确认是引用而非重复登记："+strings.Join(duplicateIDs, "、"))
	}

	validStatuses := map[string]struct{}{
		"待生成": {}, "候选": {}, "待修改": {}, "已确认": {}, "已采用": {}, "弃用": {},
		"待输出": {}, "待确认": {}, "需修改": {},
	}
	for _, status := range ledgerStatusRE.FindAllStringSubmatch(text, -1) {
		if _, ok := validStatuses[status[1]]; !ok {
			*errors = append(*errors, "无效状态："+status[1])
		}
	}

	if strings.Contains(text, "已采用") && recordType == "full_ledger" && !ledgerSnapshotRE.MatchString(text) {
		*warnings = append(*warnings, "已有采用视频，但连续性快照可能尚未填写")
	}

	result.RecordType = recordType
	result.Stage = fields["current_stage"]
	result.Route = route
	result.OK = len(result.Errors) == 0
	return result
}

// parseLedgerFrontmatter 对齐 Python parse_frontmatter。
func parseLedgerFrontmatter(text string) map[string]string {
	match := ledgerFrontmatterRE.FindStringSubmatch(text)
	if match == nil {
		return nil
	}
	fields := map[string]string{}
	for _, line := range strings.Split(match[1], "\n") {
		if !strings.Contains(line, ":") {
			continue
		}
		key, value, _ := strings.Cut(line, ":")
		fields[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(value), "\"'")
	}
	return fields
}

// matchLedgerSection 对齐 Python re.search(rf"^##\s+{section}\s*$", text, re.MULTILINE)。
func matchLedgerSection(text, section string) bool {
	re, ok := ledgerSectionREs[section]
	if !ok {
		// v3.24.0 合流：标题允许括注后缀（如「独立预演进度（A/B/C按请求启用，未调用留空）」），
		// 前缀命中即算存在（上游 Python 新版已不检查栏目，Go 侧保留检查但放宽匹配）。
		re = regexp.MustCompile(`(?m)^##` + ws + `+` + regexp.QuoteMeta(section))
	}
	return re.MatchString(text)
}

// ledgerFieldOrEmpty 对齐 Python fields.get(key, "空")。
func ledgerFieldOrEmpty(fields map[string]string, key string) string {
	if value, ok := fields[key]; ok {
		return value
	}
	return "空"
}
