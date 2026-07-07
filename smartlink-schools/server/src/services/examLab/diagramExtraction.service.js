import fs from "fs/promises"
import path from "path"
import { createHash } from "crypto"
import { execFile } from "child_process"
import { promisify } from "util"

const execFileAsync = promisify(execFile)

const IMAGE_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])
const VISUAL_SOURCE_TYPES = new Set(["ai_description", "text_signal"])

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

function hashText(value) {
  return hashBuffer(Buffer.from(String(value || ""), "utf8"))
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function uniqueStrings(values, limit = 20) {
  const seen = new Set()
  const result = []
  for (const value of values || []) {
    const text = normalizeText(value)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text.slice(0, 1500))
    if (result.length >= limit) break
  }
  return result
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback
  if (typeof value === "object" && !Buffer.isBuffer(value)) return value
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  } catch {
    return fallback
  }
}

function intOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null
}

function toRelativePath(fullPath) {
  return path.relative(process.cwd(), fullPath).split(path.sep).join("/")
}

async function command(commandName, args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(commandName, args, {
      timeout: 45000,
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    })
    return { ok: true, stdout: String(stdout || ""), stderr: String(stderr || "") }
  } catch (error) {
    return { ok: false, stdout: String(error?.stdout || ""), stderr: String(error?.stderr || error?.message || "") }
  }
}

function parsePdfImageList(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+\s+\d+\s+/.test(line))
    .map((line) => {
      const parts = line.split(/\s+/)
      return {
        page_number: intOrNull(parts[0]),
        image_number: intOrNull(parts[1]),
        pdf_image_type: parts[2] || null,
        width_px: intOrNull(parts[3]),
        height_px: intOrNull(parts[4]),
        color_space: parts[5] || null,
        component_count: intOrNull(parts[6]),
        bits_per_component: intOrNull(parts[7]),
        encoding: parts[8] || null,
        interpolation: parts[9] || null,
        pdf_object_id: parts[10] && parts[11] ? `${parts[10]} ${parts[11]}` : null,
        x_ppi: intOrNull(parts[12]),
        y_ppi: intOrNull(parts[13]),
        image_size: parts[14] || null,
        compression_ratio: parts[15] || null,
        raw_line: line,
      }
    })
}

async function listExtractedImages(folder, prefixBase) {
  try {
    const entries = await fs.readdir(folder)
    return entries
      .filter((entry) => entry.startsWith(`${prefixBase}-`) && /\.(png|jpg|jpeg|ppm|pbm|pgm)$/i.test(entry))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((entry) => path.join(folder, entry))
  } catch {
    return []
  }
}

function pngDimensions(buffer) {
  if (buffer.length < 24) return null
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null
  return { width_px: buffer.readUInt32BE(16), height_px: buffer.readUInt32BE(20) }
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2) break
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height_px: buffer.readUInt16BE(offset + 5), width_px: buffer.readUInt16BE(offset + 7) }
    }
    offset += length + 2
  }
  return null
}

function imageDimensions(buffer, mimeType) {
  if (mimeType === "image/png") return pngDimensions(buffer)
  if (mimeType === "image/jpeg") return jpegDimensions(buffer)
  return null
}

function metadataHashFor(row) {
  const value = {
    diagram_kind: row.diagram_kind || "unknown",
    source_type: row.source_type || "text_signal",
    image_hash: row.image_hash || null,
    width_px: row.width_px || null,
    height_px: row.height_px || null,
    color_space: row.color_space || null,
    component_count: row.component_count || null,
    bits_per_component: row.bits_per_component || null,
    description: normalizeText(row.description).toLowerCase().slice(0, 3000),
    formulas: uniqueStrings(row.formulas_json || [], 20).map((item) => item.toLowerCase()),
    tables: uniqueStrings(row.tables_json || [], 12).map((item) => item.toLowerCase()),
  }
  return hashText(JSON.stringify(value))
}

function candidatePage(candidate, raw) {
  const pages = Array.isArray(raw?.source_pages) ? raw.source_pages.map(Number).filter(Boolean) : []
  if (pages.length) return Math.min(...pages)
  return intOrNull(candidate?.source_page_start) || intOrNull(candidate?.source_page_end)
}

function diagramKindsFromRaw(raw) {
  const kinds = []
  if (raw?.has_diagram) kinds.push("diagram")
  if (raw?.has_graph) kinds.push("graph")
  if (raw?.has_table) kinds.push("table")
  return kinds
}

function textPreview(candidate) {
  return normalizeText(candidate?.question_text).slice(0, 1000)
}

