package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestEffectiveImagePromptAppendsNegativeConstraints(t *testing.T) {
	input := canvasGenerationInput{
		Prompt:         "一只绿色石头质感的产品静物图",
		NegativePrompt: "低画质, 模糊, 露骨暗示",
	}
	got := effectiveImagePrompt(input)
	if !strings.Contains(got, "一只绿色石头质感的产品静物图") {
		t.Fatalf("正向提示词丢失：%q", got)
	}
	if !strings.Contains(got, negativeConstraintHeader) || !strings.Contains(got, "低画质, 模糊, 露骨暗示") {
		t.Fatalf("负向禁令段未追加：%q", got)
	}
	if !strings.HasSuffix(got, negativeConstraintSuffix) {
		t.Fatalf("禁令段未收尾：%q", got)
	}
	// 负向词必须位于正文之后，避免覆盖正向描述。
	if strings.Index(got, "一只绿色石头质感的产品静物图") > strings.Index(got, negativeConstraintHeader) {
		t.Fatalf("负向段先于正文出现：%q", got)
	}
}

func TestEffectiveImagePromptNoNegative(t *testing.T) {
	input := canvasGenerationInput{Prompt: "纯正文", Config: providerConfig{SystemPrompt: "系统指令"}}
	got := effectiveImagePrompt(input)
	want := "系统指令\n\n纯正文"
	if got != want {
		t.Fatalf("无负向词时应与 withSystemPrompt 一致：got %q want %q", got, want)
	}
}

func TestEffectiveImagePromptBlankNegativeIgnored(t *testing.T) {
	input := canvasGenerationInput{Prompt: "正文", NegativePrompt: "   "}
	if got := effectiveImagePrompt(input); got != "正文" {
		t.Fatalf("空白负向词不应产生禁令段：%q", got)
	}
}

func TestApplyProtocolNegativePromptInjectsBothChannels(t *testing.T) {
	request := &protocol.GenerationRequest{Extra: map[string]any{}, ProviderOptions: map[string]map[string]any{}}
	applyProtocolNegativePrompt(request, "dashscope-qwen-image", "文字, 水印")
	if request.Extra["negative_prompt"] != "文字, 水印" || request.Extra["negativePrompt"] != "文字, 水印" {
		t.Fatalf("Extra 双路注入失败：%#v", request.Extra)
	}
	options := request.ProviderOptions["dashscope-qwen-image"]
	if options["negative_prompt"] != "文字, 水印" {
		t.Fatalf("providerOptions 注入失败：%#v", options)
	}
}

func TestApplyProtocolNegativePromptKeepsExistingOption(t *testing.T) {
	request := &protocol.GenerationRequest{
		Extra:           map[string]any{},
		ProviderOptions: map[string]map[string]any{"stability-image": {"negative_prompt": "管理员已配置"}},
	}
	applyProtocolNegativePrompt(request, "stability-image", "任务负向词")
	if got := request.ProviderOptions["stability-image"]["negative_prompt"]; got != "管理员已配置" {
		t.Fatalf("不应覆盖管理员已配置的负向词：%q", got)
	}
}

func TestApplyProtocolNegativePromptSkipsBlank(t *testing.T) {
	request := &protocol.GenerationRequest{Extra: map[string]any{}, ProviderOptions: map[string]map[string]any{}}
	applyProtocolNegativePrompt(request, "dashscope-qwen-image", "  ")
	if len(request.Extra) != 0 || len(request.ProviderOptions) != 0 {
		t.Fatalf("空白负向词不应写入任何键：%#v %#v", request.Extra, request.ProviderOptions)
	}
}

func TestReferenceStrengthAndControlMode(t *testing.T) {
	if got := referenceStrength(providerMedia{}); got != defaultReferenceStrength {
		t.Fatalf("未设置强度应回落默认 0.85：%v", got)
	}
	if got := referenceStrength(providerMedia{Strength: 0.6}); got != 0.6 {
		t.Fatalf("显式强度应透传：%v", got)
	}
	if got := referenceControlMode(providerMedia{ControlMode: " Canny "}); got != "canny" {
		t.Fatalf("控制模式应归一化小写：%q", got)
	}
	if !subjectReferenceLocked(providerMedia{Role: "subject"}) {
		t.Fatal("role=subject 应判定为主体锁定")
	}
	if !subjectReferenceLocked(providerMedia{ControlMode: "depth"}) {
		t.Fatal("显式 controlMode 应判定为主体锁定")
	}
	if subjectReferenceLocked(providerMedia{Role: "style"}) {
		t.Fatal("role=style 不应判定为主体锁定")
	}
}

func TestRunningHubNegativePromptFallbackPicksNegativeNode(t *testing.T) {
	workflow := map[string]interface{}{
		"3": map[string]interface{}{
			"class_type": "CLIPTextEncode",
			"_meta":      map[string]interface{}{"title": "Positive Prompt"},
			"inputs":     map[string]interface{}{"text": "一只猫", "clip": []interface{}{"1", 0}},
		},
		"4": map[string]interface{}{
			"class_type": "CLIPTextEncode",
			"_meta":      map[string]interface{}{"title": "Negative Prompt"},
			"inputs":     map[string]interface{}{"text": "模糊", "clip": []interface{}{"1", 1}},
		},
		"5": map[string]interface{}{
			"class_type": "KSampler",
			"_meta":      map[string]interface{}{"title": "Sampler"},
			"inputs":     map[string]interface{}{"seed": 1, "cfg": 7},
		},
	}
	got := runningHubNegativePromptFallback(workflow, "低画质, 水印")
	if len(got) != 1 {
		t.Fatalf("应只注入一个负向节点：%#v", got)
	}
	if got[0]["nodeId"] != "4" || got[0]["fieldName"] != "text" || got[0]["fieldValue"] != "低画质, 水印" {
		t.Fatalf("负向节点定位错误：%#v", got[0])
	}
}

func TestRunningHubNegativePromptFallbackNoNegativeNode(t *testing.T) {
	workflow := map[string]interface{}{
		"3": map[string]interface{}{
			"class_type": "CLIPTextEncode",
			"_meta":      map[string]interface{}{"title": "Prompt"},
			"inputs":     map[string]interface{}{"text": "一只猫"},
		},
	}
	if got := runningHubNegativePromptFallback(workflow, "模糊"); got != nil {
		t.Fatalf("无负向节点时应返回 nil，不臆造注入：%#v", got)
	}
}

func TestWorkflowFieldsBindNegativePrompt(t *testing.T) {
	enabled := true
	disabled := false
	cases := []struct {
		name  string
		field WorkflowField
		want  bool
	}{
		{"source标记", WorkflowField{NodeID: "4", FieldName: "text", Source: "negativeprompt"}, true},
		{"bind标记", WorkflowField{NodeID: "4", FieldName: "text", BindNegativePrompt: true}, true},
		{"字段名中文节点", WorkflowField{NodeID: "4", FieldName: "负面提示词"}, true},
		{"正向绑定不算", WorkflowField{NodeID: "3", FieldName: "text", Source: "prompt"}, false},
		{"禁用字段不算", WorkflowField{NodeID: "4", FieldName: "text", Source: "negativeprompt", Enabled: &disabled}, false},
		{"启用字段算", WorkflowField{NodeID: "4", FieldName: "text", Source: "negativeprompt", Enabled: &enabled}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := workflowFieldsBindNegativePrompt([]WorkflowField{tc.field}); got != tc.want {
				t.Fatalf("workflowFieldsBindNegativePrompt() = %v, want %v", got, tc.want)
			}
		})
	}
}
