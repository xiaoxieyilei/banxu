@echo off
setlocal
set BANXU_HOST=0.0.0.0
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-windows.ps1"
if errorlevel 1 pause
