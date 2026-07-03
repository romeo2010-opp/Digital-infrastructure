import { pool } from "../../config/db.js"
import { assertSchoolFeatureEnabled, timetableFeatureKey } from "../../services/schoolFeaturesService.js"
import { HttpError } from "../../utils/http.js"
import { getScopedSchoolId } from "../../utils/tenantScope.js"
import { recordTimetableAudit } from "./audit.service.js"
import { validateTimetableEntry, assertNoBlockingConflicts } from "./conflict.service.js"
import { buildExamTimetableSolverPayload, buildSchoolTimetableSolverPayload, solverMapperUtils } from "./solverMappers.service.js"
import { TimetableSolverClient } from "./solverClient.service.js"
import { assertVersionBelongsToTimetable, cleanText, idValue, jsonString, normalizeTimetable, normalizeVersion, parseJson } from "./timetabling.helpers.js"

const { sid } = solverMapperUtils

const JOB_TYPES = new Set([
  "SCHOOL_TIMETABLE_GENERATION",
  "SCHOOL_TIMETABLE_ASSISTED_COMPLETION",
  "EXAM_TIMETABLE_GENERATION",
  "EXAM_ROOM_ALLOCATION",
  "INVIGILATION_ALLOCATION",
  "ALTERNATIVE_SLOT_SEARCH",
  "TODAY_INTELLIGENCE_REFRESH",
])

async function loadTimetable(connection, schoolId, timetableId) {
  const [[row]] = await connection.query(
    `SELECT tt.*, ay.name AS academic_year_name, t.name AS term_name
     FROM timetables tt
     JOIN academic_years ay ON ay.id = tt.academic_year_id AND ay.school_id = tt.school_id
     LEFT JOIN terms t ON t.id = tt.term_id AND t.school_id = tt.school_id
     WHERE tt.school_id = ? AND tt.id = ?
     LIMIT 1`,
    [schoolId, timetableId],
  )
  return normalizeTimetable(row)
}

async function loadVersion(connection, timetableId, versionId) {
  const [[row]] = await connection.query("SELECT * FROM timetable_versions WHERE timetable_id = ? AND id = ? LIMIT 1", [timetableId, versionId])
  return normalizeVersion(row)
}

async function updateJob(connection, jobId, patch) {
  const fields = []
  const params = []
  Object.entries(patch).forEach(([key, value]) => {
    fields.push(`${key} = ?`)
    params.push(value)
  })
  if (!fields.length) return
  params.push(jobId)
  await connection.query(`UPDATE timetable_generation_jobs SET ${fields.join(", ")} WHERE id = ?`, params)
}

async function insertNotification(connection, schoolId, userId, subject, body, metadata = {}) {
  await connection.query(
    `INSERT INTO messages (school_id, message_type, subject, body, recipient_scope, channel, delivery_status, created_by)
     VALUES (?, 'announcement', ?, ?, ?, 'in_app', 'pending', ?)`,
    [schoolId, subject, body, jsonString({ type: "school", source: "timetable_solver", ...metadata }, {}), userId],
  )
}

function jobStatusFromType(jobType) {
  return JOB_TYPES.has(jobType) ? jobType : "SCHOOL_TIMETABLE_GENERATION"
}

function solverSuccess(status) {
  return ["OPTIMAL", "FEASIBLE", "TIME_LIMIT_REACHED_WITH_SOLUTION"].includes(String(status || ""))
}

function generationFailureMessage(error) {
  if (error instanceof HttpError) return error.message
  const technicalMessage = String(error?.sqlMessage || error?.message || "")
  if (error?.code === "ER_SP_DOES_NOT_EXIST" && technicalMessage.includes("JSON_ARRAYAGG")) {
    return "Database compatibility issue while preparing timetable activities: this MariaDB version does not support JSON_ARRAYAGG."
  }
  if (["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE"].includes(error?.code)) {
    return `Database schema issue while preparing the timetable generation data: ${technicalMessage || "a required table or column is missing."}`
  }
  return "Timetable generation failed while processing the solver result."
}

