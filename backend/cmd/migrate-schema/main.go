package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"yingce/backend/internal/canvas"
	"yingce/backend/internal/database"
)

func main() {
	command := "up"
	if len(os.Args) > 1 {
		command = strings.ToLower(strings.TrimSpace(os.Args[1]))
	}
	apply := false
	if command == "repair-asset-bytes" || command == "repair-canvas-resources" {
		if len(os.Args) == 3 && os.Args[2] == "--apply" {
			apply = true
		} else if len(os.Args) > 2 {
			log.Fatalf("用法：migrate-schema %s [--apply]；默认只检查", command)
		}
	}
	if command == "repair-canvas-resources" && strings.TrimSpace(os.Getenv("CANVAS_BACKEND_DATA_DIR")) == "" && strings.TrimSpace(os.Getenv("DATABASE_URL")) == "" {
		log.Fatal("资源修复必须显式设置 CANVAS_BACKEND_DATA_DIR 或 DATABASE_URL；拒绝使用默认数据库")
	}
	db, err := database.Open(database.Config{
		Driver:  env("CANVAS_DATABASE_DRIVER", "sqlite"),
		DSN:     os.Getenv("DATABASE_URL"),
		DataDir: resolveDataDir(),
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := database.ConfigurePool(db); err != nil {
		log.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()

	switch command {
	case "repair-canvas-resources":
		if err := database.RequireSchemaVersion(db); err != nil {
			log.Fatal(err)
		}
		report, repairErr := canvas.RepairCanvasResources(db, apply)
		encoded, err := json.Marshal(report)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(string(encoded))
		if repairErr != nil {
			log.Fatal(repairErr)
		}
		if report.Unresolved > 0 {
			log.Fatal("存在需人工处理的画布，请按报告恢复历史或重新上传；未删除主媒体")
		}
		return
	case "repair-asset-bytes":
		report, repairErr := canvas.RepairAssetBytes(db, apply)
		encoded, err := json.Marshal(report)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(string(encoded))
		if repairErr != nil {
			log.Fatal(repairErr)
		}
		if len(report.Unresolved) > 0 {
			log.Fatal("存在未修复素材，请按报告核查；未删除或填零")
		}
		return
	case "up":
		if err := database.MigrateSchema(db); err != nil {
			log.Fatal(err)
		}
	case "status":
	case "verify":
		if err := database.RequireSchemaVersion(db); err != nil {
			log.Fatal(err)
		}
	default:
		log.Fatalf("未知命令 %q；可用命令：up、status、verify、repair-asset-bytes、repair-canvas-resources", command)
	}
	status, err := database.ReadSchemaStatus(db)
	if err != nil {
		log.Fatal(err)
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(encoded))
}

func env(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

// resolveDataDir 数据目录防呆：权威变量 CANVAS_BACKEND_DATA_DIR；仅设旧名
// CANVAS_DATA_PATH 时兼容读取并告警（防误操作真库）；两者不一致以权威变量为准。
func resolveDataDir() string {
	canonical := strings.TrimSpace(os.Getenv("CANVAS_BACKEND_DATA_DIR"))
	legacy := strings.TrimSpace(os.Getenv("CANVAS_DATA_PATH"))
	if canonical != "" && legacy != "" && canonical != legacy {
		log.Printf("警告：CANVAS_BACKEND_DATA_DIR(%s) 与 CANVAS_DATA_PATH(%s) 不一致，以权威变量为准", canonical, legacy)
	} else if canonical == "" && legacy != "" {
		log.Printf("警告：CANVAS_DATA_PATH 为兼容旧名，建议改用 CANVAS_BACKEND_DATA_DIR（本次解析为 %s）", legacy)
		return legacy
	}
	return env("CANVAS_BACKEND_DATA_DIR", "data")
}
