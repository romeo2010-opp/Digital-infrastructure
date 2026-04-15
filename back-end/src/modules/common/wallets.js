import { Prisma } from "@prisma/client"
import { prisma } from "../../db/prisma.js"
import { publishUserAlert } from "../../realtime/userAlertsHub.js"
import { createPublicId, createWalletPublicIdValue } from "./db.js"
import { sendPushAlertToUser } from "./pushNotifications.js"
import { createUserAlert, ensureUserAlertsTableReady } from "./userAlerts.js"
import {
  buildWalletStationLockSpendPlan,
  consumeWalletStationLocks,
  createWalletStationLock,
  getWalletTotalLockedBalance,
  listWalletStationLockGroupsByWallet,
  listWalletStationLocks,
} from "./walletStationLocks.js"
import {
  createWalletTransferRecipientQr,
  parseWalletTransferRecipientQrPayload,
} from "./walletTransferQr.js"

const DEFAULT_WALLET_CURRENCY = "MWK"
const MAX_WALLET_PAGE_SIZE = 50
const MAX_WALLET_TOPUP_AMOUNT = 1000000
const SETTLEMENT_PLATFORM_FEE_RATE = 0.008
const WALLET_PAYMENT_TRANSACTION_TYPES = new Set(["PAYMENT", "RESERVATION_PAYMENT", "QUEUE_FEE"])
const WALLET_SYSTEM_ACCOUNT_CODES = {
  PAYMENT_CLEARING: "PAYMENT_CLEARING_MAIN",
  REFUNDS_PAYABLE: "REFUNDS_PAYABLE_MAIN",
  MANUAL_ADJUSTMENTS: "MANUAL_ADJUSTMENTS_MAIN",
  USER_TRANSFER_CLEARING: "USER_TRANSFER_CLEARING_MAIN",
}
const SETTLEMENT_REFERENCE_PREFIX = "STL"

function walletError(message, status = 400) {
  const error = new Error(message)
  error.status = status
  return error
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function toDateOnlyOrNull(value) {
  if (!value) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    return value.toISOString().slice(0, 10)
  }
  const normalized = String(value).trim()
  if (!normalized) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function toMoneyNumber(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(2))
}

function toUpperValue(value, fallback = "") {
  return String(value || fallback)
    .trim()
    .toUpperCase()
}

