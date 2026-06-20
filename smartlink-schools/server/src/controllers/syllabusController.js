import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"
import { chunkSyllabusText, extractSyllabusStructure } from "../services/syllabus/syllabusExtractor.js"

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const ALLOWED_TYPES = new Set([
  "text/plain",
  "text/csv",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
])

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim()
}

function parseJson(value, fallback = null) {
  if (!value) return fallback
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return fallback
  }
}

const successCriteriaActionLabels = {
  analyse: "Analyse",
  analyze: "Analyse",
  apply: "Apply",
  calculate: "Calculate",
  compare: "Compare",
  contrast: "Contrast",
  create: "Create",
  define: "Define",
  describe: "Describe",
  evaluate: "Evaluate",
  explain: "Explain",
  identify: "Identify",
  list: "List",
  outline: "Outline",
  state: "State",
}

function humanizeAction(value) {
  return cleanText(value)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function normalizeAction(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
}

function normalizeActions(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s|/]+/)
      : []
  return [...new Set(raw.map(normalizeAction).filter(Boolean))].slice(0, 8)
}

function actionLabel(action) {
  if (!action) return ""
  return successCriteriaActionLabels[action] || humanizeAction(action)
}

function normalizeCriterion(value) {
  if (typeof value === "string") {
    const text = cleanText(value)
    return text ? { action: "", actions: [], label: "", labels: [], detail: text, text } : null
  }
  if (!value || typeof value !== "object") return null
  const actions = normalizeActions(value.actions || value.tags || value.action || value.verb || value.tag || value.skill_type || value.skillType)
  const labels = actions.map(actionLabel).filter(Boolean)
  const fullText = cleanText(value.text || value.objective_text || value.objective || value.title)
  const detail = cleanText(value.detail || value.target || value.value || value.content)
  const text = detail && labels.length ? `${labels.join(", ")} ${detail}` : detail || fullText
  if (!text) return null
  return { action: actions[0] || "", actions, label: labels[0] || "", labels, detail: detail || text, text }
}

function objectiveTextsForCriterion(criterion) {
  if (!criterion) return []
  const actions = normalizeActions(criterion.actions?.length ? criterion.actions : criterion.action)
  const detail = cleanText(criterion.detail)
  if (detail && actions.length) {
    return actions.map((action) => ({
      text: `${actionLabel(action)} ${detail}`,
      skillType: action,
    }))
  }
  const text = cleanText(criterion.text || detail)
  return text ? [{ text, skillType: actions[0] || null }] : []
}

function parseObjectives(value) {
  const parsed = typeof value === "string" ? parseJson(value, null) : null
  if (parsed !== null && parsed !== value) return parseObjectives(parsed)
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n/)
      : parseJson(value, [])
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === "string") return cleanText(item)
      const criterion = normalizeCriterion(item)
      return criterion?.text || cleanText(item?.title || item?.name)
    })
    .filter(Boolean)
    .slice(0, 30)
}

function parseManualSyllabusPayload(value) {
  if (value === undefined || value === null || value === "") return { flat_objectives: [], subtopics: [] }
  if (typeof value === "string") {
    const parsed = parseJson(value, null)
    if (parsed !== null) return parseManualSyllabusPayload(parsed)
    return { flat_objectives: parseObjectives(value), subtopics: [] }
  }
  if (Array.isArray(value)) return { flat_objectives: parseObjectives(value), subtopics: [] }
  if (typeof value !== "object") return { flat_objectives: [], subtopics: [] }

  const flatSource = value.flat_objectives ?? value.flatObjectives ?? value.objectives ?? value.learning_objectives ?? value.learningObjectives ?? []
  const flatObjectives = [
    ...parseObjectives(flatSource),
    ...parseObjectives(value.criteria || value.success_criteria || value.successCriteria || []),
  ].slice(0, 30)

  const subtopicSource = value.subtopics || value.sections || []
  const subtopics = Array.isArray(subtopicSource)
    ? subtopicSource
      .map((subtopic) => {
        const title = cleanText(subtopic?.title || subtopic?.subtopic_name || subtopic?.name)
        const criteriaSource = subtopic?.criteria || subtopic?.success_criteria || subtopic?.successCriteria || subtopic?.objectives || subtopic?.learning_objectives || subtopic?.learningObjectives || []
        const criteria = (Array.isArray(criteriaSource) ? criteriaSource : [criteriaSource])
          .map(normalizeCriterion)
          .filter(Boolean)
          .slice(0, 30)
        const notes = cleanText(subtopic?.notes || subtopic?.description) || null
        if (!title && !notes && !criteria.length) return null
        return {
          title,
          notes,
          criteria,
        }
      })
      .filter(Boolean)
      .slice(0, 40)
    : []

  return { flat_objectives: flatObjectives, subtopics }
}

function manualSyllabusPayloadFromBody(body, fallback) {
  for (const key of ["syllabus_map", "syllabusMap", "objectives", "objectives_json", "objectivesJson"]) {
    if (Object.prototype.hasOwnProperty.call(body, key)) return body[key]
  }
  return fallback
}

function manualEntryStatusFromBody(body, fallback = "pending_review") {
  const status = cleanText(body.status || body.entry_status || body.entryStatus)
  if (status === "draft" || status === "pending_review") return status
  return fallback
}

