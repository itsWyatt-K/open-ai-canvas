@echo off
title 源起 (Genesis) 创作工作台启动排障控制台
cd /d "%~dp0"

REM 本地服务绕开代理
set "HTTP_PROXY="
set "HTTPS_PROXY="
set "http_proxy="
set "https_proxy="
set "ALL_PROXY="
set "all_proxy="
set "NO_PROXY=*"

REM ====================================================================
REM  日常使用推荐：双击  启动源起.vbs  （静默无黑框）
REM  本 .bat 适合排障与查看详细实时日志输出
REM ====================================================================

set "PY=C:\Users\khy\.workbuddy\binaries\python\versions\3.13.12\python.exe"
if not exist "%PY%" (
  echo [ERROR] 找不到 Python 解释器: %PY%
  pause
  exit /b 1
)

echo ===================================================
echo   源起 (Genesis) 智能创作工作台 · 正在拉起服务...
echo   主力 Agent 模型: gemini-3.8-Flash
echo ===================================================
echo.
echo [1/2] 正在启动源起控制台中心...
start "Genesis Console" "%PY%" "%~dp0yuanqi_console.py"

echo [2/2] 等待控制面板端口 17580 就绪...
set TRY=0
:WAIT
timeout /t 2 >nul
set /a TRY+=1
netstat -ano | findstr ":17580" | findstr "LISTENING" >nul
if %errorlevel%==0 goto READY
if %TRY% GEQ 15 goto FAIL
echo       等待端口监听中... (%TRY%/15)
goto WAIT

:FAIL
echo.
echo [超时] 控制面板未在预期时间内就绪。
echo 请检查 backend.log 或控制台输出。
pause
exit /b 1

:READY
echo.
echo [OK] 源起控制台已就绪：http://127.0.0.1:17580/
echo [OK] 工作台访问网址：http://127.0.0.1:3000/
echo.
echo 提示：现在可以关闭本排障窗口，后台服务将平稳保持运行。
echo 如需彻底停止服务，可运行  停止源起.bat  或在面板点击「全部停止」。
echo.
timeout /t 5 >nul
exit /b 0
