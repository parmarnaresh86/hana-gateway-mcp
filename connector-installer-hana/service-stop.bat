@echo off
cd /d "%~dp0"
call pm2 stop hana-connector
echo Connector service stopped (still registered - it will resume at next reboot unless you also run service-uninstall.bat).
pause
