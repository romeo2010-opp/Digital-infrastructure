import { pool } from "../config/db.js"
import { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"

const MESSAGE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim()
}

function parseScope(value) {
  if (!value) return {}
  if (typeof value === "object") return value
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function normalizeScope(payload) {
  const scope = parseScope(payload)
  const type = cleanText(scope.type || scope.scope || "school").toLowerCase()
  const classIds = Array.isArray(scope.class_ids || scope.classIds)
    ? (scope.class_ids || scope.classIds).map((value) => Number(value || 0)).filter(Boolean)
    : [Number(scope.class_id || scope.classId || 0)].filter(Boolean)
  return {
    ...scope,
    type: type === "classes" || type === "class" || classIds.length ? "classes" : "school",
    class_ids: classIds,
    image_url: cleanText(scope.image_url || scope.imageUrl) || null,
    responsible_teacher_id: Number(scope.responsible_teacher_id || scope.responsibleTeacherId || 0) || null,
    responsible_teacher_name: cleanText(scope.responsible_teacher_name || scope.responsibleTeacherName) || null,
    poll: scope.poll && cleanText(scope.poll.question)
      ? {
        question: cleanText(scope.poll.question),
        options: (Array.isArray(scope.poll.options) ? scope.poll.options : [])
          .map((option, index) => ({
            id: cleanText(option?.id) || `option-${index + 1}`,
            text: cleanText(option?.text || option),
          }))
          .filter((option) => option.text)
          .slice(0, 6),
      }
      : null,
    reactions: Array.isArray(scope.reactions) && scope.reactions.length ? scope.reactions.slice(0, 6) : ["Like", "Love", "Seen"],
  }
}

export async function listMessages(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [rows] = await pool.query(
    `SELECT m.id, m.message_type, m.subject, m.body, m.recipient_scope, m.channel, m.delivery_status, m.created_at,
      creator.full_name AS created_by_name
     FROM messages m
     LEFT JOIN users creator ON creator.id = m.created_by AND creator.school_id = m.school_id
     WHERE m.school_id = ?
     ORDER BY m.created_at DESC
     LIMIT 100`,
    [schoolId],
  )
  res.json({
    messages: rows.map((row) => {
      const scope = normalizeScope(row.recipient_scope)
      return {
        ...row,
        recipient_scope: scope,
        audience_label: scope.type === "school" ? "Whole school" : `${scope.class_ids.length} class${scope.class_ids.length === 1 ? "" : "es"}`,
      }
    }),
  })
}

export async function createMessage(req, res) {
  const schoolId = getScopedSchoolId(req)
  const { message_type, subject, body, recipient_scope, channel } = req.body
  if (!message_type || !subject || !body || !recipient_scope) {
    throw new HttpError(400, "message_type, subject, body, and recipient_scope are required")
  }

  const scope = normalizeScope(recipient_scope)
  if (scope.type === "classes" && !scope.class_ids.length) throw new HttpError(400, "Select at least one class or choose whole school")

  if (scope.class_ids.length) {
    const [classes] = await pool.query(
      `SELECT id FROM classes WHERE school_id = ? AND id IN (${scope.class_ids.map(() => "?").join(", ")})`,
      [schoolId, ...scope.class_ids],
    )
    if (classes.length !== scope.class_ids.length) throw new HttpError(400, "One or more selected classes do not belong to this school")
  }

  if (scope.responsible_teacher_id) {
    const [[teacher]] = await pool.query(
      "SELECT id, full_name FROM users WHERE id = ? AND school_id = ? AND role IN ('teacher', 'headteacher') AND is_active = 1 LIMIT 1",
      [scope.responsible_teacher_id, schoolId],
    )
    if (!teacher) throw new HttpError(400, "Responsible teacher must be an active teacher from this school")
    scope.responsible_teacher_name = teacher.full_name
  }

  const [result] = await pool.query(
    `INSERT INTO messages (school_id, message_type, subject, body, recipient_scope, channel, delivery_status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [schoolId, message_type, subject, body, JSON.stringify(scope), channel || "in_app", req.user.id],
  )
  res.status(201).json({ id: result.insertId, deliveryStatus: "pending" })
}

export async function uploadMessageImage(req, res) {
  const schoolId = getScopedSchoolId(req)
  const fileName = cleanText(req.body.file_name || req.body.fileName || "announcement-image")
  const fileType = cleanText(req.body.file_type || req.body.fileType)
  const dataUrl = cleanText(req.body.data_url || req.body.dataUrl)

  if (!MESSAGE_IMAGE_TYPES.has(fileType)) throw new HttpError(400, "Only PNG, JPEG, and WebP announcement images are supported")
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) throw new HttpError(400, "Announcement image payload is invalid")
  if (match[1] !== fileType) throw new HttpError(400, "Announcement image type does not match the upload payload")

  const buffer = Buffer.from(match[2], "base64")
  if (!buffer.length) throw new HttpError(400, "Announcement image is empty")
  if (buffer.length > 5 * 1024 * 1024) throw new HttpError(400, "Announcement image must be 5MB or smaller")

  const extensionMap = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }
  const safeName = fileName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "announcement-image"
  const baseName = path.basename(safeName, path.extname(safeName)).slice(0, 60) || "announcement-image"
  const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${baseName}.${extensionMap[fileType] || "img"}`
  const folder = path.resolve(process.cwd(), "uploads", "message-images", String(schoolId))
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, storedName), buffer)

  res.status(201).json({
    image_url: `/uploads/message-images/${schoolId}/${storedName}`,
    file_name: fileName,
    content_type: fileType,
    size: buffer.length,
  })
}
