@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode

if exist .env goto :afterenv

echo ============================================
echo   HANA Gateway Connector - one-touch setup
echo ============================================
echo.

set RENDER_URL=wss://hana-gateway-mcp-server.onrender.com/agent
echo Render URL: %RENDER_URL%
echo.

set /p CONNECTOR_ID=Connector ID - a unique name for THIS pc, e.g. wms-dev-uk:

for /f "delims=" %%T in ('powershell -NoProfile -Command "$b=New-Object byte[] 32; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b); ([BitConverter]::ToString($b)).Replace('-','').ToLower()"') do set CONNECTOR_TOKEN=%%T
echo.
echo Generated a new Connector Token for this PC: %CONNECTOR_TOKEN%
echo.

echo This connector can serve HANA (via ODBC), SAP B1 Service Layer, or both.
echo Leave a block entirely blank (just press Enter through it) to skip it.
echo.

echo --- HANA (ODBC) ---
echo Requires the SAP HANA ODBC driver (HDBODBC) already installed on this PC.
set /p HANA_HOST=HANA host [blank to skip HANA]:
if "%HANA_HOST%"=="" goto :afterhana
set /p HANA_PORT=HANA port [30015]:
if "%HANA_PORT%"=="" set HANA_PORT=30015
set /p HANA_USER=HANA username:
set /p HANA_PASSWORD=HANA password:
set /p HANA_DATABASE=HANA tenant database name [blank if not MDC]:
:afterhana

echo.
echo --- SAP Business One Service Layer ---
set /p SAP_B1_BASE_URL=Service Layer base URL, e.g. https://host:50000/b1s/v1 [blank to skip]:
if "%SAP_B1_BASE_URL%"=="" goto :aftersl
set /p SAP_B1_COMPANY=Company DB name, e.g. WMS_DEV_UK:
set /p SAP_B1_USER=Service Layer username:
set /p SAP_B1_PASSWORD=Service Layer password:
set SAP_B1_REJECT_UNAUTHORIZED=true
set /p SELFSIGNED=Does Service Layer use a self-signed certificate? Y/N [Y]:
if /i not "%SELFSIGNED%"=="N" set SAP_B1_REJECT_UNAUTHORIZED=false
:aftersl

(
echo RENDER_URL=%RENDER_URL%
echo CONNECTOR_ID=%CONNECTOR_ID%
echo CONNECTOR_TOKEN=%CONNECTOR_TOKEN%
echo.
echo HANA_HOST=%HANA_HOST%
echo HANA_PORT=%HANA_PORT%
echo HANA_USER=%HANA_USER%
echo HANA_PASSWORD=%HANA_PASSWORD%
echo HANA_DATABASE=%HANA_DATABASE%
echo HANA_ENCRYPT=false
echo HANA_CONNECTION_STRING=
echo.
echo SAP_B1_BASE_URL=%SAP_B1_BASE_URL%
echo SAP_B1_COMPANY=%SAP_B1_COMPANY%
echo SAP_B1_USER=%SAP_B1_USER%
echo SAP_B1_PASSWORD=%SAP_B1_PASSWORD%
echo SAP_B1_REJECT_UNAUTHORIZED=%SAP_B1_REJECT_UNAUTHORIZED%
) > .env

(
echo Add this line to the CONNECTOR_TOKENS environment variable in the
echo Render dashboard for the hana-gateway-mcp-server service.
echo If CONNECTOR_TOKENS already has entries, append a comma then this:
echo.
echo %CONNECTOR_ID%:%CONNECTOR_TOKEN%
) > ADD_TO_RENDER.txt

echo.
echo .env written.
echo.
echo ============================================
echo   IMPORTANT - one manual step left
echo ============================================
echo This connector will not come online until you add this line to
echo CONNECTOR_TOKENS in the Render dashboard for hana-gateway-mcp-server:
echo.
echo   %CONNECTOR_ID%:%CONNECTOR_TOKEN%
echo.
echo This has also been saved to ADD_TO_RENDER.txt in this folder
echo (opening it in Notepad now).
echo ============================================
echo.
start "" notepad "%~dp0ADD_TO_RENDER.txt"

:afterenv
echo Installing dependencies, this can take a minute...
echo (This also tries to build the native "odbc" package for HANA - it
echo  needs the SAP HANA ODBC driver and, on Windows, VS Build Tools/node-gyp.
echo  If only that part fails and you only need Service Layer, it's fine -
echo  the "odbc" package is optional.)
call npm install
if errorlevel 1 goto :installfail

echo.
echo ============================================
echo   Run mode
echo ============================================
echo   1 = Background process only (simple; you must run start.bat
echo       again after every reboot or logoff)
echo   2 = Windows auto-start service (Recommended; survives reboot,
echo       uses pm2 - needs internet access once, to install pm2)
echo ============================================
set /p RUNMODE=Choose 1 or 2 [2]:
if "%RUNMODE%"=="" set RUNMODE=2
if "%RUNMODE%"=="1" goto :simplestart

echo.
echo Installing pm2 (process manager) globally...
call npm install -g pm2
if errorlevel 1 goto :pm2fail

echo Installing pm2-windows-startup (registers pm2 to launch at boot)...
call npm install -g pm2-windows-startup
if errorlevel 1 goto :pm2fail

echo.
echo Stopping any previous instance of this connector under pm2...
call pm2 delete hana-connector >nul 2>nul

echo Starting connector under pm2 as "hana-connector"...
call pm2 start agent.js --name hana-connector --cwd "%~dp0"
if errorlevel 1 goto :pm2fail

echo Saving the pm2 process list (so it is restored after reboot)...
call pm2 save
if errorlevel 1 goto :pm2fail

echo Registering pm2 to start automatically at Windows boot...
call pm2-startup install
if errorlevel 1 goto :pm2startupfail

echo.
echo ============================================
echo   Setup complete - running as an auto-start service.
echo   Status:   service-status.bat
echo   Stop:     service-stop.bat
echo   Restart:  service-restart.bat
echo   Uninstall auto-start:  service-uninstall.bat
echo ============================================
pause
exit /b 0

:simplestart
echo.
echo Starting connector as a plain background process...
call .\start.bat

echo.
echo ============================================
echo   Setup complete - background process mode.
echo   NOTE: this will NOT restart automatically after a reboot
echo   or logoff. Re-run start.bat manually, or re-run this
echo   installer and choose option 2 for auto-start.
echo   Check status:  type agent.log
echo   Stop:          stop.bat
echo   Start again:   start.bat
echo ============================================
pause
exit /b 0

:nonode
echo Node.js is not installed. Install it from https://nodejs.org (LTS version) and re-run this installer.
pause
exit /b 1

:installfail
echo npm install failed. Check your internet connection and re-run this installer.
pause
exit /b 1

:pm2fail
echo.
echo Could not install/start pm2. This usually means no internet access,
echo or npm global installs are blocked on this PC.
echo The connector is NOT running yet. You can start it right now as a
echo plain background process with start.bat, and re-run this installer
echo later once the pm2 install issue is resolved, to get auto-start.
pause
exit /b 1

:pm2startupfail
echo.
echo pm2 is running the connector right now, but registering it to start
echo automatically at boot failed - usually because this needs administrator
echo rights. Right-click install.bat and choose "Run as administrator", then
echo run it again (your .env is kept, so it will skip straight to this step).
pause
exit /b 1
