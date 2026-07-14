import fs from "fs/promises"
import os from "os"
import path from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import PDFDocument from "pdfkit"
import { HttpError } from "../utils/http.js"

const PT_PER_MM = 72 / 25.4
const CSS_PX_TO_PT = 0.75
const execFileAsync = promisify(execFile)

const PAPER_SIZES = {
  A4: [210 * PT_PER_MM, 297 * PT_PER_MM],
  LETTER: [612, 792],
}

const DEFAULT_LAYOUT = {
  paper_size: "A4",
  margins: "normal",
  question_spacing: "normal",
  section_spacing: "normal",
  curriculum_key: "",
  cover_style: "standard",
  board_name: "SCHOOL EXAMINATIONS BOARD",
  exam_series: "MALAWI SCHOOL CERTIFICATE OF EDUCATION MOCK EXAMINATIONS",
  subject_number: "",
  exam_date: "",
  exam_time: "",
  paper_label: "PAPER I",
  paper_subtitle: "Theory",
  total_pages: "",
  answer_register_count: 13,
  copyright_label: "",
  footer_note: "Turn over",
  header: "",
  footer: "",
  page_numbers: "bottom",
}

function cleanText(value, fallback = "") {
  return String(value ?? fallback)
}

function numeric(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function listLines(value, fallback = []) {
  const rows = cleanText(value)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
  return rows.length ? rows : fallback
}

function px(value, fallback = 0) {
  return numeric(value, fallback) * CSS_PX_TO_PT
}

function safeFilename(value, fallback = "assessment-paper") {
  return cleanText(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || fallback
}

export function normalizeAssessmentExportVariant(value) {
  return ["scheme", "marking", "marking_scheme"].includes(String(value || "").toLowerCase()) ? "scheme" : "student"
}

export function assessmentExportFilename(assessment, variant) {
  const date = new Date().toISOString().slice(0, 10)
  return `${safeFilename(assessment?.name)}-${normalizeAssessmentExportVariant(variant)}-${date}.pdf`
}

function normalizeLayout(blocks = []) {
  const layoutBlock = blocks.find((block) => parseJson(block?.metadata_json, {})?.system_block === "paper_layout")
  const blockContent = parseJson(layoutBlock?.content_json, {})
  const content = parseJson(blockContent?.paper_layout || blockContent, {})
  return {
    ...DEFAULT_LAYOUT,
    ...(content || {}),
    cover_blocks: normalizeCoverBlocks(content?.cover_blocks || content?.coverBlocks || []),
  }
}

function normalizeCoverBlocks(value = []) {
  if (!Array.isArray(value)) return []
  return value.map((block, index) => ({
    ...block,
    local_id: block?.local_id || block?.id || `cover-${index + 1}`,
    content_json: parseJson(block?.content_json || block?.content, {}),
    style_json: parseJson(block?.style_json || block?.style, {}),
    metadata_json: { ...parseJson(block?.metadata_json || block?.metadata, {}), cover_block: true },
    sort_order: numeric(block?.sort_order, 10 + index * 10),
    is_printable: block?.is_printable !== false,
  })).sort((a, b) => numeric(a.sort_order, 0) - numeric(b.sort_order, 0))
}

function marginsFor(layout) {
  const marginMm = layout.margins === "narrow" ? 10 : layout.margins === "wide" ? 20 : 14
  const margin = marginMm * PT_PER_MM
  return { top: margin, right: margin, bottom: margin, left: margin }
}

function paperSizeFor(layout) {
  const key = String(layout.paper_size || "A4").toUpperCase()
  return PAPER_SIZES[key] || PAPER_SIZES.A4
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback
  if (typeof value === "object") return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function normalizeParts(parts = []) {
  if (!Array.isArray(parts)) return []
  return parts.map((part, index) => ({
    local_id: cleanText(part.local_id || part.id || `part-${index + 1}`),
    type: part.type === "image" ? "image" : "text",
    text: cleanText(part.text),
    media_id: part.media_id || part.mediaId || null,
    url: cleanText(part.url),
    caption: cleanText(part.caption),
    alt_text: cleanText(part.alt_text || part.altText),
    width: numeric(part.width, 360),
  }))
}

function partsToText(parts = []) {
  return normalizeParts(parts)
    .map((part) => part.type === "image" ? cleanText(part.caption || part.alt_text || "[Image]") : part.text)
    .filter(Boolean)
    .join("\n\n")
}

function answerRegisterCells(count = 13) {
  const total = Math.max(1, numeric(count, 13))
  return [
    ["Question Number", "Tick if answered", "Do not write in these columns"],
    ...Array.from({ length: total }).map((_, index) => [String(index + 1), "", ""]),
    ["TOTAL", "", ""],
  ]
}

function blockKey(block) {
  return String(block?.local_id || block?.id || "")
}

function questionReferenceKey(value) {
  return cleanText(value).toLowerCase().replace(/^question\s*/, "").replace(/[\s.()[\]{}_-]+/g, "")
}

function displayQuestionReference(value) {
  const reference = cleanText(value).trim()
  if (!reference) return ""
  // Plain builder numbers retain the conventional trailing full stop. Imported
  // references are already formatted by the source paper and must remain exact.
  return /^\d+$/.test(reference) ? `${reference}.` : reference
}

function questionHasPrintableContent(question = {}) {
  if (cleanText(question.question_text).trim()) return true
  return normalizeParts(question.content_parts || question.contentParts || []).some((part) => part.type === "image" || cleanText(part.text).trim())
}

export function validateAssessmentExportContent({ assessment = {}, questions = [] } = {}) {
  if (!Array.isArray(questions) || !questions.length) {
    throw new HttpError(422, "This assessment cannot be exported because it has no questions. Add at least one complete question first.", { code: "ASSESSMENT_HAS_NO_QUESTIONS" })
  }
  const emptyQuestions = questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => !questionHasPrintableContent(question))
    .map(({ question, index }) => cleanText(question.display_number || question.question_number || index + 1).trim())
  if (emptyQuestions.length) {
    throw new HttpError(422, `Question ${emptyQuestions.join(", ")} has no printable content. Add the question text or an image before exporting.`, { code: "ASSESSMENT_QUESTION_CONTENT_REQUIRED" })
  }
  const unmarkedQuestions = questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => !Number.isFinite(Number(question.marks)) || Number(question.marks) <= 0)
    .map(({ question, index }) => cleanText(question.display_number || question.question_number || index + 1).trim())
  if (unmarkedQuestions.length) {
    throw new HttpError(422, `Question ${unmarkedQuestions.join(", ")} must have marks greater than zero before exporting.`, { code: "ASSESSMENT_QUESTION_MARKS_REQUIRED" })
  }
  const references = questions.map((question, index) => questionReferenceKey(question.display_number || question.question_number || index + 1))
  const duplicateReferences = [...new Set(references.filter((reference, index) => reference && references.indexOf(reference) !== index))]
  if (duplicateReferences.length) {
    throw new HttpError(422, "Question numbers must be unique before exporting the paper.", { code: "ASSESSMENT_QUESTION_NUMBERS_DUPLICATED" })
  }
  const declaredMarks = Number(assessment.total_marks)
  const questionMarks = questions.reduce((sum, question) => sum + Number(question.marks || 0), 0)
  if (!Number.isFinite(declaredMarks) || declaredMarks <= 0) {
    throw new HttpError(422, "Set the assessment total marks before exporting the paper.", { code: "ASSESSMENT_TOTAL_MARKS_REQUIRED" })
  }
  if (Math.abs(declaredMarks - questionMarks) > 0.01) {
    throw new HttpError(422, `The question marks add up to ${questionMarks}, but the assessment total is ${declaredMarks}. Make them equal before exporting.`, { code: "ASSESSMENT_MARKS_MISMATCH" })
  }
  return { question_count: questions.length, total_marks: questionMarks }
}

export function buildExportBlocks(assessment, questions = [], blocks = []) {
  const normalizedBlocks = blocks.map((block) => ({
    ...block,
    content_json: parseJson(block.content_json, {}),
    style_json: parseJson(block.style_json, {}),
    metadata_json: parseJson(block.metadata_json, {}),
  }))
  const questionBlocks = normalizedBlocks.filter((block) => block.block_type === "question")
  const designBlocks = normalizedBlocks
    .filter((block) => block.metadata_json?.system_block !== "paper_layout")
    .filter((block) => !["cover_field", "instructions", "question", "sub_question", "mcq_options"].includes(block.block_type))

  const usedQuestionBlockIndexes = new Set()
  const exportedQuestions = questions.map((question, index) => {
    const displayNumber=cleanText(question.display_number||question.question_number||index+1)
    let questionBlockIndex = questionBlocks.findIndex((block,blockIndex) => !usedQuestionBlockIndexes.has(blockIndex) && questionReferenceKey(block.content_json?.question_number) === questionReferenceKey(displayNumber))
    if(questionBlockIndex<0&&!usedQuestionBlockIndexes.has(index)&&questionBlocks[index])questionBlockIndex=index
    if(questionBlockIndex<0)questionBlockIndex=questionBlocks.findIndex((_,blockIndex)=>!usedQuestionBlockIndexes.has(blockIndex))
    if(questionBlockIndex>=0)usedQuestionBlockIndexes.add(questionBlockIndex)
    const questionBlock = questionBlocks[questionBlockIndex] || {}
    const content = questionBlock.content_json || {}
    const metadata = questionBlock.metadata_json || {}
    const parts = normalizeParts(content.content_parts || question.content_parts || question.contentParts || [])
    return {
      local_id: blockKey(questionBlock) || `question-${question.id || index + 1}`,
      block_type: "question",
      sort_order: numeric(questionBlock.sort_order, numeric(question.sort_order, 100 + index)),
      is_printable: true,
      style_json: { ...(questionBlock.style_json || {}) },
      content_json: {
        question_number: cleanText(content.question_number || displayNumber),
        question_text: cleanText(content.question_text || question.question_text || partsToText(parts)),
        content_parts: parts,
        question_type: content.question_type || question.question_type || "short_answer",
        marks: content.marks || question.marks || "",
        question_instructions: content.question_instructions || question.question_instructions || "",
        options: Array.isArray(content.options) && content.options.length ? content.options : question.options || [],
      },
      metadata_json: {
        topic_text: metadata.topic_text || question.topic_text || "",
        subtopic_text: metadata.subtopic_text || question.subtopic_text || "",
        difficulty: metadata.difficulty || question.difficulty || "medium",
        cognitive_skill: metadata.cognitive_skill || question.cognitive_skill || "",
        correct_answer: metadata.correct_answer || question.correct_answer || "",
        marking_scheme: metadata.marking_scheme || question.marking_scheme || "",
        explanation: metadata.explanation || question.explanation || "",
        is_last_question: index === questions.length - 1,
      },
    }
  })

  const ordered = [...designBlocks, ...exportedQuestions]
    .filter((block) => block.block_type !== "teacher_note" && block.is_printable !== false)
    .sort((a, b) => numeric(a.sort_order, 0) - numeric(b.sort_order, 0))
  const compact = []
  for (const block of ordered) {
    if (block.block_type === "page_break" && (!compact.length || compact[compact.length - 1]?.block_type === "page_break")) continue
    compact.push(block)
  }
  while (compact[compact.length - 1]?.block_type === "page_break") compact.pop()
  return compact
}

function fontName(style = {}) {
  if (style.bold && style.italic) return "Helvetica-BoldOblique"
  if (style.bold) return "Helvetica-Bold"
  if (style.italic) return "Helvetica-Oblique"
  return "Helvetica"
}

function textOptions(style = {}, width) {
  const align = style.align === "stretch" ? "left" : style.align || "left"
  const lineGap = style.line_spacing === "wide" ? 5 : style.line_spacing === "tight" ? 0 : 2
  return { width, align, lineGap }
}

function setTextStyle(doc, style = {}, fallbackSize = 10.5) {
  doc.font(fontName(style)).fontSize(style.font_size ? px(style.font_size, 14) : fallbackSize).fillColor("#111827")
}

function stateInnerWidth(state) {
  return state.size[0] - state.margins.left - state.margins.right
}

function pageBottom(state) {
  return state.size[1] - state.margins.bottom
}

function availableHeight(state) {
  return state.size[1] - state.margins.top - state.margins.bottom
}

function addPage(state) {
  state.doc.addPage({ size: state.size, margins: state.margins })
  state.y = state.margins.top
}

function ensureSpace(state, height) {
  if (height > availableHeight(state)) return
  if (state.y + height > pageBottom(state) && state.y > state.margins.top + 4) addPage(state)
}

function alignedX(state, style = {}, width = stateInnerWidth(state)) {
  const innerWidth = stateInnerWidth(state)
  const align = style.align || "left"
  const offset = px(style.offset_x, 0)
  let x = state.margins.left
  if (align === "center") x += (innerWidth - width) / 2
  if (align === "right") x += innerWidth - width
  return Math.max(state.margins.left, Math.min(state.margins.left + innerWidth - width, x + offset))
}

function advanceWithOffset(state, style = {}) {
  const offset = px(style.offset_y, 0)
  if (offset) state.y = Math.max(state.margins.top, state.y + offset)
}

function drawRule(state, y = state.y) {
  state.doc
    .moveTo(state.margins.left, y)
    .lineTo(state.size[0] - state.margins.right, y)
    .lineWidth(1)
    .strokeColor("#111827")
    .stroke()
}

function drawText(state, text, x, width, style = {}, options = {}) {
  const doc = state.doc
  const value = cleanText(text)
  setTextStyle(doc, style, options.fontSize || 10.5)
  const textOpts = textOptions(style, width)
  const height = Math.max(options.minHeight || 0, doc.heightOfString(value || " ", textOpts))
  if (options.avoid !== false) ensureSpace(state, height + (options.after || 0))
  doc.text(value, x, state.y, textOpts)
  state.y = Math.max(state.y, doc.y) + (options.after || 0)
  return height
}

function drawBoxText(state, text, style = {}, isBox = false) {
  advanceWithOffset(state, style)
  const innerWidth = stateInnerWidth(state)
  const padding = isBox ? 7 : 0
  const width = innerWidth
  const x = alignedX(state, style, width)
  setTextStyle(state.doc, style, style.font_size ? px(style.font_size, 14) : 10.5)
  const height = state.doc.heightOfString(cleanText(text) || " ", textOptions(style, width - padding * 2))
  ensureSpace(state, height + padding * 2 + 8)
  if (isBox) {
    state.doc.rect(x, state.y, width, height + padding * 2).lineWidth(1).strokeColor("#111827").stroke()
  }
  state.doc.text(cleanText(text), x + padding, state.y + padding, textOptions(style, width - padding * 2))
  state.y += height + padding * 2 + 8
}

function drawSection(state, block) {
  const style = { align: "center", bold: true, ...(block.style_json || {}) }
  advanceWithOffset(state, style)
  const width = stateInnerWidth(state)
  const x = alignedX(state, style, width)
  drawText(state, block.content_json?.title || "", x, width, style, { fontSize: 13.5, after: 7 })
}

function drawAnswerSpaceFrame(state, content = {}, x, width) {
  const type = content.answer_space_type || "ruled_lines"
  const height = Math.max(18, px(content.height, 120))
  ensureSpace(state, height + 12)
  const y = state.y
  if (content.show_border !== false) state.doc.rect(x, y, width, height).lineWidth(1).strokeColor("#111827").stroke()
  if (type === "graph_grid") {
    state.doc.save().rect(x, y, width, height).clip()
    state.doc.strokeColor("#d1d5db").lineWidth(0.4)
    for (let gridX = x; gridX <= x + width; gridX += 16.5) state.doc.moveTo(gridX, y).lineTo(gridX, y + height).stroke()
    for (let gridY = y; gridY <= y + height; gridY += 16.5) state.doc.moveTo(x, gridY).lineTo(x + width, gridY).stroke()
    state.doc.restore()
  }
  if (type === "blank_space") {
    // Intentionally leave the measured area open: the imported paper used
    // whitespace rather than rules or a border for the learner response.
  }
  if (type === "ruled_lines") {
    const lineCount = Math.max(1, numeric(content.number_of_lines, Math.round(height / 24)))
    const gap = height / (lineCount + 0.5)
    state.doc.strokeColor("#9ca3af").lineWidth(0.6)
    for (let index = 1; index <= lineCount; index += 1) {
      const lineY = y + Math.min(height - 6, index * gap)
      state.doc.moveTo(x + 12, lineY).lineTo(x + width - 12, lineY).stroke()
    }
  }
  state.y += height + 12
}

function drawAnswerSpace(state, content = {}, style = {}) {
  advanceWithOffset(state, style)
  const width = stateInnerWidth(state)
  const x = alignedX(state, style, width)
  drawAnswerSpaceFrame(state, content, x, width)
}

function mediaMapFrom(media = []) {
  const map = new Map()
  media.forEach((row) => {
    if (row?.id) map.set(Number(row.id), row)
  })
  return map
}

async function resolveImage(content = {}, state) {
  const media = content.media_id ? state.mediaMap.get(Number(content.media_id)) : null
  const source = cleanText(media?.storage_path || content.storage_path || content.url)
  const fileType = cleanText(media?.file_type || content.file_type).toLowerCase()
  if (!source) return null
  if (source.startsWith("data:")) {
    const match = source.match(/^data:([^;]+);base64,(.+)$/)
    if (!match || !["image/png", "image/jpeg", "image/jpg"].includes(match[1])) return null
    return { input: Buffer.from(match[2], "base64"), fileType: match[1] }
  }
  if (/^https?:\/\//i.test(source)) return null
  const localPath = path.resolve(process.cwd(), source.replace(/^\/+/, ""))
  const uploadsRoot = path.resolve(process.cwd(), "uploads")
  if (!localPath.startsWith(`${uploadsRoot}${path.sep}`)) return null
  const extension = path.extname(localPath).toLowerCase()
  const supported = ["image/png", "image/jpeg", "image/jpg"].includes(fileType) || [".png", ".jpg", ".jpeg"].includes(extension)
  if (!supported) return null
  try {
    await fs.access(localPath)
    return { input: localPath, fileType }
  } catch {
    return null
  }
}

async function drawImageBlock(state, content = {}, style = {}, captionClass = "Assessment image") {
  advanceWithOffset(state, style)
  const imageWidth = Math.min(stateInnerWidth(state), Math.max(60, px(content.width, 360)))
  const image = await resolveImage(content, state)
  let imageHeight = content.crop_enabled ? Math.max(40, px(content.crop_height, 220)) : Math.round(imageWidth * 0.58)
  if (image) {
    try {
      const imageInfo = state.doc.openImage(image.input)
      imageHeight = content.crop_enabled
        ? Math.max(40, px(content.crop_height, 220))
        : imageWidth * (imageInfo.height / imageInfo.width)
    } catch {
      imageHeight = Math.round(imageWidth * 0.58)
    }
  }
  const caption = cleanText(content.caption)
  const captionHeight = caption ? 16 : 0
  ensureSpace(state, imageHeight + captionHeight + 14)
  const x = alignedX(state, style, imageWidth)
  const y = state.y
  if (image) {
    try {
      if (content.crop_enabled) {
        state.doc.save().rect(x, y, imageWidth, imageHeight).clip()
        state.doc.image(image.input, x, y, { fit: [imageWidth, imageHeight], align: "center", valign: "center" })
        state.doc.restore()
        state.doc.rect(x, y, imageWidth, imageHeight).lineWidth(0.6).strokeColor("#e5e7eb").stroke()
      } else {
        state.doc.image(image.input, x, y, { width: imageWidth })
      }
    } catch {
      state.doc.rect(x, y, imageWidth, imageHeight).dash(3, { space: 3 }).strokeColor("#6b7280").stroke().undash()
      state.doc.font("Helvetica").fontSize(9).fillColor("#6b7280").text(captionClass, x, y + imageHeight / 2 - 6, { width: imageWidth, align: "center" })
    }
  } else {
    state.doc.rect(x, y, imageWidth, imageHeight).dash(3, { space: 3 }).strokeColor("#6b7280").stroke().undash()
    state.doc.font("Helvetica").fontSize(9).fillColor("#6b7280").text(captionClass, x, y + imageHeight / 2 - 6, { width: imageWidth, align: "center" })
  }
  state.y += imageHeight
  if (caption) {
    state.doc.font("Helvetica").fontSize(8.5).fillColor("#4b5563").text(caption, x, state.y + 4, { width: imageWidth, align: "center" })
    state.y = state.doc.y
  }
  state.y += 12
}

function drawShape(state, content = {}, style = {}) {
  advanceWithOffset(state, style)
  const width = Math.min(stateInnerWidth(state), Math.max(40, px(content.width, 260)))
  const height = Math.max(18, px(content.height, 120))
  ensureSpace(state, height + 12)
  const x = alignedX(state, style, width)
  const y = state.y
  const shape = content.shape_type || "rectangle"
  state.doc.strokeColor("#111827").fillColor("#f8fafc").lineWidth(1.4)
  if (shape === "line" || shape === "arrow") {
    state.doc.moveTo(x, y + height / 2).lineTo(x + width, y + height / 2).stroke()
    if (shape === "arrow") {
      state.doc.moveTo(x + width - 8, y + height / 2 - 4).lineTo(x + width, y + height / 2).lineTo(x + width - 8, y + height / 2 + 4).stroke()
    }
  } else if (shape === "circle") {
    state.doc.ellipse(x + width / 2, y + height / 2, width / 2, height / 2).fillAndStroke("#f8fafc", "#111827")
  } else if (shape === "triangle") {
    state.doc.polygon([x + width / 2, y], [x + width, y + height], [x, y + height]).fillAndStroke("#f8fafc", "#111827")
  } else {
    state.doc.roundedRect(x, y, width, height, 3).fillAndStroke("#f8fafc", "#111827")
  }
  const label = cleanText(content.label || String(shape).replace(/_/g, " "))
  if (label && shape !== "triangle") {
    state.doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151").text(label, x + 6, y + height / 2 - 7, { width: width - 12, align: "center" })
  }
  state.y += height + 12
}

function tableRows(content = {}) {
  const rows = Math.max(1, numeric(content.rows, Array.isArray(content.cells) ? content.cells.length : 3))
  const columns = Math.max(1, numeric(content.columns, Array.isArray(content.cells?.[0]) ? content.cells[0].length : 3))
  const cells = Array.isArray(content.cells) ? content.cells : []
  return Array.from({ length: rows }).map((_, rowIndex) =>
    Array.from({ length: columns }).map((__, columnIndex) => cleanText(cells[rowIndex]?.[columnIndex])),
  )
}

function drawTable(state, block) {
  const content = block.content_json || {}
  const rows = tableRows(content)
  const isRegister = block.metadata_json?.table_kind === "answer_register"
  const fontSize = isRegister ? 7.5 : 9
  const width = stateInnerWidth(state)
  const x = alignedX(state, block.style_json || {}, width)
  const colWidth = width / rows[0].length
  state.doc.font("Helvetica").fontSize(fontSize)
  rows.forEach((row, rowIndex) => {
    const isHeader = content.header_row && rowIndex === 0
    state.doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize)
    const rowHeight = Math.max(20, ...row.map((cell) => state.doc.heightOfString(cell || " ", { width: colWidth - 8 }) + 8))
    ensureSpace(state, rowHeight)
    row.forEach((cell, columnIndex) => {
      const cellX = x + columnIndex * colWidth
      if (isHeader) state.doc.rect(cellX, state.y, colWidth, rowHeight).fillAndStroke("#f3f4f6", "#111827")
      else state.doc.rect(cellX, state.y, colWidth, rowHeight).strokeColor("#111827").stroke()
      state.doc.fillColor("#111827").font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize).text(cell, cellX + 4, state.y + 4, { width: colWidth - 8 })
    })
    state.y += rowHeight
  })
  state.y += 10
}