function parseMetadata(value) {
  if (!value || typeof value !== "string") return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function buildWalletNumber() {
  return `WLT-${createPublicId()}`
}

function buildWalletPublicId() {
  return createWalletPublicIdValue()
}

function buildWalletAccountCode(walletId, currencyCode = DEFAULT_WALLET_CURRENCY) {
  return `WALLET_USER_${walletId}_${toUpperValue(currencyCode, DEFAULT_WALLET_CURRENCY)}`
}

function buildTransactionReference(prefix) {
  return `${prefix}-${createPublicId()}`
}

function buildHoldReference() {
  return `WRH-${createPublicId()}`
}

function buildSettlementReference() {
  return `${SETTLEMENT_REFERENCE_PREFIX}-${createPublicId()}`
}

function calculateSettlementAmounts(grossAmount) {
  const normalizedGross = toMoneyNumber(grossAmount)
  const feeAmount = toMoneyNumber(normalizedGross * SETTLEMENT_PLATFORM_FEE_RATE)
  const netAmount = toMoneyNumber(normalizedGross - feeAmount)
  return {
    grossAmount: normalizedGross,
    feeAmount,
    netAmount,
  }
}

function buildWalletSummary({ wallet, balances, initializedNow = false }) {
  return {
    walletId: Number(wallet?.id || 0),
    walletPublicId: String(wallet?.wallet_public_id || "").trim(),
    walletNumber: String(wallet?.wallet_number || "").trim(),
    internalWalletNumber: String(wallet?.wallet_number || "").trim(),
    status: toUpperValue(wallet?.status, "ACTIVE"),
    currencyCode: String(wallet?.currency_code || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY,
    ledgerBalance: toMoneyNumber(balances?.ledgerBalance),
    availableBalance: toMoneyNumber(balances?.availableBalance),
    lockedBalance: toMoneyNumber(balances?.lockedBalance),
    pendingInflow: toMoneyNumber(balances?.pendingInflow),
    pendingOutflow: toMoneyNumber(balances?.pendingOutflow),
    activeHoldAmount: toMoneyNumber(balances?.activeHoldAmount),
    createdAt: toIsoOrNull(wallet?.created_at),
    updatedAt: toIsoOrNull(wallet?.updated_at),
    initializedNow: Boolean(initializedNow),
  }
}

function normalizeWalletTransactionType(value) {
  const rawType = toUpperValue(value)
  if (WALLET_PAYMENT_TRANSACTION_TYPES.has(rawType)) {
    return {
      type: "PAYMENT",
      typeCode: rawType,
      typeGroup: "PAYMENT",
    }
  }

  return {
    type: rawType,
    typeCode: rawType,
    typeGroup: rawType,
  }
}

function mapWalletTransactionRow(row) {
  const creditAmount = toMoneyNumber(row?.wallet_credit_amount)
  const debitAmount = toMoneyNumber(row?.wallet_debit_amount)
  const normalizedType = normalizeWalletTransactionType(row?.transaction_type)
  let direction = "NEUTRAL"
  let amount = toMoneyNumber(row?.net_amount)

  if (creditAmount > debitAmount) {
    direction = "INFLOW"
    amount = creditAmount
  } else if (debitAmount > creditAmount) {
    direction = "OUTFLOW"
    amount = debitAmount
  }

  return {
    id: Number(row?.id || 0),
    reference: String(row?.transaction_reference || "").trim(),
    type: normalizedType.type,
    typeCode: normalizedType.typeCode,
    typeGroup: normalizedType.typeGroup,
    status: toUpperValue(row?.transaction_status, "PENDING"),
    amount,
    grossAmount: toMoneyNumber(row?.gross_amount),
    netAmount: toMoneyNumber(row?.net_amount),
    feeAmount: toMoneyNumber(row?.fee_amount),
    currencyCode: String(row?.currency_code || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY,
    direction,
    description: String(row?.description || "").trim() || null,
    externalReference: String(row?.external_reference || "").trim() || null,
    transactionPublicId: String(row?.transaction_public_id || "").trim() || null,
    transactionOccurredAt: toIsoOrNull(row?.transaction_occurred_at),
    parentTransactionId: row?.parent_transaction_id ? Number(row.parent_transaction_id) : null,
    relatedEntityType: String(row?.related_entity_type || "").trim() || null,
    relatedEntityId: String(row?.related_entity_id || "").trim() || null,
    metadata: parseMetadata(row?.metadata_json),
    createdAt: toIsoOrNull(row?.created_at),
    postedAt: toIsoOrNull(row?.posted_at),
    failedAt: toIsoOrNull(row?.failed_at),
    reversedAt: toIsoOrNull(row?.reversed_at),
  }
}

function mapWalletHoldRow(row) {
  return {
    id: Number(row?.id || 0),
    reference: String(row?.reference || "").trim(),
    holdType: toUpperValue(row?.hold_type),
    status: toUpperValue(row?.status, "ACTIVE"),
    amount: toMoneyNumber(row?.amount),
    currencyCode: String(row?.currency_code || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY,
    relatedEntityType: String(row?.related_entity_type || "").trim() || null,
    relatedEntityId: String(row?.related_entity_id || "").trim() || null,
    expiresAt: toIsoOrNull(row?.expires_at),
    createdAt: toIsoOrNull(row?.created_at),
    capturedAt: toIsoOrNull(row?.captured_at),
    releasedAt: toIsoOrNull(row?.released_at),
  }
}

function mapReservationHoldRow(row) {
  if (!row?.id) return null
  return {
    id: Number(row.id),
    walletId: Number(row.wallet_id || 0),
    userId: Number(row.user_id || 0),
    reference: String(row.reference || "").trim(),
    status: toUpperValue(row.status, "ACTIVE"),
    amount: toMoneyNumber(row.amount),
    currencyCode: String(row.currency_code || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY,
    relatedEntityId: String(row.related_entity_id || "").trim() || null,
    ledgerTransactionId: row.ledger_transaction_id ? Number(row.ledger_transaction_id) : null,
    expiresAt: toIsoOrNull(row.expires_at),
    createdAt: toIsoOrNull(row.created_at),
    capturedAt: toIsoOrNull(row.captured_at),
    releasedAt: toIsoOrNull(row.released_at),
  }
}

function mapSettlementBatchRow(row) {
  if (!row?.public_id) return null
  return {
    id: Number(row.id || 0),
    publicId: String(row.public_id || "").trim(),
    sourceReference: String(row.source_reference || "").trim() || null,
    stationId: Number(row.station_id || 0) || null,
    relatedEntityType: String(row.related_entity_type || "").trim() || null,
    relatedEntityId: String(row.related_entity_id || "").trim() || null,
    sourceTransactionReference: String(row.source_transaction_reference || "").trim() || null,
    batchDate: toDateOnlyOrNull(row.batch_date),
    amount: toMoneyNumber(row.net_amount),
    grossAmount: toMoneyNumber(row.gross_amount),
    feeAmount: toMoneyNumber(row.fee_amount),
    netAmount: toMoneyNumber(row.net_amount),
    status: toUpperValue(row.status, "PENDING"),
    metadata: parseMetadata(row.metadata_json),
    approvedAt: toIsoOrNull(row.approved_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

export function isWalletFoundationTableMissingError(error) {
  const message = String(error?.message || "").toLowerCase()
  const mentionsWalletTable =
    message.includes(" wallets ") ||
    message.includes("wallets") ||
    message.includes("wallet_balances") ||
    message.includes("ledger_accounts") ||
    message.includes("ledger_transactions") ||
    message.includes("ledger_entries") ||
    message.includes("wallet_reservation_holds") ||
    message.includes("wallet_audit_logs") ||
    message.includes("wallet_station_locks") ||
    message.includes("wallet_user_transfers")

  if (!mentionsWalletTable) return false
  return (
    message.includes("doesn't exist") ||
    message.includes("does not exist") ||
    message.includes("unknown table") ||
    message.includes("unknown column")
  )
}

export function isWalletDuplicateEntryError(error) {
  const message = String(error?.message || "").toLowerCase()
  return message.includes("duplicate entry")
}

export async function ensureWalletTablesReady() {
  try {
    await prisma.$queryRaw`
      SELECT id, user_id, wallet_number, wallet_public_id
      FROM wallets
      LIMIT 1
    `
    await prisma.$queryRaw`
      SELECT id, wallet_id, ledger_balance
      FROM wallet_balances
      LIMIT 1
    `
    await prisma.$queryRaw`
      SELECT id, account_code, currency_code
      FROM ledger_accounts
      LIMIT 1
    `
    await prisma.$queryRaw`
      SELECT id, transaction_reference, transaction_type
      FROM ledger_transactions
      LIMIT 1
    `
    await prisma.$queryRaw`
      SELECT id, ledger_transaction_id, ledger_account_id
      FROM ledger_entries
      LIMIT 1
    `
    await prisma.$queryRaw`
      SELECT id, wallet_id, reference
      FROM wallet_reservation_holds
      LIMIT 1
    `
    await prisma.$queryRaw`
      SELECT id, wallet_id, action_type
      FROM wallet_audit_logs
      LIMIT 1
    `
    await prisma.$queryRaw`
      SELECT id, wallet_id, station_id
      FROM wallet_station_locks
      LIMIT 1
    `
  } catch (error) {
    if (isWalletFoundationTableMissingError(error)) {
      const wrapped = new Error(
        "Wallet storage is unavailable. Run SQL migrations 034_wallet_ledger_foundation.sql and 052_wallet_user_transfers_station_locks.sql."
      )
      wrapped.cause = error
      throw wrapped
    }
    throw error
  }
}

function isSettlementBatchStorageError(error) {
  const message = String(error?.message || "").toLowerCase()
  if (!message.includes("settlement_batches")) return false
  return (
    message.includes("doesn't exist") ||
    message.includes("does not exist") ||
    message.includes("unknown table") ||
    message.includes("unknown column")
  )
}

async function ensureSettlementBatchStorageReady(db = prisma) {
  try {
    await db.$queryRaw`
      SELECT
        id,
        public_id,
        source_reference,
        related_entity_type,
        related_entity_id,
        source_transaction_reference,
        metadata_json
      FROM settlement_batches
      LIMIT 1
    `
  } catch (error) {
    if (isSettlementBatchStorageError(error)) {
      const wrapped = new Error(
        "Finance settlement storage is unavailable. Run SQL migrations 025_internal_company_dashboard.sql and 035_settlement_batch_wallet_links.sql."
      )
      wrapped.cause = error
      throw wrapped
    }
    throw error
  }
}

async function getWalletLedgerAccount(db, walletId) {
  const rows = await db.$queryRaw`
    SELECT id, wallet_id, account_code, account_name, currency_code, status
    FROM ledger_accounts
    WHERE wallet_id = ${walletId}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function getMappedWalletTransaction(
  db,
  walletId,
  walletAccountId,
  { transactionId = null, transactionReference = null, idempotencyKey = null } = {}
) {
  const rows = await db.$queryRaw`
    SELECT
      lt.id,
      lt.transaction_reference,
      lt.external_reference,
      lt.parent_transaction_id,
      lt.transaction_type,
      lt.transaction_status,
      lt.currency_code,
      lt.gross_amount,
      lt.net_amount,
      lt.fee_amount,
      lt.description,
      lt.related_entity_type,
      lt.related_entity_id,
      lt.metadata_json,
      lt.created_at,
      lt.posted_at,
      lt.failed_at,
      lt.reversed_at,
      COALESCE((
        SELECT SUM(le.amount)
        FROM ledger_entries le
        WHERE le.ledger_transaction_id = lt.id
          AND le.ledger_account_id = ${walletAccountId}
          AND le.entry_side = 'CREDIT'
      ), 0.00) AS wallet_credit_amount,
      COALESCE((
        SELECT SUM(le.amount)
        FROM ledger_entries le
        WHERE le.ledger_transaction_id = lt.id
          AND le.ledger_account_id = ${walletAccountId}
          AND le.entry_side = 'DEBIT'
      ), 0.00) AS wallet_debit_amount
    FROM ledger_transactions lt
    WHERE lt.wallet_id = ${walletId}
      AND (
        (${transactionId} IS NOT NULL AND lt.id = ${transactionId})
        OR (${transactionReference} IS NOT NULL AND lt.transaction_reference = ${transactionReference})
        OR (${idempotencyKey} IS NOT NULL AND lt.idempotency_key = ${idempotencyKey})
      )
    ORDER BY lt.id DESC
    LIMIT 1
  `

  return rows?.[0] ? mapWalletTransactionRow(rows[0]) : null
}

async function getSettlementBatchBySourceTransaction(
  db,
  transactionReference,
  { forUpdate = false } = {}
) {
  const scopedTransactionReference = String(transactionReference || "").trim()
  if (!scopedTransactionReference) return null

  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT
      id,
      public_id,
      source_reference,
      station_id,
      related_entity_type,
      related_entity_id,
      source_transaction_reference,
      batch_date,
      gross_amount,
      fee_amount,
      net_amount,
      status,
      metadata_json,
      approved_at,
      created_at,
      updated_at
    FROM settlement_batches
    WHERE source_transaction_reference = ${scopedTransactionReference}
    ORDER BY id DESC
    LIMIT 1
    ${lockingClause}
  `

  return mapSettlementBatchRow(rows?.[0] || null)
}

async function getWalletById(db, walletId, { forUpdate = false } = {}) {
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT id, user_id, wallet_number, wallet_public_id, currency_code, status, is_primary, created_at, updated_at
    FROM wallets
    WHERE id = ${walletId}
    LIMIT 1
    ${lockingClause}
  `
  return rows?.[0] || null
}

async function ensureWalletBalanceRow(db, walletId) {
  await db.$executeRaw`
    INSERT INTO wallet_balances (
      wallet_id,
      ledger_balance,
      available_balance,
      pending_inflow,
      pending_outflow,
      version_no
    )
    VALUES (
      ${walletId},
      0.00,
      0.00,
      0.00,
      0.00,
      1
    )
    ON DUPLICATE KEY UPDATE
      wallet_id = VALUES(wallet_id)
  `
}

async function ensureWalletPublicId(db, wallet) {
  const walletId = Number(wallet?.id || 0)
  if (!walletId) {
    throw walletError("Wallet public id provisioning requires a valid wallet.")
  }

  const existingWalletPublicId = String(wallet?.wallet_public_id || "").trim()
  if (existingWalletPublicId) {
    return {
      ...wallet,
      wallet_public_id: existingWalletPublicId,
    }
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await db.$executeRaw`
        UPDATE wallets
        SET
          wallet_public_id = ${buildWalletPublicId()},
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ${walletId}
          AND (wallet_public_id IS NULL OR TRIM(wallet_public_id) = '')
      `

      const refreshedWallet = await getWalletById(db, walletId, { forUpdate: true })
      if (String(refreshedWallet?.wallet_public_id || "").trim()) {
        return refreshedWallet
      }
    } catch (error) {
      if (isWalletDuplicateEntryError(error) && attempt < 4) {
        continue
      }
      throw error
    }
  }

  throw walletError("Wallet public id could not be provisioned.")
}

async function ensureWalletLedgerAccount(db, wallet) {
  const walletId = Number(wallet?.id || 0)
  if (!walletId) {
    throw walletError("Wallet account provisioning requires a valid wallet.")
  }

  const currencyCode = String(wallet?.currency_code || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY
  const walletNumber = String(wallet?.wallet_number || "").trim()
  await db.$executeRaw`
    INSERT INTO ledger_accounts (
      wallet_id,
      account_code,
      account_name,
      account_type,
      normal_balance,
      currency_code,
      status,
      system_account_role
    )
    VALUES (
      ${walletId},
      ${buildWalletAccountCode(walletId, currencyCode)},
      ${`Customer wallet ${walletNumber || walletId}`},
      'LIABILITY',
      'CREDIT',
      ${currencyCode},
      'ACTIVE',
      NULL
    )
    ON DUPLICATE KEY UPDATE
      account_name = VALUES(account_name),
      currency_code = VALUES(currency_code),
      status = VALUES(status),
      updated_at = CURRENT_TIMESTAMP(3)
  `

  const account = await getWalletLedgerAccount(db, walletId)
  if (!account?.id) {
    throw walletError("Wallet ledger account could not be provisioned.")
  }
  return account
}

async function resolveSystemAccount(db, systemAccountCode, currencyCode = DEFAULT_WALLET_CURRENCY) {
  const rows = await db.$queryRaw`
    SELECT id, account_code, account_name, currency_code, status
    FROM ledger_accounts
    WHERE account_code = ${systemAccountCode}
      AND currency_code = ${currencyCode}
      AND wallet_id IS NULL
      AND status = 'ACTIVE'
    LIMIT 1
  `

  const account = rows?.[0] || null
  if (!account?.id) {
    throw walletError(
      `Wallet system account ${systemAccountCode} is unavailable. Run SQL migration 034_wallet_ledger_foundation.sql.`
    )
  }
  return account
}

async function getWalletByUserId(db, userId, currencyCode = DEFAULT_WALLET_CURRENCY, { forUpdate = false } = {}) {
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT id, user_id, wallet_number, wallet_public_id, currency_code, status, is_primary, created_at, updated_at
    FROM wallets
    WHERE user_id = ${userId}
      AND currency_code = ${currencyCode}
    LIMIT 1
    ${lockingClause}
  `
  return rows?.[0] || null
}

async function getReservationHoldRow(
  db,
  reservationPublicId,
  { status = null, forUpdate = false } = {}
) {
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT
      wrh.id,
      wrh.wallet_id,
      w.user_id,
      wrh.reference,
      wrh.status,
      wrh.amount,
      wrh.currency_code,
      wrh.related_entity_id,
      wrh.ledger_transaction_id,
      wrh.expires_at,
      wrh.created_at,
      wrh.captured_at,
      wrh.released_at
    FROM wallet_reservation_holds wrh
    INNER JOIN wallets w ON w.id = wrh.wallet_id
    WHERE wrh.related_entity_type = 'RESERVATION'
      AND wrh.related_entity_id = ${reservationPublicId}
      AND (${status} IS NULL OR wrh.status = ${status})
    ORDER BY wrh.id DESC
    LIMIT 1
    ${lockingClause}
  `
  return rows?.[0] || null
}

async function getQueueHoldRow(
  db,
  queueJoinId,
  { status = null, forUpdate = false } = {}
) {
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT
      wrh.id,
      wrh.wallet_id,
      w.user_id,
      wrh.reference,
      wrh.status,
      wrh.amount,
      wrh.currency_code,
      wrh.related_entity_id,
      wrh.ledger_transaction_id,
      wrh.expires_at,
      wrh.created_at,
      wrh.captured_at,
      wrh.released_at
    FROM wallet_reservation_holds wrh
    INNER JOIN wallets w ON w.id = wrh.wallet_id
    WHERE wrh.related_entity_type = 'QUEUE'
      AND wrh.related_entity_id = ${queueJoinId}
      AND (${status} IS NULL OR wrh.status = ${status})
    ORDER BY wrh.id DESC
    LIMIT 1
    ${lockingClause}
  `
  return rows?.[0] || null
}

async function createSettlementBatchForWalletTransaction(db, {
  stationId,
  relatedEntityType = null,
  relatedEntityId = null,
  amount,
  transactionReference,
  actorUserId = null,
  batchDate = null,
  currencyCode = DEFAULT_WALLET_CURRENCY,
  source = "WALLET_PAYMENT",
  metadata = null,
}) {
  await ensureSettlementBatchStorageReady(db)
  const normalizedStationId = Number(stationId || 0)
  if (!Number.isFinite(normalizedStationId) || normalizedStationId <= 0) {
    throw walletError("Settlement creation requires a valid station.")
  }

  const scopedTransactionReference = String(transactionReference || "").trim()
  if (!scopedTransactionReference) {
    throw walletError("Settlement creation requires a valid transaction reference.")
  }

  const existingSettlement = await getSettlementBatchBySourceTransaction(db, scopedTransactionReference, {
    forUpdate: true,
  })
  if (existingSettlement?.publicId) {
    return existingSettlement
  }

  const scopedRelatedEntityType = String(relatedEntityType || "").trim().toUpperCase() || null
  const scopedRelatedEntityId = String(relatedEntityId || "").trim() || null
  const publicId = createPublicId()
  const sourceReference = buildSettlementReference()
  const { grossAmount, feeAmount, netAmount } = calculateSettlementAmounts(amount)
  const settlementDate =
    String(batchDate || "").trim() ||
    new Date().toISOString().slice(0, 10)
  const metadataJson = JSON.stringify({
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    relatedEntityType: scopedRelatedEntityType,
    relatedEntityId: scopedRelatedEntityId,
    transactionReference: scopedTransactionReference,
    actorUserId: Number(actorUserId || 0) || null,
    currencyCode,
    source: String(source || "WALLET_PAYMENT").trim() || "WALLET_PAYMENT",
  })

  await db.$executeRaw`
    INSERT INTO settlement_batches (
      public_id,
      source_reference,
      station_id,
      related_entity_type,
      related_entity_id,
      source_transaction_reference,
      batch_date,
      gross_amount,
      fee_amount,
      net_amount,
      status,
      metadata_json
    )
    VALUES (
      ${publicId},
      ${sourceReference},
      ${normalizedStationId},
      ${scopedRelatedEntityType},
      ${scopedRelatedEntityId},
      ${scopedTransactionReference},
      ${settlementDate},
      ${grossAmount},
      ${feeAmount},
      ${netAmount},
      'PENDING',
      ${metadataJson}
    )
  `

  return getSettlementBatchBySourceTransaction(db, scopedTransactionReference)
}

async function createSettlementBatchForReservation(db, {
  stationId,
  reservationPublicId,
  amount,
  transactionReference,
  actorUserId = null,
  batchDate = null,
  currencyCode = DEFAULT_WALLET_CURRENCY,
}) {
  return createSettlementBatchForWalletTransaction(db, {
    stationId,
    relatedEntityType: "RESERVATION",
    relatedEntityId: reservationPublicId,
    amount,
    transactionReference,
    actorUserId,
    batchDate,
    currencyCode,
    source: "WALLET_RESERVATION_CAPTURE",
    metadata: {
      reservationPublicId,
    },
  })
}

async function ensureUserWalletInternal(db, userId, { currencyCode = DEFAULT_WALLET_CURRENCY } = {}) {
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw walletError("Wallet operations require a valid user.")
  }

  const userRows = await db.$queryRaw`
    SELECT id, is_active
    FROM users
    WHERE id = ${normalizedUserId}
    LIMIT 1
    FOR UPDATE
  `

  const user = userRows?.[0] || null
  if (!user?.id || !Number(user?.is_active || 0)) {
    throw walletError("Wallet user account is unavailable.")
  }

  let wallet = await getWalletByUserId(db, normalizedUserId, currencyCode, { forUpdate: true })
  let created = false

  if (!wallet?.id) {
    const walletNumber = buildWalletNumber()
    const walletPublicId = buildWalletPublicId()
    await db.$executeRaw`
      INSERT INTO wallets (
        user_id,
        wallet_number,
        wallet_public_id,
        currency_code,
        status,
        is_primary
      )
      VALUES (
        ${normalizedUserId},
        ${walletNumber},
        ${walletPublicId},
        ${currencyCode},
        'ACTIVE',
        1
      )
    `

    wallet = await getWalletByUserId(db, normalizedUserId, currencyCode, { forUpdate: true })
    if (!wallet?.id) {
      throw walletError("Wallet could not be created.")
    }
    created = true
  }

  wallet = await ensureWalletPublicId(db, wallet)
  await ensureWalletBalanceRow(db, wallet.id)
  await ensureWalletLedgerAccount(db, wallet)

  if (created) {
    await db.$executeRaw`
      INSERT INTO wallet_audit_logs (
        wallet_id,
        ledger_transaction_id,
        actor_user_id,
        action_type,
        action_summary,
        metadata_json
      )
      VALUES (
        ${wallet.id},
        NULL,
        ${normalizedUserId},
        'WALLET_INITIALIZED',
        'Wallet initialized for user',
        ${JSON.stringify({
          userId: normalizedUserId,
          currencyCode,
          walletPublicId: String(wallet.wallet_public_id || "").trim(),
          walletNumber: String(wallet.wallet_number || "").trim(),
        })}
      )
    `
  }

  return { wallet, created }
}

export async function ensureUserWallet(userId, options = {}) {
  await ensureWalletTablesReady()
  try {
    return await prisma.$transaction((tx) => ensureUserWalletInternal(tx, userId, options))
  } catch (error) {
    if (isWalletDuplicateEntryError(error)) {
      return prisma.$transaction((tx) => ensureUserWalletInternal(tx, userId, options))
    }
    throw error
  }
}

async function recalculateWalletBalanceInternal(db, wallet) {
  const walletId = Number(wallet?.id || 0)
  if (!walletId) {
    throw walletError("Wallet balance refresh requires a valid wallet.")
  }

  await ensureWalletBalanceRow(db, walletId)
  const walletAccount = await ensureWalletLedgerAccount(db, wallet)

  const balanceRows = await db.$queryRaw`
    SELECT
      wb.id,
      wb.pending_inflow,
      wb.pending_outflow,
      wb.version_no,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN le.entry_side = 'CREDIT' THEN le.amount
            ELSE (0 - le.amount)
          END
        )
        FROM ledger_entries le
        INNER JOIN ledger_transactions lt
          ON lt.id = le.ledger_transaction_id
        WHERE le.ledger_account_id = ${walletAccount.id}
          AND le.currency_code = ${wallet.currency_code}
          AND lt.transaction_status = 'POSTED'
      ), 0.00) AS computed_ledger_balance,
      COALESCE((
        SELECT SUM(wrh.amount)
        FROM wallet_reservation_holds wrh
        WHERE wrh.wallet_id = ${walletId}
          AND wrh.currency_code = ${wallet.currency_code}
          AND wrh.status = 'ACTIVE'
      ), 0.00) AS active_hold_amount,
      COALESCE((
        SELECT SUM(wsl.amount_mwk_remaining)
        FROM wallet_station_locks wsl
        WHERE wsl.wallet_id = ${walletId}
          AND wsl.currency_code = ${wallet.currency_code}
          AND wsl.status = 'ACTIVE'
      ), 0.00) AS active_locked_amount
    FROM wallet_balances wb
    WHERE wb.wallet_id = ${walletId}
    LIMIT 1
    FOR UPDATE
  `

  const row = balanceRows?.[0] || null
  const pendingInflow = toMoneyNumber(row?.pending_inflow)
  const pendingOutflow = toMoneyNumber(row?.pending_outflow)
  const ledgerBalance = toMoneyNumber(row?.computed_ledger_balance)
  const activeHoldAmount = toMoneyNumber(row?.active_hold_amount)
  const lockedBalance = toMoneyNumber(row?.active_locked_amount)
  const availableBalance = Math.max(
    0,
    Number((ledgerBalance - activeHoldAmount - lockedBalance - pendingOutflow + pendingInflow).toFixed(2))
  )

  await db.$executeRaw`
    UPDATE wallet_balances
    SET
      ledger_balance = ${ledgerBalance},
      available_balance = ${availableBalance},
      locked_balance = ${lockedBalance},
      pending_inflow = ${pendingInflow},
      pending_outflow = ${pendingOutflow},
      version_no = COALESCE(version_no, 0) + 1,
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE wallet_id = ${walletId}
  `

  return {
    ledgerBalance,
    availableBalance,
    lockedBalance,
    pendingInflow,
    pendingOutflow,
    activeHoldAmount,
  }
}

export async function getUserWalletSummary(userId, options = {}) {
  await ensureWalletTablesReady()
  const result = await prisma.$transaction(async (tx) => {
    const ensured = await ensureUserWalletInternal(tx, userId, options)
    const balances = await recalculateWalletBalanceInternal(tx, ensured.wallet)
    return {
      wallet: ensured.wallet,
      initializedNow: ensured.created,
      balances,
    }
  })

  return buildWalletSummary(result)
}

export async function recalculateWalletBalance(walletId) {
  await ensureWalletTablesReady()
  const normalizedWalletId = Number(walletId || 0)
  if (!Number.isFinite(normalizedWalletId) || normalizedWalletId <= 0) {
    throw walletError("Wallet balance refresh requires a valid walletId.")
  }

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, user_id, wallet_number, wallet_public_id, currency_code, status, created_at, updated_at
      FROM wallets
      WHERE id = ${normalizedWalletId}
      LIMIT 1
      FOR UPDATE
    `
    const wallet = rows?.[0] || null
    if (!wallet?.id) {
      throw walletError("Wallet not found.", 404)
    }
    return recalculateWalletBalanceInternal(tx, wallet)
  })
}

export async function getUserWalletTransactions(
  userId,
  { page = 1, limit = 20, transactionType = null, transactionStatus = null } = {}
) {
  await ensureWalletTablesReady()
  const normalizedPage = Math.max(1, Number(page || 1))
  const safeLimit = Math.min(MAX_WALLET_PAGE_SIZE, Math.max(1, Number(limit || 20)))
  const offset = (normalizedPage - 1) * safeLimit
  const normalizedType = transactionType ? toUpperValue(transactionType) : null
  const normalizedStatus = transactionStatus ? toUpperValue(transactionStatus) : null
  const paymentTypeFilterEnabled = normalizedType === "PAYMENT"
  const { wallet } = await ensureUserWallet(userId)
  const walletAccount = await getWalletLedgerAccount(prisma, wallet.id)

  if (!walletAccount?.id) {
    throw walletError("Wallet account not found.")
  }

  const countRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS total_count
    FROM ledger_transactions lt
    WHERE lt.wallet_id = ${wallet.id}
      AND (
        ${normalizedType} IS NULL
        OR (${paymentTypeFilterEnabled} = TRUE AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE'))
        OR (${paymentTypeFilterEnabled} = FALSE AND lt.transaction_type = ${normalizedType})
      )
      AND (${normalizedStatus} IS NULL OR lt.transaction_status = ${normalizedStatus})
  `
  const totalCount = Number(countRows?.[0]?.total_count || 0)

  const rows = await prisma.$queryRaw`
    SELECT
      lt.id,
      lt.transaction_reference,
      lt.external_reference,
      tx.public_id AS transaction_public_id,
      COALESCE(tx.occurred_at, tx.dispensed_at, tx.settled_at, tx.authorized_at, tx.created_at) AS transaction_occurred_at,
      lt.parent_transaction_id,
      lt.transaction_type,
      lt.transaction_status,
      lt.currency_code,
      lt.gross_amount,
      lt.net_amount,
      lt.fee_amount,
      lt.description,
      lt.related_entity_type,
      lt.related_entity_id,
      lt.metadata_json,
      lt.created_at,
      lt.posted_at,
      lt.failed_at,
      lt.reversed_at,
      COALESCE((
        SELECT SUM(le.amount)
        FROM ledger_entries le
        WHERE le.ledger_transaction_id = lt.id
          AND le.ledger_account_id = ${walletAccount.id}
          AND le.entry_side = 'CREDIT'
      ), 0.00) AS wallet_credit_amount,
      COALESCE((
        SELECT SUM(le.amount)
        FROM ledger_entries le
        WHERE le.ledger_transaction_id = lt.id
          AND le.ledger_account_id = ${walletAccount.id}
          AND le.entry_side = 'DEBIT'
      ), 0.00) AS wallet_debit_amount
    FROM ledger_transactions lt
    LEFT JOIN queue_entries qe
      ON lt.related_entity_type = 'QUEUE'
     AND qe.public_id = lt.related_entity_id
    LEFT JOIN transactions tx
      ON tx.id = (
        SELECT tx_match.id
        FROM transactions tx_match
        WHERE tx_match.public_id = lt.external_reference
          OR (
            lt.related_entity_type = 'RESERVATION'
            AND tx_match.reservation_public_id = lt.related_entity_id
          )
          OR (
            lt.related_entity_type = 'QUEUE'
            AND qe.id IS NOT NULL
            AND tx_match.queue_entry_id = qe.id
          )
        ORDER BY COALESCE(
          tx_match.occurred_at,
          tx_match.dispensed_at,
          tx_match.settled_at,
          tx_match.authorized_at,
          tx_match.created_at
        ) DESC, tx_match.id DESC
        LIMIT 1
      )
    WHERE lt.wallet_id = ${wallet.id}
      AND (
        ${normalizedType} IS NULL
        OR (${paymentTypeFilterEnabled} = TRUE AND lt.transaction_type IN ('PAYMENT', 'RESERVATION_PAYMENT', 'QUEUE_FEE'))
        OR (${paymentTypeFilterEnabled} = FALSE AND lt.transaction_type = ${normalizedType})
      )
      AND (${normalizedStatus} IS NULL OR lt.transaction_status = ${normalizedStatus})
    ORDER BY COALESCE(lt.posted_at, lt.created_at) DESC, lt.id DESC
    LIMIT ${safeLimit}
    OFFSET ${offset}
  `

  return {
    items: (rows || []).map(mapWalletTransactionRow),
    page: normalizedPage,
    limit: safeLimit,
    total: totalCount,
    hasMore: offset + safeLimit < totalCount,
  }
}

export async function getUserWalletHolds(userId, { status = "ACTIVE", limit = 25 } = {}) {
  await ensureWalletTablesReady()
  const normalizedStatus = toUpperValue(status, "ACTIVE")
  const safeLimit = Math.min(100, Math.max(1, Number(limit || 25)))
  const { wallet } = await ensureUserWallet(userId)

  const rows = await prisma.$queryRaw`
    SELECT
      id,
      reference,
      hold_type,
      status,
      amount,
      currency_code,
      related_entity_type,
      related_entity_id,
      expires_at,
      created_at,
      captured_at,
      released_at
    FROM wallet_reservation_holds
    WHERE wallet_id = ${wallet.id}
      AND status = ${normalizedStatus}
    ORDER BY created_at DESC, id DESC
    LIMIT ${safeLimit}
  `

  const items = (rows || []).map(mapWalletHoldRow)
  const activeHoldAmount = items.reduce((sum, item) => sum + toMoneyNumber(item.amount), 0)

  return {
    items,
    activeHoldAmount: toMoneyNumber(activeHoldAmount),
  }
}

async function createReservationWalletHoldInternal(
  db,
  {
    userId,
    reservationPublicId,
    amount,
    expiresAt = null,
    actorUserId = null,
    currencyCode = DEFAULT_WALLET_CURRENCY,
  }
) {
  const normalizedUserId = Number(userId || 0)
  const normalizedActorUserId = Number(actorUserId || normalizedUserId || 0) || null
  const normalizedAmount = toMoneyNumber(amount)
  const scopedReservationId = String(reservationPublicId || "").trim()
  const scopedCurrencyCode = String(currencyCode || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw walletError("Reservation hold requires a valid user.")
  }
  if (!scopedReservationId) {
    throw walletError("Reservation hold requires a reservation reference.")
  }
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw walletError("Reservation hold amount must be greater than zero.")
  }

  const ensured = await ensureUserWalletInternal(db, normalizedUserId, { currencyCode: scopedCurrencyCode })
  const walletStatus = toUpperValue(ensured.wallet?.status, "ACTIVE")
  if (walletStatus !== "ACTIVE") {
    throw walletError("Wallet is not active. Reservation funds cannot be held.")
  }

  const existingCaptured = await getReservationHoldRow(db, scopedReservationId, { status: "CAPTURED", forUpdate: true })
  if (existingCaptured?.id) {
    throw walletError("Reservation wallet hold has already been captured.")
  }

  const existingActive = await getReservationHoldRow(db, scopedReservationId, { status: "ACTIVE", forUpdate: true })
  if (existingActive?.id) {
    const balances = await recalculateWalletBalanceInternal(db, ensured.wallet)
    return {
      hold: mapReservationHoldRow(existingActive),
      walletBeforeHold: buildWalletSummary({
        wallet: ensured.wallet,
        balances,
        initializedNow: ensured.created,
      }),
      walletAfterHold: buildWalletSummary({
        wallet: ensured.wallet,
        balances,
        initializedNow: ensured.created,
      }),
      created: false,
    }
  }

  const balancesBeforeHold = await recalculateWalletBalanceInternal(db, ensured.wallet)
  if (balancesBeforeHold.availableBalance < normalizedAmount) {
    throw walletError(
      `Insufficient wallet balance. This reservation requires MWK ${normalizedAmount.toLocaleString()} but only MWK ${balancesBeforeHold.availableBalance.toLocaleString()} is available.`
    )
  }

  const holdReference = buildHoldReference()
  await db.$executeRaw`
    INSERT INTO wallet_reservation_holds (
      wallet_id,
      ledger_transaction_id,
      reference,
      hold_type,
      status,
      amount,
      currency_code,
      related_entity_type,
      related_entity_id,
      expires_at,
      released_at,
      captured_at
    )
    VALUES (
      ${ensured.wallet.id},
      NULL,
      ${holdReference},
      'RESERVATION',
      'ACTIVE',
      ${normalizedAmount},
      ${scopedCurrencyCode},
      'RESERVATION',
      ${scopedReservationId},
      ${expiresAt || null},
      NULL,
      NULL
    )
  `

  await db.$executeRaw`
    INSERT INTO wallet_audit_logs (
      wallet_id,
      ledger_transaction_id,
      actor_user_id,
      action_type,
      action_summary,
      metadata_json
    )
    VALUES (
      ${ensured.wallet.id},
      NULL,
      ${normalizedActorUserId},
      'WALLET_RESERVATION_HOLD_CREATED',
      ${`Reservation hold created for ${scopedReservationId}.`},
      ${JSON.stringify({
        reservationPublicId: scopedReservationId,
        holdReference,
        amount: normalizedAmount,
        currencyCode: scopedCurrencyCode,
        expiresAt: toIsoOrNull(expiresAt),
      })}
    )
  `

  const createdHold = await getReservationHoldRow(db, scopedReservationId, { status: "ACTIVE", forUpdate: true })
  const balancesAfterHold = await recalculateWalletBalanceInternal(db, ensured.wallet)
  return {
    hold: mapReservationHoldRow(createdHold),
    walletBeforeHold: buildWalletSummary({
      wallet: ensured.wallet,
      balances: balancesBeforeHold,
      initializedNow: ensured.created,
    }),
    walletAfterHold: buildWalletSummary({
      wallet: ensured.wallet,
      balances: balancesAfterHold,
      initializedNow: ensured.created,
    }),
    created: true,
  }
}

export async function createReservationWalletHold(params, options = {}) {
  await ensureWalletTablesReady()
  if (options?.tx) {
    return createReservationWalletHoldInternal(options.tx, params)
  }
  return prisma.$transaction((tx) => createReservationWalletHoldInternal(tx, params))
}

async function createQueuePrepayWalletHoldInternal(
  db,
  {
    userId,
    queueJoinId,
    amount,
    expiresAt = null,
    actorUserId = null,
    currencyCode = DEFAULT_WALLET_CURRENCY,
  }
) {
  const normalizedUserId = Number(userId || 0)
  const normalizedActorUserId = Number(actorUserId || normalizedUserId || 0) || null
  const normalizedAmount = toMoneyNumber(amount)
  const scopedQueueJoinId = String(queueJoinId || "").trim()
  const scopedCurrencyCode = String(currencyCode || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw walletError("Queue prepay hold requires a valid user.")
  }
  if (!scopedQueueJoinId) {
    throw walletError("Queue prepay hold requires a queue reference.")
  }
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw walletError("Queue prepay hold amount must be greater than zero.")
  }

  const ensured = await ensureUserWalletInternal(db, normalizedUserId, { currencyCode: scopedCurrencyCode })
  const walletStatus = toUpperValue(ensured.wallet?.status, "ACTIVE")
  if (walletStatus !== "ACTIVE") {
    throw walletError("Wallet is not active. Queue prepay funds cannot be held.")
  }

  const existingCaptured = await getQueueHoldRow(db, scopedQueueJoinId, { status: "CAPTURED", forUpdate: true })
  if (existingCaptured?.id) {
    throw walletError("Queue prepay wallet hold has already been captured.")
  }

  const existingActive = await getQueueHoldRow(db, scopedQueueJoinId, { status: "ACTIVE", forUpdate: true })
  if (existingActive?.id) {
    const balances = await recalculateWalletBalanceInternal(db, ensured.wallet)
    return {
      created: false,
      hold: mapReservationHoldRow(existingActive),
      walletBeforeHold: buildWalletSummary({
        wallet: ensured.wallet,
        balances,
        initializedNow: ensured.created,
      }),
      walletAfterHold: buildWalletSummary({
        wallet: ensured.wallet,
        balances,
        initializedNow: ensured.created,
      }),
    }
  }

  const balancesBeforeHold = await recalculateWalletBalanceInternal(db, ensured.wallet)
  if (balancesBeforeHold.availableBalance < normalizedAmount) {
    throw walletError(
      `Insufficient wallet balance. This hold requires MWK ${normalizedAmount.toLocaleString()} but only MWK ${balancesBeforeHold.availableBalance.toLocaleString()} is available.`
    )
  }

  const holdReference = buildHoldReference()
  await db.$executeRaw`
    INSERT INTO wallet_reservation_holds (
      wallet_id,
      ledger_transaction_id,
      reference,
      hold_type,
      status,
      amount,
      currency_code,
      related_entity_type,
      related_entity_id,
      expires_at,
      released_at,
      captured_at
    )
    VALUES (
      ${ensured.wallet.id},
      NULL,
      ${holdReference},
      'QUEUE_PREPAY',
      'ACTIVE',
      ${normalizedAmount},
      ${scopedCurrencyCode},
      'QUEUE',
      ${scopedQueueJoinId},
      ${expiresAt || null},
      NULL,
      NULL
    )
  `

  await db.$executeRaw`
    INSERT INTO wallet_audit_logs (
      wallet_id,
      ledger_transaction_id,
      actor_user_id,
      action_type,
      action_summary,
      metadata_json
    )
    VALUES (
      ${ensured.wallet.id},
      NULL,
      ${normalizedActorUserId},
      'WALLET_QUEUE_PREPAY_HOLD_CREATED',
      ${`Queue prepay hold created for ${scopedQueueJoinId}.`},
      ${JSON.stringify({
        queueJoinId: scopedQueueJoinId,
        holdReference,
        amount: normalizedAmount,
        currencyCode: scopedCurrencyCode,
        expiresAt: toIsoOrNull(expiresAt),
      })}
    )
  `

  const createdHold = await getQueueHoldRow(db, scopedQueueJoinId, { status: "ACTIVE", forUpdate: true })
  const balancesAfterHold = await recalculateWalletBalanceInternal(db, ensured.wallet)
  return {
    hold: mapReservationHoldRow(createdHold),
    walletBeforeHold: buildWalletSummary({
      wallet: ensured.wallet,
      balances: balancesBeforeHold,
      initializedNow: ensured.created,
    }),
    walletAfterHold: buildWalletSummary({
      wallet: ensured.wallet,
      balances: balancesAfterHold,
      initializedNow: ensured.created,
    }),
    created: true,
  }
}

export async function createQueuePrepayWalletHold(params, options = {}) {
  await ensureWalletTablesReady()
  if (options?.tx) {
    return createQueuePrepayWalletHoldInternal(options.tx, params)
  }
  return prisma.$transaction((tx) => createQueuePrepayWalletHoldInternal(tx, params))
}

async function releaseReservationWalletHoldInternal(
  db,
  {
    reservationPublicId,
    actorUserId = null,
    reason = "RESERVATION_RELEASE",
  }
) {
  const scopedReservationId = String(reservationPublicId || "").trim()
  const normalizedActorUserId = Number(actorUserId || 0) || null
  if (!scopedReservationId) {
    throw walletError("Reservation hold release requires a reservation reference.")
  }

  const holdRow = await getReservationHoldRow(db, scopedReservationId, { status: "ACTIVE", forUpdate: true })
  if (!holdRow?.id) return null

  const wallet = await getWalletById(db, holdRow.wallet_id, { forUpdate: true })
  if (!wallet?.id) {
    throw walletError("Wallet not found for reservation hold release.", 404)
  }

  await db.$executeRaw`
    UPDATE wallet_reservation_holds
    SET
      status = 'RELEASED',
      released_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${holdRow.id}
  `

  await db.$executeRaw`
    INSERT INTO wallet_audit_logs (
      wallet_id,
      ledger_transaction_id,
      actor_user_id,
      action_type,
      action_summary,
      metadata_json
    )
    VALUES (
      ${wallet.id},
      NULL,
      ${normalizedActorUserId},
      'WALLET_RESERVATION_HOLD_RELEASED',
      ${`Reservation hold released for ${scopedReservationId}.`},
      ${JSON.stringify({
        reservationPublicId: scopedReservationId,
        holdReference: String(holdRow.reference || "").trim(),
        reason: String(reason || "").trim() || null,
      })}
    )
  `

  const balances = await recalculateWalletBalanceInternal(db, wallet)
  return {
    hold: {
      ...mapReservationHoldRow(holdRow),
      status: "RELEASED",
      releasedAt: new Date().toISOString(),
    },
    wallet: buildWalletSummary({
      wallet,
      balances,
    }),
  }
}

export async function releaseReservationWalletHold(params, options = {}) {
  await ensureWalletTablesReady()
  if (options?.tx) {
    return releaseReservationWalletHoldInternal(options.tx, params)
  }
  return prisma.$transaction((tx) => releaseReservationWalletHoldInternal(tx, params))
}

async function releaseQueuePrepayWalletHoldInternal(
  db,
  {
    queueJoinId,
    actorUserId = null,
    reason = "QUEUE_PREPAY_RELEASE",
  }
) {
  const scopedQueueJoinId = String(queueJoinId || "").trim()
  const normalizedActorUserId = Number(actorUserId || 0) || null
  if (!scopedQueueJoinId) {
    throw walletError("Queue prepay hold release requires a queue reference.")
  }

  const holdRow = await getQueueHoldRow(db, scopedQueueJoinId, { status: "ACTIVE", forUpdate: true })
  if (!holdRow?.id) return null

  const wallet = await getWalletById(db, holdRow.wallet_id, { forUpdate: true })
  if (!wallet?.id) {
    throw walletError("Wallet not found for queue prepay hold release.", 404)
  }

  await db.$executeRaw`
    UPDATE wallet_reservation_holds
    SET
      status = 'RELEASED',
      released_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${holdRow.id}
  `

  await db.$executeRaw`
    INSERT INTO wallet_audit_logs (
      wallet_id,
      ledger_transaction_id,
      actor_user_id,
      action_type,
      action_summary,
      metadata_json
    )
    VALUES (
      ${wallet.id},
      NULL,
      ${normalizedActorUserId},
      'WALLET_QUEUE_PREPAY_HOLD_RELEASED',
      ${`Queue prepay hold released for ${scopedQueueJoinId}.`},
      ${JSON.stringify({
        queueJoinId: scopedQueueJoinId,
        holdReference: String(holdRow.reference || "").trim(),
        reason: String(reason || "").trim() || null,
      })}
    )
  `

  const balances = await recalculateWalletBalanceInternal(db, wallet)
  return {
    hold: {
      ...mapReservationHoldRow(holdRow),
      status: "RELEASED",
      releasedAt: new Date().toISOString(),
    },
    wallet: buildWalletSummary({
      wallet,
      balances,
    }),
  }
}

export async function releaseQueuePrepayWalletHold(params, options = {}) {
  await ensureWalletTablesReady()
  if (options?.tx) {
    return releaseQueuePrepayWalletHoldInternal(options.tx, params)
  }
  return prisma.$transaction((tx) => releaseQueuePrepayWalletHoldInternal(tx, params))
}

async function captureReservationWalletPaymentInternal(
  db,
  {
    reservationPublicId,
    stationId,
    actorUserId = null,
    amount = null,
    description = "",
  }
) {
  const scopedReservationId = String(reservationPublicId || "").trim()
  const normalizedStationId = Number(stationId || 0)
  const normalizedActorUserId = Number(actorUserId || 0) || null
  if (!scopedReservationId) {
    throw walletError("Reservation capture requires a reservation reference.")
  }
  if (!Number.isFinite(normalizedStationId) || normalizedStationId <= 0) {
    throw walletError("Reservation capture requires a valid station.")
  }

  await ensureSettlementBatchStorageReady(db)

  const holdRow = await getReservationHoldRow(db, scopedReservationId, { status: "ACTIVE", forUpdate: true })
  if (!holdRow?.id) {
    throw walletError("Active reservation wallet hold not found.")
  }

  const wallet = await getWalletById(db, holdRow.wallet_id, { forUpdate: true })
  if (!wallet?.id) {
    throw walletError("Wallet not found for reservation capture.", 404)
  }

  const walletAccount = await ensureWalletLedgerAccount(db, wallet)
  const clearingAccount = await resolveSystemAccount(
    db,
    WALLET_SYSTEM_ACCOUNT_CODES.PAYMENT_CLEARING,
    holdRow.currency_code
  )

  const transactionReference = buildTransactionReference("WRP")
  const holdAmount = toMoneyNumber(holdRow.amount)
  const requestedAmount = amount === null || amount === undefined ? null : toMoneyNumber(amount)
  if (requestedAmount !== null && requestedAmount <= 0) {
    throw walletError("Reservation capture amount must be greater than zero.")
  }
  if (requestedAmount !== null && requestedAmount > holdAmount) {
    throw walletError("Reservation capture amount cannot exceed the held amount.")
  }
  const normalizedAmount = requestedAmount ?? holdAmount
  const settlementDescription =
    String(description || "").trim() || `Reservation payment captured for ${scopedReservationId}`
  const metadataJson = JSON.stringify({
    reservationPublicId: scopedReservationId,
    holdReference: String(holdRow.reference || "").trim(),
    stationId: normalizedStationId,
    source: "RESERVATION_SERVICE_CAPTURE",
  })

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
      NULL,
      NULL,
      'RESERVATION_PAYMENT',
      'POSTED',
      ${holdRow.currency_code},
      ${normalizedAmount},
      ${normalizedAmount},
      0.00,
      ${settlementDescription},
      'RESERVATION',
      ${scopedReservationId},
      ${normalizedActorUserId},
      NULL,
      ${`wallet:reservation:capture:${scopedReservationId}`},
      CURRENT_TIMESTAMP(3),
      NULL,
      NULL,
      ${metadataJson}
    )
  `

  const transactionRows = await db.$queryRaw`
    SELECT id, transaction_reference
    FROM ledger_transactions
    WHERE transaction_reference = ${transactionReference}
    LIMIT 1
  `
  const ledgerTransaction = transactionRows?.[0] || null
  if (!ledgerTransaction?.id) {
    throw walletError("Reservation wallet payment could not be recorded.")
  }

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
        ${holdRow.currency_code},
        ${"Reservation payment captured from wallet hold"}
      ),
      (
        ${ledgerTransaction.id},
        ${clearingAccount.id},
        'CREDIT',
        ${normalizedAmount},
        ${holdRow.currency_code},
        ${"Reservation payment moved to settlement clearing"}
      )
  `

  const settlement = await createSettlementBatchForReservation(db, {
    stationId: normalizedStationId,
    reservationPublicId: scopedReservationId,
    amount: normalizedAmount,
    transactionReference,
    actorUserId: normalizedActorUserId,
    currencyCode: holdRow.currency_code,
  })

  await db.$executeRaw`
    UPDATE wallet_reservation_holds
    SET
      status = 'CAPTURED',
      captured_at = CURRENT_TIMESTAMP(3),
      ledger_transaction_id = ${ledgerTransaction.id},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${holdRow.id}
  `

  await db.$executeRaw`
    INSERT INTO wallet_audit_logs (
      wallet_id,
      ledger_transaction_id,
      actor_user_id,
      action_type,
      action_summary,
      metadata_json
    )
    VALUES (
      ${wallet.id},
      ${ledgerTransaction.id},
      ${normalizedActorUserId},
      'WALLET_RESERVATION_PAYMENT_CAPTURED',
      ${`Reservation payment captured for ${scopedReservationId}.`},
      ${JSON.stringify({
        reservationPublicId: scopedReservationId,
        holdReference: String(holdRow.reference || "").trim(),
        settlementBatchPublicId: settlement.publicId,
        transactionReference,
        amount: normalizedAmount,
      })}
    )
  `

  const balances = await recalculateWalletBalanceInternal(db, wallet)
  return {
    hold: {
      ...mapReservationHoldRow(holdRow),
      status: "CAPTURED",
      capturedAt: new Date().toISOString(),
      ledgerTransactionId: Number(ledgerTransaction.id),
    },
    wallet: buildWalletSummary({
      wallet,
      balances,
    }),
    transaction: {
      id: Number(ledgerTransaction.id),
      reference: String(ledgerTransaction.transaction_reference || transactionReference).trim(),
      amount: normalizedAmount,
      currencyCode: holdRow.currency_code,
      type: "RESERVATION_PAYMENT",
      status: "POSTED",
    },
    settlement,
  }
}

export async function captureReservationWalletPayment(params, options = {}) {
  await ensureWalletTablesReady()
  if (options?.tx) {
    return captureReservationWalletPaymentInternal(options.tx, params)
  }
  return prisma.$transaction((tx) => captureReservationWalletPaymentInternal(tx, params))
}

async function captureQueuePrepayWalletPaymentInternal(
  db,
  {
    queueJoinId,
    stationId,
    actorUserId = null,
    amount = null,
    description = "",
  }
) {
  const scopedQueueJoinId = String(queueJoinId || "").trim()
  const normalizedStationId = Number(stationId || 0)
  const normalizedActorUserId = Number(actorUserId || 0) || null
  if (!scopedQueueJoinId) {
    throw walletError("Queue capture requires a queue reference.")
  }
  if (!Number.isFinite(normalizedStationId) || normalizedStationId <= 0) {
    throw walletError("Queue capture requires a valid station.")
  }

  await ensureSettlementBatchStorageReady(db)

  const holdRow = await getQueueHoldRow(db, scopedQueueJoinId, { status: "ACTIVE", forUpdate: true })
  if (!holdRow?.id) {
    throw walletError("Active queue prepay wallet hold not found.")
  }

  const wallet = await getWalletById(db, holdRow.wallet_id, { forUpdate: true })
  if (!wallet?.id) {
    throw walletError("Wallet not found for queue prepay capture.", 404)
  }

  const walletAccount = await ensureWalletLedgerAccount(db, wallet)
  const clearingAccount = await resolveSystemAccount(
    db,
    WALLET_SYSTEM_ACCOUNT_CODES.PAYMENT_CLEARING,
    holdRow.currency_code
  )

  const transactionReference = buildTransactionReference("WQP")
  const holdAmount = toMoneyNumber(holdRow.amount)
  const requestedAmount = amount === null || amount === undefined ? null : toMoneyNumber(amount)
  if (requestedAmount !== null && requestedAmount <= 0) {
    throw walletError("Queue capture amount must be greater than zero.")
  }
  if (requestedAmount !== null && requestedAmount > holdAmount) {
    throw walletError("Queue capture amount cannot exceed the held amount.")
  }
  const normalizedAmount = requestedAmount ?? holdAmount
  const settlementDescription =
    String(description || "").trim() || `Queue prepay captured for ${scopedQueueJoinId}`
  const metadataJson = JSON.stringify({
    queueJoinId: scopedQueueJoinId,
    holdReference: String(holdRow.reference || "").trim(),
    stationId: normalizedStationId,
    source: "QUEUE_SERVICE_CAPTURE",
  })

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
      NULL,
      NULL,
      'PAYMENT',
      'POSTED',
      ${holdRow.currency_code},
      ${normalizedAmount},
      ${normalizedAmount},
      0.00,
      ${settlementDescription},
      'QUEUE',
      ${scopedQueueJoinId},
      ${normalizedActorUserId},
      NULL,
      ${`wallet:queue:capture:${scopedQueueJoinId}`},
      CURRENT_TIMESTAMP(3),
      NULL,
      NULL,
      ${metadataJson}
    )
  `

  const transactionRows = await db.$queryRaw`
    SELECT id, transaction_reference
    FROM ledger_transactions
    WHERE transaction_reference = ${transactionReference}
    LIMIT 1
  `
  const ledgerTransaction = transactionRows?.[0] || null
  if (!ledgerTransaction?.id) {
    throw walletError("Queue prepay wallet payment could not be recorded.")
  }

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
        ${holdRow.currency_code},
        ${"Queue prepay captured from wallet hold"}
      ),
      (
        ${ledgerTransaction.id},
        ${clearingAccount.id},
        'CREDIT',
        ${normalizedAmount},
        ${holdRow.currency_code},
        ${"Queue prepay moved to settlement clearing"}
      )
  `

  const settlement = await createSettlementBatchForWalletTransaction(db, {
    stationId: normalizedStationId,
    relatedEntityType: "QUEUE",
    relatedEntityId: scopedQueueJoinId,
    amount: normalizedAmount,
    transactionReference,
    actorUserId: normalizedActorUserId,
    currencyCode: holdRow.currency_code,
    source: "WALLET_QUEUE_PREPAY_CAPTURE",
    metadata: {
      queueJoinId: scopedQueueJoinId,
      holdReference: String(holdRow.reference || "").trim(),
    },
  })

  await db.$executeRaw`
    UPDATE wallet_reservation_holds
    SET
      status = 'CAPTURED',
      captured_at = CURRENT_TIMESTAMP(3),
      ledger_transaction_id = ${ledgerTransaction.id},
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${holdRow.id}
  `

  await db.$executeRaw`
    INSERT INTO wallet_audit_logs (
      wallet_id,
      ledger_transaction_id,
      actor_user_id,
      action_type,
      action_summary,
      metadata_json
    )
    VALUES (
      ${wallet.id},
      ${ledgerTransaction.id},
      ${normalizedActorUserId},
      'WALLET_QUEUE_PREPAY_CAPTURED',
      ${`Queue prepay captured for ${scopedQueueJoinId}.`},
      ${JSON.stringify({
        queueJoinId: scopedQueueJoinId,
        holdReference: String(holdRow.reference || "").trim(),
        settlementBatchPublicId: settlement.publicId,
        transactionReference,
        amount: normalizedAmount,
      })}
    )
  `

  const balances = await recalculateWalletBalanceInternal(db, wallet)
  return {
    hold: {
      ...mapReservationHoldRow(holdRow),
      status: "CAPTURED",
      capturedAt: new Date().toISOString(),
      ledgerTransactionId: Number(ledgerTransaction.id),
    },
    wallet: buildWalletSummary({
      wallet,
      balances,
    }),
    transaction: {
      id: Number(ledgerTransaction.id),
      reference: String(ledgerTransaction.transaction_reference || transactionReference).trim(),
      amount: normalizedAmount,
      currencyCode: holdRow.currency_code,
      type: "PAYMENT",
      status: "POSTED",
    },
    settlement,
  }
}

export async function captureQueuePrepayWalletPayment(params, options = {}) {
  await ensureWalletTablesReady()
  if (options?.tx) {
    return captureQueuePrepayWalletPaymentInternal(options.tx, params)
  }
  return prisma.$transaction((tx) => captureQueuePrepayWalletPaymentInternal(tx, params))
}

async function createWalletPaymentInternal(
  db,
  {
    userId,
    amount,
    actorUserId = null,
    description = "",
    currencyCode = DEFAULT_WALLET_CURRENCY,
    relatedEntityType = null,
    relatedEntityId = null,
    idempotencyKey = null,
    metadata = null,
    settlementContext = null,
  }
) {
  const normalizedUserId = Number(userId || 0)
  const normalizedActorUserId = Number(actorUserId || normalizedUserId || 0) || null
  const normalizedAmount = toMoneyNumber(amount)
  const scopedCurrencyCode = String(currencyCode || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY
  const scopedDescription = String(description || "").trim()
  const scopedRelatedEntityType = String(relatedEntityType || "").trim().toUpperCase() || null
  const scopedRelatedEntityId = String(relatedEntityId || "").trim() || null
  const scopedIdempotencyKey = String(idempotencyKey || "").trim() || null
  const scopedSettlementContext =
    settlementContext && typeof settlementContext === "object"
      ? settlementContext
      : null
  const normalizedSettlementStationId = Number(scopedSettlementContext?.stationId || 0) || null

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw walletError("Wallet payment requires a valid user.")
  }
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw walletError("Wallet payment amount must be greater than zero.")
  }

  const ensured = await ensureUserWalletInternal(db, normalizedUserId, { currencyCode: scopedCurrencyCode })
  const walletStatus = toUpperValue(ensured.wallet?.status, "ACTIVE")
  if (walletStatus !== "ACTIVE") {
    throw walletError("Wallet is not active. Payment cannot be completed.")
  }

  const walletAccount = await ensureWalletLedgerAccount(db, ensured.wallet)
  if (scopedIdempotencyKey) {
    const existingTransaction = await getMappedWalletTransaction(
      db,
      ensured.wallet.id,
      walletAccount.id,
      { idempotencyKey: scopedIdempotencyKey }
    )
    if (existingTransaction?.id) {
      const existingSettlement =
        scopedSettlementContext?.stationId && existingTransaction?.reference
          ? await getSettlementBatchBySourceTransaction(db, existingTransaction.reference, {
              forUpdate: true,
            })
          : null
      const balances = await recalculateWalletBalanceInternal(db, ensured.wallet)
      return {
        created: false,
        transaction: existingTransaction,
        settlement: existingSettlement,
        walletBeforePayment: buildWalletSummary({
          wallet: ensured.wallet,
          balances,
          initializedNow: ensured.created,
        }),
        walletAfterPayment: buildWalletSummary({
          wallet: ensured.wallet,
          balances,
          initializedNow: ensured.created,
        }),
      }
    }
  }

  const balancesBeforePayment = await recalculateWalletBalanceInternal(db, ensured.wallet)
  const matchingStationLocks =
    normalizedSettlementStationId
      ? await listWalletStationLocks(db, {
          walletId: ensured.wallet.id,
          stationId: normalizedSettlementStationId,
          status: "ACTIVE",
          currencyCode: scopedCurrencyCode,
          forUpdate: true,
        })
      : []
  const spendPlan = buildWalletStationLockSpendPlan({
    amount: normalizedAmount,
    availableBalance: balancesBeforePayment.availableBalance,
    matchingLocks: matchingStationLocks,
  })
  if (!spendPlan.canSpend) {
    throw walletError(
      `Insufficient wallet balance. This payment requires MWK ${normalizedAmount.toLocaleString()} but only MWK ${spendPlan.totalSpendable.toLocaleString()} is available for this station.`
    )
  }

  const clearingAccount = await resolveSystemAccount(
    db,
    WALLET_SYSTEM_ACCOUNT_CODES.PAYMENT_CLEARING,
    scopedCurrencyCode
  )
  const transactionReference = buildTransactionReference("WPM")
  const metadataJson = JSON.stringify({
    ...(metadata && typeof metadata === "object" ? metadata : {}),
    stationLockSpend: {
      stationId: normalizedSettlementStationId,
      matchingLockedBalance: spendPlan.matchingLockedBalance,
      lockedAmountUsed: spendPlan.lockedAmountUsed,
      generalAmountUsed: spendPlan.generalAmountUsed,
    },
  })

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
      ${ensured.wallet.id},
      ${transactionReference},
      NULL,
      NULL,
      'PAYMENT',
      'POSTED',
      ${scopedCurrencyCode},
      ${normalizedAmount},
      ${normalizedAmount},
      0.00,
      ${scopedDescription || "Wallet payment posted"},
      ${scopedRelatedEntityType},
      ${scopedRelatedEntityId},
      ${normalizedActorUserId},
      NULL,
      ${scopedIdempotencyKey},
      CURRENT_TIMESTAMP(3),
      NULL,
      NULL,
      ${metadataJson}
    )
  `

  const transactionRows = await db.$queryRaw`
    SELECT id
    FROM ledger_transactions
    WHERE transaction_reference = ${transactionReference}
    LIMIT 1
  `
  const ledgerTransactionId = Number(transactionRows?.[0]?.id || 0)
  if (!Number.isFinite(ledgerTransactionId) || ledgerTransactionId <= 0) {
    throw walletError("Wallet payment could not be recorded.")
  }

  const ledgerEntryRows = []
  if (spendPlan.lockedAmountUsed > 0) {
    ledgerEntryRows.push({
      ledgerAccountId: walletAccount.id,
      entrySide: "DEBIT",
      amount: spendPlan.lockedAmountUsed,
      description: "Station-locked wallet payment debit",
    })
  }
  if (spendPlan.generalAmountUsed > 0) {
    ledgerEntryRows.push({
      ledgerAccountId: walletAccount.id,
      entrySide: "DEBIT",
      amount: spendPlan.generalAmountUsed,
      description: scopedDescription || "Wallet payment debit",
    })
  }
  ledgerEntryRows.push({
    ledgerAccountId: clearingAccount.id,
    entrySide: "CREDIT",
    amount: normalizedAmount,
    description: "Wallet payment moved to settlement clearing",
  })

  for (const ledgerEntry of ledgerEntryRows) {
    await db.$executeRaw`
      INSERT INTO ledger_entries (
        ledger_transaction_id,
        ledger_account_id,
        entry_side,
        amount,
        currency_code,
        entry_description
      )
      VALUES (
        ${ledgerTransactionId},
        ${ledgerEntry.ledgerAccountId},
        ${ledgerEntry.entrySide},
        ${ledgerEntry.amount},
        ${scopedCurrencyCode},
        ${ledgerEntry.description}
      )
    `
  }

  let lockConsumption = {
    consumedAmount: 0,
    items: [],
  }
  if (spendPlan.lockedAmountUsed > 0 && normalizedSettlementStationId) {
    lockConsumption = await consumeWalletStationLocks(db, {
      walletId: ensured.wallet.id,
      stationId: normalizedSettlementStationId,
      amountMwk: spendPlan.lockedAmountUsed,
      currencyCode: scopedCurrencyCode,
      actorUserId: normalizedActorUserId,
      ledgerTransactionId,
      relatedEntityType: scopedRelatedEntityType,
      relatedEntityId: scopedRelatedEntityId,
      paymentReference: transactionReference,
    })
    if (toMoneyNumber(lockConsumption.consumedAmount) !== toMoneyNumber(spendPlan.lockedAmountUsed)) {
      throw walletError("Station-locked balance could not be consumed safely.")
    }
  }

  await db.$executeRaw`
    INSERT INTO wallet_audit_logs (
      wallet_id,
      ledger_transaction_id,
      actor_user_id,
      action_type,
      action_summary,
      metadata_json
    )
    VALUES (
      ${ensured.wallet.id},
      ${ledgerTransactionId},
      ${normalizedActorUserId},
      'WALLET_PAYMENT_POSTED',
      ${scopedDescription || "Wallet payment posted"},
      ${JSON.stringify({
        amount: normalizedAmount,
        currencyCode: scopedCurrencyCode,
        transactionReference,
        relatedEntityType: scopedRelatedEntityType,
        relatedEntityId: scopedRelatedEntityId,
        stationLockedAmountConsumed: spendPlan.lockedAmountUsed,
        generalAmountConsumed: spendPlan.generalAmountUsed,
        stationLockBreakdown: lockConsumption.items,
      })}
    )
  `

  const settlement =
    scopedSettlementContext?.stationId
      ? await createSettlementBatchForWalletTransaction(db, {
          stationId: scopedSettlementContext.stationId,
          relatedEntityType: scopedSettlementContext.relatedEntityType || scopedRelatedEntityType,
          relatedEntityId: scopedSettlementContext.relatedEntityId || scopedRelatedEntityId,
          amount: normalizedAmount,
          transactionReference,
          actorUserId: normalizedActorUserId,
          batchDate: scopedSettlementContext.batchDate || null,
          currencyCode: scopedCurrencyCode,
          source: scopedSettlementContext.source || "WALLET_PAYMENT_CAPTURE",
          metadata: scopedSettlementContext.metadata,
        })
      : null

  const balancesAfterPayment = await recalculateWalletBalanceInternal(db, ensured.wallet)
  const transaction = await getMappedWalletTransaction(
    db,
    ensured.wallet.id,
    walletAccount.id,
    { transactionReference }
  )

  return {
    created: true,
    transaction,
    settlement,
    walletBeforePayment: buildWalletSummary({
      wallet: ensured.wallet,
      balances: balancesBeforePayment,
      initializedNow: ensured.created,
    }),
    walletAfterPayment: buildWalletSummary({
      wallet: ensured.wallet,
      balances: balancesAfterPayment,
      initializedNow: ensured.created,
    }),
  }
}

export async function createWalletPayment(params, options = {}) {
  await ensureWalletTablesReady()
  if (options?.tx) {
    return createWalletPaymentInternal(options.tx, params)
  }
  return prisma.$transaction((tx) => createWalletPaymentInternal(tx, params))
}

async function replaceQueuePrepayWalletPaymentInternal(
  db,
  {
    userId,
    stationId,
    queueJoinId,
    nextAmount,
    previousPaymentReference = null,
    actorUserId = null,
    description = "",
    currencyCode = DEFAULT_WALLET_CURRENCY,
    idempotencyKey = null,
    paymentMetadata = null,
    settlementMetadata = null,
  } = {}
) {
  const normalizedUserId = Number(userId || 0)
  const normalizedStationId = Number(stationId || 0)
  const normalizedActorUserId = Number(actorUserId || normalizedUserId || 0) || null
  const normalizedNextAmount = toMoneyNumber(nextAmount)
  const scopedQueueJoinId = String(queueJoinId || "").trim()
  const scopedPreviousPaymentReference = String(previousPaymentReference || "").trim() || null
  const scopedIdempotencyKey = String(idempotencyKey || "").trim() || null
  const scopedDescription = String(description || "").trim() || `Queue prepay updated for ${scopedQueueJoinId}`
  const scopedCurrencyCode = String(currencyCode || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw walletError("Queue prepay replacement requires a valid user.")
  }
  if (!Number.isFinite(normalizedStationId) || normalizedStationId <= 0) {
    throw walletError("Queue prepay replacement requires a valid station.")
  }
  if (!scopedQueueJoinId) {
    throw walletError("Queue prepay replacement requires a queueJoinId.")
  }
  if (!Number.isFinite(normalizedNextAmount) || normalizedNextAmount <= 0) {
    throw walletError("Queue prepay replacement requires a positive amount.")
  }

  const ensured = await ensureUserWalletInternal(db, normalizedUserId, { currencyCode: scopedCurrencyCode })
  const walletStatus = toUpperValue(ensured.wallet?.status, "ACTIVE")
  if (walletStatus !== "ACTIVE") {
    throw walletError("Wallet is not active. Queue prepay cannot be updated.")
  }

  const walletAccount = await ensureWalletLedgerAccount(db, ensured.wallet)
  const clearingAccount = await resolveSystemAccount(
    db,
    WALLET_SYSTEM_ACCOUNT_CODES.PAYMENT_CLEARING,
    scopedCurrencyCode
  )

  let reversal = null
  if (scopedPreviousPaymentReference) {
    const originalTransaction = await getMappedWalletTransaction(
      db,
      ensured.wallet.id,
      walletAccount.id,
      { transactionReference: scopedPreviousPaymentReference }
    )

    if (originalTransaction?.id && !originalTransaction?.reversedAt) {
      const reversalIdempotencyKey = `wallet:queue:prepay:reverse:${scopedPreviousPaymentReference}`
      const existingReversal = await getMappedWalletTransaction(
        db,
        ensured.wallet.id,
        walletAccount.id,
        { idempotencyKey: reversalIdempotencyKey }
      )

      if (existingReversal?.id) {
        reversal = {
          transaction: existingReversal,
          settlement: existingReversal.reference
            ? await getSettlementBatchBySourceTransaction(db, existingReversal.reference, { forUpdate: true })
            : null,
        }
      } else {
        const reversalAmount = toMoneyNumber(originalTransaction.amount)
        const reversalReference = buildTransactionReference("WRV")
        const reversalMetadataJson = JSON.stringify({
          queueJoinId: scopedQueueJoinId,
          replacedPaymentReference: scopedPreviousPaymentReference,
          source: "QUEUE_PREPAY_EDIT_REVERSAL",
          ...(paymentMetadata && typeof paymentMetadata === "object" ? paymentMetadata : {}),
        })

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
            ${ensured.wallet.id},
            ${reversalReference},
            ${scopedPreviousPaymentReference},
            ${originalTransaction.id},
            'REVERSAL',
            'POSTED',
            ${scopedCurrencyCode},
            ${reversalAmount},
            ${reversalAmount},
            0.00,
            ${`Queue prepay reversal for ${scopedQueueJoinId}`},
            'QUEUE',
            ${scopedQueueJoinId},
            ${normalizedActorUserId},
            NULL,
            ${reversalIdempotencyKey},
            CURRENT_TIMESTAMP(3),
            NULL,
            NULL,
            ${reversalMetadataJson}
          )
        `

        const reversalTransaction = await getMappedWalletTransaction(
          db,
          ensured.wallet.id,
          walletAccount.id,
          { transactionReference: reversalReference }
        )
        if (!reversalTransaction?.id) {
          throw walletError("Queue prepay reversal could not be recorded.")
        }

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
              ${reversalTransaction.id},
              ${clearingAccount.id},
              'DEBIT',
              ${reversalAmount},
              ${scopedCurrencyCode},
              ${"Queue prepay reversal removed from settlement clearing"}
            ),
            (
              ${reversalTransaction.id},
              ${walletAccount.id},
              'CREDIT',
              ${reversalAmount},
              ${scopedCurrencyCode},
              ${"Queue prepay reversal credited back to wallet"}
            )
        `

        await db.$executeRaw`
          UPDATE ledger_transactions
          SET
            transaction_status = 'REVERSED',
            reversed_at = CURRENT_TIMESTAMP(3)
          WHERE id = ${originalTransaction.id}
        `

        const reversalSettlement = await createSettlementBatchForWalletTransaction(db, {
          stationId: normalizedStationId,
          relatedEntityType: "QUEUE",
          relatedEntityId: scopedQueueJoinId,
          amount: -Math.abs(reversalAmount),
          transactionReference: reversalReference,
          actorUserId: normalizedActorUserId,
          currencyCode: scopedCurrencyCode,
          source: "WALLET_QUEUE_PREPAY_REVERSAL",
          metadata: {
            queueJoinId: scopedQueueJoinId,
            replacedPaymentReference: scopedPreviousPaymentReference,
            ...(settlementMetadata && typeof settlementMetadata === "object" ? settlementMetadata : {}),
          },
        })

        await db.$executeRaw`
          INSERT INTO wallet_audit_logs (
            wallet_id,
            ledger_transaction_id,
            actor_user_id,
            action_type,
            action_summary,
            metadata_json
          )
          VALUES (
            ${ensured.wallet.id},
            ${reversalTransaction.id},
            ${normalizedActorUserId},
            'WALLET_PAYMENT_REVERSED',
            ${`Queue prepay ${scopedPreviousPaymentReference} reversed for edited request ${scopedQueueJoinId}.`},
            ${JSON.stringify({
              queueJoinId: scopedQueueJoinId,
              replacedPaymentReference: scopedPreviousPaymentReference,
              reversalReference,
            })}
          )
        `

        reversal = {
          transaction: reversalTransaction,
          settlement: reversalSettlement,
        }
      }
    }
  }

  const replacement = await createWalletPaymentInternal(db, {
    userId: normalizedUserId,
    amount: normalizedNextAmount,
    actorUserId: normalizedActorUserId,
    description: scopedDescription,
    currencyCode: scopedCurrencyCode,
    relatedEntityType: "QUEUE",
    relatedEntityId: scopedQueueJoinId,
    idempotencyKey: scopedIdempotencyKey,
    metadata: {
      queueJoinId: scopedQueueJoinId,
      source: "QUEUE_PREPAY_EDIT_REPLACEMENT",
      replacedPaymentReference: scopedPreviousPaymentReference,
      ...(paymentMetadata && typeof paymentMetadata === "object" ? paymentMetadata : {}),
    },
    settlementContext: {
      stationId: normalizedStationId,
      relatedEntityType: "QUEUE",
      relatedEntityId: scopedQueueJoinId,
      source: "WALLET_QUEUE_PREPAY_EDIT",
      metadata: {
        queueJoinId: scopedQueueJoinId,
        replacedPaymentReference: scopedPreviousPaymentReference,
        ...(settlementMetadata && typeof settlementMetadata === "object" ? settlementMetadata : {}),
      },
    },
  })

  return {
    replacement,
    reversal,
  }
}

export async function replaceQueuePrepayWalletPayment(params, options = {}) {
  await ensureWalletTablesReady()
  if (options?.tx) {
    return replaceQueuePrepayWalletPaymentInternal(options.tx, params)
  }
  return prisma.$transaction((tx) => replaceQueuePrepayWalletPaymentInternal(tx, params))
}

export async function createPrototypeWalletTopup(
  userId,
  { amount, actorUserId = null, note = "", currencyCode = DEFAULT_WALLET_CURRENCY } = {}
) {
  await ensureWalletTablesReady()
  const normalizedUserId = Number(userId || 0)
  const normalizedActorUserId = Number(actorUserId || normalizedUserId || 0)
  const normalizedAmount = toMoneyNumber(amount)
  const description = String(note || "").trim()

  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw walletError("Top-up amount must be greater than zero.")
  }
  if (normalizedAmount > MAX_WALLET_TOPUP_AMOUNT) {
    throw walletError(`Top-up amount must not exceed MWK ${MAX_WALLET_TOPUP_AMOUNT.toLocaleString()}.`)
  }

  const transactionReference = buildTransactionReference("WTU")
  const metadataJson = JSON.stringify({
    channel: "USER_APP_PROTOTYPE_TOPUP",
    note: description || null,
  })

  const result = await prisma.$transaction(async (tx) => {
    const ensured = await ensureUserWalletInternal(tx, normalizedUserId, { currencyCode })
    const walletStatus = toUpperValue(ensured.wallet?.status, "ACTIVE")
    if (walletStatus !== "ACTIVE") {
      throw walletError("Wallet is not active. Top-ups are unavailable.")
    }

    const walletAccount = await ensureWalletLedgerAccount(tx, ensured.wallet)
    const clearingAccount = await resolveSystemAccount(
      tx,
      WALLET_SYSTEM_ACCOUNT_CODES.PAYMENT_CLEARING,
      currencyCode
    )

    await tx.$executeRaw`
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
        ${ensured.wallet.id},
        ${transactionReference},
        NULL,
        NULL,
        'TOPUP',
        'POSTED',
        ${currencyCode},
        ${normalizedAmount},
        ${normalizedAmount},
        0.00,
        ${description || "Wallet top-up"},
        'USER_WALLET',
        ${String(ensured.wallet.wallet_public_id || ensured.wallet.wallet_number || "").trim()},
        ${normalizedActorUserId || null},
        NULL,
        NULL,
        CURRENT_TIMESTAMP(3),
        NULL,
        NULL,
        ${metadataJson}
      )
    `

    const transactionRows = await tx.$queryRaw`
      SELECT id, transaction_reference
      FROM ledger_transactions
      WHERE transaction_reference = ${transactionReference}
      LIMIT 1
    `
    const ledgerTransaction = transactionRows?.[0] || null
    if (!ledgerTransaction?.id) {
      throw walletError("Wallet top-up could not be recorded.")
    }

    await tx.$executeRaw`
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
          ${clearingAccount.id},
          'DEBIT',
          ${normalizedAmount},
          ${currencyCode},
          ${"Prototype top-up clearing entry"}
        ),
        (
          ${ledgerTransaction.id},
          ${walletAccount.id},
          'CREDIT',
          ${normalizedAmount},
          ${currencyCode},
          ${description || "Wallet top-up"}
        )
    `

    await tx.$executeRaw`
      INSERT INTO wallet_audit_logs (
        wallet_id,
        ledger_transaction_id,
        actor_user_id,
        action_type,
        action_summary,
        metadata_json
      )
      VALUES (
        ${ensured.wallet.id},
        ${ledgerTransaction.id},
        ${normalizedActorUserId || null},
        'WALLET_TOPUP_POSTED',
        ${`Prototype wallet top-up posted: MWK ${normalizedAmount.toLocaleString()}`},
        ${metadataJson}
      )
    `

    const balances = await recalculateWalletBalanceInternal(tx, ensured.wallet)
    return {
      wallet: ensured.wallet,
      initializedNow: ensured.created,
      balances,
      transactionId: Number(ledgerTransaction.id),
    }
  })

  const transactions = await getUserWalletTransactions(normalizedUserId, { page: 1, limit: 1 })

  return {
    wallet: buildWalletSummary(result),
    transaction: transactions.items?.[0] || null,
  }
}

async function postWalletRefundInternal(
  db,
  {
    userId,
    amount,
    refundPublicId,
    actorUserId = null,
    sourceTransactionPublicId = "",
    note = "",
    currencyCode = DEFAULT_WALLET_CURRENCY,
  }
) {
  const normalizedUserId = Number(userId || 0)
  const normalizedActorUserId = Number(actorUserId || 0) || null
  const normalizedAmount = toMoneyNumber(amount)
  const scopedRefundPublicId = String(refundPublicId || "").trim()
  const scopedSourceTransactionPublicId = String(sourceTransactionPublicId || "").trim()
  const scopedCurrencyCode = String(currencyCode || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY
  const description = String(note || "").trim()

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw walletError("Refund posting requires a valid user.")
  }
  if (!scopedRefundPublicId) {
    throw walletError("Refund posting requires a refund request reference.")
  }
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw walletError("Refund amount must be greater than zero.")
  }

  const ensured = await ensureUserWalletInternal(db, normalizedUserId, { currencyCode: scopedCurrencyCode })
  const walletStatus = toUpperValue(ensured.wallet?.status, "ACTIVE")
  if (walletStatus !== "ACTIVE") {
    throw walletError("Wallet is not active. Refund cannot be credited.")
  }

  const walletAccount = await ensureWalletLedgerAccount(db, ensured.wallet)
  const idempotencyKey = `wallet:refund:${scopedRefundPublicId}`
  const existingTransaction = await getMappedWalletTransaction(db, ensured.wallet.id, walletAccount.id, {
    idempotencyKey,
  })

  if (existingTransaction?.id) {
    const balances = await recalculateWalletBalanceInternal(db, ensured.wallet)
    return {
      wallet: buildWalletSummary({
        wallet: ensured.wallet,
        balances,
        initializedNow: ensured.created,
      }),
      transaction: existingTransaction,
      created: false,
    }
  }

  const refundsPayableAccount = await resolveSystemAccount(
    db,
    WALLET_SYSTEM_ACCOUNT_CODES.REFUNDS_PAYABLE,
    scopedCurrencyCode
  )

  const transactionReference = buildTransactionReference("WRF")
  const metadataJson = JSON.stringify({
    refundPublicId: scopedRefundPublicId,
    sourceTransactionPublicId: scopedSourceTransactionPublicId || null,
    note: description || null,
    source: "REFUND_APPROVAL",
  })

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
      ${ensured.wallet.id},
      ${transactionReference},
      ${scopedSourceTransactionPublicId || null},
      NULL,
      'REFUND',
      'POSTED',
      ${scopedCurrencyCode},
      ${normalizedAmount},
      ${normalizedAmount},
      0.00,
      ${description || `Wallet refund credited for ${scopedRefundPublicId}`},
      'REFUND_REQUEST',
      ${scopedRefundPublicId},
      ${normalizedActorUserId || normalizedUserId},
      ${normalizedActorUserId},
      ${idempotencyKey},
      CURRENT_TIMESTAMP(3),
      NULL,
      NULL,
      ${metadataJson}
    )
  `

  const transaction = await getMappedWalletTransaction(db, ensured.wallet.id, walletAccount.id, {
    transactionReference,
  })
  if (!transaction?.id) {
    throw walletError("Refund wallet transaction could not be recorded.")
  }

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
        ${transaction.id},
        ${refundsPayableAccount.id},
        'DEBIT',
        ${normalizedAmount},
        ${scopedCurrencyCode},
        ${"Approved refund posted against refunds payable"}
      ),
      (
        ${transaction.id},
        ${walletAccount.id},
        'CREDIT',
        ${normalizedAmount},
        ${scopedCurrencyCode},
        ${description || "Refund credited to customer wallet"}
      )
  `

  await db.$executeRaw`
    INSERT INTO wallet_audit_logs (
      wallet_id,
      ledger_transaction_id,
      actor_user_id,
      action_type,
      action_summary,
      metadata_json
    )
    VALUES (
      ${ensured.wallet.id},
      ${transaction.id},
      ${normalizedActorUserId || normalizedUserId},
      'WALLET_REFUND_POSTED',
      ${`Refund ${scopedRefundPublicId} credited to wallet.`},
      ${metadataJson}
    )
  `

  const postedTransaction = await getMappedWalletTransaction(db, ensured.wallet.id, walletAccount.id, {
    transactionId: transaction.id,
  })
  const balances = await recalculateWalletBalanceInternal(db, ensured.wallet)
  return {
    wallet: buildWalletSummary({
      wallet: ensured.wallet,
      balances,
      initializedNow: ensured.created,
    }),
    transaction: postedTransaction || transaction,
    created: true,
  }
}

export async function postWalletRefund(params, options = {}) {
  await ensureWalletTablesReady()
  if (options?.tx) {
    return postWalletRefundInternal(options.tx, params)
  }
  return prisma.$transaction((tx) => postWalletRefundInternal(tx, params))
}

async function createWalletCashbackCreditInternal(
  db,
  {
    userId,
    amount,
    actorUserId = null,
    currencyCode = DEFAULT_WALLET_CURRENCY,
    transactionPublicId = "",
    relatedEntityType = "TRANSACTION",
    relatedEntityId = "",
    note = "",
    idempotencyKey = "",
    metadata = null,
  }
) {
  const normalizedUserId = Number(userId || 0)
  const normalizedActorUserId = Number(actorUserId || normalizedUserId || 0) || null
  const normalizedAmount = toMoneyNumber(amount)
  const scopedCurrencyCode = String(currencyCode || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY
  const scopedTransactionPublicId = String(transactionPublicId || "").trim() || null
  const scopedRelatedEntityType = String(relatedEntityType || "TRANSACTION").trim().toUpperCase() || "TRANSACTION"
  const scopedRelatedEntityId = String(relatedEntityId || scopedTransactionPublicId || "").trim()
  const scopedDescription = String(note || "").trim() || "SmartLink cashback credited"
  const scopedIdempotencyKey = String(idempotencyKey || "").trim()

  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw walletError("Cashback credit requires a valid user.")
  }
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    throw walletError("Cashback amount must be greater than zero.")
  }
  if (!scopedRelatedEntityId) {
    throw walletError("Cashback credit requires a related entity reference.")
  }

  const ensured = await ensureUserWalletInternal(db, normalizedUserId, { currencyCode: scopedCurrencyCode })
  const walletStatus = toUpperValue(ensured.wallet?.status, "ACTIVE")
  if (walletStatus !== "ACTIVE") {
    throw walletError("Wallet is not active. Cashback cannot be credited.")
  }

  const walletAccount = await ensureWalletLedgerAccount(db, ensured.wallet)
  if (scopedIdempotencyKey) {
    const existingTransaction = await getMappedWalletTransaction(db, ensured.wallet.id, walletAccount.id, {
      idempotencyKey: scopedIdempotencyKey,
    })
    if (existingTransaction?.id) {
      const balances = await recalculateWalletBalanceInternal(db, ensured.wallet)
      return {
        created: false,
        transaction: existingTransaction,
        wallet: buildWalletSummary({
          wallet: ensured.wallet,
          balances,
          initializedNow: ensured.created,
        }),
      }
    }
  }

  const adjustmentsAccount = await resolveSystemAccount(
    db,
    WALLET_SYSTEM_ACCOUNT_CODES.MANUAL_ADJUSTMENTS,
    scopedCurrencyCode
  )
  const transactionReference = buildTransactionReference("WCB")
  const metadataJson = JSON.stringify({
    source: "SMARTLINK_CASHBACK",
    transactionPublicId: scopedTransactionPublicId,
    relatedEntityType: scopedRelatedEntityType,
    relatedEntityId: scopedRelatedEntityId,
    ...(metadata && typeof metadata === "object" ? metadata : {}),
  })

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
      ${ensured.wallet.id},
      ${transactionReference},
      ${scopedTransactionPublicId},
      NULL,
      'ADJUSTMENT',
      'POSTED',
      ${scopedCurrencyCode},
      ${normalizedAmount},
      ${normalizedAmount},
      0.00,
      ${scopedDescription},
      ${scopedRelatedEntityType},
      ${scopedRelatedEntityId},
      ${normalizedActorUserId},
      ${normalizedActorUserId},
      ${scopedIdempotencyKey || null},
      CURRENT_TIMESTAMP(3),
      NULL,
      NULL,
      ${metadataJson}
    )
  `

  const transaction = await getMappedWalletTransaction(db, ensured.wallet.id, walletAccount.id, {
    transactionReference,
  })
  if (!transaction?.id) {
    throw walletError("Cashback wallet transaction could not be recorded.")
  }

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
        ${transaction.id},
        ${adjustmentsAccount.id},
        'DEBIT',
        ${normalizedAmount},
        ${scopedCurrencyCode},
        ${"SmartLink cashback expense posted"}
      ),
      (
        ${transaction.id},
        ${walletAccount.id},
        'CREDIT',
        ${normalizedAmount},
        ${scopedCurrencyCode},
        ${scopedDescription}
      )
  `

  await db.$executeRaw`
    INSERT INTO wallet_audit_logs (
      wallet_id,
      ledger_transaction_id,
      actor_user_id,
      action_type,
      action_summary,
      metadata_json
    )
    VALUES (
      ${ensured.wallet.id},
      ${transaction.id},
      ${normalizedActorUserId},
      'WALLET_CASHBACK_CREDITED',
      ${`Cashback credited for ${scopedRelatedEntityId}.`},
      ${metadataJson}
    )
  `

  const balances = await recalculateWalletBalanceInternal(db, ensured.wallet)
  return {
    created: true,
    transaction,
    wallet: buildWalletSummary({
      wallet: ensured.wallet,
      balances,
      initializedNow: ensured.created,
    }),
  }
}

export async function createWalletCashbackCredit(params, options = {}) {
  await ensureWalletTablesReady()
  if (options?.tx) {
    return createWalletCashbackCreditInternal(options.tx, params)
  }
  return prisma.$transaction((tx) => createWalletCashbackCreditInternal(tx, params))
}

const SMARTLINK_USER_PUBLIC_ID_REGEX = /^(SLU-[A-Z0-9]{6}|[0-9A-HJKMNP-TV-Z]{26})$/i
const MAX_WALLET_TRANSFER_PAGE_SIZE = 50
const MIN_WALLET_TRANSFER_AMOUNT = Math.max(1, Number(process.env.WALLET_TRANSFER_MIN_MWK || 1))
const MAX_WALLET_TRANSFER_AMOUNT = Math.max(
  MIN_WALLET_TRANSFER_AMOUNT,
  Number(process.env.WALLET_TRANSFER_MAX_MWK || 250000)
)

function normalizeWalletTransferMode(value, fallback = "NORMAL") {
  const normalized = toUpperValue(value, fallback)
  return normalized === "STATION_LOCKED" ? "STATION_LOCKED" : "NORMAL"
}

function normalizeWalletTransferInitiatedVia(value, fallback = "USER_ID") {
  const normalized = toUpperValue(value, fallback)
  return normalized === "QR" ? "QR" : "USER_ID"
}

function buildWalletTransferPublicId() {
  return createPublicId()
}

function buildWalletTransferRecipientSummary(recipient = {}) {
  const fullName = String(recipient.fullName || "").trim() || "SmartLink user"
  const initials = fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")

  return {
    userId: Number(recipient.userId || 0),
    publicId: String(recipient.publicId || "").trim() || null,
    fullName,
    initials: initials || null,
  }
}

function buildWalletTransferHistoryItem(row, currentUserId = null) {
  if (!row?.public_id) return null

  const normalizedCurrentUserId = Number(currentUserId || 0) || null
  const senderUserId = Number(row.sender_user_id || 0) || null
  const receiverUserId = Number(row.receiver_user_id || 0) || null
  const direction =
    normalizedCurrentUserId && normalizedCurrentUserId === senderUserId
      ? "SENT"
      : normalizedCurrentUserId && normalizedCurrentUserId === receiverUserId
        ? "RECEIVED"
        : "NEUTRAL"

  const sender = buildWalletTransferRecipientSummary({
    userId: senderUserId,
    publicId: String(row.sender_public_id || "").trim(),
    fullName: String(row.sender_full_name || "").trim(),
  })
  const receiver = buildWalletTransferRecipientSummary({
    userId: receiverUserId,
    publicId: String(row.receiver_public_id || "").trim(),
    fullName: String(row.receiver_full_name || "").trim(),
  })

  return {
    publicId: String(row.public_id || "").trim(),
    amountMwk: toMoneyNumber(row.amount_mwk),
    currencyCode: String(row.currency_code || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY,
    transferMode: normalizeWalletTransferMode(row.transfer_mode),
    status: toUpperValue(row.status, "PENDING"),
    initiatedVia: normalizeWalletTransferInitiatedVia(row.initiated_via),
    qrReference: String(row.qr_reference || "").trim() || null,
    note: String(row.note || "").trim() || null,
    direction,
    sender,
    receiver,
    counterparty: direction === "SENT" ? receiver : sender,
    station: row.locked_station_id
      ? {
          id: Number(row.locked_station_id || 0),
          publicId: String(row.station_public_id || "").trim() || null,
          name: String(row.station_name || "").trim() || null,
        }
      : null,
    senderLedgerTransactionId: Number(row.sender_ledger_transaction_id || 0) || null,
    receiverLedgerTransactionId: Number(row.receiver_ledger_transaction_id || 0) || null,
    metadata: parseMetadata(row.metadata_json),
    createdAt: toIsoOrNull(row.created_at),
    completedAt: toIsoOrNull(row.completed_at),
    failedAt: toIsoOrNull(row.failed_at),
  }
}

function formatWalletTransferMoney(amountMwk) {
  return `MWK ${toMoneyNumber(amountMwk).toLocaleString()}`
}

function buildWalletTransferReceivedNotification(transfer) {
  const amountLabel = formatWalletTransferMoney(transfer?.amountMwk)
  const senderName =
    String(transfer?.sender?.fullName || "").trim()
    || String(transfer?.sender?.publicId || "").trim()
    || "a SmartLink user"
  const senderPublicId = String(transfer?.sender?.publicId || "").trim() || null
  const stationName = String(transfer?.station?.name || "").trim() || null
  const isStationLocked = String(transfer?.transferMode || "").trim().toUpperCase() === "STATION_LOCKED"

  const title = isStationLocked ? "Station-locked credit received" : "Credit received"
  const body = isStationLocked
    ? `${amountLabel} from ${senderName} is now locked to ${stationName || "the selected station"}.`
    : `${amountLabel} was added to your SmartLink wallet from ${senderName}.`

  return {
    title,
    body,
    metadata: {
      event: "wallet_transfer_received",
      path: "/m/wallet",
      route: "/m/wallet",
      transferPublicId: String(transfer?.publicId || "").trim() || null,
      amountMwk: toMoneyNumber(transfer?.amountMwk),
      currencyCode: String(transfer?.currencyCode || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY,
      transferMode: normalizeWalletTransferMode(transfer?.transferMode || "NORMAL"),
      senderUserPublicId: senderPublicId,
      senderName,
      stationPublicId: String(transfer?.station?.publicId || "").trim() || null,
      stationName,
    },
  }
}

async function notifyUserOfReceivedWalletTransfer(transfer) {
  const receiverUserId = Number(transfer?.receiver?.userId || 0)
  if (!Number.isFinite(receiverUserId) || receiverUserId <= 0) return null

  const notification = buildWalletTransferReceivedNotification(transfer)
  let alert = null

  try {
    await ensureUserAlertsTableReady()
    alert = await createUserAlert({
      userId: receiverUserId,
      stationId: Number(transfer?.station?.id || 0) || null,
      category: "SYSTEM",
      title: notification.title,
      body: notification.body,
      metadata: notification.metadata,
    })

    publishUserAlert({
      userId: receiverUserId,
      eventType: "user_alert:new",
      data: alert,
    })
  } catch (error) {
    console.warn("Failed to persist wallet transfer received alert", error?.message || error)
  }

  try {
    await sendPushAlertToUser({
      userId: receiverUserId,
      notification: {
        title: alert?.title || notification.title,
        body: alert?.message || notification.body,
        tag: alert?.publicId || `wallet-transfer-${String(transfer?.publicId || "").trim() || Date.now()}`,
        url: "/m/wallet",
        icon: "/smartlogo.png",
        badge: "/smartlogo.png",
      },
      data: {
        alertPublicId: alert?.publicId || null,
        transferPublicId: String(transfer?.publicId || "").trim() || null,
        transferMode: notification.metadata.transferMode,
        amountMwk: notification.metadata.amountMwk,
        stationPublicId: notification.metadata.stationPublicId,
        path: "/m/wallet",
      },
    })
  } catch (error) {
    console.warn("Failed to send wallet transfer received push alert", error?.message || error)
  }

  return {
    alert,
    notification,
  }
}

async function ensureWalletTransferTablesReady() {
  await ensureWalletTablesReady()
  try {
    await prisma.$queryRaw`
      SELECT id, public_id, sender_user_id, receiver_user_id
      FROM wallet_user_transfers
      LIMIT 1
    `
  } catch (error) {
    if (isWalletFoundationTableMissingError(error)) {
      const wrapped = new Error(
        "Wallet transfer storage is unavailable. Run SQL migration 052_wallet_user_transfers_station_locks.sql."
      )
      wrapped.cause = error
      throw wrapped
    }
    throw error
  }
}

async function resolveActiveUserByPublicId(
  db,
  userPublicId,
  { forUpdate = false } = {}
) {
  const scopedUserPublicId = String(userPublicId || "").trim().toUpperCase()
  if (!SMARTLINK_USER_PUBLIC_ID_REGEX.test(scopedUserPublicId)) {
    throw walletError("Recipient user ID is invalid.")
  }

  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT id, public_id, full_name, is_active
    FROM users
    WHERE public_id = ${scopedUserPublicId}
    LIMIT 1
    ${lockingClause}
  `

  const user = rows?.[0] || null
  if (!user?.id || !Number(user?.is_active || 0)) {
    throw walletError("Recipient user account is unavailable.", 404)
  }

  return {
    userId: Number(user.id),
    publicId: String(user.public_id || "").trim(),
    fullName: String(user.full_name || "").trim() || "SmartLink user",
  }
}

