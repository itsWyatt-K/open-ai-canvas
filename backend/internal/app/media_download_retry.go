package app

import (
	"context"
	"errors"
	"math/rand/v2"
	"net"
	"net/http"
	"strings"
	"time"
)

// 结果媒体下载（协议结果、媒体恢复）共用的带抖动指数退避。
//
// 背景（返工令 B 遗留 4）：上游 CDN（如 download.xmimage2.cc.cd）可用性不稳，
// 固定间隔的 3 次重试只能"侥幸救回且耗时数分钟"。这里统一为
// 5 次尝试、1s→2s→4s→8s 指数退避并叠加 0~1s 抖动，避免重试风暴，
// 全程尊重 context 取消。

// mediaDownloadMaxAttempts 单次下载动作的最大尝试次数（含首次）。
const mediaDownloadMaxAttempts = 5

// downloadJitter 可注入的抖动源（测试桩固定为 0）。
var downloadJitter = func() time.Duration {
	return time.Duration(rand.Int64N(int64(time.Second)))
}

// mediaDownloadBackoffDelay 第 attempt 次失败后的等待时长：
// base = 1s << min(attempt,3)，叠加 [0,1s) 抖动，封顶 9s。
func mediaDownloadBackoffDelay(attempt int) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	shift := attempt
	if shift > 3 {
		shift = 3 // 1s→2s→4s→8s 后封顶
	}
	delay := time.Duration(1<<uint(shift)) * time.Second
	return delay + downloadJitter()
}

// retryableDownloadError 判定下载失败是否值得重试：
// 网络层瞬时错误、429/5xx 网关类响应可重试；取消/超时上下文、4xx 客户端错误不重试。
func retryableDownloadError(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) {
		return false
	}
	var networkError net.Error
	if errors.As(err, &networkError) && (networkError.Timeout() || networkError.Temporary()) {
		return true
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		if httpErr.StatusCode == http.StatusTooManyRequests {
			return true
		}
		return httpErr.StatusCode >= http.StatusInternalServerError
	}
	message := strings.ToLower(err.Error())
	for _, marker := range []string{
		"tls handshake timeout", "connection reset", "unexpected eof", "broken pipe",
		"connection refused", "proxy error", "no such host", "network is unreachable",
	} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

// retryWithDownloadBackoff 以指数退避驱动 once，直到成功、不可重试、
// 次数用尽或 ctx 结束。retryable 为 nil 时使用 retryableDownloadError。
func retryWithDownloadBackoff(ctx context.Context, retryable func(error) bool, once func() error) error {
	if retryable == nil {
		retryable = retryableDownloadError
	}
	var err error
	for attempt := 0; attempt < mediaDownloadMaxAttempts; attempt++ {
		err = once()
		if err == nil {
			return nil
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return err
		}
		if attempt == mediaDownloadMaxAttempts-1 || !retryable(err) {
			return err
		}
		if waitErr := sleepContext(ctx, mediaDownloadBackoffDelay(attempt)); waitErr != nil {
			return waitErr
		}
	}
	return err
}
