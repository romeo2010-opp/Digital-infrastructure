import { HttpError } from "../utils/http.js"

const weakPrefixWords = new Set(["of", "the", "and", "for", "a", "an"])
const studentTypes = new Set(["new", "returning", "transfer"])
const feeCategories = new Set(["standard", "bursary", "scholarship", "staff_child"])
const paymentPlans = new Set(["monthly", "termly", "annual"])

export function generateSchoolPrefixFromName(name = "") {
  const words = String(name || "")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !weakPrefixWords.has(word.toLowerCase()))

  const prefix = words.map((word) => word[0]).join("").toUpperCase()
  return prefix || "SCH"
}

export function normalizeEnum(value, fallback = "") {
  return String(value || fallback).trim().toLowerCase().replace(/\s+/g, "_")
}

export function validateDiscount(discountPercent, discountReason) {
  const discount = Number(discountPercent || 0)
  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    throw new HttpError(400, "Discount must be a number between 0 and 100")
  }
  if (discount > 0 && !String(discountReason || "").trim()) {
    throw new HttpError(400, "Discount reason is required when discount is greater than 0")
  }
  return discount
}

export function validateStudentSetupPayload(payload = {}) {
  const firstName = String(payload.first_name || payload.firstName || "").trim()
  const lastName = String(payload.last_name || payload.lastName || "").trim()
  const dateOfBirth = String(payload.date_of_birth || payload.dateOfBirth || "").trim()
  const gender = String(payload.gender || "").trim()
  const classId = Number(payload.class_id || payload.classId || 0)
  const enrollmentDate = String(payload.enrollment_date || payload.enrollmentDate || "").trim()
  const studentType = normalizeEnum(payload.student_type || payload.studentType, "new")
  const previousSchool = String(payload.previous_school || payload.previousSchool || "").trim()
  const guardian1 = payload.guardian1 || payload.guardian_1 || {}
  const guardian2 = payload.guardian2 || payload.guardian_2 || null
  const feeProfile = payload.fee_profile || payload.feeProfile || {}
  const feeCategory = normalizeEnum(feeProfile.fee_category || feeProfile.feeCategory, "standard")
  const paymentPlan = normalizeEnum(feeProfile.payment_plan || feeProfile.paymentPlan, "termly")
  const discountPercent = validateDiscount(feeProfile.discount_percent ?? feeProfile.discountPercent ?? 0, feeProfile.discount_reason || feeProfile.discountReason)

  if (!firstName) throw new HttpError(400, "First name is required")
  if (!lastName) throw new HttpError(400, "Last name is required")
  if (!dateOfBirth) throw new HttpError(400, "Date of birth is required")
  if (!gender) throw new HttpError(400, "Gender is required")
  if (!classId) throw new HttpError(400, "Class / Grade is required")
  if (!enrollmentDate) throw new HttpError(400, "Enrollment date is required")
  if (!studentTypes.has(studentType)) throw new HttpError(400, "Student type must be New, Returning, or Transfer")
  if (studentType === "transfer" && !previousSchool) throw new HttpError(400, "Previous school is required for transfer students")
  if (!String(guardian1.full_name || guardian1.fullName || "").trim()) throw new HttpError(400, "Guardian 1 name is required")
  if (!String(guardian1.relationship || "").trim()) throw new HttpError(400, "Guardian 1 relationship is required")
  if (!String(guardian1.primary_phone || guardian1.primaryPhone || "").trim()) throw new HttpError(400, "Guardian 1 primary phone is required")
  if (!feeCategories.has(feeCategory)) throw new HttpError(400, "Fee category is invalid")
  if (!paymentPlans.has(paymentPlan)) throw new HttpError(400, "Payment plan is invalid")

  return {
    firstName,
    lastName,
    dateOfBirth,
    gender,
    nationalId: String(payload.national_id || payload.nationalId || "").trim() || null,
    profilePhotoUrl: String(payload.profile_photo_url || payload.profilePhotoUrl || "").trim() || null,
    classId,
    streamSection: String(payload.stream_section || payload.streamSection || "").trim() || null,
    enrollmentDate,
    studentType,
    previousSchool: previousSchool || null,
    guardian1: normalizeGuardian(guardian1, 1),
    guardian2: guardian2 && String(guardian2.full_name || guardian2.fullName || "").trim() ? normalizeGuardian(guardian2, 2) : null,
    feeProfile: {
      feeCategory,
      paymentPlan,
      discountPercent,
      discountReason: String(feeProfile.discount_reason || feeProfile.discountReason || "").trim() || null,
    },
  }
}

function normalizeGuardian(guardian, guardianNumber) {
  return {
    guardianNumber,
    fullName: String(guardian.full_name || guardian.fullName || "").trim(),
    relationship: String(guardian.relationship || "").trim(),
    primaryPhone: String(guardian.primary_phone || guardian.primaryPhone || "").trim() || null,
    secondaryPhone: String(guardian.secondary_phone || guardian.secondaryPhone || "").trim() || null,
    email: String(guardian.email || "").trim() || null,
    nationalId: String(guardian.national_id || guardian.nationalId || "").trim() || null,
  }
}

export async function ensureSchoolPrefix(connection, schoolId) {
  const [[school]] = await connection.query("SELECT id, name, school_prefix FROM schools WHERE id = ? FOR UPDATE", [schoolId])
  if (!school) throw new HttpError(404, "School was not found")
  if (school.school_prefix) return school.school_prefix

  const basePrefix = generateSchoolPrefixFromName(school.name).slice(0, 12)
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const candidate = suffix ? `${basePrefix}${suffix}` : basePrefix
    const [rows] = await connection.query("SELECT id FROM schools WHERE school_prefix = ? AND id <> ? LIMIT 1", [candidate, schoolId])
    if (rows.length) continue
    await connection.query("UPDATE schools SET school_prefix = ? WHERE id = ?", [candidate, schoolId])
    return candidate
  }

  throw new HttpError(500, "Unable to generate a unique school prefix")
}

export async function generateStudentId(connection, schoolId, enrollmentDate = new Date()) {
  const prefix = await ensureSchoolPrefix(connection, schoolId)
  const date = enrollmentDate ? new Date(enrollmentDate) : new Date()
  const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear()

  await connection.query(
    `INSERT INTO school_student_sequences (school_id, sequence_year, last_sequence)
     VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_sequence = LAST_INSERT_ID(last_sequence + 1)`,
    [schoolId, year],
  )
  const [[sequenceRow]] = await connection.query("SELECT LAST_INSERT_ID() AS sequence_value")
  const sequence = Number(sequenceRow?.sequence_value || 1)
  return `${prefix}-${year}-${String(sequence).padStart(5, "0")}`
}
