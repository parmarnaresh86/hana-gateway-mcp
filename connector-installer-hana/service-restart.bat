@echo off
cd /d "%~dp0"
call pm2 restart hana-connector
echo Connector service restarted.
pause
