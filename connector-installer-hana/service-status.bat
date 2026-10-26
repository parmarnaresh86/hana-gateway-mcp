@echo off
cd /d "%~dp0"
echo Connector service status:
call pm2 status
echo.
echo Recent logs (last 40 lines, Ctrl+C to exit live view):
call pm2 logs hana-connector --lines 40
