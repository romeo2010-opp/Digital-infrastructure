/**
 * Mock in-memory service for Station Reports.
 * TODO: Replace store mutations with API calls when backend endpoints are available.
 */

const NETWORK_DELAY_MS = 160

const nowIso = () => new Date().toISOString()
const clone = (value) => JSON.parse(JSON.stringify(value))

function wait() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, NETWORK_DELAY_MS)
  })
}

const store = {
  reportRun: { id: "RUN-2001", createdAt: nowIso(), status: "DRAFT" },
  kpis: {
    totalLitres: 18240,
    revenue: 36510000,
    transactions: 943,
    avgPricePerLitre: 2001,
    variancePct: 1.8,
    queueNoShowRate: 4.2,
  },
  sales: {
    trendDaily: [
      { label: "06:00", value: 1800 },
      { label: "08:00", value: 3200 },
      { label: "10:00", value: 4100 },
      { label: "12:00", value: 5200 },
      { label: "14:00", value: 4400 },
      { label: "16:00", value: 3900 },
    ],
    trendByPump: [
      { label: "Pump 1", value: 5600 },
      { label: "Pump 2", value: 4300 },
      { label: "Pump 3", value: 3800 },
      { label: "Pump 4", value: 4540 },
    ],
    breakdown: [
      { fuelType: "Petrol", litres: 11250, revenue: 22660000, transactions: 601 },
      { fuelType: "Diesel", litres: 6990, revenue: 13850000, transactions: 342 },
    ],
  },
  reconciliation: [
    {
      id: "REC-1",
      tank: "Tank 1 (Petrol)",
      opening: 12000,
      deliveries: 6000,
      closing: 5600,
      expected: 12400,
      actual: 12310,
      variance: -90,
      varianceReason: "Meter rounding",
      varianceNote: "",
    },
    {
      id: "REC-2",
      tank: "Tank 2 (Diesel)",
      opening: 10500,
      deliveries: 4000,
      closing: 7000,
      expected: 7500,
      actual: 7360,
      variance: -140,
      varianceReason: "",
      varianceNote: "",
    },
  ],
  pumps: [
    { pumpId: "P1", fuelType: "Petrol", uptimePct: 96.3, litresDispensed: 5200, revenue: 10430000, avgTransactionTimeSec: 74 },
    { pumpId: "P2", fuelType: "Diesel", uptimePct: 92.1, litresDispensed: 4300, revenue: 8600000, avgTransactionTimeSec: 81 },
    { pumpId: "P3", fuelType: "Petrol", uptimePct: 88.6, litresDispensed: 3010, revenue: 6020000, avgTransactionTimeSec: 89 },
    { pumpId: "P4", fuelType: "Diesel", uptimePct: 94.7, litresDispensed: 5730, revenue: 11500000, avgTransactionTimeSec: 77 },
  ],
  queue: {
    enabled: true,
    stats: { avgWaitMin: 9.2, noShowRate: 4.2, served: 308, joined: 326 },
    hourly: [
      { hour: "06:00", joined: 18, served: 17, noShow: 1, avgWaitMin: 7.1 },
      { hour: "08:00", joined: 41, served: 39, noShow: 2, avgWaitMin: 8.9 },
      { hour: "10:00", joined: 66, served: 63, noShow: 3, avgWaitMin: 9.6 },
      { hour: "12:00", joined: 72, served: 67, noShow: 5, avgWaitMin: 11.1 },
      { hour: "14:00", joined: 58, served: 55, noShow: 3, avgWaitMin: 9.8 },
    ],
  },
  settlements: {
    summary: {
      settlementCount: 14,
      settlementValue: 248000,
      pendingCount: 5,
      pendingValue: 86000,
      paidCount: 6,
    },
    items: [
      {
        publicId: "01HQWQCS27MBE3W9MEFSV5P4S1",
        sourceReference: "SET-20260311-0012",
        batchDate: "2026-03-11",
        status: "PENDING",
        grossAmount: 42000,
        feeAmount: 210,
        netAmount: 41790,
        reservationPublicId: "RSV-QUE-20260311081000-Q7R1F2",
        sourceTransactionReference: "WLTX-WRP-20260311-0012",
        userPublicId: "01HQWQAZF8H2R2X6FG7F8N4C9T",
        userName: "Kelvin Banda",
        userPhone: "+265999111222",
        requestedLitres: 21,
        fuelCode: "PETROL",
        forecourtTransactionPublicId: "TXN-PAY-20260311091235012-A3D7K1",
        forecourtPaymentMethod: "OTHER",
        forecourtOccurredAt: nowIso(),
        createdAt: nowIso(),
      },
      {
        publicId: "01HQWQF2AFQ3S9WS2M7NE8H5HF",
        sourceReference: "SET-20260311-0011",
        batchDate: "2026-03-11",
        status: "PAID",
        grossAmount: 31500,
        feeAmount: 157.5,
        netAmount: 31342.5,
        reservationPublicId: "RSV-QUE-20260311073000-P2D5J4",
        sourceTransactionReference: "WLTX-WRP-20260311-0011",
        userPublicId: "01HQWQB7GM1M02EJ7Q9Y2V9N0P",
        userName: "Rita Phiri",
        userPhone: "+265998123456",
        requestedLitres: 15.7,
        fuelCode: "DIESEL",
        forecourtTransactionPublicId: "TXN-PAY-20260311090114009-B9M4T2",
        forecourtPaymentMethod: "OTHER",
        forecourtOccurredAt: nowIso(),
        createdAt: nowIso(),
      },
    ],
  },
  audit: [
    { id: "AUD-1", timestamp: nowIso(), actor: "Manager", actionType: "GENERATE_REPORT", summary: "Daily report generated" },
    { id: "AUD-2", timestamp: nowIso(), actor: "Supervisor", actionType: "READING_ADDED", summary: "Opening reading added for Tank 1" },
  ],
  incidents: [
    { id: "INC-1", createdAt: nowIso(), severity: "MEDIUM", title: "Pump 2 intermittent timeout", status: "OPEN" },
    { id: "INC-2", createdAt: nowIso(), severity: "LOW", title: "Queue signage mismatch", status: "OPEN" },
  ],
  notes: [
    { id: "NOTE-1", text: "Morning shift had peak at noon due to tanker delay.", createdAt: nowIso(), author: "Manager" },
  ],
  demandAnomaly: {
    generatedAt: nowIso(),
    window: "15m",
    methods: {
      warningZ: 2.5,
      criticalZ: 3.5,
      ewmaAlpha: 0.2,
      cusumEnabled: false,
      cusumThreshold: 5,
      persistenceMinutes: 10,
    },
    metrics: [
      {
        fuelType: "PETROL",
        salesVelocityLph: 640.2,
        txRateTph: 22.1,
        expectedMeanLph: 420.4,
        expectedStdLph: 71.8,
        expectedMeanTph: 14.2,
        expectedStdTph: 3.1,
        zScore: 3.06,
        txZScore: 2.55,
        ewmaValue: 511.2,
        ewmaBaseline: 448.2,
        ewmaShiftScore: 2.68,
        cusumValue: null,
        cusumScore: 0,
        severity: "WARNING",
        detectionScore: 3.06,
        baselineSource: "7d_hourly",
        baselineCount: 7,
        rulesTriggered: ["z_score_velocity", "ewma_shift"],
        persistencePending: false,
        pendingSince: null,
        activeEventId: 1,
        lastObservedAt: nowIso(),
      },
      {
        fuelType: "DIESEL",
        salesVelocityLph: 270.3,
        txRateTph: 9.4,
        expectedMeanLph: 260.1,
        expectedStdLph: 53.6,
        expectedMeanTph: 8.9,
        expectedStdTph: 2.7,
        zScore: 0.19,
        txZScore: 0.18,
        ewmaValue: 266.4,
        ewmaBaseline: 262.1,
        ewmaShiftScore: 0.08,
        cusumValue: null,
        cusumScore: 0,
        severity: "NONE",
        detectionScore: 0.19,
        baselineSource: "7d_hourly",
        baselineCount: 7,
        rulesTriggered: [],
        persistencePending: false,
        pendingSince: null,
        activeEventId: null,
        lastObservedAt: nowIso(),
      },
    ],
    events: [
      {
        id: 1,
        fuelType: "PETROL",
        severity: "WARNING",
        startTime: nowIso(),
        endTime: null,
        currentVelocity: 640.2,
        expectedMean: 420.4,
        expectedStd: 71.8,
        zScore: 3.06,
        ewmaValue: 511.2,
        cusumValue: null,
        rulesTriggered: ["z_score_velocity", "ewma_shift"],
        createdAt: nowIso(),
      },
    ],
  },
}

