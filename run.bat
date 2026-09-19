@echo off
title LinkFlow - Private Transfer Assistant
cd /d "%~dp0"

set "PY_CMD=python"
if exist "C:\ProgramData\Anaconda3\python.exe" (
    set "PY_CMD=C:\ProgramData\Anaconda3\python.exe"
)

echo Starting LinkFlow server...
"%PY_CMD%" main.py

if errorlevel 1 (
    echo.
    echo ========================================================
    echo  Failed to start LinkFlow.
    echo  Please ensure Python is installed and accessible.
    echo ========================================================
    pause
)