async function resolveWalletTransferStation(
  db,
  { stationPublicId = null, stationId = null, forUpdate = false } = {}
) {
  const scopedStationPublicId = String(stationPublicId || "").trim()
  const scopedStationId = Number(stationId || 0)
  if (!scopedStationPublicId && !(scopedStationId > 0)) {
    return null
  }

  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT id, public_id, name, is_active
    FROM stations
    WHERE (
      (${scopedStationPublicId} <> '' AND public_id = ${scopedStationPublicId})
      OR (${scopedStationId} > 0 AND id = ${scopedStationId})
    )
    LIMIT 1
    ${lockingClause}
  `

  const station = rows?.[0] || null
  if (!station?.id || !Number(station?.is_active || 0)) {
    throw walletError("Station is unavailable for locked transfers.", 404)
  }

  return {
    id: Number(station.id),
    publicId: String(station.public_id || "").trim(),
    name: String(station.name || "").trim() || "Station",
  }
}

function normalizeWalletTransferAmount(amountMwk) {
  const normalizedAmount = Number(amountMwk)
  if (!Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
    throw walletError("Transfer amount must be a whole MWK value greater than zero.")
  }
  if (normalizedAmount < MIN_WALLET_TRANSFER_AMOUNT) {
    throw walletError(`Transfer amount must be at least MWK ${MIN_WALLET_TRANSFER_AMOUNT.toLocaleString()}.`)
  }
  if (normalizedAmount > MAX_WALLET_TRANSFER_AMOUNT) {
    throw walletError(`Transfer amount must not exceed MWK ${MAX_WALLET_TRANSFER_AMOUNT.toLocaleString()}.`)
  }
  return normalizedAmount
}

async function resolveWalletTransferRecipient(
  db,
  {
    recipientUserId = null,
    recipientQrPayload = null,
    forUpdate = false,
  } = {}
) {
  const scopedRecipientUserId = String(recipientUserId || "").trim()
  const scopedRecipientQrPayload = String(recipientQrPayload || "").trim()
  if (!scopedRecipientUserId && !scopedRecipientQrPayload) {
    throw walletError("A recipient user ID or recipient QR payload is required.")
  }
  if (scopedRecipientUserId && scopedRecipientQrPayload) {
    throw walletError("Provide either a recipient user ID or a recipient QR payload, not both.")
  }

  if (scopedRecipientQrPayload) {
    const qrPayload = parseWalletTransferRecipientQrPayload(scopedRecipientQrPayload)
    const recipient = await resolveActiveUserByPublicId(db, qrPayload.recipientUserPublicId, {
      forUpdate,
    })
    return {
      ...recipient,
      initiatedVia: "QR",
      qrReference: qrPayload.nonce || qrPayload.recipientDisplayId || qrPayload.recipientUserPublicId,
      qrPayload,
    }
  }

  const recipient = await resolveActiveUserByPublicId(db, scopedRecipientUserId, {
    forUpdate,
  })
  return {
    ...recipient,
    initiatedVia: "USER_ID",
    qrReference: null,
    qrPayload: null,
  }
}

async function fetchWalletUserTransferRow(db, publicId) {
  const scopedPublicId = String(publicId || "").trim()
  if (!scopedPublicId) return null

  const rows = await db.$queryRaw`
    SELECT
      wt.id,
      wt.public_id,
      wt.sender_user_id,
      wt.receiver_user_id,
      wt.sender_wallet_id,
      wt.receiver_wallet_id,
      wt.sender_ledger_transaction_id,
      wt.receiver_ledger_transaction_id,
      wt.amount_mwk,
      wt.currency_code,
      wt.transfer_mode,
      wt.locked_station_id,
      wt.status,
      wt.initiated_via,
      wt.qr_reference,
      wt.note,
      wt.metadata_json,
      wt.created_at,
      wt.completed_at,
      wt.failed_at,
      sender.public_id AS sender_public_id,
      sender.full_name AS sender_full_name,
      receiver.public_id AS receiver_public_id,
      receiver.full_name AS receiver_full_name,
      st.public_id AS station_public_id,
      st.name AS station_name
    FROM wallet_user_transfers wt
    INNER JOIN users sender ON sender.id = wt.sender_user_id
    INNER JOIN users receiver ON receiver.id = wt.receiver_user_id
    LEFT JOIN stations st ON st.id = wt.locked_station_id
    WHERE wt.public_id = ${scopedPublicId}
    LIMIT 1
  `

  return rows?.[0] || null
}

async function findWalletUserTransferByIdempotency(db, senderUserId, idempotencyKey) {
  const scopedIdempotencyKey = String(idempotencyKey || "").trim()
  if (!scopedIdempotencyKey) return null

  const rows = await db.$queryRaw`
    SELECT public_id
    FROM wallet_user_transfers
    WHERE sender_user_id = ${senderUserId}
      AND idempotency_key = ${scopedIdempotencyKey}
    LIMIT 1
  `

  const publicId = String(rows?.[0]?.public_id || "").trim()
  return publicId ? fetchWalletUserTransferRow(db, publicId) : null
}

async function createWalletTransferLedgerTransaction(
  db,
  {
    wallet,
    walletAccount,
    counterAccount,
    amountMwk,
    description,
    relatedEntityId,
    actorUserId,
    idempotencyKey = null,
    metadata = null,
    direction = "DEBIT",
  }
) {
  const normalizedDirection = toUpperValue(direction, "DEBIT")
  const transactionReference = buildTransactionReference(normalizedDirection === "DEBIT" ? "WTD" : "WTC")
  const normalizedAmount = toMoneyNumber(amountMwk)

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
      NULL,
      NULL,
      'TRANSFER',
      'POSTED',
      ${wallet.currency_code},
      ${normalizedAmount},
      ${normalizedAmount},
      0.00,
      ${description},
      'WALLET_TRANSFER',
      ${relatedEntityId},
      ${actorUserId},
      NULL,
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
  if (!ledgerTransaction?.id) {
    throw walletError("Wallet transfer ledger transaction could not be recorded.")
  }

  if (normalizedDirection === "DEBIT") {
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
          ${wallet.currency_code},
          ${description}
        ),
        (
          ${ledgerTransaction.id},
          ${counterAccount.id},
          'CREDIT',
          ${normalizedAmount},
          ${wallet.currency_code},
          ${"Wallet transfer moved into transfer clearing"}
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
          ${counterAccount.id},
          'DEBIT',
          ${normalizedAmount},
          ${wallet.currency_code},
          ${"Wallet transfer released from transfer clearing"}
        ),
        (
          ${ledgerTransaction.id},
          ${walletAccount.id},
          'CREDIT',
          ${normalizedAmount},
          ${wallet.currency_code},
          ${description}
        )
    `
  }

  return {
    id: Number(ledgerTransaction.id),
    reference: String(ledgerTransaction.transaction_reference || "").trim() || transactionReference,
  }
}