function candidateSignalRows({ paperId, versionId, candidateId, candidate }) {
  const raw = parseJson(candidate?.raw_json, {})
  const subparts = Array.isArray(raw.subparts) ? raw.subparts : []
  const formulas = uniqueStrings([
    ...(raw.formulas || []),
    ...subparts.flatMap((part) => part?.formulas || []),
  ], 24)
  const tables = uniqueStrings([
    ...(raw.tables || []),
    ...subparts.flatMap((part) => part?.tables || []),
  ], 12)
  const diagramDescriptions = uniqueStrings([
    ...(raw.diagram_descriptions || []),
    raw.diagram_description,
    ...subparts.map((part) => part?.diagram_description),
  ], 10)
  const graphDescriptions = uniqueStrings([
    ...(raw.graph_descriptions || []),
    raw.graph_description,
    ...subparts.map((part) => part?.graph_description),
  ], 10)
  const kinds = diagramKindsFromRaw(raw)
  const pageNumber = candidatePage(candidate, raw)
  return kinds.map((kind) => {
    const descriptions = kind === "graph" ? graphDescriptions : kind === "table" ? tables : diagramDescriptions
    const description = descriptions.length ? descriptions.join(" | ") : textPreview(candidate)
    const row = {
      paper_id: paperId,
      version_id: versionId,
      candidate_id: candidateId,
      page_number: pageNumber,
      diagram_kind: kind,
      source_type: raw.extraction_method === "ai" ? "ai_description" : "text_signal",
      description,
      formulas_json: formulas,
      tables_json: tables,
      metadata_json: {
        extraction_method: raw.extraction_method || "unknown",
        question_number: candidate?.detected_question_number || null,
        source_pages: raw.source_pages || [],
      },
    }
    row.metadata_hash = metadataHashFor(row)
    return row
  })
}

async function findDuplicateDiagram(connection, row) {
  if (row.image_hash) {
    const [[match]] = await connection.query(
      `SELECT id FROM exam_lab_diagrams
       WHERE image_hash = ?
       ORDER BY id
       LIMIT 1`,
      [row.image_hash],
    )
    if (match?.id) return Number(match.id)
  }
  if (row.metadata_hash) {
    const [[match]] = await connection.query(
      `SELECT id FROM exam_lab_diagrams
       WHERE metadata_hash = ?
       ORDER BY id
       LIMIT 1`,
      [row.metadata_hash],
    )
    if (match?.id) return Number(match.id)
  }
  return null
}