function normalizeManualEntry(row) {
  const syllabusMap = parseManualSyllabusPayload(row.objectives_json)
  return {
    ...row,
    objectives_json: syllabusMap.flat_objectives,
    syllabus_map: syllabusMap,
    success_criteria_count: syllabusMap.subtopics.reduce((total, subtopic) => total + subtopic.criteria.length, 0),
    success_criteria_tag_count: syllabusMap.subtopics.reduce((total, subtopic) => total + subtopic.criteria.reduce((criteriaTotal, criterion) => criteriaTotal + Math.max(criterion.actions?.length || 0, 1), 0), 0),
  }
}

function safeFilename(fileName) {
  return cleanText(fileName, "syllabus-upload").replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 100) || "syllabus-upload"
}

function canReviewManualSyllabus(req) {
  return ["super_admin", "school_owner", "headteacher"].includes(String(req.user?.role || ""))
}

async function resolveManualReferences(connection, schoolId, body, current = {}) {
  const subjectId = Number(body.subject_id ?? current.subject_id ?? 0)
  if (!subjectId) throw new HttpError(400, "Subject is required")
  const [[subject]] = await connection.query("SELECT id FROM subjects WHERE id = ? AND school_id = ? LIMIT 1", [subjectId, schoolId])
  if (!subject) throw new HttpError(400, "Subject does not belong to this school")

  let curriculumId = body.curriculum_id === undefined ? current.curriculum_id || null : Number(body.curriculum_id || 0) || null
  if (!curriculumId) {
    const [[activeCurriculum]] = await connection.query("SELECT id FROM curricula WHERE school_id = ? AND is_active = 1 ORDER BY id LIMIT 1", [schoolId])
    curriculumId = activeCurriculum?.id || null
  } else {
    const [[curriculum]] = await connection.query("SELECT id FROM curricula WHERE id = ? AND school_id = ? LIMIT 1", [curriculumId, schoolId])
    if (!curriculum) throw new HttpError(400, "Curriculum does not belong to this school")
  }

  const gradeId = body.grade_id === undefined ? current.grade_id || null : Number(body.grade_id || 0) || null
  if (gradeId) {
    const [[grade]] = await connection.query("SELECT id FROM grade_levels WHERE id = ? AND school_id = ? LIMIT 1", [gradeId, schoolId])
    if (!grade) throw new HttpError(400, "Year level does not belong to this school")
  }

  return { subjectId, curriculumId, gradeId }
}

function decodeUploadPayload(body) {
  const fileType = cleanText(body.file_type || body.fileType || body.mime_type || body.mimeType || "text/plain")
  if (!ALLOWED_TYPES.has(fileType)) throw new HttpError(400, "Unsupported syllabus file type")
  const dataUrl = cleanText(body.data_url || body.dataUrl)
  const textContent = body.text_content ?? body.textContent
  if (dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) throw new HttpError(400, "Syllabus upload payload is invalid")
    if (match[1] !== fileType) throw new HttpError(400, "Syllabus file type does not match the upload payload")
    const buffer = Buffer.from(match[2], "base64")
    if (!buffer.length) throw new HttpError(400, "Syllabus file is empty")
    if (buffer.length > MAX_UPLOAD_BYTES) throw new HttpError(400, "Syllabus file must be 12MB or smaller")
    return buffer
  }
  if (textContent !== undefined && textContent !== null) {
    const buffer = Buffer.from(String(textContent), "utf8")
    if (!buffer.length) throw new HttpError(400, "Syllabus text is empty")
    if (buffer.length > MAX_UPLOAD_BYTES) throw new HttpError(400, "Syllabus text must be 12MB or smaller")
    return buffer
  }
  throw new HttpError(400, "Provide a data_url or text_content for the syllabus upload")
}

function extractText(buffer, mimeType) {
  if (mimeType === "text/plain" || mimeType === "text/csv") return buffer.toString("utf8")
  const roughText = buffer.toString("utf8").replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ")
  const readable = roughText.split(/\s+/).filter((word) => /[A-Za-z]{3}/.test(word)).join(" ")
  return readable.length > 200 ? readable.slice(0, 100000) : ""
}

async function saveExtractedItems(connection, schoolId, uploadId, extraction) {
  await connection.query("DELETE FROM syllabus_extracted_items WHERE school_id = ? AND upload_id = ?", [schoolId, uploadId])
  let total = 0
  for (const topic of extraction.topics || []) {
    const [topicResult] = await connection.query(
      `INSERT INTO syllabus_extracted_items (
        upload_id, school_id, item_type, title, description, term, confidence, raw_json, status
      ) VALUES (?, ?, 'topic', ?, ?, ?, ?, ?, 'pending_review')`,
      [uploadId, schoolId, topic.topic_name, topic.description || null, extraction.term || null, topic.confidence || 0, JSON.stringify(topic)],
    )
    total += 1
    const topicItemId = Number(topicResult.insertId)
    for (const subtopic of topic.subtopics || []) {
      const [subtopicResult] = await connection.query(
        `INSERT INTO syllabus_extracted_items (
          upload_id, school_id, item_type, parent_extracted_item_id, title, term, suggested_week,
          exam_relevance, keywords_json, confidence, raw_json, status
        ) VALUES (?, ?, 'subtopic', ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review')`,
        [
          uploadId,
          schoolId,
          topicItemId,
          subtopic.subtopic_name,
          extraction.term || null,
          subtopic.suggested_week || null,
          subtopic.exam_relevance || null,
          JSON.stringify(subtopic.keywords || []),
          subtopic.confidence || 0,
          JSON.stringify(subtopic),
        ],
      )
      total += 1
      const subtopicItemId = Number(subtopicResult.insertId)
      for (const objective of subtopic.learning_objectives || []) {
        await connection.query(
          `INSERT INTO syllabus_extracted_items (
            upload_id, school_id, item_type, parent_extracted_item_id, title, exam_relevance,
            confidence, raw_json, status
          ) VALUES (?, ?, 'objective', ?, ?, ?, ?, ?, 'pending_review')`,
          [uploadId, schoolId, subtopicItemId, String(objective), subtopic.exam_relevance || null, subtopic.confidence || 0, JSON.stringify({ objective })],
        )
        total += 1
      }
      for (const skill of subtopic.skills || []) {
        await connection.query(
          `INSERT INTO syllabus_extracted_items (
            upload_id, school_id, item_type, parent_extracted_item_id, title, confidence, raw_json, status
          ) VALUES (?, ?, 'skill', ?, ?, ?, ?, 'pending_review')`,
          [uploadId, schoolId, subtopicItemId, String(skill), subtopic.confidence || 0, JSON.stringify({ skill })],
        )
        total += 1
      }
    }
  }
  return total
}

