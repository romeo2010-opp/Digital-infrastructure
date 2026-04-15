import { useCallback, useEffect, useMemo, useState } from 'react'
import { userQueueApi } from '../api/userQueueApi'
import { queueMockService } from '../queueMockService'
import { FilterIcon } from '../icons'
import { maskPublicId } from '../../utils/masking'
import { formatDate, formatDateTime, formatTime } from '../dateTime'
import { downloadBlobFile, downloadSmartPayReceipt } from '../utils/smartPayReceipt'

const HISTORY_PREVIEW_LIMIT = 3
const DEFAULT_HISTORY_FILTERS = Object.freeze({
  from: '',
  to: '',
})
const HISTORY_CALENDAR_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HISTORY_CALENDAR_POPOVER_MAX_WIDTH = 360
const HISTORY_CALENDAR_POPOVER_MARGIN = 16
const HISTORY_CALENDAR_POPOVER_GAP = 10

function formatDateLabel(isoValue) {
  return formatDate(isoValue, undefined, 'Date unavailable')
}

function normalizeHistoryDateInput(value) {
  const normalized = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : ''
}

function isHistoryDateRangeInvalid(filters) {
  const from = normalizeHistoryDateInput(filters?.from)
  const to = normalizeHistoryDateInput(filters?.to)
  return Boolean(from && to && to < from)
}

function countActiveHistoryFilters(filters) {
  return [normalizeHistoryDateInput(filters?.from), normalizeHistoryDateInput(filters?.to)].filter(Boolean).length
}

function formatHistoryDateChip(value, prefix) {
  const normalized = normalizeHistoryDateInput(value)
  if (!normalized) return ''
  return `${prefix} ${formatDate(`${normalized}T00:00:00`, undefined, normalized)}`
}

function formatHistoryCalendarValue(value) {
  const normalized = normalizeHistoryDateInput(value)
  if (!normalized) return 'Select date'
  return formatDate(`${normalized}T00:00:00`, undefined, normalized)
}

function parseHistoryDate(value) {
  const normalized = normalizeHistoryDateInput(value)
  if (!normalized) return null
  const [year, month, day] = normalized.split('-').map((chunk) => Number(chunk))
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatHistoryDateIsoFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function todayHistoryDateIso() {
  return formatHistoryDateIsoFromDate(new Date())
}

function getHistoryCalendarMonthState(value = '') {
  const date = parseHistoryDate(value) || new Date()
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
  }
}

function shiftHistoryCalendarMonth(monthState, delta) {
  const anchor = new Date(monthState.year, monthState.month + delta, 1)
  return {
    year: anchor.getFullYear(),
    month: anchor.getMonth(),
  }
}

function formatHistoryCalendarMonthLabel(monthState) {
  const anchor = new Date(monthState.year, monthState.month, 1)
  return anchor.toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  })
}

function buildHistoryCalendarDays({ monthState, activeField, filters }) {
  const monthStart = new Date(monthState.year, monthState.month, 1)
  const leadingOffset = (monthStart.getDay() + 6) % 7
  const start = normalizeHistoryDateInput(filters?.from)
  const end = normalizeHistoryDateInput(filters?.to)
  const minAllowed = activeField === 'to' ? start : ''
  const maxAllowed = activeField === 'from' ? end : ''
  const activeValue = activeField === 'from' ? start : end
  const cells = []

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(monthState.year, monthState.month, index - leadingOffset + 1)
    const iso = formatHistoryDateIsoFromDate(date)
    const isCurrentMonth = date.getMonth() === monthState.month
    const isDisabled = Boolean((minAllowed && iso < minAllowed) || (maxAllowed && iso > maxAllowed))
    cells.push({
      iso,
      dayLabel: String(date.getDate()),
      isCurrentMonth,
      isToday: iso === todayHistoryDateIso(),
      isDisabled,
      isRangeStart: Boolean(start && iso === start),
      isRangeEnd: Boolean(end && iso === end),
      isRangeMiddle: Boolean(start && end && iso > start && iso < end),
      isActiveSelection: Boolean(activeValue && iso === activeValue),
    })
  }

  return cells
}

function buildHistoryCalendarPopoverPlacement(anchorRect) {
  if (!anchorRect || typeof window === 'undefined') {
    return null
  }

  const viewportWidth = window.innerWidth || 390
  const viewportHeight = window.innerHeight || 844
  const width = Math.min(HISTORY_CALENDAR_POPOVER_MAX_WIDTH, viewportWidth - HISTORY_CALENDAR_POPOVER_MARGIN * 2)
  const left = Math.min(
    Math.max(anchorRect.left + anchorRect.width / 2 - width / 2, HISTORY_CALENDAR_POPOVER_MARGIN),
    viewportWidth - width - HISTORY_CALENDAR_POPOVER_MARGIN,
  )
  const estimatedHeight = 420
  const preferredTop = anchorRect.bottom + HISTORY_CALENDAR_POPOVER_GAP
  const canOpenBelow = preferredTop + estimatedHeight <= viewportHeight - HISTORY_CALENDAR_POPOVER_MARGIN
  const top = canOpenBelow
    ? Math.max(HISTORY_CALENDAR_POPOVER_MARGIN, preferredTop)
    : Math.max(HISTORY_CALENDAR_POPOVER_MARGIN, anchorRect.top - HISTORY_CALENDAR_POPOVER_GAP - estimatedHeight)

  return {
    top,
    left,
    width,
    placement: canOpenBelow ? 'below' : 'above',
    originX: Math.min(Math.max(anchorRect.left + anchorRect.width / 2 - left, 28), width - 28),
  }
}

