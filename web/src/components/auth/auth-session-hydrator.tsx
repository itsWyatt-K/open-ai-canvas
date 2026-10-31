import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { getAuthSession, type AuthSessionPayload } from "@/services/api/auth";
import { ApiError } from "@/services/api/request";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore } from "@/stores/use-user-store";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";

/**
 * 启动会话恢复的容错纪律（收官激活令修复）：
 * 只有服务端**真实返回 401**（HTTP 状态、业务 code 或 reason=unauthorized）才判定会话失效、
 * 降级匿名；网络超时/断网/502/503/504 一律不清除本地登录态——退避重试，重试耗尽后给出
 * 可手动重试的恢复界面（绝不去 applyUserSession(null)，避免重负载下编辑态被一次抖动清空）。
 */

const MAX_AUTO_RETRIES = 3;

function isRealAuthRejection(error: unknown) {
    if (!(error instanceof ApiError)) return false;
    return error.status === 401 || error.code === 401 || error.reason === "unauthorized";
}

function describeTransportFailure(error: unknown) {
    if (error instanceof ApiError) {
        if (error.status === 502 || error.status === 503 || error.status === 504) return `后端暂时不可用（HTTP ${error.status}）`;
        if (error.status !== undefined) return `服务异常（HTTP ${error.status}）`;
        return "网络连接异常（超时或断网）";
    }
    return error instanceof Error ? error.message : "未知错误";
}

export function AuthSessionHydrator({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);
    const [transportFailure, setTransportFailure] = useState<string | null>(null);
    const attemptRef = useRef(0);
    const cancelledRef = useRef(false);

    useEffect(() => {
        cancelledRef.current = false;
        const startedAt = performance.now();
        recordDiagnosticEvent({ category: "navigation", level: "info", code: "startup.auth_session_started", message: "开始恢复认证会话" });
        const run = async () => {
            try {
                const payload = await getAuthSession();
                if (cancelledRef.current) return;
                recordDiagnosticEvent({
                    category: "navigation",
                    level: "info",
                    code: "startup.auth_session_ready",
                    message: payload.user ? "认证会话已恢复" : "匿名会话已确认",
                    durationMs: performance.now() - startedAt,
                });
                if (!payload.user) {
                    await applyAnonymousSession(payload);
                    recordDiagnosticEvent({
                        category: "navigation",
                        level: "info",
                        code: "startup.anonymous_ready",
                        message: "匿名页面已解除启动阻塞",
                        durationMs: performance.now() - startedAt,
                    });
                    return;
                }
                // 账号数据、画布和素材持久化只属于已登录工作区，登录页不下载这些模块。
                const { applyUserSession } = await import("@/lib/user-session");
                if (cancelledRef.current) return;
                await applyUserSession(payload);
                setTransportFailure(null);
                attemptRef.current = 0;
                recordDiagnosticEvent({
                    category: "navigation",
                    level: "info",
                    code: "startup.workspace_ready",
                    message: "登录工作区已解除启动阻塞",
                    durationMs: performance.now() - startedAt,
                });
                preloadWorkspaceRoute(window.location.pathname);
            } catch (error) {
                if (cancelledRef.current) return;
                // 真实 401：会话确实失效，降级匿名（这是唯一允许清除登录态的路径）。
                if (isRealAuthRejection(error)) {
                    recordDiagnosticEvent({
                        category: "navigation",
                        level: "warning",
                        code: "startup.auth_session_rejected",
                        message: "服务端判定会话失效（HTTP 401），降级匿名",
                        durationMs: performance.now() - startedAt,
                    });
                    await applyAnonymousSession({ user: null });
                    return;
                }
                // 传输层失败（超时/断网/5xx）：不清登录态，退避重试；耗尽后给手动重试界面。
                const attempt = attemptRef.current + 1;
                attemptRef.current = attempt;
                const reason = describeTransportFailure(error);
                if (attempt <= MAX_AUTO_RETRIES) {
                    const delayMs = 800 * 2 ** (attempt - 1);
                    recordDiagnosticEvent({
                        category: "navigation",
                        level: "warning",
                        code: "startup.auth_session_transport_retry",
                        message: `${reason}；${delayMs}ms 后第 ${attempt}/${MAX_AUTO_RETRIES} 次重试（不清除本地登录态）`,
                        durationMs: performance.now() - startedAt,
                    });
                    setTransportFailure(`${reason}——正在自动重试（${attempt}/${MAX_AUTO_RETRIES}）`);
                    window.setTimeout(() => {
                        if (!cancelledRef.current) void run();
                    }, delayMs);
                    return;
                }
                setTransportFailure(reason);
                recordDiagnosticEvent({
                    category: "navigation",
                    level: "error",
                    code: "startup.auth_session_transport_exhausted",
                    message: `${reason}；自动重试已耗尽，保留本地登录态等待手动重试`,
                    durationMs: performance.now() - startedAt,
                });
            }
        };
        void run();
        return () => {
            cancelledRef.current = true;
        };
    }, []);

    if (transportFailure !== null) {
        return (
            <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center" data-yq="auth-session-retry">
                <p className="text-sm font-medium text-foreground/80">认证会话恢复失败：{transportFailure}</p>
                <p className="max-w-md text-caption leading-5 text-foreground/50">
                    本地登录态已保留（不会跳转登录页）。通常是后端暂不可用或网络抖动，请检查服务后点击重试。
                </p>
                <button
                    type="button"
                    className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                    onClick={() => {
                        attemptRef.current = 0;
                        setTransportFailure(null);
                        // 触发重新水合：卸载-重挂由 keyed 重渲染实现
                        window.location.reload();
                    }}
                >
                    重试恢复会话
                </button>
            </div>
        );
    }

    return hydrated ? children : <FullScreenLoader />;
}

async function applyAnonymousSession(payload: AuthSessionPayload) {
    const { applyUserSession } = await import("@/lib/user-session");
    await applyUserSession({ ...payload, user: null });
}