async function logWalletTransferAudit(db, {
  walletId,
  ledgerTransactionId = null,
  actorUserId = null,
  actionType,
  actionSummary,
  metadata = null,
}) {
  await db.$executeRaw`
    INSERT INTO wallet_audit_logs (
      wallet_id,
      ledger_transaction_id,
      actor_user_id,
      action_type,
      action_summary,
      metadata_json
    )
    VALUES (
      ${walletId},
      ${ledgerTransactionId},
      ${actorUserId},
      ${actionType},
      ${actionSummary},
      ${metadata ? JSON.stringify(metadata) : null}
    )
  `
}

export async function getWalletTransferRecipientQr(userId) {
  await ensureWalletTransferTablesReady()
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw walletError("Recipient QR generation requires an authenticated user.")
  }

  await ensureUserWallet(normalizedUserId)
  const rows = await prisma.$queryRaw`
    SELECT public_id, full_name, is_active
    FROM users
    WHERE id = ${normalizedUserId}
    LIMIT 1
  `
  const user = rows?.[0] || null
  if (!user?.public_id || !Number(user?.is_active || 0)) {
    throw walletError("Recipient user account is unavailable.", 404)
  }

  const qr = await createWalletTransferRecipientQr({
    recipientUserPublicId: String(user.public_id || "").trim(),
    recipientDisplayId: String(user.public_id || "").trim(),
  })

  return {
    recipient: buildWalletTransferRecipientSummary({
      userId: normalizedUserId,
      publicId: String(user.public_id || "").trim(),
      fullName: String(user.full_name || "").trim(),
    }),
    qr,
  }
}