function measureQuestion(state, block) {
  const content = block.content_json || {}
  const metadata = block.metadata_json || {}
  const style = block.style_json || {}
  const bodyWidth = stateInnerWidth(state) - 34
  state.doc.font("Helvetica").fontSize(10.5)
  const parts = normalizeParts(content.content_parts || [])
  const textHeight = parts.length
    ? parts.reduce((sum, part) => sum + (part.type === "image" ? Math.max(70, px(part.width, 360) * 0.58) + 16 : state.doc.heightOfString(part.text || " ", { width: bodyWidth - 76 }) + 6), 0)
    : state.doc.heightOfString(content.question_text || " ", { width: bodyWidth - 76 })
  const optionsHeight = content.question_type === "multiple_choice" ? Math.max(0, (content.options || []).length) * 18 + 8 : 0
  const instructionsHeight = content.question_instructions ? state.doc.heightOfString(content.question_instructions, { width: bodyWidth }) + 6 : 0
  const answerHeight = style.answer_space_type && style.answer_space_type !== "none" ? Math.max(18, px(style.answer_height, 120)) + 16 : 0
  const schemeText = [metadata.correct_answer, metadata.marking_scheme, metadata.explanation].filter(Boolean).join("\n")
  const schemeHeight = state.variant === "scheme" && schemeText ? state.doc.heightOfString(schemeText, { width: bodyWidth - 16 }) + 24 : 0
  return textHeight + optionsHeight + instructionsHeight + answerHeight + schemeHeight + 18
}

