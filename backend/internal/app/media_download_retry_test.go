package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestMediaDownloadBackoffDelayExponentialWithCap(t *testing.T) {
	original := downloadJitter
	downloadJitter = func() time.Duration { return 0 }
	t.Cleanup(func() { downloadJitter = original })
	want := []time.Duration{time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second, 8 * time.Second}
	for attempt, expected := range want {
		if got := mediaDownloadBackoffDelay(attempt); got != expected {
			t.Fatalf("attempt %d 退避 = %s, want %s", attempt, got, expected)
		}
	}
}

func TestMediaDownloadBackoffDelayJitterBounded(t *testing.T) {
	original := downloadJitter
	downloadJitter = func() time.Duration { return 999 * time.Millisecond }
	t.Cleanup(func() { downloadJitter = original })
	if got := mediaDownloadBackoffDelay(0); got != 1999*time.Millisecond {
		t.Fatalf("带抖动 attempt 0 退避 = %s, want 1999ms", got)
	}
	if got := mediaDownloadBackoffDelay(4); got != 8999*time.Millisecond {
		t.Fatalf("带抖动封顶退避 = %s, want 8999ms", got)
	}
}

func TestRetryWithDownloadBackoffSucceedsAfterRetryableFailures(t *testing.T) {
	original := downloadJitter
	downloadJitter = func() time.Duration { return 0 }
	t.Cleanup(func() { downloadJitter = original })
	calls := 0
	flake := errors.New("read tcp: connection reset by peer")
	err := retryWithDownloadBackoff(context.Background(), nil, func() error {
		calls++
		if calls <= 2 {
			return flake
		}
		return nil
	})
	if err != nil {
		t.Fatalf("第 3 次应成功: %v", err)
	}
	if calls != 3 {
		t.Fatalf("应尝试 3 次，实际 %d", calls)
	}
}

func TestRetryWithDownloadBackoffFailsFastOnNonRetryable(t *testing.T) {
	calls := 0
	err := retryWithDownloadBackoff(context.Background(), nil, func() error {
		calls++
		return providerHTTPError{StatusCode: http.StatusBadRequest, Status: "400 Bad Request"}
	})
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusBadRequest {
		t.Fatalf("应原样返回 4xx 错误: %v", err)
	}
	if calls != 1 {
		t.Fatalf("4xx 不应重试，实际尝试 %d 次", calls)
	}
}

func TestRetryWithDownloadBackoffExhaustsAttempts(t *testing.T) {
	original := downloadJitter
	downloadJitter = func() time.Duration { return 0 }
	t.Cleanup(func() { downloadJitter = original })
	calls := 0
	err := retryWithDownloadBackoff(context.Background(), nil, func() error {
		calls++
		return errors.New("tls handshake timeout")
	})
	if err == nil {
		t.Fatal("持续失败应返回错误")
	}
	if calls != mediaDownloadMaxAttempts {
		t.Fatalf("应尝试 %d 次，实际 %d", mediaDownloadMaxAttempts, calls)
	}
}

func TestRetryWithDownloadBackoffRespectsContextCancel(t *testing.T) {
	original := downloadJitter
	downloadJitter = func() time.Duration { return 0 }
	t.Cleanup(func() { downloadJitter = original })
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	err := retryWithDownloadBackoff(ctx, nil, func() error {
		calls++
		cancel() // 首次失败后立即取消，等待阶段应感知
		return errors.New("connection reset")
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("取消后应返回 context.Canceled: %v", err)
	}
	if calls != 1 {
		t.Fatalf("取消后不应继续尝试，实际 %d 次", calls)
	}
}

func TestRetryableDownloadErrorClassification(t *testing.T) {
	timeoutError := &timeoutNetError{}
	if !retryableDownloadError(timeoutError) {
		t.Fatal("网络超时应可重试")
	}
	if !retryableDownloadError(providerHTTPError{StatusCode: 502}) {
		t.Fatal("5xx 应可重试")
	}
	if !retryableDownloadError(providerHTTPError{StatusCode: http.StatusTooManyRequests}) {
		t.Fatal("429 应可重试")
	}
	if retryableDownloadError(providerHTTPError{StatusCode: 404}) {
		t.Fatal("404 不应重试")
	}
	if retryableDownloadError(errors.New("生成文件为空或超过大小限制")) {
		t.Fatal("确定性大小错误不应重试")
	}
	if retryableDownloadError(nil) {
		t.Fatal("nil 不应重试")
	}
	if retryableDownloadError(context.Canceled) {
		t.Fatal("上下文取消不应重试")
	}
}

type timeoutNetError struct{}

func (e *timeoutNetError) Error() string   { return "i/o timeout" }
func (e *timeoutNetError) Timeout() bool   { return true }
func (e *timeoutNetError) Temporary() bool { return false }
func (e *timeoutNetError) Deadline() (time.Time, bool) {
	return time.Time{}, false
}

// 编译期确认实现 net.Error。
var _ net.Error = (*timeoutNetError)(nil)
