import { extractExamPaperQuestions as runAiExamPaperExtraction } from "../ai/aiClient.js"

const MAX_AI_CHUNKS = 8
const MAX_CHUNK_CHARS = 14000
const CHUNK_OVERLAP_CHARS = 800

const schemaHint = `Expected JSON shape:
{"questions":[{"question_number":"","question_text":"","subparts":[{"label":"","text":"","marks":null,"formulas":[""],"tables":[""],"diagram_description":"","graph_description":""}],"marks":null,"formulas":[""],"tables":[""],"diagram_descriptions":[""],"graph_descriptions":[""],"has_diagram":false,"has_graph":false,"has_table":false,"command_word":"","source_pages":[1],"confidence":0.0}],"failed_sections":[{"page_number":1,"text":"","reason":""}],"warnings":[]}`

const responseSchema = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question_number: { type: "STRING" },
          question_text: { type: "STRING" },
          subparts: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                label: { type: "STRING" },
                text: { type: "STRING" },
                marks: { type: "INTEGER", nullable: true },
                formulas: { type: "ARRAY", items: { type: "STRING" } },
                tables: { type: "ARRAY", items: { type: "STRING" } },
                diagram_description: { type: "STRING" },
                graph_description: { type: "STRING" },
              },
              required: ["label", "text", "marks", "formulas", "tables", "diagram_description", "graph_description"],
            },
          },
          marks: { type: "INTEGER", nullable: true },
          formulas: { type: "ARRAY", items: { type: "STRING" } },
          tables: { type: "ARRAY", items: { type: "STRING" } },
          diagram_descriptions: { type: "ARRAY", items: { type: "STRING" } },
          graph_descriptions: { type: "ARRAY", items: { type: "STRING" } },
          has_diagram: { type: "BOOLEAN" },
          has_graph: { type: "BOOLEAN" },
          has_table: { type: "BOOLEAN" },
          command_word: { type: "STRING" },
          source_pages: { type: "ARRAY", items: { type: "INTEGER" } },
          confidence: { type: "NUMBER" },
        },
        required: ["question_number", "question_text", "subparts", "marks", "formulas", "has_diagram", "has_graph", "has_table", "command_word", "source_pages", "confidence"],
      },
    },
    failed_sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          page_number: { type: "INTEGER" },
          text: { type: "STRING" },
          reason: { type: "STRING" },
        },
        required: ["page_number", "text", "reason"],
      },
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["questions", "failed_sections", "warnings"],
}

function clampConfidence(value, fallback = 0.55) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(1, number))
}

function uniqueStrings(values, limit = 20) {
  const seen = new Set()
  const result = []
  for (const value of values || []) {
    const text = String(value || "").trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text.slice(0, 1000))
    if (result.length >= limit) break
  }
  return result
}

function bool(value) {
  if (typeof value === "boolean") return value
  if (typeof value === "number") return value !== 0
  return ["1", "true", "yes"].includes(String(value || "").toLowerCase())
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
}

function chunkPageText(pages, maxChars = MAX_CHUNK_CHARS) {
  const chunks = []
  let current = ""
  let pageNumbers = []
  for (const page of pages || []) {
    const pageText = normalizeText(page.cleaned_text || page.raw_text)
    if (!pageText) continue
    const labelled = `Page ${page.page_number}\n${pageText}`
    if (labelled.length > maxChars) {
      if (current.trim()) chunks.push({ text: current.trim(), pages: pageNumbers })
      current = ""
      pageNumbers = []
      for (let index = 0; index < labelled.length; index += maxChars - CHUNK_OVERLAP_CHARS) {
        chunks.push({ text: labelled.slice(index, index + maxChars).trim(), pages: [page.page_number] })
      }
      continue
    }
    if (current && current.length + labelled.length + 2 > maxChars) {
      chunks.push({ text: current.trim(), pages: pageNumbers })
      current = current.slice(Math.max(0, current.length - CHUNK_OVERLAP_CHARS))
      pageNumbers = pageNumbers.slice(-1)
    }
    current = `${current}${current ? "\n\n" : ""}${labelled}`
    pageNumbers.push(page.page_number)
  }
  if (current.trim()) chunks.push({ text: current.trim(), pages: pageNumbers })
  return chunks.slice(0, MAX_AI_CHUNKS)
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Exam extraction must be a JSON object")
  if (!Array.isArray(payload.questions)) throw new Error("Exam extraction must include questions array")
  if (!Array.isArray(payload.failed_sections)) throw new Error("Exam extraction must include failed_sections array")
  payload.questions.forEach((question) => {
    if (!question.question_text) throw new Error("Every extracted question requires question_text")
    if (!Array.isArray(question.subparts)) throw new Error("Question subparts must be an array")
  })
}

