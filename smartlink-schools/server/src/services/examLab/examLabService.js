import fs from "fs/promises"
import path from "path"
import { randomUUID } from "crypto"
import { execFile } from "child_process"
import { promisify } from "util"
import { pool } from "../../config/db.js"
import { HttpError } from "../../utils/http.js"
import { extractExamPaperWithAi } from "./examPaperAiExtractor.js"
import {
  diagramFingerprint,
  extractVersionImageDiagrams,
  linkCandidateDiagramsToQuestion,
  linkVersionImageDiagramsToQuestion,
  saveCandidateDiagramSignals,
  saveVersionImageDiagrams,
} from "./diagramExtraction.service.js"

const execFileAsync = promisify(execFile)

const DEFAULT_SCOPE = {
  exam_board: "MANEB",
  exam_level: "MSCE",
  subject: "Mathematics",
}

const MAX_UPLOAD_BYTES = 40 * 1024 * 1024
const ALLOWED_UPLOAD_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
])

const DEFAULT_TOPIC_MAP = [
  ["Number", ["Integers", "Fractions", "Decimals", "Percentages", "Ratio and proportion", "Standard form"]],
  ["Algebra", ["Linear equations", "Simultaneous equations", "Quadratic equations", "Factorisation", "Inequalities", "Algebraic fractions", "Sequences", "Substitution", "Change of subject"]],
  ["Geometry", ["Angles", "Triangles", "Polygons", "Circle theorems", "Bearings", "Construction", "Similarity and congruence"]],
  ["Mensuration", ["Area", "Perimeter", "Surface area", "Volume", "Cylinders", "Cones", "Spheres"]],
  ["Trigonometry", ["Right-angled triangles", "Sine rule", "Cosine rule", "Bearings", "Elevation and depression"]],
  ["Statistics", ["Mean", "Median", "Mode", "Range", "Frequency tables", "Bar charts", "Pie charts", "Cumulative frequency"]],
  ["Probability", ["Simple probability", "Combined events", "Tree diagrams", "Expected outcomes"]],
  ["Graphs", ["Linear graphs", "Quadratic graphs", "Travel graphs", "Inequalities on graphs"]],
  ["Sets", ["Set notation", "Venn diagrams", "Subsets", "Union and intersection"]],
  ["Vectors", ["Vector notation", "Vector arithmetic", "Position vectors", "Magnitude"]],
  ["Transformations", ["Reflection", "Rotation", "Translation", "Enlargement"]],
  ["Matrices", ["Matrix operations", "Determinants", "Inverses", "Transformations"]],
  ["Coordinate Geometry", ["Gradient", "Midpoint", "Distance", "Equation of a line"]],
  ["Commercial Arithmetic", ["Profit and loss", "Simple interest", "Compound interest", "Tax", "Discount"]],
  ["Functions", ["Function notation", "Composite functions", "Inverse functions", "Mappings"]],
  ["Other", ["Mixed topic", "Unclassified", "Manual review"]],
]

function cleanText(value, fallback = "") {
  return String(value ?? fallback).trim()
}

function cleanOptionalText(value) {
  const text = cleanText(value)
  return text || null
}

function normalizeScope(input = {}) {
  return {
    exam_board: cleanText(input.exam_board || input.examBoard || DEFAULT_SCOPE.exam_board, DEFAULT_SCOPE.exam_board).slice(0, 80),
    exam_level: cleanText(input.exam_level || input.examLevel || DEFAULT_SCOPE.exam_level, DEFAULT_SCOPE.exam_level).slice(0, 80),
    subject: cleanText(input.subject || DEFAULT_SCOPE.subject, DEFAULT_SCOPE.subject).slice(0, 120),
  }
}

function normalizePaper(value, fallback = "Paper 1") {
  const paper = cleanText(value || fallback)
  if (/^paper\s*2$/i.test(paper) || paper === "2") return "Paper 2"
  if (/^paper\s*1$/i.test(paper) || paper === "1") return "Paper 1"
  return paper === "Other" ? "Other" : "Paper 1"
}

function normalizeDocumentType(value) {
  const text = cleanText(value || "Question Paper")
  if (["Question Paper", "Mark Scheme", "Syllabus", "Examiner Report", "Other"].includes(text)) return text
  return "Question Paper"
}

function normalizeSourceQuality(value) {
  const text = cleanText(value || "Original PDF")
  if (["Original PDF", "Scanned PDF", "Image", "Manual"].includes(text)) return text
  return "Original PDF"
}

function normalizeDifficulty(value) {
  const text = cleanText(value || "unknown").toLowerCase()
  if (["easy", "medium", "hard", "unknown"].includes(text)) return text
  return "unknown"
}

function intValue(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : fallback
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase())
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function confidenceValue(value, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  const normalized = number > 1 && number <= 100 ? number / 100 : number
  return clamp(normalized, 0, 1)
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

function safeFilename(fileName) {
  return cleanText(fileName || "exam-paper")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 110) || "exam-paper"
}

function extensionForMimeType(mimeType) {
  if (mimeType === "application/pdf") return ".pdf"
  if (mimeType === "image/png") return ".png"
  if (mimeType === "image/jpeg") return ".jpg"
  if (mimeType === "image/webp") return ".webp"
  if (mimeType === "text/csv") return ".csv"
  return ".txt"
}

function decodeUploadPayload(body = {}) {
  const fileType = cleanText(body.file_type || body.fileType || body.mime_type || body.mimeType || "text/plain")
  if (!ALLOWED_UPLOAD_TYPES.has(fileType)) throw new HttpError(400, "Unsupported exam lab file type")
  const dataUrl = cleanText(body.data_url || body.dataUrl)
  const textContent = body.text_content ?? body.textContent
  if (dataUrl) {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) throw new HttpError(400, "Exam paper upload payload is invalid")
    if (match[1] !== fileType) throw new HttpError(400, "Exam paper file type does not match the upload payload")
    const buffer = Buffer.from(match[2], "base64")
    if (!buffer.length) throw new HttpError(400, "Exam paper file is empty")
    if (buffer.length > MAX_UPLOAD_BYTES) throw new HttpError(400, "Exam paper file must be 40MB or smaller")
    return buffer
  }
  if (textContent !== undefined && textContent !== null) {
    const buffer = Buffer.from(String(textContent), "utf8")
    if (!buffer.length) throw new HttpError(400, "Manual exam paper text is empty")
    if (buffer.length > MAX_UPLOAD_BYTES) throw new HttpError(400, "Manual exam paper text must be 40MB or smaller")
    return buffer
  }
  throw new HttpError(400, "Provide a data_url or text_content for the exam lab upload")
}

async function commandText(command, args, options = {}) {
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 25000, maxBuffer: 8 * 1024 * 1024, ...options })
    return String(stdout || "")
  } catch {
    return ""
  }
}

async function logActivity(connection, userId, action, entityType = null, entityId = null, details = {}) {
  await connection.query(
    `INSERT INTO exam_lab_activity_logs (user_id, action, entity_type, entity_id, details_json)
     VALUES (?, ?, ?, ?, ?)`,
    [userId || null, action, entityType, entityId || null, JSON.stringify(details || {})],
  )
}

async function logExtraction(connection, paperId, versionId, level, message, details = {}) {
  await connection.query(
    `INSERT INTO exam_lab_extraction_logs (paper_id, version_id, log_level, message, details_json)
     VALUES (?, ?, ?, ?, ?)`,
    [paperId, versionId, level, message.slice(0, 500), JSON.stringify(details || {})],
  )
}

