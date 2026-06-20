import { extractSyllabusStructure as runAiSyllabusExtraction } from "../ai/aiClient.js"

const MAX_CHUNK_CHARS = 14000
const CHUNK_OVERLAP_CHARS = 700
const MAX_AI_CHUNKS = 8

const extractionSchemaHint = `Expected JSON shape:
{"curriculum":"","level":"","grade":"","subject":"","term":"","topics":[{"topic_name":"","description":"","subtopics":[{"subtopic_name":"","learning_objectives":[],"skills":[],"suggested_week":null,"exam_relevance":"low|medium|high","keywords":[],"prerequisites":[],"confidence":0.0}],"confidence":0.0}],"warnings":[]}`

const extractionResponseSchema = {
  type: "OBJECT",
  properties: {
    curriculum: { type: "STRING" },
    level: { type: "STRING" },
    grade: { type: "STRING" },
    subject: { type: "STRING" },
    term: { type: "STRING" },
    topics: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topic_name: { type: "STRING" },
          description: { type: "STRING" },
          subtopics: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                subtopic_name: { type: "STRING" },
                learning_objectives: { type: "ARRAY", items: { type: "STRING" } },
                skills: { type: "ARRAY", items: { type: "STRING" } },
                suggested_week: { type: "INTEGER", nullable: true },
                exam_relevance: { type: "STRING", enum: ["low", "medium", "high"] },
                keywords: { type: "ARRAY", items: { type: "STRING" } },
                prerequisites: { type: "ARRAY", items: { type: "STRING" } },
                confidence: { type: "NUMBER" },
              },
              required: ["subtopic_name", "learning_objectives", "skills", "suggested_week", "exam_relevance", "keywords", "prerequisites", "confidence"],
            },
          },
          confidence: { type: "NUMBER" },
        },
        required: ["topic_name", "description", "subtopics", "confidence"],
      },
    },
    warnings: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["curriculum", "level", "grade", "subject", "term", "topics", "warnings"],
}

function clampConfidence(value, fallback = 0.55) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.min(1, number))
}

function uniqueStrings(values, limit = 12) {
  const seen = new Set()
  const result = []
  for (const value of values || []) {
    const text = String(value || "").trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push(text)
    if (result.length >= limit) break
  }
  return result
}

export function chunkSyllabusText(text, maxChars = MAX_CHUNK_CHARS) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim()
  if (!clean) return []
  const paragraphs = clean.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  const chunks = []
  let current = ""
  for (const paragraph of paragraphs.length ? paragraphs : [clean]) {
    if (paragraph.length > maxChars) {
      if (current) {
        chunks.push(current.trim())
        current = ""
      }
      for (let index = 0; index < paragraph.length; index += maxChars - CHUNK_OVERLAP_CHARS) {
        chunks.push(paragraph.slice(index, index + maxChars).trim())
      }
      continue
    }
    if ((current.length + paragraph.length + 2) > maxChars) {
      chunks.push(current.trim())
      current = current.slice(Math.max(0, current.length - CHUNK_OVERLAP_CHARS))
    }
    current = `${current}${current ? "\n\n" : ""}${paragraph}`
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks.filter(Boolean)
}

function validateExtractionPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Extraction must be a JSON object")
  if (!Array.isArray(payload.topics)) throw new Error("Extraction must include a topics array")
  payload.topics.forEach((topic) => {
    if (!topic?.topic_name) throw new Error("Every topic requires topic_name")
    if (topic.subtopics && !Array.isArray(topic.subtopics)) throw new Error("subtopics must be an array")
  })
}

