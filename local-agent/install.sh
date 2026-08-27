#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Please install Node.js 18+ from https://nodejs.org and re-run this script."
  exit 1
fi

if [ ! -f .env ]; then
  echo "Setting up .env..."
  read -p "Render URL (e.g. wss://your-app.onrender.com/agent): " RENDER_URL
  read -p "Connector ID (e.g. wms-dev-uk): " CONNECTOR_ID
  read -p "Connector Token: " CONNECTOR_TOKEN

  echo "--- HANA (ODBC) - leave blank to skip ---"
  read -p "HANA host: " HANA_HOST
  read -p "HANA port [30015]: " HANA_PORT
  HANA_PORT=${HANA_PORT:-30015}
  read -p "HANA user: " HANA_USER
  read -p "HANA password: " HANA_PASSWORD
  read -p "HANA tenant database (blank if not MDC): " HANA_DATABASE

  echo "--- SAP B1 Service Layer - leave blank to skip ---"
  read -p "Service Layer base URL, e.g. https://host:50000/b1s/v1: " SAP_B1_BASE_URL
  read -p "Company DB: " SAP_B1_COMPANY
  read -p "Service Layer user: " SAP_B1_USER
  read -p "Service Layer password: " SAP_B1_PASSWORD

  cat > .env <<EOF
RENDER_URL=$RENDER_URL
CONNECTOR_ID=$CONNECTOR_ID
CONNECTOR_TOKEN=$CONNECTOR_TOKEN

HANA_HOST=$HANA_HOST
HANA_PORT=$HANA_PORT
HANA_USER=$HANA_USER
HANA_PASSWORD=$HANA_PASSWORD
HANA_DATABASE=$HANA_DATABASE
HANA_ENCRYPT=false
HANA_CONNECTION_STRING=

SAP_B1_BASE_URL=$SAP_B1_BASE_URL
SAP_B1_COMPANY=$SAP_B1_COMPANY
SAP_B1_USER=$SAP_B1_USER
SAP_B1_PASSWORD=$SAP_B1_PASSWORD
SAP_B1_REJECT_UNAUTHORIZED=true
EOF
  echo ".env written."
else
  echo ".env already exists, skipping setup prompts."
fi

echo "Installing dependencies..."
npm install

if ! command -v pm2 >/dev/null 2>&1; then
  echo "Installing pm2 globally..."
  npm install -g pm2
fi

pm2 start agent.js --name hana-connector
pm2 save

echo ""
echo "Done. The connector is running as a background service named 'hana-connector'."
echo "Check status:  pm2 status"
echo "View logs:     pm2 logs hana-connector"
echo "Restart:       pm2 restart hana-connector"
echo ""
echo "To make this survive a reboot, run: pm2 startup   (then follow the printed instructions)"
