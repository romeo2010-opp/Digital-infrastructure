import { HttpError } from "./http.js"

const dependencyMessages = {
  fk_assessment_import_assessment: "This assessment was created from an imported paper. Its import record must be detached before deletion.",
  fk_exam_timetable_assessment: "This assessment is already scheduled on an exam timetable. Remove the timetable entry first.",
  fk_timetable_entries_assessment: "This assessment is already scheduled on a timetable. Remove the timetable entry first.",
  fk_result_batches_assessment: "This assessment already has a result-submission batch and cannot be deleted.",
  fk_subject_results_assessment: "This assessment already has student results and cannot be deleted.",
  fk_assessment_question_options_question: "This question still has answer options attached.",
  fk_assessment_marks_topic: "This assessment topic already has student marks attached.",
  fk_syllabus_topics_upload: "This syllabus upload has approved topics attached. Archive or detach those topics first.",
  fk_task_activity_task: "This follow-up contains activity history and cannot be permanently deleted. Close it instead.",
  fk_task_evidence_task: "This follow-up contains submitted evidence and cannot be permanently deleted. Close it instead.",
  fk_lesson_logs_timetable: "This timetable entry already has teaching logs and cannot be deleted.",
  fk_daily_adjustments_entry: "This timetable entry is used by a daily adjustment. Remove the adjustment first.",
  fk_entry_resources_entry: "This timetable entry still has assigned resources.",
  fk_weekly_activity_scope_activity: "This school activity still has class or staff scope assignments.",
}

function foreignKeyConstraint(error) {
  const text = String(error?.sqlMessage || error?.message || "")
  return text.match(/CONSTRAINT\s+[`'"]([^`'"]+)[`'"]/i)?.[1]
    || text.match(/constraint\s+([^\s,]+)/i)?.[1]?.replace(/[`'"]/g, "")
    || null
}

export function normalizeDatabaseError(error) {
  if (!error) return error
  if ((error instanceof HttpError || Number(error.status) >= 400) && String(error?.cause?.code || "").startsWith("ER_")) return normalizeDatabaseError(error.cause)
  if (error instanceof HttpError || Number(error.status) >= 400) return error
  const constraint = foreignKeyConstraint(error)
  if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED") {
    return new HttpError(
      409,
      dependencyMessages[constraint] || "This record is already used elsewhere in SmartLink and cannot be deleted. Remove or archive the dependent record first.",
      {
        code: "RESOURCE_IN_USE",
        details: { retryable: false, constraint: constraint || undefined },
        cause: error,
      },
    )
  }
  if (error.code === "ER_NO_REFERENCED_ROW_2" || error.code === "ER_NO_REFERENCED_ROW") {
    return new HttpError(409, "A linked record no longer exists. Refresh the page and select the item again.", {
      code: "LINKED_RECORD_NOT_FOUND",
      details: { retryable: true, constraint: constraint || undefined },
      cause: error,
    })
  }
  if (error.code === "ER_DUP_ENTRY") {
    return new HttpError(409, "This record already exists. Refresh the page before trying again.", {
      code: "DUPLICATE_RECORD",
      details: { retryable: false },
      cause: error,
    })
  }
  if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)) {
    return new HttpError(503, "SmartLink was temporarily busy saving related records. Please retry the request.", {
      code: "DATABASE_BUSY",
      details: { retryable: true },
      expose: true,
      cause: error,
    })
  }
  if (["ER_BAD_FIELD_ERROR", "ER_NO_SUCH_TABLE"].includes(error.code)) {
    return new HttpError(500, "This SmartLink feature is out of sync with the current database structure. The error has been logged for an administrator to correct; retry after the server update is applied.", {
      code: "FEATURE_SCHEMA_MISMATCH",
      details: { retryable: false },
      expose: true,
      cause: error,
    })
  }
  return error
}

export function databaseErrorDiagnostic(error) {
  const original = error?.cause || error
  return {
    database_code: original?.code || error?.code || null,
    constraint_name: foreignKeyConstraint(original),
    sql_state: original?.sqlState || null,
  }
}
