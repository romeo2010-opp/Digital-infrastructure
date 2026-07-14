import fs from "fs/promises"
import path from "path"
import { createHash, randomUUID } from "crypto"
import { execFile } from "child_process"
import { promisify } from "util"

const run = promisify(execFile)
const MAX_IMAGES = Math.max(1, Number(process.env.ASSESSMENT_IMAGE_MAX_COUNT) || 100)
const MAX_IMAGE_BYTES = Math.max(1024 * 1024, Number(process.env.ASSESSMENT_IMAGE_MAX_BYTES) || 20 * 1024 * 1024)
const MAX_PAGES = Math.max(1, Number(process.env.ASSESSMENT_IMAGE_MAX_PAGES) || 150)
const CROP_DPI = Math.max(150, Math.min(300, Number(process.env.ASSESSMENT_IMAGE_CROP_DPI) || 240))
const EXTRACTION_TIMEOUT_MS = Math.max(30000, Number(process.env.ASSESSMENT_IMAGE_TIMEOUT_MS) || 180000)

const MIME_BY_FORMAT = {
  JPEG: "image/jpeg",
  JPG: "image/jpeg",
  PNG: "image/png",
  WEBP: "image/webp",
  TIFF: "image/tiff",
  GIF: "image/gif",
  BMP: "image/bmp",
  PBM: "image/x-portable-bitmap",
  PGM: "image/x-portable-graymap",
  PPM: "image/x-portable-pixmap",
}

function bounded(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}

function safePart(value, fallback = "asset") {
  return String(value || fallback).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "").slice(0, 100) || fallback
}

function questionReference(value) {
  return String(value || "").trim().slice(0, 80) || null
}

export function parsePdfImageList(raw = "") {
  return String(raw).split(/\r?\n/).map((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\w+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\d+)\s+(\d+)\s+(\w+)\s+(\w+)\s+(\d+)\s+(\d+)\s+/)
    if (!match) return null
    return {
      page_number: Number(match[1]),
      embedded_number: Number(match[2]),
      embedded_type: match[3].toLowerCase(),
      width: Number(match[4]),
      height: Number(match[5]),
      encoding: match[9].toLowerCase(),
      interpolation: match[10].toLowerCase(),
      object_id: Number(match[11]),
    }
  }).filter(Boolean)
}

async function imageMetadata(filePath) {
  const [{ stdout }, stat, bytes] = await Promise.all([
    run("identify", ["-format", "%m|%w|%h", filePath], { timeout: 30000, maxBuffer: 1024 * 1024 }),
    fs.stat(filePath),
    fs.readFile(filePath),
  ])
  const [format, width, height] = String(stdout || "").trim().split("|")
  const checksum = createHash("sha256").update(bytes).digest("hex")
  return {
    mime_type: MIME_BY_FORMAT[String(format || "").toUpperCase()] || "application/octet-stream",
    width: Number(width) || null,
    height: Number(height) || null,
    file_size: stat.size,
    checksum,
  }
}

function baseAsset({ filePath, documentType, pageNumber, metadata, extractionMethod, assetType, requiresReview, sourceKey }) {
  return {
    public_ref: randomUUID(),
    document_type: documentType,
    page_number: pageNumber,
    asset_type: assetType,
    extraction_method: extractionMethod,
    file_path: path.relative(process.cwd(), filePath),
    file_name: path.basename(filePath),
    mime_type: metadata.mime_type,
    width: metadata.width,
    height: metadata.height,
    aspect_ratio: metadata.width && metadata.height ? Number((metadata.width / metadata.height).toFixed(6)) : null,
    checksum: metadata.checksum,
    confidence: extractionMethod === "embedded" ? .9 : .75,
    requires_review: requiresReview,
    assignment_status: "unassigned",
    placement: pageNumber === 1 ? "cover" : "unassigned",
    source_asset_key: sourceKey,
    linked_question_temp_id: null,
    suggested_question_number: null,
    alt_text: pageNumber === 1 ? "Graphic extracted from the assessment cover" : "Visual extracted from the assessment PDF",
    bbox_json: null,
  }
}