async function drawQuestion(state, block) {
  const content = block.content_json || {}
  const metadata = block.metadata_json || {}
  const style = block.style_json || {}
  const questionHeight = measureQuestion(state, block)
  if (questionHeight < availableHeight(state) * 0.9) ensureSpace(state, questionHeight)
  advanceWithOffset(state, style)
  const startY = state.y
  const questionReference = displayQuestionReference(content.question_number)
  const numberWidth = Math.min(92, Math.max(24, questionReference.length * 6.2))
  const gap = 10
  const bodyX = state.margins.left + numberWidth + gap
  const bodyWidth = stateInnerWidth(state) - numberWidth - gap
  const marks = numeric(content.marks, 0)
  const markLabel = marks === 1 ? "1 mark" : `${marks || 0} marks`
  state.doc.font("Helvetica-Bold").fontSize(11.5).fillColor("#111827").text(questionReference, state.margins.left, startY + 1, { width: numberWidth, align: "right", lineBreak: false })
  state.doc.font("Helvetica-Bold").fontSize(9).text(`(${markLabel})`, bodyX, startY + 1, { width: bodyWidth, align: "right" })

  const parts = normalizeParts(content.content_parts || [])
  state.y = startY
  if (parts.length) {
    for (const [partIndex, part] of parts.entries()) {
      if (part.type === "image") {
        state.y += partIndex ? 4 : 0
        await drawImageBlock(state, part, { align: "center" }, "Question image")
      } else {
        drawText(state, part.text, bodyX, partIndex === 0 ? bodyWidth - 76 : bodyWidth, {}, { avoid: false, after: 5 })
      }
    }
  } else {
    drawText(state, content.question_text || "", bodyX, bodyWidth - 76, {}, { avoid: false, after: 5 })
  }

  if (content.question_instructions) {
    state.doc.font("Helvetica-Oblique").fontSize(9).fillColor("#4b5563")
    state.doc.text(content.question_instructions, bodyX, state.y, { width: bodyWidth })
    state.y = state.doc.y + 5
  }

  if (content.question_type === "multiple_choice") {
    ;(content.options || []).forEach((option) => {
      ensureSpace(state, 16)
      state.doc.font("Helvetica").fontSize(9.5).fillColor("#111827").text(`${option.option_label || ""}.`, bodyX, state.y, { width: 24 })
      state.doc.text(cleanText(option.option_text), bodyX + 30, state.y, { width: bodyWidth - 30 })
      state.y = Math.max(state.y + 16, state.doc.y + 2)
    })
  }

  if (style.answer_space_type && style.answer_space_type !== "none") {
    drawAnswerSpaceFrame(state, {
      answer_space_type: style.answer_space_type,
      height: style.answer_height || 120,
      number_of_lines: style.answer_lines || 4,
      show_border: style.answer_space_type !== "ruled_lines",
    }, bodyX, bodyWidth)
  }

  if (state.variant === "scheme") {
    const rows = [
      metadata.correct_answer ? `Answer: ${metadata.correct_answer}` : "",
      metadata.marking_scheme ? `Marking scheme: ${metadata.marking_scheme}` : "",
      metadata.explanation ? `Explanation: ${metadata.explanation}` : "",
    ].filter(Boolean)
    if (rows.length) {
      const text = rows.join("\n")
      state.doc.font("Helvetica").fontSize(9)
      const height = state.doc.heightOfString(text, { width: bodyWidth - 16 }) + 14
      ensureSpace(state, height + 6)
      state.doc.rect(bodyX, state.y, bodyWidth, height).fillAndStroke("#f8fafc", "#cbd5e1")
      state.doc.fillColor("#111827").text(text, bodyX + 8, state.y + 7, { width: bodyWidth - 16 })
      state.y += height + 8
    }
  }

  if (metadata.is_last_question) {
    const markerY = Math.min(state.y + 8, state.size[1] - state.margins.bottom + 2)
    state.doc.font("Helvetica-Bold").fontSize(9).fillColor("#111827")
      .text("End of question paper", state.margins.left, markerY, { width: stateInnerWidth(state), align: "center", lineBreak: false })
    state.y = Math.max(state.y, markerY + 14)
  }

  state.y += 6
}

