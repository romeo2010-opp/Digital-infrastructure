import { Prisma } from "@prisma/client"
import { prisma } from "../../db/prisma.js"
import { notFound } from "../../utils/http.js"
import { publishStationChange } from "../../realtime/stationChangesHub.js"
import { formatDateTimeSqlInTimeZone, getAppTimeZone } from "../../utils/dateTime.js"

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const STATION_CITY_CODE_MAP = Object.freeze({
  BLANTYRE: "BLNT",
  LILONGWE: "LLWE",
  MZUZU: "MZZU",
  ZOMBA: "ZMBA",
  KASUNGU: "KSGU",
  LUSAKA: "LSKA",
})
const TRANSACTION_TYPE_CODES = new Set(["PAY", "TOP", "REF", "RES", "SUB", "SET", "ADJ"])
const RESERVATION_TYPE_CODES = new Set(["QUE", "SLT", "PRE", "FLT"])
const SUPPORT_CASE_TYPE_CODES = new Set(["DRV", "STN", "PAY", "RSV", "ACC", "HRD", "FRD", "OPS"])
const SUPPORT_CASE_LETTER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const WALLET_PUBLIC_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function createPublicId() {
  let result = ""
  for (let index = 0; index < 26; index += 1) {
    result += ULID_ALPHABET[Math.floor(Math.random() * ULID_ALPHABET.length)]
  }
  return result
}

function randomWalletPublicIdSuffix() {
  let result = ""
  for (let index = 0; index < 8; index += 1) {
    result += WALLET_PUBLIC_ID_ALPHABET[Math.floor(Math.random() * WALLET_PUBLIC_ID_ALPHABET.length)]
  }
  return result
}

export function createWalletPublicIdValue({ randomSuffix = randomWalletPublicIdSuffix() } = {}) {
  const normalized = String(randomSuffix || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[01OI]/g, "")
    .slice(0, 8)
    .padEnd(8, "A")

  return `SLW-${normalized.slice(0, 4)}-${normalized.slice(4, 8)}`
}

function randomSupportCaseLetters() {
  let result = ""
  for (let index = 0; index < 4; index += 1) {
    result += SUPPORT_CASE_LETTER_ALPHABET[Math.floor(Math.random() * SUPPORT_CASE_LETTER_ALPHABET.length)]
  }
  return result
}

function randomSupportCaseDigits() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0")
}

function randomStationDigits() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, "0")
}

export function resolveStationCityCode(city) {
  const normalized = String(city || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")

  if (STATION_CITY_CODE_MAP[normalized]) {
    return STATION_CITY_CODE_MAP[normalized]
  }

  return (normalized || "CITY").slice(0, 4).padEnd(4, "X")
}

export function createStationPublicIdValue({ countryCode, city, randomDigits = randomStationDigits() }) {
  const normalizedCountryCode = String(countryCode || "MW")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2)
    .padEnd(2, "X")

  const cityCode = resolveStationCityCode(city)
  const suffix = String(randomDigits).replace(/\D/g, "").slice(0, 4).padStart(4, "0")
  return `SL-${normalizedCountryCode}-${cityCode}-${suffix}`
}

function formatTimestampCompact(date, timeZone = getAppTimeZone()) {
  const sqlDateTime = formatDateTimeSqlInTimeZone(date, timeZone)
  if (sqlDateTime) {
    return sqlDateTime.replace(/[-:\s.]/g, "")
  }

  const value = date instanceof Date ? date : new Date(date)
  const pad = (input, size = 2) => String(input).padStart(size, "0")
  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
    pad(value.getHours()),
    pad(value.getMinutes()),
    pad(value.getSeconds()),
    pad(value.getMilliseconds(), 3),
  ].join("")
}

function randomTransactionSuffix() {
  return randomAlphaNumericSuffix()
}

function randomAlphaNumericSuffix() {
  let result = ""
  for (let index = 0; index < 6; index += 1) {
    result += ULID_ALPHABET[Math.floor(Math.random() * ULID_ALPHABET.length)]
  }
  if (!/[A-Z]/.test(result)) {
    result = `A${result.slice(1)}`
  }
  return result
}

