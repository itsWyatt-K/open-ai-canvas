@echo off
title 停止源起 (Genesis) 全部服务
cd /d "%~dp0"

echo ============================================
echo   正在停止「源起」全部服务 (前端 + 后端 + 侧车 + 隧道)
echo ============================================
echo.

echo [1/5] 停止前端服务 (端口 3000) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo       结束进程 PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo [2/5] 停止后端服务 (端口 8080) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    echo       结束进程 PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
taskkill /F /IM canvas-backend.exe >nul 2>&1

echo [3/5] 停止 E-Reverse 侧车 (端口 8790) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8790" ^| findstr "LISTENING"') do (
    echo       结束进程 PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo [4/5] 停止公网隧道 (端口 20241) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":20241" ^| findstr "LISTENING"') do (
    echo       结束进程 PID %%a
    taskkill /F /PID %%a >nul 2>&1
)
taskkill /F /IM cloudflared.exe >nul 2>&1

echo [5/5] 停止控制面板 (端口 17580) ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":17580" ^| findstr "LISTENING"') do (
    echo       结束进程 PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo [OK] 「源起」全部服务已安全停止。
timeout /t 3 >nul
