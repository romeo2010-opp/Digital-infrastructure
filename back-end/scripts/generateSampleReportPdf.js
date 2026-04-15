import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { renderSmartLinkReportPdfBuffer } from "../src/modules/reports/pdf/reportRenderer.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function isoWithOffset(daysAgo = 0, minutesAgo = 0) {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setMinutes(date.getMinutes() - minutesAgo)
  return date.toISOString()
}

function buildSampleReportData() {
  const reconciliationRows = [
    {
      fuelType: "PETROL",
      tankName: "Tank A",
      opening: 8000,
      deliveries: 3000,
      closing: 5800,
      bookSales: 5200,
      recordedSales: 5050,
      varianceLitres: -150,
      variancePct: -2.88,
      attentionNeeded: true,
    },
    {
      fuelType: "DIESEL",
      tankName: "Tank B",
      opening: 10000,
      deliveries: 5000,
      closing: 10400,
      bookSales: 4600,
      recordedSales: 4620,
      varianceLitres: 20,
      variancePct: 0.43,
      attentionNeeded: false,
    },
  ]

  const salesByFuelTypeRows = [
    { fuelType: "PETROL", litres: 5200, revenue: 5720000, txCount: 210, avgPrice: 1100 },
    { fuelType: "DIESEL", litres: 4600, revenue: 6820000, txCount: 180, avgPrice: 1482.61 },
  ]

  const salesByDayRows = [
    { day: "2026-02-18", litres: 4300, revenue: 6120000, txCount: 170 },
    { day: "2026-02-19", litres: 5500, revenue: 6420000, txCount: 181 },
  ]

  const salesByPaymentRows = [
    { paymentMethod: "CASH", litres: 3900, revenue: 6500000, txCount: 145 },
    { paymentMethod: "MOBILE_MONEY", litres: 3150, revenue: 4750000, txCount: 118 },
    { paymentMethod: "SMARTLINK_WALLET", litres: 2750, revenue: 1290000, txCount: 127 },
  ]

  const pumpRows = [
    {
      pumpNumber: 1,
      fuelType: "PETROL",
      litres: 1200,
      expectedLitres: 1100,
      varianceLitres: 100,
      variancePct: 9.09,
      expectedRevenue: 1260000,
      revenue: 1380000,
      revenueVariance: 120000,
      txCount: 85,
      status: "ACTIVE",
      timesPaused: 2,
      timesOffline: 0,
    },
    {
      pumpNumber: 2,
      fuelType: "DIESEL",
      litres: 1050,
      expectedLitres: 1120,
      varianceLitres: -70,
      variancePct: -6.25,
      expectedRevenue: 1600000,
      revenue: 1540000,
      revenueVariance: -60000,
      txCount: 72,
      status: "PAUSED",
      timesPaused: 5,
      timesOffline: 1,
    },
    {
      pumpNumber: 3,
      fuelType: "PETROL",
      litres: 980,
      expectedLitres: null,
      varianceLitres: null,
      variancePct: null,
      expectedRevenue: null,
      revenue: 1090000,
      revenueVariance: null,
      txCount: 64,
      status: "IDLE",
      timesPaused: 1,
      timesOffline: 0,
    },
  ]

  const nozzleRows = [
    {
      pumpNumber: 1,
      nozzleNumber: 1,
      side: "A",
      fuelType: "PETROL",
      txCount: 47,
      litres: 640,
      revenue: 704000,
      status: "ACTIVE",
    },
    {
      pumpNumber: 1,
      nozzleNumber: 2,
      side: "B",
      fuelType: "PETROL",
      txCount: 38,
      litres: 560,
      revenue: 676000,
      status: "ACTIVE",
    },
    {
      pumpNumber: 2,
      nozzleNumber: 1,
      side: "A",
      fuelType: "DIESEL",
      txCount: 40,
      litres: 590,
      revenue: 888000,
      status: "PAUSED",
    },
    {
      pumpNumber: 3,
      nozzleNumber: 1,
      side: "A",
      fuelType: "PETROL",
      txCount: 22,
      litres: 390,
      revenue: 429000,
      status: "OFFLINE",
    },
  ]

  const inventoryMovementRows = Array.from({ length: 28 }, (_, index) => ({
    time: isoWithOffset(0, index * 17),
    eventType: index % 3 === 0 ? "Delivery" : index % 2 === 0 ? "Opening" : "Closing",
    tankName: index % 2 === 0 ? "Tank A" : "Tank B",
    litres: 900 + index * 12,
    recordedBy: index % 2 === 0 ? "John Banda" : "Supervisor",
  }))

  const incidentRows = Array.from({ length: 10 }, (_, index) => ({
    createdAt: isoWithOffset(0, index * 41),
    severity: index % 2 === 0 ? "MEDIUM" : "LOW",
    category: index % 2 === 0 ? "PUMP" : "QUEUE",
    title: `Operational incident ${index + 1}`,
    status: index % 3 === 0 ? "OPEN" : "RESOLVED",
  }))

  const auditTrailRows = Array.from({ length: 95 }, (_, index) => ({
    createdAt: isoWithOffset(0, index * 9),
    actor: index % 2 === 0 ? "John Banda" : "System",
    actionType: index % 4 === 0 ? "TRANSACTION_CREATE" : "PUMP_STATUS_UPDATE",
    details: index % 4 === 0 ? `Transaction recorded for Pump ${1 + (index % 3)}` : `Status changed on Pump ${1 + (index % 3)}`,
  }))

  const noteRows = [
    { createdAt: isoWithOffset(0, 25), author: "John Banda", text: "Peak period started at noon with moderate queue buildup." },
    { createdAt: isoWithOffset(0, 10), author: "Shift Supervisor", text: "Pump 2 had brief pause due to maintenance check." },
  ]

  return {
    header: {
      stationName: "Total Filling Station",
      stationPublicId: "SL-2026-02-20-001",
      location: "Lilongwe",
      timezone: "Africa/Blantyre",
      reportType: "Daily",
      fromDate: "2026-02-20",
      toDate: "2026-02-20",
      generatedAt: isoWithOffset(0, 0),
      generatedBy: "John Banda",
      currencyCode: "MWK",
    },
    kpis: {
      totalRevenue: 12540000,
      totalLitresSold: 18240,
      totalTransactions: 432,
      weightedAvgPricePerLitre: 687.5,
      bookSales: 9800,
      recordedSales: 9670,
      varianceLitres: -130,
      variancePct: -1.33,
    },
    sections: {
      reconciliationRows,
      salesByFuelTypeRows,
      salesByDayRows,
      salesByPaymentRows,
      salesTargets: {
        byFuelType: {
          PETROL: { litresTarget: 5000, revenueTarget: 5500000 },
          DIESEL: { litresTarget: 4800, revenueTarget: 7000000 },
        },
        byDay: {
          "2026-02-18": { litresTarget: 4500, revenueTarget: 6000000 },
          "2026-02-19": { litresTarget: 5300, revenueTarget: 6500000 },
        },
        byPaymentMethod: {
          CASH: { litresTarget: 4100, revenueTarget: 6400000 },
          MOBILE_MONEY: { litresTarget: 3200, revenueTarget: 5000000 },
          SMARTLINK_WALLET: { litresTarget: 2500, revenueTarget: 1200000 },
        },
      },
      pumpRows,
      nozzleRows,
      queueEnabled: true,
      queueMetrics: {
        servedCount: 308,
        noShowCount: 12,
        noShowRate: 3.9,
        callsMade: 326,
        peakQueueLength: 19,
        avgWaitMin: 8,
      },
      inventoryMovementRows,
      incidentRows,
      includeAuditTrail: true,
      auditTrailRows,
      noteRows,
      signOff: {
        preparedBy: "John Banda",
        reviewedBy: "________________",
      },
    },
    rowCounts: {
      reconciliation: reconciliationRows.length,
      salesByFuelType: salesByFuelTypeRows.length,
      salesByDay: salesByDayRows.length,
      salesByPayment: salesByPaymentRows.length,
      pumps: pumpRows.length,
      nozzles: nozzleRows.length,
      queue: 1,
      inventoryMovement: inventoryMovementRows.length,
      incidents: incidentRows.length,
      auditTrail: auditTrailRows.length,
      managerNotes: noteRows.length,
    },
    totalRowCount: 0,
    legacySummary: {},
  }
}

async function main() {
  const outputArg = process.argv[2]
  const outputPath = outputArg
    ? path.resolve(process.cwd(), outputArg)
    : path.resolve(__dirname, "../tmp/sample-smartlink-report.pdf")

  const reportData = buildSampleReportData()
  reportData.totalRowCount = Object.values(reportData.rowCounts).reduce((sum, value) => sum + Number(value || 0), 0)

  const pdfBuffer = await renderSmartLinkReportPdfBuffer(reportData)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, pdfBuffer)

  // eslint-disable-next-line no-console
  console.log(`Sample report PDF written to: ${outputPath}`)
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to generate sample report PDF:", error?.message || error)
  process.exitCode = 1
})
