package database

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"infinite-canvas/backend/internal/logging"

	// [LOCAL] 车道②本地适配：上游 v1.6.0 把 sqlite 驱动换成 gorm.io/driver/sqlite
	// （mattn/go-sqlite3，需要 CGO）。本机编译链是 CGO_ENABLED=0（纯 Go 交叉编译），
	// CGO 驱动的 stub 会在运行时直接报错，因此保留 glebarez 纯 Go 驱动。
	// 语义差异：glebarez 用 _pragma DSN；mattn 用 _busy_timeout DSN——换回 _pragma 写法。
	"github.com/glebarez/sqlite"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type Config struct {
	Driver  string
	DSN     string
	DataDir string
}

func Open(config Config) (*gorm.DB, error) {
	driver := strings.ToLower(strings.TrimSpace(config.Driver))
	if driver == "" {
		driver = "sqlite"
	}
	switch driver {
	case "sqlite":
		dsn := strings.TrimSpace(config.DSN)
		if dsn == "" {
			if err := os.MkdirAll(config.DataDir, 0o755); err != nil {
				return nil, err
			}
			dsn = config.DataDir + "/open_ai_canvas.db?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)"
		}
		return gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logging.GormLogger()})
	case "postgres", "postgresql":
		dsn := strings.TrimSpace(config.DSN)
		if dsn == "" {
			return nil, errors.New("PostgreSQL 模式必须配置 DATABASE_URL")
		}
		return gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logging.GormLogger()})
	default:
		return nil, fmt.Errorf("不支持的数据库驱动：%s", driver)
	}
}

func ConfigurePool(db *gorm.DB) error {
	sqlDB, err := db.DB()
	if err != nil {
		return err
	}
	if db.Dialector.Name() == "postgres" {
		sqlDB.SetMaxOpenConns(30)
		sqlDB.SetMaxIdleConns(10)
		return nil
	}
	sqlDB.SetMaxOpenConns(8)
	sqlDB.SetMaxIdleConns(4)
	return nil
}
