@echo off
title LinkFlow - Console
cd /d "%~dp0"

set "PY_CMD=%~dp0.venv\Scripts\python.exe"
if not exist "%PY_CMD%" set "PY_CMD=C:\ProgramData\Anaconda3\python.exe"
if not exist "%PY_CMD%" set "PY_CMD=python"

echo Starting LinkFlow server with console...
"%PY_CMD%" main.py

if errorlevel 1 (
    echo.
    echo ========================================================
    echo  Failed to start LinkFlow.
    echo  Please ensure Python is installed and accessible.
    echo ========================================================
    pause
)
