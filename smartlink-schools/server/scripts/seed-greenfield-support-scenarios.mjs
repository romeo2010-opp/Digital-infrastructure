import "dotenv/config"
import { randomUUID } from "crypto"
import { pool } from "../src/config/db.js"

const db = await pool.getConnection()
const j = JSON.stringify
const now = new Date()
const days = (offset) => new Date(now.getTime() + offset * 86_400_000)

try {
  await db.beginTransaction()
  const [[school]] = await db.query("SELECT id,name FROM schools WHERE name='Greenfield Academy' LIMIT 1")
  if (!school) throw new Error("Greenfield Academy was not found")
  const [[actor]] = await db.query("SELECT id,role FROM users WHERE school_id=? AND role='headteacher' AND employment_status='active' ORDER BY id LIMIT 1", [school.id])
  const [[term]] = await db.query("SELECT t.id term_id,t.academic_year_id FROM terms t JOIN academic_years ay ON ay.id=t.academic_year_id AND ay.school_id=t.school_id WHERE t.school_id=? AND ay.status='active' AND t.status IN ('open','marking') ORDER BY t.term_number DESC LIMIT 1", [school.id])
  const [[classRow]] = await db.query("SELECT c.id,c.name,COUNT(se.student_id) learners FROM classes c JOIN student_enrollments se ON se.school_id=c.school_id AND se.class_id=c.id AND se.term_id=? AND se.enrollment_status='active' WHERE c.school_id=? GROUP BY c.id ORDER BY learners DESC LIMIT 1", [term.term_id, school.id])
  const [learners] = await db.query("SELECT s.id,CONCAT(s.first_name,' ',s.last_name) name FROM student_enrollments se JOIN students s ON s.id=se.student_id AND s.school_id=se.school_id WHERE se.school_id=? AND se.class_id=? AND se.term_id=? AND se.enrollment_status='active' ORDER BY s.id LIMIT 24", [school.id, classRow.id, term.term_id])
  if (learners.length < 8) throw new Error("Eight active Greenfield learners are required")
  const [[subject]] = await db.query("SELECT id,name FROM subjects WHERE school_id=? AND name LIKE '%Math%' ORDER BY id LIMIT 1", [school.id])
  const [[topic]] = await db.query("SELECT id,topic_name FROM syllabus_topics WHERE school_id=? AND subject_id=? AND is_active=1 ORDER BY id LIMIT 1", [school.id, subject.id])
  const [strategies] = await db.query("SELECT id,strategy_code,label FROM intervention_strategy_types WHERE school_id=?", [school.id])
  const strategy = Object.fromEntries(strategies.map((row) => [row.strategy_code, row]))

  const identities = "ABCDEFGH".split("").map((letter) => `demo:greenfield:support:${letter}`)
  await db.query(`DELETE FROM learner_support_cases WHERE school_id=? AND identity_key IN (${identities.map(() => "?").join(",")})`, [school.id, ...identities])

  async function createCase(letter, values, memberIndexes, events, evidence = []) {
    const ref = randomUUID()
    const learner = values.scope_type === "learner" || values.scope_type === "cross_subject" ? learners[memberIndexes[0]] : null
    const summary = values.summary
    const [result] = await db.query(`INSERT INTO learner_support_cases (public_ref,school_id,academic_year_id,current_term_id,class_id,learner_id,subject_id,primary_topic_id,scope_type,case_type,severity,status,first_detected_at,last_reviewed_at,next_review_at,owner_user_id,owner_role,intervention_cycle_count,unsuccessful_cycle_count,successful_cycle_count,comparable_failure_count,evidence_confidence,current_summary,escalation_level,identity_key,version_number,created_by,updated_by,closed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`, [ref, school.id, term.academic_year_id, term.term_id, classRow.id, learner?.id || null, values.subject_id === null ? null : subject.id, values.topic_id === null ? null : topic.id, values.scope_type, values.case_type, values.severity || "medium", values.status, days(-30), days(-1), values.status === "resolved" ? null : days(5), actor.id, actor.role, values.cycles || 0, values.unsuccessful || 0, values.successful || 0, values.failures || 1, values.confidence || 80, summary, values.level || 0, `demo:greenfield:support:${letter}`, actor.id, actor.id, values.status === "resolved" ? days(-1) : null])
    const caseId = result.insertId
    for (const index of memberIndexes) await db.query("INSERT INTO learner_support_case_members (public_ref,school_id,case_id,learner_id,membership_status,baseline_summary_json,outcome_summary_json,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?)", [randomUUID(), school.id, caseId, learners[index].id, values.status === "resolved" ? "resolved" : "active", j({ score: 42 }), j({ scenario: letter, status: values.status }), actor.id, actor.id])
    if (values.topic_id !== null && values.subject_id !== null) await db.query("INSERT INTO learner_support_case_topics (public_ref,school_id,case_id,subject_id,topic_id,topic_role,current_mastery,previous_mastery,status,created_by,updated_by) VALUES (?,?,?,?,?,'primary',?,?,?, ?,?)", [randomUUID(), school.id, caseId, subject.id, topic.id, values.currentMastery ?? 45, values.previousMastery ?? 40, values.status === "resolved" ? "resolved" : "active", actor.id, actor.id])
    for (const [index, item] of evidence.entries()) await db.query(`INSERT INTO learner_support_case_evidence (public_ref,school_id,case_id,academic_year_id,term_id,learner_id,subject_id,topic_id,evidence_role,evidence_precision,score_percentage,marks_awarded,marks_available,confidence_score,comparable,comparability_json,evidence_status,observed_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [randomUUID(), school.id, caseId, term.academic_year_id, term.term_id, learner?.id || learners[memberIndexes[0]].id, values.subject_id === null ? null : subject.id, values.topic_id === null ? null : topic.id, index ? "reassessment" : "baseline", item.precision || "question", item.score, item.score === null || item.score === undefined ? null : item.score / 10, item.score === null || item.score === undefined ? null : 10, item.confidence || 85, index ? 1 : 0, j({ comparable: true, scenario: letter }), item.status || "valid", days(item.day || -20 + index * 10), actor.id, actor.id])
    for (const [index, item] of events.entries()) await db.query("INSERT INTO learner_support_case_events (public_ref,school_id,case_id,term_id,event_type,summary,evidence_json,status,responsible_user_id,idempotency_key,occurred_at,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", [randomUUID(), school.id, caseId, term.term_id, item.type, item.summary, j({ scenario: letter, ...(item.evidence || {}) }), item.status || values.status, actor.id, `greenfield-support-${letter}-${index}`, days(item.day ?? -events.length + index), actor.id, actor.id])
    return { id: caseId, ref, learner, values }
  }

  async function addCycle(caseRecord, cycleNumber, strategyCode, status, outcome, options = {}) {
    const cycleRef = randomUUID(); const strategyRow = strategy[strategyCode]
    const [result] = await db.query(`INSERT INTO intervention_cycles (public_ref,school_id,case_id,term_id,cycle_number,strategy_type_id,owner_user_id,planned_session_count,success_criterion_json,delivery_threshold,attendance_threshold,start_date,review_date,status,outcome,diagnostic_json,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [cycleRef, school.id, caseRecord.id, term.term_id, cycleNumber, strategyRow.id, actor.id, options.planned || 3, j({ mastery_threshold: 70, minimum_meaningful_change: 5 }), 80, 70, days(-18 + cycleNumber * 4), days(-8 + cycleNumber * 4), status, outcome, j(options.diagnostic || { outcome }), actor.id, actor.id])
    for (let index = 1; index <= (options.sessions || options.planned || 3); index += 1) {
      const sessionRef = randomUUID(); const sessionStatus = index <= (options.completed ?? options.sessions ?? options.planned ?? 3) ? "completed" : "planned"
      const [sessionResult] = await db.query("INSERT INTO intervention_sessions (public_ref,school_id,term_id,cycle_id,session_number,scheduled_at,completed_at,status,teacher_attended,target_taught,prerequisite_addressed,resources_json,activities_json,teacher_notes,review_status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [sessionRef, school.id, term.term_id, result.insertId, index, days(-16 + index), sessionStatus === "completed" ? days(-16 + index) : null, sessionStatus, 1, 1, options.prerequisite ? 1 : 0, j([strategyRow.label]), j(["Mapped guided support"]), `Scenario ${caseRecord.values.scenario || "support"} session evidence.`, "reviewed", actor.id, actor.id])
      for (const memberIndex of options.memberIndexes || []) await db.query("INSERT INTO intervention_session_attendance (public_ref,school_id,session_id,learner_id,attendance_status,status,created_by,updated_by) VALUES (?,?,?,?,?,'active',?,?)", [randomUUID(), school.id, sessionResult.insertId, learners[memberIndex].id, options.attendance?.[index - 1] || "present", actor.id, actor.id])
    }
    return cycleRef
  }

  const scenarioA = await createCase("A", { scenario: "A", scope_type: "learner", case_type: "topic_mastery", status: "resolved", level: 0, cycles: 1, successful: 1, failures: 2, currentMastery: 76, previousMastery: 41, summary: `${learners[0].name} met the configured criterion in two comparable checks after guided support. The case is resolved with monitoring.` }, [0], [{ type: "case_detected", summary: "Repeated mapped weakness created a formal support case." }, { type: "intervention_outcome_reviewed", summary: "Comparable reassessment reached the configured success criterion.", status: "continued_support" }, { type: "case_resolved", summary: "Human review confirmed sustained progress and resolved the case.", status: "resolved" }], [{ score: 41 }, { score: 73 }, { score: 76 }])
  await addCycle(scenarioA, 1, "guided_practice", "completed", "effective", { memberIndexes: [0], diagnostic: { outcome: "effective", supportDeliveryRate: 100, learnerAttendanceRate: 100, reassessmentComparable: true } })

  const scenarioB = await createCase("B", { scenario: "B", scope_type: "learner", case_type: "topic_mastery", status: "strategy_review", level: 3, cycles: 1, unsuccessful: 1, failures: 2, summary: `${learners[1].name} attended and completed the first support cycle, but comparable evidence remains below criterion. A different strategy is required.` }, [1], [{ type: "case_detected", summary: "Two comparable mapped results triggered formal intervention." }, { type: "intervention_outcome_reviewed", summary: "Delivered support produced insufficient progress; strategy review is required.", status: "strategy_review" }], [{ score: 38 }, { score: 41 }])
  await addCycle(scenarioB, 1, "guided_practice", "completed", "ineffective", { memberIndexes: [1], diagnostic: { outcome: "ineffective", supportDeliveryRate: 100, learnerAttendanceRate: 100, reassessmentComparable: true, recommendedEscalation: "strategy_review" } })

  const scenarioC = await createCase("C", { scenario: "C", scope_type: "learner", case_type: "multi_topic", status: "academic_team_review", level: 4, cycles: 2, unsuccessful: 2, failures: 3, summary: `${learners[2].name} completed two materially different support cycles without sufficient comparable progress. Academic team review is required.` }, [2], [{ type: "intervention_outcome_reviewed", summary: "First cycle moved to strategy review.", status: "strategy_review" }, { type: "intervention_outcome_reviewed", summary: "Second unsuccessful cycle reached the academic-review policy threshold.", status: "academic_team_review" }], [{ score: 35 }, { score: 39 }, { score: 40 }])
  await addCycle(scenarioC, 1, "guided_practice", "completed", "ineffective", { memberIndexes: [2] })
  await addCycle(scenarioC, 2, "visual_concrete_materials", "completed", "ineffective", { memberIndexes: [2] })

  const scenarioD = await createCase("D", { scenario: "D", scope_type: "learner", case_type: "attendance_participation", status: "continued_support", level: 2, cycles: 1, failures: 2, summary: `${learners[3].name} missed most planned support sessions. Learner response has not been classified; participation follow-up is required.` }, [3], [{ type: "intervention_outcome_reviewed", summary: "Attendance was below policy. The intervention was not labelled ineffective.", status: "continued_support" }], [{ score: 43 }])
  await addCycle(scenarioD, 1, "small_group_instruction", "insufficient_participation", "not_classified", { memberIndexes: [3], attendance: ["absent", "absent", "present"], diagnostic: { outcome: "insufficient_participation", supportDeliveryRate: 100, learnerAttendanceRate: 33.33 } })

  const scenarioE = await createCase("E", { scenario: "E", scope_type: "learner", case_type: "topic_mastery", status: "reassessment_pending", level: 2, cycles: 1, failures: 2, summary: `${learners[4].name} was absent for the scheduled reassessment. No failure was counted and another reassessment is required.` }, [4], [{ type: "reassessment_absent", summary: "The learner was absent; the result was excluded from outcome classification.", status: "reassessment_pending" }, { type: "reassessment_rescheduled", summary: "A replacement comparable reassessment is pending.", status: "reassessment_pending" }], [{ score: 44 }, { score: null, status: "absent" }])
  await addCycle(scenarioE, 1, "worked_examples", "awaiting_reassessment", "pending", { memberIndexes: [4] })

  const classMembers = learners.slice(0, Math.min(17, learners.length)).map((_item, index) => index)
  await createCase("F", { scenario: "F", scope_type: "class", case_type: "topic_mastery", status: "teacher_follow_up", level: 1, failures: 1, summary: `${classMembers.length} of ${learners.length} learners were below threshold in ${topic.topic_name}. One class-level teaching and assessment review was created instead of duplicate learner cases.` }, classMembers, [{ type: "class_issue_detected", summary: "Widespread mapped weakness was consolidated into one class-level issue.", evidence: { affected: classMembers.length, class_size: learners.length } }], [{ score: 42 }])

  await createCase("G", { scenario: "G", scope_type: "cross_subject", case_type: "multi_subject_decline", status: "academic_team_review", level: 4, failures: 3, subject_id: null, topic_id: null, summary: `Performance for ${learners[6].name} has declined across Mathematics, English and Science over four valid assessments. A broader academic review is recommended; no cause has been inferred.` }, [6], [{ type: "multi_subject_review_detected", summary: "A neutral cross-subject pattern was identified from valid published evidence." }, { type: "academic_review_requested", summary: "The academic team was asked to review the broader learning pattern.", status: "academic_team_review" }])

  await createCase("H", { scenario: "H", scope_type: "learner", case_type: "assessment_format", status: "teacher_follow_up", level: 1, failures: 1, summary: `${learners[7].name} demonstrates stronger understanding in guided oral tasks than in timed written assessments. A mixed-format review and gradual timed practice are recommended; no diagnosis is implied.` }, [7], [{ type: "format_pattern_detected", summary: "Published evidence showed a repeatable difference between oral-guided and timed-written formats.", evidence: { stronger_format: "guided_oral", weaker_format: "timed_written" } }], [{ score: 72, precision: "question" }, { score: 46, precision: "question" }])

  await db.commit()
  const [rows] = await db.query("SELECT RIGHT(identity_key,1) scenario,scope_type,case_type,status,escalation_level,intervention_cycle_count,unsuccessful_cycle_count,current_summary FROM learner_support_cases WHERE school_id=? AND identity_key LIKE 'demo:greenfield:support:%' ORDER BY identity_key", [school.id])
  console.log(JSON.stringify({ status: "completed", school: school.name, scenarios: rows }, null, 2))
} catch (error) {
  await db.rollback()
  throw error
} finally {
  db.release()
  await pool.end()
}