function normalizeQuestion(question, chunkPages = []) {
  const subparts = (Array.isArray(question.subparts) ? question.subparts : []).map((part) => ({
    label: String(part.label || "").trim().slice(0, 30),
    text: normalizeText(part.text).slice(0, 8000),
    marks: part.marks === null || part.marks === undefined ? null : Number(part.marks) || null,
    formulas: uniqueStrings(part.formulas || [], 12),
    tables: uniqueStrings(part.tables || [], 6),
    diagram_description: normalizeText(part.diagram_description).slice(0, 1000),
    graph_description: normalizeText(part.graph_description).slice(0, 1000),
  })).filter((part) => part.text || part.formulas.length || part.tables.length)

  const formulas = uniqueStrings([
    ...(question.formulas || []),
    ...subparts.flatMap((part) => part.formulas),
  ], 20)
  const tables = uniqueStrings([
    ...(question.tables || []),
    ...subparts.flatMap((part) => part.tables),
  ], 12)
  const diagramDescriptions = uniqueStrings([
    ...(question.diagram_descriptions || []),
    question.diagram_description,
    ...subparts.map((part) => part.diagram_description),
  ], 12)
  const graphDescriptions = uniqueStrings([
    ...(question.graph_descriptions || []),
    question.graph_description,
    ...subparts.map((part) => part.graph_description),
  ], 12)
  const sourcePages = Array.isArray(question.source_pages) && question.source_pages.length
    ? question.source_pages.map(Number).filter(Boolean)
    : chunkPages
  const questionText = normalizeText(question.question_text)

  return {
    question_number: String(question.question_number || "").trim().slice(0, 40),
    question_text: questionText.slice(0, 40000),
    subparts,
    marks: question.marks === null || question.marks === undefined ? null : Number(question.marks) || null,
    formulas,
    tables,
    diagram_descriptions: diagramDescriptions,
    graph_descriptions: graphDescriptions,
    has_diagram: bool(question.has_diagram) || diagramDescriptions.length > 0,
    has_graph: bool(question.has_graph) || graphDescriptions.length > 0,
    has_table: bool(question.has_table) || tables.length > 0,
    command_word: String(question.command_word || "").trim().toLowerCase().slice(0, 80),
    source_pages: [...new Set(sourcePages)].sort((a, b) => a - b),
    confidence: clampConfidence(question.confidence, formulas.length ? 0.68 : 0.58),
  }
}

function normalizePayload(payload = {}, chunkPages = []) {
  return {
    questions: (Array.isArray(payload.questions) ? payload.questions : [])
      .map((question) => normalizeQuestion(question, chunkPages))
      .filter((question) => question.question_text),
    failed_sections: (Array.isArray(payload.failed_sections) ? payload.failed_sections : []).map((section) => ({
      page_number: Number(section.page_number) || chunkPages[0] || 1,
      text: normalizeText(section.text).slice(0, 12000),
      reason: normalizeText(section.reason || "AI could not classify this section.").slice(0, 500),
    })).filter((section) => section.text || section.reason),
    warnings: uniqueStrings(payload.warnings || [], 20),
  }
}