function formatTimeSlot(startIso, endIso) {
  if (!startIso) return 'Time slot unavailable'
  const start = formatTime(startIso, undefined, '')
  const end = formatTime(endIso, undefined, '')
  if (!start) return 'Time slot unavailable'
  if (!end) return start
  return `${start} - ${end}`
}

function isAbortError(error) {
  if (!error) return false
  if (error?.name === 'AbortError') return true
  const message = String(error?.message || '').toLowerCase()
  return message.includes('aborted') || message.includes('aborterror')
}

function reservationStatusClass(status) {
  if (status === 'Checked In') return 'is-confirmed'
  if (status === 'Completed') return 'is-completed'
  if (status === 'Expired') return 'is-cancelled'
  if (status === 'Cancelled') return 'is-cancelled'
  if (status === 'Pending') return 'is-pending'
  return 'is-confirmed'
}

function queueStatusClass(status) {
  const normalized = String(status || '').trim().toUpperCase()
  if (['SERVED', 'COMPLETED'].includes(normalized)) return 'is-completed'
  if (['LEFT', 'CANCELLED', 'NO_SHOW'].includes(normalized)) return 'is-cancelled'
  if (['WAITING', 'JOINED'].includes(normalized)) return 'is-pending'
  return 'is-confirmed'
}

