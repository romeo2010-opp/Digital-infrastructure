import bcrypt from "bcryptjs"
import crypto from "crypto"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"

const allowedStatuses = new Set(["DRAFT", "SUBMITTED"])

function cleanText(value, maxLength = 255) {
  const text = String(value || "").trim()
  return text ? text.slice(0, maxLength) : null
}

function cleanPayload(payload) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}
  const copy = { ...source }
  delete copy.managerPassword
  delete copy.confirmPassword
  return copy
}

function normalizeStatus(value) {
  const status = String(value || "DRAFT").toUpperCase()
  return allowedStatuses.has(status) ? status : "DRAFT"
}

function normalizeDraftKey(value) {
  const key = cleanText(value, 80)
  return key && /^[a-zA-Z0-9_-]{12,80}$/.test(key) ? key : crypto.randomUUID()
}

function validateSubmittedDraft({ payload, managerPassword, existingPasswordHash }) {
  if (!cleanText(payload.schoolName, 180)) throw new HttpError(400, "School name is required before submitting setup")
  if (!cleanText(payload.location, 180)) throw new HttpError(400, "School location is required before submitting setup")
  if (!cleanText(payload.managerName, 160)) throw new HttpError(400, "Manager name is required before submitting setup")
  if (!cleanText(payload.managerEmail, 190)) throw new HttpError(400, "Manager email is required before submitting setup")
  if (!managerPassword && !existingPasswordHash) throw new HttpError(400, "Set a manager password before submitting setup")
  if (managerPassword && managerPassword.length < 8) throw new HttpError(400, "Manager password must be at least 8 characters")
}

function splitFullName(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean)
  return {
    firstName: parts[0] || null,
    lastName: parts.slice(1).join(" ") || null,
  }
}

function schoolCodeBase(name) {
  const base = String(name || "school")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28)
  return base || `SCHOOL-${crypto.randomBytes(3).toString("hex").toUpperCase()}`
}

async function nextSchoolCode(connection, name) {
  const base = schoolCodeBase(name)
  for (let index = 0; index < 30; index += 1) {
    const code = index === 0 ? base : `${base}-${index + 1}`
    const [[existing]] = await connection.query("SELECT id FROM schools WHERE code = ? LIMIT 1", [code])
    if (!existing) return code
  }
  return `${base}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`
}

