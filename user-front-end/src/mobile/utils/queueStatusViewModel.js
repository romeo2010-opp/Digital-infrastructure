export function shouldShowServiceRequestProgress(serviceRequest) {
  if (!serviceRequest || typeof serviceRequest !== "object") return false
  if (serviceRequest.dispensingActive === true) return true
  return Number(serviceRequest.dispensedLitres || 0) > 0
}

export function resolveServiceRequestPaymentMode(serviceRequest, fallbackPaymentMode = "") {
  if (!serviceRequest || typeof serviceRequest !== "object") {
    return String(fallbackPaymentMode || "").trim().toUpperCase() === "PREPAY"
      ? "PREPAY"
      : "PAY_AT_PUMP"
  }

  const normalizedPaymentMode = String(serviceRequest.paymentMode || "").trim().toUpperCase()
  const normalizedFallbackMode = String(fallbackPaymentMode || "").trim().toUpperCase()
  const normalizedPaymentStatus = String(serviceRequest.paymentStatus || "").trim().toUpperCase()
  const hasWalletPrepayEvidence =
    serviceRequest.prepaySelected === true
    || normalizedPaymentMode === "PREPAY"
    || Boolean(String(serviceRequest.holdReference || "").trim())
    || Boolean(String(serviceRequest.walletTransactionReference || "").trim())
    || Boolean(String(serviceRequest.settlementBatchPublicId || "").trim())
    || ["HELD", "POSTED", "CAPTURED", "SETTLED"].includes(normalizedPaymentStatus)
    || normalizedFallbackMode === "PREPAY"

  return hasWalletPrepayEvidence ? "PREPAY" : "PAY_AT_PUMP"
}

export function serviceRequestStatusLabel(serviceRequest) {
  if (!serviceRequest) return "SUBMITTED"
  if (serviceRequest.dispensingActive) return "DISPENSING"

  const pumpSessionStatus = String(serviceRequest.pumpSessionStatus || "").trim().toUpperCase()
  if (pumpSessionStatus === "COMPLETED") return "COMPLETED"
  if (pumpSessionStatus === "FAILED") return "FAILED"

  return serviceRequest.paymentStatus || "SUBMITTED"
}
