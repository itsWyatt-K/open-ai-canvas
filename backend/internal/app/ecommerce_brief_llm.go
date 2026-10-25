// 电商实战二期 · 「AI 换个思路」LLM 化。
//
// 通道配置（环境变量，控制台启动时注入）：
//   CANVAS_ECOMMERCE_BRIEF_LLM_BASE  OpenAI 兼容端点（如 http://127.0.0.1:8317/v1）
//   CANVAS_ECOMMERCE_BRIEF_LLM_KEY   API Key（不配即自动回退确定性变体器，行为不变）
//   CANVAS_ECOMMERCE_BRIEF_LLM_MODEL 模型名（默认 gemini-3.8-flash-high）
//
// 挂载 ecommerce-visual-director 技能规范（屏序职能/版式枚举/字数合同）为
// system prompt，结合用户 hint 重写 L1 四字段；严格 JSON 输出。
// 任何失败（未配置/超时/坏 JSON/越权字段）静默回退 reworkEcommerceBriefWithHint。
package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const ecommerceBriefLLMTimeout = 25 * time.Second

// ecommerceBriefLLMReady 是否配置了可用 LLM 通道（key 必须显式注入）。
func ecommerceBriefLLMReady() bool {
	return strings.TrimSpace(os.Getenv("CANVAS_ECOMMERCE_BRIEF_LLM_KEY")) != ""
}

// ecommerceBriefLLMSystemPrompt 技能规范核心（与 builtin/ecommerce-visual-director 同源摘录）。
func ecommerceBriefLLMSystemPrompt() string {
	return "你是电商套图视觉导演（ecommerce-visual-director 技能）。任务：按用户的方向提示，重写当前这一屏的人话企划。" +
		"字段合同：screen_title≤80字（卖点结论）；sub_title≤120字（支撑卖点/人群限定）；scene_desc≤600字大白话（背景/道具/光线氛围/商品摆位）；" +
		"layout_type 只能取：center-closeup(居中特写)/left-image-right-text(左图右文)/top-text-bottom-image(上文下图)/scene-interspersed(场景穿插)/contrast-split(对比分屏)。" +
		"合规红线：绝对化用语（最/第一/国家级）、无凭证医疗功效、虚构背书一律不写；数字必须有依据。" +
		"只输出 JSON 对象：{\"screen_title\":\"...\",\"sub_title\":\"...\",\"scene_desc\":\"...\",\"layout_type\":\"...\"}，不要输出其他任何内容。"
}

// ecommerceBriefLLMRework 调 LLM 重写企划；成功返回 true（out 已填充）。
// 失败返回 false，调用方回退确定性变体器。
func ecommerceBriefLLMRework(ctx context.Context, brief EcommerceUserBrief, hint string, slotTitle string, out *EcommerceUserBrief) bool {
	if !ecommerceBriefLLMReady() {
		return false
	}
	base := strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_ECOMMERCE_BRIEF_LLM_BASE")), "/")
	if base == "" {
		base = "http://127.0.0.1:8317/v1"
	}
	model := firstNonEmpty(strings.TrimSpace(os.Getenv("CANVAS_ECOMMERCE_BRIEF_LLM_MODEL")), "gemini-3.8-flash-high")
	userPrompt := fmt.Sprintf(
		"当前屏（%s）的企划：主标题=%s；副标题=%s；场景=%s；版式=%s。用户方向提示：%s。请重写。",
		slotTitle, brief.ScreenTitle, brief.SubTitle, brief.SceneDesc, brief.LayoutType, hint)
	body, err := json.Marshal(map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": ecommerceBriefLLMSystemPrompt()},
			{"role": "user", "content": userPrompt},
		},
		"temperature": 0.6,
		"max_tokens": 800,
	})
	if err != nil {
		return false
	}
	requestCtx, cancel := context.WithTimeout(ctx, ecommerceBriefLLMTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodPost, base+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return false
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(os.Getenv("CANVAS_ECOMMERCE_BRIEF_LLM_KEY")))
	response, err := (&http.Client{Timeout: ecommerceBriefLLMTimeout}).Do(request)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil || response.StatusCode != http.StatusOK {
		return false
	}
	var completion struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(payload, &completion); err != nil || len(completion.Choices) == 0 {
		return false
	}
	content := strings.TrimSpace(completion.Choices[0].Message.Content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start < 0 || end <= start {
		return false
	}
	var reworked EcommerceUserBrief
	if err := json.Unmarshal([]byte(content[start:end+1]), &reworked); err != nil {
		return false
	}
	if err := (&reworked).Validate(); err != nil {
		return false
	}
	*out = reworked
	return true
}