export async function ensureDefaultTopicMap(scopeInput = {}, userId = null, connection = pool) {
  const scope = normalizeScope(scopeInput)
  const [[countRow]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM exam_lab_topics
     WHERE exam_board = ? AND exam_level = ? AND subject = ?`,
    [scope.exam_board, scope.exam_level, scope.subject],
  )
  if (Number(countRow?.total || 0) > 0) return

  let orderNumber = 10
  for (const [topicName, subtopics] of DEFAULT_TOPIC_MAP) {
    const [topicResult] = await connection.query(
      `INSERT INTO exam_lab_topics (exam_board, exam_level, subject, name, order_number, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE archived_at = NULL, updated_by = VALUES(updated_by)`,
      [scope.exam_board, scope.exam_level, scope.subject, topicName, orderNumber, userId, userId],
    )
    let topicId = Number(topicResult.insertId || 0)
    if (!topicId) {
      const [[existing]] = await connection.query(
        `SELECT id FROM exam_lab_topics
         WHERE exam_board = ? AND exam_level = ? AND subject = ? AND name = ?
         LIMIT 1`,
        [scope.exam_board, scope.exam_level, scope.subject, topicName],
      )
      topicId = Number(existing?.id || 0)
    }
    let subOrder = 10
    for (const subtopicName of subtopics) {
      await connection.query(
        `INSERT INTO exam_lab_subtopics (topic_id, name, order_number)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE archived_at = NULL`,
        [topicId, subtopicName, subOrder],
      )
      subOrder += 10
    }
    orderNumber += 10
  }
}

function statusRank(status) {
  const rank = {
    Missing: 0,
    Uploaded: 1,
    Extracting: 2,
    Failed: 2,
    "Needs Review": 3,
    Extracted: 4,
    "Partially Tagged": 5,
    Tagged: 6,
    Verified: 7,
  }
  return rank[status] || 0
}

function strongerStatus(a, b) {
  return statusRank(b) > statusRank(a) ? b : a
}

function versionStatus(version) {
  if (!version?.id) return "Missing"
  const status = String(version.extraction_status || "uploaded")
  if (status === "extracting") return "Extracting"
  if (status === "failed") return "Failed"
  if (status === "needs_review") return "Needs Review"
  if (status === "extracted") return "Extracted"
  return "Uploaded"
}

function questionCoverageStatus(stats) {
  const extracted = Number(stats?.extracted || 0)
  const tagged = Number(stats?.tagged || 0)
  const verified = Number(stats?.verified || 0)
  if (!extracted) return "Missing"
  if (verified >= extracted && extracted > 0) return "Verified"
  if (tagged >= extracted && extracted > 0) return "Tagged"
  if (tagged > 0) return "Partially Tagged"
  return "Extracted"
}

function datasetStatusLabel(readiness) {
  if (readiness.level === "complete") return "Complete"
  if (readiness.level === "strong") return "Strong"
  if (readiness.level === "medium") return "Developing"
  if (readiness.level === "basic") return "Basic"
  return "Incomplete"
}

function buildReadiness({
  startYear,
  endYear,
  uploadedQuestionPapers,
  extractedQuestionPapers,
  markSchemes,
  taggedQuestions,
  verifiedQuestions,
  totalQuestions,
  topicCount,
  subtopicCount,
  successfulBacktests,
  paper1Papers,
  paper2Papers,
  recentUploadedYears,
}) {
  const expectedPapers = Math.max(0, (endYear - startYear + 1) * 2)
  const uploadedPct = expectedPapers ? (uploadedQuestionPapers / expectedPapers) * 100 : 0
  const extractionPct = uploadedQuestionPapers ? (extractedQuestionPapers / uploadedQuestionPapers) * 100 : 0
  const taggedPct = totalQuestions ? (taggedQuestions / totalQuestions) * 100 : 0
  const verifiedPct = totalQuestions ? (verifiedQuestions / totalQuestions) * 100 : 0
  const paperBalance = uploadedQuestionPapers ? (Math.min(paper1Papers, paper2Papers) / Math.max(paper1Papers, paper2Papers, 1)) * 100 : 0
  const topicMapScore = topicCount >= 12 && subtopicCount >= 20 ? 100 : topicCount >= 8 ? 70 : topicCount ? 35 : 0
  const qualityScore = Math.round(
    uploadedPct * 0.18
    + extractionPct * 0.14
    + taggedPct * 0.24
    + verifiedPct * 0.20
    + Math.min(100, markSchemes * 5) * 0.07
    + paperBalance * 0.07
    + topicMapScore * 0.10,
  )

  const reasons = []
  if (paper1Papers || paper2Papers) reasons.push(`Paper 1 has ${paper1Papers} uploaded year${paper1Papers === 1 ? "" : "s"} and Paper 2 has ${paper2Papers}.`)
  if (!markSchemes) reasons.push("No mark schemes uploaded yet.")
  if (totalQuestions && taggedPct < 90) reasons.push(`Only ${Math.round(taggedPct)}% of accepted questions are tagged.`)
  if (totalQuestions && verifiedPct < 80) reasons.push(`${Math.round(verifiedPct)}% of accepted questions are verified.`)
  if (!topicCount) reasons.push("Topic map has not been created yet.")
  if (recentUploadedYears < 3) reasons.push("Recent-year coverage is still thin.")

  let level = "incomplete"
  if (uploadedQuestionPapers >= 10 && taggedQuestions >= 150 && topicCount > 0) level = "basic"
  if (uploadedQuestionPapers >= 15 && taggedQuestions >= 250 && recentUploadedYears >= 3 && verifiedPct >= 60) level = "medium"
  if (paper1Papers >= 8 && paper2Papers >= 8 && taggedQuestions >= 500 && verifiedPct >= 80 && successfulBacktests > 1 && markSchemes > 0) level = "strong"
  if (uploadedPct >= 75 && paper1Papers > 0 && paper2Papers > 0 && taggedPct >= 90 && verifiedPct >= 80 && topicMapScore >= 100 && successfulBacktests >= 3) level = "complete"

  return {
    level,
    label: datasetStatusLabel({ level }),
    expected_papers: expectedPapers,
    uploaded_question_papers: uploadedQuestionPapers,
    extracted_question_papers: extractedQuestionPapers,
    dataset_completeness_percentage: Math.round(uploadedPct),
    dataset_quality_score: clamp(qualityScore, 0, 100),
    tagged_percentage: Math.round(taggedPct),
    verified_percentage: Math.round(verifiedPct),
    paper_balance_percentage: Math.round(paperBalance),
    topic_map_score: Math.round(topicMapScore),
    reasons: reasons.length ? reasons : ["Dataset signals are healthy for the selected target range."],
    advanced_actions_unlocked: ["strong", "complete"].includes(level),
    available_actions: [
      "Run full historical analysis",
      "Run rolling backtests",
      "Generate target-year prediction report",
      "Train/suggest topic classifier dataset",
      "Generate revision priority map",
      "Generate mock paper blueprint",
      "Analyze Paper 1 vs Paper 2 differences",
      "Export clean dataset",
    ],
  }
}

async function dashboardStats(scope, startYear, endYear) {
  await ensureDefaultTopicMap(scope)
  const [versionRows] = await pool.query(
    `SELECT p.id AS paper_id, p.exam_year, p.paper, v.id AS version_id, v.document_type,
      v.extraction_status, v.is_primary, v.is_trusted, v.created_at
     FROM exam_lab_papers p
     LEFT JOIN exam_lab_paper_versions v ON v.paper_id = p.id AND v.archived_at IS NULL
     WHERE p.exam_board = ? AND p.exam_level = ? AND p.subject = ?
       AND p.exam_year BETWEEN ? AND ?
       AND p.status <> 'archived'`,
    [scope.exam_board, scope.exam_level, scope.subject, startYear, endYear],
  )
  const [questionRows] = await pool.query(
    `SELECT p.exam_year, p.paper,
      COUNT(q.id) AS total_questions,
      SUM(CASE WHEN q.topic_id IS NOT NULL THEN 1 ELSE 0 END) AS tagged_questions,
      SUM(CASE WHEN q.verified = 1 THEN 1 ELSE 0 END) AS verified_questions,
      SUM(CASE WHEN q.status = 'accepted' THEN 1 ELSE 0 END) AS accepted_questions,
      SUM(COALESCE(q.marks, 0)) AS total_marks
     FROM exam_lab_papers p
     LEFT JOIN exam_lab_questions q ON q.paper_id = p.id AND q.status <> 'archived'
     WHERE p.exam_board = ? AND p.exam_level = ? AND p.subject = ?
       AND p.exam_year BETWEEN ? AND ?
     GROUP BY p.exam_year, p.paper`,
    [scope.exam_board, scope.exam_level, scope.subject, startYear, endYear],
  )
  const [candidateRows] = await pool.query(
    `SELECT p.exam_year, p.paper,
      COUNT(c.id) AS candidates,
      SUM(CASE WHEN c.status IN ('pending_review', 'needs_review', 'needs_manual_fix') THEN 1 ELSE 0 END) AS review_candidates
     FROM exam_lab_papers p
     JOIN exam_lab_question_candidates c ON c.paper_id = p.id
     WHERE p.exam_board = ? AND p.exam_level = ? AND p.subject = ?
       AND p.exam_year BETWEEN ? AND ?
     GROUP BY p.exam_year, p.paper`,
    [scope.exam_board, scope.exam_level, scope.subject, startYear, endYear],
  )
  const [[topicCount]] = await pool.query(
    `SELECT COUNT(*) AS topics FROM exam_lab_topics
     WHERE exam_board = ? AND exam_level = ? AND subject = ? AND archived_at IS NULL`,
    [scope.exam_board, scope.exam_level, scope.subject],
  )
  const [[subtopicCount]] = await pool.query(
    `SELECT COUNT(*) AS subtopics
     FROM exam_lab_subtopics st
     JOIN exam_lab_topics t ON t.id = st.topic_id
     WHERE t.exam_board = ? AND t.exam_level = ? AND t.subject = ? AND t.archived_at IS NULL AND st.archived_at IS NULL`,
    [scope.exam_board, scope.exam_level, scope.subject],
  )
  const [[backtestCount]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM exam_lab_backtests
     WHERE exam_board = ? AND exam_level = ? AND subject = ?`,
    [scope.exam_board, scope.exam_level, scope.subject],
  )

  return {
    versionRows,
    questionRows,
    candidateRows,
    topicCount: Number(topicCount?.topics || 0),
    subtopicCount: Number(subtopicCount?.subtopics || 0),
    successfulBacktests: Number(backtestCount?.total || 0),
  }
}

function mapStatsByYearPaper(rows, candidateRows) {
  const stats = new Map()
  for (const row of rows) {
    const key = `${row.exam_year}:${row.paper}`
    stats.set(key, {
      extracted: Number(row.total_questions || 0),
      accepted: Number(row.accepted_questions || row.total_questions || 0),
      tagged: Number(row.tagged_questions || 0),
      verified: Number(row.verified_questions || 0),
      marks: Number(row.total_marks || 0),
      candidates: 0,
      review_candidates: 0,
    })
  }
  for (const row of candidateRows) {
    const key = `${row.exam_year}:${row.paper}`
    const current = stats.get(key) || { extracted: 0, accepted: 0, tagged: 0, verified: 0, marks: 0 }
    stats.set(key, {
      ...current,
      candidates: Number(row.candidates || 0),
      review_candidates: Number(row.review_candidates || 0),
    })
  }
  return stats
}

export async function getCoverage(scopeInput = {}, filters = {}) {
  const scope = normalizeScope(scopeInput)
  const currentYear = new Date().getFullYear()
  const startYear = clamp(intValue(filters.start_year ?? filters.startYear, 1990), 1900, currentYear + 10)
  const endYear = clamp(intValue(filters.end_year ?? filters.endYear, currentYear), startYear, currentYear + 10)
  const { versionRows, questionRows, candidateRows } = await dashboardStats(scope, startYear, endYear)
  const questionStats = mapStatsByYearPaper(questionRows, candidateRows)
  const versionsByYearPaperDoc = new Map()
  for (const row of versionRows) {
    if (!row.version_id) continue
    const key = `${row.exam_year}:${row.paper}:${row.document_type}`
    const current = versionsByYearPaperDoc.get(key)
    if (!current || Number(row.is_primary) > Number(current.is_primary) || Number(row.version_id) > Number(current.version_id)) {
      versionsByYearPaperDoc.set(key, row)
    }
  }
  const [notes] = await pool.query(
    `SELECT *
     FROM exam_lab_coverage_notes
     WHERE exam_board = ? AND exam_level = ? AND subject = ? AND exam_year BETWEEN ? AND ?`,
    [scope.exam_board, scope.exam_level, scope.subject, startYear, endYear],
  )
  const noteMap = new Map(notes.map((row) => [`${row.exam_year}:${row.paper || ""}`, row]))
  const rows = []
  for (let year = startYear; year <= endYear; year += 1) {
    const paper1Question = versionsByYearPaperDoc.get(`${year}:Paper 1:Question Paper`)
    const paper2Question = versionsByYearPaperDoc.get(`${year}:Paper 2:Question Paper`)
    const paper1MarkScheme = versionsByYearPaperDoc.get(`${year}:Paper 1:Mark Scheme`)
    const paper2MarkScheme = versionsByYearPaperDoc.get(`${year}:Paper 2:Mark Scheme`)
    const paper1Stats = questionStats.get(`${year}:Paper 1`) || {}
    const paper2Stats = questionStats.get(`${year}:Paper 2`) || {}
    const extractionStatus = strongerStatus(versionStatus(paper1Question), versionStatus(paper2Question))
    const taggingStatus = strongerStatus(questionCoverageStatus(paper1Stats), questionCoverageStatus(paper2Stats))
    const verifiedStatus = Number(paper1Stats.verified || 0) + Number(paper2Stats.verified || 0) > 0
      ? (Number(paper1Stats.verified || 0) + Number(paper2Stats.verified || 0) >= Number(paper1Stats.extracted || 0) + Number(paper2Stats.extracted || 0) ? "Verified" : "Partially Tagged")
      : "Missing"
    const note = noteMap.get(`${year}:`) || noteMap.get(`${year}:Paper 1`) || noteMap.get(`${year}:Paper 2`)
    rows.push({
      year,
      paper_1: note?.status === "unavailable" ? "Missing" : versionStatus(paper1Question),
      paper_2: note?.status === "unavailable" ? "Missing" : versionStatus(paper2Question),
      paper_1_mark_scheme: versionStatus(paper1MarkScheme),
      paper_2_mark_scheme: versionStatus(paper2MarkScheme),
      extracted: extractionStatus,
      tagged: taggingStatus,
      verified: verifiedStatus,
      notes: note?.notes || "",
      unavailable: note?.status === "unavailable",
      stats: {
        paper_1: paper1Stats,
        paper_2: paper2Stats,
      },
    })
  }
  return { scope, start_year: startYear, end_year: endYear, rows }
}

export async function getDashboard(scopeInput = {}, filters = {}) {
  const scope = normalizeScope(scopeInput)
  const currentYear = new Date().getFullYear()
  const startYear = clamp(intValue(filters.start_year ?? filters.startYear, 1990), 1900, currentYear + 10)
  const endYear = clamp(intValue(filters.end_year ?? filters.endYear, currentYear), startYear, currentYear + 10)
  const { versionRows, questionRows, candidateRows, topicCount, subtopicCount, successfulBacktests } = await dashboardStats(scope, startYear, endYear)

  const questionPapers = versionRows.filter((row) => row.version_id && row.document_type === "Question Paper")
  const paper1Papers = new Set(questionPapers.filter((row) => row.paper === "Paper 1").map((row) => row.exam_year)).size
  const paper2Papers = new Set(questionPapers.filter((row) => row.paper === "Paper 2").map((row) => row.exam_year)).size
  const extractedQuestionPapers = new Set(questionPapers.filter((row) => row.extraction_status === "extracted").map((row) => row.version_id)).size
  const markSchemes = versionRows.filter((row) => row.version_id && row.document_type === "Mark Scheme").length
  const totalQuestions = questionRows.reduce((total, row) => total + Number(row.total_questions || 0), 0)
  const taggedQuestions = questionRows.reduce((total, row) => total + Number(row.tagged_questions || 0), 0)
  const verifiedQuestions = questionRows.reduce((total, row) => total + Number(row.verified_questions || 0), 0)
  const acceptedQuestions = questionRows.reduce((total, row) => total + Number(row.accepted_questions || row.total_questions || 0), 0)
  const reviewCandidates = candidateRows.reduce((total, row) => total + Number(row.review_candidates || 0), 0)
  const candidates = candidateRows.reduce((total, row) => total + Number(row.candidates || 0), 0)
  const availableYears = new Set(versionRows.filter((row) => row.version_id && row.document_type === "Question Paper").map((row) => row.exam_year))
  const recentUploadedYears = [...availableYears].filter((year) => Number(year) >= endYear - 4).length
  const latestUpload = versionRows
    .filter((row) => row.version_id)
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0] || null
  const [[lastBacktest]] = await pool.query(
    `SELECT *
     FROM exam_lab_backtests
     WHERE exam_board = ? AND exam_level = ? AND subject = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [scope.exam_board, scope.exam_level, scope.subject],
  )
  const [topicsByQuestion] = await pool.query(
    `SELECT t.name AS topic, COUNT(q.id) AS questions, SUM(COALESCE(q.marks, 0)) AS marks
     FROM exam_lab_questions q
     LEFT JOIN exam_lab_topics t ON t.id = q.topic_id
     WHERE q.exam_board = ? AND q.exam_level = ? AND q.subject = ? AND q.status <> 'archived'
     GROUP BY t.name
     ORDER BY questions DESC, marks DESC
     LIMIT 18`,
    [scope.exam_board, scope.exam_level, scope.subject],
  )
  const [papersByYear] = await pool.query(
    `SELECT p.exam_year, p.paper, COUNT(v.id) AS versions
     FROM exam_lab_papers p
     LEFT JOIN exam_lab_paper_versions v ON v.paper_id = p.id AND v.document_type = 'Question Paper' AND v.archived_at IS NULL
     WHERE p.exam_board = ? AND p.exam_level = ? AND p.subject = ? AND p.exam_year BETWEEN ? AND ?
     GROUP BY p.exam_year, p.paper
     ORDER BY p.exam_year`,
    [scope.exam_board, scope.exam_level, scope.subject, startYear, endYear],
  )
  const readiness = buildReadiness({
    startYear,
    endYear,
    uploadedQuestionPapers: new Set(questionPapers.map((row) => row.version_id)).size,
    extractedQuestionPapers,
    markSchemes,
    taggedQuestions,
    verifiedQuestions,
    totalQuestions,
    topicCount,
    subtopicCount,
    successfulBacktests,
    paper1Papers,
    paper2Papers,
    recentUploadedYears,
  })

  const missingYears = []
  for (let year = startYear; year <= endYear; year += 1) {
    if (!availableYears.has(year)) missingYears.push(year)
  }

  return {
    scope,
    start_year: startYear,
    end_year: endYear,
    cards: {
      total_papers_uploaded: new Set(questionPapers.map((row) => row.version_id)).size,
      paper_1_papers_uploaded: paper1Papers,
      paper_2_papers_uploaded: paper2Papers,
      mark_schemes_uploaded: markSchemes,
      total_questions_extracted: candidates,
      total_questions_accepted: acceptedQuestions,
      total_questions_tagged: taggedQuestions,
      total_questions_verified: verifiedQuestions,
      untagged_questions: Math.max(0, totalQuestions - taggedQuestions),
      failed_extraction_sections: reviewCandidates,
      available_years: availableYears.size,
      missing_years: missingYears.length,
      dataset_completeness_percentage: readiness.dataset_completeness_percentage,
      dataset_quality_score: readiness.dataset_quality_score,
      latest_upload: latestUpload,
      last_backtest_result: lastBacktest ? { ...lastBacktest, result_json: parseJson(lastBacktest.result_json, null), warnings_json: parseJson(lastBacktest.warnings_json, []) } : null,
    },
    readiness,
    charts: {
      papers_by_year: papersByYear,
      questions_by_topic: topicsByQuestion.map((row) => ({ topic: row.topic || "Untagged", questions: Number(row.questions || 0) })),
      marks_by_topic: topicsByQuestion.map((row) => ({ topic: row.topic || "Untagged", marks: Number(row.marks || 0) })),
      tagged_vs_untagged: [
        { label: "Tagged", value: taggedQuestions },
        { label: "Untagged", value: Math.max(0, totalQuestions - taggedQuestions) },
      ],
      extraction_success_rate: questionPapers.length ? Math.round((extractedQuestionPapers / questionPapers.length) * 100) : 0,
      missing_paper_tracker: missingYears.slice(-16),
    },
  }
}

export async function updateCoverageNote(userId, payload = {}) {
  const scope = normalizeScope(payload)
  const year = intValue(payload.exam_year ?? payload.year)
  if (!year) throw new HttpError(400, "Year is required")
  const paper = payload.paper ? normalizePaper(payload.paper) : null
  const status = cleanText(payload.status || "tracking") === "unavailable" ? "unavailable" : "tracking"
  const notes = cleanOptionalText(payload.notes)
  await pool.query(
    `INSERT INTO exam_lab_coverage_notes (exam_board, exam_level, subject, paper, exam_year, status, notes, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes), updated_by = VALUES(updated_by)`,
    [scope.exam_board, scope.exam_level, scope.subject, paper, year, status, notes, userId],
  )
  return { ok: true }
}

export async function createPaperUpload(userId, body = {}) {
  const scope = normalizeScope(body)
  const year = intValue(body.exam_year ?? body.year)
  if (year < 1900 || year > new Date().getFullYear() + 5) throw new HttpError(400, "A valid exam year is required")
  const paper = normalizePaper(body.paper)
  const documentType = normalizeDocumentType(body.document_type || body.documentType)
  const sourceQuality = normalizeSourceQuality(body.source_quality || body.sourceQuality)
  const fileType = cleanText(body.file_type || body.fileType || body.mime_type || body.mimeType || (body.text_content || body.textContent ? "text/plain" : "application/pdf"))
  const buffer = decodeUploadPayload({ ...body, file_type: fileType })
  const fileName = safeFilename(body.file_name || body.fileName || body.original_filename || `${scope.exam_board}-${scope.exam_level}-${scope.subject}-${paper}-${year}`)
  const extension = path.extname(fileName) || extensionForMimeType(fileType)
  const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${path.basename(fileName, path.extname(fileName)).slice(0, 80)}${extension}`
  const folder = path.resolve(process.cwd(), "uploads", "exam-lab", String(year))
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, storedName), buffer)
  const filePath = `uploads/exam-lab/${year}/${storedName}`
  const isPrimary = boolValue(body.is_primary ?? body.isPrimary, true)
  const isTrusted = boolValue(body.is_trusted ?? body.isTrusted, true)
  const isReplacement = boolValue(body.is_replacement ?? body.isReplacement, false)
  const useForTraining = boolValue(body.use_for_training ?? body.useForTraining, true)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[existingTrusted]] = await connection.query(
      `SELECT v.id, v.original_filename
       FROM exam_lab_papers p
       JOIN exam_lab_paper_versions v ON v.paper_id = p.id
       WHERE p.exam_board = ? AND p.exam_level = ? AND p.subject = ? AND p.paper = ? AND p.exam_year = ?
         AND v.document_type = ? AND v.is_primary = 1 AND v.is_trusted = 1 AND v.archived_at IS NULL
       LIMIT 1`,
      [scope.exam_board, scope.exam_level, scope.subject, paper, year, documentType],
    )
    if (existingTrusted && isPrimary && isTrusted && !isReplacement) {
      throw new HttpError(409, `A trusted ${documentType.toLowerCase()} already exists for ${year} ${paper}. Upload this as a replacement/version to preserve history.`)
    }

    await connection.query(
      `INSERT INTO exam_lab_papers (exam_board, exam_level, subject, paper, exam_year, notes, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE notes = COALESCE(VALUES(notes), notes), updated_by = VALUES(updated_by), status = 'active'`,
      [scope.exam_board, scope.exam_level, scope.subject, paper, year, cleanOptionalText(body.paper_notes || body.paperNotes), userId, userId],
    )
    const [[paperRow]] = await connection.query(
      `SELECT * FROM exam_lab_papers
       WHERE exam_board = ? AND exam_level = ? AND subject = ? AND paper = ? AND exam_year = ?
       LIMIT 1`,
      [scope.exam_board, scope.exam_level, scope.subject, paper, year],
    )
    const paperId = Number(paperRow.id)
    const [[versionRow]] = await connection.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
       FROM exam_lab_paper_versions
       WHERE paper_id = ? AND document_type = ?`,
      [paperId, documentType],
    )
    const versionNumber = Number(versionRow?.next_version || 1)

    if (isPrimary) {
      await connection.query(
        `UPDATE exam_lab_paper_versions
         SET is_primary = 0, is_trusted = IF(?, 0, is_trusted)
         WHERE paper_id = ? AND document_type = ? AND archived_at IS NULL`,
        [isReplacement && isTrusted ? 1 : 0, paperId, documentType],
      )
    }
    const [versionResult] = await connection.query(
      `INSERT INTO exam_lab_paper_versions (
        paper_id, version_number, document_type, source_quality, original_filename, stored_filename,
        file_path, mime_type, file_size, is_primary, is_trusted, use_for_training, replaces_version_id,
        extraction_status, notes, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)`,
      [
        paperId,
        versionNumber,
        documentType,
        sourceQuality,
        fileName,
        storedName,
        filePath,
        fileType,
        buffer.length,
        isPrimary ? 1 : 0,
        isTrusted ? 1 : 0,
        useForTraining ? 1 : 0,
        existingTrusted?.id || null,
        cleanOptionalText(body.notes),
        userId,
      ],
    )
    const versionId = Number(versionResult.insertId)
    if (isPrimary && documentType === "Question Paper") {
      await connection.query("UPDATE exam_lab_papers SET primary_question_version_id = ? WHERE id = ?", [versionId, paperId])
    }
    if (isPrimary && documentType === "Mark Scheme") {
      await connection.query("UPDATE exam_lab_papers SET primary_mark_scheme_version_id = ? WHERE id = ?", [versionId, paperId])
    }
    await logActivity(connection, userId, "paper_uploaded", "paper_version", versionId, {
      paper_id: paperId,
      document_type: documentType,
      source_quality: sourceQuality,
      version_number: versionNumber,
      replacement: isReplacement,
    })
    await connection.commit()
    return {
      paper: { ...paperRow, id: paperId },
      version: {
        id: versionId,
        paper_id: paperId,
        version_number: versionNumber,
        document_type: documentType,
        source_quality: sourceQuality,
        original_filename: fileName,
        file_path: filePath,
        mime_type: fileType,
        file_size: buffer.length,
        extraction_status: "uploaded",
      },
      processing_status: "uploaded",
    }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function readableWordCount(text) {
  return String(text || "").split(/\s+/).filter((word) => /[A-Za-z]{3}/.test(word)).length
}

async function extractTextFromFile(buffer, mimeType, filePath) {
  if (mimeType === "text/plain" || mimeType === "text/csv") return buffer.toString("utf8")
  if (mimeType === "application/pdf") {
    const text = await commandText("pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"])
    if (readableWordCount(text) > 15) return text.slice(0, 400000)
  }
  if (mimeType.startsWith("image/")) return ""
  const roughText = buffer.toString("utf8").replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ")
  return readableWordCount(roughText) > 20 ? roughText.slice(0, 160000) : ""
}

function splitPages(rawText) {
  const pages = String(rawText || "").split(/\f+/)
  if (pages.length > 1) return pages.map((text, index) => ({ page_number: index + 1, raw_text: text }))
  const lines = String(rawText || "").split("\n")
  const chunkSize = 90
  const chunks = []
  for (let index = 0; index < lines.length; index += chunkSize) {
    chunks.push({ page_number: chunks.length + 1, raw_text: lines.slice(index, index + chunkSize).join("\n") })
  }
  return chunks.length ? chunks : [{ page_number: 1, raw_text: "" }]
}

function repeatedLines(pages) {
  const counts = new Map()
  for (const page of pages) {
    const seen = new Set()
    String(page.raw_text || "").split("\n").slice(0, 8).concat(String(page.raw_text || "").split("\n").slice(-8)).forEach((line) => {
      const normalized = line.replace(/\s+/g, " ").trim().toLowerCase()
      if (normalized.length < 4 || /\d{1,3}/.test(normalized) && normalized.length < 12) return
      if (seen.has(normalized)) return
      seen.add(normalized)
      counts.set(normalized, (counts.get(normalized) || 0) + 1)
    })
  }
  return new Set([...counts.entries()].filter(([, count]) => count >= Math.max(2, Math.ceil(pages.length * 0.45))).map(([line]) => line))
}

function cleanPageText(rawText, repeatedSet) {
  const instructionPatterns = [
    /^candidate/i,
    /^centre number/i,
    /^time allowed/i,
    /^instructions? to candidates?/i,
    /^do not write/i,
    /^turn over/i,
    /^page \d+/i,
    /^\d+$/,
    /^copyright/i,
    /^total marks/i,
  ]
  return String(rawText || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => {
      if (!line) return false
      const normalized = line.toLowerCase()
      if (repeatedSet.has(normalized)) return false
      if (instructionPatterns.some((pattern) => pattern.test(line))) return false
      return true
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function questionStart(line) {
  const text = String(line || "").trim()
  const match = text.match(/^(?:question\s*)?(\d{1,2})(?:\s*[\).:-]|\s{2,})(.+)$/i)
  if (!match) return null
  if (Number(match[1]) > 30) return null
  return { number: match[1], rest: match[2].trim() }
}

function detectMarks(text) {
  const matches = [...String(text || "").matchAll(/(?:\(|\[)?(\d{1,3})\s*marks?(?:\)|\])?/gi)]
  if (!matches.length) return null
  const last = matches[matches.length - 1]
  const marks = Number(last[1])
  return marks > 0 && marks <= 100 ? marks : null
}

function candidateConfidence(block, sourceQuality) {
  let confidence = 0.36
  if (block.detected_question_number) confidence += 0.22
  if (block.detected_marks) confidence += 0.18
  if (block.question_text.length > 120) confidence += 0.14
  if (/\b(calculate|solve|find|show|prove|draw|construct|simplify|evaluate|determine)\b/i.test(block.question_text)) confidence += 0.07
  if (sourceQuality === "Original PDF") confidence += 0.06
  if (sourceQuality === "Scanned PDF" || sourceQuality === "Image") confidence -= 0.08
  return clamp(Number(confidence.toFixed(3)), 0.1, 0.98)
}

function detectQuestionCandidates(cleanedPages, sourceQuality) {
  const candidates = []
  let current = null
  const flush = () => {
    if (!current) return
    current.question_text = current.lines.join("\n").trim()
    current.detected_marks = detectMarks(current.question_text)
    current.confidence = candidateConfidence(current, sourceQuality)
    current.status = current.confidence < 0.62 ? "needs_review" : "pending_review"
    delete current.lines
    if (current.question_text.length > 20) candidates.push(current)
    current = null
  }
  for (const page of cleanedPages) {
    const lines = String(page.cleaned_text || "").split("\n")
    for (const line of lines) {
      const start = questionStart(line)
      if (start) {
        flush()
        current = {
          detected_question_number: start.number,
          lines: [start.rest || line],
          source_page_start: page.page_number,
          source_page_end: page.page_number,
        }
        continue
      }
      if (!current) {
        if (/\b\d+\s*marks?\b/i.test(line) || /\b(calculate|solve|find|show|draw|construct)\b/i.test(line)) {
          current = {
            detected_question_number: null,
            lines: [line],
            source_page_start: page.page_number,
            source_page_end: page.page_number,
          }
        }
        continue
      }
      current.lines.push(line)
      current.source_page_end = page.page_number
    }
  }
  flush()
  return candidates
}

function hasVisualSignal(text, word) {
  return new RegExp(`\\b${word}\\b`, "i").test(String(text || ""))
}

function commandWord(text) {
  const match = String(text || "").match(/\b(calculate|solve|find|show|prove|draw|construct|simplify|evaluate|determine|state|write|factorise|expand|differentiate|integrate)\b/i)
  return match ? match[1].toLowerCase() : null
}

function aiQuestionToCandidate(question) {
  const pages = Array.isArray(question.source_pages) ? question.source_pages.map(Number).filter(Boolean) : []
  const formulas = Array.isArray(question.formulas) ? question.formulas : []
  const tables = Array.isArray(question.tables) ? question.tables : []
  const diagramDescriptions = Array.isArray(question.diagram_descriptions) ? question.diagram_descriptions : []
  const graphDescriptions = Array.isArray(question.graph_descriptions) ? question.graph_descriptions : []
  const subparts = Array.isArray(question.subparts) ? question.subparts : []
  const subpartMarks = subparts.reduce((total, part) => total + (Number(part.marks || 0) || 0), 0)
  const marks = Number(question.marks || 0) || subpartMarks || detectMarks(question.question_text)
  const confidence = clamp(Number(question.confidence || 0.55), 0.1, 0.98)
  return {
    detected_question_number: cleanOptionalText(question.question_number),
    question_text: cleanText(question.question_text),
    detected_marks: marks || null,
    source_page_start: pages.length ? Math.min(...pages) : null,
    source_page_end: pages.length ? Math.max(...pages) : null,
    confidence,
    status: confidence < 0.72 ? "needs_review" : "pending_review",
    raw_json: {
      extraction_method: "ai",
      formulas,
      tables,
      diagram_descriptions: diagramDescriptions,
      graph_descriptions: graphDescriptions,
      subparts,
      formula_count: formulas.length,
      has_diagram: Boolean(question.has_diagram),
      has_graph: Boolean(question.has_graph),
      has_table: Boolean(question.has_table),
      command_word: question.command_word || commandWord(question.question_text),
      source_pages: pages,
    },
  }
}

function regexCandidateRawJson(candidate) {
  return {
    extraction_method: "regex",
    formulas: [],
    subparts: [],
    formula_count: 0,
    has_diagram: hasVisualSignal(candidate.question_text, "diagram"),
    has_graph: hasVisualSignal(candidate.question_text, "graph"),
    has_table: hasVisualSignal(candidate.question_text, "table"),
    command_word: commandWord(candidate.question_text),
  }
}

export async function runExtraction(userId, paperId, body = {}) {
  const requestedVersionId = intValue(body.version_id ?? body.versionId)
  const useAi = boolValue(body.use_ai ?? body.useAi, true)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[paper]] = await connection.query("SELECT * FROM exam_lab_papers WHERE id = ? LIMIT 1", [paperId])
    if (!paper) throw new HttpError(404, "Exam lab paper was not found")
    const [[version]] = await connection.query(
      `SELECT *
       FROM exam_lab_paper_versions
       WHERE paper_id = ? AND document_type = 'Question Paper' AND archived_at IS NULL
         AND (? = 0 OR id = ?)
       ORDER BY (? > 0 AND id = ?) DESC, is_primary DESC, is_trusted DESC, id DESC
       LIMIT 1`,
      [paperId, requestedVersionId, requestedVersionId, requestedVersionId, requestedVersionId],
    )
    if (!version) throw new HttpError(404, "Question paper upload version was not found")
    await connection.query("UPDATE exam_lab_paper_versions SET extraction_status = 'extracting' WHERE id = ?", [version.id])
    await logActivity(connection, userId, "extraction_started", "paper_version", version.id, { paper_id: paperId })
    await connection.commit()

    const fullPath = path.resolve(process.cwd(), String(version.file_path || "").replace(/^\/+/, ""))
    const buffer = await fs.readFile(fullPath)
    const imageDiagramExtraction = await extractVersionImageDiagrams({
      paperId,
      versionId: Number(version.id),
      fullPath,
      mimeType: version.mime_type,
      filePath: version.file_path,
    })
    const text = await extractTextFromFile(buffer, version.mime_type, fullPath)
    const rawPages = splitPages(text)
    const repeated = repeatedLines(rawPages)
    const cleanedPages = rawPages.map((page) => ({
      ...page,
      cleaned_text: cleanPageText(page.raw_text, repeated),
    }))
    const regexCandidates = detectQuestionCandidates(cleanedPages, version.source_quality).map((candidate) => ({
      ...candidate,
      raw_json: regexCandidateRawJson(candidate),
    }))
    let aiExtraction = null
    let aiCandidates = []
    if (useAi) {
      aiExtraction = await extractExamPaperWithAi(cleanedPages, {
        ...paper,
        version_id: version.id,
        source_quality: version.source_quality,
        userId,
        schoolId: null,
      })
      aiCandidates = (aiExtraction?.data?.questions || []).map(aiQuestionToCandidate)
    }
    const candidates = aiCandidates.length ? aiCandidates : regexCandidates
    const extractionMethod = aiCandidates.length ? "ai" : "regex"

    await connection.beginTransaction()
    await connection.query("DELETE FROM exam_lab_diagrams WHERE version_id = ? AND question_id IS NULL", [version.id])
    await connection.query("DELETE FROM exam_lab_paper_pages WHERE version_id = ?", [version.id])
    await connection.query(
      "DELETE FROM exam_lab_question_candidates WHERE version_id = ? AND accepted_question_id IS NULL",
      [version.id],
    )
    const versionDiagramStats = await saveVersionImageDiagrams(connection, { diagrams: imageDiagramExtraction.diagrams })
    for (const warning of imageDiagramExtraction.warnings || []) {
      await logExtraction(connection, paperId, version.id, "warning", warning, { source: "diagram_extraction" })
    }
    if (!text.trim()) {
      await connection.query(
        `INSERT INTO exam_lab_paper_pages (paper_id, version_id, page_number, raw_text, cleaned_text, status, error_reason)
         VALUES (?, ?, 1, '', '', 'failed', ?)`,
        [paperId, version.id, "OCR is not configured. Raw text extraction failed. Please enter this section manually or upload a clearer PDF."],
      )
      await logExtraction(connection, paperId, version.id, "error", "OCR is not configured. Raw text extraction failed.", { mime_type: version.mime_type })
      await connection.query(
        `UPDATE exam_lab_paper_versions
         SET extraction_status = 'failed', extraction_quality_score = 0, extraction_summary_json = ?
         WHERE id = ?`,
        [
          JSON.stringify({
            pages_processed: 1,
            candidates_detected: 0,
            failed_pages: 1,
            ocr_configured: false,
            image_diagrams_detected: versionDiagramStats.saved,
            duplicate_diagram_count: versionDiagramStats.duplicate_count,
            diagram_extraction_warnings: imageDiagramExtraction.warnings || [],
          }),
          version.id,
        ],
      )
      await logActivity(connection, userId, "extraction_failed", "paper_version", version.id, { paper_id: paperId, reason: "ocr_not_configured" })
      await connection.commit()
      return { ok: false, message: "OCR is not configured. Raw text extraction failed. Please enter this section manually or upload a clearer PDF.", paper_id: paperId, version_id: version.id }
    }

    let failedPages = 0
    for (const page of cleanedPages) {
      const status = page.cleaned_text ? "processed" : "failed"
      if (status === "failed") failedPages += 1
      await connection.query(
        `INSERT INTO exam_lab_paper_pages (paper_id, version_id, page_number, raw_text, cleaned_text, status, error_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          paperId,
          version.id,
          page.page_number,
          page.raw_text || "",
          page.cleaned_text || "",
          status,
          status === "failed" ? "No question text detected after cleaning. Review manually." : null,
        ],
      )
    }
    for (const section of aiExtraction?.data?.failed_sections || []) {
      failedPages += 1
      await connection.query(
        `UPDATE exam_lab_paper_pages
         SET status = 'failed',
          error_reason = ?
         WHERE version_id = ? AND page_number = ?`,
        [
          `AI unresolved section: ${cleanText(section.reason || "Needs manual review")}`,
          version.id,
          Number(section.page_number || 1),
        ],
      )
      await logExtraction(connection, paperId, version.id, "warning", `AI unresolved section on page ${Number(section.page_number || 1)}.`, {
        reason: section.reason || "Needs manual review",
        text_preview: cleanText(section.text).slice(0, 500),
      })
    }
    if (useAi && aiExtraction) {
      await logExtraction(
        connection,
        paperId,
        version.id,
        aiCandidates.length ? "info" : "warning",
        aiCandidates.length
          ? `AI extraction detected ${aiCandidates.length} question candidates.`
          : `AI extraction did not produce candidates; regex fallback detected ${regexCandidates.length}.`,
        {
          ok: Boolean(aiExtraction.ok),
          model: aiExtraction.model || null,
          message: aiExtraction.message || null,
          warnings: aiExtraction.data?.warnings || [],
        },
      )
    }
    const candidateDiagramStats = { saved: 0, duplicate_count: 0 }
    for (const candidate of candidates) {
      const [candidateResult] = await connection.query(
        `INSERT INTO exam_lab_question_candidates (
          paper_id, version_id, detected_question_number, question_text, detected_marks,
          source_page_start, source_page_end, confidence, status, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          paperId,
          version.id,
          candidate.detected_question_number,
          candidate.question_text,
          candidate.detected_marks || null,
          candidate.source_page_start,
          candidate.source_page_end,
          candidate.confidence,
          candidate.status,
          JSON.stringify(candidate.raw_json || regexCandidateRawJson(candidate)),
        ],
      )
      const signalStats = await saveCandidateDiagramSignals(connection, {
        paperId,
        versionId: Number(version.id),
        candidateId: Number(candidateResult.insertId),
        candidate: {
          ...candidate,
          paper_id: paperId,
          version_id: Number(version.id),
        },
      })
      candidateDiagramStats.saved += signalStats.saved
      candidateDiagramStats.duplicate_count += signalStats.duplicate_count
    }
    const lowConfidence = candidates.filter((candidate) => candidate.confidence < 0.62).length
    const qualityScore = candidates.length ? Math.round((candidates.reduce((total, item) => total + item.confidence, 0) / candidates.length) * 100) : 0
    const nextStatus = candidates.length ? (lowConfidence || failedPages ? "needs_review" : "extracted") : "failed"
    await connection.query(
      `UPDATE exam_lab_paper_versions
       SET extraction_status = ?, extraction_quality_score = ?, extraction_summary_json = ?
       WHERE id = ?`,
      [
        nextStatus,
        qualityScore,
        JSON.stringify({
          pages_processed: cleanedPages.length,
          candidates_detected: candidates.length,
          low_confidence_candidates: lowConfidence,
          failed_pages: failedPages,
          removed_repeated_lines: repeated.size,
          extraction_method: extractionMethod,
          ai_enabled_for_run: useAi,
          ai_model: aiExtraction?.model || null,
          ai_ok: Boolean(aiExtraction?.ok),
          ai_message: aiExtraction?.message || null,
          ai_warnings: aiExtraction?.data?.warnings || [],
          formula_candidates: candidates.filter((candidate) => (candidate.raw_json?.formulas || []).length).length,
          formula_count: candidates.reduce((total, candidate) => total + Number(candidate.raw_json?.formula_count || 0), 0),
          image_diagrams_detected: versionDiagramStats.saved,
          diagram_signal_count: candidateDiagramStats.saved,
          duplicate_diagram_count: versionDiagramStats.duplicate_count + candidateDiagramStats.duplicate_count,
          diagram_extraction_warnings: imageDiagramExtraction.warnings || [],
        }),
        version.id,
      ],
    )
    await logExtraction(connection, paperId, version.id, candidates.length ? "info" : "warning", `Detected ${candidates.length} question candidates using ${extractionMethod} extraction.`, { low_confidence: lowConfidence, failed_pages: failedPages })
    await logActivity(connection, userId, candidates.length ? "extraction_completed" : "extraction_failed", "paper_version", version.id, { paper_id: paperId, candidates: candidates.length, failed_pages: failedPages, extraction_method: extractionMethod })
    await connection.commit()
    return {
      ok: candidates.length > 0,
      paper_id: paperId,
      version_id: Number(version.id),
      pages_processed: cleanedPages.length,
      candidates_detected: candidates.length,
      low_confidence_candidates: lowConfidence,
      failed_pages: failedPages,
      extraction_status: nextStatus,
      extraction_quality_score: qualityScore,
      extraction_method: extractionMethod,
      ai_message: aiExtraction?.message || null,
      image_diagrams_detected: versionDiagramStats.saved,
      diagram_signal_count: candidateDiagramStats.saved,
      duplicate_diagram_count: versionDiagramStats.duplicate_count + candidateDiagramStats.duplicate_count,
    }
  } catch (error) {
    try {
      await connection.rollback()
    } catch {
      // Ignore rollback errors from already-closed transactions.
    }
    throw error
  } finally {
    connection.release()
  }
}

export async function getPaperReview(paperId) {
  const [[paper]] = await pool.query("SELECT * FROM exam_lab_papers WHERE id = ? LIMIT 1", [paperId])
  if (!paper) throw new HttpError(404, "Exam lab paper was not found")
  const [versions] = await pool.query(
    `SELECT * FROM exam_lab_paper_versions
     WHERE paper_id = ?
     ORDER BY document_type, version_number DESC`,
    [paperId],
  )
  const primaryVersion = versions.find((version) => version.document_type === "Question Paper" && Number(version.is_primary)) || versions.find((version) => version.document_type === "Question Paper")
  const [pages] = primaryVersion
    ? await pool.query("SELECT * FROM exam_lab_paper_pages WHERE version_id = ? ORDER BY page_number", [primaryVersion.id])
    : [[]]
  const [candidates] = primaryVersion
    ? await pool.query(
        `SELECT *
         FROM exam_lab_question_candidates
         WHERE version_id = ?
         ORDER BY COALESCE(source_page_start, 999), id`,
        [primaryVersion.id],
      )
    : [[]]
  const [logs] = primaryVersion
    ? await pool.query("SELECT * FROM exam_lab_extraction_logs WHERE version_id = ? ORDER BY created_at DESC, id DESC LIMIT 80", [primaryVersion.id])
    : [[]]
  const [diagrams] = primaryVersion
    ? await pool.query(
        `SELECT *
         FROM exam_lab_diagrams
         WHERE version_id = ?
         ORDER BY COALESCE(page_number, 999), id`,
        [primaryVersion.id],
      )
    : [[]]
  return {
    paper,
    versions: versions.map((row) => ({ ...row, extraction_summary_json: parseJson(row.extraction_summary_json, null) })),
    active_version: primaryVersion ? { ...primaryVersion, extraction_summary_json: parseJson(primaryVersion.extraction_summary_json, null) } : null,
    pages,
    candidates: candidates.map((row) => ({ ...row, raw_json: parseJson(row.raw_json, null) })),
    diagrams: diagrams.map((row) => ({
      ...row,
      formulas_json: parseJson(row.formulas_json, []),
      tables_json: parseJson(row.tables_json, []),
      metadata_json: parseJson(row.metadata_json, null),
    })),
    logs: logs.map((row) => ({ ...row, details_json: parseJson(row.details_json, null) })),
  }
}

export async function updateCandidate(userId, candidateId, body = {}) {
  const [[candidate]] = await pool.query("SELECT * FROM exam_lab_question_candidates WHERE id = ? LIMIT 1", [candidateId])
  if (!candidate) throw new HttpError(404, "Question candidate was not found")
  const action = cleanText(body.action)
  const statusByAction = {
    reject: "rejected",
    duplicate: "duplicate",
    instruction: "instruction_header",
    needs_manual_fix: "needs_manual_fix",
    needs_review: "needs_review",
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    if (body.question_text !== undefined || body.detected_marks !== undefined || body.detected_question_number !== undefined) {
      await connection.query(
        `UPDATE exam_lab_question_candidates
         SET question_text = COALESCE(?, question_text),
          detected_marks = COALESCE(?, detected_marks),
          detected_question_number = COALESCE(?, detected_question_number),
          reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          body.question_text === undefined ? null : cleanText(body.question_text),
          body.detected_marks === undefined ? null : intValue(body.detected_marks, null),
          body.detected_question_number === undefined ? null : cleanOptionalText(body.detected_question_number),
          userId,
          candidateId,
        ],
      )
    }
    if (action === "merge_previous") {
      const [[previous]] = await connection.query(
        `SELECT *
         FROM exam_lab_question_candidates
         WHERE version_id = ? AND id < ?
         ORDER BY id DESC
         LIMIT 1`,
        [candidate.version_id, candidate.id],
      )
      if (!previous) throw new HttpError(400, "There is no previous candidate to merge with")
      await connection.query(
        `UPDATE exam_lab_question_candidates
         SET question_text = CONCAT(question_text, '\n\n', ?), reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [cleanText(body.question_text || candidate.question_text), userId, previous.id],
      )
      await connection.query(
        `UPDATE exam_lab_question_candidates
         SET status = 'duplicate', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [userId, candidateId],
      )
    } else if (action === "split" && Array.isArray(body.parts) && body.parts.length > 1) {
      await connection.query(
        `UPDATE exam_lab_question_candidates
         SET status = 'duplicate', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [userId, candidateId],
      )
      for (const [index, part] of body.parts.entries()) {
        const text = cleanText(part.question_text || part.text)
        if (!text) continue
        await connection.query(
          `INSERT INTO exam_lab_question_candidates (
            paper_id, version_id, detected_question_number, question_text, detected_marks,
            source_page_start, source_page_end, confidence, status, raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)`,
          [
            candidate.paper_id,
            candidate.version_id,
            cleanOptionalText(part.detected_question_number || `${candidate.detected_question_number || ""}${String.fromCharCode(97 + index)}`),
            text,
            intValue(part.detected_marks || detectMarks(text), null),
            candidate.source_page_start,
            candidate.source_page_end,
            0.65,
            JSON.stringify({ split_from_candidate_id: candidate.id }),
          ],
        )
      }
    } else if (statusByAction[action]) {
      await connection.query(
        `UPDATE exam_lab_question_candidates
         SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [statusByAction[action], userId, candidateId],
      )
    }
    await logActivity(connection, userId, `question_candidate_${action || "updated"}`, "question_candidate", candidateId, { paper_id: candidate.paper_id })
    await connection.commit()
    return { ok: true }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function acceptCandidate(userId, candidateId, body = {}) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[candidate]] = await connection.query("SELECT * FROM exam_lab_question_candidates WHERE id = ? LIMIT 1", [candidateId])
    if (!candidate) throw new HttpError(404, "Question candidate was not found")
    if (candidate.accepted_question_id) {
      await connection.commit()
      return { question_id: Number(candidate.accepted_question_id), already_accepted: true }
    }
    const [[paper]] = await connection.query("SELECT * FROM exam_lab_papers WHERE id = ? LIMIT 1", [candidate.paper_id])
    if (!paper) throw new HttpError(404, "Exam lab paper was not found")
    const questionText = cleanText(body.question_text || candidate.question_text)
    if (!questionText) throw new HttpError(400, "Question text is required")
    const raw = parseJson(candidate.raw_json, {})
    const acceptedHasDiagram = boolValue(body.has_diagram ?? raw?.has_diagram)
    const acceptedHasGraph = boolValue(body.has_graph ?? raw?.has_graph)
    const acceptedHasTable = boolValue(body.has_table ?? raw?.has_table)
    const [result] = await connection.query(
      `INSERT INTO exam_lab_questions (
        paper_id, version_id, candidate_id, exam_board, exam_level, subject, paper, exam_year,
        question_number, question_text, marks, extraction_confidence, source_page,
        has_diagram, has_graph, has_table, command_word, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paper.id,
        candidate.version_id,
        candidate.id,
        paper.exam_board,
        paper.exam_level,
        paper.subject,
        paper.paper,
        paper.exam_year,
        cleanOptionalText(body.question_number || body.detected_question_number || candidate.detected_question_number),
        questionText,
        intValue(body.marks ?? candidate.detected_marks, 0),
        Number(candidate.confidence || 0),
        candidate.source_page_start || null,
        acceptedHasDiagram ? 1 : 0,
        acceptedHasGraph ? 1 : 0,
        acceptedHasTable ? 1 : 0,
        cleanOptionalText(body.command_word || raw?.command_word || commandWord(questionText)),
        userId,
      ],
    )
    const questionId = Number(result.insertId)
    await saveCandidateDiagramSignals(connection, {
      paperId: paper.id,
      versionId: Number(candidate.version_id),
      candidateId: Number(candidate.id),
      candidate: {
        ...candidate,
        raw_json: raw,
      },
    })
    await linkCandidateDiagramsToQuestion(connection, { candidateId: Number(candidate.id), questionId })
    if (acceptedHasDiagram || acceptedHasGraph || acceptedHasTable) {
      await linkVersionImageDiagramsToQuestion(connection, {
        versionId: Number(candidate.version_id),
        candidateId: Number(candidate.id),
        questionId,
        sourcePageStart: candidate.source_page_start,
        sourcePageEnd: candidate.source_page_end,
      })
    }
    await connection.query(
      `UPDATE exam_lab_question_candidates
       SET status = 'accepted', accepted_question_id = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [questionId, userId, candidate.id],
    )
    await logActivity(connection, userId, "question_accepted", "question", questionId, { candidate_id: candidate.id, paper_id: paper.id })
    await connection.commit()
    return { question_id: questionId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function listQuestions(filters = {}) {
  const scope = normalizeScope(filters)
  const params = [scope.exam_board, scope.exam_level, scope.subject]
  const clauses = ["q.exam_board = ?", "q.exam_level = ?", "q.subject = ?", "q.status <> 'archived'"]
  if (filters.year) {
    clauses.push("q.exam_year = ?")
    params.push(intValue(filters.year))
  }
  if (filters.paper) {
    clauses.push("q.paper = ?")
    params.push(normalizePaper(filters.paper))
  }
  if (filters.topic_id || filters.topicId) {
    clauses.push("q.topic_id = ?")
    params.push(intValue(filters.topic_id ?? filters.topicId))
  }
  if (filters.subtopic_id || filters.subtopicId) {
    clauses.push("q.subtopic_id = ?")
    params.push(intValue(filters.subtopic_id ?? filters.subtopicId))
  }
  if (filters.tagging_status === "untagged") clauses.push("q.topic_id IS NULL")
  if (filters.tagging_status === "tagged") clauses.push("q.topic_id IS NOT NULL")
  if (filters.verified === "true" || filters.verified === true) clauses.push("q.verified = 1")
  if (filters.verified === "false" || filters.verified === false) clauses.push("q.verified = 0")
  if (filters.min_confidence) {
    clauses.push("q.extraction_confidence >= ?")
    params.push(Number(filters.min_confidence))
  }
  if (filters.has_diagram) clauses.push("q.has_diagram = 1")
  if (filters.has_graph) clauses.push("q.has_graph = 1")
  if (filters.has_table) clauses.push("q.has_table = 1")
  if (filters.search) {
    clauses.push("(q.question_text LIKE ? OR t.name LIKE ? OR st.name LIKE ?)")
    const term = `%${cleanText(filters.search)}%`
    params.push(term, term, term)
  }
  const [questions] = await pool.query(
    `SELECT q.*, t.name AS topic_name, st.name AS subtopic_name, sk.name AS skill_name
     FROM exam_lab_questions q
     LEFT JOIN exam_lab_topics t ON t.id = q.topic_id
     LEFT JOIN exam_lab_subtopics st ON st.id = q.subtopic_id
     LEFT JOIN exam_lab_skills sk ON sk.id = q.skill_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY q.exam_year DESC, q.paper, LPAD(COALESCE(q.question_number, q.id), 8, '0'), q.id DESC
     LIMIT 500`,
    params,
  )
  return { questions }
}

async function normalizeQuestionTaxonomy(connection, next = {}) {
  const normalized = {
    ...next,
    topic_id: intValue(next.topic_id, 0) || null,
    subtopic_id: intValue(next.subtopic_id, 0) || null,
    skill_id: intValue(next.skill_id, 0) || null,
  }
  if (!normalized.topic_id) {
    normalized.subtopic_id = null
    normalized.skill_id = null
    return normalized
  }

  const [[topic]] = await connection.query(
    "SELECT id FROM exam_lab_topics WHERE id = ? AND archived_at IS NULL LIMIT 1",
    [normalized.topic_id],
  )
  if (!topic) throw new HttpError(400, "Select a valid exam lab topic")

  if (normalized.subtopic_id) {
    const [[subtopic]] = await connection.query(
      "SELECT id, topic_id FROM exam_lab_subtopics WHERE id = ? AND archived_at IS NULL LIMIT 1",
      [normalized.subtopic_id],
    )
    if (!subtopic || Number(subtopic.topic_id) !== Number(normalized.topic_id)) {
      normalized.subtopic_id = null
      normalized.skill_id = null
    }
  }

  if (normalized.skill_id) {
    const [[skill]] = await connection.query(
      "SELECT id, topic_id, subtopic_id FROM exam_lab_skills WHERE id = ? AND archived_at IS NULL LIMIT 1",
      [normalized.skill_id],
    )
    const skillTopicMatches = skill && Number(skill.topic_id) === Number(normalized.topic_id)
    const skillSubtopicMatches = !skill?.subtopic_id || !normalized.subtopic_id || Number(skill.subtopic_id) === Number(normalized.subtopic_id)
    if (!skillTopicMatches || !skillSubtopicMatches) {
      normalized.skill_id = null
    } else if (!normalized.subtopic_id && skill.subtopic_id) {
      normalized.subtopic_id = Number(skill.subtopic_id)
    }
  }

  return normalized
}

export async function createManualQuestion(userId, body = {}) {
  const scope = normalizeScope(body)
  const year = intValue(body.exam_year ?? body.year)
  if (!year) throw new HttpError(400, "Year is required")
  const paper = normalizePaper(body.paper)
  const questionText = cleanText(body.question_text || body.text)
  if (!questionText) throw new HttpError(400, "Question text is required")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await connection.query(
      `INSERT INTO exam_lab_papers (exam_board, exam_level, subject, paper, exam_year, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_by = VALUES(updated_by), status = 'active'`,
      [scope.exam_board, scope.exam_level, scope.subject, paper, year, userId, userId],
    )
    const [[paperRow]] = await connection.query(
      `SELECT * FROM exam_lab_papers
       WHERE exam_board = ? AND exam_level = ? AND subject = ? AND paper = ? AND exam_year = ?
       LIMIT 1`,
      [scope.exam_board, scope.exam_level, scope.subject, paper, year],
    )
    const taxonomy = await normalizeQuestionTaxonomy(connection, {
      topic_id: body.topic_id ?? body.topicId,
      subtopic_id: body.subtopic_id ?? body.subtopicId,
      skill_id: body.skill_id ?? body.skillId,
    })
    const [result] = await connection.query(
      `INSERT INTO exam_lab_questions (
        paper_id, exam_board, exam_level, subject, paper, exam_year, question_number,
        question_text, marks, topic_id, subtopic_id, skill_id, difficulty, question_type,
        command_word, has_diagram, has_graph, has_table, tagging_confidence, status,
        verified, use_for_training, notes, created_by, verified_by, verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        paperRow.id,
        scope.exam_board,
        scope.exam_level,
        scope.subject,
        paper,
        year,
        cleanOptionalText(body.question_number || body.questionNumber),
        questionText,
        intValue(body.marks, 0),
        taxonomy.topic_id,
        taxonomy.subtopic_id,
        taxonomy.skill_id,
        normalizeDifficulty(body.difficulty),
        cleanOptionalText(body.question_type || body.questionType),
        cleanOptionalText(body.command_word || commandWord(questionText)),
        boolValue(body.has_diagram ?? body.hasDiagram) ? 1 : 0,
        boolValue(body.has_graph ?? body.hasGraph) ? 1 : 0,
        boolValue(body.has_table ?? body.hasTable) ? 1 : 0,
        confidenceValue(body.tagging_confidence ?? body.taggingConfidence, 0),
        boolValue(body.verified) ? "verified" : taxonomy.topic_id ? "tagged" : "accepted",
        boolValue(body.verified) ? 1 : 0,
        boolValue(body.use_for_training ?? body.useForTraining, true) ? 1 : 0,
        cleanOptionalText(body.notes),
        userId,
        boolValue(body.verified) ? userId : null,
        boolValue(body.verified) ? new Date() : null,
      ],
    )
    const questionId = Number(result.insertId)
    await logActivity(connection, userId, "question_manually_created", "question", questionId, { paper_id: paperRow.id })
    await connection.commit()
    return { question_id: questionId }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function updateQuestion(userId, questionId, body = {}) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[current]] = await connection.query("SELECT * FROM exam_lab_questions WHERE id = ? LIMIT 1", [questionId])
    if (!current) throw new HttpError(404, "Exam lab question was not found")
    if (current.verified && !boolValue(body.confirm_verified_replace, false) && (
      body.question_text !== undefined || body.topic_id !== undefined || body.subtopic_id !== undefined || body.marks !== undefined
    )) {
      throw new HttpError(409, "This question is verified. Confirm before replacing verified data.")
    }
    const next = {
      question_text: body.question_text === undefined ? current.question_text : cleanText(body.question_text),
      marks: body.marks === undefined ? current.marks : intValue(body.marks, current.marks),
      topic_id: body.topic_id === undefined && body.topicId === undefined ? current.topic_id : intValue(body.topic_id ?? body.topicId, 0) || null,
      subtopic_id: body.subtopic_id === undefined && body.subtopicId === undefined ? current.subtopic_id : intValue(body.subtopic_id ?? body.subtopicId, 0) || null,
      skill_id: body.skill_id === undefined && body.skillId === undefined ? current.skill_id : intValue(body.skill_id ?? body.skillId, 0) || null,
      difficulty: body.difficulty === undefined ? current.difficulty : normalizeDifficulty(body.difficulty),
      question_type: body.question_type === undefined && body.questionType === undefined ? current.question_type : cleanOptionalText(body.question_type ?? body.questionType),
      command_word: body.command_word === undefined && body.commandWord === undefined ? current.command_word : cleanOptionalText(body.command_word ?? body.commandWord),
      has_diagram: body.has_diagram === undefined && body.hasDiagram === undefined ? current.has_diagram : boolValue(body.has_diagram ?? body.hasDiagram) ? 1 : 0,
      has_graph: body.has_graph === undefined && body.hasGraph === undefined ? current.has_graph : boolValue(body.has_graph ?? body.hasGraph) ? 1 : 0,
      has_table: body.has_table === undefined && body.hasTable === undefined ? current.has_table : boolValue(body.has_table ?? body.hasTable) ? 1 : 0,
      tagging_confidence: body.tagging_confidence === undefined && body.taggingConfidence === undefined
        ? confidenceValue(current.tagging_confidence, 0)
        : confidenceValue(body.tagging_confidence ?? body.taggingConfidence, current.tagging_confidence),
      verified: body.verified === undefined ? current.verified : boolValue(body.verified) ? 1 : 0,
      notes: body.notes === undefined ? current.notes : cleanOptionalText(body.notes),
    }
    const normalizedNext = await normalizeQuestionTaxonomy(connection, next)
    const status = normalizedNext.verified ? "verified" : normalizedNext.topic_id ? "tagged" : cleanText(body.status || current.status || "accepted")
    await connection.query(
      `UPDATE exam_lab_questions
       SET question_text = ?, marks = ?, topic_id = ?, subtopic_id = ?, skill_id = ?,
        difficulty = ?, question_type = ?, command_word = ?, has_diagram = ?, has_graph = ?,
        has_table = ?, tagging_confidence = ?, verified = ?, status = ?, notes = ?,
        verified_by = IF(? = 1, ?, verified_by), verified_at = IF(? = 1, CURRENT_TIMESTAMP, verified_at)
       WHERE id = ?`,
      [
        normalizedNext.question_text,
        normalizedNext.marks,
        normalizedNext.topic_id,
        normalizedNext.subtopic_id,
        normalizedNext.skill_id,
        normalizedNext.difficulty,
        normalizedNext.question_type,
        normalizedNext.command_word,
        normalizedNext.has_diagram,
        normalizedNext.has_graph,
        normalizedNext.has_table,
        normalizedNext.tagging_confidence,
        normalizedNext.verified,
        status,
        normalizedNext.notes,
        normalizedNext.verified,
        userId,
        normalizedNext.verified,
        questionId,
      ],
    )
    await connection.query(
      `INSERT INTO exam_lab_question_tagging_history (question_id, changed_by, previous_json, next_json)
       VALUES (?, ?, ?, ?)`,
      [questionId, userId, JSON.stringify(current), JSON.stringify(normalizedNext)],
    )
    await logActivity(connection, userId, normalizedNext.verified ? "question_verified" : "question_tagged", "question", questionId, { paper_id: current.paper_id })
    await connection.commit()
    return { ok: true }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function archiveQuestion(userId, questionId) {
  const [result] = await pool.query(
    "UPDATE exam_lab_questions SET status = 'archived', archived_at = CURRENT_TIMESTAMP WHERE id = ?",
    [questionId],
  )
  if (!result.affectedRows) throw new HttpError(404, "Exam lab question was not found")
  const connection = await pool.getConnection()
  try {
    await logActivity(connection, userId, "question_archived", "question", questionId)
  } finally {
    connection.release()
  }
  return { ok: true }
}

export async function listTopicMap(scopeInput = {}) {
  const scope = normalizeScope(scopeInput)
  await ensureDefaultTopicMap(scope)
  const [topics] = await pool.query(
    `SELECT t.*,
      COUNT(DISTINCT st.id) AS subtopic_count,
      COUNT(DISTINCT sk.id) AS skill_count,
      COUNT(DISTINCT q.id) AS question_count
     FROM exam_lab_topics t
     LEFT JOIN exam_lab_subtopics st ON st.topic_id = t.id AND st.archived_at IS NULL
     LEFT JOIN exam_lab_skills sk ON sk.topic_id = t.id AND sk.archived_at IS NULL
     LEFT JOIN exam_lab_questions q ON q.topic_id = t.id AND q.status <> 'archived'
     WHERE t.exam_board = ? AND t.exam_level = ? AND t.subject = ? AND t.archived_at IS NULL
     GROUP BY t.id
     ORDER BY t.order_number, t.name`,
    [scope.exam_board, scope.exam_level, scope.subject],
  )
  const topicIds = topics.map((row) => Number(row.id))
  const [subtopics] = topicIds.length
    ? await pool.query(
        `SELECT st.*, COUNT(q.id) AS question_count
         FROM exam_lab_subtopics st
         LEFT JOIN exam_lab_questions q ON q.subtopic_id = st.id AND q.status <> 'archived'
         WHERE st.topic_id IN (${topicIds.map(() => "?").join(",")}) AND st.archived_at IS NULL
         GROUP BY st.id
         ORDER BY st.order_number, st.name`,
        topicIds,
      )
    : [[]]
  const [skills] = topicIds.length
    ? await pool.query(
        `SELECT *
         FROM exam_lab_skills
         WHERE topic_id IN (${topicIds.map(() => "?").join(",")}) AND archived_at IS NULL
         ORDER BY name`,
        topicIds,
      )
    : [[]]
  return { topics, subtopics, skills }
}

export async function saveTopic(userId, body = {}) {
  const scope = normalizeScope(body)
  const topicId = intValue(body.id || body.topic_id || body.topicId)
  const name = cleanText(body.name || body.topic_name || body.topicName)
  if (!name) throw new HttpError(400, "Topic name is required")
  if (topicId) {
    await pool.query(
      `UPDATE exam_lab_topics
       SET name = ?, description = ?, syllabus_weight = ?, order_number = ?, updated_by = ?
       WHERE id = ?`,
      [name, cleanOptionalText(body.description), Number(body.syllabus_weight ?? body.syllabusWeight ?? 1), intValue(body.order_number ?? body.orderNumber, 0), userId, topicId],
    )
    return { topic_id: topicId }
  }
  const [result] = await pool.query(
    `INSERT INTO exam_lab_topics (exam_board, exam_level, subject, name, description, syllabus_weight, order_number, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description), archived_at = NULL, updated_by = VALUES(updated_by)`,
    [scope.exam_board, scope.exam_level, scope.subject, name, cleanOptionalText(body.description), Number(body.syllabus_weight ?? body.syllabusWeight ?? 1), intValue(body.order_number ?? body.orderNumber, 0), userId, userId],
  )
  return { topic_id: Number(result.insertId || topicId) }
}

export async function saveSubtopic(body = {}) {
  const subtopicId = intValue(body.id || body.subtopic_id || body.subtopicId)
  const topicId = intValue(body.topic_id || body.topicId)
  const name = cleanText(body.name || body.subtopic_name || body.subtopicName)
  if (!topicId || !name) throw new HttpError(400, "Topic and subtopic name are required")
  if (subtopicId) {
    await pool.query(
      `UPDATE exam_lab_subtopics SET name = ?, description = ?, order_number = ? WHERE id = ? AND topic_id = ?`,
      [name, cleanOptionalText(body.description), intValue(body.order_number ?? body.orderNumber, 0), subtopicId, topicId],
    )
    return { subtopic_id: subtopicId }
  }
  const [result] = await pool.query(
    `INSERT INTO exam_lab_subtopics (topic_id, name, description, order_number)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description), archived_at = NULL`,
    [topicId, name, cleanOptionalText(body.description), intValue(body.order_number ?? body.orderNumber, 0)],
  )
  return { subtopic_id: Number(result.insertId || 0) }
}

export async function saveSkill(body = {}) {
  const skillId = intValue(body.id || body.skill_id || body.skillId)
  const topicId = intValue(body.topic_id || body.topicId)
  const subtopicId = intValue(body.subtopic_id || body.subtopicId, 0) || null
  const name = cleanText(body.name || body.skill_name || body.skillName)
  if (!topicId || !name) throw new HttpError(400, "Topic and skill name are required")
  if (skillId) {
    await pool.query(
      `UPDATE exam_lab_skills SET name = ?, description = ?, subtopic_id = ? WHERE id = ? AND topic_id = ?`,
      [name, cleanOptionalText(body.description), subtopicId, skillId, topicId],
    )
    return { skill_id: skillId }
  }
  const [result] = await pool.query(
    `INSERT INTO exam_lab_skills (topic_id, subtopic_id, name, description)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE description = VALUES(description), archived_at = NULL`,
    [topicId, subtopicId, name, cleanOptionalText(body.description)],
  )
  return { skill_id: Number(result.insertId || 0) }
}

export async function archiveTopicEntity(userId, entityType, id) {
  const tableByType = { topic: "exam_lab_topics", subtopic: "exam_lab_subtopics", skill: "exam_lab_skills" }
  const table = tableByType[entityType]
  if (!table) throw new HttpError(400, "Unsupported topic-map entity")
  const [result] = await pool.query(`UPDATE ${table} SET archived_at = CURRENT_TIMESTAMP WHERE id = ?`, [id])
  if (!result.affectedRows) throw new HttpError(404, "Topic-map entity was not found")
  const connection = await pool.getConnection()
  try {
    await logActivity(connection, userId, "topic_map_edited", entityType, id, { archived: true })
  } finally {
    connection.release()
  }
  return { ok: true }
}

export async function createMarkScheme(userId, body = {}) {
  const paperId = intValue(body.paper_id || body.paperId)
  if (!paperId) throw new HttpError(400, "Paper is required")
  const [result] = await pool.query(
    `INSERT INTO exam_lab_mark_schemes (
      paper_id, version_id, question_id, question_number, total_marks, mark_breakdown,
      correct_answer, method_marks, accuracy_marks, common_mistakes, notes, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      paperId,
      intValue(body.version_id || body.versionId, 0) || null,
      intValue(body.question_id || body.questionId, 0) || null,
      cleanOptionalText(body.question_number || body.questionNumber),
      intValue(body.total_marks || body.totalMarks, 0),
      cleanOptionalText(body.mark_breakdown || body.markBreakdown),
      cleanOptionalText(body.correct_answer || body.correctAnswer),
      cleanOptionalText(body.method_marks || body.methodMarks),
      cleanOptionalText(body.accuracy_marks || body.accuracyMarks),
      cleanOptionalText(body.common_mistakes || body.commonMistakes),
      cleanOptionalText(body.notes),
      userId,
    ],
  )
  return { mark_scheme_id: Number(result.insertId) }
}

