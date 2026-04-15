import { getStationTimeZone } from "../auth/authSession"

export const DEFAULT_APP_TIME_ZONE = import.meta.env.VITE_APP_TIME_ZONE || "Africa/Blantyre"
export const APP_TIME_OPTIONS = Object.freeze({
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})
export const APP_DATE_TIME_OPTIONS = Object.freeze({
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export function getAppTimeZone() {
  return getStationTimeZone() || DEFAULT_APP_TIME_ZONE
}

function getTimeZoneOffsetMs(date, timeZone = getAppTimeZone()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })

  const parts = formatter.formatToParts(date)
  const values = {}
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value)
    }
  }

  const asUtcMs = Date.UTC(
    values.year || 0,
    (values.month || 1) - 1,
    values.day || 1,
    values.hour || 0,
    values.minute || 0,
    values.second || 0
  )

  return asUtcMs - date.getTime()
}

export function zonedDateTimeToUtcMs(datePart, timePart = "00:00:00", timeZone = getAppTimeZone()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(datePart || ""))) return NaN
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(String(timePart || ""))) return NaN

  const [year, month, day] = String(datePart).split("-").map(Number)
  const normalizedTime = String(timePart).length === 5 ? `${timePart}:00` : String(timePart)
  const [hour, minute, second] = normalizedTime.split(":").map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offsetMs = getTimeZoneOffsetMs(new Date(utcGuess), timeZone)
  return utcGuess - offsetMs
}

export function zonedLocalDateTimeStringToUtcIso(value, timeZone = getAppTimeZone()) {
  const text = String(value || "").trim()
  if (!text) return null

  const match = text.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/
  )
  if (!match) return null

  const [, datePart, hhmm, seconds = "00"] = match
  const utcMs = zonedDateTimeToUtcMs(datePart, `${hhmm}:${seconds}`, timeZone)
  if (!Number.isFinite(utcMs)) return null
  return new Date(utcMs).toISOString()
}

function parseFloatingSqlDateTime(value) {
  if (typeof value !== "string") return null
  const raw = value.trim()
  if (!raw) return null

  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/
  )
  if (!match) return null

  const [, year, month, day, hour, minute, second = "00", millisecond = "0"] = match
  return {
    raw,
    date: new Date(
      Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        Number(millisecond.padEnd(3, "0"))
      )
    ),
  }
}

function toDate(value) {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  let normalized = value
  if (typeof value === "string") {
    const raw = value.trim()
    if (!raw) return null

    const looksLikeDateTime = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(raw)
    if (looksLikeDateTime) {
      const withIsoSeparator = raw.includes("T") ? raw : raw.replace(" ", "T")
      const hasTimezone = /[zZ]$|[-+]\d{2}:\d{2}$/.test(withIsoSeparator)
      normalized = hasTimezone ? withIsoSeparator : `${withIsoSeparator}Z`
    } else {
      normalized = raw
    }
  }

  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function withTimeZone(options = {}) {
  return {
    ...options,
    timeZone: getAppTimeZone(),
  }
}

function formatFloatingSqlDateTime(value, options, fallback) {
  const parsed = parseFloatingSqlDateTime(value)
  if (!parsed?.date) return null

  try {
    return parsed.date.toLocaleString(undefined, {
      ...options,
      timeZone: "UTC",
    })
  } catch {
    return fallback
  }
}

function formatIsoDay(value) {
  const date = toDate(value)
  if (!date) return null

  try {
    return new Intl.DateTimeFormat(
      "en-CA",
      withTimeZone({
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    ).format(date)
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_APP_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date)
  }
}

export function formatDateTime(value, options = APP_DATE_TIME_OPTIONS, fallback = "-") {
  const floatingFormatted = formatFloatingSqlDateTime(value, options, fallback)
  if (floatingFormatted) return floatingFormatted
  const date = toDate(value)
  if (!date) return fallback
  return date.toLocaleString(undefined, withTimeZone(options))
}

export function formatTime(value, options = APP_TIME_OPTIONS, fallback = "-") {
  const floatingFormatted = formatFloatingSqlDateTime(value, options, fallback)
  if (floatingFormatted) return floatingFormatted
  const date = toDate(value)
  if (!date) return fallback
  return date.toLocaleTimeString(undefined, withTimeZone(options))
}

export function formatDate(value, options = {}, fallback = "-") {
  const floatingFormatted = formatFloatingSqlDateTime(value, options, fallback)
  if (floatingFormatted) return floatingFormatted
  const date = toDate(value)
  if (!date) return fallback
  return date.toLocaleDateString([], withTimeZone(options))
}

export function utcTodayISO() {
  return formatIsoDay(new Date())
}

export function shiftUtcISODate(isoDate, diffDays) {
  const base = toDate(`${isoDate}T00:00:00.000Z`)
  if (!base) return utcTodayISO()
  base.setUTCDate(base.getUTCDate() + Number(diffDays || 0))
  return formatIsoDay(base) || utcTodayISO()
}
