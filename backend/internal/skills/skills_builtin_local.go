// [LOCAL] 本地替代实现：builtinSeedSkillIDs
//
// 上游该函数从 backend/builtin 的嵌入文件系统（go:embed）加载内置技能包。
// 本地按车道②永久政策不吸收上游技能资产（backend/builtin 已删除），
// 因此改用本地种子源 internal/skills/seed/skills.json 提供同一契约。
//
// 影响面：上游 internal/skills/skills_presets.go 调用本函数做场景预设引用校验；
// 语义等价（返回应被引用的种子技能 ID 全集），只是数据来源不同。
package skills

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// builtinSeedSkillIDsLocal 返回本地种子技能 ID 全集（68 条）。
func builtinSeedSkillIDsLocal() ([]string, error) {
	candidates := []string{
		filepath.Join("internal", "skills", "seed", "skills.json"),
		filepath.Join("seed", "skills.json"),
	}
	var (
		raw []byte
		err error
	)
	for _, p := range candidates {
		if raw, err = os.ReadFile(p); err == nil {
			break
		}
	}
	if raw == nil {
		return nil, errors.New("读取本地种子 skills.json 失败")
	}

	var items []struct {
		SkillID string `json:"skill_id"`
	}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("解析本地种子 skills.json 失败: %w", err)
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		if item.SkillID != "" {
			ids = append(ids, item.SkillID)
		}
	}
	if len(ids) == 0 {
		return nil, errors.New("本地种子技能为空")
	}
	return ids, nil
}
