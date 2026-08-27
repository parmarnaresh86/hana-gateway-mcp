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
echo SAP_B1_REJECT_UNAUTHORIZED=true
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
echo This has also been saved to ADD_TO_RENDER.txt in this folder.
echo ============================================
echo.

:afterenv
echo Installing dependencies, this can take a minute...
echo (If HANA_HOST is set, this also builds the native "odbc" package -
echo  needs the SAP HANA ODBC driver and, on Windows, VS Build Tools/node-gyp.
echo  If it fails and you only need Service Layer, that's fine to ignore -
echo  the "odbc" package is optional.)
call npm install
if errorlevel 1 goto :installfail

echo.
echo Starting connector...
call .\start.bat

echo.
echo ============================================
echo   Setup complete.
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