export async function extractEmbeddedPdfImages({ pdfPath, outputDir, documentType, pageTextByNumber = new Map(), pageCount = 0 }) {
  if (pageCount > MAX_PAGES) throw new Error(`PDF image extraction supports up to ${MAX_PAGES} pages per file`)
  await fs.mkdir(outputDir, { recursive: true })
  const prefix = path.join(outputDir, `${safePart(documentType)}-embedded`)
  const listed = await run("pdfimages", ["-list", pdfPath], { timeout: EXTRACTION_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
  const rows = parsePdfImageList(listed.stdout)
  await run("pdfimages", ["-all", pdfPath, prefix], { timeout: EXTRACTION_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
  const names = (await fs.readdir(outputDir)).filter((name) => name.startsWith(`${path.basename(prefix)}-`)).sort()
  const filesByNumber = new Map()
  for (const name of names) {
    const embeddedNumber = Number(name.match(/-(\d+)\.[^.]+$/)?.[1])
    if (Number.isFinite(embeddedNumber) && !filesByNumber.has(embeddedNumber)) filesByNumber.set(embeddedNumber, path.join(outputDir, name))
  }

  const assets = []
  const warnings = []
  const scanPages = new Set()
  const checksumPath = new Map()
  for (const row of rows) {
    if (assets.length >= MAX_IMAGES) {
      warnings.push(`Image limit reached (${MAX_IMAGES}); remaining embedded objects were skipped.`)
      break
    }
    if (["mask", "smask"].includes(row.embedded_type)) continue
    const filePath = filesByNumber.get(row.embedded_number)
    if (!filePath) continue
    let metadata
    try {
      metadata = await imageMetadata(filePath)
    } catch {
      warnings.push(`Embedded image ${row.embedded_number} on page ${row.page_number} could not be validated.`)
      continue
    }
    if (metadata.file_size > MAX_IMAGE_BYTES) {
      warnings.push(`An embedded image on page ${row.page_number} exceeded the ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB limit and was skipped.`)
      await fs.rm(filePath, { force: true }).catch(() => {})
      continue
    }
    const textLength = String(pageTextByNumber.get(row.page_number) || "").replace(/\s+/g, "").length
    const probableFullPageScan = textLength < 60 && Number(metadata.width) >= 900 && Number(metadata.height) >= 900
    if (probableFullPageScan) {
      scanPages.add(row.page_number)
      await fs.rm(filePath, { force: true }).catch(() => {})
      continue
    }
    const meaningfulSize = Number(metadata.width) >= 80 && Number(metadata.height) >= 60
    if (!meaningfulSize && row.page_number !== 1) {
      await fs.rm(filePath, { force: true }).catch(() => {})
      continue
    }
    const existingPath = checksumPath.get(metadata.checksum)
    let storedPath = filePath
    let duplicate = false
    if (existingPath) {
      duplicate = true
      storedPath = existingPath
      await fs.rm(filePath, { force: true }).catch(() => {})
    } else {
      checksumPath.set(metadata.checksum, filePath)
    }
    const assetType = row.page_number === 1
      ? (Number(metadata.width) < 400 && Number(metadata.height) < 400 ? "logo" : "cover_graphic")
      : (row.encoding === "jpeg" ? "photo" : "image")
    assets.push({
      ...baseAsset({
        filePath: storedPath,
        documentType,
        pageNumber: row.page_number,
        metadata,
        extractionMethod: "embedded",
        assetType,
        requiresReview: row.page_number !== 1,
        sourceKey: `embedded-${row.embedded_number}`,
      }),
      duplicate_checksum: duplicate ? metadata.checksum : null,
      embedded_number: row.embedded_number,
      embedded_type: row.embedded_type,
    })
  }
  return {
    assets,
    warnings,
    scan_pages: [...scanPages],
    images_found: rows.filter((row) => !["mask", "smask"].includes(row.embedded_type)).length,
    duplicates_skipped: assets.filter((asset) => asset.duplicate_checksum).length,
  }
}

export async function cropPdfVisualRegions({ questions = [], pdfPath, outputDir, documentType = "student_paper", pageCount = 0, pageTextByNumber = new Map() }) {
  const assets = []
  const warnings = []
  const scale = CROP_DPI / 72
  const allowed = new Set(["diagram", "figure", "graph", "chart", "map", "photo", "apparatus", "table", "scientific_illustration", "geometric_figure", "formula_image"])
  for (let questionIndex = 0; questionIndex < questions.length && assets.length < MAX_IMAGES; questionIndex += 1) {
    const question = questions[questionIndex] || {}
    const candidates = Array.isArray(question.assets) ? question.assets.slice(0, 12) : []
    for (let assetIndex = 0; assetIndex < candidates.length && assets.length < MAX_IMAGES; assetIndex += 1) {
      const candidate = candidates[assetIndex] || {}
      const rawType = String(candidate.assetType || candidate.type || "").toLowerCase()
      if (!allowed.has(rawType)) continue
      const pageNumber = Math.round(Number(candidate.pageNumber || candidate.page_number || question.pageStart) || 0)
      if (pageNumber < 1 || pageNumber > pageCount) continue
      const normalized = candidate.bboxNormalized || candidate.bbox_normalized || {}
      const normalizedValid = [normalized.x, normalized.y, normalized.width, normalized.height].every((value) => Number.isFinite(Number(value)))
        && Number(normalized.width) > 0 && Number(normalized.height) > 0
        && Number(normalized.x) >= 0 && Number(normalized.y) >= 0
        && Number(normalized.x) + Number(normalized.width) <= 1.05
        && Number(normalized.y) + Number(normalized.height) <= 1.05
      if (!normalizedValid) {
        warnings.push(`A visual near question ${question.questionNumber || "?"} on page ${pageNumber} needs a manual crop.`)
        continue
      }
      const points = {
        x: Number(normalized.x) * 595.276,
        y: Number(normalized.y) * 841.89,
        width: Number(normalized.width) * 595.276,
        height: Number(normalized.height) * 841.89,
      }
      const padding = 4
      const crop = {
        x: Math.max(0, Math.floor((points.x - padding) * scale)),
        y: Math.max(0, Math.floor((points.y - padding) * scale)),
        width: Math.max(30, Math.ceil((points.width + padding * 2) * scale)),
        height: Math.max(30, Math.ceil((points.height + padding * 2) * scale)),
      }
      const reference = questionReference(question.questionNumber) || `question-${questionIndex + 1}`
      const prefix = path.join(outputDir, `${safePart(documentType)}-visual-${safePart(reference)}-${assetIndex + 1}`)
      try {
        await run("pdftoppm", ["-f", String(pageNumber), "-l", String(pageNumber), "-singlefile", "-png", "-r", String(CROP_DPI), "-x", String(crop.x), "-y", String(crop.y), "-W", String(crop.width), "-H", String(crop.height), pdfPath, prefix], { timeout: EXTRACTION_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 })
        const filePath = `${prefix}.png`
        const metadata = await imageMetadata(filePath)
        if (metadata.file_size > MAX_IMAGE_BYTES) {
          await fs.rm(filePath, { force: true }).catch(() => {})
          warnings.push(`A cropped visual on page ${pageNumber} exceeded the image-size limit.`)
          continue
        }
        const pageTextLength = String(pageTextByNumber.get(pageNumber) || "").replace(/\s+/g, "").length
        const extractionMethod = pageTextLength < 60 ? "cropped_from_scan" : "vector_crop"
        const typeMap = { figure: "diagram", table: "table", apparatus: "scientific_illustration" }
        assets.push({
          ...baseAsset({
            filePath,
            documentType,
            pageNumber,
            metadata,
            extractionMethod,
            assetType: typeMap[rawType] || rawType,
            requiresReview: Number(candidate.confidence || 0) < .8,
            sourceKey: String(candidate.assetKey || `${reference}-${assetIndex + 1}`).slice(0, 120),
          }),
          source_question_index: questionIndex,
          linked_question_number: reference,
          suggested_question_number: reference,
          linked_question_temp_id: String(question.tempQuestionId || "").slice(0, 80) || null,
          placement: "after_question_text",
          assignment_status: "suggested",
          confidence: bounded(candidate.confidence, .05, .99, .65),
          requires_review: Number(candidate.confidence || 0) < .8,
          alt_text: String(candidate.description || candidate.figureLabel || `Visual for question ${reference}`).slice(0, 255),
          bbox_json: { ...points, normalized, coordinate_space: "pdf_points_top_left", extraction_method: extractionMethod },
        })
      } catch (error) {
        warnings.push(`A visual for question ${reference} on page ${pageNumber} could not be cropped: ${String(error?.message || "rendering failed").slice(0, 180)}`)
      }
    }
  }
  return { assets, warnings }
}

export const assessmentImageExtractionLimits = {
  max_images: MAX_IMAGES,
  max_image_bytes: MAX_IMAGE_BYTES,
  max_pages: MAX_PAGES,
  crop_dpi: CROP_DPI,
  timeout_ms: EXTRACTION_TIMEOUT_MS,
}
