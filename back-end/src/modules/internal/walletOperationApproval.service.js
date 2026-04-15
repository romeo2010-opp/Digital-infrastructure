import { INTERNAL_ROLE_CODES } from "./permissions.js"
import { isWalletAdminRole } from "./walletPermissions.js"

export const WALLET_OPERATION_TYPES = Object.freeze({
  REFUND_REQUEST: "REFUND_REQUEST",
  WALLET_CREDIT: "WALLET_CREDIT",
  LEDGER_ADJUSTMENT: "LEDGER_ADJUSTMENT",
  BALANCE_TRANSFER: "BALANCE_TRANSFER",
  POINTS_ADJUSTMENT: "POINTS_ADJUSTMENT",
  FREEZE: "FREEZE",
  UNFREEZE: "UNFREEZE",
  MARK_UNDER_REVIEW: "MARK_UNDER_REVIEW",
  HOLD_PLACE: "HOLD_PLACE",
  HOLD_RELEASE: "HOLD_RELEASE",
})

export function parseBooleanSetting(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return Boolean(fallback)
}

export function parseNumberSetting(value, fallback = 0) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : Number(fallback || 0)
}

export function buildWalletApprovalPolicy(settings = {}) {
  return {
    refundSupportThresholdMwk: parseNumberSetting(settings.support_refund_threshold_mwk, 15000),
    walletCreditApprovalThresholdMwk: parseNumberSetting(settings["wallet.credit.approval_threshold_mwk"], 25000),
    ledgerAdjustmentRequiresApproval: parseBooleanSetting(settings["wallet.ledger_adjustment.requires_approval"], true),
    balanceTransferRequiresApproval: parseBooleanSetting(settings["wallet.balance_transfer.requires_approval"], true),
    selfApprovalAllowed: parseBooleanSetting(settings["wallet.self_approval.allowed"], false),
  }
}

export function getWalletApprovalOwnerRoleCodes(operationType) {
  const normalizedType = String(operationType || "").trim().toUpperCase()
  if ([WALLET_OPERATION_TYPES.LEDGER_ADJUSTMENT, WALLET_OPERATION_TYPES.BALANCE_TRANSFER, WALLET_OPERATION_TYPES.WALLET_CREDIT].includes(normalizedType)) {
    return [
      INTERNAL_ROLE_CODES.PLATFORM_OWNER,
      INTERNAL_ROLE_CODES.PLATFORM_INFRASTRUCTURE_ENGINEER,
    ]
  }

  if (normalizedType === WALLET_OPERATION_TYPES.REFUND_REQUEST) {
    return [
      INTERNAL_ROLE_CODES.FINANCE_MANAGER,
      INTERNAL_ROLE_CODES.PLATFORM_OWNER,
      INTERNAL_ROLE_CODES.PLATFORM_INFRASTRUCTURE_ENGINEER,
    ]
  }

  return []
}

export function determineWalletApproval({
  operationType,
  amountMwk = 0,
  actorRole = "",
  actorUserId = null,
  requesterUserId = null,
  policy = buildWalletApprovalPolicy(),
}) {
  const normalizedType = String(operationType || "").trim().toUpperCase()
  const normalizedAmount = Number(amountMwk || 0)
  const normalizedActorRole = String(actorRole || "").trim().toUpperCase()
  const normalizedActorUserId = Number(actorUserId || 0) || null
  const normalizedRequesterUserId = Number(requesterUserId || 0) || null

  let requiresApproval = false

  switch (normalizedType) {
    case WALLET_OPERATION_TYPES.REFUND_REQUEST:
      requiresApproval = normalizedAmount > Number(policy.refundSupportThresholdMwk || 0)
      break
    case WALLET_OPERATION_TYPES.WALLET_CREDIT:
      requiresApproval = normalizedAmount > Number(policy.walletCreditApprovalThresholdMwk || 0)
      break
    case WALLET_OPERATION_TYPES.LEDGER_ADJUSTMENT:
      requiresApproval = Boolean(policy.ledgerAdjustmentRequiresApproval)
      break
    case WALLET_OPERATION_TYPES.BALANCE_TRANSFER:
      requiresApproval = Boolean(policy.balanceTransferRequiresApproval)
      break
    default:
      requiresApproval = false
      break
  }

  const canSelfApprove = Boolean(policy.selfApprovalAllowed)
    && isWalletAdminRole(normalizedActorRole)
    && normalizedActorUserId
    && normalizedRequesterUserId
    && normalizedActorUserId === normalizedRequesterUserId

  return {
    requiresApproval,
    canSelfApprove,
    ownerRoleCodes: getWalletApprovalOwnerRoleCodes(normalizedType),
  }
}
