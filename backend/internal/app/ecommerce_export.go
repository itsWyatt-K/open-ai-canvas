// 电商导出：清单（JSON）与流式 ZIP。
//
// 目录结构（与 10-11 设计文档 Task 11 一致）：
//
//	商品名/主图/01_主题.png
//	商品名/详情页/01_主题.png
//	商品名/标题.txt
//	商品名/任务清单.json
//
// 纪律：
//   - 只导出**已生成且成功**的槽位；失败/未生成跳过（不产生空文件占位）；
//   - 无任何可用产物 → 400 可读错误（不返回空 zip）；
//   - 文件名清洗 Windows 保留字符；重名自动追加序号，不覆盖；
//   - 从资源存储直接读取字节流，**不下载再上传**，清单不含任何签名 URL。
package app

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/ecommerce"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// ExportEntry 导出清单条目。
type ExportEntry struct {
	Path        string `json:"path"`
	SlotKey     string `json:"slotKey,omitempty"`
	Title       string `json:"title,omitempty"`
	Kind        string `json:"kind,omitempty"`
	Version     int    `json:"version,omitempty"`
	ResourceID  string `json:"resourceId,omitempty"`
	ContentType string `json:"contentType,omitempty"`
	Bytes       int64  `json:"bytes,omitempty"`
}

// EcommerceExportManifest 导出清单。
type EcommerceExportManifest struct {
	ProductID   string        `json:"productId"`
	ProductName string        `json:"productName"`
	Round       int           `json:"round"`
	Title       string        `json:"title,omitempty"`
	Entries     []ExportEntry `json:"entries"`
	GeneratedAt string        `json:"generatedAt"`
}

// exportableSlot 已完成且可导出的槽位（含资源元信息）。
type exportableSlot struct {
	slot     model.EcommerceSlot
	resource model.Resource
	version  int
}

// EcommerceExportManifest 生成导出清单（不读文件字节，只读元信息）。
func (s *Service) EcommerceExportManifest(userID, productID string) (*EcommerceExportManifest, error) {
	product, slots, err := s.exportableSlots(userID, productID)
	if err != nil {
		return nil, err
	}
	manifest := &EcommerceExportManifest{
		ProductID: product.ID, ProductName: product.Name, Round: product.Round,
		Title: product.TitleText, GeneratedAt: time.Now().Format(time.RFC3339),
		Entries: make([]ExportEntry, 0, len(slots)+2),
	}
	folder := sanitizeExportName(firstNonEmpty(product.Name, "商品"))
	used := map[string]int{}
	for _, item := range slots {
		group := "详情页"
		if item.slot.Kind == ecommerce.SlotKindHero {
			group = "主图"
		}
		name := fmt.Sprintf("%02d_%s%s", item.slot.SlotNo,
			sanitizeExportName(firstNonEmpty(item.slot.Title, item.slot.SlotKey)), extensionFor(item.resource.MimeType))
		entry := ExportEntry{
			Path:    path.Join(folder, group, uniqueExportName(used, path.Join(folder, group), name)),
			SlotKey: item.slot.SlotKey, Title: item.slot.Title, Kind: item.slot.Kind,
			Version: item.version, ResourceID: item.resource.ID,
			ContentType: item.resource.MimeType, Bytes: item.resource.Size,
		}
		manifest.Entries = append(manifest.Entries, entry)
	}
	if strings.TrimSpace(product.TitleText) != "" {
		manifest.Entries = append(manifest.Entries, ExportEntry{
			Path: path.Join(folder, "标题.txt"), Title: "商品标题",
			ContentType: "text/plain; charset=utf-8",
		})
	}
	manifest.Entries = append(manifest.Entries, ExportEntry{
		Path: path.Join(folder, "任务清单.json"), Title: "任务清单",
		ContentType: "application/json",
	})
	return manifest, nil
}

