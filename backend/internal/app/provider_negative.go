// 负向提示词（NegativePrompt）与参考图强控参数的渠道适配层。
//
// 统一契约：前端与外部引擎只传 input.negativePrompt 与
// referenceImages[].strength/controlMode/maskStorageKey，由后端按渠道能力分发：
//   - 声明式插件（manifest 驱动）：负向词经 providerOptions.<interface>.negative_prompt
//     与 extra.negative_prompt 原生映射（dashscope-qwen-image / stability-image /
//     ideogram-image / wanx / midjourney 等已实现该扩展键）；
//   - 手写图片路径（OpenAI Images / Gemini / Grok / 火山方舟 / 即梦）：没有原生
//     负向词字段，降级追加结构化禁令段，避免与正文混写被模型忽略；
//   - RunningHub / ComfyUI 工作流：定位负向 CLIPTextEncode 节点注入。

package app

import (
	"strings"

	"yingce/backend/internal/protocol"
)

// negativeConstraintHeader 是降级追加时的结构化禁令段头。
// 放在 systemPrompt 与正文之后独立成段，模型按显式禁令处理。
const negativeConstraintHeader = "\n\n[Negative Constraints / 画面严禁出现]: "

// negativeConstraintSuffix 收尾标记，降低禁令段被后续内容覆盖的概率。
const negativeConstraintSuffix = "\n[End of Negative Constraints]"

// defaultReferenceStrength 是商品主体锁定的默认参考强度。
// 0.80~0.90 区间在 IP-Adapter 实践中兼顾身份保持与构图自由度。
const defaultReferenceStrength = 0.85

// negativeConstraintBlock 返回结构化禁令段；负向词为空时返回空串。
func negativeConstraintBlock(negative string) string {
	negative = strings.TrimSpace(negative)
	if negative == "" {
		return ""
	}
	return negativeConstraintHeader + negative + negativeConstraintSuffix
}

// effectiveImagePrompt 返回实际下发到手写图片路径的提示词。
// 声明式路径不在此处追加（负向词经 providerOptions 原生映射，见
// applyProtocolNegativePrompt），调用方 runImageTask 已在入口分流。
func effectiveImagePrompt(input canvasGenerationInput) string {
	return withSystemPrompt(input.Config, input.Prompt) + negativeConstraintBlock(input.NegativePrompt)
}

// applyProtocolNegativePrompt 把负向词注入声明式插件请求。
// 两路并行写入，适配不同 manifest 的读取约定：
//  1. providerOptions.<interfaceType>.negative_prompt：manifest 的厂商扩展键；
//  2. extra.negative_prompt / extra.negativePrompt：从 Extra 合并的适配器。
// 已显式配置的同名 providerOptions 值不覆盖（管理员配置优先）。
func applyProtocolNegativePrompt(request *protocol.GenerationRequest, interfaceType string, negative string) {
	negative = strings.TrimSpace(negative)
	if request == nil || negative == "" {
		return
	}
	if request.Extra == nil {
		request.Extra = map[string]any{}
	}
	request.Extra["negative_prompt"] = negative
	request.Extra["negativePrompt"] = negative
	namespace := strings.TrimSpace(interfaceType)
	if namespace == "" {
		return
	}
	if request.ProviderOptions == nil {
		request.ProviderOptions = map[string]map[string]any{}
	}
	options := request.ProviderOptions[namespace]
	if options == nil {
		options = map[string]any{}
	}
	if _, exists := options["negative_prompt"]; !exists {
		options["negative_prompt"] = negative
	}
	request.ProviderOptions[namespace] = options
}

// referenceControlMode 归一化参考图控制模式；空值返回空（调用方按渠道默认处理）。
func referenceControlMode(media providerMedia) string {
	return strings.ToLower(strings.TrimSpace(media.ControlMode))
}

// referenceStrength 归一化参考强度：未设置（0）时返回默认锁定强度。
func referenceStrength(media providerMedia) float64 {
	if media.Strength > 0 {
		return media.Strength
	}
	return defaultReferenceStrength
}

// subjectReferenceLocked 判断该参考图是否声明了商品主体强锁定
// （role=subject 或显式 controlMode）。供工作流/协议层决定是否注入
// IP-Adapter / ControlNet 权重。
func subjectReferenceLocked(media providerMedia) bool {
	role := strings.ToLower(strings.TrimSpace(media.Role))
	if role == "subject" || role == "product" {
		return true
	}
	return referenceControlMode(media) != ""
}
