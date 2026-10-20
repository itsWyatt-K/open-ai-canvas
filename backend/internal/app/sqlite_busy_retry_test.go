package app

// SQLite 写锁退避重试回归。
//
// 现场：生图任务收尾时后端 `UPDATE tasks ...`（认领/回写）与前端画布保存
// `PATCH /canvas-projects/{id}/operations` 抢同一把 SQLite 写锁，
// 日志出现 `database is locked (517)` + "task dispatch paused: stage=claim"，
// 前端随即显示「作品已生成，保存遇到问题，正在自动恢复」。

import (
	"errors"
	"testing"
	"time"
)

func TestIsSQLiteBusyError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"glebarez 标准文案", errors.New("database is locked (517)"), true},
		{"modernc SQLITE_BUSY", errors.New("SQLITE_BUSY: database is locked"), true},
		{"表级锁", errors.New("database table is locked"), true},
		{"SQLITE_LOCKED", errors.New("sqlite_locked"), true},
		{"database is busy", errors.New("database is busy"), true},
		{"约束冲突不重试", errors.New("UNIQUE constraint failed: tasks.id"), false},
		{"空错误", nil, false},
		{"普通业务错误", errors.New("task not found"), false},
	}
	for _, item := range cases {
		if got := isSQLiteBusyError(item.err); got != item.want {
			t.Fatalf("%s：isSQLiteBusyError(%v) = %v，期望 %v", item.name, item.err, got, item.want)
		}
	}
}

func TestWithSQLiteBusyRetrySucceedsAfterTransientLocks(t *testing.T) {
	attempts := 0
	start := time.Now()
	err := withSQLiteBusyRetry(func() error {
		attempts++
		if attempts < 3 {
			return errors.New("database is locked (517)")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("第三次应成功，得到 %v", err)
	}
	if attempts != 3 {
		t.Fatalf("应重试到第 3 次，实际 %d 次", attempts)
	}
	// 退避序列 150ms + 400ms 已发生；只验证确实等待过，不卡死测试。
	if elapsed := time.Since(start); elapsed < 500*time.Millisecond {
		t.Fatalf("应发生退避等待，实际 %v", elapsed)
	}
}

func TestWithSQLiteBusyRetryExhaustsAndSurfacesLastError(t *testing.T) {
	attempts := 0
	err := withSQLiteBusyRetry(func() error {
		attempts++
		return errors.New("database is locked (517)")
	})
	if err == nil {
		t.Fatal("重试耗尽后必须返回错误，不能静默成功")
	}
	if !isSQLiteBusyError(err) {
		t.Fatalf("应返回最后一次真实错误，得到 %v", err)
	}
	// 1 次首发 + 3 次重试。
	if attempts != 1+len(sqliteRetryDelays) {
		t.Fatalf("应共尝试 %d 次，实际 %d 次", 1+len(sqliteRetryDelays), attempts)
	}
}

func TestWithSQLiteBusyRetryDoesNotRetryNonBusyErrors(t *testing.T) {
	attempts := 0
	err := withSQLiteBusyRetry(func() error {
		attempts++
		return errors.New("UNIQUE constraint failed: tasks.id")
	})
	if err == nil {
		t.Fatal("非库忙错误必须立即返回")
	}
	if attempts != 1 {
		t.Fatalf("非库忙错误不应重试，实际尝试 %d 次", attempts)
	}
}
