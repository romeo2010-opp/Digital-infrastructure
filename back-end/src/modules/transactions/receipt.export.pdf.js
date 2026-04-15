import PDFDocument from "pdfkit"

const MM_TO_PT = 2.83465
const RECEIPT_WIDTH = 80 * MM_TO_PT
const HORIZONTAL_PADDING = 10
const SECTION_GAP = 10
const LINE_COLOR = "#d3d7db"
const BRAND_DARK = "#14332b"
const BRAND_ACCENT = "#1f7a4f"
const TEXT_MUTED = "#5d6b66"

function formatMoney(amount, currencyCode = "MWK") {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return `${currencyCode} -`
  const whole = Math.abs(numeric % 1) < 0.001
  return `${currencyCode} ${numeric.toLocaleString(undefined, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function formatDateTime(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Blantyre",
  })
}

function drawRule(doc, y) {
  doc
    .moveTo(HORIZONTAL_PADDING, y)
    .lineTo(RECEIPT_WIDTH - HORIZONTAL_PADDING, y)
    .lineWidth(0.7)
    .strokeColor(LINE_COLOR)
    .stroke()
}

function drawValueRow(doc, { y, label, value, emphasize = false }) {
  const width = RECEIPT_WIDTH - HORIZONTAL_PADDING * 2
  const labelWidth = width * 0.48
  const valueWidth = width - labelWidth
  const font = emphasize ? "Helvetica-Bold" : "Courier"
  const labelHeight = doc.heightOfString(label, { width: labelWidth })
  const valueHeight = doc.heightOfString(value, { width: valueWidth, align: "right" })
  const rowHeight = Math.max(labelHeight, valueHeight, 12)

  doc
    .fillColor(TEXT_MUTED)
    .font("Courier")
    .fontSize(8.6)
    .text(label, HORIZONTAL_PADDING, y, {
      width: labelWidth,
    })

  doc
    .fillColor(BRAND_DARK)
    .font(font)
    .fontSize(emphasize ? 9.6 : 8.8)
    .text(value, HORIZONTAL_PADDING + labelWidth, y, {
      width: valueWidth,
      align: "right",
    })

  return rowHeight + 3
}

function formatPromotionLineLabel(line, { includeFundingSource = false, includeStatus = false } = {}) {
  const parts = [
    String(line?.label || "").trim() || "-",
    String(line?.promotionKind || "-").trim() || "-",
  ]
  parts.push(String(line?.promotionValueLabel || "-").trim() || "-")
  if (includeStatus && line?.status) parts.push(String(line.status).trim())
  let label = parts.join(" - ")
  if (includeFundingSource && line?.fundingSource) {
    label = `${label} (${String(line.fundingSource).trim()})`
  }
  return label
}

function estimateReceiptHeight(receipt) {
  const baseRows = 18
  const discountRows = Array.isArray(receipt?.discountLines) ? receipt.discountLines.length : 0
  const cashbackRows = Array.isArray(receipt?.cashbackLines) ? receipt.cashbackLines.length : 0
  const promoRows = Array.isArray(receipt?.promoLabelsApplied) ? receipt.promoLabelsApplied.length : 0
  const dynamicRows = discountRows + cashbackRows + Math.min(promoRows, 4)
  return Math.max(360, 220 + (baseRows + dynamicRows) * 14)
}

export function streamFuelReceiptPdf({ res, receipt }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [RECEIPT_WIDTH, estimateReceiptHeight(receipt)],
      margin: 0,
      bufferPages: false,
      info: {
        Title: `SmartLink Fuel Receipt ${receipt?.transactionId || ""}`.trim(),
        Author: "SmartLink",
        Subject: "Fuel transaction receipt",
        Creator: "SmartLink",
      },
    })

    doc.on("error", reject)
    doc.on("end", resolve)
    doc.pipe(res)

    let y = 12
    const fullWidth = RECEIPT_WIDTH - HORIZONTAL_PADDING * 2

    doc
      .fillColor(BRAND_ACCENT)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("SMARTLINK", HORIZONTAL_PADDING, y, {
        width: fullWidth,
        align: "center",
        characterSpacing: 1.6,
      })
    y += 16

    doc
      .fillColor(BRAND_DARK)
      .font("Helvetica-Bold")
      .fontSize(12.5)
      .text(receipt?.title || "Fuel Receipt", HORIZONTAL_PADDING, y, {
        width: fullWidth,
        align: "center",
      })
    y += 14

    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(7.8)
      .text(receipt?.subtitle || "Verified transaction record", HORIZONTAL_PADDING, y, {
        width: fullWidth,
        align: "center",
      })
    y += 16

    drawRule(doc, y)
    y += 7

    const headerRows = [
      ["Station", receipt?.stationName || "-"],
      ["Location", receipt?.stationLocation || "-"],
      ["Transaction", receipt?.transactionId || "-"],
      ["Date/Time", formatDateTime(receipt?.occurredAt)],
      ["Pump", receipt?.pumpNumber ? `Pump ${receipt.pumpNumber}` : "-"],
      ["Nozzle", receipt?.nozzleLabel || "-"],
      ["Fuel", receipt?.fuelType || "-"],
      ["Litres", Number.isFinite(Number(receipt?.litres || 0)) ? `${Number(receipt.litres).toFixed(3)} L` : "-"],
      ["Unit Price", formatMoney(receipt?.unitPrice)],
      ["Base Subtotal", formatMoney(receipt?.baseSubtotal)],
    ]

    for (const [label, value] of headerRows) {
      y += drawValueRow(doc, { y, label, value })
    }

    if (Array.isArray(receipt?.discountLines) && receipt.discountLines.length) {
      y += 2
      drawRule(doc, y)
      y += 7
      doc
        .fillColor(BRAND_ACCENT)
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .text("DIRECT SAVINGS", HORIZONTAL_PADDING, y, { width: fullWidth })
      y += 12
      for (const line of receipt.discountLines) {
        y += drawValueRow(doc, {
          y,
          label: formatPromotionLineLabel(line, { includeFundingSource: true }),
          value: `-${formatMoney(line.amount)}`,
        })
      }
      y += drawValueRow(doc, {
        y,
        label: "Total Direct Discount",
        value: `-${formatMoney(receipt?.totalDirectDiscount)}`,
        emphasize: true,
      })
    }

    if (Array.isArray(receipt?.promoLabelsApplied) && receipt.promoLabelsApplied.length) {
      y += 2
      drawRule(doc, y)
      y += 7
      doc
        .fillColor(BRAND_ACCENT)
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .text("CAMPAIGNS", HORIZONTAL_PADDING, y, { width: fullWidth })
      y += 11
      for (const label of receipt.promoLabelsApplied.slice(0, 4)) {
        doc
          .fillColor(BRAND_DARK)
          .font("Courier")
          .fontSize(8.5)
          .text(`• ${label}`, HORIZONTAL_PADDING, y, { width: fullWidth })
        y += 11
      }
    }

    if (Array.isArray(receipt?.cashbackLines) && receipt.cashbackLines.length) {
      y += 2
      drawRule(doc, y)
      y += 7
      doc
        .fillColor(BRAND_ACCENT)
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .text("CASHBACK", HORIZONTAL_PADDING, y, { width: fullWidth })
      y += 12
      for (const line of receipt.cashbackLines) {
        y += drawValueRow(doc, {
          y,
          label: formatPromotionLineLabel(line, { includeStatus: true }),
          value: formatMoney(line.amount),
        })
      }
      y += drawValueRow(doc, {
        y,
        label: "Cashback Total",
        value: formatMoney(receipt?.cashbackTotal),
        emphasize: true,
      })
    }

    y += 2
    drawRule(doc, y)
    y += 8

    y += drawValueRow(doc, {
      y,
      label: "Payment Method",
      value: receipt?.paymentMethod || "OTHER",
    })
    if (receipt?.queueJoinId) {
      y += drawValueRow(doc, {
        y,
        label: "Queue ID",
        value: receipt.queueJoinId,
      })
    }
    if (receipt?.reservationId) {
      y += drawValueRow(doc, {
        y,
        label: "Reservation ID",
        value: receipt.reservationId,
      })
    }
    if (receipt?.paymentReference) {
      y += drawValueRow(doc, {
        y,
        label: "Payment Ref",
        value: receipt.paymentReference,
      })
    }

    y += 4
    doc
      .fillColor(BRAND_DARK)
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("TOTAL", HORIZONTAL_PADDING, y, {
        width: fullWidth * 0.45,
      })
    doc
      .fillColor(BRAND_DARK)
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(formatMoney(receipt?.finalAmountPaid), HORIZONTAL_PADDING + fullWidth * 0.45, y - 1, {
        width: fullWidth * 0.55,
        align: "right",
      })
    y += 18

    y += drawValueRow(doc, {
      y,
      label: "Effective Net Price/L",
      value: formatMoney(receipt?.effectivePricePerLitre),
      emphasize: true,
    })

    y += 4
    drawRule(doc, y)
    y += 8

    doc
      .fillColor(TEXT_MUTED)
      .font("Courier")
      .fontSize(7.7)
      .text(`Verification Ref: ${receipt?.verificationReference || "-"}`, HORIZONTAL_PADDING, y, {
        width: fullWidth,
      })
    y += 11
    doc
      .text(`Verify: ${receipt?.verificationUrl || "-"}`, HORIZONTAL_PADDING, y, {
        width: fullWidth,
      })
    y += 14

    doc
      .fillColor(TEXT_MUTED)
      .font("Helvetica")
      .fontSize(7.3)
      .text(
        "SmartLink fuel receipt. Preserve this record for disputes, reconciliation, and settlement reviews.",
        HORIZONTAL_PADDING,
        y,
        {
          width: fullWidth,
          align: "center",
        }
      )

    doc.end()
  })
}