async function provisionSubmittedWorkspace({ existing, payload, passwordHash }) {
  const connection = await pool.getConnection()
  const schoolName = cleanText(payload.schoolName, 160)
  const managerName = cleanText(payload.managerName, 160)
  const managerEmail = cleanText(payload.managerEmail, 180)
  const location = cleanText(payload.location, 120)
  const phone = cleanText(payload.phone, 40)
  const { firstName, lastName } = splitFullName(managerName)

  try {
    await connection.beginTransaction()

    let schoolId = existing?.school_id ? Number(existing.school_id) : null
    let ownerUserId = existing?.owner_user_id ? Number(existing.owner_user_id) : null

    if (schoolId) {
      await connection.query(
        "UPDATE schools SET name = ?, city = ? WHERE id = ?",
        [schoolName, location, schoolId],
      )
    } else {
      const schoolCode = await nextSchoolCode(connection, schoolName)
      const [schoolResult] = await connection.query(
        "INSERT INTO schools (code, name, city, country, status) VALUES (?, ?, ?, ?, 'active')",
        [schoolCode, schoolName, location, "Malawi"],
      )
      schoolId = Number(schoolResult.insertId)
    }

    if (ownerUserId) {
      await connection.query(
        `UPDATE users
         SET school_id = ?, role = 'school_owner', full_name = ?, first_name = ?, last_name = ?,
             email = ?, password_hash = ?, must_change_password = 0, phone = ?, is_active = 1
         WHERE id = ?`,
        [schoolId, managerName, firstName, lastName, managerEmail, passwordHash, phone, ownerUserId],
      )
    } else {
      const [[duplicateUser]] = await connection.query(
        "SELECT id FROM users WHERE email = ? LIMIT 1",
        [managerEmail],
      )
      if (duplicateUser) throw new HttpError(409, "A portal user already exists with this manager email")

      const [ownerResult] = await connection.query(
        `INSERT INTO users (
           school_id, role, full_name, first_name, last_name, email,
           password_hash, must_change_password, phone, is_active
         ) VALUES (?, 'school_owner', ?, ?, ?, ?, ?, 0, ?, 1)`,
        [schoolId, managerName, firstName, lastName, managerEmail, passwordHash, phone],
      )
      ownerUserId = Number(ownerResult.insertId)
    }

    await connection.commit()
    return { schoolId, ownerUserId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function savePublicSchoolSetupDraft(req, res) {
  const payload = cleanPayload(req.body.payload)
  const draftKey = normalizeDraftKey(req.body.draft_key || req.body.draftKey || payload.draftKey)
  const status = normalizeStatus(req.body.status)
  const managerPassword = String(req.body.manager_password || req.body.managerPassword || "")
  const schoolName = cleanText(payload.schoolName, 180)
  const managerName = cleanText(payload.managerName, 160)
  const managerEmail = cleanText(payload.managerEmail, 190)
  const sourceHost = cleanText(req.get("origin") || req.get("host"), 180)

  const [[existing]] = await pool.query(
    "SELECT id, school_id, owner_user_id, password_hash FROM public_school_setup_drafts WHERE draft_key = ? LIMIT 1",
    [draftKey],
  )

  if (status === "SUBMITTED") {
    validateSubmittedDraft({ payload, managerPassword, existingPasswordHash: existing?.password_hash })
  } else if (managerPassword && managerPassword.length < 8) {
    throw new HttpError(400, "Manager password must be at least 8 characters")
  }

  const passwordHash = managerPassword ? await bcrypt.hash(managerPassword, 10) : null
  const finalPasswordHash = passwordHash || existing?.password_hash || null
  const payloadJson = JSON.stringify(payload)
  const submittedAt = status === "SUBMITTED" ? new Date() : null
  const workspace = status === "SUBMITTED"
    ? await provisionSubmittedWorkspace({ existing, payload, passwordHash: finalPasswordHash })
    : {
      schoolId: existing?.school_id ? Number(existing.school_id) : null,
      ownerUserId: existing?.owner_user_id ? Number(existing.owner_user_id) : null,
    }

  await pool.query(
    `INSERT INTO public_school_setup_drafts (
       school_id, owner_user_id, draft_key, status, school_name, manager_name, manager_email,
       password_hash, payload_json, source_host, submitted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       school_id = COALESCE(VALUES(school_id), school_id),
       owner_user_id = COALESCE(VALUES(owner_user_id), owner_user_id),
       status = VALUES(status),
       school_name = VALUES(school_name),
       manager_name = VALUES(manager_name),
       manager_email = VALUES(manager_email),
       password_hash = COALESCE(VALUES(password_hash), password_hash),
       payload_json = VALUES(payload_json),
       source_host = VALUES(source_host),
       submitted_at = COALESCE(VALUES(submitted_at), submitted_at)`,
    [
      workspace.schoolId,
      workspace.ownerUserId,
      draftKey,
      status,
      schoolName,
      managerName,
      managerEmail,
      passwordHash,
      payloadJson,
      sourceHost,
      submittedAt,
    ],
  )

  const [[draft]] = await pool.query(
    `SELECT id, school_id, owner_user_id, draft_key, status, school_name, manager_email, submitted_at, updated_at
     FROM public_school_setup_drafts
     WHERE draft_key = ?
     LIMIT 1`,
    [draftKey],
  )

  res.json({
    draft: {
      id: Number(draft.id),
      schoolId: draft.school_id ? Number(draft.school_id) : null,
      ownerUserId: draft.owner_user_id ? Number(draft.owner_user_id) : null,
      draftKey: draft.draft_key,
      status: draft.status,
      schoolName: draft.school_name,
      managerEmail: draft.manager_email,
      submittedAt: draft.submitted_at,
      updatedAt: draft.updated_at,
    },
  })
}
