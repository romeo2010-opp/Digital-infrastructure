import { Prisma } from "@prisma/client"

const DEFAULT_WALLET_CURRENCY = "MWK"

function toMoneyNumber(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(2))
}

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
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

export function buildWalletStationLockSpendPlan({
  amount,
  availableBalance,
  matchingLocks = [],
} = {}) {
  const requestedAmount = toMoneyNumber(amount)
  const spendableAvailableBalance = toMoneyNumber(availableBalance)
  const matchingLockedBalance = toMoneyNumber(
    (matchingLocks || []).reduce(
      (sum, item) => sum + toMoneyNumber(item?.amountMwkRemaining ?? item?.amount_mwk_remaining),
      0
    )
  )

  if (!(requestedAmount > 0)) {
    return {
      requestedAmount,
      spendableAvailableBalance,
      matchingLockedBalance,
      totalSpendable: toMoneyNumber(spendableAvailableBalance + matchingLockedBalance),
      generalAmountUsed: 0,
      lockedAmountUsed: 0,
      shortfallAmount: 0,
      canSpend: false,
    }
  }

  const lockedAmountUsed = Math.min(requestedAmount, matchingLockedBalance)
  const generalAmountUsed = toMoneyNumber(Math.max(0, requestedAmount - lockedAmountUsed))
  const totalSpendable = toMoneyNumber(spendableAvailableBalance + matchingLockedBalance)
  const shortfallAmount = toMoneyNumber(Math.max(0, requestedAmount - totalSpendable))

  return {
    requestedAmount,
    spendableAvailableBalance,
    matchingLockedBalance,
    totalSpendable,
    generalAmountUsed,
    lockedAmountUsed,
    shortfallAmount,
    canSpend: shortfallAmount === 0,
  }
}

export function mapWalletStationLockRow(row) {
  if (!row?.id) return null
  return {
    id: Number(row.id || 0),
    walletId: Number(row.wallet_id || 0),
    userId: Number(row.user_id || 0),
    stationId: Number(row.station_id || 0),
    stationPublicId: String(row.station_public_id || "").trim() || null,
    stationName: String(row.station_name || "").trim() || null,
    sourceTransferId: Number(row.source_transfer_id || 0) || null,
    sourceTransferPublicId: String(row.source_transfer_public_id || "").trim() || null,
    currencyCode: String(row.currency_code || DEFAULT_WALLET_CURRENCY).trim() || DEFAULT_WALLET_CURRENCY,
    originalAmountMwk: toMoneyNumber(row.original_amount_mwk),
    amountMwkRemaining: toMoneyNumber(row.amount_mwk_remaining),
    status: String(row.status || "ACTIVE").trim().toUpperCase() || "ACTIVE",
    metadata: parseMetadata(row.metadata_json),
    depletedAt: toIsoOrNull(row.depleted_at),
    expiredAt: toIsoOrNull(row.expired_at),
    cancelledAt: toIsoOrNull(row.cancelled_at),
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  }
}