// EcommerceExportZip 流式写 ZIP 到 w。
//
// 先做一次产物存在性检查：无任何成品图 → 400（避免下载到一个只有清单的空包）。
func (s *Service) EcommerceExportZip(userID, productID string, w io.Writer) error {
	product, slots, err := s.exportableSlots(userID, productID)
	if err != nil {
		return err
	}
	if len(slots) == 0 {
		return NewAppError(http.StatusBadRequest, "该商品还没有任何已完成的成品图，无法打包下载")
	}
	manifest, err := s.EcommerceExportManifest(userID, productID)
	if err != nil {
		return err
	}
	archive := zip.NewWriter(w)
	defer archive.Close()

	folder := sanitizeExportName(firstNonEmpty(product.Name, "商品"))
	for index, item := range slots {
		// 与 manifest 使用同一顺序，保证清单路径与包内路径逐字一致。
		entryPath := manifest.Entries[index].Path
		if err := s.writeResourceToZip(userID, archive, entryPath, item.resource); err != nil {
			return err
		}
	}
	// 标题
	if strings.TrimSpace(product.TitleText) != "" {
		file, err := archive.Create(path.Join(folder, "标题.txt"))
		if err != nil {
			return err
		}
		if _, err := io.WriteString(file, product.TitleText+"\n"); err != nil {
			return err
		}
	}
	// 任务清单
	file, err := archive.Create(path.Join(folder, "任务清单.json"))
	if err != nil {
		return err
	}
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if _, err := file.Write(encoded); err != nil {
		return err
	}
	return nil
}

// exportableSlots 取商品与「已完成且资源存在」的槽位（按 kind/slotNo 排序）。
func (s *Service) exportableSlots(userID, productID string) (*model.EcommerceProduct, []exportableSlot, error) {
	product, err := s.repo.GetEcommerceProduct(userID, productID)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, nil, kernel.NotFound("商品任务不存在")
		}
		return nil, nil, err
	}
	slots, err := s.repo.ListEcommerceSlots(productID)
	if err != nil {
		return nil, nil, err
	}
	result := make([]exportableSlot, 0, len(slots))
	for _, slot := range slots {
		if slot.Status != ecommerce.SlotStatusCompleted {
			continue
		}
		versions, err := s.repo.ListEcommerceSlotVersions(slot.ID)
		if err != nil {
			return nil, nil, err
		}
		// 取最新且有资源的一条版本（跳过失败版本）。
		var picked *model.EcommerceSlotVersion
		for index := range versions {
			if strings.TrimSpace(versions[index].ResourceID) != "" {
				picked = &versions[index]
			}
		}
		if picked == nil {
			continue
		}
		resource, err := s.repo.ResourceForUser(userID, picked.ResourceID)
		if err != nil {
			continue // 资源被删：跳过而不是让整个导出失败
		}
		result = append(result, exportableSlot{slot: slot, resource: *resource, version: picked.Version})
	}
	return product, result, nil
}

// writeResourceToZip 从资源存储直读字节写入 zip 条目。
func (s *Service) writeResourceToZip(userID string, archive *zip.Writer, entryPath string, resource model.Resource) error {
	_, reader, err := s.OpenResource(userID, resource.ID)
	if err != nil {
		return err
	}
	defer reader.Close()
	file, err := archive.Create(entryPath)
	if err != nil {
		return err
	}
	if _, err := io.Copy(file, reader); err != nil {
		return err
	}
	return nil
}

// sanitizeExportName 清洗文件名：Windows 保留字符 → _，去首尾空白与点，限长 80 字符。
func sanitizeExportName(name string) string {
	replacer := strings.NewReplacer(`\`, "_", `/`, "_", `:`, "_", `*`, "_", `?`, "_",
		`"`, "_", `<`, "_", `>`, "_", `|`, "_")
	cleaned := strings.Trim(strings.TrimSpace(replacer.Replace(name)), ".")
	if cleaned == "" {
		return "未命名"
	}
	runes := []rune(cleaned)
	if len(runes) > 80 {
		cleaned = string(runes[:80])
	}
	return cleaned
}

// uniqueExportName 同一目录内重名追加 _2/_3，避免覆盖。
func uniqueExportName(used map[string]int, dir, name string) string {
	key := dir + "/" + name
	used[key]++
	if used[key] == 1 {
		return name
	}
	ext := path.Ext(name)
	base := strings.TrimSuffix(name, ext)
	return fmt.Sprintf("%s_%d%s", base, used[key], ext)
}

// extensionFor 按 MIME 推断扩展名（缺省 .png）。
func extensionFor(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0])) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/avif":
		return ".avif"
	default:
		return ".png"
	}
}