function mergePayloads(payloads = []) {
  const byNumberOrText = new Map()
  const failedSections = []
  const warnings = []
  for (const payload of payloads) {
    warnings.push(...(payload.warnings || []))
    failedSections.push(...(payload.failed_sections || []))
    for (const question of payload.questions || []) {
      const key = question.question_number
        ? `number:${question.question_number}`
        : `text:${question.question_text.toLowerCase().replace(/\s+/g, " ").slice(0, 180)}`
      const current = byNumberOrText.get(key)
      if (!current || question.confidence > current.confidence || question.question_text.length > current.question_text.length) {
        byNumberOrText.set(key, question)
      }
    }
  }
  return {
    questions: [...byNumberOrText.values()].sort((a, b) => {
      const aNumber = Number(String(a.question_number || "").match(/\d+/)?.[0] || 999)
      const bNumber = Number(String(b.question_number || "").match(/\d+/)?.[0] || 999)
      return aNumber - bNumber
    }),
    failed_sections: failedSections,
    warnings: uniqueStrings(warnings, 20),
  }
}

function buildPrompt({ chunk, metadata, chunkIndex, chunkCount }) {
  return `You are extracting MANEB Mathematics past-paper questions for SmartLink Exam Intelligence Lab.

Scope:
- Exam board: ${metadata.exam_board || "MANEB"}
- Exam level: ${metadata.exam_level || "MSCE"}
- Subject: ${metadata.subject || "Mathematics"}
- Paper: ${metadata.paper || ""}
- Year: ${metadata.exam_year || ""}
- Chunk ${chunkIndex + 1} of ${chunkCount}

Task:
Extract QUESTION CONTENT ONLY from the page text. Preserve formulas, equations, inequalities, matrix/vector notation, function notation, tables, graph/diagram references, and subparts.

Rules:
- Do not include cover instructions, candidate details, page numbers, "Turn over", repeated headers/footers, copyright lines, or generic exam instructions as questions.
- Keep mathematical notation readable. Convert formulas to plain text or LaTeX-like text when needed, for example "x^2 + 3x - 4 = 0", "sin theta = 3/5", "A = pi r^2".
- If a formula/table/graph/diagram is referenced but incomplete in the text, include it in formulas/tables/diagram_description/graph_description and lower confidence.
- For diagrams and graphs, describe visible labels, axes, shapes, measurements, regions, vertices, and repeated visual features so the same visual can be identified later.
- Split major numbered questions. Keep subparts under their parent question.
- Detect marks where visible.
- Use "failed_sections" for readable text that appears important but cannot be safely assigned to a question.
- This is dataset creation, not exam prediction.

Page text:
${chunk.text}`
}

export async function extractExamPaperWithAi(cleanedPages = [], metadata = {}) {
  const chunks = chunkPageText(cleanedPages)
  if (!chunks.length) {
    return { ok: false, unavailable: true, data: { questions: [], failed_sections: [], warnings: ["No readable page text was available for AI extraction."] }, message: "No readable page text was available for AI extraction.", raw: "" }
  }

  const results = []
  const rawResponses = []
  let firstUnavailable = null
  for (const [index, chunk] of chunks.entries()) {
    const result = await runAiExamPaperExtraction({
      prompt: buildPrompt({ chunk, metadata, chunkIndex: index, chunkCount: chunks.length }),
      schemaHint,
      responseSchema,
      validate: validatePayload,
      fallback: { questions: [], failed_sections: [], warnings: ["AI extraction failed for this chunk; regex fallback will be used."] },
      schoolId: metadata.schoolId || null,
      userId: metadata.userId || null,
    })
    if (result.unavailable || result.blocked) {
      firstUnavailable = result
      break
    }
    rawResponses.push(result.raw || "")
    results.push({
      ...result,
      data: normalizePayload(result.data, chunk.pages),
    })
  }

  if (firstUnavailable) {
    return {
      ...firstUnavailable,
      data: { questions: [], failed_sections: [], warnings: [firstUnavailable.message || "AI extraction is not available."] },
      raw: "",
    }
  }

  const successful = results.filter((result) => result.ok)
  const payloads = (successful.length ? successful : results).map((result) => result.data).filter(Boolean)
  const data = payloads.length ? mergePayloads(payloads) : { questions: [], failed_sections: [], warnings: ["AI extraction returned no usable questions."] }
  const firstResult = results[0] || {}
  return {
    ok: successful.length > 0 && data.questions.length > 0,
    provider: firstResult.provider,
    model: firstResult.model,
    message: successful.length > 0 ? null : firstResult.message,
    raw: rawResponses.join("\n"),
    data,
  }
}
