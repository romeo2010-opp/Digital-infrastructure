#!/bin/bash

echo "Starting SmartLink development environment..."
# Start Database
echo "Starting Database"
(sudo /opt/lampp/lampp start) &

# Start frontend
echo "Starting Backend..."
(cd back-end && PUPPETEER_EXECUTABLE_PATH=/opt/google/chrome/chrome REPORT_PDF_ALLOW_PDFKIT_FALLBACK=false npm run dev) &

# Start frontend
echo "Starting Vite frontend..."
(cd front-end && npm run dev) &

# Start user-frontend
echo "Starting Vite frontend..."
(cd user-front-end && npm run dev) &

# Start frontend
echo "Starting Vite internal"
(cd internal && npm run dev) &

# Start kiosk
echo "Starting Kiosk frontend..."
(cd smartlink-kiosk && npm run dev) &
# Wait for processes
wait
