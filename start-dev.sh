#!/bin/bash

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

start_service() {
  local name="$1"
  local dir="$2"
  local cmd="$3"

  echo "Starting $name..."
  if [ ! -d "$dir" ]; then
    echo "ERROR: directory not found: $dir"
    return 1
  fi

  (cd "$dir" && eval "$cmd") &
}

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is required but not installed."
  exit 1
fi

if command -v sudo >/dev/null 2>&1; then
  echo "Starting Database..."
  sudo /opt/lampp/lampp start
else
  echo "WARNING: sudo not available, skipping database start."
fi

start_service "SmartLink backend" "back-end" "PUPPETE_EXECUTABLE_PATH=/opt/google/chrome/chrome REPORT_PDF_ALLOW_PDFKIT_FALLBACK=false npm run dev"
start_service "Vite frontend" "front-end" "npm run dev"
start_service "User frontend" "user-front-end" "npm run dev"
start_service "MERA" "mera" "npm run dev"
start_service "Internal frontend" "internal" "npm run dev"
start_service "Kiosk frontend" "smartlink-kiosk" "npm run dev"
start_service "Smartlink-Schools server" "smartlink-schools/server" "npm run dev"
start_service "Smartlink-Schools client" "smartlink-schools/client" "npm run dev"

echo "All services started. Waiting for processes..."
wait
