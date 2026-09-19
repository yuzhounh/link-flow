@echo off
title Stop LinkFlow
cd /d "%~dp0"

set "PY_CMD=python"
if exist "C:\ProgramData\Anaconda3\python.exe" (
    set "PY_CMD=C:\ProgramData\Anaconda3\python.exe"
)

"%PY_CMD%" server/stop.py
timeout /t 3 > nul
