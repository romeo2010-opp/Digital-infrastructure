export const APP_AIRDROP_CELEBRATION_EVENT = 'smartlink:app-airdrop-celebration'
export const WALLET_TRANSFER_CELEBRATION_EVENT = APP_AIRDROP_CELEBRATION_EVENT
export const APP_AIRDROP_CELEBRATION_DURATION_MS = 2800

export function isWalletTransferReceivedAlert(alertPayload) {
  return String(alertPayload?.metadata?.event || '').trim().toLowerCase() === 'wallet_transfer_received'
}

export function buildWalletTransferCelebrationDetail(alertPayload = {}) {
  const amountValue = Number(alertPayload?.metadata?.amountMwk || 0)
  const senderName = String(alertPayload?.metadata?.senderName || '').trim()
  const transferMode = String(alertPayload?.metadata?.transferMode || '').trim().toUpperCase()
  const amountLabel = Number.isFinite(amountValue) && amountValue > 0
    ? `MWK ${amountValue.toLocaleString()}`
    : 'SmartLink credit'

  return {
    variant: 'wallet-transfer',
    title: transferMode === 'STATION_LOCKED' ? 'Locked Credit Received' : 'Funds Received',
    subtitle: senderName ? `${amountLabel} from ${senderName}` : amountLabel,
    transferMode,
    amountLabel,
    senderName,
    alertPublicId: String(alertPayload?.publicId || '').trim() || null,
  }
}

export function buildQueueServedCelebrationDetail(queueSnapshot = {}) {
  const stationName = String(queueSnapshot?.station?.name || '').trim()
  const fuelType = String(queueSnapshot?.fuelType || '').trim()
  const fuelLabel = fuelType ? fuelType.charAt(0).toUpperCase() + fuelType.slice(1).toLowerCase() : 'fuel'

  return {
    variant: 'queue-served',
    title: 'Service Complete',
    subtitle: stationName ? `${fuelLabel} served at ${stationName}` : 'Your station visit is complete',
    stationName,
    fuelType: fuelType.toUpperCase(),
    queueJoinId: String(queueSnapshot?.queueJoinId || '').trim() || null,
  }
}

export function emitAppAirdropCelebration(detail = {}) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new window.CustomEvent(APP_AIRDROP_CELEBRATION_EVENT, {
      detail,
    })
  )
}

export function emitWalletTransferCelebration(alertPayload = {}) {
  emitAppAirdropCelebration(buildWalletTransferCelebrationDetail(alertPayload))
}

export function emitQueueServedCelebration(queueSnapshot = {}) {
  emitAppAirdropCelebration(buildQueueServedCelebrationDetail(queueSnapshot))
}
