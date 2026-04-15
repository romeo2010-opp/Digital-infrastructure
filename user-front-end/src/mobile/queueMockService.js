import { stations } from './mockStations'

const ACTIVE_QUEUE_STATUSES = ['WAITING', 'CALLED', 'LATE']
const ACTIVE_RESERVATION_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN']
const RESERVATION_SLOT_MINUTES = 15
const MOCK_PUMP_NOZZLES = [
  { nozzleNumber: '1', fuelType: 'PETROL' },
  { nozzleNumber: '2', fuelType: 'PETROL' },
  { nozzleNumber: '3', fuelType: 'DIESEL' },
  { nozzleNumber: '4', fuelType: 'DIESEL' },
]
const queuesById = new Map()
const reservationsById = new Map()
const listenersByQueueId = new Map()
const timerByQueueId = new Map()
const supportTickets = []

function sleep(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function toIsoNow() {
  return new Date().toISOString()
}

function matchesHistoryDateRange(value, { from, to } = {}) {
  const normalizedValue = value instanceof Date ? value.toISOString() : String(value || '').trim()
  if (!normalizedValue) return !from && !to

  const datePart = normalizedValue.slice(0, 10)
  if (from && datePart < from) return false
  if (to && datePart > to) return false
  return true
}

function randomInt(min, max) {
  const floorMin = Math.ceil(min)
  const floorMax = Math.floor(max)
  return Math.floor(Math.random() * (floorMax - floorMin + 1)) + floorMin
}

function resolveStation(stationIdOrPublicId) {
  const scoped = String(stationIdOrPublicId || '').trim()
  if (!scoped) return stations[0] || null
  return (
    stations.find((station) => station.id === scoped || station.publicId === scoped) ||
    stations.find((station) => station.id === scoped.toLowerCase()) ||
    null
  )
}

function buildStationStatus() {
  return {
    active: randomInt(1, 4),
    dispensing: randomInt(0, 2),
    idle: randomInt(0, 2),
    offline: randomInt(0, 1),
  }
}

function listBlockedMockNozzlePublicIds({ pumpPublicId, excludeQueueJoinId } = {}) {
  const scopedPumpPublicId = String(pumpPublicId || '').trim()
  const scopedExcludeQueueJoinId = String(excludeQueueJoinId || '').trim()
  const blockedNozzlePublicIds = new Set()
  if (!scopedPumpPublicId) return blockedNozzlePublicIds

  for (const [queueJoinId, entry] of queuesById.entries()) {
    if (queueJoinId === scopedExcludeQueueJoinId) continue
    if (!ACTIVE_QUEUE_STATUSES.includes(String(entry?.queueStatus || '').trim().toUpperCase())) continue

    const verifiedPump = entry?.verifiedPump && typeof entry.verifiedPump === 'object' ? entry.verifiedPump : null
    if (!verifiedPump) continue
    if (String(verifiedPump.pumpPublicId || '').trim() !== scopedPumpPublicId) continue

    const nozzlePublicId = String(
      entry?.serviceRequest?.nozzlePublicId || verifiedPump.nozzlePublicId || '',
    ).trim()
    if (nozzlePublicId) {
      blockedNozzlePublicIds.add(nozzlePublicId)
    }
  }

  return blockedNozzlePublicIds
}

function resolveMockAssignableNozzle({ pumpPublicId, fuelType, excludeQueueJoinId } = {}) {
  const scopedPumpPublicId = String(pumpPublicId || '').trim()
  const scopedFuelType = String(fuelType || '').trim().toUpperCase()
  const blockedNozzlePublicIds = listBlockedMockNozzlePublicIds({
    pumpPublicId: scopedPumpPublicId,
    excludeQueueJoinId,
  })

  return (
    MOCK_PUMP_NOZZLES.find((item) => {
      if (String(item.fuelType || '').trim().toUpperCase() !== scopedFuelType) return false
      const nozzlePublicId = `${scopedPumpPublicId}-N${String(item.nozzleNumber).padStart(2, '0')}`
      return !blockedNozzlePublicIds.has(nozzlePublicId)
    }) || null
  )
}

function roundToNextSlot(date = new Date()) {
  const next = new Date(date)
  next.setSeconds(0, 0)
  const minutes = next.getMinutes()
  const remainder = minutes % RESERVATION_SLOT_MINUTES
  if (remainder > 0) {
    next.setMinutes(minutes + (RESERVATION_SLOT_MINUTES - remainder))
  }
  return next
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

function reservationLabel(status) {
  const normalized = String(status || '').toUpperCase()
  if (normalized === 'FULFILLED') return 'Completed'
  if (normalized === 'CHECKED_IN') return 'Checked In'
  if (normalized === 'CONFIRMED') return 'Confirmed'
  if (normalized === 'CANCELLED' || normalized === 'EXPIRED') return 'Cancelled'
  return 'Pending'
}

function buildSnapshot(entry) {
  const guarantee = entry.guarantee || null
  return {
    queueJoinId: entry.queueJoinId,
    queueStatus: entry.queueStatus,
    station: {
      id: entry.station.id,
      name: entry.station.name,
      area: entry.station.address,
      brand: entry.station.brand || null,
    },
    fuelType: entry.fuelType,
    position: ACTIVE_QUEUE_STATUSES.includes(entry.queueStatus) ? entry.position : null,
    carsAhead: ACTIVE_QUEUE_STATUSES.includes(entry.queueStatus) ? entry.carsAhead : 0,
    totalQueued: entry.totalQueued,
    etaMinutes: ACTIVE_QUEUE_STATUSES.includes(entry.queueStatus) ? entry.etaMinutes : 0,
    nowServing: entry.nowServing,
    lastMovementAt: entry.lastMovementAt,
    movementState: entry.movementState,
    pauseReason: entry.pauseReason || null,
    expectedResumeAt: entry.expectedResumeAt || null,
    guaranteeState: guarantee?.state || entry.guaranteeState || 'none',
    fuelRemainingLiters: guarantee?.fuelRemainingLiters ?? entry.fuelRemainingLiters ?? null,
    fuelRemainingPercent: guarantee?.fuelRemainingPercent ?? entry.fuelRemainingPercent ?? null,
    guarantee,
    qrPayload: entry.qrPayload,
    verifiedPump: entry.verifiedPump || null,
    requestedLiters:
      Number.isFinite(Number(entry.requestedLiters)) && Number(entry.requestedLiters) > 0
        ? Number(entry.requestedLiters)
        : null,
    paymentMode: String(entry.paymentMode || 'PAY_AT_PUMP').trim().toUpperCase() || 'PAY_AT_PUMP',
    serviceRequest: entry.serviceRequest || null,
    stationStatus: entry.stationStatus || null,
  }
}

function buildRealtimeEvents(snapshot, trigger = 'mock_update') {
  const at = toIsoNow()
  return [
    { type: 'queue:snapshot', trigger, data: snapshot, at },
    {
      type: 'queue:update',
      data: {
        queueJoinId: snapshot.queueJoinId,
        queueStatus: snapshot.queueStatus,
        position: snapshot.position,
        carsAhead: snapshot.carsAhead,
        totalQueued: snapshot.totalQueued,
        etaMinutes: snapshot.etaMinutes,
      },
      at,
    },
    {
      type: 'queue:movement',
      data: {
        nowServing: snapshot.nowServing,
        lastMovementAt: snapshot.lastMovementAt,
        movementState: snapshot.movementState,
        pauseReason: snapshot.pauseReason,
        expectedResumeAt: snapshot.expectedResumeAt,
      },
      at,
    },
    {
      type: 'station:status',
      data: snapshot.stationStatus,
      at,
    },
    {
      type: 'queue:fuel',
      data: {
        fuelRemainingLiters: snapshot.fuelRemainingLiters,
        fuelRemainingPercent: snapshot.fuelRemainingPercent,
        guaranteeState: snapshot.guaranteeState,
        guarantee: snapshot.guarantee || null,
      },
      at,
    },
  ]
}

function notifyQueue(queueJoinId, trigger = 'mock_update') {
  const listeners = listenersByQueueId.get(queueJoinId)
  const entry = queuesById.get(queueJoinId)
  if (!listeners?.size || !entry) return

  const snapshot = buildSnapshot(entry)
  const events = buildRealtimeEvents(snapshot, trigger)
  for (const listener of [...listeners]) {
    for (const message of events) {
      try {
        listener(message)
      } catch {
        // Ignore listener failures so one subscriber doesn't break updates.
      }
    }
  }
}

function stopQueueTickerIfUnused(queueJoinId) {
  const listeners = listenersByQueueId.get(queueJoinId)
  if (listeners?.size) return

  const timerId = timerByQueueId.get(queueJoinId)
  if (timerId) {
    window.clearInterval(timerId)
    timerByQueueId.delete(queueJoinId)
  }
}

function startQueueTicker(queueJoinId) {
  if (timerByQueueId.has(queueJoinId)) return

  const timerId = window.setInterval(() => {
    const entry = queuesById.get(queueJoinId)
    if (!entry) {
      stopQueueTickerIfUnused(queueJoinId)
      return
    }

    if (!ACTIVE_QUEUE_STATUSES.includes(entry.queueStatus)) {
      notifyQueue(queueJoinId, 'mock_idle')
      return
    }

    const shouldMove = Math.random() >= 0.3
    if (!shouldMove) {
      entry.movementState = 'slow'
      notifyQueue(queueJoinId, 'mock_slow')
      return
    }

    if (entry.carsAhead > 0) {
      entry.carsAhead -= 1
      entry.position = entry.carsAhead + 1
      entry.nowServing += 1
      entry.lastMovementAt = toIsoNow()
    }

    if (entry.carsAhead <= 1) {
      entry.queueStatus = 'CALLED'
    }

    entry.etaMinutes = Math.max(1, entry.carsAhead * 4)
    entry.movementState = entry.carsAhead > 6 ? 'slow' : 'normal'
    entry.stationStatus = buildStationStatus()
    notifyQueue(queueJoinId, 'mock_tick')
  }, 7000)

  timerByQueueId.set(queueJoinId, timerId)
}

export const queueMockService = {
  async joinQueue({ stationPublicId, fuelType = 'PETROL', requestedLiters, prepay } = {}) {
    await sleep(160)

    const station = resolveStation(stationPublicId)
    if (!station) throw new Error('Unable to resolve station for queue join')

    const queueJoinId = `MQ-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`.toUpperCase()
    const carsAhead = randomInt(2, 11)
    const totalQueued = carsAhead + randomInt(2, 7)

    const entry = {
      queueJoinId,
      queueStatus: 'WAITING',
      station,
      fuelType,
      position: carsAhead + 1,
      carsAhead,
      totalQueued,
      etaMinutes: Math.max(1, (carsAhead + 1) * 4),
      nowServing: randomInt(1, 4),
      lastMovementAt: toIsoNow(),
      movementState: carsAhead > 6 ? 'slow' : 'normal',
      pauseReason: null,
      expectedResumeAt: null,
      guaranteeState: 'none',
      fuelRemainingLiters: null,
      fuelRemainingPercent: null,
      requestedLiters:
        Number.isFinite(Number(requestedLiters)) && Number(requestedLiters) > 0
          ? Number(requestedLiters)
          : null,
      paymentMode: prepay ? 'PREPAY' : 'PAY_AT_PUMP',
      guarantee: {
        state: 'none',
        fuelRemainingLiters: null,
        fuelRemainingPercent: null,
        effectiveFuelLiters: null,
        effectiveFuelPercent: null,
        fuelCapacityLiters: null,
        litersBeforeYou: null,
        litersToCoverYou: null,
        requestedLitersUsed:
          Number.isFinite(Number(requestedLiters)) && Number(requestedLiters) > 0
            ? Number(requestedLiters)
            : null,
        avgLitersPerCarUsed: null,
        safetyBufferLitersUsed: null,
        fuelLastUpdatedAt: null,
        fuelDataStale: false,
        avgSource: null,
        notes: ['fuel_data_missing'],
      },
      qrPayload: `smartlink-mock:${queueJoinId}`,
      verifiedPump: null,
      serviceRequest: null,
      stationStatus: buildStationStatus(),
    }

    queuesById.set(queueJoinId, entry)
    return {
      queueJoinId,
      reusedExisting: false,
      status: buildSnapshot(entry),
    }
  },

  async getStatus(queueJoinId) {
    await sleep(120)
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    const entry = queuesById.get(scopedQueueJoinId)
    if (!entry) throw new Error('Queue entry not found')
    return buildSnapshot(entry)
  },

  async getReservationSlots(stationPublicId, { fuelType = 'PETROL', lookAhead = 8 } = {}) {
    await sleep(120)
    const station = resolveStation(stationPublicId)
    if (!station) throw new Error('Station not found')

    const start = roundToNextSlot(addMinutes(new Date(), 1))
    const slots = []
    for (let index = 0; index < Math.max(1, Number(lookAhead || 8)); index += 1) {
      const slotStart = addMinutes(start, index * RESERVATION_SLOT_MINUTES)
      const slotEnd = addMinutes(slotStart, RESERVATION_SLOT_MINUTES)
      const reservedCount = [...reservationsById.values()].filter((item) => {
        if (item.stationPublicId !== station.publicId) return false
        if (!ACTIVE_RESERVATION_STATUSES.includes(item.reservationStatus)) return false
        return item.slotStart < slotEnd && item.slotEnd > slotStart
      }).length
      const capacity = 6
      const availableSpots = Math.max(0, capacity - reservedCount)
      slots.push({
        slotStart: slotStart.toISOString(),
        slotEnd: slotEnd.toISOString(),
        reservedCount,
        capacity,
        availableSpots,
        isFull: availableSpots <= 0,
      })
    }

    return {
      stationPublicId: station.publicId || station.id,
      fuelType: String(fuelType || 'PETROL').toUpperCase(),
      rules: {
        oneActiveReservationOnly: true,
        disallowQueueAndReservationTogether: false,
        slotMinutes: 15,
        graceMinutes: 5,
        lateMoveMinutes: 5,
        lateCancelMinutes: 10,
        minLiters: 10,
        maxLiters: 40,
        minDepositAmount: 3000,
        maxDepositAmount: 10000,
        slotCapacity: 6,
        geoLockKm: 15,
      },
      slots,
    }
  },

  async createReservation({ stationPublicId, fuelType = 'PETROL', expectedLiters, slotStart, slotEnd, identifier, depositAmount } = {}) {
    await sleep(180)
    const station = resolveStation(stationPublicId)
    if (!station) throw new Error('Station not found')

    const activeReservation = [...reservationsById.values()].find((entry) =>
      ACTIVE_RESERVATION_STATUSES.includes(entry.reservationStatus)
    )
    if (activeReservation) {
      throw new Error('You already have an active reservation.')
    }

    const start = new Date(slotStart)
    if (Number.isNaN(start.getTime())) throw new Error('slotStart is required')
    const end = slotEnd ? new Date(slotEnd) : addMinutes(start, RESERVATION_SLOT_MINUTES)
    const reservationId = `RS-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase()
    const pricePerLitre = 2500
    const estimatedFuelCost = Number((Number(expectedLiters || 0) * pricePerLitre).toFixed(2))
    const walletHoldReference = `SPH-${Math.random().toString(36).slice(2, 10)}`.toUpperCase()
    const entry = {
      id: reservationId,
      reference: reservationId,
      stationPublicId: station.publicId || station.id,
      stationName: station.name,
      stationArea: station.address || station.name,
      fuelType: String(fuelType || 'PETROL').toUpperCase(),
      litersReserved: Number(expectedLiters || 0),
      depositAmount: Number(depositAmount || 0),
      pricePerLitre,
      estimatedFuelCost,
      currencyCode: 'MWK',
      walletHoldReference,
      paymentStatus: 'POSTED',
      maskedPlate: String(identifier || '').trim().toUpperCase(),
      reservationStatus: 'CONFIRMED',
      queueStatus: 'CALLED',
      slotStart: start,
      slotEnd: end,
      joinedAt: new Date(),
      checkInTime: null,
      expiresAt: addMinutes(end, 10),
    }
    reservationsById.set(reservationId, entry)

    return {
      reservationId,
      reservation: {
        id: entry.id,
        reference: entry.reference,
        reservationStatus: entry.reservationStatus,
        status: reservationLabel(entry.reservationStatus),
        queueStatus: entry.queueStatus,
        station: {
          publicId: entry.stationPublicId,
          name: entry.stationName,
          area: entry.stationArea,
        },
        fuelType: entry.fuelType,
        litersReserved: entry.litersReserved,
        depositAmount: entry.depositAmount,
        paymentMode: 'PREPAY',
        pricePerLitre: entry.pricePerLitre,
        totalAmount: entry.estimatedFuelCost,
        currencyCode: entry.currencyCode,
        transactionReference: entry.walletHoldReference,
        paymentStatus: entry.paymentStatus,
        maskedPlate: entry.maskedPlate,
        slotStart: entry.slotStart.toISOString(),
        slotEnd: entry.slotEnd.toISOString(),
        expiresAt: entry.expiresAt.toISOString(),
        joinedAt: entry.joinedAt.toISOString(),
      },
    }
  },

  async cancelReservation(reservationPublicId) {
    await sleep(140)
    const id = String(reservationPublicId || '').trim()
    const entry = reservationsById.get(id)
    if (!entry) throw new Error('Reservation not found')
    if (!ACTIVE_RESERVATION_STATUSES.includes(entry.reservationStatus)) {
      return { cancelled: false, reservationId: id, status: entry.reservationStatus }
    }
    entry.reservationStatus = 'CANCELLED'
    return {
      cancelled: true,
      reservationId: id,
      refundPct: 50,
      refundAmount: Number(((entry.depositAmount || 0) * 0.5).toFixed(2)),
      forfeitedAmount: Number(((entry.depositAmount || 0) * 0.5).toFixed(2)),
    }
  },

  async checkInReservation(reservationPublicId) {
    await sleep(120)
    const id = String(reservationPublicId || '').trim()
    const entry = reservationsById.get(id)
    if (!entry) throw new Error('Reservation not found')
    if (!ACTIVE_RESERVATION_STATUSES.includes(entry.reservationStatus)) {
      throw new Error('Reservation is not eligible for check-in.')
    }
    entry.reservationStatus = 'CHECKED_IN'
    entry.checkInTime = new Date()
    return {
      checkedIn: true,
      reservationId: id,
      status: 'CHECKED_IN',
      lateHandling: 'ON_TIME',
      message: 'Check-in complete.',
    }
  },

  async getReservations() {
    await sleep(100)
    return [...reservationsById.values()]
      .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
      .map((item) => ({
        id: item.id,
        reference: item.reference,
        queueJoinId: null,
        queueStatus: item.queueStatus,
        reservationStatus: item.reservationStatus,
        status: reservationLabel(item.reservationStatus),
        station: {
          publicId: item.stationPublicId,
          name: item.stationName,
          area: item.stationArea,
        },
        fuelType: item.fuelType,
        litersReserved: item.litersReserved,
        depositAmount: item.depositAmount,
        paymentMode: 'PREPAY',
        pricePerLitre: item.pricePerLitre,
        totalAmount: item.estimatedFuelCost,
        currencyCode: item.currencyCode,
        transactionReference: item.walletHoldReference,
        paymentStatus: item.paymentStatus,
        pumpNumber: item.pumpNumber ?? null,
        nozzleLabel: item.nozzleLabel ?? null,
        promoLabelsApplied: Array.isArray(item.promoLabelsApplied) ? item.promoLabelsApplied : [],
        promotionKind: item.promotionKind ?? null,
        promotionValueLabel: item.promotionValueLabel ?? null,
        totalDirectDiscount: item.totalDirectDiscount ?? null,
        cashbackTotal: item.cashbackTotal ?? null,
        maskedPlate: item.maskedPlate,
        joinedAt: item.joinedAt.toISOString(),
        slotStart: item.slotStart.toISOString(),
        slotEnd: item.slotEnd.toISOString(),
        checkInTime: item.checkInTime ? item.checkInTime.toISOString() : null,
        expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
      }))
  },

  async getHistory(options = {}) {
    await sleep(100)
    const from = String(options?.from || '').trim()
    const to = String(options?.to || '').trim()
    const reservations = (await this.getReservations())
      .filter((item) => matchesHistoryDateRange(item?.slotStart || item?.joinedAt, { from, to }))
    const queues = [...queuesById.values()]
      .sort((a, b) => new Date(b.lastMovementAt || b.joinedAt || 0).getTime() - new Date(a.lastMovementAt || a.joinedAt || 0).getTime())
      .filter((item) => matchesHistoryDateRange(item?.joinedAt || item?.lastMovementAt, { from, to }))
      .map((item) => ({
        id: item.queueJoinId,
        reference: item.queueJoinId,
        queueJoinId: item.queueJoinId,
        queueStatus: item.queueStatus,
        status: item.queueStatus,
        station: {
          publicId: item.station.publicId || item.station.id,
          name: item.station.name,
          area: item.station.city || item.station.address || item.station.name,
        },
        fuelType: item.fuelType,
        requestedLiters: item.requestedLiters ?? null,
        maskedPlate: item.maskedPlate || null,
        joinedAt: item.joinedAt || item.lastMovementAt || toIsoNow(),
        calledAt: item.calledAt || null,
        servedAt: item.servedAt || null,
        cancelledAt: item.cancelledAt || null,
        lastMovementAt: item.lastMovementAt || null,
        paymentMode: item.paymentMode || 'PAY_AT_PUMP',
        pricePerLitre: item.serviceRequest?.pricePerLitre ?? null,
        totalAmount: item.serviceRequest?.estimatedAmount ?? null,
        currencyCode: item.serviceRequest?.currencyCode || 'MWK',
        transactionReference: item.serviceRequest?.walletTransactionReference || null,
        paymentStatus: item.serviceRequest?.paymentStatus || null,
        pumpNumber: item.verifiedPump?.pumpNumber ?? null,
        nozzleLabel: item.verifiedPump?.nozzleNumber ? `Nozzle ${item.verifiedPump.nozzleNumber}` : item.verifiedPump?.nozzlePublicId ?? null,
        promoLabelsApplied: Array.isArray(item.serviceRequest?.promoLabelsApplied) ? item.serviceRequest.promoLabelsApplied : [],
        promotionKind: item.serviceRequest?.promotionKind ?? null,
        promotionValueLabel: item.serviceRequest?.promotionValueLabel ?? null,
        totalDirectDiscount: item.serviceRequest?.totalDirectDiscount ?? null,
        cashbackTotal: item.serviceRequest?.cashbackTotal ?? null,
      }))

    return { reservations, queues }
  },

  async getSupportConfig() {
    await sleep(80)
    return {
      phone: '+265 800 000 111',
      whatsapp: '+265 999 000 111',
      email: 'support@smartlink.app',
      hours: '24/7',
    }
  },

  async getSupportTickets() {
    await sleep(100)
    return supportTickets.map((item) => ({ ...item }))
  },

  async leaveQueue(queueJoinId, { reason } = {}) {
    await sleep(160)
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    const entry = queuesById.get(scopedQueueJoinId)
    if (!entry) throw new Error('Queue entry not found')

    entry.queueStatus = 'CANCELLED'
    entry.position = null
    entry.carsAhead = 0
    entry.etaMinutes = 0
    entry.movementState = 'paused'
    entry.pauseReason = reason || 'Queue position released by user.'
    entry.lastMovementAt = toIsoNow()
    notifyQueue(scopedQueueJoinId, 'mock_leave')

    return {
      left: true,
      queueJoinId: scopedQueueJoinId,
      status: buildSnapshot(entry),
    }
  },

  async scanPumpQr(queueJoinId, { qrToken } = {}) {
    await sleep(140)
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    const entry = queuesById.get(scopedQueueJoinId)
    if (!entry) throw new Error('Queue entry not found')

    const scopedQrToken = String(qrToken || '').trim()
    if (!scopedQrToken) throw new Error('Pump QR value is required')

    const pumpNumberMatch = scopedQrToken.match(/P(\d{1,2})/i)
    const pumpNumber = pumpNumberMatch ? Number(pumpNumberMatch[1]) : 1
    const stationPublicId = String(entry.station.publicId || entry.station.id || '').trim()
    const derivedPumpPublicId = scopedQrToken.includes('-P')
      ? scopedQrToken
      : `${stationPublicId}-P${String(Math.max(1, pumpNumber)).padStart(2, '0')}`
    const assignedNozzle = resolveMockAssignableNozzle({
      pumpPublicId: derivedPumpPublicId,
      fuelType: entry.fuelType,
      excludeQueueJoinId: scopedQueueJoinId,
    })
    if (!assignedNozzle) {
      throw new Error('No free nozzle on this pump matches your selected fuel type.')
    }
    const assignedNozzleNumber = String(assignedNozzle.nozzleNumber || '').trim()
    const assignedNozzlePublicId = `${derivedPumpPublicId}-N${assignedNozzleNumber.padStart(2, '0')}`

    entry.verifiedPump = {
      pumpPublicId: derivedPumpPublicId,
      pumpNumber: Math.max(1, pumpNumber),
      pumpStatus: 'ACTIVE',
      nozzlePublicId: assignedNozzlePublicId,
      nozzleNumber: assignedNozzleNumber,
      nozzleStatus: 'ACTIVE',
      fuelType: entry.fuelType,
      scannedAt: toIsoNow(),
    }

    notifyQueue(scopedQueueJoinId, 'mock_pump_scan')

    return {
      scanned: true,
      queueJoinId: scopedQueueJoinId,
      pump: {
        pumpPublicId: entry.verifiedPump.pumpPublicId,
        pumpNumber: entry.verifiedPump.pumpNumber,
        status: entry.verifiedPump.pumpStatus,
        nozzlePublicId: entry.verifiedPump.nozzlePublicId,
        nozzleNumber: entry.verifiedPump.nozzleNumber,
        nozzleStatus: entry.verifiedPump.nozzleStatus,
        fuelType: entry.verifiedPump.fuelType,
      },
      status: buildSnapshot(entry),
      message: `Pump ${entry.verifiedPump.pumpNumber} verified. Nozzle ${entry.verifiedPump.nozzleNumber} assigned.`,
    }
  },

  async submitDispenseRequest(queueJoinId, { liters, prepay } = {}) {
    await sleep(140)
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    const entry = queuesById.get(scopedQueueJoinId)
    if (!entry) throw new Error('Queue entry not found')
    if (!entry.verifiedPump) {
      throw new Error('Verify the pump first.')
    }
    const blockedNozzlePublicIds = listBlockedMockNozzlePublicIds({
      pumpPublicId: entry.verifiedPump.pumpPublicId,
      excludeQueueJoinId: scopedQueueJoinId,
    })
    if (blockedNozzlePublicIds.has(String(entry.verifiedPump.nozzlePublicId || '').trim())) {
      throw new Error('Assigned nozzle is no longer free. Scan the pump again to get a new nozzle.')
    }

    const parsedLiters = Number(liters)
    if (!Number.isFinite(parsedLiters) || parsedLiters <= 0) {
      throw new Error('Liters are required')
    }

    const paymentMode = typeof prepay === 'boolean'
      ? prepay
        ? 'PREPAY'
        : 'PAY_AT_PUMP'
      : entry.paymentMode || 'PAY_AT_PUMP'

    entry.requestedLiters = parsedLiters
    entry.paymentMode = paymentMode
    entry.verifiedPump = {
      ...entry.verifiedPump,
      pumpStatus: 'DISPENSING',
      nozzleStatus: 'DISPENSING',
    }
    entry.serviceRequest = {
      liters: parsedLiters,
      paymentMode,
      prepaySelected: paymentMode === 'PREPAY',
      submittedAt: toIsoNow(),
      nozzlePublicId: entry.verifiedPump.nozzlePublicId,
      pricePerLitre: 2500,
      estimatedAmount: Number((parsedLiters * 2500).toFixed(2)),
      currencyCode: 'MWK',
      paymentStatus: paymentMode === 'PREPAY' ? 'POSTED' : 'PENDING_AT_PUMP',
      walletTransactionReference:
        paymentMode === 'PREPAY'
          ? `WPM-${Math.random().toString(36).slice(2, 10)}`.toUpperCase()
          : null,
      walletAvailableBalanceAfterPayment:
        paymentMode === 'PREPAY' ? 50000 : null,
      dispensingStartedAt: toIsoNow(),
    }
    entry.stationStatus = {
      ...buildStationStatus(),
      dispensing: Math.max(1, randomInt(1, 3)),
    }

    notifyQueue(scopedQueueJoinId, 'mock_dispense_request')

    return {
      submitted: true,
      queueJoinId: scopedQueueJoinId,
      status: buildSnapshot(entry),
      payment:
        paymentMode === 'PREPAY'
          ? {
              transaction: {
                reference: entry.serviceRequest.walletTransactionReference,
                amount: entry.serviceRequest.estimatedAmount,
                currencyCode: 'MWK',
                type: 'PAYMENT',
                status: 'POSTED',
              },
              wallet: {
                availableBalance: entry.serviceRequest.walletAvailableBalanceAfterPayment,
                currencyCode: 'MWK',
              },
            }
          : null,
      message:
        paymentMode === 'PREPAY'
          ? 'Fuel request submitted and wallet prepaid. Pump is now dispensing.'
          : 'Fuel request submitted. Pump is now dispensing.',
    }
  },

  async reportIssue(queueJoinId, payload = {}) {
    await sleep(140)
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    const entry = queuesById.get(scopedQueueJoinId)
    if (!entry) throw new Error('Queue entry not found')

    const ticketId = `MQR-${Math.random().toString(36).slice(2, 10)}`.toUpperCase()
    supportTickets.unshift({
      id: ticketId,
      category: 'Queue',
      severity: payload.issueType === 'STATION_ACCESS' ? 'Critical' : 'Medium',
      status: 'OPEN',
      title: 'Queue support issue',
      description: payload.message || 'Queue issue reported from the mobile app.',
      stationPublicId: entry.station.publicId || entry.station.id,
      stationName: entry.station.name,
      createdAt: toIsoNow(),
      updatedAt: toIsoNow(),
      casePublicId: `CASE-${Math.random().toString(36).slice(2, 10)}`.toUpperCase(),
      casePriority: payload.issueType === 'STATION_ACCESS' ? 'HIGH' : 'MEDIUM',
      caseStatus: 'OPEN',
      responseMessage: null,
      respondedAt: null,
      responderName: null,
    })

    return {
      reported: true,
      queueJoinId: scopedQueueJoinId,
      referenceId: ticketId,
      issueType: payload.issueType || 'OTHER',
      acknowledgedAt: toIsoNow(),
      supportTicketId: ticketId,
    }
  },

  connectQueueSocket({ queueJoinId, onMessage, onOpen }) {
    const scopedQueueJoinId = String(queueJoinId || '').trim()
    if (!scopedQueueJoinId) throw new Error('queueJoinId is required')
    const entry = queuesById.get(scopedQueueJoinId)
    if (!entry) throw new Error('Queue entry not found')

    let active = true
    let listeners = listenersByQueueId.get(scopedQueueJoinId)
    if (!listeners) {
      listeners = new Set()
      listenersByQueueId.set(scopedQueueJoinId, listeners)
    }

    const listener = (payload) => {
      if (!active) return
      onMessage?.(payload)
    }
    listeners.add(listener)
    startQueueTicker(scopedQueueJoinId)

    window.setTimeout(() => {
      if (!active) return
      onOpen?.()
      onMessage?.({
        type: 'queue:ready',
        queueJoinId: scopedQueueJoinId,
        at: toIsoNow(),
      })
      notifyQueue(scopedQueueJoinId, 'mock_initial')
    }, 40)

    return () => {
      active = false
      const nextListeners = listenersByQueueId.get(scopedQueueJoinId)
      if (nextListeners) {
        nextListeners.delete(listener)
        if (nextListeners.size === 0) {
          listenersByQueueId.delete(scopedQueueJoinId)
        }
      }
      stopQueueTickerIfUnused(scopedQueueJoinId)
    }
  },

  connectStationChangesSocket({ stationPublicId, onMessage, onOpen }) {
    const scopedStationId = String(stationPublicId || '').trim()
    if (!scopedStationId) throw new Error('stationPublicId is required')

    let active = true
    const timerId = window.setInterval(() => {
      if (!active) return
      onMessage?.({
        type: 'station_change',
        stationPublicId: scopedStationId,
        actionType: 'RESERVATION_SLOT_REFRESH',
        at: toIsoNow(),
      })
    }, 7000)

    window.setTimeout(() => {
      if (!active) return
      onOpen?.()
      onMessage?.({
        type: 'station_change_ready',
        stationPublicId: scopedStationId,
        at: toIsoNow(),
      })
    }, 30)

    return () => {
      active = false
      window.clearInterval(timerId)
    }
  },
}
