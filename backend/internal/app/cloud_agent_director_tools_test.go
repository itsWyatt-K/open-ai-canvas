package app

// Agent 导演校验工具测试：
//  1. 工具声明（默认模式与只读模式均下发——纯内存校验器不写库、不扣费）；
//  2. director_validate_prompt 真实执行（正/反/非法枚举）；
//  3. director_validate_ledger 真实执行（内置模板通过、缺前置区拒绝）。

import (
	"encoding/json"
	"io/fs"
	"strings"
	"testing"

	builtinAssets "yingce/backend/builtin"
)

// directorValidPrompt 是通过全部门禁的最小合法即梦提示词（new + mapped + 干声）。
const directorValidPrompt = `【本批上传ID映射】
| 提示词槽位 | 用户应上传的资产 | 当前准备状态 | 唯一职责 |
|---|---|---|---|
| 图1 | 客厅场景图 | 用户已有 | 锁定空间 |
| 音频1 | 艾玛干声 | 待用户准备 | 锁定音色 |

【风格锁定】
自然主义雪夜惊悚片，使用ARRI Alexa 35与Cooke电影镜头，21:9，24fps；冷暗低饱和，雪反冷光，真实木材与皮肤质感。
【素材映射】
@用于锁定客厅，绑定后简称“图1”。
@为艾玛声音，绑定后简称“音频1”。
【场景与空间锚点】
午夜客厅内，艾玛站在图1门边；门在画面右侧，走廊在画面左侧。
【声音与音乐总则】
使用音频1，无BGM。
【镜头序列】
镜头1（0.0—2.0秒｜近景）
机位与构图：头肩近景，摄影机位于艾玛正前方；焦点落在艾玛双眼，背景轻微虚化。
运镜：固定机位。
画面内容：艾玛转头。艾玛（音频1，呼吸急促、低声而坚决）：“快走。”
镜头2（2.0—4.0秒｜中景）
机位与构图：腰部中景，摄影机位于艾玛侧面；焦点落在艾玛面部，背景走廊轻微虚化。
运镜：侧向跟拍。
画面内容：艾玛跑开。
【全局补充】
无字幕。`

// 默认模式：两个导演校验工具都下发。
func TestAgentDirectorToolsDeclared(t *testing.T) {
	names := toolNames(compileCloudAgentTools(CloudAgentRequest{PermissionMode: "auto"}, true))
	if !containsName(names, "director_validate_prompt") || !containsName(names, "director_validate_ledger") {
		t.Fatalf("导演校验工具未完整下发：%v", names)
	}
}

// 只读模式：两个纯内存校验器仍然下发（只读会话同样需要交付前自检）。
func TestAgentDirectorToolsAvailableInReadOnly(t *testing.T) {
	names := toolNames(compileCloudAgentTools(CloudAgentRequest{PermissionMode: "read_only"}, true))
	if !containsName(names, "director_validate_prompt") || !containsName(names, "director_validate_ledger") {
		t.Fatalf("只读模式下导演校验工具必须仍可用：%v", names)
	}
	for _, name := range []string{"director_validate_prompt", "director_validate_ledger"} {
		if !cloudAgentReadToolReadOnly(name) {
			t.Fatalf("%s 必须登记为只读工具", name)
		}
	}
}

// 合法提示词：ok=true，并返回字符计数。
func TestAgentDirectorValidatePromptAcceptsValidPrompt(t *testing.T) {
	args, _ := json.Marshal(map[string]string{"text": directorValidPrompt, "platform": "jimeng", "mode": "new"})
	result, err := cloudAgentDirectorValidatePrompt(nil, "user", newEcommerceToolCall("director_validate_prompt", string(args)))
	if err != nil {
		t.Fatalf("director_validate_prompt 执行失败：%v", err)
	}
	payload, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("unexpected result type %T", result)
	}
	if payload["ok"] != true {
		t.Fatalf("合法提示词应通过，errors = %v", payload["errors"])
	}
	if count, _ := payload["charCount"].(int); count <= 0 {
		t.Fatalf("charCount 应大于 0，实际 %v", payload["charCount"])
	}
}

