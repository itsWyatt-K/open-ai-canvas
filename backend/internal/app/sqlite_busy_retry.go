package app

// SQLite 写锁退避重试（阶段 5 · 画布保存与任务派发抢锁）。
//
// 现象：生图任务收尾时后端 `UPDATE tasks ...`（认领/回写）与前端高频
// `PATCH /canvas-projects/{id}/operations`（画布保存）抢同一把 SQLite 写锁，
// 日志出现 `database is locked (517)` + "task dispatch paused: stage=claim"，
// 前端随即显示「作品已生成，保存遇到问题，正在自动恢复」。
//
// 为什么不能只靠 busy_timeout：DSN 里已配 `_busy_timeout=5000`，但
// ClaimNextTask 是 `SELECT（持共享锁）→ UPDATE（升级写锁）` 两段式，
// WAL 下的**锁升级**冲突 glebarez/sqlite（纯 Go 驱动）会立即返回 SQLITE_BUSY，
// 不走等待队列。因此必须在应用层退避重试。
//
// 只对「可重试的库忙/锁错误」重试；其余错误（约束冲突、数据问题）立即返回，
// 绝不掩盖真实故障。

import (
	"context"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// sqliteRetryDelays 退避序列：SQLite 写锁通常几毫秒内释放，三次足够覆盖。
var sqliteRetryDelays = []time.Duration{
	150 * time.Millisecond,
	400 * time.Millisecond,
	900 * time.Millisecond,
}

// isSQLiteBusyError 判断是否为「库忙/锁」类可重试错误。
//
// 覆盖 glebarez/sqlite 与 modernc 两种纯 Go 驱动的常见文案：
//   - "database is locked"
//   - "database table is locked"
//   - "SQLITE_BUSY" / "SQLITE_BUSY_SNAPSHOT" / "SQLITE_LOCKED"
//   - glebarez 包装后的 "(517)" 错误码
func isSQLiteBusyError(err error) bool {
	if err == nil {
		return false
	}
	text := strings.ToLower(err.Error())
	for _, marker := range []string{
		"database is locked",
		"database table is locked",
		"sqlite_busy",
		"sqlite_locked",
		"sqlite busy",
		"database is busy",
	} {
		if strings.Contains(text, marker) {
			return true
		}
	}
	// glebarez/sqlite 的裸错误码形态，例如 "database is locked (517)"。
	return strings.Contains(text, "(517)") || strings.Contains(text, "(5)") && strings.Contains(text, "locked")
}

// withSQLiteBusyRetry 在库忙/锁时按退避序列重试，其余错误立即返回。
//
// op 每次调用都应是**完整可重入**的操作（含事务），因为 SQLite 锁冲突时
// 整个事务已回滚，重试等于重新开一轮。
func withSQLiteBusyRetry(op func() error) error {
	var lastErr error
	for attempt := 0; attempt <= len(sqliteRetryDelays); attempt++ {
		if err := op(); err != nil {
			if !isSQLiteBusyError(err) {
				return err
			}
			lastErr = err
			if attempt == len(sqliteRetryDelays) {
				break
			}
			time.Sleep(sqliteRetryDelays[attempt])
			continue
		}
		return nil
	}
	return lastErr
}

// claimNextTaskWithRetry 认领下一个任务，库忙时退避重试。
//
// 与 ClaimNextTask 的差别只在重试：认领本身是幂等的（status/lease 条件收口，
// 重试不会重复认领同一任务），所以重试不会产生副作用。
func (s *Service) claimNextTaskWithRetry(ctx context.Context, owner string, leaseDuration time.Duration) (*model.Task, bool, error) {
	var task *model.Task
	claimed := false
	err := withSQLiteBusyRetry(func() error {
		result, err := s.repo.WithContext(ctx).ClaimNextTask(owner, leaseDuration)
		if err != nil {
			return err
		}
		task, claimed = result, result != nil
		return nil
	})
	return task, claimed, err
}