function yearRangeClause(startYear, endYear, alias = "q") {
  return `${alias}.exam_year BETWEEN ${Number(startYear)} AND ${Number(endYear)}`
}

async function loadBacktestQuestions(scope, paper, startYear, endYear) {
  const [rows] = await pool.query(
    `SELECT q.*, t.name AS topic_name, st.name AS subtopic_name, COALESCE(t.syllabus_weight, 1) AS syllabus_weight
     FROM exam_lab_questions q
     JOIN exam_lab_topics t ON t.id = q.topic_id
     LEFT JOIN exam_lab_subtopics st ON st.id = q.subtopic_id
     WHERE q.exam_board = ? AND q.exam_level = ? AND q.subject = ? AND q.paper = ?
       AND ${yearRangeClause(startYear, endYear)}
       AND q.status <> 'archived'
       AND q.topic_id IS NOT NULL
       AND q.use_for_training = 1`,
    [scope.exam_board, scope.exam_level, scope.subject, paper],
  )
  return rows
}

async function loadBacktestDiagrams(scope, paper, startYear, endYear) {
  const [rows] = await pool.query(
    `SELECT d.id, d.question_id, d.diagram_kind, d.source_type, d.image_hash, d.metadata_hash,
      d.perceptual_hash, d.duplicate_of_diagram_id, d.description, d.width_px, d.height_px,
      q.exam_year, q.topic_id, t.name AS topic_name
     FROM exam_lab_diagrams d
     JOIN exam_lab_questions q ON q.id = d.question_id
     JOIN exam_lab_topics t ON t.id = q.topic_id
     WHERE q.exam_board = ? AND q.exam_level = ? AND q.subject = ? AND q.paper = ?
       AND ${yearRangeClause(startYear, endYear)}
       AND q.status <> 'archived'
       AND q.topic_id IS NOT NULL
       AND q.use_for_training = 1`,
    [scope.exam_board, scope.exam_level, scope.subject, paper],
  )
  return rows
}