function appendAudit(actionType, summary) {
  store.audit.unshift({
    id: `AUD-${Date.now()}`,
    timestamp: nowIso(),
    actor: "Manager",
    actionType,
    summary,
  })
}

function makeSnapshot() {
  return clone({
    reportRun: store.reportRun,
    kpis: store.kpis,
    sales: store.sales,
    reconciliation: store.reconciliation,
    pumps: store.pumps,
    queue: store.queue,
    settlements: store.settlements,
    audit: store.audit,
    incidents: store.incidents,
    notes: store.notes,
    demandAnomaly: store.demandAnomaly,
  })
}

export const reportsService = {
  async getReportSnapshot(filters) {
    await wait()
    // TODO: Send filters to backend query params once API is available.
    appendAudit("SNAPSHOT_REFRESH", `Snapshot refreshed (${filters?.shift || "ALL"} shift)`)
    return makeSnapshot()
  },

  async generateReport(filters) {
    await wait()
    store.reportRun = {
      id: `RUN-${Date.now()}`,
      createdAt: nowIso(),
      status: "DRAFT",
    }
    appendAudit("GENERATE_REPORT", `Generated report ${store.reportRun.id} (${filters?.preset || "CUSTOM"})`)
    return clone(store.reportRun)
  },

  async exportCsv(section, filters) {
    await wait()
    appendAudit("EXPORT_CSV", `CSV export requested for ${section}`)
    return `mock://reports/${section}-${filters?.fromDate || "from"}-${Date.now()}.csv`
  },

  async exportPdf(filters, options = {}) {
    await wait()
    const includeAudit = options?.includeAudit !== false
    appendAudit("EXPORT_PDF", `PDF export requested${includeAudit ? " (with audit)" : " (without audit)"}`)
    return `mock://reports/report-${filters?.fromDate || "from"}-${Date.now()}.pdf`
  },

  async addDeliveryRecord(payload) {
    await wait()
    const row = store.reconciliation.find((item) => item.id === payload.rowId)
    if (row) {
      row.deliveries += Number(payload.deliveredLitres || 0)
      row.expected = row.opening + row.deliveries - row.closing
      row.variance = row.actual - row.expected
    }
    appendAudit("ADD_DELIVERY", `Delivery added to ${payload.rowId}`)
    return makeSnapshot()
  },

  async addOpeningClosingReadings(payload) {
    await wait()
    const row = store.reconciliation.find((item) => item.id === payload.rowId)
    if (row) {
      row.opening = Number(payload.opening || row.opening)
      row.closing = Number(payload.closing || row.closing)
      row.actual = Number(payload.actual || row.actual)
      row.expected = row.opening + row.deliveries - row.closing
      row.variance = row.actual - row.expected
    }
    appendAudit("ADD_READING", `Opening/closing readings updated for ${payload.rowId}`)
    return makeSnapshot()
  },

  async explainVariance(rowId, reason, note) {
    await wait()
    const row = store.reconciliation.find((item) => item.id === rowId)
    if (row) {
      row.varianceReason = reason
      row.varianceNote = note
    }
    appendAudit("EXPLAIN_VARIANCE", `Variance explained for ${rowId}`)
    return makeSnapshot()
  },

  async createIncident(payload) {
    await wait()
    store.incidents.unshift({
      id: `INC-${Date.now()}`,
      createdAt: nowIso(),
      severity: payload.severity || "LOW",
      title: payload.title || "Untitled incident",
      status: "OPEN",
    })
    appendAudit("CREATE_INCIDENT", `Incident created: ${payload.title || "Untitled"}`)
    return makeSnapshot()
  },

  async addNote(text) {
    await wait()
    store.notes.unshift({
      id: `NOTE-${Date.now()}`,
      text,
      createdAt: nowIso(),
      author: "Manager",
    })
    appendAudit("ADD_NOTE", "Draft note added")
    return makeSnapshot()
  },

  async finalizeReport(reportRunId) {
    await wait()
    if (store.reportRun.id === reportRunId) {
      store.reportRun.status = "FINAL"
    }
    appendAudit("FINALIZE_REPORT", `Report finalized: ${reportRunId}`)
    return clone(store.reportRun)
  },
  async getDemandMetrics({ window = "15m" } = {}) {
    await wait()
    store.demandAnomaly.window = window
    store.demandAnomaly.generatedAt = nowIso()
    return clone({
      generatedAt: store.demandAnomaly.generatedAt,
      window: store.demandAnomaly.window,
      methods: store.demandAnomaly.methods,
      metrics: store.demandAnomaly.metrics,
    })
  },
  async getDemandAnomalies() {
    await wait()
    return clone({
      items: store.demandAnomaly.events,
    })
  },
}