function fallbackExtraction(text, metadata = {}) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 240)
  const topicLines = lines
    .filter((line) => /^(topic|unit|week|chapter|strand|section)\b[:\s-]/i.test(line) || /^[A-Z][A-Za-z0-9 ,/&()-]{4,80}$/.test(line))
    .slice(0, 12)
  const topics = (topicLines.length ? topicLines : lines.slice(0, 6)).map((line, index) => {
    const clean = line.replace(/^(topic|unit|week|chapter|strand|section)\s*\d*[:.\s-]*/i, "").trim() || `Extracted topic ${index + 1}`
    return {
      topic_name: clean.slice(0, 120),
      description: "",
      subtopics: [{
        subtopic_name: clean.slice(0, 120),
        learning_objectives: [`Review and approve learning objectives for ${clean.slice(0, 80)}.`],
        skills: ["recall"],
        suggested_week: index + 1,
        exam_relevance: "medium",
        keywords: clean.split(/\s+/).filter((part) => part.length > 3).slice(0, 6),
        prerequisites: [],
        confidence: 0.42,
      }],
      confidence: 0.45,
    }
  })
  return {
    curriculum: metadata.curriculum || "",
    level: metadata.level || "",
    grade: metadata.grade || "",
    subject: metadata.subject || "",
    term: metadata.term || "",
    topics,
    warnings: [
      "AI assistance was unavailable or the document could not be confidently parsed. Please review every extracted item carefully.",
    ],
  }
}

export function normalizeExtractionPayload(payload = {}) {
  return {
    curriculum: String(payload.curriculum || ""),
    level: String(payload.level || ""),
    grade: String(payload.grade || ""),
    subject: String(payload.subject || ""),
    term: String(payload.term || ""),
    warnings: uniqueStrings(Array.isArray(payload.warnings) ? payload.warnings : [], 20),
    topics: (Array.isArray(payload.topics) ? payload.topics : []).map((topic) => ({
      topic_name: String(topic.topic_name || topic.title || "Untitled topic").trim().slice(0, 180),
      description: String(topic.description || "").trim(),
      confidence: clampConfidence(topic.confidence, 0.55),
      subtopics: (Array.isArray(topic.subtopics) ? topic.subtopics : []).map((subtopic) => ({
        subtopic_name: String(subtopic.subtopic_name || subtopic.title || "Untitled subtopic").trim().slice(0, 180),
        learning_objectives: uniqueStrings(Array.isArray(subtopic.learning_objectives) ? subtopic.learning_objectives : [], 12),
        skills: uniqueStrings(Array.isArray(subtopic.skills) ? subtopic.skills : [], 8),
        suggested_week: subtopic.suggested_week ? Number(subtopic.suggested_week) : null,
        exam_relevance: ["low", "medium", "high"].includes(String(subtopic.exam_relevance)) ? String(subtopic.exam_relevance) : "medium",
        keywords: uniqueStrings(Array.isArray(subtopic.keywords) ? subtopic.keywords : [], 12),
        prerequisites: uniqueStrings(Array.isArray(subtopic.prerequisites) ? subtopic.prerequisites : [], 12),
        confidence: clampConfidence(subtopic.confidence, 0.5),
      })),
    })).filter((topic) => topic.topic_name),
  }
}