async function insertDiagram(connection, row) {
  const duplicateId = await findDuplicateDiagram(connection, row)
  const [result] = await connection.query(
    `INSERT INTO exam_lab_diagrams (
      paper_id, version_id, candidate_id, question_id, page_number, diagram_kind, source_type,
      file_path, image_hash, metadata_hash, perceptual_hash, width_px, height_px, x_ppi, y_ppi,
      color_space, component_count, bits_per_component, pdf_object_id, description,
      formulas_json, tables_json, metadata_json, duplicate_of_diagram_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.paper_id,
      row.version_id,
      row.candidate_id || null,
      row.question_id || null,
      row.page_number || null,
      row.diagram_kind || "unknown",
      row.source_type || "text_signal",
      row.file_path || null,
      row.image_hash || null,
      row.metadata_hash || metadataHashFor(row),
      row.perceptual_hash || null,
      row.width_px || null,
      row.height_px || null,
      row.x_ppi || null,
      row.y_ppi || null,
      row.color_space || null,
      row.component_count || null,
      row.bits_per_component || null,
      row.pdf_object_id || null,
      row.description || null,
      row.formulas_json ? JSON.stringify(row.formulas_json) : null,
      row.tables_json ? JSON.stringify(row.tables_json) : null,
      row.metadata_json ? JSON.stringify(row.metadata_json) : null,
      duplicateId,
    ],
  )
  return { id: Number(result.insertId), duplicate_of_diagram_id: duplicateId }
}

export function diagramFingerprint(row = {}) {
  return row.image_hash || row.perceptual_hash || row.metadata_hash || null
}

export async function extractVersionImageDiagrams({ paperId, versionId, fullPath, mimeType, filePath }) {
  const warnings = []
  if (mimeType === "application/pdf") {
    const listed = await command("pdfimages", ["-list", fullPath])
    if (!listed.ok) {
      return {
        diagrams: [],
        warnings: [`Embedded PDF image metadata could not be read: ${normalizeText(listed.stderr).slice(0, 180) || "pdfimages failed"}`],
      }
    }
    const imageRows = parsePdfImageList(listed.stdout)
    if (!imageRows.length) return { diagrams: [], warnings }

    const folder = path.resolve(process.cwd(), "uploads", "exam-lab-diagrams", String(versionId), `run-${Date.now()}`)
    await fs.mkdir(folder, { recursive: true })
    const prefixBase = "diagram"
    const prefix = path.join(folder, prefixBase)
    const extracted = await command("pdfimages", ["-png", fullPath, prefix])
    if (!extracted.ok) {
      warnings.push(`Embedded PDF images were listed but could not be extracted: ${normalizeText(extracted.stderr).slice(0, 180) || "pdfimages failed"}`)
    }
    const extractedFiles = extracted.ok ? await listExtractedImages(folder, prefixBase) : []
    const diagrams = []
    for (const [index, imageRow] of imageRows.entries()) {
      const imagePath = extractedFiles[index] || null
      let imageHash = null
      let relativePath = null
      if (imagePath) {
        const imageBuffer = await fs.readFile(imagePath)
        imageHash = hashBuffer(imageBuffer)
        relativePath = toRelativePath(imagePath)
      }
      const row = {
        paper_id: paperId,
        version_id: versionId,
        page_number: imageRow.page_number,
        diagram_kind: imageRow.pdf_image_type === "image" ? "image" : "diagram",
        source_type: "pdf_image",
        file_path: relativePath,
        image_hash: imageHash,
        width_px: imageRow.width_px,
        height_px: imageRow.height_px,
        x_ppi: imageRow.x_ppi,
        y_ppi: imageRow.y_ppi,
        color_space: imageRow.color_space,
        component_count: imageRow.component_count,
        bits_per_component: imageRow.bits_per_component,
        pdf_object_id: imageRow.pdf_object_id,
        description: `Embedded ${imageRow.pdf_image_type || "image"} on page ${imageRow.page_number || "unknown"}`,
        metadata_json: {
          pdf_image_number: imageRow.image_number,
          pdf_image_type: imageRow.pdf_image_type,
          encoding: imageRow.encoding,
          interpolation: imageRow.interpolation,
          image_size: imageRow.image_size,
          compression_ratio: imageRow.compression_ratio,
          source_file_path: filePath || null,
          raw_line: imageRow.raw_line,
        },
      }
      row.metadata_hash = metadataHashFor(row)
      diagrams.push(row)
    }
    return { diagrams, warnings }
  }

  if (IMAGE_UPLOAD_TYPES.has(mimeType)) {
    const imageBuffer = await fs.readFile(fullPath)
    const dimensions = imageDimensions(imageBuffer, mimeType) || {}
    const row = {
      paper_id: paperId,
      version_id: versionId,
      diagram_kind: "image",
      source_type: "uploaded_image",
      file_path: filePath || toRelativePath(fullPath),
      image_hash: hashBuffer(imageBuffer),
      width_px: dimensions.width_px || null,
      height_px: dimensions.height_px || null,
      description: "Uploaded image question paper",
      metadata_json: { mime_type: mimeType, source_file_path: filePath || null },
    }
    row.metadata_hash = metadataHashFor(row)
    return { diagrams: [row], warnings }
  }

  return { diagrams: [], warnings }
}

export async function saveVersionImageDiagrams(connection, { diagrams = [] }) {
  const stats = { saved: 0, duplicate_count: 0 }
  for (const row of diagrams) {
    const inserted = await insertDiagram(connection, row)
    stats.saved += 1
    if (inserted.duplicate_of_diagram_id) stats.duplicate_count += 1
  }
  return stats
}

export async function saveCandidateDiagramSignals(connection, { paperId, versionId, candidateId, candidate }) {
  const [[existing]] = await connection.query(
    `SELECT COUNT(*) AS total
     FROM exam_lab_diagrams
     WHERE candidate_id = ? AND source_type IN (?, ?)`,
    [candidateId, ...VISUAL_SOURCE_TYPES],
  )
  if (Number(existing?.total || 0) > 0) return { saved: 0, duplicate_count: 0, skipped_existing: true }

  const rows = candidateSignalRows({ paperId, versionId, candidateId, candidate })
  const stats = { saved: 0, duplicate_count: 0, skipped_existing: false }
  for (const row of rows) {
    const inserted = await insertDiagram(connection, row)
    stats.saved += 1
    if (inserted.duplicate_of_diagram_id) stats.duplicate_count += 1
  }
  return stats
}

export async function linkCandidateDiagramsToQuestion(connection, { candidateId, questionId }) {
  await connection.query(
    `UPDATE exam_lab_diagrams
     SET question_id = ?
     WHERE candidate_id = ? AND question_id IS NULL`,
    [questionId, candidateId],
  )
}

export async function linkVersionImageDiagramsToQuestion(connection, { versionId, candidateId, questionId, sourcePageStart, sourcePageEnd }) {
  const startPage = intOrNull(sourcePageStart)
  const endPage = intOrNull(sourcePageEnd) || startPage
  if (!startPage && !endPage) {
    await connection.query(
      `UPDATE exam_lab_diagrams
       SET candidate_id = COALESCE(candidate_id, ?), question_id = ?
       WHERE version_id = ? AND question_id IS NULL AND candidate_id IS NULL
         AND source_type = 'uploaded_image'`,
      [candidateId, questionId, versionId],
    )
    return
  }
  await connection.query(
    `UPDATE exam_lab_diagrams
     SET candidate_id = COALESCE(candidate_id, ?), question_id = ?
     WHERE version_id = ? AND question_id IS NULL AND candidate_id IS NULL
       AND source_type IN ('pdf_image', 'uploaded_image')
       AND (page_number IS NULL OR page_number BETWEEN ? AND ?)`,
    [candidateId, questionId, versionId, Math.min(startPage || endPage, endPage || startPage), Math.max(startPage || endPage, endPage || startPage)],
  )
}
