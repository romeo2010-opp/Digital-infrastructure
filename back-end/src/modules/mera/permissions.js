export const MERA_ROLES = Object.freeze({
  SUPER_ADMIN: "SUPER_ADMIN",
  COMPLIANCE_OFFICER: "COMPLIANCE_OFFICER",
  LEGAL_ENFORCEMENT: "LEGAL_ENFORCEMENT",
  PUBLIC_COMPLAINT_ANALYST: "PUBLIC_COMPLAINT_ANALYST",
  MARKET_ANALYST: "MARKET_ANALYST",
})

export const MERA_ROLE_SET = new Set(Object.values(MERA_ROLES))

export function normalizeRoleList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || "").trim().toUpperCase())
    .filter((item, index, array) => item && array.indexOf(item) === index && MERA_ROLE_SET.has(item))
}