async function saveDocumentChunks(connection, schoolId, upload, text) {
  const chunks = chunkSyllabusText(text)
  await connection.query("DELETE FROM syllabus_document_chunks WHERE school_id = ? AND upload_id = ?", [schoolId, upload.id])
  for (const [index, chunk] of chunks.entries()) {
    await connection.query(
      `INSERT INTO syllabus_document_chunks (
        school_id, upload_id, subject_id, grade_id, topic_id, chunk_text, chunk_index, source_filename
      ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
      [
        schoolId,
        upload.id,
        upload.subject_id || null,
        upload.grade_id || null,
        chunk,
        index,
        upload.original_filename,
      ],
    )
  }
  return chunks.length
}

async function processUploadRecord(connection, schoolId, uploadId) {
  const [[upload]] = await connection.query("SELECT * FROM syllabus_uploads WHERE id = ? AND school_id = ? LIMIT 1", [uploadId, schoolId])
  if (!upload) throw new HttpError(404, "Syllabus upload was not found")
  await connection.query("UPDATE syllabus_uploads SET processing_status = 'extracting', error_message = NULL WHERE id = ? AND school_id = ?", [uploadId, schoolId])
  const buffer = await fs.readFile(path.resolve(process.cwd(), upload.file_path.replace(/^\/+/, "")))
  const text = extractText(buffer, upload.mime_type)
  const textFolder = path.resolve(process.cwd(), "uploads", "syllabus-text", String(schoolId))
  await fs.mkdir(textFolder, { recursive: true })
  const textName = `${upload.id}-${path.basename(upload.stored_filename, path.extname(upload.stored_filename))}.txt`
  const textPath = path.join(textFolder, textName)
  await fs.writeFile(textPath, text || "", "utf8")
  if (!text.trim()) {
    await connection.query(
      `UPDATE syllabus_uploads
       SET processing_status = 'failed', extracted_text_path = ?, error_message = ?
       WHERE id = ? AND school_id = ?`,
      [`uploads/syllabus-text/${schoolId}/${textName}`, "Text extraction did not find readable text. Upload a TXT/CSV export or paste text_content for review.", uploadId, schoolId],
    )
    return { upload, extracted_items: 0, warning: "Text extraction did not find readable text." }
  }

  const chunkCount = await saveDocumentChunks(connection, schoolId, upload, text)
  const metadata = {
    curriculum: upload.curriculum_id || "",
    level: upload.level_id || "",
    grade: upload.grade_id || "",
    subject: upload.subject_id || "",
    term: upload.term_id || "",
    material_type: upload.material_type,
    schoolId,
    userId: upload.uploaded_by || null,
  }
  const extraction = await extractSyllabusStructure(text, metadata)
  const totalItems = await saveExtractedItems(connection, schoolId, uploadId, extraction.data)
  await connection.query(
    `UPDATE syllabus_uploads
     SET processing_status = 'pending_review',
      extracted_text_path = ?,
      ai_model_used = ?,
      extraction_summary_json = ?,
      error_message = ?
     WHERE id = ? AND school_id = ?`,
    [
      `uploads/syllabus-text/${schoolId}/${textName}`,
      extraction.model || null,
      JSON.stringify({ ...extraction.data, ai_ok: extraction.ok, ai_message: extraction.message || null, chunk_count: chunkCount, raw_ai_response: process.env.AI_LOG_RAW_RESPONSES === "true" ? extraction.raw || "" : undefined }),
      extraction.ok ? null : extraction.message || null,
      uploadId,
      schoolId,
    ],
  )
  return { upload, extracted_items: totalItems, ai: extraction }
}

export async function getSyllabusSetup(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [curricula] = await pool.query("SELECT * FROM curricula WHERE school_id = ? AND is_active = 1 ORDER BY name", [schoolId])
  const [grades] = await pool.query("SELECT * FROM grade_levels WHERE school_id = ? ORDER BY order_number, name", [schoolId])
  const [examTracks] = await pool.query("SELECT * FROM exam_tracks WHERE school_id = ? AND is_active = 1 ORDER BY id", [schoolId])
  const [subjects] = await pool.query("SELECT * FROM subjects WHERE school_id = ? ORDER BY name", [schoolId])
  const [years] = await pool.query("SELECT * FROM academic_years WHERE school_id = ? ORDER BY start_date DESC", [schoolId])
  const [terms] = await pool.query("SELECT * FROM terms WHERE school_id = ? ORDER BY start_date DESC", [schoolId])
  res.json({ curricula, grades, exam_tracks: examTracks, subjects, academic_years: years, terms })
}

export async function createSyllabusUpload(req, res) {
  const schoolId = getScopedSchoolId(req)
  const fileName = safeFilename(req.body.file_name || req.body.fileName || req.body.original_filename || "syllabus.txt")
  const fileType = cleanText(req.body.file_type || req.body.fileType || req.body.mime_type || req.body.mimeType || "text/plain")
  const buffer = decodeUploadPayload({ ...req.body, file_type: fileType })
  const extension = path.extname(fileName) || (fileType === "text/csv" ? ".csv" : ".txt")
  const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${path.basename(fileName, path.extname(fileName)).slice(0, 70)}${extension}`
  const folder = path.resolve(process.cwd(), "uploads", "syllabus", String(schoolId))
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, storedName), buffer)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.query(
      `INSERT INTO syllabus_uploads (
        school_id, uploaded_by, curriculum_id, grade_id, subject_id, academic_year_id, term_id,
        material_type, original_filename, stored_filename, file_path, mime_type, file_size, processing_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')`,
      [
        schoolId,
        req.user.id,
        req.body.curriculum_id || null,
        req.body.grade_id || null,
        req.body.subject_id || null,
        req.body.academic_year_id || null,
        req.body.term_id || null,
        req.body.material_type || "other",
        fileName,
        storedName,
        `uploads/syllabus/${schoolId}/${storedName}`,
        fileType,
        buffer.length,
      ],
    )
    const uploadId = Number(result.insertId)
    const processed = await processUploadRecord(connection, schoolId, uploadId)
    await connection.commit()
    res.status(201).json({ upload_id: uploadId, processing_status: "pending_review", ...processed })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listSyllabusUploads(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [uploads] = await pool.query(
    `SELECT su.*, subj.name AS subject_name, gl.name AS grade_name, c.name AS curriculum_name, u.full_name AS uploaded_by_name,
      COUNT(sei.id) AS extracted_items,
      SUM(CASE WHEN sei.status = 'approved' THEN 1 ELSE 0 END) AS approved_items,
      SUM(CASE WHEN sei.status = 'pending_review' THEN 1 ELSE 0 END) AS pending_items
     FROM syllabus_uploads su
     LEFT JOIN subjects subj ON subj.id = su.subject_id AND subj.school_id = su.school_id
     LEFT JOIN grade_levels gl ON gl.id = su.grade_id AND gl.school_id = su.school_id
     LEFT JOIN curricula c ON c.id = su.curriculum_id AND c.school_id = su.school_id
     LEFT JOIN users u ON u.id = su.uploaded_by AND u.school_id = su.school_id
     LEFT JOIN syllabus_extracted_items sei ON sei.upload_id = su.id AND sei.school_id = su.school_id
     WHERE su.school_id = ?
     GROUP BY su.id, subj.name, gl.name, c.name, u.full_name
     ORDER BY su.created_at DESC`,
    [schoolId],
  )
  res.json({ uploads: uploads.map((row) => ({ ...row, extraction_summary_json: parseJson(row.extraction_summary_json, null) })) })
}

export async function processSyllabusUpload(req, res) {
  const schoolId = getScopedSchoolId(req)
  const uploadId = Number(req.params.id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const processed = await processUploadRecord(connection, schoolId, uploadId)
    await connection.commit()
    res.json(processed)
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function getSyllabusReview(req, res) {
  const schoolId = getScopedSchoolId(req)
  const uploadId = Number(req.params.id || 0)
  const [[upload]] = await pool.query(
    `SELECT su.*, subj.name AS subject_name, gl.name AS grade_name, c.name AS curriculum_name
     FROM syllabus_uploads su
     LEFT JOIN subjects subj ON subj.id = su.subject_id AND subj.school_id = su.school_id
     LEFT JOIN grade_levels gl ON gl.id = su.grade_id AND gl.school_id = su.school_id
     LEFT JOIN curricula c ON c.id = su.curriculum_id AND c.school_id = su.school_id
     WHERE su.school_id = ? AND su.id = ?
     LIMIT 1`,
    [schoolId, uploadId],
  )
  if (!upload) throw new HttpError(404, "Syllabus upload was not found")
  const [items] = await pool.query(
    `SELECT *
     FROM syllabus_extracted_items
     WHERE school_id = ? AND upload_id = ?
     ORDER BY COALESCE(parent_extracted_item_id, id), FIELD(item_type, 'topic', 'subtopic', 'objective', 'skill', 'assessment_note'), id`,
    [schoolId, uploadId],
  )
  res.json({
    upload: { ...upload, extraction_summary_json: parseJson(upload.extraction_summary_json, null) },
    items: items.map((item) => ({
      ...item,
      low_confidence: Number(item.confidence || 0) < 0.6,
      keywords_json: parseJson(item.keywords_json, []),
      raw_json: parseJson(item.raw_json, null),
    })),
  })
}

export async function updateExtractedItem(req, res) {
  const schoolId = getScopedSchoolId(req)
  const itemId = Number(req.params.id || 0)
  const [result] = await pool.query(
    `UPDATE syllabus_extracted_items
     SET title = COALESCE(?, title),
       description = COALESCE(?, description),
       term = COALESCE(?, term),
       suggested_week = COALESCE(?, suggested_week),
       exam_relevance = COALESCE(?, exam_relevance),
       keywords_json = COALESCE(?, keywords_json)
     WHERE school_id = ? AND id = ?`,
    [
      req.body.title === undefined ? null : cleanText(req.body.title),
      req.body.description === undefined ? null : cleanText(req.body.description),
      req.body.term === undefined ? null : cleanText(req.body.term),
      req.body.suggested_week === undefined ? null : Number(req.body.suggested_week || 0) || null,
      req.body.exam_relevance === undefined ? null : cleanText(req.body.exam_relevance),
      req.body.keywords === undefined ? null : JSON.stringify(Array.isArray(req.body.keywords) ? req.body.keywords : []),
      schoolId,
      itemId,
    ],
  )
  if (!result.affectedRows) throw new HttpError(404, "Extracted item was not found")
  res.json({ ok: true })
}

async function createTopicFromItem(connection, schoolId, item, upload, parentTopicId = null) {
  const [insert] = await connection.query(
    `INSERT INTO syllabus_topics (
      school_id, curriculum_id, grade_id, subject_id, parent_topic_id, topic_name, description, term,
      source_type, source_upload_id, approved_by, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ai_extracted', ?, ?, 1)
    ON DUPLICATE KEY UPDATE description = VALUES(description),
      term = VALUES(term),
      is_active = 1,
      approved_by = VALUES(approved_by)`,
    [
      schoolId,
      upload.curriculum_id || null,
      upload.grade_id || null,
      upload.subject_id,
      parentTopicId,
      item.title,
      item.description || null,
      item.term || null,
      upload.id,
      item.approved_by || null,
    ],
  )
  if (insert.insertId) return Number(insert.insertId)
  const [[existing]] = await connection.query(
    `SELECT id FROM syllabus_topics
     WHERE school_id = ? AND grade_id <=> ? AND subject_id = ? AND topic_name = ?
     LIMIT 1`,
    [schoolId, upload.grade_id || null, upload.subject_id, item.title],
  )
  return Number(existing?.id || 0)
}

export async function approveExtractedItem(req, res) {
  const schoolId = getScopedSchoolId(req)
  const itemId = Number(req.params.id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[item]] = await connection.query("SELECT * FROM syllabus_extracted_items WHERE school_id = ? AND id = ? LIMIT 1 FOR UPDATE", [schoolId, itemId])
    if (!item) throw new HttpError(404, "Extracted item was not found")
    const [[upload]] = await connection.query("SELECT * FROM syllabus_uploads WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, item.upload_id])
    if (!upload?.subject_id) throw new HttpError(400, "Upload must be linked to a subject before approval")
    if (!["topic", "subtopic"].includes(item.item_type)) {
      await connection.query(
        "UPDATE syllabus_extracted_items SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP WHERE school_id = ? AND id = ?",
        [req.user.id, schoolId, itemId],
      )
      await connection.commit()
      return res.json({ ok: true, item_id: itemId })
    }

    let parentTopicId = null
    if (item.parent_extracted_item_id) {
      const [[parent]] = await connection.query(
        "SELECT merged_into_topic_id FROM syllabus_extracted_items WHERE school_id = ? AND id = ? LIMIT 1",
        [schoolId, item.parent_extracted_item_id],
      )
      parentTopicId = parent?.merged_into_topic_id || null
    }
    item.approved_by = req.user.id
    const topicId = await createTopicFromItem(connection, schoolId, item, upload, parentTopicId)
    await connection.query(
      `UPDATE syllabus_extracted_items
       SET status = 'approved', approved_by = ?, approved_at = CURRENT_TIMESTAMP, merged_into_topic_id = ?
       WHERE school_id = ? AND id = ?`,
      [req.user.id, topicId, schoolId, itemId],
    )
    const [objectives] = await connection.query(
      "SELECT * FROM syllabus_extracted_items WHERE school_id = ? AND parent_extracted_item_id = ? AND item_type = 'objective'",
      [schoolId, itemId],
    )
    for (const objective of objectives) {
      await connection.query(
        `INSERT INTO learning_objectives (topic_id, objective_text, exam_relevance)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE objective_text = objective_text`,
        [topicId, objective.title, objective.exam_relevance || null],
      )
    }
    await connection.commit()
    res.json({ ok: true, topic_id: topicId })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function rejectExtractedItem(req, res) {
  const schoolId = getScopedSchoolId(req)
  const itemId = Number(req.params.id || 0)
  const [result] = await pool.query(
    "UPDATE syllabus_extracted_items SET status = 'rejected' WHERE school_id = ? AND id = ?",
    [schoolId, itemId],
  )
  if (!result.affectedRows) throw new HttpError(404, "Extracted item was not found")
  res.json({ ok: true })
}

export async function mergeExtractedItem(req, res) {
  const schoolId = getScopedSchoolId(req)
  const itemId = Number(req.params.id || 0)
  const topicId = Number(req.body.topic_id || req.body.topicId || 0)
  if (!topicId) throw new HttpError(400, "Target topic is required")
  const [result] = await pool.query(
    `UPDATE syllabus_extracted_items
     SET status = 'merged', merged_into_topic_id = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP
     WHERE school_id = ? AND id = ?`,
    [topicId, req.user.id, schoolId, itemId],
  )
  if (!result.affectedRows) throw new HttpError(404, "Extracted item was not found")
  res.json({ ok: true })
}

export async function listManualSyllabusEntries(req, res) {
  const schoolId = getScopedSchoolId(req)
  const status = cleanText(req.query.status)
  const params = [schoolId]
  const teacherOnly = req.user?.role === "teacher"
  const statusClause = status ? " AND mse.status = ?" : ""
  if (status) params.push(status)
  const teacherClause = teacherOnly ? " AND mse.submitted_by = ?" : ""
  if (teacherOnly) params.push(req.user.id)
  const [entries] = await pool.query(
    `SELECT mse.*, subj.name AS subject_name, gl.name AS grade_name, curr.name AS curriculum_name,
       submitter.full_name AS submitted_by_name, reviewer.full_name AS reviewed_by_name,
       approved.topic_name AS approved_topic_name
     FROM manual_syllabus_entries mse
     JOIN subjects subj ON subj.id = mse.subject_id AND subj.school_id = mse.school_id
     LEFT JOIN grade_levels gl ON gl.id = mse.grade_id AND gl.school_id = mse.school_id
     LEFT JOIN curricula curr ON curr.id = mse.curriculum_id AND curr.school_id = mse.school_id
     LEFT JOIN users submitter ON submitter.id = mse.submitted_by
     LEFT JOIN users reviewer ON reviewer.id = mse.reviewed_by
     LEFT JOIN syllabus_topics approved ON approved.id = mse.approved_topic_id AND approved.school_id = mse.school_id
     WHERE mse.school_id = ?${statusClause}${teacherClause}
     ORDER BY FIELD(mse.status, 'pending_review', 'revision_requested', 'draft', 'approved', 'rejected'), mse.updated_at DESC, mse.submitted_at DESC, mse.id DESC`,
    params,
  )
  res.json({ entries: entries.map(normalizeManualEntry) })
}

export async function getManualSyllabusEntry(req, res) {
  const schoolId = getScopedSchoolId(req)
  const entryId = Number(req.params.id || 0)
  const teacherClause = req.user?.role === "teacher" ? " AND mse.submitted_by = ?" : ""
  const params = req.user?.role === "teacher" ? [schoolId, entryId, req.user.id] : [schoolId, entryId]
  const [[entry]] = await pool.query(
    `SELECT mse.*, subj.name AS subject_name, gl.name AS grade_name, curr.name AS curriculum_name,
       submitter.full_name AS submitted_by_name, reviewer.full_name AS reviewed_by_name,
       approved.topic_name AS approved_topic_name
     FROM manual_syllabus_entries mse
     JOIN subjects subj ON subj.id = mse.subject_id AND subj.school_id = mse.school_id
     LEFT JOIN grade_levels gl ON gl.id = mse.grade_id AND gl.school_id = mse.school_id
     LEFT JOIN curricula curr ON curr.id = mse.curriculum_id AND curr.school_id = mse.school_id
     LEFT JOIN users submitter ON submitter.id = mse.submitted_by
     LEFT JOIN users reviewer ON reviewer.id = mse.reviewed_by
     LEFT JOIN syllabus_topics approved ON approved.id = mse.approved_topic_id AND approved.school_id = mse.school_id
     WHERE mse.school_id = ? AND mse.id = ?${teacherClause}
     LIMIT 1`,
    params,
  )
  if (!entry) throw new HttpError(404, "Manual syllabus entry was not found")
  res.json({ entry: normalizeManualEntry(entry) })
}

export async function createManualSyllabusEntry(req, res) {
  const schoolId = getScopedSchoolId(req)
  const nextStatus = manualEntryStatusFromBody(req.body)
  const topicName = cleanText(req.body.topic_name || req.body.topicName || req.body.title) || (nextStatus === "draft" ? "Untitled syllabus draft" : "")
  if (!topicName) throw new HttpError(400, "Syllabus document title is required")
  const references = await resolveManualReferences(pool, schoolId, req.body)
  const syllabusPayload = parseManualSyllabusPayload(manualSyllabusPayloadFromBody(req.body, []))
  const [[existing]] = await pool.query(
    `SELECT id, submitted_by, status
     FROM manual_syllabus_entries
     WHERE school_id = ? AND grade_id <=> ? AND subject_id = ? AND status <> 'rejected'
     ORDER BY FIELD(status, 'pending_review', 'revision_requested', 'draft', 'approved'), updated_at DESC, id DESC
     LIMIT 1`,
    [schoolId, references.gradeId, references.subjectId],
  )
  if (existing) {
    if (req.user?.role === "teacher" && Number(existing.submitted_by) !== Number(req.user.id)) {
      throw new HttpError(409, "A syllabus document already exists for this year level and subject.")
    }
    await pool.query(
      `UPDATE manual_syllabus_entries
       SET curriculum_id = ?, grade_id = ?, subject_id = ?, term = NULL, suggested_week = NULL,
         topic_name = ?, description = ?, objectives_json = ?, status = ?,
         review_notes = NULL, reviewed_by = NULL, reviewed_at = NULL
       WHERE school_id = ? AND id = ?`,
      [
        references.curriculumId,
        references.gradeId,
        references.subjectId,
        topicName,
        cleanText(req.body.description) || null,
        JSON.stringify(syllabusPayload),
        nextStatus,
        schoolId,
        existing.id,
      ],
    )
    return res.json({ ok: true, entry_id: Number(existing.id), status: nextStatus, reused: true })
  }
  const [result] = await pool.query(
    `INSERT INTO manual_syllabus_entries (
      school_id, submitted_by, curriculum_id, grade_id, subject_id, term, suggested_week,
      topic_name, description, objectives_json, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      req.user.id,
      references.curriculumId,
      references.gradeId,
      references.subjectId,
      null,
      null,
      topicName,
      cleanText(req.body.description) || null,
      JSON.stringify(syllabusPayload),
      nextStatus,
    ],
  )
  res.status(201).json({ ok: true, entry_id: Number(result.insertId), status: nextStatus })
}

export async function updateManualSyllabusEntry(req, res) {
  const schoolId = getScopedSchoolId(req)
  const entryId = Number(req.params.id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[entry]] = await connection.query("SELECT * FROM manual_syllabus_entries WHERE school_id = ? AND id = ? LIMIT 1 FOR UPDATE", [schoolId, entryId])
    if (!entry) throw new HttpError(404, "Manual syllabus entry was not found")
    if (req.user?.role === "teacher" && Number(entry.submitted_by) !== Number(req.user.id)) {
      throw new HttpError(403, "Teachers can only edit their own syllabus entries")
    }
    const requestedTopicName = req.body.topic_name === undefined && req.body.topicName === undefined && req.body.title === undefined
      ? entry.topic_name
      : cleanText(req.body.topic_name || req.body.topicName || req.body.title)
    const nextStatus = manualEntryStatusFromBody(req.body)
    const topicName = requestedTopicName || (nextStatus === "draft" ? "Untitled syllabus draft" : "")
    if (!topicName) throw new HttpError(400, "Syllabus document title is required")
    const references = await resolveManualReferences(connection, schoolId, req.body, entry)
    const syllabusPayload = parseManualSyllabusPayload(manualSyllabusPayloadFromBody(req.body, entry.objectives_json))
    await connection.query(
      `UPDATE manual_syllabus_entries
       SET curriculum_id = ?, grade_id = ?, subject_id = ?, term = ?, suggested_week = ?,
         topic_name = ?, description = ?, objectives_json = ?, status = ?,
         review_notes = NULL, reviewed_by = NULL, reviewed_at = NULL
       WHERE school_id = ? AND id = ?`,
      [
        references.curriculumId,
        references.gradeId,
        references.subjectId,
        null,
        null,
        topicName,
        req.body.description === undefined ? entry.description : cleanText(req.body.description) || null,
        JSON.stringify(syllabusPayload),
        nextStatus,
        schoolId,
        entryId,
      ],
    )
    await connection.commit()
    res.json({ ok: true })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

async function createTopicFromManualEntry(connection, schoolId, entry, approvedBy, options = {}) {
  const topicName = cleanText(options.topicName || entry.topic_name)
  if (!topicName) throw new HttpError(400, "Topic name is required")
  const parentTopicId = options.parentTopicId || null
  const description = options.description === undefined ? entry.description : options.description
  const [insert] = await connection.query(
    `INSERT INTO syllabus_topics (
      school_id, curriculum_id, grade_id, subject_id, parent_topic_id, topic_name, description, term,
      source_type, approved_by, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'teacher_created', ?, 1)
    ON DUPLICATE KEY UPDATE curriculum_id = VALUES(curriculum_id),
      parent_topic_id = VALUES(parent_topic_id),
      description = VALUES(description),
      term = VALUES(term),
      approved_by = VALUES(approved_by),
      is_active = 1`,
    [
      schoolId,
      entry.curriculum_id || null,
      entry.grade_id || null,
      entry.subject_id,
      parentTopicId,
      topicName,
      cleanText(description) || null,
      null,
      approvedBy,
    ],
  )
  if (insert.insertId) return Number(insert.insertId)
  const [[existing]] = await connection.query(
    `SELECT id FROM syllabus_topics
     WHERE school_id = ? AND grade_id <=> ? AND subject_id = ? AND topic_name = ?
     LIMIT 1`,
    [schoolId, entry.grade_id || null, entry.subject_id, topicName],
  )
  return Number(existing?.id || 0)
}

async function insertLearningObjective(connection, topicId, objectiveText, skillType = null) {
  const text = cleanText(objectiveText)
  if (!topicId || !text) return
  await connection.query(
    `INSERT INTO learning_objectives (topic_id, objective_text, skill_type, exam_relevance)
     SELECT ?, ?, ?, NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM learning_objectives WHERE topic_id = ? AND objective_text = ?
     )`,
    [topicId, text, skillType || null, topicId, text],
  )
}

export async function approveManualSyllabusEntry(req, res) {
  if (!canReviewManualSyllabus(req)) throw new HttpError(403, "Only school leadership can approve syllabus entries")
  const schoolId = getScopedSchoolId(req)
  const entryId = Number(req.params.id || 0)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[entry]] = await connection.query("SELECT * FROM manual_syllabus_entries WHERE school_id = ? AND id = ? LIMIT 1 FOR UPDATE", [schoolId, entryId])
    if (!entry) throw new HttpError(404, "Manual syllabus entry was not found")
    if (entry.status === "approved" && entry.approved_topic_id) {
      await connection.commit()
      return res.json({ ok: true, topic_id: Number(entry.approved_topic_id) })
    }
    if (entry.status === "draft") throw new HttpError(400, "Draft syllabus entries must be submitted before approval")
    const topicId = await createTopicFromManualEntry(connection, schoolId, entry, req.user.id)
    const syllabusPayload = parseManualSyllabusPayload(entry.objectives_json)
    for (const objective of syllabusPayload.flat_objectives) {
      await insertLearningObjective(connection, topicId, objective)
    }
    for (const subtopic of syllabusPayload.subtopics) {
      if (!cleanText(subtopic.title)) continue
      const subtopicId = await createTopicFromManualEntry(connection, schoolId, entry, req.user.id, {
        parentTopicId: topicId,
        topicName: subtopic.title,
        description: subtopic.notes,
      })
      for (const criterion of subtopic.criteria) {
        for (const objective of objectiveTextsForCriterion(criterion)) {
          await insertLearningObjective(connection, subtopicId, objective.text, objective.skillType)
        }
      }
    }
    await connection.query(
      `UPDATE manual_syllabus_entries
       SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP,
         approved_topic_id = ?, review_notes = ?
       WHERE school_id = ? AND id = ?`,
      [req.user.id, topicId, cleanText(req.body.review_notes || req.body.reviewNotes) || null, schoolId, entryId],
    )
    await connection.commit()
    res.json({ ok: true, topic_id: topicId })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function rejectManualSyllabusEntry(req, res) {
  if (!canReviewManualSyllabus(req)) throw new HttpError(403, "Only school leadership can review syllabus entries")
  const schoolId = getScopedSchoolId(req)
  const entryId = Number(req.params.id || 0)
  const status = req.body.status === "rejected" ? "rejected" : "revision_requested"
  const [result] = await pool.query(
    `UPDATE manual_syllabus_entries
     SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
     WHERE school_id = ? AND id = ? AND status <> 'approved'`,
    [status, req.user.id, cleanText(req.body.review_notes || req.body.reviewNotes) || null, schoolId, entryId],
  )
  if (!result.affectedRows) throw new HttpError(404, "Manual syllabus entry was not found or is already approved")
  res.json({ ok: true })
}

export async function listSyllabusTopics(req, res) {
  const schoolId = getScopedSchoolId(req)
  const [topics] = await pool.query(
    `SELECT st.*, subj.name AS subject_name, gl.name AS grade_name, parent.topic_name AS parent_topic_name,
      COUNT(lo.id) AS objective_count,
      COUNT(q.id) AS approved_question_count
     FROM syllabus_topics st
     JOIN subjects subj ON subj.id = st.subject_id AND subj.school_id = st.school_id
     LEFT JOIN grade_levels gl ON gl.id = st.grade_id AND gl.school_id = st.school_id
     LEFT JOIN syllabus_topics parent ON parent.id = st.parent_topic_id AND parent.school_id = st.school_id
     LEFT JOIN learning_objectives lo ON lo.topic_id = st.id
     LEFT JOIN question_bank q ON q.topic_id = st.id AND q.school_id = st.school_id AND q.approval_status = 'approved'
     WHERE st.school_id = ? AND st.is_active = 1
       ${req.query.subject_id ? "AND st.subject_id = ?" : ""}
       ${req.query.grade_id ? "AND st.grade_id = ?" : ""}
     GROUP BY st.id, subj.name, gl.name, parent.topic_name
     ORDER BY gl.order_number, subj.name, COALESCE(parent.topic_name, st.topic_name), st.order_number, st.topic_name`,
    [schoolId, ...(req.query.subject_id ? [Number(req.query.subject_id)] : []), ...(req.query.grade_id ? [Number(req.query.grade_id)] : [])],
  )
  res.json({ topics })
}

export async function createSyllabusTopic(req, res) {
  const schoolId = getScopedSchoolId(req)
  const subjectId = Number(req.body.subject_id || 0)
  const topicName = cleanText(req.body.topic_name || req.body.name)
  if (!subjectId || !topicName) throw new HttpError(400, "Subject and topic name are required")
  const [result] = await pool.query(
    `INSERT INTO syllabus_topics (
      school_id, curriculum_id, grade_id, subject_id, parent_topic_id, topic_name, description, term, source_type, approved_by, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'teacher_created', ?, 1)
    ON DUPLICATE KEY UPDATE description = VALUES(description), term = VALUES(term), is_active = 1`,
    [schoolId, req.body.curriculum_id || null, req.body.grade_id || null, subjectId, req.body.parent_topic_id || null, topicName, req.body.description || null, req.body.term || null, req.user.id],
  )
  res.status(201).json({ topic_id: Number(result.insertId || 0), ok: true })
}

export async function updateSyllabusTopic(req, res) {
  const schoolId = getScopedSchoolId(req)
  const topicId = Number(req.params.id || 0)
  const [result] = await pool.query(
    `UPDATE syllabus_topics
     SET topic_name = COALESCE(?, topic_name),
       description = COALESCE(?, description),
       term = COALESCE(?, term),
       order_number = COALESCE(?, order_number),
       is_active = COALESCE(?, is_active)
     WHERE school_id = ? AND id = ?`,
    [
      req.body.topic_name === undefined ? null : cleanText(req.body.topic_name),
      req.body.description === undefined ? null : cleanText(req.body.description),
      req.body.term === undefined ? null : cleanText(req.body.term),
      req.body.order_number === undefined ? null : Number(req.body.order_number || 0),
      req.body.is_active === undefined ? null : Number(Boolean(req.body.is_active)),
      schoolId,
      topicId,
    ],
  )
  if (!result.affectedRows) throw new HttpError(404, "Syllabus topic was not found")
  res.json({ ok: true })
}