function formatTimestampCompactSeconds(date, timeZone = getAppTimeZone()) {
  const sqlDateTime = formatDateTimeSqlInTimeZone(date, timeZone)
  if (sqlDateTime) {
    return sqlDateTime.slice(0, 19).replace(/[-:\s]/g, "")
  }

  const value = date instanceof Date ? date : new Date(date)
  const pad = (input, size = 2) => String(input).padStart(size, "0")
  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
    pad(value.getHours()),
    pad(value.getMinutes()),
    pad(value.getSeconds()),
  ].join("")
}

export function createTransactionPublicIdValue({
  typeCode,
  timestamp = new Date(),
  randomSuffix = randomTransactionSuffix(),
}) {
  const normalizedTypeCode = String(typeCode || "")
    .trim()
    .toUpperCase()

  if (!TRANSACTION_TYPE_CODES.has(normalizedTypeCode)) {
    throw new Error(`Unsupported transaction type code: ${normalizedTypeCode || "UNKNOWN"}`)
  }

  const normalizedRandomSuffix = String(randomSuffix || "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 6)
    .padEnd(6, "0")
  return `TXN-${normalizedTypeCode}-${formatTimestampCompact(timestamp)}-${normalizedRandomSuffix}`
}

export function createReservationPublicIdValue({
  typeCode,
  timestamp = new Date(),
  timeZone = getAppTimeZone(),
  randomSuffix = randomAlphaNumericSuffix(),
}) {
  const normalizedTypeCode = String(typeCode || "")
    .trim()
    .toUpperCase()

  if (!RESERVATION_TYPE_CODES.has(normalizedTypeCode)) {
    throw new Error(`Unsupported reservation type code: ${normalizedTypeCode || "UNKNOWN"}`)
  }

  const normalizedRandomSuffix = String(randomSuffix || "")
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, 6)
    .padEnd(6, "0")

  return `RSV-${normalizedTypeCode}-${formatTimestampCompactSeconds(timestamp, timeZone)}-${normalizedRandomSuffix}`
}

export function createSupportCasePublicIdValue({
  typeCode,
  letters = randomSupportCaseLetters(),
  digits = randomSupportCaseDigits(),
}) {
  const normalizedTypeCode = String(typeCode || "")
    .trim()
    .toUpperCase()

  if (!SUPPORT_CASE_TYPE_CODES.has(normalizedTypeCode)) {
    throw new Error(`Unsupported support case type code: ${normalizedTypeCode || "UNKNOWN"}`)
  }

  const normalizedLetters = String(letters || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 4)
    .padEnd(4, "A")
  const normalizedDigits = String(digits || "")
    .replace(/\D/g, "")
    .slice(0, 4)
    .padStart(4, "0")

  return `CAS-${normalizedTypeCode}-${normalizedLetters}-${normalizedDigits}`
}

export async function createSupportCasePublicId({ typeCode }) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const publicId = createSupportCasePublicIdValue({ typeCode })
    const rows = await prisma.$queryRaw`
      SELECT id
      FROM internal_support_cases
      WHERE public_id = ${publicId}
      LIMIT 1
    `
    if (!rows?.[0]?.id) {
      return publicId
    }
  }

  throw new Error("Unable to generate unique support case public id")
}

export async function createStationPublicId({ countryCode, city }) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const publicId = createStationPublicIdValue({ countryCode, city })
    const rows = await prisma.$queryRaw`
      SELECT id
      FROM stations
      WHERE public_id = ${publicId}
      LIMIT 1
    `
    if (!rows?.[0]?.id) {
      return publicId
    }
  }

  throw new Error("Unable to generate unique station public id")
}

export async function resolveStationOrThrow(stationPublicId) {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, name
    FROM stations
    WHERE public_id = ${stationPublicId}
      AND deleted_at IS NULL
    LIMIT 1
  `

  const station = rows?.[0]
  if (!station) {
    throw notFound(`Station not found: ${stationPublicId}`)
  }

  return station
}

export async function writeAuditLog({ stationId, actionType, payload, actorStaffId = null }) {
  await prisma.$executeRaw`
    INSERT INTO audit_log (station_id, actor_staff_id, action_type, payload)
    VALUES (${stationId}, ${actorStaffId}, ${actionType}, ${JSON.stringify(payload || {})})
  `
  publishStationChange({
    stationId,
    actionType,
    payload: payload || {},
  })
}

export function sqlJoinEquals(alias, column, value, currentSql) {
  if (!value) return currentSql
  return Prisma.sql`${currentSql} AND ${Prisma.raw(alias)}.${Prisma.raw(column)} = ${value}`
}
