@echo off
title 系统已升级为「源起」
cd /d "%~dp0"
echo [提示] 系统名称已统一升级为「源起」(Genesis)。
echo 正在自动转入 启动源起.bat ...
call "%~dp0启动源起.bat"
