function money(value) {
  return `MWK ${Number(value || 0).toLocaleString()}`
}

function percent(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function insight(message, tone = "neutral", metric = null) {
  return { message, tone, metric }
}

export function generateFinanceInsights(metrics = {}) {
  const insights = []
  const collectionRate = Number(metrics.collectionRate || 0)
  const billed = Number(metrics.totalBilled || 0)
  const collected = Number(metrics.totalCollected || 0)
  const outstanding = Number(metrics.totalOutstanding || 0)
  const highDebtStudents = Number(metrics.highDebtStudents || 0)
  const weakestClass = metrics.weakestClass
  const topOutstandingClass = metrics.topOutstandingClass
  const targetRate = Number(metrics.targetRate || 80)

  if (billed > 0) {
    insights.push(
      collectionRate >= targetRate
        ? insight(`Fee collection is on track at ${percent(collectionRate)} against a ${percent(targetRate)} target.`, "good", "collection_rate")
        : insight(`Fee collection is behind target. The school has collected ${money(collected)} out of ${money(billed)} billed.`, "warn", "collection_rate"),
    )
  }
  if (outstanding > 0) {
    insights.push(insight(`Outstanding fees currently total ${money(outstanding)}.`, collectionRate < 50 ? "bad" : "warn", "outstanding"))
  }
  if (topOutstandingClass?.class_name && Number(topOutstandingClass.outstanding || 0) > 0) {
    insights.push(insight(`${topOutstandingClass.class_name} has the highest outstanding balance at ${money(topOutstandingClass.outstanding)}.`, "warn", "class_outstanding"))
  }
  if (weakestClass?.class_name && Number(weakestClass.collection_rate || 0) < targetRate) {
    insights.push(insight(`${weakestClass.class_name} has the weakest collection rate at ${percent(weakestClass.collection_rate)}.`, "warn", "class_collection"))
  }
  if (highDebtStudents > 0) {
    insights.push(insight(`${highDebtStudents} student${highDebtStudents === 1 ? "" : "s"} owe more than ${money(metrics.highDebtThreshold || 500000)} each.`, "bad", "high_debt"))
  }
  if (!insights.length) insights.push(insight("No fee records are available yet. Finance insights will appear after accounts or payments are recorded.", "neutral", "empty"))
  return insights.slice(0, 6)
}

export function generateAcademicInsights(metrics = {}) {
  const insights = []
  const average = Number(metrics.overallAverage || 0)
  const passRate = Number(metrics.passRate || 0)
  const atRisk = Number(metrics.atRiskStudents || 0)
  const weakestSubject = metrics.weakestSubject
  const weakestClass = metrics.weakestClass

  if (metrics.resultCount > 0) {
    insights.push(insight(`The current academic average is ${percent(average)} with a ${percent(passRate)} pass rate.`, passRate < 60 ? "warn" : "good", "academic_health"))
  }
  if (weakestSubject?.subject_name) {
    insights.push(insight(`${weakestSubject.subject_name} is the weakest subject at ${percent(weakestSubject.current_average)} average.`, Number(weakestSubject.current_average || 0) < Number(metrics.passMark || 50) ? "bad" : "warn", "weak_subject"))
  }
  if (weakestClass?.class_name) {
    insights.push(insight(`${weakestClass.class_name} has the lowest class average at ${percent(weakestClass.average_score)}.`, "warn", "weak_class"))
  }
  if (atRisk > 0) {
    insights.push(insight(`${atRisk} learner${atRisk === 1 ? "" : "s"} currently need intervention based on academic, absence, withdrawal or fee risk.`, atRisk > 5 ? "bad" : "warn", "at_risk"))
  }
  if (!insights.length) insights.push(insight("No submitted academic results are available yet. Academic insights will appear after marks are submitted.", "neutral", "empty"))
  return insights.slice(0, 6)
}

export function generateSubjectInsights(metrics = {}) {
  const insights = []
  const weakest = metrics.weakestSubject
  const best = metrics.bestSubject
  const improved = metrics.mostImprovedSubject
  const declined = metrics.mostDeclinedSubject
  const belowPass = Number(metrics.totalBelowPass || 0)

  if (weakest?.subject_name) {
    insights.push(insight(`${weakest.subject_name} is the weakest subject this term with an average of ${percent(weakest.current_average)}.`, Number(weakest.current_average || 0) < Number(metrics.passMark || 50) ? "bad" : "warn", "weak_subject"))
  }
  if (best?.subject_name) insights.push(insight(`${best.subject_name} is the strongest subject at ${percent(best.current_average)} average.`, "good", "best_subject"))
  if (improved?.subject_name && Number(improved.change || 0) >= 3) {
    insights.push(insight(`${improved.subject_name} improved by ${percent(improved.change)} compared with the previous assessment window.`, "good", "improved_subject"))
  }
  if (declined?.subject_name && Number(declined.change || 0) <= -3) {
    insights.push(insight(`${declined.subject_name} declined by ${percent(Math.abs(declined.change))}. Director intervention may be needed.`, "bad", "declined_subject"))
  }
  if (belowPass > 0) insights.push(insight(`${belowPass} learner${belowPass === 1 ? "" : "s"} are below the pass mark across current subject results.`, "warn", "below_pass"))
  if (!insights.length) insights.push(insight("No submitted subject results are available yet. Subject trends will appear after marks are submitted and locked.", "neutral", "empty"))
  return insights.slice(0, 6)
}

export function generateMarksSubmissionInsights(metrics = {}) {
  const insights = []
  const draft = Number(metrics.draftBatches || 0)
  const pending = Number(metrics.pendingBatches || 0)
  const overdue = Number(metrics.overdueBatches || 0)
  const absent = Number(metrics.totalAbsentEntries || 0)
  const withdrawalAbsent = Number(metrics.withdrawalAbsentEntries || 0)
  const topPendingTeacher = metrics.topPendingTeacher

  if (draft > 0) insights.push(insight(`${draft} assessment batch${draft === 1 ? " is" : "es are"} still in draft and not locked.`, "warn", "draft_batches"))
  if (pending > 0) insights.push(insight(`${pending} expected mark submission${pending === 1 ? " is" : "s are"} still pending.`, "warn", "pending_batches"))
  if (overdue > 0) insights.push(insight(`${overdue} mark submission${overdue === 1 ? " is" : "s are"} overdue based on scheduled exam dates.`, "bad", "overdue_batches"))
  if (topPendingTeacher?.teacher_name && Number(topPendingTeacher.pending_marks || 0) > 0) {
    insights.push(insight(`${topPendingTeacher.teacher_name} has ${topPendingTeacher.pending_marks} pending mark submission${Number(topPendingTeacher.pending_marks) === 1 ? "" : "s"}.`, "warn", "teacher_pending"))
  }
  if (absent > 0) insights.push(insight(`${absent} assessment entr${absent === 1 ? "y is" : "ies are"} marked absent.`, withdrawalAbsent > 0 ? "warn" : "neutral", "absent_entries"))
  if (withdrawalAbsent > 0) insights.push(insight(`${withdrawalAbsent} absence${withdrawalAbsent === 1 ? " is" : "s are"} linked to active withdrawal periods.`, "warn", "withdrawal_absences"))
  if (!insights.length) insights.push(insight("No mark submission issues are visible from current result batches.", "good", "clean"))
  return insights.slice(0, 6)
}

export function generateCapacityInsights(metrics = {}) {
  const insights = []
  const emptySeats = Number(metrics.emptySeats || 0)
  const overCapacity = Number(metrics.overCapacityClasses || 0)
  const nearFull = Number(metrics.nearFullClasses || 0)
  const topEmpty = metrics.topEmptyClass

  if (emptySeats > 0) insights.push(insight(`The school has ${emptySeats} empty seat${emptySeats === 1 ? "" : "s"} across configured classes.`, "warn", "empty_seats"))
  if (topEmpty?.class_name && Number(topEmpty.empty_seats || 0) > 0) insights.push(insight(`${topEmpty.class_name} has ${topEmpty.empty_seats} empty seat${Number(topEmpty.empty_seats) === 1 ? "" : "s"}.`, "warn", "class_empty_seats"))
  if (nearFull > 0) insights.push(insight(`${nearFull} class${nearFull === 1 ? " is" : "es are"} near capacity.`, "neutral", "near_capacity"))
  if (overCapacity > 0) insights.push(insight(`${overCapacity} class${overCapacity === 1 ? " is" : "es are"} over capacity and may need enrollment controls.`, "bad", "over_capacity"))
  if (metrics.estimatedLostRevenue > 0) insights.push(insight(`Empty seats represent about ${money(metrics.estimatedLostRevenue)} in possible term revenue.`, "warn", "lost_revenue"))
  if (!insights.length) insights.push(insight("No class capacity settings have been configured. Add maximum capacity values to calculate occupancy and empty-seat revenue.", "neutral", "empty"))
  return insights.slice(0, 6)
}

export function generateWithdrawalInsights(metrics = {}) {
  const insights = []
  const active = Number(metrics.activeWithdrawals || 0)
  const temporary = Number(metrics.temporaryWithdrawals || 0)
  const endingSoon = Number(metrics.endingSoon || 0)
  const examsAffected = Number(metrics.examsAffected || 0)
  const permanent = Number(metrics.permanentThisTerm || 0)

  if (active > 0) insights.push(insight(`${active} withdrawn student${active === 1 ? " is" : "s are"} still within active withdrawal periods.`, "warn", "active_withdrawals"))
  if (temporary > 0) insights.push(insight(`${temporary} active temporary withdrawal${temporary === 1 ? "" : "s"} should be reviewed before the end date.`, "warn", "temporary_withdrawals"))
  if (endingSoon > 0) insights.push(insight(`${endingSoon} temporary withdrawal${endingSoon === 1 ? "" : "s"} expire within the next 7 days.`, "neutral", "ending_soon"))
  if (examsAffected > 0) insights.push(insight(`${examsAffected} scheduled exam${examsAffected === 1 ? " was" : "s were"} affected by withdrawal periods.`, "warn", "exams_affected"))
  if (permanent > 0) insights.push(insight(`${permanent} permanent withdrawal${permanent === 1 ? "" : "s"} happened this term.`, "bad", "permanent_withdrawals"))
  if (!insights.length) insights.push(insight("No student withdrawals have been recorded for this school.", "good", "empty"))
  return insights.slice(0, 6)
}

export function generateStaffInsights(metrics = {}) {
  const insights = []
  const pendingTeachers = Number(metrics.teachersWithPendingMarks || 0)
  const fullyCompliant = Number(metrics.fullyCompliantTeachers || 0)
  const totalTeachers = Number(metrics.totalTeachers || 0)
  const missingLessonLogs = Number(metrics.missingLessonLogs || 0)
  const highestWorkload = metrics.highestWorkloadTeacher

  if (totalTeachers > 0) insights.push(insight(`${fullyCompliant} of ${totalTeachers} teacher${totalTeachers === 1 ? "" : "s"} are fully compliant on currently visible academic responsibilities.`, fullyCompliant === totalTeachers ? "good" : "warn", "teacher_compliance"))
  if (pendingTeachers > 0) insights.push(insight(`${pendingTeachers} teacher${pendingTeachers === 1 ? " has" : "s have"} pending mark submissions.`, "warn", "pending_marks"))
  if (missingLessonLogs > 0) insights.push(insight(`${missingLessonLogs} teacher${missingLessonLogs === 1 ? " has" : "s have"} no lesson logs recorded in the current view.`, "warn", "lesson_logs"))
  if (highestWorkload?.teacher_name) insights.push(insight(`${highestWorkload.teacher_name} has the highest visible workload.`, "neutral", "workload"))
  if (!insights.length) insights.push(insight("No teacher accountability data is available yet.", "neutral", "empty"))
  return insights.slice(0, 6)
}

export function generateOperationsInsights(metrics = {}) {
  const insights = []
  if (Number(metrics.openIncidents || 0) > 0) insights.push(insight(`${metrics.openIncidents} incident${Number(metrics.openIncidents) === 1 ? " is" : "s are"} still open.`, "warn", "open_incidents"))
  if (Number(metrics.criticalIncidents || 0) > 0) insights.push(insight(`${metrics.criticalIncidents} critical incident${Number(metrics.criticalIncidents) === 1 ? "" : "s"} need director attention.`, "bad", "critical_incidents"))
  if (Number(metrics.openComplaints || 0) > 0) insights.push(insight(`${metrics.openComplaints} complaint${Number(metrics.openComplaints) === 1 ? " is" : "s are"} open.`, "warn", "open_complaints"))
  if (Number(metrics.urgentComplaints || 0) > 0) insights.push(insight(`${metrics.urgentComplaints} urgent complaint${Number(metrics.urgentComplaints) === 1 ? "" : "s"} need follow-up.`, "bad", "urgent_complaints"))
  if (Number(metrics.pendingApprovals || 0) > 0) insights.push(insight(`${metrics.pendingApprovals} approval${Number(metrics.pendingApprovals) === 1 ? " is" : "s are"} waiting for director review.`, "warn", "pending_approvals"))
  if (!insights.length) insights.push(insight("No unresolved incidents, complaints or approvals are currently visible.", "good", "clean"))
  return insights.slice(0, 6)
}
