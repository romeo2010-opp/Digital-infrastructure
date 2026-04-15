# Manual Test: Reports Export

## Prerequisites
- Backend running: `npm run dev`
- Valid JWT access token from `/auth/login`
- Station public id (example): `01STATIONABC1234567890123`

## CSV Export

```bash
curl -L -G "http://localhost:4000/api/stations/01STATIONABC1234567890123/reports/export/csv" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  --data-urlencode "from=2026-02-14" \
  --data-urlencode "to=2026-02-14" \
  --data-urlencode "section=sales" \
  --data-urlencode "fuelType=ALL" \
  -o sales_export.csv
```

Expected:
- HTTP `200`
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; ... .csv`
- File saved as CSV

## PDF Export

```bash
curl -L -G "http://localhost:4000/api/stations/01STATIONABC1234567890123/reports/export/pdf" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  --data-urlencode "from=2026-02-14" \
  --data-urlencode "to=2026-02-14" \
  --data-urlencode "fuelType=ALL" \
  -o station_report.pdf
```

Expected:
- HTTP `200`
- `Content-Type: application/pdf`
- `Content-Disposition: attachment; ... .pdf`
- File saved as PDF

## Verify Audit Trail

```bash
curl -L -G "http://localhost:4000/api/stations/01STATIONABC1234567890123/audit" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  --data-urlencode "from=2026-02-14" \
  --data-urlencode "to=2026-02-14" \
  --data-urlencode "actionType=REPORT_EXPORT_CSV"
```

Use `actionType=REPORT_EXPORT_PDF` for PDF checks.

## Windows Dev Notes
- This implementation uses `pdfkit` (pure Node), no Chrome or Puppeteer dependency required.
- Install deps after pulling changes:
  - `cd back-end`
  - `npm install`