export async function previewWalletUserTransfer({
  senderUserId,
  recipientUserId = null,
  recipientQrPayload = null,
  amountMwk,
  transferMode = "NORMAL",
  stationPublicId = null,
  stationId = null,
  note = "",
} = {}) {
  await ensureWalletTransferTablesReady()
  const normalizedSenderUserId = Number(senderUserId || 0)
  if (!Number.isFinite(normalizedSenderUserId) || normalizedSenderUserId <= 0) {
    throw walletError("Wallet transfer preview requires an authenticated user.")
  }

  const normalizedAmount = normalizeWalletTransferAmount(amountMwk)
  const normalizedTransferMode = normalizeWalletTransferMode(transferMode)
  const trimmedNote = String(note || "").trim() || null

  const [senderWalletSummary, recipient] = await Promise.all([
    getUserWalletSummary(normalizedSenderUserId),
    resolveWalletTransferRecipient(prisma, {
      recipientUserId,
      recipientQrPayload,
    }),
  ])

  if (recipient.userId === normalizedSenderUserId) {
    throw walletError("You cannot send SmartLink credit to your own account.")
  }
  if (senderWalletSummary.status !== "ACTIVE") {
    throw walletError("Wallet is not active. Transfers are unavailable.")
  }
  if (senderWalletSummary.availableBalance < normalizedAmount) {
    throw walletError(
      `Insufficient wallet balance. You can transfer up to MWK ${senderWalletSummary.availableBalance.toLocaleString()}.`
    )
  }

  const station =
    normalizedTransferMode === "STATION_LOCKED"
      ? await resolveWalletTransferStation(prisma, {
          stationPublicId,
          stationId,
        })
      : null

  if (normalizedTransferMode === "STATION_LOCKED" && !station?.id) {
    throw walletError("A valid station is required for station-locked transfers.")
  }

  return {
    recipient: buildWalletTransferRecipientSummary(recipient),
    transfer: {
      amountMwk: normalizedAmount,
      currencyCode: DEFAULT_WALLET_CURRENCY,
      transferMode: normalizedTransferMode,
      station,
      note: trimmedNote,
      initiatedVia: recipient.initiatedVia,
      qrReference: recipient.qrReference,
    },
    senderWallet: {
      walletId: senderWalletSummary.walletId,
      walletPublicId: senderWalletSummary.walletPublicId,
      availableBalance: senderWalletSummary.availableBalance,
      lockedBalance: senderWalletSummary.lockedBalance,
      remainingAvailableBalance: toMoneyNumber(senderWalletSummary.availableBalance - normalizedAmount),
      currencyCode: senderWalletSummary.currencyCode,
    },
    validationMessages: [],
  }
}