async function drawBlock(state, block) {
  if (block.block_type === "page_break") {
    addPage(state)
    return
  }
  if (block.block_type === "question") {
    await drawQuestion(state, block)
    return
  }
  if (block.block_type === "section") {
    drawSection(state, block)
    return
  }
  if (["paragraph", "text_box", "heading"].includes(block.block_type)) {
    drawBoxText(state, block.content_json?.text || "", block.style_json || {}, block.block_type === "text_box")
    return
  }
  if (block.block_type === "answer_space") {
    drawAnswerSpace(state, block.content_json || {}, block.style_json || {})
    return
  }
  if (block.block_type === "image") {
    await drawImageBlock(state, block.content_json || {}, block.style_json || {}, "Image / diagram")
    return
  }
  if (block.block_type === "shape") {
    drawShape(state, block.content_json || {}, block.style_json || {})
    return
  }
  if (block.block_type === "table") {
    drawTable(state, block)
  }
}

function drawStandardCover(state) {
  const doc = state.doc
  const assessment = state.assessment
  const width = stateInnerWidth(state)
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#374151").text(cleanText(state.schoolName || "SmartLink Schools").toUpperCase(), state.margins.left, state.y, { width, align: "center", characterSpacing: 1.4 })
  state.y = doc.y + 10
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#111827").text(cleanText(assessment.name || "Exam paper title"), state.margins.left, state.y, { width, align: "center" })
  state.y = doc.y + 14
  drawRule(state)
  state.y += 16
  const meta = [
    ["Class", assessment.class_name || "-"],
    ["Subject", assessment.subject_name || "-"],
    ["Duration", assessment.duration_minutes ? `${assessment.duration_minutes} minutes` : "-"],
    ["Marks", assessment.total_marks || "-"],
    ["Teacher", assessment.teacher_name || "-"],
    ["Status", cleanText(assessment.status || "-").replace(/_/g, " ")],
  ]
  const colGap = 18
  const colWidth = (width - colGap) / 2
  doc.fontSize(9.5)
  meta.forEach(([label, value], index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    const x = state.margins.left + col * (colWidth + colGap)
    const y = state.y + row * 22
    doc.font("Helvetica").fillColor("#6b7280").text(label, x, y, { width: 66 })
    doc.font("Helvetica-Bold").fillColor("#111827").text(cleanText(value), x + 70, y, { width: colWidth - 70, align: "right" })
    doc.moveTo(x, y + 15).lineTo(x + colWidth, y + 15).strokeColor("#d9dce3").lineWidth(0.5).stroke()
  })
  state.y += Math.ceil(meta.length / 2) * 22 + 22
  if (assessment.instructions) drawText(state, assessment.instructions, state.margins.left, width, {}, { after: 0 })
}

function drawMsceCover(state) {
  const doc = state.doc
  const layout = state.layout
  const assessment = state.assessment
  const width = stateInnerWidth(state)
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#111827")
  doc.text("STUDENT NAME __________________________________", state.margins.left, state.y, { width: width / 2 })
  doc.text("SCHOOL _____________", state.margins.left + width / 2, state.y, { width: width / 2, align: "right" })
  state.y += 34
  doc.font("Helvetica-Bold").fontSize(13).text(cleanText(layout.board_name), state.margins.left, state.y, { width, align: "center" })
  state.y = doc.y + 5
  doc.fontSize(9.5).text(cleanText(layout.exam_series).toUpperCase(), state.margins.left, state.y, { width, align: "center" })
  state.y = doc.y + 22
  doc.fontSize(15).text(cleanText(assessment.subject_name || assessment.name || "Subject").toUpperCase(), state.margins.left, state.y, { width, align: "center" })
  state.y = doc.y + 9
  doc.fontSize(11).text(cleanText(layout.paper_label), state.margins.left, state.y, { width, align: "center" })
  state.y = doc.y
  doc.font("Helvetica").fontSize(9.5).text(cleanText(layout.paper_subtitle), state.margins.left, state.y, { width, align: "center" })
  state.y = doc.y
  doc.font("Helvetica-Bold").text(`(${assessment.total_marks || 0} marks)`, state.margins.left, state.y, { width, align: "center" })
  state.y = doc.y + 18

  const leftY = state.y
  doc.font("Helvetica-Bold").fontSize(9).text(cleanText(layout.exam_date || "Exam date"), state.margins.left, leftY, { width: width / 2 })
  doc.text(`Subject Number: ${cleanText(layout.subject_number || "-")}`, state.margins.left + width / 2, leftY, { width: width / 2, align: "right" })
  doc.text(`Time Allowed: ${assessment.duration_minutes || "-"} minutes`, state.margins.left, leftY + 16, { width: width / 2 })
  doc.text(cleanText(layout.exam_time), state.margins.left + width / 2, leftY + 16, { width: width / 2, align: "right" })
  state.y += 48

  const registerWidth = Math.min(170, width * 0.36)
  const instructionsWidth = width - registerWidth - 24
  doc.font("Helvetica-Bold").fontSize(10).text("Instructions", state.margins.left, state.y, { width: instructionsWidth })
  const instructionTop = doc.y + 6
  doc.font("Helvetica").fontSize(9).text(cleanText(assessment.instructions), state.margins.left, instructionTop, { width: instructionsWidth, lineGap: 3 })
  if (layout.total_pages) {
    doc.font("Helvetica-Bold").fontSize(8.5).text(`This paper contains ${layout.total_pages} printed pages.`, state.margins.left, Math.max(doc.y + 10, instructionTop + 180), { width: instructionsWidth })
  }

  const tableState = { ...state, y: state.y, margins: { ...state.margins, left: state.margins.left + instructionsWidth + 24, right: state.size[0] - state.margins.left - instructionsWidth - 24 - registerWidth } }
  drawTable(tableState, {
    content_json: { rows: numeric(layout.answer_register_count, 13) + 2, columns: 3, header_row: true, cells: answerRegisterCells(layout.answer_register_count) },
    metadata_json: { table_kind: "answer_register" },
    style_json: {},
  })
  state.y = Math.max(doc.y, tableState.y)
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#111827")
  doc.text(cleanText(layout.copyright_label), state.margins.left, state.size[1] - state.margins.bottom - 18, { width: width / 2 })
  doc.text(cleanText(layout.footer_note || "Turn over"), state.margins.left + width / 2, state.size[1] - state.margins.bottom - 18, { width: width / 2, align: "right" })
}

