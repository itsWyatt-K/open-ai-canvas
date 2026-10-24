package ecommerce

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// 返工令 B 遗留 2 的真实脏数据形态：整份 markdown 参数报告被灌进「核心卖点」。
func TestSanitizeSellingPointsStripsMarkdownReport(t *testing.T) {
	dirty := "【核心卖点】\n" +
		"| 参数 | 数值 |\n" +
		"|---|---|\n" +
		"| 续航 | **38 小时** |\n" +
		"| 防水 | IPX7 |\n" +
		"\n" +
		"## 材质说明\n" +
		"- 医用级硅胶，`无BPA`\n" +
		"> 数据来自[第三方实验室](https://example.com/report?sig=long)2026 年实测\n" +
		"大促期间　　赠品翻倍"
		clean := SanitizeSellingPoints(dirty)
		for _, banned := range []string{"|", "---", "##", "**", "`", "](", "> "} {
			if strings.Contains(clean, banned) {
				t.Fatalf("清洗结果仍含 markdown 残留 %q：%q", banned, clean)
			}
		}
		for _, want := range []string{"参数 数值", "续航 38 小时", "医用级硅胶", "第三方实验室", "大促期间 赠品翻倍"} {
			if !strings.Contains(clean, want) {
				t.Fatalf("清洗结果丢失有效内容 %q：%q", want, clean)
			}
		}
		if utf8.RuneCountInString(clean) > MaxSellingPointsRunes {
			t.Fatalf("清洗结果超长：%d", utf8.RuneCountInString(clean))
		}
}

func TestSanitizeSellingPointsHardTruncates5000CharInput(t *testing.T) {
	dirty := strings.Repeat("超长卖点冲击波 ", 1000) // ~7000 runes
	if utf8.RuneCountInString(dirty) < 5000 {
		t.Fatalf("用例前置失败：输入应≥5000 字符")
	}
	clean := SanitizeSellingPoints(dirty)
	if utf8.RuneCountInString(clean) != MaxSellingPointsRunes {
		t.Fatalf("硬截断后应为 %d 字符，实际 %d", MaxSellingPointsRunes, utf8.RuneCountInString(clean))
	}
	if !strings.HasSuffix(clean, "…") {
		t.Fatalf("截断尾部应为省略号收尾：%q", clean[len(clean)-6:])
	}
}

func TestSanitizeSellingPointsPreservesLineStructureForSplitter(t *testing.T) {
	// 行结构保留是硬合同：ecommerceProductPayload 按 \n/;/，切 5 条卖点。
	raw := "38dB静音、IPX7防水\n40°C恒温,医用级硅胶；静音\n第六条保留待上游截断\n第七条同上"
	clean := SanitizeSellingPoints(raw)
	got := strings.Split(clean, "\n")
	if len(got) != 4 || got[0] != "38dB静音、IPX7防水" {
		t.Fatalf("行结构被破坏：%#v", got)
	}
}

func TestSanitizeSellingPointsEdgeCases(t *testing.T) {
	if got := SanitizeSellingPoints(""); got != "" {
		t.Fatalf("空输入应返回空：%q", got)
	}
	if got := SanitizeSellingPoints("   \n|---|---|\n---\n###\n"); got != "" {
		t.Fatalf("纯符号输入应清洗为空：%q", got)
	}
	if got := SanitizeSellingPoints("  38dB 静音  "); got != "38dB 静音" {
		t.Fatalf("普通文本应仅去首尾空白：%q", got)
	}
	if SellingPointsOverLimit("ok") != 0 {
		t.Fatal("未超长应返回 0")
	}
	if SellingPointsOverLimit(strings.Repeat("长", 600)) != 100 {
		t.Fatal("超长应返回超出字符数")
	}
}
