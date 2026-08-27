@echo off
cd /d "%~dp0"

if not exist connector.pid goto :dostart

set /p OLDPID=<connector.pid
tasklist /FI "PID eq %OLDPID%" 2>nul | find "%OLDPID%" >nul
if errorlevel 1 goto :dostart

echo Connector already running with PID %OLDPID%. Run stop.bat first if you want to restart it.
exit /b 1

:dostart
powershell -NoProfile -Command "$p = Start-Process -FilePath 'node' -ArgumentList 'agent.js' -WindowStyle Hidden -PassThru -RedirectStandardOutput 'agent.log' -RedirectStandardError 'agent.err.log'; $p.Id | Out-File -Encoding ascii 'connector.pid'"

echo HANA Gateway connector started in the background.
echo Logs: agent.log and agent.err.log
echo Stop with: stop.bat