function drawCambridgeCover(state) {
  const doc = state.doc
  const layout = state.layout
  const assessment = state.assessment
  const width = stateInnerWidth(state)
  const left = state.margins.left
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#111827")
  doc.rect(left + width / 2 - 98, state.y, 24, 28).strokeColor("#111827").lineWidth(1).stroke()
  doc.fontSize(7).text("CA", left + width / 2 - 94, state.y + 10, { width: 16, align: "center" })
  doc.fontSize(14).text(cleanText(layout.board_name || "Cambridge Assessment International Education"), left + width / 2 - 66, state.y, { width: 210, align: "left" })
  state.y += 86

  doc.font("Helvetica-Bold").fontSize(22).text(cleanText(layout.exam_series || "Cambridge IGCSE"), left, state.y, { width })
  state.y = doc.y + 20
  drawRule(state)
  state.y += 8
  const metaTop = state.y
  doc.fontSize(10.5).text(cleanText(assessment.subject_name || assessment.name || "Subject").toUpperCase(), left, metaTop, { width: width - 150 })
  doc.font("Helvetica").fontSize(10).text(cleanText(layout.paper_label || "Paper 1"), left, metaTop + 18, { width: width - 150 })
  doc.font("Helvetica-Bold").fontSize(10.5).text(cleanText(layout.subject_number), left + width - 140, metaTop, { width: 140, align: "right" })
  doc.text(cleanText(layout.exam_date), left + width - 140, metaTop + 18, { width: 140, align: "right" })
  doc.text(cleanText(layout.exam_time || `${assessment.duration_minutes || "-"} minutes`), left + width - 140, metaTop + 36, { width: 140, align: "right" })
  state.y += 70

  const barcodeX = left
  const contentX = left + 48
  doc.rect(barcodeX + 10, state.y + 10, 18, 112).fillColor("#111827").fill()
  doc.fillColor("#ffffff").font("Helvetica").fontSize(6).text(cleanText(layout.header || "*0000000000*"), barcodeX + 12, state.y + 14, { width: 14, align: "center" })
  doc.fillColor("#111827").fontSize(10.5)
  if (layout.paper_subtitle) {
    doc.text(cleanText(layout.paper_subtitle), contentX, state.y, { width: width - 48 })
    state.y = Math.max(state.y + 28, doc.y + 8)
  }
  doc.text("You will need:", contentX, state.y, { width: 95 })
  doc.text("Multiple choice answer sheet\nSoft clean eraser\nSoft pencil (type B or HB is recommended)", contentX + 100, state.y, { width: width - 148, lineGap: 2 })
  state.y = doc.y + 12
  doc.moveTo(contentX, state.y).lineTo(left + width, state.y).strokeColor("#111827").lineWidth(0.6).stroke()
  state.y += 8
  doc.font("Helvetica-Bold").fontSize(10.5).text("INSTRUCTIONS", contentX, state.y, { width: width - 48 })
  state.y = doc.y + 5
  doc.font("Helvetica").fontSize(9.5)
  listLines(assessment.instructions, ["Answer all questions."]).forEach((item) => {
    doc.text("*", contentX, state.y, { width: 12 })
    doc.text(item, contentX + 22, state.y, { width: width - 70, lineGap: 2 })
    state.y = doc.y + 3
  })
  state.y += 18
  doc.font("Helvetica-Bold").fontSize(10.5).text("INFORMATION", contentX, state.y, { width: width - 48 })
  state.y = doc.y + 5
  doc.font("Helvetica").fontSize(9.5)
  ;[
    `The total mark for this paper is ${assessment.total_marks || "-"}.`,
    "Each correct answer will score one mark.",
    "Any rough working should be done on this question paper.",
  ].forEach((item) => {
    doc.text("*", contentX, state.y, { width: 12 })
    doc.text(item, contentX + 22, state.y, { width: width - 70, lineGap: 2 })
    state.y = doc.y + 3
  })

  const documentPagesY = state.size[1] - state.margins.bottom - 72
  doc.moveTo(left, documentPagesY).lineTo(left + width, documentPagesY).strokeColor("#111827").lineWidth(0.6).stroke()
  doc.font("Helvetica").fontSize(9).text(`This document has ${layout.total_pages || "___"} pages. Any blank pages are indicated.`, left, documentPagesY + 8, { width, align: "center" })
  doc.fontSize(8).text(cleanText(layout.footer), left, state.size[1] - state.margins.bottom - 24, { width: width / 2 })
  doc.text(cleanText(layout.copyright_label), left, state.size[1] - state.margins.bottom - 12, { width: width / 2 })
  doc.font("Helvetica-Bold").fontSize(9).text(`[${cleanText(layout.footer_note || "Turn over")}]`, left + width / 2, state.size[1] - state.margins.bottom - 12, { width: width / 2, align: "right" })
}

async function drawOriginalImportedCover(state) {
  const mediaId=Number(state.layout.original_cover_media_id||0)
  if(!mediaId){drawStandardCover(state);return}
  const image=await resolveImage({media_id:mediaId},state)
  if(!image){drawStandardCover(state);return}
  try{
    state.doc.image(image.input,0,0,{fit:[state.size[0],state.size[1]],align:"center",valign:"center"})
    state.y=state.size[1]
  }catch{
    drawStandardCover(state)
  }
}

async function drawCover(state) {
  if (state.layout.cover_style === "original_imported") await drawOriginalImportedCover(state)
  else if (state.layout.cover_style === "msce") drawMsceCover(state)
  else if (state.layout.cover_style === "cambridge") drawCambridgeCover(state)
  else drawStandardCover(state)
}

function drawPageFurniture(state) {
  const doc = state.doc
  const range = doc.bufferedPageRange()
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index)
    const pageNumber = index + 1
    if(pageNumber===1&&state.layout.cover_style==="original_imported")continue
    const width = stateInnerWidth(state)
    const footerY = state.size[1] - state.margins.bottom + 8
    doc.font("Helvetica").fontSize(8).fillColor("#6b7280")
    if (state.layout.footer && pageNumber > 1) {
      doc.text(cleanText(state.layout.footer), state.margins.left, footerY, { width: width / 2 })
    }
    if (state.layout.header && pageNumber > 1) {
      doc.text(cleanText(state.layout.header), state.margins.left, Math.max(12, state.margins.top - 18), { width, align: "center" })
    }
    if (state.layout.page_numbers !== "none") {
      doc.text(`Page ${pageNumber} of ${range.count}`, state.margins.left, footerY, { width, align: "center" })
    }
  }
}

function escapeHtml(value) {
  return cleanText(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] || char))
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;")
}

function textToHtml(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br />")
}

function cssBlockStyle(style = {}) {
  const parts = []
  if (style.align) parts.push(`text-align:${style.align === "stretch" ? "left" : style.align}`)
  if (style.bold) parts.push("font-weight:700")
  if (style.italic) parts.push("font-style:italic")
  if (style.underline) parts.push("text-decoration:underline")
  if (style.font_size) parts.push(`font-size:${Math.max(6, numeric(style.font_size, 14))}px`)
  if (style.line_spacing === "wide") parts.push("line-height:1.8")
  if (style.line_spacing === "tight") parts.push("line-height:1.2")
  const x = numeric(style.offset_x, 0)
  const y = numeric(style.offset_y, 0)
  if (x || y) parts.push(`transform:translate(${x}px,${y}px)`)
  if (style.z_index) parts.push(`position:relative;z-index:${numeric(style.z_index, 0)}`)
  return parts.join(";")
}

function mimeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg"
  if (extension === ".png") return "image/png"
  if (extension === ".webp") return "image/webp"
  if (extension === ".gif") return "image/gif"
  if (extension === ".svg") return "image/svg+xml"
  return "application/octet-stream"
}

