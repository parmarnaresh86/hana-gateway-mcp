@echo off
cd /d "%~dp0"

if not exist connector.pid goto :notrunning

set /p CPID=<connector.pid
taskkill /PID %CPID% /F >nul 2>&1
del connector.pid
echo HANA Gateway connector stopped.
goto :eof

:notrunning
echo No running connector found - connector.pid is missing.
exit /b 1