export async function createWalletUserTransfer({
  senderUserId,
  recipientUserId = null,
  recipientQrPayload = null,
  amountMwk,
  transferMode = "NORMAL",
  stationPublicId = null,
  stationId = null,
  note = "",
  idempotencyKey = null,
} = {}) {
  await ensureWalletTransferTablesReady()
  const normalizedSenderUserId = Number(senderUserId || 0)
  if (!Number.isFinite(normalizedSenderUserId) || normalizedSenderUserId <= 0) {
    throw walletError("Wallet transfer requires an authenticated user.")
  }

  const normalizedAmount = normalizeWalletTransferAmount(amountMwk)
  const normalizedTransferMode = normalizeWalletTransferMode(transferMode)
  const trimmedNote = String(note || "").trim() || null
  const scopedIdempotencyKey = String(idempotencyKey || "").trim() || null

  let senderWalletForAudit = null

  try {
    const recipientForProvisioning = await resolveWalletTransferRecipient(prisma, {
      recipientUserId,
      recipientQrPayload,
    })
    if (recipientForProvisioning.userId === normalizedSenderUserId) {
      throw walletError("You cannot send SmartLink credit to your own account.")
    }

    const userIdsToProvision = Array.from(
      new Set([normalizedSenderUserId, Number(recipientForProvisioning.userId || 0)].filter((value) => value > 0))
    ).sort((left, right) => left - right)
    for (const userIdToProvision of userIdsToProvision) {
      const ensured = await ensureUserWallet(userIdToProvision)
      if (userIdToProvision === normalizedSenderUserId) {
        senderWalletForAudit = ensured.wallet
      }
    }

    if (scopedIdempotencyKey) {
      const existingTransfer = await findWalletUserTransferByIdempotency(prisma, normalizedSenderUserId, scopedIdempotencyKey)
      if (existingTransfer?.public_id) {
        const [senderWalletSummary, receiverWalletSummary] = await Promise.all([
          getUserWalletSummary(normalizedSenderUserId),
          getUserWalletSummary(recipientForProvisioning.userId),
        ])
        return {
          created: false,
          transfer: buildWalletTransferHistoryItem(existingTransfer, normalizedSenderUserId),
          senderWallet: senderWalletSummary,
          receiverWallet: receiverWalletSummary,
        }
      }
    }

    const transferResult = await prisma.$transaction(async (tx) => {
      const recipient = await resolveWalletTransferRecipient(tx, {
        recipientUserId,
        recipientQrPayload,
        forUpdate: true,
      })
      if (recipient.userId === normalizedSenderUserId) {
        throw walletError("You cannot send SmartLink credit to your own account.")
      }

      const station =
        normalizedTransferMode === "STATION_LOCKED"
          ? await resolveWalletTransferStation(tx, {
              stationPublicId,
              stationId,
              forUpdate: true,
            })
          : null

      if (normalizedTransferMode === "STATION_LOCKED" && !station?.id) {
        throw walletError("A valid station is required for station-locked transfers.")
      }

      const lockedWalletRows = await tx.$queryRaw`
        SELECT id, user_id, wallet_number, wallet_public_id, currency_code, status, is_primary, created_at, updated_at
        FROM wallets
        WHERE currency_code = ${DEFAULT_WALLET_CURRENCY}
          AND user_id IN (${normalizedSenderUserId}, ${recipient.userId})
        ORDER BY id ASC
        FOR UPDATE
      `

      const senderWallet = (lockedWalletRows || []).find((row) => Number(row.user_id || 0) === normalizedSenderUserId) || null
      const receiverWallet = (lockedWalletRows || []).find((row) => Number(row.user_id || 0) === recipient.userId) || null
      if (!senderWallet?.id || !receiverWallet?.id) {
        throw walletError("Wallet transfer participants could not be resolved.")
      }
      if (senderWallet.id === receiverWallet.id) {
        throw walletError("You cannot send SmartLink credit to your own account.")
      }

      const senderWalletStatus = toUpperValue(senderWallet.status, "ACTIVE")
      const receiverWalletStatus = toUpperValue(receiverWallet.status, "ACTIVE")
      if (senderWalletStatus !== "ACTIVE") {
        throw walletError("Wallet is not active. Transfers are unavailable.")
      }
      if (receiverWalletStatus !== "ACTIVE") {
        throw walletError("Recipient wallet is not active. Transfers are unavailable.")
      }

      const senderWalletAccount = await ensureWalletLedgerAccount(tx, senderWallet)
      const receiverWalletAccount = await ensureWalletLedgerAccount(tx, receiverWallet)
      const senderBalancesBefore = await recalculateWalletBalanceInternal(tx, senderWallet)
      if (senderBalancesBefore.availableBalance < normalizedAmount) {
        throw walletError(
          `Insufficient wallet balance. You can transfer up to MWK ${senderBalancesBefore.availableBalance.toLocaleString()}.`
        )
      }

      const transferClearingAccount = await resolveSystemAccount(
        tx,
        WALLET_SYSTEM_ACCOUNT_CODES.USER_TRANSFER_CLEARING,
        DEFAULT_WALLET_CURRENCY
      )

      const transferPublicId = buildWalletTransferPublicId()
      await tx.$executeRaw`
        INSERT INTO wallet_user_transfers (
          public_id,
          sender_user_id,
          receiver_user_id,
          sender_wallet_id,
          receiver_wallet_id,
          amount_mwk,
          currency_code,
          transfer_mode,
          locked_station_id,
          status,
          initiated_via,
          qr_reference,
          note,
          idempotency_key,
          metadata_json
        )
        VALUES (
          ${transferPublicId},
          ${normalizedSenderUserId},
          ${recipient.userId},
          ${senderWallet.id},
          ${receiverWallet.id},
          ${normalizedAmount},
          ${DEFAULT_WALLET_CURRENCY},
          ${normalizedTransferMode},
          ${station?.id || null},
          'PENDING',
          ${recipient.initiatedVia},
          ${recipient.qrReference},
          ${trimmedNote},
          ${scopedIdempotencyKey},
          ${JSON.stringify({
            senderWalletPublicId: String(senderWallet.wallet_public_id || "").trim(),
            receiverWalletPublicId: String(receiverWallet.wallet_public_id || "").trim(),
            recipientUserPublicId: recipient.publicId,
            stationPublicId: station?.publicId || null,
            qrNonce: recipient.qrPayload?.nonce || null,
          })}
        )
      `

      const transferIdRows = await tx.$queryRaw`
        SELECT id
        FROM wallet_user_transfers
        WHERE public_id = ${transferPublicId}
        LIMIT 1
      `
      const transferId = Number(transferIdRows?.[0]?.id || 0)
      if (!Number.isFinite(transferId) || transferId <= 0) {
        throw walletError("Wallet transfer record could not be created.")
      }

      const senderLedger = await createWalletTransferLedgerTransaction(tx, {
        wallet: senderWallet,
        walletAccount: senderWalletAccount,
        counterAccount: transferClearingAccount,
        amountMwk: normalizedAmount,
        description: trimmedNote || `Wallet transfer sent to ${recipient.publicId}`,
        relatedEntityId: transferPublicId,
        actorUserId: normalizedSenderUserId,
        idempotencyKey: scopedIdempotencyKey ? `${scopedIdempotencyKey}:sender` : null,
        metadata: {
          direction: "OUTGOING",
          transferMode: normalizedTransferMode,
          counterpartyUserPublicId: recipient.publicId,
          stationPublicId: station?.publicId || null,
          qrReference: recipient.qrReference,
        },
        direction: "DEBIT",
      })

      const receiverLedger = await createWalletTransferLedgerTransaction(tx, {
        wallet: receiverWallet,
        walletAccount: receiverWalletAccount,
        counterAccount: transferClearingAccount,
        amountMwk: normalizedAmount,
        description:
          normalizedTransferMode === "STATION_LOCKED"
            ? trimmedNote || `Station-locked wallet transfer received from ${String(senderWallet.wallet_public_id || "").trim()}`
            : trimmedNote || `Wallet transfer received from ${String(senderWallet.wallet_public_id || "").trim()}`,
        relatedEntityId: transferPublicId,
        actorUserId: normalizedSenderUserId,
        idempotencyKey: scopedIdempotencyKey ? `${scopedIdempotencyKey}:receiver` : null,
        metadata: {
          direction: "INCOMING",
          transferMode: normalizedTransferMode,
          counterpartyUserPublicId: String(senderWallet.wallet_public_id || "").trim() || null,
          stationPublicId: station?.publicId || null,
          qrReference: recipient.qrReference,
        },
        direction: "CREDIT",
      })

      let stationLock = null
      if (normalizedTransferMode === "STATION_LOCKED" && station?.id) {
        stationLock = await createWalletStationLock(tx, {
          walletId: receiverWallet.id,
          userId: recipient.userId,
          stationId: station.id,
          sourceTransferId: transferId,
          amountMwk: normalizedAmount,
          currencyCode: DEFAULT_WALLET_CURRENCY,
          metadata: {
            stationPublicId: station.publicId,
            stationName: station.name,
          },
        })
      }

      await tx.$executeRaw`
        UPDATE wallet_user_transfers
        SET
          sender_ledger_transaction_id = ${senderLedger.id},
          receiver_ledger_transaction_id = ${receiverLedger.id},
          status = 'COMPLETED',
          completed_at = CURRENT_TIMESTAMP(3),
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE public_id = ${transferPublicId}
      `

      await logWalletTransferAudit(tx, {
        walletId: senderWallet.id,
        ledgerTransactionId: senderLedger.id,
        actorUserId: normalizedSenderUserId,
        actionType: "WALLET_TRANSFER_SENT",
        actionSummary: `Wallet transfer ${transferPublicId} sent.`,
        metadata: {
          transferPublicId,
          amountMwk: normalizedAmount,
          transferMode: normalizedTransferMode,
          recipientUserPublicId: recipient.publicId,
          stationPublicId: station?.publicId || null,
        },
      })

      await logWalletTransferAudit(tx, {
        walletId: receiverWallet.id,
        ledgerTransactionId: receiverLedger.id,
        actorUserId: normalizedSenderUserId,
        actionType: "WALLET_TRANSFER_RECEIVED",
        actionSummary: `Wallet transfer ${transferPublicId} received.`,
        metadata: {
          transferPublicId,
          amountMwk: normalizedAmount,
          transferMode: normalizedTransferMode,
          senderWalletPublicId: String(senderWallet.wallet_public_id || "").trim() || null,
          stationPublicId: station?.publicId || null,
        },
      })

      if (stationLock?.id) {
        await logWalletTransferAudit(tx, {
          walletId: receiverWallet.id,
          ledgerTransactionId: receiverLedger.id,
          actorUserId: normalizedSenderUserId,
          actionType: "WALLET_STATION_LOCK_CREATED",
          actionSummary: `Station lock created for transfer ${transferPublicId}.`,
          metadata: {
            transferPublicId,
            walletStationLockId: stationLock.id,
            stationId: stationLock.stationId,
            stationPublicId: stationLock.stationPublicId,
            amountMwk: normalizedAmount,
          },
        })
      }

      const [senderBalancesAfter, receiverBalancesAfter, transferRow] = await Promise.all([
        recalculateWalletBalanceInternal(tx, senderWallet),
        recalculateWalletBalanceInternal(tx, receiverWallet),
        fetchWalletUserTransferRow(tx, transferPublicId),
      ])

      return {
        created: true,
        transfer: buildWalletTransferHistoryItem(transferRow, normalizedSenderUserId),
        senderWallet: buildWalletSummary({
          wallet: senderWallet,
          balances: senderBalancesAfter,
        }),
        receiverWallet: buildWalletSummary({
          wallet: receiverWallet,
          balances: receiverBalancesAfter,
        }),
        stationLock,
      }
    })

    if (transferResult?.created && transferResult?.transfer) {
      await notifyUserOfReceivedWalletTransfer(transferResult.transfer).catch(() => {})
    }

    return transferResult
  } catch (error) {
    if (senderWalletForAudit?.id) {
      await prisma.$executeRaw`
        INSERT INTO wallet_audit_logs (
          wallet_id,
          ledger_transaction_id,
          actor_user_id,
          action_type,
          action_summary,
          metadata_json
        )
        VALUES (
          ${senderWalletForAudit.id},
          NULL,
          ${normalizedSenderUserId},
          'WALLET_TRANSFER_ATTEMPT_FAILED',
          ${String(error?.message || "Wallet transfer failed").slice(0, 255)},
          ${JSON.stringify({
            recipientUserId: String(recipientUserId || "").trim() || null,
            hasRecipientQrPayload: Boolean(String(recipientQrPayload || "").trim()),
            amountMwk: Number(amountMwk || 0) || null,
            transferMode: normalizeWalletTransferMode(transferMode),
            stationPublicId: String(stationPublicId || "").trim() || null,
            stationId: Number(stationId || 0) || null,
            idempotencyKey: scopedIdempotencyKey,
            reason: String(error?.message || "").trim() || null,
          })}
        )
      `.catch(() => {})
    }
    throw error
  }
}

