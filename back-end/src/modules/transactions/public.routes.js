import { Router } from "express"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { ok } from "../../utils/http.js"
import { getReceiptVerificationPayload } from "./receipt.service.js"

const router = Router()

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

function renderVerificationHtml(payload) {
  const discountLines = Array.isArray(payload?.discountLines) ? payload.discountLines : []
  const cashbackLines = Array.isArray(payload?.cashbackLines) ? payload.cashbackLines : []
  const promoLabels = Array.isArray(payload?.pricing?.promoLabelsApplied) ? payload.pricing.promoLabelsApplied : []
  const listItems = [
    `Station: ${payload?.transaction?.stationName || "-"}`,
    `Location: ${payload?.transaction?.stationLocation || "-"}`,
    `Pump: ${payload?.transaction?.pumpNumber ? `Pump ${payload.transaction.pumpNumber}` : "-"}`,
    `Nozzle: ${payload?.transaction?.nozzleLabel || "-"}`,
    `Fuel: ${payload?.transaction?.fuelType || "-"}`,
    `Litres: ${payload?.transaction?.litres || "-"}`,
    `Paid: MWK ${Number(payload?.pricing?.finalAmountPaid || 0).toLocaleString()}`,
  ]

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>SmartLink Receipt Verification</title>
    <style>
      body { font-family: Arial, sans-serif; background: #eef4f8; color: #16324b; margin: 0; padding: 24px; }
      .card { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 20px; padding: 24px; box-shadow: 0 16px 36px rgba(15,23,42,0.08); }
      .eyebrow { color: #0f766e; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      h1 { margin: 8px 0 4px; font-size: 32px; }
      p { color: #597289; line-height: 1.5; }
      .status { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 999px; background: #e7f8ee; color: #146c43; font-weight: 700; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 12px; margin: 18px 0; }
      .tile { border: 1px solid #d7e4ef; border-radius: 16px; padding: 14px; background: #fbfdff; }
      .tile span { display: block; color: #64809a; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
      .tile strong { display: block; margin-top: 8px; font-size: 20px; }
      ul { margin: 16px 0 0; padding-left: 18px; color: #345068; }
      .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
      .chip { padding: 7px 10px; border-radius: 999px; background: #edf6ff; color: #1f557d; font-size: 12px; font-weight: 700; }
      .section { margin-top: 18px; }
      .section h2 { margin: 0 0 8px; font-size: 18px; }
      .line { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px dashed #d4dee8; }
      .line:last-child { border-bottom: none; }
      @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } body { padding: 16px; } .card { padding: 18px; } }
    </style>
  </head>
  <body>
    <main class="card">
      <span class="eyebrow">SmartLink Verification</span>
      <h1>Receipt Verified</h1>
      <p>This receipt reference is valid and matches a recorded SmartLink fuel transaction.</p>
      <div class="status">Verified reference: ${payload?.verificationReference || "-"}</div>
      <div class="grid">
        <article class="tile"><span>Transaction ID</span><strong>${payload?.transaction?.publicId || "-"}</strong></article>
        <article class="tile"><span>Occurred At</span><strong>${payload?.transaction?.occurredAt || "-"}</strong></article>
        <article class="tile"><span>Final Amount Paid</span><strong>MWK ${Number(payload?.pricing?.finalAmountPaid || 0).toLocaleString()}</strong></article>
        <article class="tile"><span>Cashback</span><strong>MWK ${Number(payload?.pricing?.cashbackTotal || 0).toLocaleString()}</strong></article>
      </div>
      <ul>${listItems.map((item) => `<li>${item}</li>`).join("")}</ul>
      ${promoLabels.length ? `<div class="chips">${promoLabels.map((item) => `<span class="chip">${item}</span>`).join("")}</div>` : ""}
      ${discountLines.length ? `<section class="section"><h2>Discount Breakdown</h2>${discountLines.map((line) => `<div class="line"><span>${formatPromotionLineLabel(line, { includeFundingSource: true })}</span><strong>MWK ${Number(line.amount || 0).toLocaleString()}</strong></div>`).join("")}</section>` : ""}
      ${cashbackLines.length ? `<section class="section"><h2>Cashback Breakdown</h2>${cashbackLines.map((line) => `<div class="line"><span>${formatPromotionLineLabel(line, { includeStatus: true })}</span><strong>MWK ${Number(line.amount || 0).toLocaleString()}</strong></div>`).join("")}</section>` : ""}
    </main>
  </body>
</html>`
}

router.get(
  "/verify/receipts/:reference",
  asyncHandler(async (req, res) => {
    const payload = await getReceiptVerificationPayload(req.params.reference)
    const acceptsHtml = String(req.headers.accept || "").includes("text/html")
    if (acceptsHtml) {
      res.type("html").send(renderVerificationHtml(payload))
      return
    }
    return ok(res, payload)
  })
)

export default router
