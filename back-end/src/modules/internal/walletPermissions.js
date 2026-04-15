import { INTERNAL_ROLE_CODES } from "./permissions.js"

export const WALLET_APPROVER_ROLE_CODES = Object.freeze([
  INTERNAL_ROLE_CODES.FINANCE_MANAGER,
  INTERNAL_ROLE_CODES.PLATFORM_OWNER,
  INTERNAL_ROLE_CODES.PLATFORM_INFRASTRUCTURE_ENGINEER,
])

export const WALLET_ADMIN_ROLE_CODES = Object.freeze([
  INTERNAL_ROLE_CODES.PLATFORM_OWNER,
  INTERNAL_ROLE_CODES.PLATFORM_INFRASTRUCTURE_ENGINEER,
])

export function isWalletAdminRole(roleCode) {
  return WALLET_ADMIN_ROLE_CODES.includes(String(roleCode || "").trim().toUpperCase())
}

export function isWalletApproverRole(roleCode) {
  return WALLET_APPROVER_ROLE_CODES.includes(String(roleCode || "").trim().toUpperCase())
}