export async function getUserWalletTransferHistory(
  userId,
  { page = 1, limit = 20 } = {}
) {
  await ensureWalletTransferTablesReady()
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw walletError("Wallet transfer history requires an authenticated user.")
  }

  const normalizedPage = Math.max(1, Number(page || 1))
  const safeLimit = Math.min(MAX_WALLET_TRANSFER_PAGE_SIZE, Math.max(1, Number(limit || 20)))
  const offset = (normalizedPage - 1) * safeLimit

  const countRows = await prisma.$queryRaw`
    SELECT COUNT(*) AS total_count
    FROM wallet_user_transfers
    WHERE sender_user_id = ${normalizedUserId}
       OR receiver_user_id = ${normalizedUserId}
  `
  const totalCount = Number(countRows?.[0]?.total_count || 0)

  const rows = await prisma.$queryRaw`
    SELECT
      wt.id,
      wt.public_id,
      wt.sender_user_id,
      wt.receiver_user_id,
      wt.sender_wallet_id,
      wt.receiver_wallet_id,
      wt.sender_ledger_transaction_id,
      wt.receiver_ledger_transaction_id,
      wt.amount_mwk,
      wt.currency_code,
      wt.transfer_mode,
      wt.locked_station_id,
      wt.status,
      wt.initiated_via,
      wt.qr_reference,
      wt.note,
      wt.metadata_json,
      wt.created_at,
      wt.completed_at,
      wt.failed_at,
      sender.public_id AS sender_public_id,
      sender.full_name AS sender_full_name,
      receiver.public_id AS receiver_public_id,
      receiver.full_name AS receiver_full_name,
      st.public_id AS station_public_id,
      st.name AS station_name
    FROM wallet_user_transfers wt
    INNER JOIN users sender ON sender.id = wt.sender_user_id
    INNER JOIN users receiver ON receiver.id = wt.receiver_user_id
    LEFT JOIN stations st ON st.id = wt.locked_station_id
    WHERE wt.sender_user_id = ${normalizedUserId}
       OR wt.receiver_user_id = ${normalizedUserId}
    ORDER BY COALESCE(wt.completed_at, wt.created_at) DESC, wt.id DESC
    LIMIT ${safeLimit}
    OFFSET ${offset}
  `

  return {
    items: (rows || [])
      .map((row) => buildWalletTransferHistoryItem(row, normalizedUserId))
      .filter(Boolean),
    page: normalizedPage,
    limit: safeLimit,
    total: totalCount,
    hasMore: offset + safeLimit < totalCount,
  }
}

export async function getUserWalletStationLockedBalances(userId) {
  await ensureWalletTransferTablesReady()
  const normalizedUserId = Number(userId || 0)
  if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
    throw walletError("Station-locked balance lookup requires an authenticated user.")
  }

  const { wallet } = await ensureUserWallet(normalizedUserId)
  const [items, totalLockedBalance] = await Promise.all([
    listWalletStationLockGroupsByWallet(prisma, {
      walletId: wallet.id,
      currencyCode: wallet.currency_code || DEFAULT_WALLET_CURRENCY,
    }),
    getWalletTotalLockedBalance(prisma, {
      walletId: wallet.id,
      currencyCode: wallet.currency_code || DEFAULT_WALLET_CURRENCY,
    }),
  ])

  return {
    walletId: Number(wallet.id || 0),
    walletPublicId: String(wallet.wallet_public_id || "").trim() || null,
    currencyCode: String(wallet.currency_code || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY,
    totalLockedBalance,
    items,
  }
}
