# SmartLink Report PDF Manual Test

## Endpoint

`GET /api/stations/:stationPublicId/reports/export/pdf?from=YYYY-MM-DD&to=YYYY-MM-DD&fuelType=ALL|PETROL|DIESEL&includeAudit=true|false`

## Preconditions

1. Backend is running (`npm run dev` in `back-end/`).
2. Valid auth token for a user scoped to the station.
3. If using Puppeteer renderer, install dependency in backend:
   - `npm i puppeteer`
4. Renderer policy (recommended for new template only):
   - Keep fallback disabled (default): do **not** set `REPORT_PDF_ALLOW_PDFKIT_FALLBACK` or set it to `false`.
   - Optional fallback mode: `REPORT_PDF_ALLOW_PDFKIT_FALLBACK=true`.

## Download Example

```bash
curl -L \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "http://localhost:4000/api/stations/$STATION_PUBLIC_ID/reports/export/pdf?from=2026-02-01&to=2026-02-20&fuelType=ALL&includeAudit=true" \
  -o smartlink_report.pdf
```

## Generate A Local Sample PDF (No API Calls)

```bash
npm run report:sample-pdf
```

Optional custom output path:

```bash
node scripts/generateSampleReportPdf.js ./tmp/my-sample-report.pdf
```

Exclude audit trail from export:

```bash
curl -L \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "http://localhost:4000/api/stations/$STATION_PUBLIC_ID/reports/export/pdf?from=2026-02-01&to=2026-02-20&fuelType=ALL&includeAudit=false" \
  -o smartlink_report_no_audit.pdf
```

## Header Verification Example

```bash
curl -sS -D - -o /tmp/smartlink_report.pdf \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  "http://localhost:4000/api/stations/$STATION_PUBLIC_ID/reports/export/pdf?from=2026-02-01&to=2026-02-20&fuelType=PETROL"
```

Expected response headers include:

- `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="smartlink_<station>_report_<from>_to_<to>.pdf"`
- `Cache-Control: no-store`
- `X-Report-Renderer: puppeteer` (or `pdfkit-fallback` only if fallback explicitly enabled)

## Audit Verification

Run SQL and confirm a new row:

```sql
SELECT action_type, payload, created_at
FROM audit_log
WHERE station_id = <station_id>
  AND action_type = 'REPORT_EXPORT_PDF'
ORDER BY created_at DESC
LIMIT 5;
```

Payload should include:

- `station_id`
- `filters`
- `generated_by`
- `rowCounts` (per section)

## Validation Checklist

1. A4 layout with consistent margins.
2. No clipped or overlapping table content.
3. Numeric columns are right-aligned.
4. Long tables split across pages with repeated headers.
5. Missing values render as `Data missing`.