function mergeExtractionPayloads(payloads = [], metadata = {}) {
  const merged = {
    curriculum: "",
    level: "",
    grade: "",
    subject: "",
    term: "",
    topics: [],
    warnings: [],
  }
  const topicMap = new Map()
  for (const payload of payloads) {
    const normalized = normalizeExtractionPayload(payload)
    for (const field of ["curriculum", "level", "grade", "subject", "term"]) {
      if (!merged[field] && normalized[field]) merged[field] = normalized[field]
    }
    merged.warnings.push(...normalized.warnings)
    for (const topic of normalized.topics) {
      const topicKey = topic.topic_name.toLowerCase()
      if (!topicMap.has(topicKey)) {
        const next = { ...topic, subtopics: [...topic.subtopics] }
        topicMap.set(topicKey, next)
        merged.topics.push(next)
        continue
      }
      const existing = topicMap.get(topicKey)
      existing.description = existing.description || topic.description
      existing.confidence = Math.max(existing.confidence, topic.confidence)
      for (const subtopic of topic.subtopics) {
        const subKey = subtopic.subtopic_name.toLowerCase()
        const existingSubtopic = existing.subtopics.find((row) => row.subtopic_name.toLowerCase() === subKey)
        if (!existingSubtopic) {
          existing.subtopics.push(subtopic)
          continue
        }
        existingSubtopic.learning_objectives = uniqueStrings([...existingSubtopic.learning_objectives, ...subtopic.learning_objectives], 12)
        existingSubtopic.skills = uniqueStrings([...existingSubtopic.skills, ...subtopic.skills], 8)
        existingSubtopic.keywords = uniqueStrings([...existingSubtopic.keywords, ...subtopic.keywords], 12)
        existingSubtopic.prerequisites = uniqueStrings([...existingSubtopic.prerequisites, ...subtopic.prerequisites], 12)
        existingSubtopic.suggested_week = existingSubtopic.suggested_week || subtopic.suggested_week
        existingSubtopic.exam_relevance = existingSubtopic.exam_relevance || subtopic.exam_relevance
        existingSubtopic.confidence = Math.max(existingSubtopic.confidence, subtopic.confidence)
      }
    }
  }
  return normalizeExtractionPayload({
    curriculum: merged.curriculum || metadata.curriculum || "",
    level: merged.level || metadata.level || "",
    grade: merged.grade || metadata.grade || "",
    subject: merged.subject || metadata.subject || "",
    term: merged.term || metadata.term || "",
    topics: merged.topics,
    warnings: merged.warnings,
  })
}

function buildPrompt({ chunk, metadata, chunkIndex, chunkCount }) {
  return `Extract the syllabus structure from this school curriculum document chunk.

Metadata:
${JSON.stringify(metadata, null, 2)}

Chunk: ${chunkIndex + 1} of ${chunkCount}

Rules:
- Extract only curriculum data supported by this chunk.
- Include topics, subtopics, objectives, skills, teaching weeks, exam relevance, keywords, prerequisites, confidence scores, and warnings.
- Set low confidence when the source is unclear.
- Do not invent topics that are not supported by the document.
- Return JSON only.

Document chunk:
${chunk}`
}

export async function extractSyllabusStructure(text, metadata = {}) {
  const chunks = chunkSyllabusText(text).slice(0, MAX_AI_CHUNKS)
  const fallback = fallbackExtraction(text, metadata)
  if (!chunks.length) {
    return { ok: false, data: normalizeExtractionPayload(fallback), message: "No readable syllabus text was found.", model: null, raw: "" }
  }

  const results = []
  const rawResponses = []
  let firstUnavailable = null
  for (const [index, chunk] of chunks.entries()) {
    const result = await runAiSyllabusExtraction({
      prompt: buildPrompt({ chunk, metadata, chunkIndex: index, chunkCount: chunks.length }),
      schemaHint: extractionSchemaHint,
      responseSchema: extractionResponseSchema,
      validate: validateExtractionPayload,
      fallback: fallbackExtraction(chunk, metadata),
      schoolId: metadata.schoolId || null,
      userId: metadata.userId || null,
    })
    if (result.unavailable || result.blocked) {
      firstUnavailable = result
      break
    }
    rawResponses.push(result.raw || "")
    results.push(result)
  }

  if (firstUnavailable) {
    return {
      ...firstUnavailable,
      data: normalizeExtractionPayload(fallback),
      raw: "",
    }
  }

  const successful = results.filter((result) => result.ok)
  const payloads = (successful.length ? successful : results).map((result) => result.data).filter(Boolean)
  const data = payloads.length ? mergeExtractionPayloads(payloads, metadata) : normalizeExtractionPayload(fallback)
  const firstResult = results[0] || {}
  return {
    ok: successful.length > 0,
    provider: firstResult.provider,
    model: firstResult.model,
    message: successful.length > 0 ? null : firstResult.message,
    raw: rawResponses.join("\n"),
    data,
  }
}
