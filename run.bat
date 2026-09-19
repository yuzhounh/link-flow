@echo off
chcp 65001 > nul
title LinkFlow - 私人文件传输助手

cd /d "%~dp0"

echo 正在启动 LinkFlow 局域网私人传输助手...
echo =======================================================

python main.py

if errorlevel 1 (
    echo.
    echo 启动失败，请检查 Python 是否已正确配置在环境变量中。
    pause
)