function sourceIdFromSolverId(value, prefix) {
  const text = String(value || "")
  if (!text.startsWith(`${prefix}:`)) return null
  const parsed = Number(text.slice(prefix.length + 1))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function validateAndSaveSchoolAlternative(connection, schoolId, timetable, version, alternative, userId, options = {}) {
  const assignmentPayloads = []
  for (const assignment of alternative.assignments || []) {
    if (assignment.locked) continue
    assignmentPayloads.push({
      assignment,
      payload: {
        entry_type: assignment.entryType || "LESSON",
        subject_id: sourceIdFromSolverId(assignment.subjectId, "subject") || idValue(assignment.subjectId),
        class_id: sourceIdFromSolverId(assignment.classId, "class") || idValue(assignment.classId),
        stream_section: assignment.streamId || null,
        teacher_id: idValue(assignment.teacherId),
        assistant_teacher_id: idValue(assignment.assistantTeacherId),
        facility_id: idValue(assignment.facilityId),
        cycle_day_id: idValue(assignment.cycleDayId, "cycle_day_id", true),
        slot_start_id: idValue(assignment.slotStartId, "slot_start_id", true),
        slot_end_id: idValue(assignment.slotEndId || assignment.slotStartId, "slot_end_id", true),
        title: assignment.notes || null,
      },
    })
  }

  if (!options.preserveExistingEntries) {
    for (const { payload } of assignmentPayloads) {
      const conflicts = await validateTimetableEntry(connection, schoolId, timetable, version, payload, { skipVersionEntryOverlaps: true })
      assertNoBlockingConflicts(conflicts)
    }
  }

  if (options.preserveExistingEntries) {
    await connection.query(
      "DELETE FROM timetable_entries WHERE timetable_version_id = ? AND locked = 0 AND manually_modified = 0",
      [version.id],
    )
  } else {
    await connection.query("DELETE FROM timetable_entries WHERE timetable_version_id = ?", [version.id])
  }
  for (const { assignment, payload } of assignmentPayloads) {
    if (options.preserveExistingEntries) {
      const conflicts = await validateTimetableEntry(connection, schoolId, timetable, version, payload)
      assertNoBlockingConflicts(conflicts)
    }
    await connection.query(
      `INSERT INTO timetable_entries (
        timetable_version_id, cycle_day_id, slot_start_id, slot_end_id, entry_type, subject_id, class_id,
        stream_section, teacher_id, assistant_teacher_id, facility_id, required_equipment_json, title,
        locked, manually_modified, modification_reason, created_by, updated_by, notify_on_publication
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'Generated by timetable solver', ?, ?, 1)`,
      [
        version.id,
        payload.cycle_day_id,
        payload.slot_start_id,
        payload.slot_end_id,
        payload.entry_type,
        payload.subject_id,
        payload.class_id,
        payload.stream_section,
        payload.teacher_id,
        payload.assistant_teacher_id,
        payload.facility_id,
        jsonString(assignment.equipmentIds || [], []),
        payload.title,
        userId,
        userId,
      ],
    )
  }
}

async function validateAndSaveExamAlternative(connection, schoolId, timetable, version, alternative, solverPayload, userId) {
  const paperById = new Map((solverPayload.papers || []).map((paper) => [paper.id, paper]))
  const examSeriesId = Number(solverPayload.examSeriesId)
  const assessmentIds = (alternative.paperAssignments || []).map((assignment) => sourceIdFromSolverId(assignment.paperId, "assessment")).filter(Boolean)
  if (!assessmentIds.length) throw new HttpError(409, "Solver returned no assessment-backed exam papers to save.")
  await connection.query(
    `DELETE FROM timetable_entries
     WHERE timetable_version_id = ? AND locked = 0 AND manually_modified = 0
      AND assessment_id IN (${assessmentIds.map(() => "?").join(", ")})`,
    [version.id, ...assessmentIds],
  )
  await connection.query(
    `DELETE FROM exam_timetable_entries
     WHERE school_id = ? AND exam_session_id = ?
      AND assessment_id IN (${assessmentIds.map(() => "?").join(", ")})`,
    [schoolId, examSeriesId, ...assessmentIds],
  )

  for (const assignment of alternative.paperAssignments || []) {
    const paper = paperById.get(assignment.paperId)
    const assessmentId = sourceIdFromSolverId(assignment.paperId, "assessment")
    if (!paper || !assessmentId) continue
    const slotStartId = idValue(assignment.slotStartId, "exam slot_start_id", true)
    const slotEndId = idValue(assignment.slotEndId || assignment.slotStartId, "exam slot_end_id", true)
    const entryPayload = {
      calendar_date: assignment.date,
      slot_start_id: slotStartId,
      slot_end_id: slotEndId,
      entry_type: paper.requiresComputer ? "COMPUTER_BASED_EXAM" : paper.requiresLab ? "PRACTICAL_EXAM" : "EXAM_PAPER",
      subject_id: idValue(paper.subjectId),
      class_id: idValue(paper.classId),
      stream_section: paper.streamId || null,
      facility_id: idValue(assignment.facilityId),
      assessment_id: assessmentId,
      exam_session_id: examSeriesId,
      title: paper.name || "Exam paper",
    }
    const conflicts = await validateTimetableEntry(connection, schoolId, timetable, version, entryPayload)
    assertNoBlockingConflicts(conflicts)
    await connection.query(
      `INSERT INTO timetable_entries (
        timetable_version_id, calendar_date, slot_start_id, slot_end_id, entry_type, subject_id, class_id,
        stream_section, facility_id, assessment_id, exam_session_id, title,
        locked, manually_modified, modification_reason, created_by, updated_by, notify_on_publication
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 'Generated by timetable solver', ?, ?, 1)`,
      [
        version.id,
        entryPayload.calendar_date,
        entryPayload.slot_start_id,
        entryPayload.slot_end_id,
        entryPayload.entry_type,
        entryPayload.subject_id,
        entryPayload.class_id,
        entryPayload.stream_section,
        entryPayload.facility_id,
        entryPayload.assessment_id,
        entryPayload.exam_session_id,
        entryPayload.title,
        userId,
        userId,
      ],
    )
    const [[facility]] = await connection.query("SELECT name FROM school_facilities WHERE school_id = ? AND id = ? LIMIT 1", [schoolId, entryPayload.facility_id])
    await connection.query(
      `INSERT INTO exam_timetable_entries (
        school_id, exam_session_id, assessment_id, academic_year_id, term_id, class_id, stream_section, subject_id,
        exam_date, start_time, end_time, room, facility_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
      [
        schoolId,
        examSeriesId,
        assessmentId,
        Number(solverPayload.academicYearId),
        Number(solverPayload.termId),
        entryPayload.class_id,
        entryPayload.stream_section,
        entryPayload.subject_id,
        assignment.date,
        assignment.startTime,
        assignment.endTime,
        facility?.name || null,
        entryPayload.facility_id,
      ],
    )
  }
}

async function runGenerationJob(jobId) {
  const connection = await pool.getConnection()
  let job
  let timetable
  let version
  try {
    await connection.beginTransaction()
    const [[jobRow]] = await connection.query("SELECT * FROM timetable_generation_jobs WHERE id = ? LIMIT 1 FOR UPDATE", [jobId])
    if (!jobRow) throw new HttpError(404, "Generation job was not found")
    job = jobRow
    await updateJob(connection, jobId, {
      job_status: "PREPARING_INPUT",
      progress_stage: "PREPARING_INPUT",
      started_at: new Date(),
      user_message: "Preparing authorized timetable data for the solver.",
    })
    timetable = await loadTimetable(connection, Number(job.school_id), Number(job.timetable_id))
    version = await loadVersion(connection, Number(job.timetable_id), Number(job.timetable_version_id))
    assertVersionBelongsToTimetable(version, timetable.id)
    await connection.commit()

    const isExam = job.job_type === "EXAM_TIMETABLE_GENERATION" || timetable.timetable_type === "EXAM_TIMETABLE"
    const jobSnapshot = parseJson(job.result_snapshot, {})
    const options = { ...(jobSnapshot?.request_options || {}), strategy: job.strategy || job.generation_strategy || "BALANCED", examSeriesId: job.exam_series_id }
    const preserveExistingEntries = job.job_type === "SCHOOL_TIMETABLE_ASSISTED_COMPLETION" || Boolean(options.preserveLockedEntries || options.preserve_locked_entries)
    const solverPayload = isExam
      ? await buildExamTimetableSolverPayload(pool, Number(job.school_id), timetable, version, options)
      : await buildSchoolTimetableSolverPayload(pool, Number(job.school_id), timetable, version, { ...options, includeExistingEntries: preserveExistingEntries })

    await pool.query(
      `UPDATE timetable_generation_jobs
       SET job_status = 'RUNNING_SOLVER', progress_stage = 'RUNNING_SOLVER', solver_request_id = ?, user_message = ?
       WHERE id = ?`,
      [`solver-job-${jobId}`, "The OR-Tools solver is searching for a feasible draft.", jobId],
    )
    const solverResult = isExam
      ? await TimetableSolverClient.generateExamTimetable(solverPayload)
      : await TimetableSolverClient.generateSchoolTimetable(solverPayload)
    const selectedAlternative = solverResult?.alternatives?.[0]
    const softViolations = Array.isArray(selectedAlternative?.softViolations) ? selectedAlternative.softViolations : []
    const unscheduledWarningCount = softViolations.filter((violation) => violation?.code === "UNSCHEDULED_REQUIREMENT_OCCURRENCE").length
    const otherWarningCount = Math.max(0, softViolations.length - unscheduledWarningCount)
    if (!solverSuccess(solverResult?.status) || !selectedAlternative) {
      await pool.query(
        `UPDATE timetable_generation_jobs
         SET job_status = 'FAILED', progress_stage = 'FAILED', failed_at = CURRENT_TIMESTAMP, solver_status = ?,
          hard_conflict_count = ?, alternatives_count = ?, user_message = ?, internal_diagnostics = ?, solver_metrics = ?, result_snapshot = ?
         WHERE id = ?`,
        [
          solverResult?.status || "FAILED",
          Number(selectedAlternative?.hardConflictCount || 0),
          Number(solverResult?.alternatives?.length || 0),
          solverResult?.infeasibilityHints?.[0] || "The solver could not produce a publishable draft.",
          jsonString(solverResult?.diagnostics || [], []),
          jsonString(solverResult?.solverMetrics || {}, {}),
          jsonString({ solver_result: solverResult }, {}),
          jobId,
        ],
      )
      await pool.query("UPDATE timetable_versions SET status = 'DRAFT', solver_status = ? WHERE id = ?", [solverResult?.status || "FAILED", version.id])
      await pool.query("UPDATE timetables SET status = 'DRAFT' WHERE id = ? AND school_id = ?", [timetable.id, job.school_id])
      return
    }

    const saveConnection = await pool.getConnection()
    try {
      await saveConnection.beginTransaction()
      await updateJob(saveConnection, jobId, {
        job_status: "VALIDATING_RESULT",
        progress_stage: "VALIDATING_RESULT",
        user_message: "Revalidating solver assignments against SmartLink data.",
      })
      if (isExam) await validateAndSaveExamAlternative(saveConnection, Number(job.school_id), timetable, version, selectedAlternative, solverPayload, Number(job.requested_by))
      else {
        await validateAndSaveSchoolAlternative(saveConnection, Number(job.school_id), timetable, version, selectedAlternative, Number(job.requested_by), { preserveExistingEntries })
      }
      await updateJob(saveConnection, jobId, {
        job_status: "SAVING_DRAFT",
        progress_stage: "SAVING_DRAFT",
        user_message: "Saving generated draft timetable entries.",
      })
      await saveConnection.query(
        `UPDATE timetable_versions
         SET status = 'DRAFT', creation_method = 'AUTOMATIC', solver_status = ?, solver_score = ?, hard_conflict_count = ?,
          soft_penalty_score = ?, solver_configuration_snapshot = ?
         WHERE id = ?`,
        [
          solverResult.status,
          selectedAlternative.objectiveScore || 0,
          selectedAlternative.hardConflictCount || 0,
          selectedAlternative.softPenaltyScore || 0,
          jsonString({ payload_summary: { schoolId: solverPayload.schoolId, strategy: solverPayload.strategy }, solver_metrics: solverResult.solverMetrics }, {}),
          version.id,
        ],
      )
      await saveConnection.query("UPDATE timetables SET status = 'DRAFT' WHERE id = ? AND school_id = ?", [timetable.id, job.school_id])
      await updateJob(saveConnection, jobId, {
        job_status: "COMPLETED",
        progress_stage: "COMPLETE",
        completed_at: new Date(),
        solver_status: solverResult.status,
        objective_score: selectedAlternative.objectiveScore || 0,
        hard_conflict_count: selectedAlternative.hardConflictCount || 0,
        soft_penalty_score: selectedAlternative.softPenaltyScore || 0,
        alternatives_count: solverResult.alternatives?.length || 0,
        user_message: unscheduledWarningCount
          ? `Solver draft saved with ${unscheduledWarningCount} unscheduled required period${unscheduledWarningCount === 1 ? "" : "s"}${otherWarningCount ? ` and ${otherWarningCount} scheduling warning${otherWarningCount === 1 ? "" : "s"}` : ""}. Review the warnings before approval.`
          : otherWarningCount
            ? `Solver draft saved with ${otherWarningCount} scheduling warning${otherWarningCount === 1 ? "" : "s"}. Review the warnings before approval.`
          : "Solver draft saved. Review the generated timetable before approval.",
        internal_diagnostics: jsonString(solverResult.diagnostics || [], []),
        solver_metrics: jsonString(solverResult.solverMetrics || {}, {}),
        result_snapshot: jsonString({ selected_alternative: selectedAlternative, solver_status: solverResult.status }, {}),
      })
      await recordTimetableAudit({
        connection: saveConnection,
        schoolId: Number(job.school_id),
        timetableId: timetable.id,
        timetableVersionId: version.id,
        actorUserId: Number(job.requested_by),
        action: isExam ? "EXAM_SOLVER_DRAFT_SAVED" : "SOLVER_DRAFT_SAVED",
        entityType: "timetable_generation_job",
        entityId: jobId,
        newValues: { solver_status: solverResult.status, alternatives_count: solverResult.alternatives?.length || 0 },
      })
      await insertNotification(
        saveConnection,
        Number(job.school_id),
        Number(job.requested_by),
        `${timetable.name} solver draft ready`,
        "The timetable solver generated a draft version for review.",
        { timetable_id: timetable.id, version_id: version.id, job_id: jobId },
      )
      await saveConnection.commit()
    } catch (error) {
      await saveConnection.rollback()
      throw error
    } finally {
      saveConnection.release()
    }
  } catch (error) {
    const message = generationFailureMessage(error)
    await pool.query(
      `UPDATE timetable_generation_jobs
       SET job_status = 'FAILED', progress_stage = 'FAILED', failed_at = CURRENT_TIMESTAMP, error_code = ?, user_message = ?, internal_diagnostics = ?
       WHERE id = ?`,
      [error?.code || "SOLVER_JOB_FAILED", message, jsonString({ message: error?.message, stack: error?.stack }, {}), jobId],
    )
    if (job?.timetable_version_id) {
      await pool.query("UPDATE timetable_versions SET status = 'DRAFT', solver_status = 'FAILED' WHERE id = ?", [job.timetable_version_id])
    }
    if (job?.timetable_id && job?.school_id) {
      await pool.query("UPDATE timetables SET status = 'DRAFT' WHERE id = ? AND school_id = ?", [job.timetable_id, job.school_id])
    }
  } finally {
    connection.release()
  }
}

function scheduleJobRun(jobId) {
  setImmediate(() => {
    runGenerationJob(jobId).catch((error) => {
      console.error("[smartlink-schools] timetable solver job failed", { jobId, message: error?.message, stack: error?.stack })
    })
  })
}

export async function startSolverGeneration(req, options = {}) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const jobType = jobStatusFromType(options.jobType || req.body?.job_type || req.body?.jobType || "SCHOOL_TIMETABLE_GENERATION")
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  await assertSchoolFeatureEnabled(pool, schoolId, timetableFeatureKey(timetable.timetable_type))
  await assertSchoolFeatureEnabled(pool, schoolId, "timetable_generation")
  const version = await loadVersion(pool, timetableId, versionId)
  assertVersionBelongsToTimetable(version, timetableId)
  const strategy = cleanText(req.body?.strategy || req.body?.generation_strategy || (timetable.timetable_type === "EXAM_TIMETABLE" ? "CANDIDATE_FRIENDLY" : "BALANCED")).toUpperCase()
  const examSeriesId = idValue(req.body?.examSeriesId || req.body?.exam_series_id || timetable.setup_progress?.exam_session_id || timetable.setup_progress?.examSessionId)
  const scopeType = cleanText(req.body?.scopeType || req.body?.scope_type || null) || null
  const operatingMode = cleanText(req.body?.operatingMode || req.body?.operating_mode || timetable.setup_progress?.operating_mode || timetable.setup_progress?.operatingMode || null).toUpperCase()
  if ((jobType === "EXAM_TIMETABLE_GENERATION" || timetable.timetable_type === "EXAM_TIMETABLE") && !examSeriesId) {
    throw new HttpError(400, "examSeriesId is required for exam timetable generation")
  }
  if (jobType === "EXAM_TIMETABLE_GENERATION" || timetable.timetable_type === "EXAM_TIMETABLE") {
    await pool.query(
      "UPDATE timetables SET setup_progress = ? WHERE id = ? AND school_id = ?",
      [jsonString({ ...(timetable.setup_progress || {}), exam_session_id: examSeriesId, operating_mode: operatingMode || "NORMAL_LESSONS_CONTINUE", scope_type: scopeType }, {}), timetableId, schoolId],
    )
  }
  const [result] = await pool.query(
    `INSERT INTO timetable_generation_jobs (
      school_id, timetable_id, timetable_version_id, exam_series_id, job_type, job_status, progress_stage,
      requested_by, generation_strategy, strategy, scope_type, scope_reference_id, user_message, result_snapshot
    ) VALUES (?, ?, ?, ?, ?, 'QUEUED', 'PREPARING_INPUT', ?, ?, ?, ?, ?, ?, ?)`,
    [
      schoolId,
      timetableId,
      versionId,
      examSeriesId,
      jobType,
      req.user.id,
      strategy,
      strategy,
      scopeType,
      idValue(req.body?.scopeReferenceId || req.body?.scope_reference_id),
      "Generation job queued for the OR-Tools timetable solver.",
      jsonString({ request_options: req.body || {} }, {}),
    ],
  )
  const jobId = Number(result.insertId)
  await pool.query("UPDATE timetable_versions SET status = 'GENERATING', generation_strategy = ? WHERE id = ?", [strategy, versionId])
  await pool.query("UPDATE timetables SET status = 'GENERATING' WHERE id = ? AND school_id = ?", [timetableId, schoolId])
  await recordTimetableAudit({ schoolId, timetableId, timetableVersionId: versionId, actorUserId: req.user.id, action: "SOLVER_GENERATION_QUEUED", entityType: "timetable_generation_job", entityId: jobId, newValues: { jobType, strategy } })
  scheduleJobRun(jobId)
  return { job: { id: jobId, status: "QUEUED", progress_stage: "PREPARING_INPUT", strategy, job_type: jobType } }
}

export async function completeWithSolver(req) {
  return startSolverGeneration(req, { jobType: "SCHOOL_TIMETABLE_ASSISTED_COMPLETION" })
}

export async function generateExamTimetable(req) {
  return startSolverGeneration(req, { jobType: "EXAM_TIMETABLE_GENERATION" })
}

export async function cancelGenerationJob(req) {
  const schoolId = getScopedSchoolId(req)
  const jobId = idValue(req.params.jobId, "job id", true)
  const [result] = await pool.query(
    `UPDATE timetable_generation_jobs
     SET job_status = 'CANCELLED', progress_stage = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, user_message = 'Generation was cancelled by the user.'
     WHERE id = ? AND school_id = ? AND job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')`,
    [jobId, schoolId],
  )
  if (!result.affectedRows) throw new HttpError(404, "Generation job was not found or can no longer be cancelled")
  return { cancelled: true }
}

export async function findSolverAlternatives(req) {
  const schoolId = getScopedSchoolId(req)
  const timetableId = idValue(req.params.id, "timetable id", true)
  const versionId = idValue(req.params.versionId, "version id", true)
  const timetable = await loadTimetable(pool, schoolId, timetableId)
  if (!timetable) throw new HttpError(404, "Timetable was not found")
  const version = await loadVersion(pool, timetableId, versionId)
  assertVersionBelongsToTimetable(version, timetableId)
  const basePayload = await buildSchoolTimetableSolverPayload(pool, schoolId, timetable, version, { maxAlternatives: req.body?.maxAlternatives || 10 })
  const response = await TimetableSolverClient.findAlternativeSlots({
    schoolId: sid(schoolId),
    entryType: req.body?.entry_type || req.body?.entryType || "LESSON",
    subjectId: sid(req.body?.subject_id || req.body?.subjectId),
    classId: sid(req.body?.class_id || req.body?.classId),
    teacherId: sid(req.body?.teacher_id || req.body?.teacherId),
    facilityId: sid(req.body?.facility_id || req.body?.facilityId),
    cycleDays: basePayload.cycleDays,
    bellScheduleSlots: basePayload.bellScheduleSlots,
    facilities: basePayload.facilities,
    weeklyActivities: basePayload.weeklyActivities,
    teacherAvailability: basePayload.teacherAvailability,
    facilityAvailability: basePayload.facilityAvailability,
    existingOccupancy: basePayload.existingOccupancy,
    durationSlots: Number(req.body?.durationSlots || req.body?.duration_slots || 1),
    maxAlternatives: Number(req.body?.maxAlternatives || 10),
  })
  return { alternatives: response.suggestions || [], diagnostics: response.diagnostics || [], status: response.status }
}

export async function getSolverHealth() {
  return { solver: await TimetableSolverClient.healthCheck() }
}

export async function allocateExamRoomsWithSolver(req) {
  getScopedSchoolId(req)
  const response = await TimetableSolverClient.allocateExamRooms(req.body || {})
  return { allocation: response }
}

export async function allocateInvigilatorsWithSolver(req) {
  getScopedSchoolId(req)
  const response = await TimetableSolverClient.allocateInvigilators(req.body || {})
  return { invigilation: response }
}
