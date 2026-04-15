import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { createPublicId } from "../common/db.js"
import {
  ensureWalletTablesReady,
  getUserWalletHolds,
  getUserWalletSummary,
  getUserWalletTransactions,
} from "../common/wallets.js"
import { INTERNAL_PERMISSIONS } from "./permissions.js"
import { createWalletAuditLog } from "./walletAudit.service.js"
import {
  buildWalletApprovalPolicy,
  determineWalletApproval,
  WALLET_OPERATION_TYPES,
} from "./walletOperationApproval.service.js"
import { isWalletAdminRole, isWalletApproverRole } from "./walletPermissions.js"

const DEFAULT_CURRENCY_CODE = "MWK"
const MANUAL_ADJUSTMENTS_ACCOUNT_CODE = "MANUAL_ADJUSTMENTS_MAIN"
const REFUNDS_PAYABLE_ACCOUNT_CODE = "REFUNDS_PAYABLE_MAIN"

function toNumber(value) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? Number(numeric.toFixed(2)) : 0
}

function toInteger(value) {
  const numeric = Number(value || 0)
  return Number.isFinite(numeric) ? Math.trunc(numeric) : 0
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function parseJson(value, fallback = null) {
  if (!value) return fallback
  if (typeof value === "object") return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeWalletStatus(wallet) {
  const status = String(wallet?.status || "ACTIVE").trim().toUpperCase()
  if (status === "CLOSED") return "CLOSED"
  if (status === "SUSPENDED") return "FROZEN"
  if (Number(wallet?.is_under_review || 0)) return "RESTRICTED"
  return "ACTIVE"
}

function normalizeWalletLookupRow(row) {
  if (!row?.id) return null
  return {
    id: Number(row.id),
    walletId: Number(row.id),
    walletPublicId: String(row.wallet_public_id || "").trim(),
    walletNumber: String(row.wallet_number || "").trim(),
    userId: Number(row.user_id || 0),
    userPublicId: String(row.user_public_id || "").trim() || null,
    fullName: String(row.full_name || "").trim() || "Unknown user",
    email: String(row.email || "").trim() || null,
    phone: String(row.phone_e164 || "").trim() || null,
    status: String(row.status || "ACTIVE").trim().toUpperCase(),
    derivedStatus: normalizeWalletStatus(row),
    currencyCode: String(row.currency_code || DEFAULT_CURRENCY_CODE).trim() || DEFAULT_CURRENCY_CODE,
    isUnderReview: Boolean(Number(row.is_under_review || 0)),
    underReviewAt: toIsoOrNull(row.under_review_at),
    underReviewReasonCode: String(row.under_review_reason_code || "").trim() || null,
    underReviewNote: String(row.under_review_note || "").trim() || null,
    suspendedAt: toIsoOrNull(row.suspended_at),
    suspendedReasonCode: String(row.suspended_reason_code || "").trim() || null,
    suspendedNote: String(row.suspended_note || "").trim() || null,
    closedAt: toIsoOrNull(row.closed_at),
    lastActivityAt: toIsoOrNull(row.last_activity_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

function normalizeOperationRequest(row, actor = null) {
  if (!row?.id) return null
  const metadata = parseJson(row.metadata_json, {})
  const actorUserId = Number(actor?.userId || 0) || null
  const normalizedStatus = String(row.status || "PENDING").trim().toUpperCase()
  const requesterUserId = Number(row.requested_by_user_id || 0) || null
  const operationType = String(row.operation_type || "").trim().toUpperCase()
  const actorRole = String(actor?.primaryRole || "").trim().toUpperCase()

  let canApprove = false
  if (normalizedStatus === "PENDING" && actorUserId && requesterUserId !== actorUserId) {
    if (operationType === WALLET_OPERATION_TYPES.REFUND_REQUEST) {
      canApprove = isWalletApproverRole(actorRole)
    } else if (
      [WALLET_OPERATION_TYPES.WALLET_CREDIT, WALLET_OPERATION_TYPES.LEDGER_ADJUSTMENT, WALLET_OPERATION_TYPES.BALANCE_TRANSFER]
        .includes(operationType)
    ) {
      canApprove = isWalletAdminRole(actorRole)
    }
  }

  return {
    id: Number(row.id),
    publicId: String(row.public_id || "").trim(),
    requestKey: String(row.request_key || "").trim(),
    walletPublicId: String(row.wallet_public_id || "").trim(),
    walletOwnerName: String(row.wallet_owner_name || "").trim() || "Unknown user",
    destinationWalletPublicId: String(row.destination_wallet_public_id || "").trim() || null,
    operationType,
    status: normalizedStatus,
    amountMwk: row.amount_mwk === null || row.amount_mwk === undefined ? null : toNumber(row.amount_mwk),
    pointsDelta: row.points_delta === null || row.points_delta === undefined ? null : toInteger(row.points_delta),
    currencyCode: String(row.currency_code || DEFAULT_CURRENCY_CODE).trim() || DEFAULT_CURRENCY_CODE,
    requestedByName: String(row.requested_by_name || "").trim() || "Internal user",
    requestedByRole: String(row.requested_by_role || "").trim() || null,
    approvedByName: String(row.approved_by_name || "").trim() || null,
    rejectedByName: String(row.rejected_by_name || "").trim() || null,
    approvalRequired: Boolean(Number(row.approval_required || 0)),
    sourceTransactionPublicId: String(row.source_transaction_public_id || "").trim() || null,
    reasonCode: String(row.reason_code || "").trim() || null,
    note: String(row.note || "").trim() || null,
    rejectionReason: String(row.rejection_reason || "").trim() || null,
    createdAt: toIsoOrNull(row.created_at),
    approvedAt: toIsoOrNull(row.approved_at),
    rejectedAt: toIsoOrNull(row.rejected_at),
    executedAt: toIsoOrNull(row.executed_at),
    canApprove,
    metadata,
  }
}

function buildTransactionReference(prefix = "WOP") {
  return `${prefix}-${createPublicId()}`
}

function buildMutationCorrelationId(requestKey = "") {
  return String(requestKey || "").trim() || `wallet-op-${createPublicId()}`
}

function inferTransactionChannel(transaction) {
  const metadata = transaction?.metadata || {}
  if (metadata?.source) return String(metadata.source).replace(/_/g, " ")
  if (transaction?.relatedEntityType) return String(transaction.relatedEntityType).replace(/_/g, " ")
  return "Wallet ledger"
}

function formatWalletStatementFilename(walletPublicId) {
  return `wallet-statement-${String(walletPublicId || "wallet").trim().toLowerCase() || "wallet"}.csv`
}

async function ensureWalletOpsTablesReady(db = prisma) {
  await ensureWalletTablesReady()
  await db.$queryRaw`
    SELECT id, public_id, request_key, operation_type
    FROM wallet_operation_requests
    LIMIT 1
  `
  await db.$queryRaw`
    SELECT id, wallet_id, points_balance
    FROM wallet_points_profiles
    LIMIT 1
  `
  await db.$queryRaw`
    SELECT id, wallet_id, delta_points
    FROM wallet_points_adjustments
    LIMIT 1
  `
}

async function listWalletPolicySettings(db = prisma) {
  const rows = await db.$queryRaw`
    SELECT setting_key, setting_value
    FROM internal_settings
    WHERE setting_key IN (
      'support_refund_threshold_mwk',
      'wallet.credit.approval_threshold_mwk',
      'wallet.ledger_adjustment.requires_approval',
      'wallet.balance_transfer.requires_approval',
      'wallet.self_approval.allowed'
    )
  `
  return Object.fromEntries((rows || []).map((row) => [String(row.setting_key || "").trim(), String(row.setting_value || "")]))
}

async function resolveWalletByPublicIdOrThrow(db, walletPublicId, { forUpdate = false } = {}) {
  const scopedWalletPublicId = String(walletPublicId || "").trim()
  if (!scopedWalletPublicId) throw badRequest("Wallet display ID is required.")

  const query = forUpdate
    ? db.$queryRaw`
        SELECT
          w.id,
          w.user_id,
          w.wallet_number,
          w.wallet_public_id,
          w.currency_code,
          w.status,
          w.is_under_review,
          w.under_review_at,
          w.under_review_by_user_id,
          w.under_review_reason_code,
          w.under_review_note,
          w.suspended_at,
          w.suspended_reason_code,
          w.suspended_note,
          w.closed_at,
          w.last_activity_at,
          w.created_at,
          w.updated_at,
          u.public_id AS user_public_id,
          u.full_name,
          u.email,
          u.phone_e164
        FROM wallets w
        INNER JOIN users u ON u.id = w.user_id
        WHERE w.wallet_public_id = ${scopedWalletPublicId}
        LIMIT 1
        FOR UPDATE
      `
    : db.$queryRaw`
        SELECT
          w.id,
          w.user_id,
          w.wallet_number,
          w.wallet_public_id,
          w.currency_code,
          w.status,
          w.is_under_review,
          w.under_review_at,
          w.under_review_by_user_id,
          w.under_review_reason_code,
          w.under_review_note,
          w.suspended_at,
          w.suspended_reason_code,
          w.suspended_note,
          w.closed_at,
          w.last_activity_at,
          w.created_at,
          w.updated_at,
          u.public_id AS user_public_id,
          u.full_name,
          u.email,
          u.phone_e164
        FROM wallets w
        INNER JOIN users u ON u.id = w.user_id
        WHERE w.wallet_public_id = ${scopedWalletPublicId}
        LIMIT 1
      `

  const wallet = normalizeWalletLookupRow((await query)?.[0] || null)
  if (!wallet?.id) throw notFound("Wallet not found.")
  return wallet
}

async function ensurePointsProfile(db, walletId) {
  await db.$executeRaw`
    INSERT INTO wallet_points_profiles (
      wallet_id,
      points_balance,
      current_tier,
      tier_progress_percent,
      last_activity_at
    )
    VALUES (
      ${walletId},
      0,
      'STANDARD',
      NULL,
      NULL
    )
    ON DUPLICATE KEY UPDATE
      wallet_id = VALUES(wallet_id),
      updated_at = CURRENT_TIMESTAMP(3)
  `

  const rows = await db.$queryRaw`
    SELECT id, wallet_id, points_balance, current_tier, tier_progress_percent, last_activity_at, created_at, updated_at
    FROM wallet_points_profiles
    WHERE wallet_id = ${walletId}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveWalletLedgerAccountOrThrow(db, walletId) {
  const rows = await db.$queryRaw`
    SELECT id, account_code, currency_code, status
    FROM ledger_accounts
    WHERE wallet_id = ${walletId}
    LIMIT 1
  `
  const account = rows?.[0] || null
  if (!account?.id) throw badRequest("Wallet ledger account is unavailable.")
  return account
}

async function resolveSystemAccountOrThrow(db, accountCode, currencyCode = DEFAULT_CURRENCY_CODE) {
  const rows = await db.$queryRaw`
    SELECT id, account_code, account_name, currency_code
    FROM ledger_accounts
    WHERE wallet_id IS NULL
      AND account_code = ${String(accountCode || "").trim()}
      AND currency_code = ${currencyCode}
      AND status = 'ACTIVE'
    LIMIT 1
  `
  const account = rows?.[0] || null
  if (!account?.id) throw badRequest(`System account ${accountCode} is unavailable.`)
  return account
}

async function getWalletBalanceSnapshot(db, walletId) {
  const rows = await db.$queryRaw`
    SELECT
      COALESCE(wb.ledger_balance, 0) AS ledger_balance,
      COALESCE(wb.available_balance, 0) AS available_balance,
      COALESCE((
        SELECT SUM(wrh.amount)
        FROM wallet_reservation_holds wrh
        WHERE wrh.wallet_id = ${walletId}
          AND wrh.status = 'ACTIVE'
      ), 0) AS held_balance,
      COALESCE(wb.pending_inflow, 0) AS pending_inflow,
      COALESCE(wb.pending_outflow, 0) AS pending_outflow,
      COALESCE((
        SELECT SUM(le.amount)
        FROM ledger_entries le
        INNER JOIN ledger_accounts la ON la.id = le.ledger_account_id
        WHERE la.wallet_id = ${walletId}
          AND le.entry_side = 'CREDIT'
      ), 0) AS total_inflow,
      COALESCE((
        SELECT SUM(le.amount)
        FROM ledger_entries le
        INNER JOIN ledger_accounts la ON la.id = le.ledger_account_id
        WHERE la.wallet_id = ${walletId}
          AND le.entry_side = 'DEBIT'
      ), 0) AS total_outflow
    FROM wallet_balances wb
    WHERE wb.wallet_id = ${walletId}
    LIMIT 1
  `
  const row = rows?.[0] || {}
  return {
    availableBalance: toNumber(row.available_balance),
    heldBalance: toNumber(row.held_balance),
    pendingCredits: toNumber(row.pending_inflow),
    pendingDebits: toNumber(row.pending_outflow),
    ledgerBalance: toNumber(row.ledger_balance),
    totalInflow: toNumber(row.total_inflow),
    totalOutflow: toNumber(row.total_outflow),
  }
}

async function getWalletRiskProfile(db, wallet) {
  const [failedRows, refundRows, adjustmentRows, caseRows] = await Promise.all([
    db.$queryRaw`
      SELECT COUNT(*) AS failed_count
      FROM transactions
      WHERE user_id = ${wallet.userId}
        AND status IN ('CANCELLED', 'REVERSED', 'FROZEN')
        AND occurred_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
    `,
    db.$queryRaw`
      SELECT COUNT(*) AS refund_count
      FROM wallet_operation_requests
      WHERE wallet_id = ${wallet.id}
        AND operation_type = 'REFUND_REQUEST'
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
    `,
    db.$queryRaw`
      SELECT COUNT(*) AS adjustment_count
      FROM wallet_audit_logs
      WHERE wallet_id = ${wallet.id}
        AND action_type IN (
          'WALLET_POINTS_ADJUSTED',
          'WALLET_CREDIT_EXECUTED',
          'WALLET_LEDGER_ADJUSTMENT_EXECUTED',
          'WALLET_BALANCE_TRANSFER_EXECUTED'
        )
        AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY)
    `,
    db.$queryRaw`
      SELECT public_id
      FROM internal_support_cases
      WHERE user_id = ${wallet.userId}
      ORDER BY created_at DESC
      LIMIT 5
    `,
  ])

  const flags = []
  if (wallet.derivedStatus === "FROZEN") flags.push("Wallet frozen")
  if (wallet.isUnderReview) flags.push("Under review")
  if (toInteger(failedRows?.[0]?.failed_count) >= 3) flags.push("High recent failure rate")

  return {
    walletFlags: flags,
    underReview: wallet.isUnderReview,
    recentFailedTransactionsCount: toInteger(failedRows?.[0]?.failed_count),
    recentRefundCount: toInteger(refundRows?.[0]?.refund_count),
    manualAdjustmentsCount: toInteger(adjustmentRows?.[0]?.adjustment_count),
    linkedSupportCaseReferences: (caseRows || []).map((row) => String(row.public_id || "").trim()).filter(Boolean),
  }
}

async function buildWalletConsoleData(db, wallet, { transactionPage = 1, transactionLimit = 20 } = {}) {
  const [summary, pointsProfileRow, transactions, holds, risk] = await Promise.all([
    getUserWalletSummary(wallet.userId, { currencyCode: wallet.currencyCode }),
    ensurePointsProfile(db, wallet.id),
    getUserWalletTransactions(wallet.userId, { page: transactionPage, limit: transactionLimit }),
    getUserWalletHolds(wallet.userId, { status: "ACTIVE", limit: 25 }),
    getWalletRiskProfile(db, wallet),
  ])

  const pointsProfile = {
    pointsBalance: toInteger(pointsProfileRow?.points_balance),
    currentTier: String(pointsProfileRow?.current_tier || "STANDARD").trim() || "STANDARD",
    tierProgressPercent: pointsProfileRow?.tier_progress_percent === null || pointsProfileRow?.tier_progress_percent === undefined
      ? null
      : toNumber(pointsProfileRow.tier_progress_percent),
    lastActivityAt: toIsoOrNull(pointsProfileRow?.last_activity_at),
  }

  return {
    wallet: {
      walletId: wallet.walletPublicId,
      walletPublicId: wallet.walletPublicId,
      walletNumber: wallet.walletNumber,
      userPublicId: wallet.userPublicId,
      customerName: wallet.fullName,
      email: wallet.email,
      phone: wallet.phone,
      status: wallet.derivedStatus,
      rawStatus: wallet.status,
      kycLevel: null,
      createdAt: wallet.createdAt,
      lastActivityAt: wallet.lastActivityAt || summary?.updatedAt || null,
      isUnderReview: wallet.isUnderReview,
      suspendedReasonCode: wallet.suspendedReasonCode,
      suspendedNote: wallet.suspendedNote,
      underReviewReasonCode: wallet.underReviewReasonCode,
      underReviewNote: wallet.underReviewNote,
      currencyCode: wallet.currencyCode,
    },
    balances: {
      availableBalance: toNumber(summary?.availableBalance),
      heldBalance: toNumber(summary?.activeHoldAmount ?? holds?.activeHoldAmount),
      pendingCredits: toNumber(summary?.pendingInflow),
      pendingDebits: toNumber(summary?.pendingOutflow),
      totalInflow: toNumber((await getWalletBalanceSnapshot(db, wallet.id)).totalInflow),
      totalOutflow: toNumber((await getWalletBalanceSnapshot(db, wallet.id)).totalOutflow),
      ledgerBalance: toNumber(summary?.ledgerBalance),
    },
    loyalty: pointsProfile,
    transactions: {
      ...transactions,
      items: (transactions?.items || []).map((item) => ({
        ...item,
        sourceChannel: inferTransactionChannel(item),
        linkedReference: item.transactionPublicId || item.relatedEntityId || item.externalReference || null,
      })),
    },
    holds,
    risk,
  }
}

async function getExistingAuditLogByCorrelation(db, walletId, correlationId, actionType) {
  const scopedCorrelationId = String(correlationId || "").trim()
  if (!scopedCorrelationId) return null
  const scopedActionType = String(actionType || "").trim()
  const rows = await db.$queryRaw`
    SELECT id, correlation_id, action_type
    FROM wallet_audit_logs
    WHERE wallet_id = ${walletId}
      AND correlation_id = ${scopedCorrelationId}
      AND action_type = ${scopedActionType}
    ORDER BY id DESC
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveWalletOperationRequestOrThrow(db, requestId, { forUpdate = false } = {}) {
  const scopedRequestId = String(requestId || "").trim()
  if (!scopedRequestId) throw badRequest("Wallet operation request ID is required.")

  const query = forUpdate
    ? db.$queryRaw`
        SELECT
          wor.*,
          w.wallet_public_id,
          owner.full_name AS wallet_owner_name,
          dw.wallet_public_id AS destination_wallet_public_id,
          requester.full_name AS requested_by_name,
          approver.full_name AS approved_by_name,
          rejector.full_name AS rejected_by_name
        FROM wallet_operation_requests wor
        INNER JOIN wallets w ON w.id = wor.wallet_id
        INNER JOIN users owner ON owner.id = w.user_id
        LEFT JOIN wallets dw ON dw.id = wor.destination_wallet_id
        LEFT JOIN users requester ON requester.id = wor.requested_by_user_id
        LEFT JOIN users approver ON approver.id = wor.approved_by_user_id
        LEFT JOIN users rejector ON rejector.id = wor.rejected_by_user_id
        WHERE wor.public_id = ${scopedRequestId}
        LIMIT 1
        FOR UPDATE
      `
    : db.$queryRaw`
        SELECT
          wor.*,
          w.wallet_public_id,
          owner.full_name AS wallet_owner_name,
          dw.wallet_public_id AS destination_wallet_public_id,
          requester.full_name AS requested_by_name,
          approver.full_name AS approved_by_name,
          rejector.full_name AS rejected_by_name
        FROM wallet_operation_requests wor
        INNER JOIN wallets w ON w.id = wor.wallet_id
        INNER JOIN users owner ON owner.id = w.user_id
        LEFT JOIN wallets dw ON dw.id = wor.destination_wallet_id
        LEFT JOIN users requester ON requester.id = wor.requested_by_user_id
        LEFT JOIN users approver ON approver.id = wor.approved_by_user_id
        LEFT JOIN users rejector ON rejector.id = wor.rejected_by_user_id
        WHERE wor.public_id = ${scopedRequestId}
        LIMIT 1
      `
  const row = (await query)?.[0] || null
  if (!row?.id) throw notFound("Wallet operation request not found.")
  return row
}

async function findWalletOperationRequestByKey(db, requestKey) {
  const scopedRequestKey = String(requestKey || "").trim()
  if (!scopedRequestKey) return null
  const rows = await db.$queryRaw`
    SELECT public_id
    FROM wallet_operation_requests
    WHERE request_key = ${scopedRequestKey}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function resolveTransactionForRefundOrThrow(db, wallet, transactionPublicId) {
  const scopedTransactionPublicId = String(transactionPublicId || "").trim()
  if (!scopedTransactionPublicId) throw badRequest("sourceTransactionPublicId is required.")

  const rows = await db.$queryRaw`
    SELECT public_id, user_id, total_amount, status, occurred_at
    FROM transactions
    WHERE public_id = ${scopedTransactionPublicId}
    LIMIT 1
  `
  const transaction = rows?.[0] || null
  if (!transaction?.public_id) throw badRequest("Source transaction was not found.")
  if (Number(transaction.user_id || 0) !== wallet.userId) {
    throw badRequest("The source transaction does not belong to this wallet owner.")
  }
  if (["CANCELLED", "REVERSED"].includes(String(transaction.status || "").trim().toUpperCase())) {
    throw badRequest("The source transaction is not refundable.")
  }
  return transaction
}

async function touchWalletActivity(db, walletId) {
  await db.$executeRaw`
    UPDATE wallets
    SET
      last_activity_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${walletId}
  `
}

async function createLedgerTransactionAndEntries(
  db,
  {
    wallet,
    direction,
    amountMwk,
    transactionType = "ADJUSTMENT",
    description,
    counterAccountCode,
    relatedEntityType = "WALLET_OPERATION_REQUEST",
    relatedEntityId,
    externalReference = null,
    initiatedByUserId = null,
    approvedByUserId = null,
    idempotencyKey = null,
    metadata = null,
  }
) {
  const normalizedDirection = String(direction || "").trim().toUpperCase()
  const normalizedAmount = toNumber(amountMwk)
  if (!["CREDIT", "DEBIT"].includes(normalizedDirection)) throw badRequest("Unsupported wallet ledger direction.")
  if (!(normalizedAmount > 0)) throw badRequest("Amount must be greater than zero.")

  const walletAccount = await resolveWalletLedgerAccountOrThrow(db, wallet.id)
  const counterAccount = await resolveSystemAccountOrThrow(db, counterAccountCode, wallet.currencyCode)
  const transactionReference = buildTransactionReference(normalizedDirection === "CREDIT" ? "WCR" : "WDB")

  await db.$executeRaw`
    INSERT INTO ledger_transactions (
      wallet_id,
      transaction_reference,
      external_reference,
      parent_transaction_id,
      transaction_type,
      transaction_status,
      currency_code,
      gross_amount,
      net_amount,
      fee_amount,
      description,
      related_entity_type,
      related_entity_id,
      initiated_by_user_id,
      approved_by_user_id,
      idempotency_key,
      posted_at,
      reversed_at,
      failed_at,
      metadata_json
    )
    VALUES (
      ${wallet.id},
      ${transactionReference},
      ${externalReference},
      NULL,
      ${transactionType},
      'POSTED',
      ${wallet.currencyCode},
      ${normalizedAmount},
      ${normalizedAmount},
      0.00,
      ${description},
      ${relatedEntityType},
      ${relatedEntityId},
      ${initiatedByUserId},
      ${approvedByUserId},
      ${idempotencyKey},
      CURRENT_TIMESTAMP(3),
      NULL,
      NULL,
      ${metadata ? JSON.stringify(metadata) : null}
    )
  `

  const transactionRows = await db.$queryRaw`
    SELECT id, transaction_reference
    FROM ledger_transactions
    WHERE transaction_reference = ${transactionReference}
    LIMIT 1
  `
  const ledgerTransaction = transactionRows?.[0] || null
  if (!ledgerTransaction?.id) throw badRequest("Ledger transaction could not be recorded.")

  if (normalizedDirection === "CREDIT") {
    await db.$executeRaw`
      INSERT INTO ledger_entries (
        ledger_transaction_id,
        ledger_account_id,
        entry_side,
        amount,
        currency_code,
        entry_description
      )
      VALUES
        (
          ${ledgerTransaction.id},
          ${counterAccount.id},
          'DEBIT',
          ${normalizedAmount},
          ${wallet.currencyCode},
          ${description}
        ),
        (
          ${ledgerTransaction.id},
          ${walletAccount.id},
          'CREDIT',
          ${normalizedAmount},
          ${wallet.currencyCode},
          ${description}
        )
    `
  } else {
    await db.$executeRaw`
      INSERT INTO ledger_entries (
        ledger_transaction_id,
        ledger_account_id,
        entry_side,
        amount,
        currency_code,
        entry_description
      )
      VALUES
        (
          ${ledgerTransaction.id},
          ${walletAccount.id},
          'DEBIT',
          ${normalizedAmount},
          ${wallet.currencyCode},
          ${description}
        ),
        (
          ${ledgerTransaction.id},
          ${counterAccount.id},
          'CREDIT',
          ${normalizedAmount},
          ${wallet.currencyCode},
          ${description}
        )
    `
  }

  const entryRows = await db.$queryRaw`
    SELECT id, ledger_account_id, entry_side
    FROM ledger_entries
    WHERE ledger_transaction_id = ${ledgerTransaction.id}
    ORDER BY id ASC
  `
  const debitEntry = (entryRows || []).find((row) => String(row.entry_side || "").trim().toUpperCase() === "DEBIT") || null
  const creditEntry = (entryRows || []).find((row) => String(row.entry_side || "").trim().toUpperCase() === "CREDIT") || null

  await db.$executeRaw`
    UPDATE wallet_balances
    SET
      version_no = version_no + 1,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE wallet_id = ${wallet.id}
  `

  await touchWalletActivity(db, wallet.id)

  return {
    ledgerTransactionId: Number(ledgerTransaction.id),
    ledgerTransactionReference: String(ledgerTransaction.transaction_reference || "").trim(),
    debitLedgerEntryId: debitEntry?.id ? Number(debitEntry.id) : null,
    creditLedgerEntryId: creditEntry?.id ? Number(creditEntry.id) : null,
  }
}

async function executeWalletOperationRequest(db, requestRow, actor, auditContext = {}) {
  const request = normalizeOperationRequest(requestRow, actor)
  const wallet = await resolveWalletByPublicIdOrThrow(db, request.walletPublicId, { forUpdate: true })
  const metadata = request.metadata || {}
  const beforeBalances = await getWalletBalanceSnapshot(db, wallet.id)

  if (wallet.status === "CLOSED") throw badRequest("Closed wallets cannot be mutated.")

  if (request.operationType === WALLET_OPERATION_TYPES.REFUND_REQUEST) {
    const transaction = await resolveTransactionForRefundOrThrow(db, wallet, request.sourceTransactionPublicId)
    if (!(toNumber(request.amountMwk) > 0) || toNumber(request.amountMwk) > toNumber(transaction.total_amount)) {
      throw badRequest("Refund amount must be positive and not exceed the source transaction value.")
    }

    const ledgerMutation = await createLedgerTransactionAndEntries(db, {
      wallet,
      direction: "CREDIT",
      amountMwk: request.amountMwk,
      transactionType: "REFUND",
      description: request.note || `Wallet refund ${request.publicId}`,
      counterAccountCode: REFUNDS_PAYABLE_ACCOUNT_CODE,
      relatedEntityType: "WALLET_OPERATION_REQUEST",
      relatedEntityId: request.publicId,
      externalReference: request.sourceTransactionPublicId,
      initiatedByUserId: requestRow.requested_by_user_id,
      approvedByUserId: actor.userId,
      idempotencyKey: `wallet-op:${request.requestKey}`,
      metadata: {
        requestType: request.operationType,
        reasonCode: request.reasonCode,
        note: request.note,
        sourceTransactionPublicId: request.sourceTransactionPublicId,
      },
    })

    const afterBalances = await getWalletBalanceSnapshot(db, wallet.id)
    await createWalletAuditLog(db, {
      walletId: wallet.id,
      ledgerTransactionId: ledgerMutation.ledgerTransactionId,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_REFUND_REQUEST,
      actionType: "WALLET_REFUND_REQUEST_EXECUTED",
      actionSummary: `Refund ${request.publicId} credited to wallet ${wallet.walletPublicId}.`,
      entityType: "WALLET_OPERATION_REQUEST",
      entityId: request.publicId,
      amountDeltaMwk: request.amountMwk,
      balanceBefore: beforeBalances,
      balanceAfter: afterBalances,
      reasonCode: request.reasonCode,
      note: request.note,
      approvalRequestId: request.id,
      correlationId: request.requestKey,
      debitLedgerEntryId: ledgerMutation.debitLedgerEntryId,
      creditLedgerEntryId: ledgerMutation.creditLedgerEntryId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: {
        sourceTransactionPublicId: request.sourceTransactionPublicId,
      },
    })
  } else if (request.operationType === WALLET_OPERATION_TYPES.WALLET_CREDIT) {
    const ledgerMutation = await createLedgerTransactionAndEntries(db, {
      wallet,
      direction: "CREDIT",
      amountMwk: request.amountMwk,
      transactionType: "ADJUSTMENT",
      description: request.note || `Wallet credit ${request.publicId}`,
      counterAccountCode: MANUAL_ADJUSTMENTS_ACCOUNT_CODE,
      relatedEntityType: "WALLET_OPERATION_REQUEST",
      relatedEntityId: request.publicId,
      initiatedByUserId: requestRow.requested_by_user_id,
      approvedByUserId: actor.userId,
      idempotencyKey: `wallet-op:${request.requestKey}`,
      metadata: {
        requestType: request.operationType,
        reasonCode: request.reasonCode,
      },
    })
    const afterBalances = await getWalletBalanceSnapshot(db, wallet.id)
    await createWalletAuditLog(db, {
      walletId: wallet.id,
      ledgerTransactionId: ledgerMutation.ledgerTransactionId,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_WALLET_CREDIT_ISSUE,
      actionType: "WALLET_CREDIT_EXECUTED",
      actionSummary: `Wallet credit ${request.publicId} executed.`,
      entityType: "WALLET_OPERATION_REQUEST",
      entityId: request.publicId,
      amountDeltaMwk: request.amountMwk,
      balanceBefore: beforeBalances,
      balanceAfter: afterBalances,
      reasonCode: request.reasonCode,
      note: request.note,
      approvalRequestId: request.id,
      correlationId: request.requestKey,
      debitLedgerEntryId: ledgerMutation.debitLedgerEntryId,
      creditLedgerEntryId: ledgerMutation.creditLedgerEntryId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    })
  } else if (request.operationType === WALLET_OPERATION_TYPES.LEDGER_ADJUSTMENT) {
    const direction = String(metadata.direction || "").trim().toUpperCase()
    if (!["CREDIT", "DEBIT"].includes(direction)) throw badRequest("Ledger adjustment direction is missing.")
    if (direction === "DEBIT" && beforeBalances.availableBalance < toNumber(request.amountMwk)) {
      throw badRequest("Insufficient available balance for ledger adjustment.")
    }

    const ledgerMutation = await createLedgerTransactionAndEntries(db, {
      wallet,
      direction,
      amountMwk: request.amountMwk,
      transactionType: "ADJUSTMENT",
      description: request.note || `Ledger adjustment ${request.publicId}`,
      counterAccountCode: MANUAL_ADJUSTMENTS_ACCOUNT_CODE,
      relatedEntityType: "WALLET_OPERATION_REQUEST",
      relatedEntityId: request.publicId,
      initiatedByUserId: requestRow.requested_by_user_id,
      approvedByUserId: actor.userId,
      idempotencyKey: `wallet-op:${request.requestKey}`,
      metadata: {
        requestType: request.operationType,
        reasonCode: request.reasonCode,
        direction,
      },
    })
    const afterBalances = await getWalletBalanceSnapshot(db, wallet.id)
    await createWalletAuditLog(db, {
      walletId: wallet.id,
      ledgerTransactionId: ledgerMutation.ledgerTransactionId,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_LEDGER_ADJUST,
      actionType: "WALLET_LEDGER_ADJUSTMENT_EXECUTED",
      actionSummary: `Ledger adjustment ${request.publicId} executed.`,
      entityType: "WALLET_OPERATION_REQUEST",
      entityId: request.publicId,
      amountDeltaMwk: direction === "DEBIT" ? -Math.abs(toNumber(request.amountMwk)) : Math.abs(toNumber(request.amountMwk)),
      balanceBefore: beforeBalances,
      balanceAfter: afterBalances,
      reasonCode: request.reasonCode,
      note: request.note,
      approvalRequestId: request.id,
      correlationId: request.requestKey,
      debitLedgerEntryId: ledgerMutation.debitLedgerEntryId,
      creditLedgerEntryId: ledgerMutation.creditLedgerEntryId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: { direction },
    })
  } else if (request.operationType === WALLET_OPERATION_TYPES.BALANCE_TRANSFER) {
    const destinationWalletDisplayId = String(metadata.destinationWalletDisplayId || "").trim()
    const destinationSystemAccountCode = String(metadata.destinationSystemAccountCode || "").trim()
    if (!destinationWalletDisplayId && !destinationSystemAccountCode) {
      throw badRequest("Balance transfer destination is required.")
    }
    if (beforeBalances.availableBalance < toNumber(request.amountMwk)) {
      throw badRequest("Insufficient available balance for transfer.")
    }

    const sourceMutation = await createLedgerTransactionAndEntries(db, {
      wallet,
      direction: "DEBIT",
      amountMwk: request.amountMwk,
      transactionType: "ADJUSTMENT",
      description: request.note || `Balance transfer ${request.publicId}`,
      counterAccountCode: destinationSystemAccountCode || MANUAL_ADJUSTMENTS_ACCOUNT_CODE,
      relatedEntityType: "WALLET_OPERATION_REQUEST",
      relatedEntityId: request.publicId,
      initiatedByUserId: requestRow.requested_by_user_id,
      approvedByUserId: actor.userId,
      idempotencyKey: `wallet-op:${request.requestKey}:source`,
      metadata: {
        requestType: request.operationType,
        destinationWalletDisplayId: destinationWalletDisplayId || null,
        destinationSystemAccountCode: destinationSystemAccountCode || null,
      },
    })
    const afterSourceBalances = await getWalletBalanceSnapshot(db, wallet.id)

    await createWalletAuditLog(db, {
      walletId: wallet.id,
      ledgerTransactionId: sourceMutation.ledgerTransactionId,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_BALANCE_TRANSFER,
      actionType: "WALLET_BALANCE_TRANSFER_EXECUTED",
      actionSummary: `Balance transfer ${request.publicId} executed from ${wallet.walletPublicId}.`,
      entityType: "WALLET_OPERATION_REQUEST",
      entityId: request.publicId,
      amountDeltaMwk: -Math.abs(toNumber(request.amountMwk)),
      balanceBefore: beforeBalances,
      balanceAfter: afterSourceBalances,
      reasonCode: request.reasonCode,
      note: request.note,
      approvalRequestId: request.id,
      correlationId: request.requestKey,
      debitLedgerEntryId: sourceMutation.debitLedgerEntryId,
      creditLedgerEntryId: sourceMutation.creditLedgerEntryId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
      metadata: {
        destinationWalletDisplayId: destinationWalletDisplayId || null,
        destinationSystemAccountCode: destinationSystemAccountCode || null,
      },
    })

    if (destinationWalletDisplayId) {
      const destinationWallet = await resolveWalletByPublicIdOrThrow(db, destinationWalletDisplayId, { forUpdate: true })
      if (destinationWallet.id === wallet.id) throw badRequest("Source and destination wallets must be different.")
      if (destinationWallet.currencyCode !== wallet.currencyCode) throw badRequest("Transfers require matching wallet currency.")

      const destinationBefore = await getWalletBalanceSnapshot(db, destinationWallet.id)
      const destinationMutation = await createLedgerTransactionAndEntries(db, {
        wallet: destinationWallet,
        direction: "CREDIT",
        amountMwk: request.amountMwk,
        transactionType: "ADJUSTMENT",
        description: request.note || `Balance transfer ${request.publicId}`,
        counterAccountCode: MANUAL_ADJUSTMENTS_ACCOUNT_CODE,
        relatedEntityType: "WALLET_OPERATION_REQUEST",
        relatedEntityId: request.publicId,
        initiatedByUserId: requestRow.requested_by_user_id,
        approvedByUserId: actor.userId,
        idempotencyKey: `wallet-op:${request.requestKey}:destination`,
        metadata: {
          requestType: request.operationType,
          sourceWalletDisplayId: wallet.walletPublicId,
        },
      })
      const destinationAfter = await getWalletBalanceSnapshot(db, destinationWallet.id)
      await createWalletAuditLog(db, {
        walletId: destinationWallet.id,
        ledgerTransactionId: destinationMutation.ledgerTransactionId,
        actorUserId: actor.userId,
        actorRole: actor.primaryRole,
        targetUserId: destinationWallet.userId,
        capabilityUsed: INTERNAL_PERMISSIONS.WALLET_BALANCE_TRANSFER,
        actionType: "WALLET_BALANCE_TRANSFER_RECEIVED",
        actionSummary: `Balance transfer ${request.publicId} received by ${destinationWallet.walletPublicId}.`,
        entityType: "WALLET_OPERATION_REQUEST",
        entityId: request.publicId,
        amountDeltaMwk: Math.abs(toNumber(request.amountMwk)),
        balanceBefore: destinationBefore,
        balanceAfter: destinationAfter,
        reasonCode: request.reasonCode,
        note: request.note,
        approvalRequestId: request.id,
        correlationId: request.requestKey,
        debitLedgerEntryId: destinationMutation.debitLedgerEntryId,
        creditLedgerEntryId: destinationMutation.creditLedgerEntryId,
        ipAddress: auditContext.ipAddress,
        userAgent: auditContext.userAgent,
        metadata: {
          sourceWalletDisplayId: wallet.walletPublicId,
        },
      })
    }
  } else {
    throw badRequest("Unsupported wallet operation request type.")
  }

  await db.$executeRaw`
    UPDATE wallet_operation_requests
    SET
      status = 'EXECUTED',
      approved_by_user_id = COALESCE(approved_by_user_id, ${actor.userId}),
      approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP(3)),
      executed_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${request.id}
  `
}

function assertCanApproveWalletRequest(actor, requestRow) {
  const actorUserId = Number(actor?.userId || 0) || null
  const requesterUserId = Number(requestRow?.requested_by_user_id || 0) || null
  const actorRole = String(actor?.primaryRole || "").trim().toUpperCase()
  const operationType = String(requestRow?.operation_type || "").trim().toUpperCase()

  if (!actorUserId) throw badRequest("Internal actor is missing.")
  if (requesterUserId && actorUserId === requesterUserId) {
    throw badRequest("Self-approval is not allowed for wallet operation requests.")
  }

  if (operationType === WALLET_OPERATION_TYPES.REFUND_REQUEST) {
    if (!isWalletApproverRole(actorRole)) throw badRequest("This role cannot approve refund requests.")
    return
  }

  if (
    [WALLET_OPERATION_TYPES.WALLET_CREDIT, WALLET_OPERATION_TYPES.LEDGER_ADJUSTMENT, WALLET_OPERATION_TYPES.BALANCE_TRANSFER]
      .includes(operationType)
  ) {
    if (!isWalletAdminRole(actorRole)) throw badRequest("This role cannot approve the requested wallet operation.")
    return
  }

  throw badRequest("This wallet operation request cannot be approved.")
}

async function createWalletOperationRequest(db, {
  actor,
  wallet,
  requestKey,
  operationType,
  amountMwk = null,
  pointsDelta = null,
  sourceTransactionPublicId = null,
  reasonCode,
  note,
  metadata = null,
}) {
  const existing = await findWalletOperationRequestByKey(db, requestKey)
  if (existing?.public_id) {
    return resolveWalletOperationRequestOrThrow(db, existing.public_id)
  }

  const policy = buildWalletApprovalPolicy(await listWalletPolicySettings(db))
  const approval = determineWalletApproval({
    operationType,
    amountMwk,
    actorRole: actor.primaryRole,
    actorUserId: actor.userId,
    requesterUserId: actor.userId,
    policy,
  })

  const publicId = createPublicId()
  const normalizedAmount = amountMwk === null || amountMwk === undefined ? null : toNumber(amountMwk)
  const normalizedPointsDelta = pointsDelta === null || pointsDelta === undefined ? null : toInteger(pointsDelta)

  await db.$executeRaw`
    INSERT INTO wallet_operation_requests (
      public_id,
      request_key,
      wallet_id,
      destination_wallet_id,
      operation_type,
      requested_by_user_id,
      requested_by_role,
      status,
      amount_mwk,
      points_delta,
      currency_code,
      source_transaction_public_id,
      reason_code,
      note,
      approval_required,
      metadata_json
    )
    VALUES (
      ${publicId},
      ${requestKey},
      ${wallet.id},
      ${metadata?.destinationWalletId || null},
      ${operationType},
      ${actor.userId},
      ${actor.primaryRole || null},
      ${approval.requiresApproval ? "PENDING" : "EXECUTED"},
      ${normalizedAmount},
      ${normalizedPointsDelta},
      ${wallet.currencyCode},
      ${sourceTransactionPublicId || null},
      ${reasonCode},
      ${note},
      ${approval.requiresApproval ? 1 : 0},
      ${metadata ? JSON.stringify(metadata) : null}
    )
  `

  const requestRow = await resolveWalletOperationRequestOrThrow(db, publicId, { forUpdate: !approval.requiresApproval })

  if (!approval.requiresApproval) {
    await executeWalletOperationRequest(db, requestRow, actor)
  } else {
    await createWalletAuditLog(db, {
      walletId: wallet.id,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed:
        operationType === WALLET_OPERATION_TYPES.REFUND_REQUEST
          ? INTERNAL_PERMISSIONS.WALLET_REFUND_REQUEST
          : operationType === WALLET_OPERATION_TYPES.WALLET_CREDIT
            ? INTERNAL_PERMISSIONS.WALLET_WALLET_CREDIT_ISSUE
            : operationType === WALLET_OPERATION_TYPES.LEDGER_ADJUSTMENT
              ? INTERNAL_PERMISSIONS.WALLET_LEDGER_ADJUST
              : INTERNAL_PERMISSIONS.WALLET_BALANCE_TRANSFER,
      actionType: "WALLET_OPERATION_REQUEST_CREATED",
      actionSummary: `Wallet operation request ${publicId} created.`,
      entityType: "WALLET_OPERATION_REQUEST",
      entityId: publicId,
      amountDeltaMwk: normalizedAmount,
      pointsDelta: normalizedPointsDelta,
      reasonCode,
      note,
      approvalRequestId: Number(requestRow.id || 0) || null,
      correlationId: requestKey,
      metadata: {
        operationType,
        approvalRequired: true,
        sourceTransactionPublicId: sourceTransactionPublicId || null,
      },
    })
  }

  return resolveWalletOperationRequestOrThrow(db, publicId)
}

export async function lookupWalletByDisplayId({ displayId }) {
  await ensureWalletOpsTablesReady()
  const wallet = await resolveWalletByPublicIdOrThrow(prisma, displayId)
  return {
    walletPublicId: wallet.walletPublicId,
    customerName: wallet.fullName,
    status: wallet.derivedStatus,
    createdAt: wallet.createdAt,
    lastActivityAt: wallet.lastActivityAt,
  }
}

export async function getWalletConsole({ walletId, transactionPage = 1, transactionLimit = 10 }) {
  await ensureWalletOpsTablesReady()
  const wallet = await resolveWalletByPublicIdOrThrow(prisma, walletId)
  return buildWalletConsoleData(prisma, wallet, { transactionPage, transactionLimit })
}

export async function listWalletTransactions({ walletId, page = 1, limit = 25, transactionType = "", transactionStatus = "" }) {
  await ensureWalletOpsTablesReady()
  const wallet = await resolveWalletByPublicIdOrThrow(prisma, walletId)
  const data = await getUserWalletTransactions(wallet.userId, {
    page,
    limit,
    transactionType: String(transactionType || "").trim() || null,
    transactionStatus: String(transactionStatus || "").trim() || null,
  })
  return {
    ...data,
    items: (data.items || []).map((item) => ({
      ...item,
      sourceChannel: inferTransactionChannel(item),
      linkedReference: item.transactionPublicId || item.relatedEntityId || item.externalReference || null,
    })),
  }
}

export async function listWalletPointsHistory({ walletId, limit = 50 }) {
  await ensureWalletOpsTablesReady()
  const wallet = await resolveWalletByPublicIdOrThrow(prisma, walletId)
  await ensurePointsProfile(prisma, wallet.id)
  const rows = await prisma.$queryRaw`
    SELECT
      wpa.public_id,
      wpa.delta_points,
      wpa.direction,
      wpa.reason_code,
      wpa.note,
      wpa.created_at,
      u.full_name AS created_by_name
    FROM wallet_points_adjustments wpa
    INNER JOIN users u ON u.id = wpa.created_by_user_id
    WHERE wpa.wallet_id = ${wallet.id}
    ORDER BY wpa.created_at DESC, wpa.id DESC
    LIMIT ${Math.max(1, Math.min(200, Number(limit || 50)))}
  `
  return (rows || []).map((row) => ({
    publicId: String(row.public_id || "").trim(),
    deltaPoints: toInteger(row.delta_points),
    direction: String(row.direction || "").trim().toUpperCase(),
    reasonCode: String(row.reason_code || "").trim() || null,
    note: String(row.note || "").trim() || null,
    createdAt: toIsoOrNull(row.created_at),
    createdByName: String(row.created_by_name || "").trim() || "Internal user",
  }))
}

export async function listWalletAuditLogs({ walletId, limit = 80 }) {
  await ensureWalletOpsTablesReady()
  const wallet = await resolveWalletByPublicIdOrThrow(prisma, walletId)
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 80)))
  const rows = await prisma.$queryRaw`
    SELECT
      wal.id,
      wal.actor_user_id,
      wal.actor_role,
      wal.capability_used,
      wal.target_user_id,
      wal.action_type,
      wal.action_summary,
      wal.entity_type,
      wal.entity_id,
      wal.amount_delta_mwk,
      wal.points_delta,
      wal.balance_before_json,
      wal.balance_after_json,
      wal.reason_code,
      wal.note,
      wal.approval_request_id,
      wal.correlation_id,
      wal.debit_ledger_entry_id,
      wal.credit_ledger_entry_id,
      wal.metadata_json,
      wal.created_at,
      actor.full_name AS actor_name
    FROM wallet_audit_logs wal
    LEFT JOIN users actor ON actor.id = wal.actor_user_id
    WHERE wal.wallet_id = ${wallet.id}
    ORDER BY wal.created_at DESC, wal.id DESC
    LIMIT ${safeLimit}
  `
  return (rows || []).map((row) => ({
    id: Number(row.id || 0),
    actorName: String(row.actor_name || "").trim() || "Internal user",
    actorRole: String(row.actor_role || "").trim() || null,
    capabilityUsed: String(row.capability_used || "").trim() || null,
    actionType: String(row.action_type || "").trim() || null,
    actionSummary: String(row.action_summary || "").trim() || null,
    entityType: String(row.entity_type || "").trim() || null,
    entityId: String(row.entity_id || "").trim() || null,
    amountDeltaMwk: row.amount_delta_mwk === null || row.amount_delta_mwk === undefined ? null : toNumber(row.amount_delta_mwk),
    pointsDelta: row.points_delta === null || row.points_delta === undefined ? null : toInteger(row.points_delta),
    balanceBefore: parseJson(row.balance_before_json, null),
    balanceAfter: parseJson(row.balance_after_json, null),
    reasonCode: String(row.reason_code || "").trim() || null,
    note: String(row.note || "").trim() || null,
    approvalRequestId: row.approval_request_id ? Number(row.approval_request_id) : null,
    correlationId: String(row.correlation_id || "").trim() || null,
    metadata: parseJson(row.metadata_json, null),
    createdAt: toIsoOrNull(row.created_at),
  }))
}

export async function exportWalletStatement({ walletId, dateFrom = "", dateTo = "" }) {
  await ensureWalletOpsTablesReady()
  const wallet = await resolveWalletByPublicIdOrThrow(prisma, walletId)
  const consoleData = await buildWalletConsoleData(prisma, wallet, { transactionPage: 1, transactionLimit: 100 })
  const startDate = String(dateFrom || "").trim()
  const endDate = String(dateTo || "").trim()
  const filteredTransactions = (consoleData.transactions.items || []).filter((item) => {
    const createdAt = new Date(item.postedAt || item.createdAt || 0)
    if (Number.isNaN(createdAt.getTime())) return true
    if (startDate && createdAt < new Date(`${startDate}T00:00:00.000Z`)) return false
    if (endDate && createdAt > new Date(`${endDate}T23:59:59.999Z`)) return false
    return true
  })

  const lines = [
    `"Wallet Display ID","${wallet.walletPublicId}"`,
    `"Wallet Owner","${wallet.fullName.replace(/"/g, '""')}"`,
    `"Current Available Balance","${consoleData.balances.availableBalance}"`,
    `"Current Held Balance","${consoleData.balances.heldBalance}"`,
    `"Period From","${startDate || "-"}"`,
    `"Period To","${endDate || "-"}"`,
    "",
    `"Datetime","Reference","Type","Direction","Amount","Status","Source","Linked Ref"`,
    ...filteredTransactions.map((item) => [
      item.postedAt || item.createdAt || "",
      item.reference || "",
      item.type || "",
      item.direction || "",
      item.amount ?? "",
      item.status || "",
      item.sourceChannel || "",
      item.linkedReference || "",
    ].map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")),
  ]

  return {
    filename: formatWalletStatementFilename(wallet.walletPublicId),
    content: lines.join("\n"),
  }
}

export async function createWalletPointsAdjustment({ actor, walletId, deltaPoints, reasonCode, note, requestKey, auditContext = {} }) {
  await ensureWalletOpsTablesReady()
  const result = await prisma.$transaction(async (tx) => {
    const wallet = await resolveWalletByPublicIdOrThrow(tx, walletId, { forUpdate: true })
    const normalizedDelta = toInteger(deltaPoints)
    const normalizedReasonCode = String(reasonCode || "").trim()
    const normalizedNote = String(note || "").trim()
    const correlationId = buildMutationCorrelationId(requestKey)

    if (normalizedDelta === 0) throw badRequest("deltaPoints cannot be zero.")
    if (!normalizedReasonCode) throw badRequest("reasonCode is required.")
    if (!normalizedNote) throw badRequest("note is required.")

    const existingAudit = await getExistingAuditLogByCorrelation(tx, wallet.id, correlationId, "WALLET_POINTS_ADJUSTED")
    if (existingAudit?.id) {
      return {
        created: false,
        walletPublicId: wallet.walletPublicId,
      }
    }

    const profile = await ensurePointsProfile(tx, wallet.id)
    const beforePoints = toInteger(profile?.points_balance)
    const afterPoints = beforePoints + normalizedDelta
    if (afterPoints < 0) throw badRequest("Points balance cannot go below zero.")

    await tx.$executeRaw`
      UPDATE wallet_points_profiles
      SET
        points_balance = ${afterPoints},
        last_activity_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE wallet_id = ${wallet.id}
    `

    const publicId = createPublicId()
    await tx.$executeRaw`
      INSERT INTO wallet_points_adjustments (
        public_id,
        wallet_id,
        operation_request_id,
        created_by_user_id,
        delta_points,
        direction,
        reason_code,
        note
      )
      VALUES (
        ${publicId},
        ${wallet.id},
        NULL,
        ${actor.userId},
        ${normalizedDelta},
        ${normalizedDelta > 0 ? "CREDIT" : "DEBIT"},
        ${normalizedReasonCode},
        ${normalizedNote}
      )
    `

    const balances = await getWalletBalanceSnapshot(tx, wallet.id)
    await createWalletAuditLog(tx, {
      walletId: wallet.id,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_POINTS_ADJUST,
      actionType: "WALLET_POINTS_ADJUSTED",
      actionSummary: `Points adjusted by ${normalizedDelta} for ${wallet.walletPublicId}.`,
      entityType: "WALLET_POINTS_ADJUSTMENT",
      entityId: publicId,
      pointsDelta: normalizedDelta,
      balanceBefore: { ...balances, pointsBalance: beforePoints },
      balanceAfter: { ...balances, pointsBalance: afterPoints },
      reasonCode: normalizedReasonCode,
      note: normalizedNote,
      correlationId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    })

    return {
      created: true,
      walletPublicId: wallet.walletPublicId,
    }
  })
  return {
    created: result.created,
    wallet: await getWalletConsole({ walletId: result.walletPublicId }),
  }
}

export async function createWalletRefundRequest({ actor, walletId, sourceTransactionPublicId, amountMwk, reasonCode, note, requestKey }) {
  await ensureWalletOpsTablesReady()
  return prisma.$transaction(async (tx) => {
    const wallet = await resolveWalletByPublicIdOrThrow(tx, walletId, { forUpdate: true })
    const normalizedAmount = toNumber(amountMwk)
    const normalizedReasonCode = String(reasonCode || "").trim()
    const normalizedNote = String(note || "").trim()
    const correlationId = buildMutationCorrelationId(requestKey)

    if (!(normalizedAmount > 0)) throw badRequest("amountMwk must be greater than zero.")
    if (!normalizedReasonCode) throw badRequest("reasonCode is required.")
    if (!normalizedNote) throw badRequest("note is required.")
    await resolveTransactionForRefundOrThrow(tx, wallet, sourceTransactionPublicId)

    const requestRow = await createWalletOperationRequest(tx, {
      actor,
      wallet,
      requestKey: correlationId,
      operationType: WALLET_OPERATION_TYPES.REFUND_REQUEST,
      amountMwk: normalizedAmount,
      sourceTransactionPublicId,
      reasonCode: normalizedReasonCode,
      note: normalizedNote,
      metadata: {
        sourceTransactionPublicId,
      },
    })

    return normalizeOperationRequest(requestRow, actor)
  })
}

export async function createWalletCreditRequest({ actor, walletId, amountMwk, reasonCode, note, requestKey }) {
  await ensureWalletOpsTablesReady()
  return prisma.$transaction(async (tx) => {
    const wallet = await resolveWalletByPublicIdOrThrow(tx, walletId, { forUpdate: true })
    const normalizedAmount = toNumber(amountMwk)
    const normalizedReasonCode = String(reasonCode || "").trim()
    const normalizedNote = String(note || "").trim()
    const correlationId = buildMutationCorrelationId(requestKey)

    if (!(normalizedAmount > 0)) throw badRequest("amountMwk must be greater than zero.")
    if (!normalizedReasonCode) throw badRequest("reasonCode is required.")
    if (!normalizedNote) throw badRequest("note is required.")

    const requestRow = await createWalletOperationRequest(tx, {
      actor,
      wallet,
      requestKey: correlationId,
      operationType: WALLET_OPERATION_TYPES.WALLET_CREDIT,
      amountMwk: normalizedAmount,
      reasonCode: normalizedReasonCode,
      note: normalizedNote,
    })

    return normalizeOperationRequest(requestRow, actor)
  })
}

export async function createWalletLedgerAdjustmentRequest({ actor, walletId, amountMwk, direction, reasonCode, note, requestKey }) {
  await ensureWalletOpsTablesReady()
  return prisma.$transaction(async (tx) => {
    const wallet = await resolveWalletByPublicIdOrThrow(tx, walletId, { forUpdate: true })
    const normalizedAmount = toNumber(amountMwk)
    const normalizedDirection = String(direction || "").trim().toUpperCase()
    const normalizedReasonCode = String(reasonCode || "").trim()
    const normalizedNote = String(note || "").trim()
    const correlationId = buildMutationCorrelationId(requestKey)

    if (!(normalizedAmount > 0)) throw badRequest("amountMwk must be greater than zero.")
    if (!["CREDIT", "DEBIT"].includes(normalizedDirection)) throw badRequest("direction must be CREDIT or DEBIT.")
    if (!normalizedReasonCode) throw badRequest("reasonCode is required.")
    if (!normalizedNote) throw badRequest("note is required.")

    const requestRow = await createWalletOperationRequest(tx, {
      actor,
      wallet,
      requestKey: correlationId,
      operationType: WALLET_OPERATION_TYPES.LEDGER_ADJUSTMENT,
      amountMwk: normalizedAmount,
      reasonCode: normalizedReasonCode,
      note: normalizedNote,
      metadata: { direction: normalizedDirection },
    })

    return normalizeOperationRequest(requestRow, actor)
  })
}

export async function createWalletBalanceTransferRequest({
  actor,
  walletId,
  amountMwk,
  destinationWalletDisplayId = "",
  destinationSystemAccountCode = "",
  reasonCode,
  note,
  requestKey,
}) {
  await ensureWalletOpsTablesReady()
  return prisma.$transaction(async (tx) => {
    const wallet = await resolveWalletByPublicIdOrThrow(tx, walletId, { forUpdate: true })
    const normalizedAmount = toNumber(amountMwk)
    const normalizedReasonCode = String(reasonCode || "").trim()
    const normalizedNote = String(note || "").trim()
    const normalizedDestinationWalletDisplayId = String(destinationWalletDisplayId || "").trim()
    const normalizedDestinationSystemAccountCode = String(destinationSystemAccountCode || "").trim()
    const correlationId = buildMutationCorrelationId(requestKey)

    if (!(normalizedAmount > 0)) throw badRequest("amountMwk must be greater than zero.")
    if (!normalizedReasonCode) throw badRequest("reasonCode is required.")
    if (!normalizedNote) throw badRequest("note is required.")
    if (!normalizedDestinationWalletDisplayId && !normalizedDestinationSystemAccountCode) {
      throw badRequest("A destination wallet or system account is required.")
    }

    const metadata = {}
    if (normalizedDestinationWalletDisplayId) {
      const destinationWallet = await resolveWalletByPublicIdOrThrow(tx, normalizedDestinationWalletDisplayId)
      if (destinationWallet.id === wallet.id) throw badRequest("Source and destination wallets must be different.")
      if (destinationWallet.currencyCode !== wallet.currencyCode) throw badRequest("Wallet transfers require matching currency.")
      metadata.destinationWalletId = destinationWallet.id
      metadata.destinationWalletDisplayId = destinationWallet.walletPublicId
    }
    if (normalizedDestinationSystemAccountCode) {
      await resolveSystemAccountOrThrow(tx, normalizedDestinationSystemAccountCode, wallet.currencyCode)
      metadata.destinationSystemAccountCode = normalizedDestinationSystemAccountCode
    }

    const requestRow = await createWalletOperationRequest(tx, {
      actor,
      wallet,
      requestKey: correlationId,
      operationType: WALLET_OPERATION_TYPES.BALANCE_TRANSFER,
      amountMwk: normalizedAmount,
      reasonCode: normalizedReasonCode,
      note: normalizedNote,
      metadata,
    })

    return normalizeOperationRequest(requestRow, actor)
  })
}

export async function freezeWallet({ actor, walletId, reasonCode, note, requestKey, auditContext = {} }) {
  await ensureWalletOpsTablesReady()
  const walletPublicId = await prisma.$transaction(async (tx) => {
    const wallet = await resolveWalletByPublicIdOrThrow(tx, walletId, { forUpdate: true })
    const normalizedReasonCode = String(reasonCode || "").trim()
    const normalizedNote = String(note || "").trim()
    const correlationId = buildMutationCorrelationId(requestKey)

    if (!normalizedReasonCode) throw badRequest("reasonCode is required.")
    if (!normalizedNote) throw badRequest("note is required.")
    if (wallet.status === "CLOSED") throw badRequest("Closed wallets cannot be frozen.")

    const existingAudit = await getExistingAuditLogByCorrelation(tx, wallet.id, correlationId, "WALLET_FROZEN")
    if (existingAudit?.id) {
      return wallet.walletPublicId
    }

    const beforeBalances = await getWalletBalanceSnapshot(tx, wallet.id)
    const beforeState = { status: wallet.derivedStatus, ...beforeBalances }

    if (wallet.status !== "SUSPENDED") {
      await tx.$executeRaw`
        UPDATE wallets
        SET
          status = 'SUSPENDED',
          suspended_at = CURRENT_TIMESTAMP(3),
          suspended_reason_code = ${normalizedReasonCode},
          suspended_note = ${normalizedNote},
          suspended_by_user_id = ${actor.userId},
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${wallet.id}
      `
    }

    const afterWallet = await resolveWalletByPublicIdOrThrow(tx, wallet.walletPublicId)
    const afterBalances = await getWalletBalanceSnapshot(tx, wallet.id)
    await createWalletAuditLog(tx, {
      walletId: wallet.id,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_FREEZE,
      actionType: "WALLET_FROZEN",
      actionSummary: `Wallet ${wallet.walletPublicId} frozen.`,
      amountDeltaMwk: null,
      balanceBefore: beforeState,
      balanceAfter: { status: afterWallet.derivedStatus, ...afterBalances },
      reasonCode: normalizedReasonCode,
      note: normalizedNote,
      correlationId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    })

    return afterWallet.walletPublicId
  })
  return getWalletConsole({ walletId: walletPublicId })
}

export async function unfreezeWallet({ actor, walletId, reasonCode, note, requestKey, auditContext = {} }) {
  await ensureWalletOpsTablesReady()
  const walletPublicId = await prisma.$transaction(async (tx) => {
    const wallet = await resolveWalletByPublicIdOrThrow(tx, walletId, { forUpdate: true })
    const normalizedReasonCode = String(reasonCode || "").trim()
    const normalizedNote = String(note || "").trim()
    const correlationId = buildMutationCorrelationId(requestKey)

    if (!normalizedReasonCode) throw badRequest("reasonCode is required.")
    if (!normalizedNote) throw badRequest("note is required.")
    if (wallet.status === "CLOSED") throw badRequest("Closed wallets cannot be unfrozen.")

    const existingAudit = await getExistingAuditLogByCorrelation(tx, wallet.id, correlationId, "WALLET_UNFROZEN")
    if (existingAudit?.id) {
      return wallet.walletPublicId
    }

    const beforeBalances = await getWalletBalanceSnapshot(tx, wallet.id)
    const beforeState = { status: wallet.derivedStatus, ...beforeBalances }

    await tx.$executeRaw`
      UPDATE wallets
      SET
        status = 'ACTIVE',
        suspended_at = NULL,
        suspended_reason_code = NULL,
        suspended_note = NULL,
        reinstated_at = CURRENT_TIMESTAMP(3),
        reinstated_by_user_id = ${actor.userId},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${wallet.id}
    `

    const afterWallet = await resolveWalletByPublicIdOrThrow(tx, wallet.walletPublicId)
    const afterBalances = await getWalletBalanceSnapshot(tx, wallet.id)
    await createWalletAuditLog(tx, {
      walletId: wallet.id,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_UNFREEZE,
      actionType: "WALLET_UNFROZEN",
      actionSummary: `Wallet ${wallet.walletPublicId} unfrozen.`,
      balanceBefore: beforeState,
      balanceAfter: { status: afterWallet.derivedStatus, ...afterBalances },
      reasonCode: normalizedReasonCode,
      note: normalizedNote,
      correlationId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    })

    return afterWallet.walletPublicId
  })
  return getWalletConsole({ walletId: walletPublicId })
}

export async function markWalletUnderReview({ actor, walletId, reasonCode, note, requestKey, auditContext = {} }) {
  await ensureWalletOpsTablesReady()
  const walletPublicId = await prisma.$transaction(async (tx) => {
    const wallet = await resolveWalletByPublicIdOrThrow(tx, walletId, { forUpdate: true })
    const normalizedReasonCode = String(reasonCode || "").trim()
    const normalizedNote = String(note || "").trim()
    const correlationId = buildMutationCorrelationId(requestKey)

    if (!normalizedReasonCode) throw badRequest("reasonCode is required.")
    if (!normalizedNote) throw badRequest("note is required.")

    const existingAudit = await getExistingAuditLogByCorrelation(tx, wallet.id, correlationId, "WALLET_MARKED_UNDER_REVIEW")
    if (existingAudit?.id) {
      return wallet.walletPublicId
    }

    const beforeBalances = await getWalletBalanceSnapshot(tx, wallet.id)
    const beforeState = { status: wallet.derivedStatus, isUnderReview: wallet.isUnderReview, ...beforeBalances }

    await tx.$executeRaw`
      UPDATE wallets
      SET
        is_under_review = 1,
        under_review_at = CURRENT_TIMESTAMP(3),
        under_review_by_user_id = ${actor.userId},
        under_review_reason_code = ${normalizedReasonCode},
        under_review_note = ${normalizedNote},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${wallet.id}
    `

    const afterWallet = await resolveWalletByPublicIdOrThrow(tx, wallet.walletPublicId)
    const afterBalances = await getWalletBalanceSnapshot(tx, wallet.id)
    await createWalletAuditLog(tx, {
      walletId: wallet.id,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_REVIEW_MARK,
      actionType: "WALLET_MARKED_UNDER_REVIEW",
      actionSummary: `Wallet ${wallet.walletPublicId} marked under review.`,
      balanceBefore: beforeState,
      balanceAfter: { status: afterWallet.derivedStatus, isUnderReview: afterWallet.isUnderReview, ...afterBalances },
      reasonCode: normalizedReasonCode,
      note: normalizedNote,
      correlationId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    })

    return afterWallet.walletPublicId
  })
  return getWalletConsole({ walletId: walletPublicId })
}

export async function placeWalletHold({ actor, walletId, amountMwk, reasonCode, note, requestKey, auditContext = {} }) {
  await ensureWalletOpsTablesReady()
  const result = await prisma.$transaction(async (tx) => {
    const wallet = await resolveWalletByPublicIdOrThrow(tx, walletId, { forUpdate: true })
    const normalizedAmount = toNumber(amountMwk)
    const normalizedReasonCode = String(reasonCode || "").trim()
    const normalizedNote = String(note || "").trim()
    const correlationId = buildMutationCorrelationId(requestKey)

    if (!(normalizedAmount > 0)) throw badRequest("amountMwk must be greater than zero.")
    if (!normalizedReasonCode) throw badRequest("reasonCode is required.")
    if (!normalizedNote) throw badRequest("note is required.")

    const rows = await tx.$queryRaw`
      SELECT id, reference, status, amount, currency_code, related_entity_type, related_entity_id, created_at, released_at
      FROM wallet_reservation_holds
      WHERE wallet_id = ${wallet.id}
        AND hold_type = 'MANUAL_HOLD'
        AND related_entity_type = 'WALLET_REQUEST'
        AND related_entity_id = ${correlationId}
      ORDER BY id DESC
      LIMIT 1
    `
    const existingHold = rows?.[0] || null
    if (existingHold?.id) {
      return {
        hold: {
          id: Number(existingHold.id),
          reference: String(existingHold.reference || "").trim(),
          status: String(existingHold.status || "").trim().toUpperCase(),
          amount: toNumber(existingHold.amount),
          currencyCode: String(existingHold.currency_code || DEFAULT_CURRENCY_CODE).trim() || DEFAULT_CURRENCY_CODE,
          createdAt: toIsoOrNull(existingHold.created_at),
          releasedAt: toIsoOrNull(existingHold.released_at),
        },
        walletPublicId: wallet.walletPublicId,
      }
    }

    const beforeBalances = await getWalletBalanceSnapshot(tx, wallet.id)
    if (beforeBalances.availableBalance < normalizedAmount) {
      throw badRequest("Insufficient available balance to place hold.")
    }

    const holdReference = `WHL-${createPublicId()}`
    await tx.$executeRaw`
      INSERT INTO wallet_reservation_holds (
        wallet_id,
        ledger_transaction_id,
        reference,
        hold_type,
        status,
        amount,
        currency_code,
        placed_by_user_id,
        released_by_user_id,
        reason_code,
        note,
        related_entity_type,
        related_entity_id,
        expires_at,
        released_at,
        captured_at
      )
      VALUES (
        ${wallet.id},
        NULL,
        ${holdReference},
        'MANUAL_HOLD',
        'ACTIVE',
        ${normalizedAmount},
        ${wallet.currencyCode},
        ${actor.userId},
        NULL,
        ${normalizedReasonCode},
        ${normalizedNote},
        'WALLET_REQUEST',
        ${correlationId},
        NULL,
        NULL,
        NULL
      )
    `

    const holdRows = await tx.$queryRaw`
      SELECT id, reference, status, amount, currency_code, created_at, released_at
      FROM wallet_reservation_holds
      WHERE reference = ${holdReference}
      LIMIT 1
    `
    const hold = holdRows?.[0] || null
    const afterBalances = await getWalletBalanceSnapshot(tx, wallet.id)
    await createWalletAuditLog(tx, {
      walletId: wallet.id,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_HOLD_PLACE,
      actionType: "WALLET_HOLD_PLACED",
      actionSummary: `Manual hold ${holdReference} placed on wallet ${wallet.walletPublicId}.`,
      entityType: "WALLET_HOLD",
      entityId: holdReference,
      amountDeltaMwk: -Math.abs(normalizedAmount),
      balanceBefore: beforeBalances,
      balanceAfter: afterBalances,
      reasonCode: normalizedReasonCode,
      note: normalizedNote,
      correlationId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    })

    return {
      hold: {
        id: Number(hold?.id || 0),
        reference: String(hold?.reference || "").trim(),
        status: String(hold?.status || "").trim().toUpperCase(),
        amount: toNumber(hold?.amount),
        currencyCode: String(hold?.currency_code || wallet.currencyCode).trim() || wallet.currencyCode,
        createdAt: toIsoOrNull(hold?.created_at),
        releasedAt: toIsoOrNull(hold?.released_at),
      },
      walletPublicId: wallet.walletPublicId,
    }
  })
  return {
    hold: result.hold,
    wallet: await getWalletConsole({ walletId: result.walletPublicId }),
  }
}

export async function releaseWalletHold({ actor, walletId, holdId, reasonCode, note, requestKey, auditContext = {} }) {
  await ensureWalletOpsTablesReady()
  const walletPublicId = await prisma.$transaction(async (tx) => {
    const wallet = await resolveWalletByPublicIdOrThrow(tx, walletId, { forUpdate: true })
    const normalizedReasonCode = String(reasonCode || "").trim()
    const normalizedNote = String(note || "").trim()
    const correlationId = buildMutationCorrelationId(requestKey)
    const safeHoldId = Number(holdId || 0)

    if (!safeHoldId) throw badRequest("A valid holdId is required.")
    if (!normalizedReasonCode) throw badRequest("reasonCode is required.")
    if (!normalizedNote) throw badRequest("note is required.")

    const existingAudit = await getExistingAuditLogByCorrelation(tx, wallet.id, correlationId, "WALLET_HOLD_RELEASED")
    if (existingAudit?.id) {
      return wallet.walletPublicId
    }

    const holdRows = await tx.$queryRaw`
      SELECT id, reference, status, amount, currency_code, created_at, released_at
      FROM wallet_reservation_holds
      WHERE id = ${safeHoldId}
        AND wallet_id = ${wallet.id}
        AND hold_type = 'MANUAL_HOLD'
      LIMIT 1
      FOR UPDATE
    `
    const hold = holdRows?.[0] || null
    if (!hold?.id) throw notFound("Wallet hold not found.")
    if (String(hold.status || "").trim().toUpperCase() !== "ACTIVE") {
      throw badRequest("Only active holds can be released.")
    }

    const beforeBalances = await getWalletBalanceSnapshot(tx, wallet.id)
    await tx.$executeRaw`
      UPDATE wallet_reservation_holds
      SET
        status = 'RELEASED',
        released_at = CURRENT_TIMESTAMP(3),
        released_by_user_id = ${actor.userId},
        reason_code = COALESCE(${normalizedReasonCode}, reason_code),
        note = ${normalizedNote},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${safeHoldId}
    `

    const afterBalances = await getWalletBalanceSnapshot(tx, wallet.id)
    await createWalletAuditLog(tx, {
      walletId: wallet.id,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_HOLD_RELEASE,
      actionType: "WALLET_HOLD_RELEASED",
      actionSummary: `Manual hold ${String(hold.reference || "").trim()} released.`,
      entityType: "WALLET_HOLD",
      entityId: String(hold.reference || "").trim(),
      amountDeltaMwk: Math.abs(toNumber(hold.amount)),
      balanceBefore: beforeBalances,
      balanceAfter: afterBalances,
      reasonCode: normalizedReasonCode,
      note: normalizedNote,
      correlationId,
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    })

    return wallet.walletPublicId
  })
  return {
    wallet: await getWalletConsole({ walletId: walletPublicId }),
  }
}

export async function listWalletOperationRequests({ actor, walletId = "", status = "" }) {
  await ensureWalletOpsTablesReady()
  const scopedWalletId = String(walletId || "").trim()
  const scopedStatus = String(status || "").trim().toUpperCase()
  const rows = await prisma.$queryRaw`
    SELECT
      wor.*,
      w.wallet_public_id,
      owner.full_name AS wallet_owner_name,
      dw.wallet_public_id AS destination_wallet_public_id,
      requester.full_name AS requested_by_name,
      approver.full_name AS approved_by_name,
      rejector.full_name AS rejected_by_name
    FROM wallet_operation_requests wor
    INNER JOIN wallets w ON w.id = wor.wallet_id
    INNER JOIN users owner ON owner.id = w.user_id
    LEFT JOIN wallets dw ON dw.id = wor.destination_wallet_id
    LEFT JOIN users requester ON requester.id = wor.requested_by_user_id
    LEFT JOIN users approver ON approver.id = wor.approved_by_user_id
    LEFT JOIN users rejector ON rejector.id = wor.rejected_by_user_id
    WHERE (${scopedWalletId} = '' OR w.wallet_public_id = ${scopedWalletId})
      AND (${scopedStatus} = '' OR wor.status = ${scopedStatus})
    ORDER BY wor.created_at DESC, wor.id DESC
    LIMIT 150
  `
  return (rows || []).map((row) => normalizeOperationRequest(row, actor))
}

export async function getWalletOperationRequest({ actor, requestId }) {
  await ensureWalletOpsTablesReady()
  return normalizeOperationRequest(await resolveWalletOperationRequestOrThrow(prisma, requestId), actor)
}

export async function approveWalletOperationRequest({ actor, requestId, auditContext = {} }) {
  await ensureWalletOpsTablesReady()
  return prisma.$transaction(async (tx) => {
    const requestRow = await resolveWalletOperationRequestOrThrow(tx, requestId, { forUpdate: true })
    if (String(requestRow.status || "").trim().toUpperCase() !== "PENDING") {
      throw badRequest("Only pending wallet operation requests can be approved.")
    }

    assertCanApproveWalletRequest(actor, requestRow)

    await tx.$executeRaw`
      UPDATE wallet_operation_requests
      SET
        status = 'APPROVED',
        approved_by_user_id = ${actor.userId},
        approved_at = CURRENT_TIMESTAMP(3),
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${requestRow.id}
    `

    const approvedRow = await resolveWalletOperationRequestOrThrow(tx, requestId, { forUpdate: true })
    await executeWalletOperationRequest(tx, approvedRow, actor, auditContext)
    return normalizeOperationRequest(await resolveWalletOperationRequestOrThrow(tx, requestId), actor)
  })
}

export async function rejectWalletOperationRequest({ actor, requestId, rejectionReason }) {
  await ensureWalletOpsTablesReady()
  const normalizedReason = String(rejectionReason || "").trim()
  if (!normalizedReason) throw badRequest("rejectionReason is required.")

  return prisma.$transaction(async (tx) => {
    const requestRow = await resolveWalletOperationRequestOrThrow(tx, requestId, { forUpdate: true })
    if (String(requestRow.status || "").trim().toUpperCase() !== "PENDING") {
      throw badRequest("Only pending wallet operation requests can be rejected.")
    }
    assertCanApproveWalletRequest(actor, requestRow)

    await tx.$executeRaw`
      UPDATE wallet_operation_requests
      SET
        status = 'REJECTED',
        rejected_by_user_id = ${actor.userId},
        rejected_at = CURRENT_TIMESTAMP(3),
        rejection_reason = ${normalizedReason},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${requestRow.id}
    `

    const wallet = await resolveWalletByPublicIdOrThrow(tx, String(requestRow.wallet_public_id || "").trim())
    await createWalletAuditLog(tx, {
      walletId: wallet.id,
      actorUserId: actor.userId,
      actorRole: actor.primaryRole,
      targetUserId: wallet.userId,
      capabilityUsed: INTERNAL_PERMISSIONS.WALLET_AUDIT_VIEW,
      actionType: "WALLET_OPERATION_REQUEST_REJECTED",
      actionSummary: `Wallet operation request ${requestId} rejected.`,
      entityType: "WALLET_OPERATION_REQUEST",
      entityId: requestId,
      reasonCode: String(requestRow.reason_code || "").trim() || null,
      note: normalizedReason,
      approvalRequestId: Number(requestRow.id || 0) || null,
      correlationId: String(requestRow.request_key || "").trim() || null,
      metadata: {
        operationType: String(requestRow.operation_type || "").trim().toUpperCase(),
      },
    })

    return normalizeOperationRequest(await resolveWalletOperationRequestOrThrow(tx, requestId), actor)
  })
}
