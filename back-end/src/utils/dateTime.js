const DEFAULT_APP_TIME_ZONE = "Africa/Blantyre"

export function getAppTimeZone() {
  const configured = String(process.env.APP_TIME_ZONE || "").trim()
  return configured || DEFAULT_APP_TIME_ZONE
}

function getDateTimeParts(value = Date.now(), timeZone = getAppTimeZone()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null

  try {
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
    const read = (type) => parts.find((part) => part.type === type)?.value || null
    const year = read("year")
    const month = read("month")
    const day = read("day")
    const hour = read("hour")
    const minute = read("minute")
    const second = read("second")
    if (!year || !month || !day || !hour || !minute || !second) return null
    return { year, month, day, hour, minute, second, milliseconds: String(date.getMilliseconds()).padStart(3, "0") }
  } catch {
    if (timeZone === DEFAULT_APP_TIME_ZONE) return null
    return getDateTimeParts(date, DEFAULT_APP_TIME_ZONE)
  }
}

export function formatDateISOInTimeZone(value = Date.now(), timeZone = getAppTimeZone()) {
  const parts = getDateTimeParts(value, timeZone)
  if (!parts) return null
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function formatDateTimeSqlInTimeZone(value = Date.now(), timeZone = getAppTimeZone()) {
  const parts = getDateTimeParts(value, timeZone)
  if (!parts) return null
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}.${parts.milliseconds}`
}

export function appTodayISO() {
  return formatDateISOInTimeZone(new Date(), getAppTimeZone())
}

function normalizeDatePart(value) {
  const date = String(value || "").trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null
}

function normalizeTimePart(value, fallback = "00:00:00") {
  const time = String(value || "").trim()
  return /^\d{2}:\d{2}:\d{2}$/.test(time) ? time : fallback
}

export function toUtcMysqlDateTime(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 19).replace("T", " ")
}

export function getTimeZoneOffsetMs(date, timeZone = getAppTimeZone()) {
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
  const normalizedDate = normalizeDatePart(datePart)
  const normalizedTime = normalizeTimePart(timePart)
  if (!normalizedDate) return NaN

  const [year, month, day] = normalizedDate.split("-").map((chunk) => Number(chunk))
  const [hour, minute, second] = normalizedTime.split(":").map((chunk) => Number(chunk))
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const offsetMs = getTimeZoneOffsetMs(new Date(utcGuess), timeZone)
  return utcGuess - offsetMs
}

export function zonedSqlDateTimeToUtcIso(value, timeZone = getAppTimeZone()) {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }

  const text = String(value).trim()
  if (!text) return null

  const match = text.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/
  )
  if (!match) {
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }

  const [, datePart, timePart, msPart = "0"] = match
  const utcMs = zonedDateTimeToUtcMs(datePart, timePart, timeZone)
  if (!Number.isFinite(utcMs)) return null
  const ms = Number(msPart.padEnd(3, "0"))
  return new Date(utcMs + ms).toISOString()
}

export function utcIsoToZonedSqlDateTime(value, timeZone = getAppTimeZone()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return formatDateTimeSqlInTimeZone(date, timeZone)
}
