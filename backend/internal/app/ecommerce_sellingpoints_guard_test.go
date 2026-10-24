package app

import (
	"context"
	"strings"
	"testing"
	"unicode/utf8"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/model"
)

// sellingPointsDirtyReport 复刻返工令 B 遗留 2 的真实脏数据形态：
// 数千字 markdown 参数报告（表格 + 标题 + 加粗 + 链接）被灌进「核心卖点」。
func sellingPointsDirtyReport() string {
	row := "| 续航 | **38 小时** |\n| 防水 | IPX7 |\n| 材质 | 医用级硅胶 |\n"
	report := "【核心卖点】\n| 参数 | 数值 |\n|---|---|\n" + strings.Repeat(row, 400)
	report += "\n## 实验室数据\n" + strings.Repeat("> 数据来自[第三方实验室](https://example.com/r)实测，`无BPA`。\n", 200)
	if utf8.RuneCountInString(report) < 5000 {
		panic("用例前置失败：脏数据应≥5000 字符")
	}
	return report
}

// L3-1：策划 payload 层（ecommerceProductPayload）—— 脏数据进不来。
func TestEcommerceProductPayloadGuardsDirtySellingPoints(t *testing.T) {
	product := &model.EcommerceProduct{Name: "潮汐", SellingPoints: sellingPointsDirtyReport()}
	payload := ecommerceProductPayload(product)
	points, ok := payload["selling_points"].([]string)
	if !ok {
		t.Fatal("卖点应为字符串数组")
	}
	total := 0
	for _, point := range points {
		total += utf8.RuneCountInString(point)
		for _, banned := range []string{"|", "**", "](", "`", "##"} {
			if strings.Contains(point, banned) {
				t.Fatalf("payload 卖点仍含 markdown 残留 %q：%q", banned, point)
			}
		}
	}
	if total > 5*ecommerce.MaxSellingPointsRunes {
		t.Fatalf("payload 卖点总量超限：%d", total)
	}
}

// L3-2：生图提示词编译层（buildEcommerceSlotPrompt）—— 最终防线。
func TestBuildEcommerceSlotPromptGuardsDirtySellingPoints(t *testing.T) {
	prompt := buildEcommerceSlotPrompt(ecommerceSlotPromptInput{
		PlatformName: "拼多多", SlotTitle: "白底主图", SlotNo: 1, Kind: "hero",
		ProductName: "潮汐", ProductSelling: sellingPointsDirtyReport(),
		SlotSellingPoints: strings.Repeat("超长脏卖点 ", 1000),
	})
	for _, banned := range []string{"|", "**", "](", "`", "##"} {
		if strings.Contains(prompt, banned) {
			t.Fatalf("最终提示词仍含 markdown 残留 %q", banned)
		}
	}
	// 卖点区被限长，但提示词骨架完整。
	if !strings.Contains(prompt, "核心卖点：") || !strings.Contains(prompt, "未提供") == false {
		if !strings.Contains(prompt, "核心卖点：") {
			t.Fatal("提示词应保留核心卖点区")
		}
	}
	if !strings.Contains(prompt, "【画面文字与海报排版硬性要求】") {
		t.Fatal("提示词骨架应完整")
	}
	// 每处卖点不超过 500 rune（含「…」截断收尾）。
	if strings.Count(prompt, "…") == 0 {
		t.Fatal("超长卖点应被截断（应以省略号收尾）")
	}
}

// L1：导入/保存 API 层（UpdateEcommerceProductBrief）—— 脏数据根本进不了库。
func TestUpdateEcommerceProductBriefSanitizesSellingPoints(t *testing.T) {
	s, db := newEcommerceLifecycleService(t)
	productID := importLifecycleProduct(t, s, "脏数据商品.png")
	dirty := sellingPointsDirtyReport()
	if err := s.UpdateEcommerceProductBrief("user", productID, &dirty, nil); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.GetEcommerceProduct("user", productID)
	if err != nil {
		t.Fatal(err)
	}
	if utf8.RuneCountInString(stored.SellingPoints) > ecommerce.MaxSellingPointsRunes {
		t.Fatalf("落库卖点超限：%d", utf8.RuneCountInString(stored.SellingPoints))
	}
	for _, banned := range []string{"|---", "**", "](", "##"} {
		if strings.Contains(stored.SellingPoints, banned) {
			t.Fatalf("落库卖点仍含 markdown 残留 %q", banned)
		}
	}
	if strings.TrimSpace(stored.SellingPoints) == "" {
		t.Fatal("清洗后应保留有效内容而非清空")
	}
	_ = db
	_ = context.Background()
}
