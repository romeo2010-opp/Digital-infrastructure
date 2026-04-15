export function formatMoney(value) {
  return `MWK ${Number(value || 0).toLocaleString()}`
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString()
}

export function formatDateTime(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat("en-MW", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatTime(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat("en-MW", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function formatRelative(value) {
  if (!value) return "-"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
  if (diffMinutes < 1) return "Just now"
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`
  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`
  const diffDays = Math.round(diffHours / 24)
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`
}

export function normalizeTone(value) {
  const raw = String(value || "").toUpperCase()
  if (["CRITICAL", "HIGH", "HELD", "REJECTED", "OVERDUE", "OFFLINE", "FROZEN", "ESCALATED", "DEGRADED"].includes(raw)) return "danger"
  if (["WARNING", "MEDIUM", "UNDER_REVIEW", "PENDING", "GRACE", "REVIEW", "READY_FOR_ACTIVATION", "IN_PROGRESS", "ACKNOWLEDGED"].includes(raw)) return "warning"
  if (["APPROVED", "PAID", "ACTIVE", "RESOLVED", "COMPLETED", "OPEN", "OPERATIONAL", "HEALTHY", "INFO"].includes(raw)) return "success"
  return "neutral"
}
