@echo off
REM  Right-click this file  ->  "Run as administrator".
REM  It points the Cloudflare tunnel at the Nook gateway (:8090), installs the
REM  gateway as an always-on service, verifies it, and restarts the tunnel.
title Nook - Go Live
echo Running go-live (this needs administrator rights)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0golive.ps1"
echo.
echo ============================ RESULT (golive.log) ============================
type "%~dp0golive.log" 2>nul
echo ============================================================================
echo.
echo Done. You can close this window.
pause
