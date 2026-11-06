@echo off
setlocal
echo ==========================================================
echo Compilation de WiFi Lab Guardian (WiFiLabGuardian.exe)
echo ==========================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-gui.ps1"

pause

