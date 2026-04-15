function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatNumber(value, digits = 0) {
  const normalized = Number(value || 0)
  return normalized.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatMoney(value) {
  return `MWK ${formatNumber(value, 2)}`
}

function formatPercent(value) {
  return `${formatNumber(value, 1)}%`
}

function tableHtml({ title, columns, rows, emptyMessage = "No data available." }) {
  const bodyHtml = Array.isArray(rows) && rows.length
    ? rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(column.render(row))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}" class="is-empty">${escapeHtml(emptyMessage)}</td></tr>`

  return `
    <section class="report-section">
      <div class="section-header">
        <h2>${escapeHtml(title)}</h2>
      </div>
      <div class="table-shell">
        <table>
          <thead>
            <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("")}</tr>
          </thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>
    </section>
  `
}

export function buildAnalyticsPdfFooterTemplate(report) {
  return `
<div style="width:100%;padding:0 14mm;font-family:Segoe UI, Arial, sans-serif;font-size:8px;color:#475569;">
  <div style="display:flex;justify-content:space-between;align-items:center;width:100%;">
    <div>SmartLink Analytics Export</div>
    <div>${escapeHtml(report?.filters?.periodLabel || "")} | ${escapeHtml(report?.filters?.regionLabel || "")} | ${escapeHtml(report?.filters?.fuelLabel || "")}</div>
    <div>Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
  </div>
</div>`
}

export function renderAnalyticsExportHtml(report) {
  const summaryRows = [
    { label: "Generated", value: new Date(report.generatedAt).toLocaleString() },
    { label: "Period", value: report.filters.periodLabel },
    { label: "Region", value: report.filters.regionLabel },
    { label: "Fuel Type", value: report.filters.fuelLabel },
    { label: "Total Value", value: formatMoney(report.summary.totalValue) },
    { label: "Total Litres", value: formatNumber(report.summary.totalLitres) },
    { label: "Transactions", value: formatNumber(report.summary.transactionCount) },
    { label: "Best Station", value: report.summary.bestStation },
    { label: "Regional Leader", value: report.summary.regionalLeader },
    { label: "Previous Period Value", value: formatMoney(report.summary.previousValue) },
    { label: "Period Delta", value: formatPercent(report.summary.periodDeltaPct) },
  ]

  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <title>SmartLink Analytics Export</title>
      <style>
        @page {
          size: A4;
          margin: 16mm 14mm 22mm;
        }

        :root {
          color-scheme: light;
          --ink: #18324b;
          --muted: #5f738a;
          --line: #d8e3ef;
          --line-strong: #c4d3e3;
          --panel: #f7fafe;
          --panel-strong: #edf3f9;
          --brand: #245a8d;
        }

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          font-family: "Segoe UI", Arial, sans-serif;
          color: var(--ink);
          background: #ffffff;
          font-size: 11px;
          line-height: 1.4;
        }

        .report-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 18px;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 2px solid var(--line);
        }

        .report-header h1 {
          margin: 0 0 6px;
          font-size: 24px;
          letter-spacing: -0.03em;
          color: var(--brand);
        }

        .report-header p {
          margin: 0;
          color: var(--muted);
          font-size: 12px;
        }

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 18px;
        }

        .summary-card {
          border: 1px solid var(--line);
          border-radius: 12px;
          background: linear-gradient(180deg, #ffffff 0%, var(--panel) 100%);
          padding: 10px 12px;
          break-inside: avoid;
        }

        .summary-card span {
          display: block;
          margin-bottom: 4px;
          color: var(--muted);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .summary-card strong {
          font-size: 14px;
          color: var(--ink);
        }

        .report-section {
          margin-bottom: 18px;
          break-inside: avoid;
        }

        .section-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .section-header h2 {
          margin: 0;
          font-size: 14px;
          color: var(--brand);
        }

        .table-shell {
          border: 1px solid var(--line);
          border-radius: 14px;
          overflow: hidden;
          background: #ffffff;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }

        thead {
          display: table-header-group;
        }

        th,
        td {
          padding: 8px 10px;
          text-align: left;
          vertical-align: top;
          border-bottom: 1px solid var(--line);
          word-wrap: break-word;
        }

        th {
          background: var(--panel-strong);
          color: var(--brand);
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        tbody tr:nth-child(even) td {
          background: #fbfdff;
        }

        tbody tr:last-child td {
          border-bottom: none;
        }

        .is-empty {
          text-align: center;
          color: var(--muted);
          padding: 18px;
        }

        .two-column {
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
          gap: 16px;
        }
      </style>
    </head>
    <body>
      <header class="report-header">
        <div>
          <h1>SmartLink Analytics Export</h1>
          <p>Read-only intelligence report generated from the current internal analytics filters.</p>
        </div>
        <div>
          <p>${escapeHtml(report.filters.periodLabel)}</p>
          <p>${escapeHtml(report.filters.regionLabel)}</p>
          <p>${escapeHtml(report.filters.fuelLabel)}</p>
        </div>
      </header>

      <section class="report-section">
        <div class="summary-grid">
          ${summaryRows.map((item) => `
            <article class="summary-card">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
            </article>
          `).join("")}
        </div>
      </section>

      <div class="two-column">
        ${tableHtml({
          title: "Station Comparison",
          columns: [
            { label: "Station", render: (row) => row.stationName },
            { label: "Region", render: (row) => row.region },
            { label: "Transactions", render: (row) => formatNumber(row.transactionCount) },
            { label: "Litres", render: (row) => formatNumber(row.litresSold) },
            { label: "Value", render: (row) => formatMoney(row.transactionValue) },
          ],
          rows: report.stationRows,
        })}
        ${tableHtml({
          title: "Regional Analysis",
          columns: [
            { label: "City", render: (row) => row.city },
            { label: "Region", render: (row) => row.region },
            { label: "Stations", render: (row) => formatNumber(row.stationCount) },
            { label: "Litres", render: (row) => formatNumber(row.litresSold) },
            { label: "Value", render: (row) => formatMoney(row.transactionValue) },
          ],
          rows: report.regionalRows,
        })}
      </div>

      ${tableHtml({
        title: "Demand Trend",
        columns: [
          { label: "Date", render: (row) => row.activityDate },
          { label: "Transactions", render: (row) => formatNumber(row.transactionCount) },
          { label: "Litres", render: (row) => formatNumber(row.litresSold) },
          { label: "Value", render: (row) => formatMoney(row.transactionValue) },
        ],
        rows: report.trendRows,
      })}

      ${tableHtml({
        title: "Demand Forecast",
        columns: [
          { label: "Date", render: (row) => row.activityDate },
          { label: "Forecast Transactions", render: (row) => formatNumber(row.forecastTransactions) },
          { label: "Forecast Litres", render: (row) => formatNumber(row.forecastLitres) },
          { label: "Forecast Value", render: (row) => formatMoney(row.forecastValue) },
        ],
        rows: report.forecastRows,
      })}
    </body>
  </html>`
}
