import { interpretAcademicFindings } from './ai/aiClient.js'
import { randomUUID } from 'crypto'
import { pool } from '../config/db.js'

const NARRATOR_VERSION = 'academic-narrator-v1'

async function recordNarrationRun(input, payload, result, source, validationStatus, validationError = null) {
  try {
    await pool.query(
      `INSERT INTO academic_ai_narration_runs
       (public_ref,school_id,requested_by,scope_json,finding_refs_json,provider,model,prompt_version,output_schema_version,source,validation_status,output_json,validation_error)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [randomUUID(), input.schoolId || null, input.userId || null, JSON.stringify(payload.scope || {}), JSON.stringify(payload.validatedFindings.map((finding) => finding.findingId)), result?.provider || null, result?.model || null, NARRATOR_VERSION, payload.outputSchemaVersion, source, validationStatus, result?.data ? JSON.stringify(result.data) : null, validationError],
    )
  } catch (error) {
    if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR', 'ER_NO_REFERENCED_ROW_2'].includes(error?.code)) throw error
  }
}

function text(value, fallback = '') {
  return String(value ?? fallback).trim()
}

function numberTokens(value) {
  const matches = text(value).match(/\b\d+(?:\.\d+)?\b/g) || []
  return matches.map((token) => Number(token)).filter(Number.isFinite)
}

function boundedList(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : []
}

/** Keep the AI payload evidence-first and free of raw learner records. */
export function buildNarratorInput(input = {}) {
  const findings = boundedList(input.validatedFindings || input.findings, 100).map((finding, index) => ({
    findingId: text(finding.findingId || finding.public_ref || finding.id || `finding-${index + 1}`),
    category: text(finding.category || finding.alert_type || 'academic'),
    severity: text(finding.severity || finding.priority || 'informational').toLowerCase(),
    headline: text(finding.headline || finding.title || 'Academic finding'),
    evidence: text(finding.evidence || finding.reason || finding.message),
    scope: {
      classRef: finding.scope?.classRef || finding.class_ref || null,
      subjectRef: finding.scope?.subjectRef || finding.subject_ref || null,
      topicRef: finding.scope?.topicRef || finding.topic_ref || null,
    },
    metrics: finding.metrics || finding.evidence_summary || {},
    confidence: finding.confidence ?? finding.confidence_score ?? null,
    allowedActionTypes: boundedList(finding.allowedActionTypes || finding.allowed_actions, 12),
  }))
  return {
    role: text(input.role || input.audienceRole || 'headteacher').toLowerCase(),
    scope: {
      classRef: input.scope?.classRef || input.scope?.class_ref || null,
      subjectRef: input.scope?.subjectRef || input.scope?.subject_ref || null,
      termRef: input.scope?.termRef || input.scope?.term_ref || null,
    },
    validatedFindings: findings,
    metrics: input.metrics || {},
    evidenceLimitations: boundedList(input.evidenceLimitations || input.evidence_limitations, 30),
    allowedActions: boundedList(input.allowedActions || input.allowed_actions, 30),
    schoolPolicies: input.schoolPolicies || {},
    outputSchemaVersion: '1.0',
  }
}

function phraseIndex(seed, length) {
  let hash = 0
  for (const character of text(seed)) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0
  return Math.abs(hash) % Math.max(1, length)
}

function choosePhrase(seed, phrases) {
  return phrases[phraseIndex(seed, phrases.length)]
}

export function deterministicAcademicNarration(input = {}) {
  const payload = buildNarratorInput(input)
  const ordered = [...payload.validatedFindings].sort((a, b) => {
    const rank = { critical: 4, urgent: 4, high: 3, medium: 2, low: 1, informational: 0 }
    return (rank[b.severity] || 0) - (rank[a.severity] || 0)
  })
  const roleLanguage = {
    teacher: { owner: 'teacher', impact: 'Classroom impact', action: 'Choose a focused classroom response, then test it with comparable mapped evidence.' },
    director: { owner: 'academic leadership', impact: 'Strategic pattern', action: 'Confirm ownership, monitor the cross-school pattern and require a measured outcome.' },
    school_owner: { owner: 'headteacher', impact: 'School risk', action: 'Assign an owner, set a deadline and require a linked reassessment.' },
    parent: { owner: 'school team', impact: 'Learning update', action: 'Continue the school-approved support plan and review the next learning update.' },
    student: { owner: 'teacher', impact: 'Next learning step', action: 'Practise the selected skill and use the next check to see what has improved.' },
    headteacher: { owner: 'headteacher', impact: 'School risk', action: 'Assign an owner, set a deadline and require a linked reassessment.' },
  }
  const role = roleLanguage[payload.role] || roleLanguage.headteacher
  const priorities = ordered.slice(0, 5).map((finding) => {
    const scope = [finding.scope.classRef, finding.scope.subjectRef, finding.scope.topicRef].filter(Boolean).join(' · ') || 'school evidence'
    const opening = choosePhrase(`${finding.findingId}:opening`, [
      finding.headline,
      `${finding.headline} now requires focused review.`,
      `Available evidence places ${finding.headline} among the current academic priorities.`,
    ])
    const defaultAction = choosePhrase(`${finding.findingId}:action`, [
      role.action,
      'Review the linked evidence, record a precise response and reassess with comparable mapped evidence.',
      'Confirm the affected scope before assigning a short, measurable follow-up.',
    ])
    return {
      findingId: finding.findingId,
      headline: opening,
      explanation: finding.evidence || 'Available evidence suggests that this academic scope requires review.',
      operationalImpact: `${role.impact}: ${scope}.`,
      recommendedAction: finding.allowedActionTypes[0] || payload.allowedActions[0] || defaultAction,
      ownerRole: role.owner,
      suggestedDeadlineDays: finding.severity === 'critical' || finding.severity === 'urgent' ? 2 : finding.severity === 'high' ? 7 : 14,
      reassessmentMethod: choosePhrase(`${finding.findingId}:measure`, ['Reassess with comparable mapped evidence and record the outcome.', 'Use a short mapped diagnostic after support, then compare it with the baseline.', 'Publish a comparable reassessment before resolving or escalating the finding.']),
      confidenceLanguage: finding.confidence === null ? 'Confidence is not available; treat the conclusion as provisional.' : `Evidence confidence is ${finding.confidence}%.`,
    }
  })
  return {
    executiveSummary: priorities.length ? `${priorities.length} validated academic priorities require review.` : 'No validated academic priorities are currently available.',
    priorities,
    positiveSignals: [],
    limitations: payload.evidenceLimitations,
  }
}

export function validateAcademicNarration(output, input = {}) {
  const payload = buildNarratorInput(input)
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Academic AI output must be a JSON object.')
  if (typeof output.executiveSummary !== 'string') throw new Error('Academic AI output is missing executiveSummary.')
  const findingIds = new Set(payload.validatedFindings.map((finding) => finding.findingId))
  const priorities = Array.isArray(output.priorities) ? output.priorities : []
  if (priorities.length > 5) throw new Error('Academic AI output contains more than five priorities.')
  for (const priority of priorities) {
    if (!priority || typeof priority !== 'object') throw new Error('Academic AI priority is not an object.')
    if (!findingIds.has(text(priority.findingId))) throw new Error(`Academic AI referenced an unknown finding: ${priority.findingId}`)
    for (const field of ['headline', 'explanation', 'operationalImpact', 'recommendedAction', 'ownerRole', 'reassessmentMethod', 'confidenceLanguage']) {
      if (typeof priority[field] !== 'string') throw new Error(`Academic AI priority is missing ${field}.`)
    }
    if (priority.suggestedDeadlineDays !== undefined && (!Number.isInteger(Number(priority.suggestedDeadlineDays)) || Number(priority.suggestedDeadlineDays) < 0 || Number(priority.suggestedDeadlineDays) > 90)) {
      throw new Error('Academic AI suggested deadline is outside the permitted range.')
    }
  }
  const allowedNumbers = new Set([...numberTokens(JSON.stringify(payload.metrics)), ...payload.validatedFindings.flatMap((finding) => numberTokens(JSON.stringify(finding.metrics))), ...payload.validatedFindings.flatMap((finding) => numberTokens(finding.evidence)), ...payload.validatedFindings.flatMap((finding) => numberTokens(finding.headline)), payload.validatedFindings.length, ...priorities.map((priority) => Number(priority.suggestedDeadlineDays))].filter(Number.isFinite).map((value) => Math.round(value * 100) / 100))
  // Finding IDs and workflow deadlines are references, not academic claims.
  const generatedText = JSON.stringify(output, (key, value) => ['findingId', 'suggestedDeadlineDays'].includes(key) ? undefined : value)
  for (const value of numberTokens(generatedText)) {
    // Deadline values are application-generated workflow values and were
    // removed above. Every remaining number must be present in validated
    // evidence, otherwise the response is rejected as an invented metric.
    if (!allowedNumbers.has(Math.round(value * 100) / 100)) throw new Error(`Academic AI introduced an unsupported number: ${value}`)
  }
  for (const field of ['positiveSignals', 'limitations']) {
    if (!Array.isArray(output[field])) output[field] = []
    if (output[field].some((value) => typeof value !== 'string')) throw new Error(`Academic AI ${field} must contain text values.`)
  }
  return output
}

export async function narrateAcademicFindings(input = {}) {
  const payload = buildNarratorInput(input)
  const fallback = deterministicAcademicNarration(payload)
  const systemInstruction = 'You are an academic operations analyst. Interpret only validated findings supplied in the JSON payload. Never calculate official marks, invent learners, topics, assessments, numbers or causes. Distinguish facts from inference, state limitations, cite finding IDs, and recommend reviewable educational actions. Do not infer disability, mental health, family finances, behaviour or teacher incompetence. Return strict JSON only.'
  const prompt = `${systemInstruction}\n\nValidated payload:\n${JSON.stringify(payload)}`
  const result = await interpretAcademicFindings({
    schoolId: input.schoolId || null,
    userId: input.userId || null,
    prompt,
    schemaHint: '{"executiveSummary":"","priorities":[],"positiveSignals":[],"limitations":[]}',
    fallback,
    validate: (output) => validateAcademicNarration(output, payload),
  })
  if (!result.ok || !result.data) {
    const rejected = Boolean(result.raw) && !result.unavailable && !result.blocked
    await recordNarrationRun(input, payload, { ...result, data: fallback }, 'deterministic', rejected ? 'rejected' : 'fallback', result.message || 'AI interpretation is unavailable.')
    return { ok: true, source: 'deterministic', narrator_version: NARRATOR_VERSION, data: fallback, provider: result.provider || 'none', model: result.model || null, limitations: [...payload.evidenceLimitations, result.message || 'AI interpretation is unavailable.'] }
  }
  await recordNarrationRun(input, payload, result, 'ai_explained', 'valid')
  return { ok: true, source: 'ai_explained', narrator_version: NARRATOR_VERSION, data: result.data, provider: result.provider, model: result.model, usage: result.usage, limitations: payload.evidenceLimitations }
}