async function resolveHtmlImageSource(content = {}, state) {
  const media = content.media_id ? state.mediaMap.get(Number(content.media_id)) : null
  const source = cleanText(media?.storage_path || content.storage_path || content.url)
  if (!source) return ""
  if (source.startsWith("data:")) return source
  if (/^https?:\/\//i.test(source)) return source
  const localPath = path.resolve(process.cwd(), source.replace(/^\/+/, ""))
  const uploadsRoot = path.resolve(process.cwd(), "uploads")
  if (!localPath.startsWith(`${uploadsRoot}${path.sep}`)) return ""
  try {
    const buffer = await fs.readFile(localPath)
    const mimeType = cleanText(media?.file_type) || mimeFromPath(localPath)
    return `data:${mimeType};base64,${buffer.toString("base64")}`
  } catch {
    return ""
  }
}

function answerSpaceHtml(content = {}) {
  const type = content.answer_space_type || "ruled_lines"
  const height = Math.max(24, numeric(content.height, 120))
  const lines = Math.max(0, numeric(content.number_of_lines, 0))
  const border = content.show_border === false ? "" : "border:1px solid #111827;"
  if (type === "graph_grid") return `<div class="answer-space graph-space" style="min-height:${height}px;${border}"></div>`
  if (type === "blank_space") return `<div class="answer-space blank-open-space" style="min-height:${height}px"></div>`
  if (type === "blank_box") return `<div class="answer-space" style="min-height:${height}px;${border}"></div>`
  const lineCount = lines || Math.max(1, Math.round(height / 32))
  return `<div class="answer-space" style="min-height:${height}px;${border}">${Array.from({ length: lineCount }).map(() => '<div class="answer-line"></div>').join("")}</div>`
}

async function imageHtml(content = {}, state, label = "Assessment image", className = "paper-block image-block", style = {}) {
  const src = await resolveHtmlImageSource(content, state)
  const width = Math.max(80, numeric(content.width, 360))
  const blockStyle = cssBlockStyle(style)
  const caption = cleanText(content.caption)
  const alt = escapeAttribute(content.alt_text || content.caption || label)
  const cropEnabled = Boolean(content.crop_enabled)
  const cropStyle = cropEnabled
    ? `width:${width}px;height:${Math.max(60, numeric(content.crop_height, Math.round(width * 0.62)))}px;`
    : `width:${width}px;`
  const imageStyle = cropEnabled
    ? `width:100%;height:100%;object-fit:cover;object-position:${Math.min(100, Math.max(0, numeric(content.crop_x, 50)))}% ${Math.min(100, Math.max(0, numeric(content.crop_y, 50)))}%;transform:scale(${Math.min(3, Math.max(1, numeric(content.crop_zoom, 1)))})`
    : `width:${width}px;max-width:100%;height:auto;`
  return `<figure class="${className}" style="${escapeAttribute(blockStyle)}">${
    src
      ? `<span class="image-frame" style="${cropStyle}"><img src="${escapeAttribute(src)}" alt="${alt}" style="${imageStyle}" /></span>`
      : `<span class="image-placeholder" style="${cropStyle}">${escapeHtml(label)}</span>`
  }${caption ? `<figcaption>${textToHtml(caption)}</figcaption>` : ""}</figure>`
}

function tableHtml(block = {}) {
  const content = block.content_json || {}
  const rows = tableRows(content)
  const body = rows.map((row, rowIndex) => {
    const tag = content.header_row && rowIndex === 0 ? "th" : "td"
    return `<tr>${row.map((cell) => `<${tag}>${textToHtml(cell)}</${tag}>`).join("")}</tr>`
  }).join("")
  return `<table class="paper-table ${block.metadata_json?.table_kind === "answer_register" ? "answer-register" : ""}">${body}</table>`
}

function shapeHtml(content = {}, style = {}) {
  const shape = content.shape_type || "rectangle"
  const width = Math.max(40, numeric(content.width, 260))
  const height = Math.max(18, numeric(content.height, 120))
  const label = textToHtml(content.label || String(shape).replace(/_/g, " "))
  return `<div class="paper-block shape-block" style="${escapeAttribute(cssBlockStyle(style))}"><div class="shape ${escapeAttribute(shape)}" style="width:${width}px;min-height:${height}px">${shape === "triangle" ? "" : label}</div></div>`
}

async function exportBlockHtml(block, state) {
  const content = block.content_json || {}
  const style = block.style_json || {}
  const blockStyle = cssBlockStyle(style)
  if (block.block_type === "page_break") return '<div class="page-break"></div>'
  if (block.block_type === "section") return `<h2 class="section-title keep-with-next" style="${escapeAttribute(blockStyle)}">${textToHtml(content.title || "")}</h2>`
  if (["paragraph", "text_box", "heading"].includes(block.block_type)) {
    const tag = block.block_type === "heading" ? "h2" : "div"
    return `<${tag} class="paper-block ${block.block_type === "text_box" ? "text-box" : ""}" style="${escapeAttribute(blockStyle)}">${textToHtml(content.text || "")}</${tag}>`
  }
  if (block.block_type === "answer_space") return `<div class="paper-block" style="${escapeAttribute(blockStyle)}">${answerSpaceHtml(content)}</div>`
  if (block.block_type === "image") return imageHtml(content, state, "Image / diagram", "paper-block image-block", style)
  if (block.block_type === "shape") return shapeHtml(content, style)
  if (block.block_type === "table") return tableHtml(block)
  if (block.block_type === "question") return questionHtml(block, state)
  return ""
}

async function questionContentHtml(content = {}, state) {
  const parts = normalizeParts(content.content_parts || [])
  if (!parts.length) return textToHtml(content.question_text || "")
  const rows = []
  for (const part of parts) {
    if (part.type === "image") rows.push(await imageHtml(part, state, "Question image", "question-part image-block"))
    else rows.push(`<div class="question-part">${textToHtml(part.text || "")}</div>`)
  }
  return rows.join("")
}

async function questionHtml(block, state) {
  const content = block.content_json || {}
  const metadata = block.metadata_json || {}
  const style = block.style_json || {}
  const marks = numeric(content.marks, 0)
  const markLabel = marks === 1 ? "1 mark" : `${marks || 0} marks`
  const optionsHtml = content.question_type === "multiple_choice"
    ? `<div class="mcq-options">${(content.options || []).map((option) => `<div class="mcq-option"><span>${escapeHtml(option.option_label || "")}.</span><span>${textToHtml(option.option_text || "")}</span></div>`).join("")}</div>`
    : ""
  const answerHtml = style.answer_space_type && style.answer_space_type !== "none"
    ? answerSpaceHtml({
      answer_space_type: style.answer_space_type,
      height: style.answer_height || 120,
      number_of_lines: style.answer_lines || 4,
      show_border: style.answer_space_type !== "ruled_lines",
    })
    : ""
  const schemeRows = state.variant === "scheme"
    ? [
      metadata.correct_answer ? `<p><strong>Answer:</strong> ${textToHtml(metadata.correct_answer)}</p>` : "",
      metadata.marking_scheme ? `<p><strong>Marking scheme:</strong> ${textToHtml(metadata.marking_scheme)}</p>` : "",
      metadata.explanation ? `<p><strong>Explanation:</strong> ${textToHtml(metadata.explanation)}</p>` : "",
    ].filter(Boolean).join("")
    : ""
  return `<section class="question-block" style="${escapeAttribute(cssBlockStyle(style))}">
    <div class="question-number">${escapeHtml(displayQuestionReference(content.question_number))}</div>
    <div class="question-body">
      <div class="question-text"><span class="marks">(${markLabel})</span>${await questionContentHtml(content, state)}</div>
      ${content.question_instructions ? `<div class="question-instructions">${textToHtml(content.question_instructions)}</div>` : ""}
      ${optionsHtml}
      ${answerHtml ? `<div class="question-answer-space">${answerHtml}</div>` : ""}
      ${schemeRows ? `<div class="marking-panel">${schemeRows}</div>` : ""}
      ${metadata.is_last_question ? '<div class="end-of-question-paper">End of question paper</div>' : ""}
    </div>
  </section>`
}

async function coverBlocksHtml(state) {
  const blocks = normalizeCoverBlocks(state.layout.cover_blocks || [])
  const rows = []
  for (const block of blocks) rows.push(await exportBlockHtml(block, state))
  return rows.length ? `<div class="cover-freeform">${rows.join("\n")}</div>` : ""
}

async function originalImportedCoverHtml(state) {
  const src=await resolveHtmlImageSource({media_id:Number(state.layout.original_cover_media_id||0)},state)
  if(!src)return standardCoverHtml(state)
  return `<section class="cover-page original-imported-cover"><img src="${escapeAttribute(src)}" alt="Original imported assessment cover page" /></section>`
}

async function standardCoverHtml(state) {
  const assessment = state.assessment
  const meta = [
    ["Class", assessment.class_name || "-"],
    ["Subject", assessment.subject_name || "-"],
    ["Duration", assessment.duration_minutes ? `${assessment.duration_minutes} minutes` : "-"],
    ["Marks", assessment.total_marks || "-"],
    ["Teacher", assessment.teacher_name || "-"],
    ["Status", cleanText(assessment.status || "-").replace(/_/g, " ")],
  ]
  return `<section class="cover-page standard-cover">
    <div class="school-name">${textToHtml(state.schoolName || "SmartLink Schools").toUpperCase()}</div>
    ${await coverBlocksHtml(state)}
    <h1>${textToHtml(assessment.name || "Exam paper title")}</h1>
    <div class="standard-meta">${meta.map(([label, value]) => `<div><span>${textToHtml(label)}</span><strong>${textToHtml(value)}</strong></div>`).join("")}</div>
    ${assessment.instructions ? `<div class="instructions-text">${textToHtml(assessment.instructions)}</div>` : ""}
  </section>`
}

async function msceCoverHtml(state) {
  const assessment = state.assessment
  const layout = state.layout
  const rows = answerRegisterCells(layout.answer_register_count).map((row, rowIndex) => {
    const tag = rowIndex === 0 ? "th" : "td"
    return `<tr>${row.map((cell) => `<${tag}>${textToHtml(cell)}</${tag}>`).join("")}</tr>`
  }).join("")
  return `<section class="cover-page msce-cover">
    <div class="candidate-line"><span>STUDENT NAME __________________________________</span><span>SCHOOL _____________</span></div>
    ${await coverBlocksHtml(state)}
    <div class="cover-heading">
      <div class="board">${textToHtml(layout.board_name)}</div>
      <div class="series">${textToHtml(layout.exam_series)}</div>
      <div class="subject">${textToHtml(assessment.subject_name || assessment.name || "Subject").toUpperCase()}</div>
      <div class="paper-label">${textToHtml(layout.paper_label)}<br /><span>${textToHtml(layout.paper_subtitle)}</span><br /><strong>(${textToHtml(assessment.total_marks || 0)} marks)</strong></div>
    </div>
    <div class="cover-meta">
      <div>${textToHtml(layout.exam_date || "Exam date")}</div>
      <div><strong>Subject Number:</strong> ${textToHtml(layout.subject_number || "-")}</div>
      <div>Time Allowed: ${textToHtml(assessment.duration_minutes || "-")} minutes</div>
      <div>${textToHtml(layout.exam_time || "")}</div>
    </div>
    <div class="cover-grid">
      <div>
        <h3>Instructions</h3>
        <div class="instructions-text">${textToHtml(assessment.instructions || "")}</div>
        ${layout.total_pages ? `<p class="printed-pages">This paper contains ${textToHtml(layout.total_pages)} printed pages.</p>` : ""}
      </div>
      <table class="paper-table answer-register">${rows}</table>
    </div>
    <div class="cover-footer"><span>${textToHtml(layout.copyright_label || "")}</span><span>${textToHtml(layout.footer_note || "Turn over")}</span></div>
  </section>`
}

async function cambridgeCoverHtml(state) {
  const assessment = state.assessment
  const layout = state.layout
  const instructionItems = listLines(assessment.instructions, ["Answer all questions."])
  const informationItems = [
    `The total mark for this paper is ${assessment.total_marks || "-"}.`,
    "Each correct answer will score one mark.",
    "Any rough working should be done on this question paper.",
  ]
  return `<section class="cover-page cambridge-cover">
    <div class="cambridge-brand"><span class="cambridge-crest">CA</span><span>${textToHtml(layout.board_name || "Cambridge Assessment International Education")}</span></div>
    ${await coverBlocksHtml(state)}
    <div class="cambridge-series">${textToHtml(layout.exam_series || "Cambridge IGCSE")}<sup>TM</sup></div>
    <div class="cambridge-rule"></div>
    <div class="cambridge-meta">
      <div><strong>${textToHtml(assessment.subject_name || assessment.name || "Subject").toUpperCase()}</strong><span>${textToHtml(layout.paper_label || "Paper 1")}</span></div>
      <div><strong>${textToHtml(layout.subject_number || "")}</strong><span>${textToHtml(layout.exam_date || "")}</span><span>${textToHtml(layout.exam_time || (assessment.duration_minutes ? `${assessment.duration_minutes} minutes` : ""))}</span></div>
    </div>
    <div class="cambridge-layout">
      <div class="cambridge-barcode"><span>${textToHtml(layout.header || "*0000000000*")}</span></div>
      <div>
        ${layout.paper_subtitle ? `<p class="cambridge-answer-note">${textToHtml(layout.paper_subtitle)}</p>` : ""}
        <div class="cambridge-needs"><span>You will need:</span><div>Multiple choice answer sheet<br />Soft clean eraser<br />Soft pencil (type B or HB is recommended)</div></div>
        <div class="cambridge-rule"></div>
        <h2>INSTRUCTIONS</h2>
        <ul>${instructionItems.map((item) => `<li>${textToHtml(item)}</li>`).join("")}</ul>
        <h2>INFORMATION</h2>
        <ul>${informationItems.map((item) => `<li>${textToHtml(item)}</li>`).join("")}</ul>
      </div>
    </div>
    <div class="cambridge-document-pages">This document has <strong>${textToHtml(layout.total_pages || "___")}</strong> pages. Any blank pages are indicated.</div>
    <div class="cambridge-footer"><span>${textToHtml(layout.footer || "")}<br />${textToHtml(layout.copyright_label || "")}</span><strong>[${textToHtml(layout.footer_note || "Turn over")}]</strong></div>
  </section>`
}

function marginCss(layout) {
  return layout.margins === "narrow" ? "10mm" : layout.margins === "wide" ? "20mm" : "14mm"
}

function paperCssSize(layout) {
  return String(layout.paper_size || "A4").toUpperCase() === "LETTER" ? "Letter" : "A4"
}

async function buildAssessmentHtml({ assessment, questions = [], blocks, media, schoolName, variant }) {
  const layout = normalizeLayout(blocks)
  const exportBlocks = buildExportBlocks(assessment, questions, blocks)
  const state = {
    assessment,
    layout,
    schoolName,
    variant: normalizeAssessmentExportVariant(variant),
    mediaMap: mediaMapFrom(media),
  }
  const content = []
  if (layout.cover_style === "original_imported") content.push(await originalImportedCoverHtml(state))
  else if (layout.cover_style === "msce") content.push(await msceCoverHtml(state))
  else if (layout.cover_style === "cambridge") content.push(await cambridgeCoverHtml(state))
  else content.push(await standardCoverHtml(state))
  if (layout.cover_style === "msce") {
    const year = cleanText(layout.copyright_label).match(/\d{4}/)?.[0] || new Date().getFullYear()
    content.push(`<div class="continuation-header"><div class="candidate-line"><span>STUDENT NAME __________________________________</span><span>SCHOOL _____________</span></div><div class="page-meta"><span>${textToHtml(year)}</span><span>Page 2 of ${textToHtml(layout.total_pages || "")}</span><span>${textToHtml(layout.subject_number || "")}</span></div></div>`)
  } else if (layout.cover_style === "cambridge") {
    content.push('<div class="cambridge-page-number">2</div>')
  }
  for (const block of exportBlocks) content.push(await exportBlockHtml(block, state))
  const margin = marginCss(layout)
  const paperClass = layout.cover_style === "cambridge" ? "paper paper-cambridge" : "paper"
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(assessment.name || "Assessment Paper")}</title>
  <style>
    @page { size: ${paperCssSize(layout)}; margin: ${margin}; }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: #ffffff; color: #111827; font-family: "Times New Roman", Times, serif; font-size: 13pt; line-height: 1.36; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .paper { width: 100%; }
    .cover-page { min-height: calc(297mm - (${margin} * 2)); break-after: page; page-break-after: always; position: relative; }
    .original-imported-cover { width: 210mm; height: 297mm; min-height: 297mm; margin: calc(-1 * ${margin}); overflow: hidden; }
    .original-imported-cover img { display: block; width: 210mm; height: 297mm; object-fit: fill; }
    .cover-freeform { margin: 8px 0; }
    .continuation-header { margin-bottom: 14px; font-weight: 700; break-after: avoid; page-break-after: avoid; }
    .continuation-header .candidate-line { font-size: 12.5pt; }
    .continuation-header .page-meta { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 7px; font-size: 10.5pt; }
    .continuation-header .page-meta span:nth-child(2) { text-align: center; }
    .continuation-header .page-meta span:nth-child(3) { text-align: right; }
    .candidate-line, .cover-meta, .cover-footer { display: flex; justify-content: space-between; gap: 18px; }
    .standard-cover { border-bottom: 2px solid #111827; padding-bottom: 18px; text-align: center; }
    .standard-cover h1 { margin: 12px 0; font-size: 22pt; line-height: 1.15; }
    .school-name { font-size: 10pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
    .standard-meta { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px 18px; margin-top: 14px; text-align: left; font-size: 10pt; }
    .standard-meta div { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px solid #d9dce3; padding-bottom: 3px; }
    .standard-meta span { color: #6b7280; }
    .instructions-text { margin-top: 18px; white-space: pre-wrap; text-align: left; }
    .cover-heading { margin-top: 18px; text-align: center; font-weight: 700; }
    .cover-heading .board { font-size: 22pt; line-height: 1.1; }
    .cover-heading .series { margin-top: 4px; font-size: 14pt; text-transform: uppercase; }
    .cover-heading .subject { margin-top: 22px; font-size: 27pt; line-height: 1.1; }
    .paper-label { margin-top: 34px; text-align: center; font-size: 18pt; font-weight: 700; }
    .paper-label span { font-weight: 400; }
    .cover-meta { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); margin-top: 26px; font-size: 15pt; font-weight: 700; }
    .cover-meta div:nth-child(even) { text-align: right; }
    .cover-grid { display: grid; grid-template-columns: minmax(0,1fr) 76mm; gap: 13mm; margin-top: 34px; align-items: start; }
    .cover-grid h3 { margin: 0 0 12px; font-size: 17pt; }
    .printed-pages { margin-top: 16px; font-weight: 700; }
    .cover-footer { position: absolute; left: 0; right: 0; bottom: 0; font-size: 12pt; font-weight: 700; }
    .paper-cambridge { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; line-height: 1.28; color: #050505; }
    .paper-cambridge .question-block { font-size: 12pt; line-height: 1.34; }
    .cambridge-cover { font-family: Arial, Helvetica, sans-serif; color: #050505; }
    .cambridge-brand { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 17pt; font-weight: 700; line-height: 1.05; }
    .cambridge-crest { display: inline-grid; place-items: center; width: 28px; height: 32px; border: 2px solid #111827; font-size: 8pt; font-weight: 800; }
    .cambridge-series { margin-top: 30mm; font-size: 22pt; font-weight: 700; line-height: 1.1; }
    .cambridge-series sup { font-size: 7pt; }
    .cambridge-rule { border-top: 1px solid #111827; margin: 8px 0 10px; }
    .cambridge-meta { display: grid; grid-template-columns: minmax(0,1fr) 42mm; gap: 10mm; font-size: 11pt; }
    .cambridge-meta div { display: grid; gap: 7px; }
    .cambridge-meta div:last-child { text-align: right; }
    .cambridge-layout { display: grid; grid-template-columns: 12mm minmax(0,1fr); gap: 5mm; margin-top: 12mm; }
    .cambridge-barcode { min-height: 38mm; background: repeating-linear-gradient(90deg,#111 0 1px,#fff 1px 3px,#111 3px 5px,#fff 5px 7px); position: relative; }
    .cambridge-barcode span { position: absolute; left: -8mm; top: 0; writing-mode: vertical-rl; text-orientation: mixed; font-size: 7pt; letter-spacing: 2px; background: #fff; padding: 1mm; }
    .cambridge-answer-note { margin: 0 0 18px; }
    .cambridge-needs { display: grid; grid-template-columns: 28mm minmax(0,1fr); gap: 3mm; margin-bottom: 10px; }
    .cambridge-cover h2 { margin: 8px 0 4px; font-size: 11pt; line-height: 1.1; }
    .cambridge-cover ul { margin: 0 0 24px; padding-left: 18px; }
    .cambridge-cover li { margin: 3px 0; }
    .cambridge-document-pages { position: absolute; left: 0; right: 0; bottom: 22mm; border-top: 1px solid #111827; padding-top: 4px; text-align: center; font-size: 10pt; }
    .cambridge-footer { position: absolute; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between; align-items: end; font-size: 9pt; }
    .cambridge-page-number { margin: 0 0 16px; text-align: center; font-weight: 700; }
    .paper-block { margin: 12px 0; break-inside: avoid; page-break-inside: avoid; }
    .section-title { margin: 18px 0 8px; text-align: center; font-size: 14pt; break-after: avoid; page-break-after: avoid; }
    .text-box { border: 1px solid #111827; padding: 8px; }
    .question-block { display: grid; grid-template-columns: minmax(28px,max-content) minmax(0,1fr); gap: 8px; margin: 12px 0; font-size: 13pt; break-inside: avoid; page-break-inside: avoid; }
    .question-number { text-align: right; font-weight: 700; white-space: nowrap; }
    .question-text { white-space: pre-wrap; }
    .question-part { margin: 0 0 8px; }
    .marks { float: right; margin-left: 12px; white-space: nowrap; font-size: 11pt; font-weight: 700; }
    .question-instructions { margin-top: 4px; color: #374151; font-style: italic; }
    .mcq-options { display: grid; gap: 4px; margin: 8px 0 0 0; }
    .mcq-option { display: grid; grid-template-columns: 24px minmax(0,1fr); gap: 4px; }
    .answer-space { margin-top: 8px; border-radius: 2px; break-inside: avoid; page-break-inside: avoid; }
    .answer-line { height: 28px; margin: 0 14px; border-bottom: 1px solid #9ca3af; }
    .graph-space { background-image: linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px); background-size: 22px 22px; }
    .paper-table { width: 100%; border-collapse: collapse; margin: 10px 0; break-inside: avoid; page-break-inside: avoid; }
    .paper-table th, .paper-table td { border: 1px solid #111827; padding: 6px; vertical-align: top; }
    .paper-table th { font-weight: 700; background: #f3f4f6; }
    .answer-register { font-size: 10.5pt; }
    .image-block { text-align: center; break-inside: avoid; page-break-inside: avoid; }
    .image-frame { display: inline-block; max-width: 100%; overflow: hidden; vertical-align: top; }
    .image-frame img { display: block; max-width: 100%; }
    .image-block figcaption { margin-top: 4px; font-size: 10pt; color: #4b5563; }
    .image-placeholder, .shape { display: inline-flex; align-items: center; justify-content: center; border: 1px dashed #6b7280; background: #f8fafc; min-height: 90px; padding: 8px; }
    .shape { border: 2px solid #111827; border-radius: 3px; font-size: 10pt; font-weight: 700; color: #374151; }
    .shape.circle { border-radius: 999px; }
    .shape.triangle { clip-path: polygon(50% 0,100% 100%,0 100%); }
    .marking-panel { margin-top: 8px; border: 1px solid #cbd5e1; background: #f8fafc; padding: 8px; font-size: 10pt; break-inside: avoid; page-break-inside: avoid; }
    .marking-panel p { margin: 0 0 5px; }
    .end-of-question-paper { clear: both; margin-top: 16px; text-align: center; font-size: 10pt; font-weight: 700; break-inside: avoid; page-break-inside: avoid; }
    .page-break { break-after: page; page-break-after: always; height: 0; }
  </style>
    <script>
    window.__ASSESSMENT_EXPORT_READY__ = false;
    window.addEventListener('load', async () => {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((img) => img.complete ? true : new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve;
      })));
      window.__ASSESSMENT_EXPORT_READY__ = true;
    });
  </script>
</head>
<body><main class="${paperClass}">${content.join("\n")}</main></body>
</html>`
}

async function chromiumExecutable() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.GOOGLE_CHROME_BIN,
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      // Try the next known browser path.
    }
  }
  return ""
}

async function renderHtmlPdfWithChromium(html) {
  const executable = await chromiumExecutable()
  if (!executable) return null
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "smartlink-assessment-export-"))
  const htmlPath = path.join(tempDir, "paper.html")
  const pdfPath = path.join(tempDir, "paper.pdf")
  try {
    await fs.writeFile(htmlPath, html, "utf8")
    await execFileAsync(executable, [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--allow-file-access-from-files",
      "--no-pdf-header-footer",
      "--print-to-pdf-no-header",
      `--print-to-pdf=${pdfPath}`,
      "--virtual-time-budget=2000",
      `file://${htmlPath}`,
    ], { timeout: 45000, maxBuffer: 1024 * 1024 })
    const pdf = await fs.readFile(pdfPath)
    return pdf?.length ? pdf : null
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function buildAssessmentPdfKit({ assessment, questions = [], blocks = [], media = [], schoolName = "", variant = "student" }) {
  const layout = normalizeLayout(blocks)
  const size = paperSizeFor(layout)
  const margins = marginsFor(layout)
  const exportBlocks = buildExportBlocks(assessment, questions, blocks)
  const doc = new PDFDocument({ autoFirstPage: false, bufferPages: true })
  const chunks = []
  doc.on("data", (chunk) => chunks.push(chunk))
  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
  })
  const state = {
    doc,
    size,
    margins,
    layout,
    assessment,
    schoolName,
    variant: normalizeAssessmentExportVariant(variant),
    mediaMap: mediaMapFrom(media),
    y: margins.top,
  }

  addPage(state)
  await drawCover(state)
  addPage(state)
  for (const block of exportBlocks) {
    await drawBlock(state, block)
  }
  drawPageFurniture(state)
  doc.end()
  return done
}

export async function buildAssessmentPdf(args) {
  validateAssessmentExportContent(args)
  try {
    const html = await buildAssessmentHtml(args)
    const chromiumPdf = await renderHtmlPdfWithChromium(html)
    if (chromiumPdf?.length) return chromiumPdf
  } catch {
    // PDFKit below keeps exports working on hosts without a usable headless browser.
  }
  return buildAssessmentPdfKit(args)
}
