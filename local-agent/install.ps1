$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Test-CommandExists($name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-CommandExists "node")) {
  Write-Host "Node.js is not installed. Please install Node.js 18+ from https://nodejs.org and re-run this script." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".env")) {
  Write-Host "Setting up .env..."
  $RenderUrl = Read-Host "Render URL (e.g. wss://your-app.onrender.com/agent)"
  $ConnectorId = Read-Host "Connector ID (e.g. wms-dev-uk)"
  $ConnectorToken = Read-Host "Connector Token"

  Write-Host "--- HANA (ODBC) - leave blank to skip ---"
  $HanaHost = Read-Host "HANA host"
  $HanaPort = Read-Host "HANA port [30015]"
  if ([string]::IsNullOrWhiteSpace($HanaPort)) { $HanaPort = "30015" }
  $HanaUser = Read-Host "HANA user"
  $HanaPassword = Read-Host "HANA password"
  $HanaDatabase = Read-Host "HANA tenant database (blank if not MDC)"

  Write-Host "--- SAP B1 Service Layer - leave blank to skip ---"
  $SlBaseUrl = Read-Host "Service Layer base URL, e.g. https://host:50000/b1s/v1"
  $SlCompany = Read-Host "Company DB"
  $SlUser = Read-Host "Service Layer user"
  $SlPassword = Read-Host "Service Layer password"

  @"
RENDER_URL=$RenderUrl
CONNECTOR_ID=$ConnectorId
CONNECTOR_TOKEN=$ConnectorToken

HANA_HOST=$HanaHost
HANA_PORT=$HanaPort
HANA_USER=$HanaUser
HANA_PASSWORD=$HanaPassword
HANA_DATABASE=$HanaDatabase
HANA_ENCRYPT=false
HANA_CONNECTION_STRING=

SAP_B1_BASE_URL=$SlBaseUrl
SAP_B1_COMPANY=$SlCompany
SAP_B1_USER=$SlUser
SAP_B1_PASSWORD=$SlPassword
SAP_B1_REJECT_UNAUTHORIZED=true
"@ | Out-File -FilePath ".env" -Encoding utf8

  Write-Host ".env written."
} else {
  Write-Host ".env already exists, skipping setup prompts."
}

Write-Host "Installing dependencies..."
npm install

if (-not (Test-CommandExists "pm2")) {
  Write-Host "Installing pm2 globally..."
  npm install -g pm2
}

pm2 start agent.js --name hana-connector
pm2 save

Write-Host ""
Write-Host "Done. The connector is running as a background service named 'hana-connector'." -ForegroundColor Green
Write-Host "Check status:  pm2 status"
Write-Host "View logs:     pm2 logs hana-connector"
Write-Host "Restart:       pm2 restart hana-connector"
Write-Host ""
Write-Host "For boot persistence on Windows, install pm2-windows-startup:"
Write-Host "  npm install -g pm2-windows-startup"
Write-Host "  pm2-startup install"