function diagramPatternMap(rows = []) {
  const patterns = new Map()
  for (const row of rows) {
    const fingerprint = diagramFingerprint(row)
    if (!fingerprint) continue
    const current = patterns.get(fingerprint) || {
      fingerprint,
      years: new Set(),
      topics: new Set(),
      kinds: new Set(),
      question_ids: new Set(),
      source_types: new Set(),
      description: cleanOptionalText(row.description),
    }
    current.years.add(Number(row.exam_year))
    if (row.topic_name) current.topics.add(row.topic_name)
    if (row.diagram_kind) current.kinds.add(row.diagram_kind)
    if (row.question_id) current.question_ids.add(Number(row.question_id))
    if (row.source_type) current.source_types.add(row.source_type)
    if (!current.description && row.description) current.description = cleanOptionalText(row.description)
    patterns.set(fingerprint, current)
  }
  return patterns
}

function diagramPatternSummary(pattern, trainingPattern = null) {
  return {
    fingerprint: String(pattern.fingerprint || "").slice(0, 16),
    diagram_kinds: [...pattern.kinds].sort(),
    topics: [...pattern.topics].sort(),
    years: [...pattern.years].sort((a, b) => a - b),
    question_ids: [...pattern.question_ids].sort((a, b) => a - b).slice(0, 8),
    seen_in_training_years: trainingPattern ? [...trainingPattern.years].sort((a, b) => a - b) : [],
    seen_in_training_topics: trainingPattern ? [...trainingPattern.topics].sort() : [],
    source_types: [...pattern.source_types].sort(),
    description: cleanOptionalText(pattern.description)?.slice(0, 220) || null,
  }
}