// 非法素材写法：@图片1 必须被裸@纪律拦下。
func TestAgentDirectorValidatePromptRejectsBadAlias(t *testing.T) {
	bad := strings.Replace(directorValidPrompt, "@用于锁定客厅，绑定后简称“图1”。", "@图片1用于锁定客厅。", 1)
	args, _ := json.Marshal(map[string]string{"text": bad, "platform": "jimeng", "mode": "new"})
	result, err := cloudAgentDirectorValidatePrompt(nil, "user", newEcommerceToolCall("director_validate_prompt", string(args)))
	if err != nil {
		t.Fatalf("director_validate_prompt 执行失败：%v", err)
	}
	payload := result.(map[string]any)
	if payload["ok"] != false {
		t.Fatal("@图片1 写法应被判失败")
	}
	errors, _ := payload["errors"].([]string)
	if !containsSubstring(errors, "裸@") {
		t.Fatalf("应给出裸@纪律错误，实际 %v", errors)
	}
}

// 非法枚举：platform 不在 jimeng/libtv 时必须明确报错，不静默取默认。
func TestAgentDirectorValidatePromptRejectsInvalidPlatform(t *testing.T) {
	args, _ := json.Marshal(map[string]string{"text": directorValidPrompt, "platform": "kling"})
	result, err := cloudAgentDirectorValidatePrompt(nil, "user", newEcommerceToolCall("director_validate_prompt", string(args)))
	if err != nil {
		t.Fatalf("director_validate_prompt 执行失败：%v", err)
	}
	payload := result.(map[string]any)
	errors, _ := payload["errors"].([]string)
	if !containsSubstring(errors, "platform") {
		t.Fatalf("应报告 platform 无效，实际 %v", errors)
	}
}

// 合法台账模板：ok=true，并回显 recordType/stage/route。
func TestAgentDirectorValidateLedgerAcceptsTemplate(t *testing.T) {
	data, err := fs.ReadFile(builtinAssets.FS, "chaoge-film-director-flex/assets/project-ledger-template.md")
	if err != nil {
		t.Fatal(err)
	}
	args, _ := json.Marshal(map[string]string{"text": string(data)})
	result, err := cloudAgentDirectorValidateLedger(nil, "user", newEcommerceToolCall("director_validate_ledger", string(args)))
	if err != nil {
		t.Fatalf("director_validate_ledger 执行失败：%v", err)
	}
	payload := result.(map[string]any)
	if payload["ok"] != true {
		t.Fatalf("内置台账模板应通过，errors = %v", payload["errors"])
	}
	if payload["recordType"] != "full_ledger" {
		t.Fatalf("recordType 回显错误：%v", payload["recordType"])
	}
	if payload["stage"] == "" || payload["route"] == "" {
		t.Fatalf("stage/route 回显缺失：%v / %v", payload["stage"], payload["route"])
	}
}

// 缺前置区：必须明确拒绝。
func TestAgentDirectorValidateLedgerRejectsMissingFrontmatter(t *testing.T) {
	args, _ := json.Marshal(map[string]string{"text": "# 没有前置区的台账\n\n## 当前摘要\n内容"})
	result, err := cloudAgentDirectorValidateLedger(nil, "user", newEcommerceToolCall("director_validate_ledger", string(args)))
	if err != nil {
		t.Fatalf("director_validate_ledger 执行失败：%v", err)
	}
	payload := result.(map[string]any)
	if payload["ok"] != false {
		t.Fatal("缺少 YAML 前置区应被判失败")
	}
	errors, _ := payload["errors"].([]string)
	if !containsSubstring(errors, "前置区") {
		t.Fatalf("应报告缺少前置区，实际 %v", errors)
	}
}

// 完整工具链分发：经 cloudAgentReadTool 默认路径调用也必须可执行
// （read_only 模式下工具在只读白名单内，走同一条分发）。
func TestAgentDirectorToolsDispatchThroughReadTool(t *testing.T) {
	state := &cloudAgentRuntime{}
	args, _ := json.Marshal(map[string]string{"text": directorValidPrompt})
	call := newEcommerceToolCall("director_validate_prompt", string(args))
	if _, err := cloudAgentReadTool(nil, "user", state, call); err != nil {
		t.Fatalf("director_validate_prompt 经只读分发失败：%v", err)
	}
	ledgerArgs, _ := json.Marshal(map[string]string{"text": "# 缺前置区"})
	ledgerCall := newEcommerceToolCall("director_validate_ledger", string(ledgerArgs))
	if _, err := cloudAgentReadTool(nil, "user", state, ledgerCall); err != nil {
		t.Fatalf("director_validate_ledger 经只读分发失败：%v", err)
	}
}

// containsSubstring 判断 errors/warnings 列表里是否存在含 want 的条目。
func containsSubstring(items []string, want string) bool {
	for _, item := range items {
		if strings.Contains(item, want) {
			return true
		}
	}
	return false
}
