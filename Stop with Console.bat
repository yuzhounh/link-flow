@echo off
title Stop LinkFlow - Console
cd /d "%~dp0"

set "PY_CMD=%~dp0.venv\Scripts\python.exe"
if not exist "%PY_CMD%" set "PY_CMD=C:\ProgramData\Anaconda3\python.exe"
if not exist "%PY_CMD%" set "PY_CMD=python"

"%PY_CMD%" server/stop.py
timeout /t 3 > nul