export async function listWalletStationLocks(
  db,
  {
    walletId,
    stationId = null,
    status = "ACTIVE",
    currencyCode = DEFAULT_WALLET_CURRENCY,
    forUpdate = false,
  } = {}
) {
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT
      wsl.id,
      wsl.wallet_id,
      wsl.user_id,
      wsl.station_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      wsl.source_transfer_id,
      wt.public_id AS source_transfer_public_id,
      wsl.currency_code,
      wsl.original_amount_mwk,
      wsl.amount_mwk_remaining,
      wsl.status,
      wsl.metadata_json,
      wsl.depleted_at,
      wsl.expired_at,
      wsl.cancelled_at,
      wsl.created_at,
      wsl.updated_at
    FROM wallet_station_locks wsl
    INNER JOIN stations st ON st.id = wsl.station_id
    INNER JOIN wallet_user_transfers wt ON wt.id = wsl.source_transfer_id
    WHERE wsl.wallet_id = ${walletId}
      AND wsl.currency_code = ${currencyCode}
      AND (${status} IS NULL OR wsl.status = ${status})
      AND (${stationId} IS NULL OR wsl.station_id = ${stationId})
    ORDER BY wsl.created_at ASC, wsl.id ASC
    ${lockingClause}
  `

  return (rows || []).map(mapWalletStationLockRow).filter(Boolean)
}

export async function getWalletTotalLockedBalance(
  db,
  { walletId, currencyCode = DEFAULT_WALLET_CURRENCY, stationId = null, status = "ACTIVE", forUpdate = false } = {}
) {
  const lockingClause = forUpdate ? Prisma.sql`FOR UPDATE` : Prisma.empty
  const rows = await db.$queryRaw`
    SELECT COALESCE(SUM(amount_mwk_remaining), 0.00) AS locked_balance
    FROM wallet_station_locks
    WHERE wallet_id = ${walletId}
      AND currency_code = ${currencyCode}
      AND (${status} IS NULL OR status = ${status})
      AND (${stationId} IS NULL OR station_id = ${stationId})
    ${lockingClause}
  `

  return toMoneyNumber(rows?.[0]?.locked_balance)
}

export async function createWalletStationLock(
  db,
  {
    walletId,
    userId,
    stationId,
    sourceTransferId,
    amountMwk,
    currencyCode = DEFAULT_WALLET_CURRENCY,
    metadata = null,
  }
) {
  const normalizedAmount = toMoneyNumber(amountMwk)
  if (!(normalizedAmount > 0)) return null

  await db.$executeRaw`
    INSERT INTO wallet_station_locks (
      wallet_id,
      user_id,
      station_id,
      source_transfer_id,
      currency_code,
      original_amount_mwk,
      amount_mwk_remaining,
      status,
      metadata_json
    )
    VALUES (
      ${walletId},
      ${userId},
      ${stationId},
      ${sourceTransferId},
      ${currencyCode},
      ${normalizedAmount},
      ${normalizedAmount},
      'ACTIVE',
      ${metadata ? JSON.stringify(metadata) : null}
    )
  `

  const rows = await db.$queryRaw`
    SELECT
      wsl.id,
      wsl.wallet_id,
      wsl.user_id,
      wsl.station_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      wsl.source_transfer_id,
      wt.public_id AS source_transfer_public_id,
      wsl.currency_code,
      wsl.original_amount_mwk,
      wsl.amount_mwk_remaining,
      wsl.status,
      wsl.metadata_json,
      wsl.depleted_at,
      wsl.expired_at,
      wsl.cancelled_at,
      wsl.created_at,
      wsl.updated_at
    FROM wallet_station_locks wsl
    INNER JOIN stations st ON st.id = wsl.station_id
    INNER JOIN wallet_user_transfers wt ON wt.id = wsl.source_transfer_id
    WHERE wsl.wallet_id = ${walletId}
      AND wsl.source_transfer_id = ${sourceTransferId}
    ORDER BY wsl.id DESC
    LIMIT 1
  `

  return mapWalletStationLockRow(rows?.[0] || null)
}

export async function listWalletStationLockGroupsByWallet(
  db,
  { walletId, currencyCode = DEFAULT_WALLET_CURRENCY } = {}
) {
  const rows = await db.$queryRaw`
    SELECT
      wsl.station_id,
      st.public_id AS station_public_id,
      st.name AS station_name,
      COALESCE(SUM(wsl.amount_mwk_remaining), 0.00) AS total_amount_mwk,
      COUNT(*) AS lock_count,
      MAX(wsl.created_at) AS latest_created_at
    FROM wallet_station_locks wsl
    INNER JOIN stations st ON st.id = wsl.station_id
    WHERE wsl.wallet_id = ${walletId}
      AND wsl.currency_code = ${currencyCode}
      AND wsl.status = 'ACTIVE'
    GROUP BY wsl.station_id, st.public_id, st.name
    ORDER BY st.name ASC, wsl.station_id ASC
  `

  return (rows || []).map((row) => ({
    stationId: Number(row.station_id || 0),
    stationPublicId: String(row.station_public_id || "").trim() || null,
    stationName: String(row.station_name || "").trim() || null,
    amountMwk: toMoneyNumber(row.total_amount_mwk),
    currencyCode,
    activeLockCount: Number(row.lock_count || 0),
    latestCreatedAt: toIsoOrNull(row.latest_created_at),
  }))
}

export async function consumeWalletStationLocks(
  db,
  {
    walletId,
    stationId,
    amountMwk,
    currencyCode = DEFAULT_WALLET_CURRENCY,
    actorUserId = null,
    ledgerTransactionId = null,
    relatedEntityType = null,
    relatedEntityId = null,
    paymentReference = null,
  }
) {
  const normalizedAmount = toMoneyNumber(amountMwk)
  if (!(normalizedAmount > 0)) {
    return {
      consumedAmount: 0,
      items: [],
    }
  }

  const activeLocks = await listWalletStationLocks(db, {
    walletId,
    stationId,
    status: "ACTIVE",
    currencyCode,
    forUpdate: true,
  })

  let remainingToConsume = normalizedAmount
  const consumedItems = []

  for (const lock of activeLocks) {
    if (!(remainingToConsume > 0)) break

    const amountAvailable = toMoneyNumber(lock.amountMwkRemaining)
    if (!(amountAvailable > 0)) continue

    const amountConsumed = toMoneyNumber(Math.min(remainingToConsume, amountAvailable))
    const nextRemainingAmount = toMoneyNumber(Math.max(0, amountAvailable - amountConsumed))
    const nextStatus = nextRemainingAmount > 0 ? "ACTIVE" : "DEPLETED"

    await db.$executeRaw`
      UPDATE wallet_station_locks
      SET
        amount_mwk_remaining = ${nextRemainingAmount},
        status = ${nextStatus},
        depleted_at = CASE WHEN ${nextStatus} = 'DEPLETED' THEN CURRENT_TIMESTAMP(3) ELSE depleted_at END,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ${lock.id}
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
        ${walletId},
        ${ledgerTransactionId},
        ${actorUserId},
        'WALLET_STATION_LOCK_CONSUMED',
        ${`Station-locked balance consumed at station ${lock.stationPublicId || lock.stationId}.`},
        ${JSON.stringify({
          walletStationLockId: lock.id,
          stationId: lock.stationId,
          stationPublicId: lock.stationPublicId,
          sourceTransferId: lock.sourceTransferId,
          sourceTransferPublicId: lock.sourceTransferPublicId,
          amountConsumed,
          amountRemaining: nextRemainingAmount,
          relatedEntityType: String(relatedEntityType || "").trim() || null,
          relatedEntityId: String(relatedEntityId || "").trim() || null,
          paymentReference: String(paymentReference || "").trim() || null,
        })}
      )
    `

    consumedItems.push({
      lockId: lock.id,
      sourceTransferId: lock.sourceTransferId,
      sourceTransferPublicId: lock.sourceTransferPublicId,
      stationId: lock.stationId,
      stationPublicId: lock.stationPublicId,
      amountConsumed,
      amountRemaining: nextRemainingAmount,
      status: nextStatus,
    })

    remainingToConsume = toMoneyNumber(remainingToConsume - amountConsumed)
  }

  return {
    consumedAmount: toMoneyNumber(
      consumedItems.reduce((sum, item) => sum + toMoneyNumber(item.amountConsumed), 0)
    ),
    items: consumedItems,
  }
}