function queueStatusLabel(status) {
  const normalized = String(status || '').trim().toUpperCase()
  if (!normalized) return 'Joined'
  return normalized
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function fuelTypeLabel(fuelType) {
  return String(fuelType || '').trim().toUpperCase() === 'DIESEL' ? 'Diesel' : 'Petrol'
}

function toMoneyNumber(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Number(numeric.toFixed(2))
}

function formatMoney(amount, currencyCode = 'MWK') {
  const normalized = toMoneyNumber(amount)
  if (normalized === null) return `${currencyCode} -`
  const isWhole = Math.abs(normalized % 1) < 0.001
  return `${currencyCode} ${normalized.toLocaleString(undefined, {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function normalizeTextValue(value) {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

function normalizeNumberValue(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  return Number(numeric.toFixed(2))
}

function normalizePromotionSummary(row) {
  const discountLines = Array.isArray(row?.discountLines) ? row.discountLines : []
  const cashbackLines = Array.isArray(row?.cashbackLines) ? row.cashbackLines : []
  const promotionLabels = Array.isArray(row?.promoLabelsApplied)
    ? row.promoLabelsApplied.map((value) => String(value || '').trim()).filter(Boolean)
    : []
  const primaryDiscountLine = discountLines.find((line) => Number(line?.amount || 0) > 0) || discountLines[0] || null
  const primaryCashbackLine = cashbackLines.find((line) => Number(line?.amount || 0) > 0) || cashbackLines[0] || null
  const primaryLine = primaryDiscountLine || primaryCashbackLine

  return {
    promotionLabel:
      normalizeTextValue(primaryLine?.label) ||
      normalizeTextValue(row?.promotionLabel) ||
      normalizeTextValue(row?.campaignName) ||
      (promotionLabels.length ? promotionLabels.join(', ') : null),
    promotionType:
      normalizeTextValue(primaryLine?.promotionKind) ||
      normalizeTextValue(row?.promotionKind) ||
      normalizeTextValue(row?.promotionType),
    promotionValueLabel:
      normalizeTextValue(primaryLine?.promotionValueLabel) ||
      normalizeTextValue(row?.promotionValueLabel),
    discountAmount:
      normalizeNumberValue(primaryDiscountLine?.amount) ??
      normalizeNumberValue(row?.discountAmount) ??
      normalizeNumberValue(row?.totalDirectDiscount),
    cashbackAmount:
      normalizeNumberValue(primaryCashbackLine?.amount) ??
      normalizeNumberValue(row?.cashbackAmount) ??
      normalizeNumberValue(row?.cashbackTotal),
  }
}

function paymentModeLabel(value) {
  return String(value || '').trim().toUpperCase() === 'PREPAY' ? 'SmartPay' : 'Pay at pump'
}

function buildFallbackTransactionId(prefix, reference, completedAt) {
  const normalizedPrefix = String(prefix || 'SP').trim().toUpperCase() || 'SP'
  const normalizedReference = String(reference || 'RECEIPT')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(-12) || 'RECEIPT'
  const timestamp = String(completedAt || '')
    .replace(/\D+/g, '')
    .slice(0, 14) || '00000000000000'
  return `${normalizedPrefix}-${normalizedReference}-${timestamp}`
}

function canDownloadQueueReceipt(queueItem) {
  return queueItem.paymentMode === 'PREPAY' && ['SERVED', 'COMPLETED'].includes(queueItem.statusCode)
}

function canDownloadReservationReceipt(reservation) {
  return reservation.paymentMode === 'PREPAY' && ['FULFILLED', 'COMPLETED'].includes(reservation.statusCode)
}

function buildQueueReceipt(queueItem) {
  const completedAt = queueItem.servedAt || queueItem.leftAt || queueItem.joinedAt
  const transactionId =
    queueItem.transactionReference ||
    buildFallbackTransactionId('SPQ', queueItem.referenceRaw || queueItem.id, completedAt)

  return {
    title: 'Queue Payment Receipt',
    subtitle: 'Completed digital queue payment',
    transactionId,
    reference: queueItem.referenceRaw || queueItem.id,
    paymentMethod: 'SmartPay',
    paymentStatus: queueItem.paymentStatus || 'PAID',
    stationName: queueItem.stationName,
    stationArea: queueItem.stationArea,
    serviceLabel: 'Digital Queue',
    fuelType: queueItem.fuelType,
    volumeLabel:
      queueItem.requestedLiters !== null ? `${queueItem.requestedLiters} L` : 'Fuel volume unavailable',
    pricePerLitre: queueItem.pricePerLitre,
    totalAmount: queueItem.totalAmount,
    currencyCode: queueItem.currencyCode,
    pumpNumber: queueItem.pumpNumber,
    nozzleLabel: queueItem.nozzleLabel,
    promotionLabel: queueItem.promotionLabel,
    promotionType: queueItem.promotionType,
    promotionValueLabel: queueItem.promotionValueLabel,
    discountAmount: queueItem.discountAmount,
    cashbackAmount: queueItem.cashbackAmount,
    completedAt,
  }
}

function buildReservationReceipt(reservation) {
  const completedAt = reservation.servedAt || reservation.slotEnd || reservation.slotStart || reservation.joinedAt
  const transactionId =
    reservation.transactionReference ||
    buildFallbackTransactionId('SPR', reservation.referenceRaw || reservation.id, completedAt)

  return {
    title: 'Reservation Payment Receipt',
    subtitle: 'Completed reservation payment',
    transactionId,
    reference: reservation.referenceRaw || reservation.id,
    paymentMethod: 'SmartPay',
    paymentStatus: reservation.paymentStatus || 'PAID',
    stationName: reservation.stationName,
    stationArea: reservation.stationArea,
    serviceLabel: 'Fuel Reservation',
    fuelType: reservation.fuelType,
    volumeLabel:
      reservation.litres !== null ? `${reservation.litres} L` : 'Fuel volume unavailable',
    pricePerLitre: reservation.pricePerLitre,
    totalAmount: reservation.totalAmount ?? reservation.depositAmount,
    currencyCode: reservation.currencyCode,
    pumpNumber: reservation.pumpNumber,
    nozzleLabel: reservation.nozzleLabel,
    promotionLabel: reservation.promotionLabel,
    promotionType: reservation.promotionType,
    promotionValueLabel: reservation.promotionValueLabel,
    discountAmount: reservation.discountAmount,
    cashbackAmount: reservation.cashbackAmount,
    completedAt,
  }
}

function normalizeReservationRow(row, index) {
  const stationName = String(row?.station?.name || row?.stationName || 'Unknown station').trim()
  const stationArea = String(row?.station?.area || row?.stationArea || '').trim() || null
  const fuelType = fuelTypeLabel(row?.fuelType)
  const litresRaw = Number(row?.litersReserved ?? row?.litres ?? row?.litresReserved)
  const litres = Number.isFinite(litresRaw) && litresRaw > 0 ? Number(litresRaw.toFixed(1)) : null
  const status = String(row?.status || '').trim() || 'Pending'
  const statusCode = String(row?.reservationStatus || row?.status || '').trim().toUpperCase() || 'PENDING'
  const joinedAt = row?.joinedAt || row?.joined_at || null
  const slotStart = row?.slotStart || row?.slot_start || joinedAt || null
  const slotEnd = row?.slotEnd || row?.slot_end || null
  const slotDateLabel = String(row?.slotDateLabel || row?.slot_date_label || '').trim()
  const slotLabel = String(row?.slotLabel || row?.slot_label || '').trim()
  const reference = String(row?.reference || row?.id || row?.queueJoinId || `RSV-${index + 1}`).trim()
  const paymentMode = String(row?.paymentMode || '').trim().toUpperCase() || 'PREPAY'
  const depositAmount = toMoneyNumber(row?.depositAmount ?? row?.deposit_amount)
  const pricePerLitre = toMoneyNumber(row?.pricePerLitre ?? row?.price_per_litre)
  const totalAmount = toMoneyNumber(row?.totalAmount ?? row?.total_amount ?? row?.estimatedFuelCost)
  const currencyCode = String(row?.currencyCode || row?.currency_code || 'MWK').trim() || 'MWK'
  const transactionReference = String(row?.transactionReference || row?.transaction_reference || '').trim() || null
  const paymentStatus = String(row?.paymentStatus || row?.payment_status || '').trim().toUpperCase() || null
  const servedAt = row?.servedAt || row?.served_at || null
  const promotionSummary = normalizePromotionSummary(row)

  return {
    id: String(row?.id || row?.queueJoinId || reference || `reservation-${index}`).trim() || `reservation-${index}`,
    stationName,
    stationArea,
    litres,
    fuelType,
    dateLabel: slotDateLabel || formatDateLabel(slotStart || joinedAt),
    timeSlot: slotLabel || formatTimeSlot(slotStart, slotEnd),
    status,
    statusCode,
    reference: maskPublicId(reference, { prefix: 4, suffix: 4 }),
    referenceRaw: reference,
    joinedAt,
    slotStart,
    slotEnd,
    servedAt,
    paymentMode,
    depositAmount,
    pricePerLitre,
    totalAmount,
    currencyCode,
    transactionReference,
    paymentStatus,
    pumpNumber: normalizeNumberValue(row?.pumpNumber ?? row?.pump_number),
    nozzleLabel: normalizeTextValue(row?.nozzleLabel || row?.nozzle_label),
    promotionLabel: promotionSummary.promotionLabel,
    promotionType: promotionSummary.promotionType,
    promotionValueLabel: promotionSummary.promotionValueLabel,
    discountAmount: promotionSummary.discountAmount,
    cashbackAmount: promotionSummary.cashbackAmount,
  }
}

function normalizeQueueHistoryRow(row, index) {
  const queueJoinId = String(row?.queueJoinId || row?.id || `queue-${index}`).trim() || `queue-${index}`
  const joinedAt = String(row?.joinedAt || '').trim() || null
  const leftAt = String(row?.leftAt || '').trim() || null
  const rawStatus = String(row?.queueStatus || row?.status || 'JOINED').trim().toUpperCase() || 'JOINED'
  const promotionSummary = normalizePromotionSummary(row)
  return {
    id: queueJoinId,
    queueJoinId,
    stationName: String(row?.station?.name || row?.stationName || 'Unknown station').trim() || 'Unknown station',
    stationArea: String(row?.station?.area || row?.stationArea || '').trim() || null,
    fuelType: fuelTypeLabel(row?.fuelType),
    requestedLiters: Number.isFinite(Number(row?.requestedLiters)) && Number(row?.requestedLiters) > 0
      ? Number(row.requestedLiters)
      : null,
    paymentMode: String(row?.paymentMode || '').trim().toUpperCase() || null,
    paymentStatus: String(row?.paymentStatus || row?.payment_status || '').trim().toUpperCase() || null,
    pricePerLitre: toMoneyNumber(row?.pricePerLitre ?? row?.price_per_litre),
    totalAmount: toMoneyNumber(row?.totalAmount ?? row?.total_amount ?? row?.estimatedAmount),
    currencyCode: String(row?.currencyCode || row?.currency_code || 'MWK').trim() || 'MWK',
    transactionReference: String(row?.transactionReference || row?.transaction_reference || '').trim() || null,
    status: queueStatusLabel(rawStatus),
    statusCode: rawStatus,
    statusClass: queueStatusClass(rawStatus),
    joinedAt,
    joinedDateLabel: formatDateLabel(joinedAt),
    joinedTimeLabel: formatTime(joinedAt, undefined, 'Time unavailable'),
    leftAt,
    leftTimeLabel: leftAt ? formatTime(leftAt, undefined, 'Time unavailable') : null,
    servedAt: String(row?.servedAt || row?.served_at || '').trim() || null,
    pumpNumber: normalizeNumberValue(row?.pumpNumber ?? row?.pump_number),
    nozzleLabel: normalizeTextValue(row?.nozzleLabel || row?.nozzle_label),
    promotionLabel: promotionSummary.promotionLabel,
    promotionType: promotionSummary.promotionType,
    promotionValueLabel: promotionSummary.promotionValueLabel,
    discountAmount: promotionSummary.discountAmount,
    cashbackAmount: promotionSummary.cashbackAmount,
    reference: maskPublicId(queueJoinId, { prefix: 4, suffix: 4 }),
    referenceRaw: String(row?.reference || row?.queueJoinId || row?.id || queueJoinId).trim() || queueJoinId,
  }
}

export function HistoryScreen({ activeQueueJoinId = '', onOpenQueue }) {
  const queueData = useMemo(
    () => (userQueueApi.isApiMode() ? userQueueApi : queueMockService),
    [],
  )
  const [reservations, setReservations] = useState(() => [])
  const [queueHistory, setQueueHistory] = useState(() => [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [openModal, setOpenModal] = useState('')
  const [historyFilters, setHistoryFilters] = useState(DEFAULT_HISTORY_FILTERS)
  const [draftFilters, setDraftFilters] = useState(DEFAULT_HISTORY_FILTERS)
  const [activeDateField, setActiveDateField] = useState('from')
  const [calendarMonth, setCalendarMonth] = useState(() => getHistoryCalendarMonthState())
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)
  const [calendarPlacement, setCalendarPlacement] = useState(null)
  const [calendarStepMessage, setCalendarStepMessage] = useState('')

  const activeFilterCount = useMemo(() => countActiveHistoryFilters(historyFilters), [historyFilters])
  const hasActiveFilters = activeFilterCount > 0
  const draftRangeInvalid = isHistoryDateRangeInvalid(draftFilters)
  const calendarDays = useMemo(
    () => buildHistoryCalendarDays({
      monthState: calendarMonth,
      activeField: activeDateField,
      filters: draftFilters,
    }),
    [activeDateField, calendarMonth, draftFilters],
  )

  const loadHistory = useCallback(async ({ signal } = {}) => {
    setLoading(true)
    setError('')
    try {
      const requestFilters = {
        from: normalizeHistoryDateInput(historyFilters.from) || undefined,
        to: normalizeHistoryDateInput(historyFilters.to) || undefined,
      }
      if (typeof queueData.getHistory === 'function') {
        const payload = await queueData.getHistory({ signal, ...requestFilters })
        const reservationRows = Array.isArray(payload?.reservations) ? payload.reservations : []
        const queueRows = Array.isArray(payload?.queues) ? payload.queues : []
        setReservations(reservationRows.map(normalizeReservationRow))
        setQueueHistory(queueRows.map(normalizeQueueHistoryRow))
      } else {
        const reservationPayload = typeof queueData.getReservations === 'function'
          ? await queueData.getReservations({ signal, ...requestFilters })
          : []
        const reservationRows = Array.isArray(reservationPayload) ? reservationPayload : []
        setReservations(reservationRows.map(normalizeReservationRow))
        setQueueHistory([])
      }
    } catch (requestError) {
      if (signal?.aborted || isAbortError(requestError)) return
      setReservations([])
      setQueueHistory([])
      setError(requestError?.message || 'Unable to load history.')
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }, [historyFilters, queueData])

  useEffect(() => {
    const controller = new AbortController()
    loadHistory({ signal: controller.signal })
    return () => {
      controller.abort()
    }
  }, [loadHistory])

  const reservationCount = reservations.length
  const queueCount = queueHistory.length
  const reservationPreview = reservations.slice(0, HISTORY_PREVIEW_LIMIT)
  const queuePreview = queueHistory.slice(0, HISTORY_PREVIEW_LIMIT)
  const showFilteredEmptyState = hasActiveFilters && !loading && !error && reservationCount === 0 && queueCount === 0

  async function handleDownloadReceipt({ receiptType, item, receiptBuilder }) {
    setDownloadError('')
    try {
      if (userQueueApi.isApiMode() && typeof queueData.downloadReceiptPdf === 'function') {
        const result = await queueData.downloadReceiptPdf({
          receiptType,
          reference: item.referenceRaw || item.id,
        })
        downloadBlobFile(result?.blob, result?.filename || `smartpay-${receiptType}-receipt.pdf`)
        return
      }

      downloadSmartPayReceipt(receiptBuilder(item))
    } catch (downloadIssue) {
      setDownloadError(downloadIssue?.message || 'Unable to download receipt.')
    }
  }

  function handleOpenFilterModal() {
    setDraftFilters(historyFilters)
    const initialField = normalizeHistoryDateInput(historyFilters.from)
      ? 'from'
      : normalizeHistoryDateInput(historyFilters.to)
        ? 'to'
        : 'from'
    const initialAnchor = initialField === 'to'
      ? historyFilters.to || historyFilters.from
      : historyFilters.from || historyFilters.to
    setActiveDateField(initialField)
    setCalendarMonth(getHistoryCalendarMonthState(initialAnchor))
    setIsCalendarOpen(false)
    setCalendarPlacement(null)
    setCalendarStepMessage('')
    setOpenModal('filters')
  }

  function handleCloseFilterModal() {
    setDraftFilters(historyFilters)
    setActiveDateField('from')
    setCalendarMonth(getHistoryCalendarMonthState(historyFilters.from || historyFilters.to))
    setIsCalendarOpen(false)
    setCalendarPlacement(null)
    setCalendarStepMessage('')
    setOpenModal('')
  }

  function handleApplyFilters(event) {
    event.preventDefault()
    if (draftRangeInvalid) return

    setHistoryFilters({
      from: normalizeHistoryDateInput(draftFilters.from),
      to: normalizeHistoryDateInput(draftFilters.to),
    })
    setOpenModal('')
  }

  function handleResetFilters() {
    setDraftFilters(DEFAULT_HISTORY_FILTERS)
    setHistoryFilters(DEFAULT_HISTORY_FILTERS)
    setActiveDateField('from')
    setCalendarMonth(getHistoryCalendarMonthState())
    setIsCalendarOpen(false)
    setCalendarPlacement(null)
    setCalendarStepMessage('')
    setOpenModal('')
  }

  function handleSelectDateField(field, event) {
    const normalizedField = field === 'to' ? 'to' : 'from'
    const anchor = normalizedField === 'to'
      ? draftFilters.to || draftFilters.from
      : draftFilters.from || draftFilters.to
    setActiveDateField(normalizedField)
    setCalendarMonth(getHistoryCalendarMonthState(anchor))
    setCalendarPlacement(buildHistoryCalendarPopoverPlacement(event?.currentTarget?.getBoundingClientRect?.() || null))
    setCalendarStepMessage('')
    setIsCalendarOpen(true)
  }

  function updateDraftFilterDate(field, isoValue) {
    const normalizedValue = normalizeHistoryDateInput(isoValue)
    setDraftFilters((current) => {
      if (field === 'to') {
        const nextFrom = current.from && current.from > normalizedValue ? normalizedValue : current.from
        return {
          ...current,
          from: nextFrom,
          to: normalizedValue,
        }
      }

      const nextTo = current.to && current.to < normalizedValue ? normalizedValue : current.to
      return {
        ...current,
        from: normalizedValue,
        to: nextTo,
      }
    })
  }

  function advanceToEndDateSelection(nextStartIso) {
    const nextAnchor = normalizeHistoryDateInput(draftFilters.to) || normalizeHistoryDateInput(nextStartIso)
    setActiveDateField('to')
    setCalendarMonth(getHistoryCalendarMonthState(nextAnchor))
    setCalendarStepMessage('Start date selected. Now choose the end date.')
  }

  function handleSelectCalendarDay(isoValue) {
    const normalizedValue = normalizeHistoryDateInput(isoValue)
    if (!normalizedValue) return
    updateDraftFilterDate(activeDateField, normalizedValue)
    if (activeDateField === 'from') {
      advanceToEndDateSelection(normalizedValue)
      return
    }
    setIsCalendarOpen(false)
    setCalendarPlacement(null)
    setCalendarStepMessage('')
  }

  function handleSelectToday() {
    const todayIso = todayHistoryDateIso()
    setCalendarMonth(getHistoryCalendarMonthState(todayIso))
    updateDraftFilterDate(activeDateField, todayIso)
    if (activeDateField === 'from') {
      advanceToEndDateSelection(todayIso)
      return
    }
    setIsCalendarOpen(false)
    setCalendarPlacement(null)
    setCalendarStepMessage('')
  }

  function handleClearActiveCalendarField() {
    setDraftFilters((current) => ({
      ...current,
      [activeDateField]: '',
    }))
    setIsCalendarOpen(false)
    setCalendarPlacement(null)
    setCalendarStepMessage('')
  }

  function renderReservationCard(reservation) {
    return (
      <article key={reservation.id} className='reservation-card'>
        <div className='reservation-card-top'>
          <h3>{reservation.stationName}</h3>
          <span className={`reservation-status ${reservationStatusClass(reservation.status)}`}>{reservation.status}</span>
        </div>

        <p className='reservation-volume'>
          {reservation.litres !== null ? `${reservation.litres} L` : 'Litres not set'} {reservation.fuelType}
        </p>

        <div className='reservation-meta-row'>
          <span>Time Slot</span>
          <strong>{reservation.timeSlot}</strong>
        </div>
        <div className='reservation-meta-row'>
          <span>Date</span>
          <strong>{reservation.dateLabel}</strong>
        </div>
        <div className='reservation-meta-row'>
          <span>Reference</span>
          <strong>{reservation.reference}</strong>
        </div>
        <div className='reservation-meta-row'>
          <span>Payment</span>
          <strong>{paymentModeLabel(reservation.paymentMode)}</strong>
        </div>
        {reservation.totalAmount !== null || reservation.depositAmount !== null ? (
          <div className='reservation-meta-row'>
            <span>Amount</span>
            <strong>{formatMoney(reservation.totalAmount ?? reservation.depositAmount, reservation.currencyCode)}</strong>
          </div>
        ) : null}
        {canDownloadReservationReceipt(reservation) ? (
          <div className='reservation-action-row'>
            <button
              type='button'
              className='details-action-button is-secondary'
              onClick={() => handleDownloadReceipt({
                receiptType: 'reservation',
                item: reservation,
                receiptBuilder: buildReservationReceipt,
              })}
            >
              Download Receipt
            </button>
          </div>
        ) : null}
      </article>
    )
  }

  function renderQueueCard(queueItem) {
    return (
      <article key={queueItem.id} className='reservation-card'>
        <div className='reservation-card-top'>
          <h3>{queueItem.stationName}</h3>
          <span className={`reservation-status ${queueItem.statusClass}`}>{queueItem.status}</span>
        </div>

        <p className='reservation-volume'>
          {queueItem.requestedLiters !== null ? `${queueItem.requestedLiters} L` : 'Requested liters not set'} {queueItem.fuelType}
        </p>

        <div className='reservation-meta-row'>
          <span>Joined</span>
          <strong>{queueItem.joinedTimeLabel}</strong>
        </div>
        <div className='reservation-meta-row'>
          <span>Date</span>
          <strong>{queueItem.joinedDateLabel}</strong>
        </div>
        <div className='reservation-meta-row'>
          <span>Reference</span>
          <strong>{queueItem.reference}</strong>
        </div>
        <div className='reservation-meta-row'>
          <span>Payment</span>
          <strong>{paymentModeLabel(queueItem.paymentMode)}</strong>
        </div>
        {queueItem.totalAmount !== null ? (
          <div className='reservation-meta-row'>
            <span>Amount</span>
            <strong>{formatMoney(queueItem.totalAmount, queueItem.currencyCode)}</strong>
          </div>
        ) : null}
        {queueItem.transactionReference ? (
          <div className='reservation-meta-row'>
            <span>Transaction ID</span>
            <strong>{maskPublicId(queueItem.transactionReference, { prefix: 4, suffix: 4 })}</strong>
          </div>
        ) : null}
        {queueItem.servedAt ? (
          <div className='reservation-meta-row'>
            <span>Served</span>
            <strong>{formatDateTime(queueItem.servedAt, undefined, 'Unavailable')}</strong>
          </div>
        ) : null}
        {queueItem.leftTimeLabel ? (
          <div className='reservation-meta-row'>
            <span>Left</span>
            <strong>{queueItem.leftTimeLabel}</strong>
          </div>
        ) : null}

        {typeof onOpenQueue === 'function' && queueItem.queueJoinId === activeQueueJoinId ? (
          <div className='reservation-action-row'>
            <button
              type='button'
              className='details-action-button is-primary'
              onClick={() => onOpenQueue(queueItem.queueJoinId)}
            >
              Open Queue
            </button>
            {canDownloadQueueReceipt(queueItem) ? (
              <button
                type='button'
                className='details-action-button is-secondary'
                onClick={() => handleDownloadReceipt({
                  receiptType: 'queue',
                  item: queueItem,
                  receiptBuilder: buildQueueReceipt,
                })}
              >
                Download Receipt
              </button>
            ) : null}
          </div>
        ) : null}
        {!(typeof onOpenQueue === 'function' && queueItem.queueJoinId === activeQueueJoinId) && canDownloadQueueReceipt(queueItem) ? (
          <div className='reservation-action-row'>
            <button
              type='button'
              className='details-action-button is-secondary'
              onClick={() => handleDownloadReceipt({
                receiptType: 'queue',
                item: queueItem,
                receiptBuilder: buildQueueReceipt,
              })}
            >
              Download Receipt
            </button>
          </div>
        ) : null}
      </article>
    )
  }

  return (
    <section className='history-screen'>
      <header className='screen-header screen-header--with-action'>
        <div>
          <h2>History</h2>
          <p>
            {loading
              ? 'Loading…'
              : hasActiveFilters
                ? `${reservationCount} reservations, ${queueCount} queue joins in the selected date range`
                : `${reservationCount} reservations, ${queueCount} queue joins`}
          </p>
        </div>
        <button
          type='button'
          className={`details-action-button is-secondary history-filter-button ${hasActiveFilters ? 'is-active' : ''}`}
          onClick={handleOpenFilterModal}
          aria-haspopup='dialog'
          aria-expanded={openModal === 'filters'}
        >
          <FilterIcon size={15} />
          <span>Filter</span>
          {hasActiveFilters ? <strong>{activeFilterCount}</strong> : null}
        </button>
      </header>

      {hasActiveFilters ? (
        <div className='history-active-filter-row' aria-label='Active history filters'>
          {historyFilters.from ? <span className='history-filter-chip'>{formatHistoryDateChip(historyFilters.from, 'From')}</span> : null}
          {historyFilters.to ? <span className='history-filter-chip'>{formatHistoryDateChip(historyFilters.to, 'To')}</span> : null}
          <button type='button' className='history-clear-filters-button' onClick={handleResetFilters}>
            Clear Filters
          </button>
        </div>
      ) : null}

      {error ? (
        <section className='station-card coming-soon'>
          <h3>Unable to load history</h3>
          <p>{error}</p>
        </section>
      ) : null}

      {downloadError ? (
        <section className='station-card coming-soon'>
          <h3>Unable to download receipt</h3>
          <p>{downloadError}</p>
        </section>
      ) : null}

      {showFilteredEmptyState ? (
        <section className='station-card coming-soon'>
          <h3>No settlements found for the selected date range.</h3>
          <p>Try widening the dates or clearing the filters to load your full history.</p>
        </section>
      ) : null}

      <section className='history-section'>
        <div className='history-section-header'>
          <div className='history-section-title'>
            <h3>Reservations Made</h3>
            <span>{reservationCount}</span>
          </div>
          {reservationCount > HISTORY_PREVIEW_LIMIT ? (
            <button
              type='button'
              className='details-action-button is-secondary history-view-all-button'
              onClick={() => setOpenModal('reservations')}
            >
              View All
            </button>
          ) : null}
        </div>

        {loading ? (
          <section className='station-card coming-soon'>
            <p>Fetching reservation history.</p>
          </section>
        ) : null}

        {!loading && reservationPreview.length ? (
          <div className='reservations-list'>
            {reservationPreview.map(renderReservationCard)}
          </div>
        ) : null}

        {!loading && !reservations.length && !showFilteredEmptyState ? (
          <section className='station-card coming-soon'>
            <h3>{hasActiveFilters ? 'No reservations found' : 'No reservations yet'}</h3>
            <p>{hasActiveFilters ? 'No reservations match the selected date range.' : 'Your reservation activity will appear here.'}</p>
          </section>
        ) : null}
      </section>

      <section className='history-section'>
        <div className='history-section-header'>
          <div className='history-section-title'>
            <h3>Queues Joined</h3>
            <span>{queueCount}</span>
          </div>
          {queueCount > HISTORY_PREVIEW_LIMIT ? (
            <button
              type='button'
              className='details-action-button is-secondary history-view-all-button'
              onClick={() => setOpenModal('queues')}
            >
              View All
            </button>
          ) : null}
        </div>

        {!loading && queuePreview.length ? (
          <div className='reservations-list'>
            {queuePreview.map(renderQueueCard)}
          </div>
        ) : null}

        {!loading && !queueHistory.length && !showFilteredEmptyState ? (
          <section className='station-card coming-soon'>
            <h3>{hasActiveFilters ? 'No queue joins found' : 'No queue joins yet'}</h3>
            <p>{hasActiveFilters ? 'No queue joins match the selected date range.' : 'Queues you join from station details will appear here.'}</p>
          </section>
        ) : null}
      </section>

      {openModal === 'filters' ? (
        <div
          className='queue-modal-backdrop'
          role='dialog'
          aria-modal='true'
          aria-label='Filter history'
          onClick={handleCloseFilterModal}
        >
          <form className='queue-modal reservation-modal history-modal history-filter-modal' onClick={(event) => event.stopPropagation()} onSubmit={handleApplyFilters}>
            <header>
              <div>
                <h3>Filter History</h3>
                <p>Choose a start and end date to narrow your reservation and queue activity.</p>
              </div>
              <button type='button' onClick={handleCloseFilterModal}>Close</button>
            </header>

            <div className='history-filter-grid'>
              <button
                type='button'
                className={`history-calendar-trigger ${activeDateField === 'from' ? 'is-active' : ''} ${draftFilters.from ? 'has-value' : ''}`}
                onClick={(event) => handleSelectDateField('from', event)}
              >
                <span>Start Date</span>
                <strong>{formatHistoryCalendarValue(draftFilters.from)}</strong>
                <small>{draftFilters.from ? 'Tap to change date' : 'Choose the first day in range'}</small>
              </button>

              <button
                type='button'
                className={`history-calendar-trigger ${activeDateField === 'to' ? 'is-active' : ''} ${draftFilters.to ? 'has-value' : ''}`}
                onClick={(event) => handleSelectDateField('to', event)}
              >
                <span>End Date</span>
                <strong>{formatHistoryCalendarValue(draftFilters.to)}</strong>
                <small>{draftFilters.to ? 'Tap to change date' : 'Choose the last day in range'}</small>
              </button>
            </div>

            {isCalendarOpen ? (
              <div
                className='history-calendar-popover-backdrop'
                onClick={() => {
                  setIsCalendarOpen(false)
                  setCalendarPlacement(null)
                  setCalendarStepMessage('')
                }}
              >
                <section
                  className={`history-calendar-panel history-calendar-popover ${calendarPlacement?.placement === 'above' ? 'is-above' : 'is-below'}`}
                  aria-label={`${activeDateField === 'from' ? 'Start' : 'End'} date calendar`}
                  onClick={(event) => event.stopPropagation()}
                  style={calendarPlacement
                    ? {
                        top: `${calendarPlacement.top}px`,
                        left: `${calendarPlacement.left}px`,
                        width: `${calendarPlacement.width}px`,
                        transformOrigin: `${calendarPlacement.originX}px ${calendarPlacement.placement === 'above' ? '100%' : '0px'}`,
                      }
                    : undefined}
                >
                  <div className='history-calendar-toolbar'>
                    <div className='history-calendar-heading'>
                      <span>{activeDateField === 'from' ? 'Editing start date' : 'Editing end date'}</span>
                      <strong>{formatHistoryCalendarMonthLabel(calendarMonth)}</strong>
                    </div>
                    <div className='history-calendar-nav'>
                      <button
                        type='button'
                        className='history-calendar-nav-button'
                        aria-label='Previous month'
                        onClick={() => setCalendarMonth((current) => shiftHistoryCalendarMonth(current, -1))}
                      >
                        ‹
                      </button>
                      <button
                        type='button'
                        className='history-calendar-nav-button'
                        aria-label='Next month'
                        onClick={() => setCalendarMonth((current) => shiftHistoryCalendarMonth(current, 1))}
                      >
                        ›
                      </button>
                    </div>
                  </div>

                  {calendarStepMessage ? (
                    <p
                      key={calendarStepMessage}
                      className='history-calendar-step-notice'
                      aria-live='polite'
                    >
                      {calendarStepMessage}
                    </p>
                  ) : null}

                  <div className='history-calendar-weekdays' aria-hidden='true'>
                    {HISTORY_CALENDAR_WEEKDAYS.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>

                  <div className='history-calendar-days'>
                    {calendarDays.map((day) => {
                      const className = [
                        'history-calendar-day',
                        day.isCurrentMonth ? '' : 'is-outside-month',
                        day.isToday ? 'is-today' : '',
                        day.isRangeStart ? 'is-range-start' : '',
                        day.isRangeEnd ? 'is-range-end' : '',
                        day.isRangeMiddle ? 'is-range-middle' : '',
                        day.isActiveSelection ? 'is-active-selection' : '',
                      ].filter(Boolean).join(' ')

                      return (
                        <button
                          key={`${day.iso}-${day.dayLabel}`}
                          type='button'
                          className={className}
                          disabled={day.isDisabled}
                          aria-pressed={day.isActiveSelection}
                          onClick={() => handleSelectCalendarDay(day.iso)}
                        >
                          {day.dayLabel}
                        </button>
                      )
                    })}
                  </div>

                  <div className='history-calendar-quick-actions'>
                    <button type='button' className='history-calendar-quick-button' onClick={handleSelectToday}>
                      Use Today
                    </button>
                    <button
                      type='button'
                      className='history-calendar-quick-button'
                      onClick={handleClearActiveCalendarField}
                      disabled={!draftFilters[activeDateField]}
                    >
                      Clear {activeDateField === 'from' ? 'Start' : 'End'}
                    </button>
                    <button
                      type='button'
                      className='history-calendar-quick-button'
                      onClick={() => {
                        setIsCalendarOpen(false)
                        setCalendarPlacement(null)
                        setCalendarStepMessage('')
                      }}
                    >
                      Close
                    </button>
                  </div>
                </section>
              </div>
            ) : null}

            {draftRangeInvalid ? <p className='details-inline-error'>End date cannot be before start date.</p> : null}
            <p className='history-filter-note'>Leave both dates empty to reload the full settlement history.</p>

            <div className='queue-modal-actions'>
              <button type='button' className='details-action-button is-secondary' onClick={handleResetFilters} disabled={!hasActiveFilters && !draftFilters.from && !draftFilters.to}>
                Reset
              </button>
              <button type='submit' className='details-action-button is-primary' disabled={draftRangeInvalid}>
                Apply Filters
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {openModal === 'reservations' ? (
        <div
          className='queue-modal-backdrop'
          role='dialog'
          aria-modal='true'
          aria-label='All reservations'
          onClick={() => setOpenModal('')}
        >
          <div className='queue-modal reservation-modal history-modal' onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>All Reservations</h3>
              <button type='button' onClick={() => setOpenModal('')}>Close</button>
            </header>
            <div className='reservations-list history-modal-list'>
              {reservations.map(renderReservationCard)}
            </div>
          </div>
        </div>
      ) : null}

      {openModal === 'queues' ? (
        <div
          className='queue-modal-backdrop'
          role='dialog'
          aria-modal='true'
          aria-label='All queue joins'
          onClick={() => setOpenModal('')}
        >
          <div className='queue-modal reservation-modal history-modal' onClick={(event) => event.stopPropagation()}>
            <header>
              <h3>All Queue Joins</h3>
              <button type='button' onClick={() => setOpenModal('')}>Close</button>
            </header>
            <div className='reservations-list history-modal-list'>
              {queueHistory.map(renderQueueCard)}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