function normalizeScores(items, key) {
  const values = items.map((item) => Number(item[key] || 0))
  const max = Math.max(1, ...values)
  return items.map((item) => ({ ...item, [`${key}_score`]: Number(item[key] || 0) / max }))
}

function confidenceFromWarnings(warnings, marksCoverage) {
  if (warnings.length >= 3 || marksCoverage < 35) return "low"
  if (warnings.length || marksCoverage < 65) return "medium"
  return "high"
}

export async function runBacktest(userId, body = {}) {
  const scope = normalizeScope(body)
  const paper = normalizePaper(body.paper)
  const trainingStart = intValue(body.training_start_year ?? body.trainingStartYear)
  const trainingEnd = intValue(body.training_end_year ?? body.trainingEndYear)
  const testYear = intValue(body.test_year ?? body.testYear)
  if (!trainingStart || !trainingEnd || !testYear) throw new HttpError(400, "Training years and test year are required")
  if (trainingEnd >= testYear) throw new HttpError(400, "Backtest target-year leakage blocked: training end year must be before the test year")
  const predictedTopicCount = clamp(intValue(body.predicted_topic_count ?? body.predictedTopicCount, 10), 1, 20)
  const method = cleanText(body.prediction_method || body.predictionMethod || "recency_frequency_marks")
  const includeSubtopics = boolValue(body.include_subtopics ?? body.includeSubtopics, true)
  const includeMarkWeight = boolValue(body.include_mark_weight ?? body.includeMarkWeight, true)
  const trainingRows = await loadBacktestQuestions(scope, paper, trainingStart, trainingEnd)
  const testRows = await loadBacktestQuestions(scope, paper, testYear, testYear)
  const trainingDiagrams = await loadBacktestDiagrams(scope, paper, trainingStart, trainingEnd)
  const testDiagrams = await loadBacktestDiagrams(scope, paper, testYear, testYear)
  if (!trainingRows.length) throw new HttpError(400, "Backtest needs tagged training questions before the test year")
  if (!testRows.length) throw new HttpError(400, "Backtest needs tagged test-year questions. Untagged test years are refused.")
  const trainingDiagramPatterns = diagramPatternMap(trainingDiagrams)
  const testDiagramPatterns = diagramPatternMap(testDiagrams)

  const byTopic = new Map()
  for (const row of trainingRows) {
    const key = String(row.topic_id)
    const current = byTopic.get(key) || {
      topic_id: Number(row.topic_id),
      topic: row.topic_name,
      frequency: 0,
      marks: 0,
      years: new Set(),
      recent_weighted: 0,
      syllabus_weight: Number(row.syllabus_weight || 1),
      subtopics: new Map(),
      diagram_fingerprints: new Set(),
      diagram_years: new Set(),
      diagram_count: 0,
    }
    const yearWeight = 1 / Math.max(1, trainingEnd - Number(row.exam_year) + 1)
    current.frequency += 1
    current.marks += Number(row.marks || 0)
    current.years.add(Number(row.exam_year))
    current.recent_weighted += yearWeight
    if (row.subtopic_id) current.subtopics.set(Number(row.subtopic_id), row.subtopic_name)
    byTopic.set(key, current)
  }
  for (const diagram of trainingDiagrams) {
    const fingerprint = diagramFingerprint(diagram)
    const current = byTopic.get(String(diagram.topic_id))
    if (!fingerprint || !current) continue
    current.diagram_fingerprints.add(fingerprint)
    current.diagram_years.add(Number(diagram.exam_year))
    current.diagram_count += 1
  }
  let scored = [...byTopic.values()].map((topic) => {
    const lastSeen = Math.max(...topic.years)
    const yearsSinceLastSeen = trainingEnd - lastSeen
    return {
      ...topic,
      years_seen: [...topic.years].sort((a, b) => a - b),
      years_since_last_seen: yearsSinceLastSeen,
      years_since_last_seen_raw: yearsSinceLastSeen <= 0 ? 0.2 : Math.min(1, yearsSinceLastSeen / 8),
      average_marks: topic.marks / Math.max(1, topic.frequency),
      paper_pattern_raw: topic.years.size / Math.max(1, trainingEnd - trainingStart + 1),
      diagram_pattern_raw: topic.diagram_fingerprints.size / Math.max(1, trainingDiagramPatterns.size),
    }
  })
  scored = normalizeScores(normalizeScores(normalizeScores(normalizeScores(scored, "frequency"), "recent_weighted"), "average_marks"), "diagram_pattern_raw")
  scored = scored.map((topic) => {
    const frequencyOnly = topic.frequency_score
    const score = method === "frequency_only"
      ? frequencyOnly
      : method === "recent_weighted"
        ? (topic.frequency_score * 0.45) + (topic.recent_weighted_score * 0.45) + (topic.years_since_last_seen_raw * 0.10)
        : (topic.frequency_score * 0.25)
          + (topic.recent_weighted_score * 0.25)
          + (topic.years_since_last_seen_raw * 0.15)
          + ((includeMarkWeight ? topic.average_marks_score : 0) * 0.20)
          + (topic.paper_pattern_raw * 0.07)
          + ((topic.diagram_pattern_raw_score || 0) * 0.03)
          + (Math.min(1, topic.syllabus_weight / 3) * 0.05)
    return {
      topic_id: topic.topic_id,
      topic: topic.topic,
      score: Number((score * 100).toFixed(1)),
      years_seen: topic.years_seen,
      years_since_last_seen: topic.years_since_last_seen,
      average_marks: Number(topic.average_marks.toFixed(1)),
      diagram_patterns: topic.diagram_fingerprints.size,
      subtopics: includeSubtopics ? [...topic.subtopics.entries()].map(([id, name]) => ({ id, name })) : [],
    }
  }).sort((a, b) => b.score - a.score)
  const predictedTopics = scored.slice(0, predictedTopicCount)
  const predictedTopicIds = new Set(predictedTopics.map((topic) => Number(topic.topic_id)))
  const actualTopicIds = new Set(testRows.map((row) => Number(row.topic_id)))
  const actualTopics = [...actualTopicIds].map((topicId) => {
    const row = testRows.find((item) => Number(item.topic_id) === topicId)
    return {
      topic_id: topicId,
      topic: row?.topic_name || "Unknown",
      marks: testRows.filter((item) => Number(item.topic_id) === topicId).reduce((sum, item) => sum + Number(item.marks || 0), 0),
    }
  }).sort((a, b) => b.marks - a.marks)
  const totalMarks = testRows.reduce((sum, row) => sum + Number(row.marks || 0), 0)
  const coveredMarks = testRows.filter((row) => predictedTopicIds.has(Number(row.topic_id))).reduce((sum, row) => sum + Number(row.marks || 0), 0)
  const hitCountTop5 = predictedTopics.slice(0, 5).filter((topic) => actualTopicIds.has(Number(topic.topic_id))).length
  const hitCountTop10 = predictedTopics.slice(0, 10).filter((topic) => actualTopicIds.has(Number(topic.topic_id))).length
  const marksCoverage = totalMarks ? Number(((coveredMarks / totalMarks) * 100).toFixed(1)) : 0
  const falsePositives = predictedTopics.filter((topic) => !actualTopicIds.has(Number(topic.topic_id)))
  const missedHighMarkTopics = actualTopics.filter((topic) => !predictedTopicIds.has(Number(topic.topic_id)) && topic.marks >= Math.max(6, totalMarks * 0.08))
  const repeatedDiagramPatterns = []
  const newDiagramPatterns = []
  for (const [fingerprint, pattern] of testDiagramPatterns.entries()) {
    const trainingPattern = trainingDiagramPatterns.get(fingerprint)
    if (trainingPattern) {
      repeatedDiagramPatterns.push(diagramPatternSummary(pattern, trainingPattern))
    } else {
      newDiagramPatterns.push(diagramPatternSummary(pattern))
    }
  }
  const diagramRecurrenceHitRate = testDiagramPatterns.size
    ? Number(((repeatedDiagramPatterns.length / testDiagramPatterns.size) * 100).toFixed(1))
    : 0
  const warnings = []
  if (trainingRows.length < 150) warnings.push("Training set has fewer than 150 tagged questions.")
  if (testRows.some((row) => !Number(row.marks))) warnings.push("Some test-year questions do not have marks.")
  if ((trainingEnd - trainingStart + 1) < 10) warnings.push("Training window is shorter than 10 years.")
  if (!trainingDiagramPatterns.size) warnings.push("Training set has no stored diagram fingerprints, so diagram recurrence could not inform the score.")
  if (!testDiagramPatterns.size) warnings.push("Test year has no stored diagram fingerprints, so diagram recurrence could not be measured.")
  const confidenceLevel = confidenceFromWarnings(warnings, marksCoverage)
  const result = {
    training_years_used: `${trainingStart}-${trainingEnd}`,
    test_year: testYear,
    predicted_topics: predictedTopics,
    actual_topics: actualTopics,
    top5_topic_hit_rate: Number(((hitCountTop5 / Math.min(5, predictedTopics.length || 1)) * 100).toFixed(1)),
    top10_topic_hit_rate: Number(((hitCountTop10 / Math.min(10, predictedTopics.length || 1)) * 100).toFixed(1)),
    marks_coverage: marksCoverage,
    marks_covered: coveredMarks,
    total_marks: totalMarks,
    missed_high_mark_topics: missedHighMarkTopics,
    false_positives: falsePositives,
    diagram_training_pattern_count: trainingDiagramPatterns.size,
    diagram_actual_pattern_count: testDiagramPatterns.size,
    diagram_repeated_pattern_count: repeatedDiagramPatterns.length,
    diagram_recurrence_hit_rate: diagramRecurrenceHitRate,
    repeated_diagram_patterns: repeatedDiagramPatterns.slice(0, 20),
    new_diagram_patterns: newDiagramPatterns.slice(0, 20),
    confidence_level: confidenceLevel,
    dataset_warnings: warnings,
    disclaimer: "This evaluates revision-priority topic forecasts, not exact exam questions.",
  }
  const [insert] = await pool.query(
    `INSERT INTO exam_lab_backtests (
      exam_board, exam_level, subject, paper, training_start_year, training_end_year, test_year,
      predicted_topic_count, prediction_method, include_subtopics, include_mark_weight,
      marks_coverage, top5_hit_rate, top10_hit_rate, confidence_level, result_json, warnings_json, run_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scope.exam_board,
      scope.exam_level,
      scope.subject,
      paper,
      trainingStart,
      trainingEnd,
      testYear,
      predictedTopicCount,
      ["frequency_only", "recent_weighted", "recency_frequency_marks"].includes(method) ? method : "recency_frequency_marks",
      includeSubtopics ? 1 : 0,
      includeMarkWeight ? 1 : 0,
      marksCoverage,
      result.top5_topic_hit_rate,
      result.top10_topic_hit_rate,
      confidenceLevel,
      JSON.stringify(result),
      JSON.stringify(warnings),
      userId,
    ],
  )
  return { backtest_id: Number(insert.insertId), result }
}

export async function listBacktests(scopeInput = {}) {
  const scope = normalizeScope(scopeInput)
  const [backtests] = await pool.query(
    `SELECT *
     FROM exam_lab_backtests
     WHERE exam_board = ? AND exam_level = ? AND subject = ?
     ORDER BY created_at DESC
     LIMIT 80`,
    [scope.exam_board, scope.exam_level, scope.subject],
  )
  return { backtests: backtests.map((row) => ({ ...row, result_json: parseJson(row.result_json, null), warnings_json: parseJson(row.warnings_json, []) })) }
}

export async function generatePredictionReport(userId, body = {}) {
  const scope = normalizeScope(body)
  const paper = normalizePaper(body.paper)
  const targetYear = intValue(body.target_year ?? body.targetYear, new Date().getFullYear())
  const trainingEnd = Math.min(targetYear - 1, intValue(body.training_end_year ?? body.trainingEndYear, targetYear - 1))
  const trainingStart = intValue(body.training_start_year ?? body.trainingStartYear, Math.max(1990, trainingEnd - 20))
  const trainingRows = await loadBacktestQuestions(scope, paper, trainingStart, trainingEnd)
  if (!trainingRows.length) throw new HttpError(400, "Prediction report needs tagged historical questions before the target year")
  const byTopic = new Map()
  for (const row of trainingRows) {
    const item = byTopic.get(row.topic_id) || {
      topic_id: Number(row.topic_id),
      topic: row.topic_name,
      subtopics: new Map(),
      appearances: 0,
      marks: 0,
      years: new Set(),
      question_types: new Map(),
    }
    item.appearances += 1
    item.marks += Number(row.marks || 0)
    item.years.add(Number(row.exam_year))
    if (row.subtopic_id) item.subtopics.set(Number(row.subtopic_id), row.subtopic_name)
    if (row.question_type) item.question_types.set(row.question_type, (item.question_types.get(row.question_type) || 0) + 1)
    byTopic.set(row.topic_id, item)
  }
  const topics = [...byTopic.values()].map((topic) => {
    const lastSeen = Math.max(...topic.years)
    const recentAppearances = [...topic.years].filter((year) => year >= trainingEnd - 4).length
    const score = clamp((topic.appearances * 4) + (topic.marks * 0.7) + (recentAppearances * 8) + Math.min(18, (targetYear - lastSeen) * 2), 5, 96)
    return {
      topic_id: topic.topic_id,
      topic: topic.topic,
      priority_score: Number(score.toFixed(1)),
      likely_marks_range: `${Math.max(2, Math.round(topic.marks / Math.max(1, topic.years.size) * 0.65))}-${Math.max(5, Math.round(topic.marks / Math.max(1, topic.years.size) * 1.3))}`,
      recent_appearances: recentAppearances,
      years_since_last_seen: targetYear - lastSeen,
      marks_trend: topic.marks > topic.appearances * 4 ? "marks-heavy" : "frequency-led",
      subtopics: [...topic.subtopics.values()].slice(0, 6),
      likely_question_types: [...topic.question_types.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => name),
    }
  }).sort((a, b) => b.priority_score - a.priority_score)
  const warnings = []
  const recentYears = new Set(trainingRows.filter((row) => Number(row.exam_year) >= trainingEnd - 4).map((row) => Number(row.exam_year)))
  if (recentYears.size < 3) warnings.push(`Confidence is reduced because recent-year coverage from ${trainingEnd - 4} to ${trainingEnd} is incomplete.`)
  if (trainingRows.length < 250) warnings.push("The labelled question dataset is still below the preferred 250-question threshold.")
  const high = topics.filter((topic) => topic.priority_score >= 70).slice(0, 8)
  const medium = topics.filter((topic) => topic.priority_score >= 45 && topic.priority_score < 70).slice(0, 8)
  const low = topics.filter((topic) => topic.priority_score < 45).slice(0, 8)
  const confidenceLevel = warnings.length > 1 ? "low" : warnings.length ? "medium" : "high"
  const report = {
    title: `${scope.exam_level} ${scope.subject} ${paper} - ${targetYear} Revision Priority Forecast`,
    target_year: targetYear,
    training_years_used: `${trainingStart}-${trainingEnd}`,
    high_priority_topics: high,
    medium_priority_topics: medium,
    low_priority_topics: low,
    similar_past_questions_available: trainingRows.length,
    confidence_level: confidenceLevel,
    dataset_limitations: warnings,
    revision_guidance: "Use this as a topic-priority map for revision planning and teacher support.",
    disclaimer: "This report predicts revision priority and topic likelihood, not exact exam questions.",
  }
  const [insert] = await pool.query(
    `INSERT INTO exam_lab_prediction_reports (
      exam_board, exam_level, subject, paper, target_year, report_title,
      confidence_level, report_json, warnings_json, generated_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      scope.exam_board,
      scope.exam_level,
      scope.subject,
      paper,
      targetYear,
      report.title,
      confidenceLevel,
      JSON.stringify(report),
      JSON.stringify(warnings),
      userId,
    ],
  )
  return { report_id: Number(insert.insertId), report }
}

export async function listPredictionReports(scopeInput = {}) {
  const scope = normalizeScope(scopeInput)
  const [reports] = await pool.query(
    `SELECT *
     FROM exam_lab_prediction_reports
     WHERE exam_board = ? AND exam_level = ? AND subject = ?
     ORDER BY created_at DESC
     LIMIT 80`,
    [scope.exam_board, scope.exam_level, scope.subject],
  )
  return { reports: reports.map((row) => ({ ...row, report_json: parseJson(row.report_json, null), warnings_json: parseJson(row.warnings_json, []) })) }
}

export function aiPlaceholder() {
  return {
    ok: false,
    message: "AI suggestions are not configured yet. Please tag manually.",
    suggestions: [],
  }
}
