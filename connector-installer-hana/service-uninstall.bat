@echo off
cd /d "%~dp0"
echo This removes the connector from Windows auto-start and stops it.
echo (If this fails, right-click this file and choose "Run as administrator".)
echo.
call pm2 delete hana-connector
call pm2 save
call pm2-startup uninstall
echo.
echo Done. The connector will no longer start automatically at boot.
echo To run it again manually: start.bat  (or re-run install.bat for auto-start again)
pause
