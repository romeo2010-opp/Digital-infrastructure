import { pool } from "../config/db.js"
import { createInAppNotification } from "./operationalCommunicationService.js"

async function safeRows(sql,params=[]) { try { return (await pool.query(sql,params))[0] } catch(error) { if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error?.code)) return []; throw error } }
async function learnerSupportReminderCapabilities() {
  const rows = await safeRows(`SELECT TABLE_NAME AS table_name,COLUMN_NAME AS column_name
    FROM information_schema.columns
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('learner_support_case_assignments','academic_intervention_reassessments')`)
  const available = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`))
  return {
    assignments: available.has("learner_support_case_assignments.id"),
    reassessmentDueAt: available.has("academic_intervention_reassessments.due_at"),
  }
}
export async function runReminderEngine(schoolId,actorId=null) {
  const window=new Date().toISOString().slice(0,10); const created=[]
  const overdueMarks=await safeRows(`SELECT rb.id,rb.teacher_id,a.name assessment_name,c.name class_name,subj.name subject_name FROM result_batches rb JOIN assessments a ON a.id=rb.assessment_id JOIN classes c ON c.id=rb.class_id JOIN subjects subj ON subj.id=rb.subject_id LEFT JOIN exam_timetable_entries ete ON ete.assessment_id=a.id AND ete.status<>'cancelled' WHERE rb.school_id=? AND rb.status NOT IN ('submitted','approved','locked') AND COALESCE(ete.exam_date,DATE(a.updated_at),DATE(a.created_at))<CURDATE()`,[schoolId])
  for(const row of overdueMarks) created.push(await createInAppNotification({schoolId,recipientUserId:row.teacher_id,title:"Marks submission overdue",message:`${row.class_name} ${row.subject_name} marks for ${row.assessment_name} are overdue.`,category:"academics",priority:"high",linkedEntityType:"result_batch",linkedEntityId:row.id,createdBy:actorId,ruleKey:"marks_submission_overdue",dedupeWindow:window}))
  const attendance=await safeRows(`SELECT u.id,u.full_name FROM users u LEFT JOIN staff_attendance sa ON sa.staff_user_id=u.id AND sa.school_id=u.school_id AND sa.attendance_date=CURDATE() WHERE u.school_id=? AND u.role IN ('teacher','headteacher') AND u.is_active=1 AND sa.id IS NULL`,[schoolId])
  for(const row of attendance) created.push(await createInAppNotification({schoolId,recipientUserId:row.id,title:"Staff attendance not recorded",message:`Today's attendance has not been recorded for ${row.full_name}.`,category:"staff",priority:"medium",linkedEntityType:"user",linkedEntityId:row.id,createdBy:actorId,ruleKey:"teacher_attendance_unrecorded",dedupeWindow:window}))
  const promises=await safeRows("SELECT fpp.id,fpp.created_by recipient_user_id,fpp.promised_date FROM fee_payment_promises fpp WHERE fpp.school_id=? AND fpp.status='pending' AND fpp.promised_date<=CURDATE()",[schoolId])
  for(const row of promises) if(row.recipient_user_id) created.push(await createInAppNotification({schoolId,recipientUserId:row.recipient_user_id,title:"Payment promise due",message:`A fee payment promise is due on ${String(row.promised_date).slice(0,10)}.`,category:"finance",priority:"high",linkedEntityType:"fee_payment_promise",linkedEntityId:row.id,createdBy:actorId,ruleKey:"payment_promise_due",dedupeWindow:window}))
  const withdrawals=await safeRows("SELECT sw.id,sw.created_by recipient_user_id,sw.end_date FROM student_withdrawals sw WHERE sw.school_id=? AND sw.status<>'cancelled' AND sw.withdrawal_type='temporary' AND sw.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(),INTERVAL 3 DAY)",[schoolId])
  for(const row of withdrawals) if(row.recipient_user_id) created.push(await createInAppNotification({schoolId,recipientUserId:row.recipient_user_id,title:"Temporary withdrawal ending soon",message:`The temporary withdrawal ends on ${String(row.end_date).slice(0,10)}. Confirm the learner's return arrangements.`,category:"admissions",priority:"high",linkedEntityType:"student_withdrawal",linkedEntityId:row.id,createdBy:actorId,ruleKey:"withdrawal_ending_soon",dedupeWindow:window}))
  const overdueTasks=await safeRows("SELECT id,assigned_to_user_id,title FROM director_tasks WHERE school_id=? AND status IN ('open','in_progress') AND due_date<CURDATE()",[schoolId])
  for(const row of overdueTasks) if(row.assigned_to_user_id) created.push(await createInAppNotification({schoolId,recipientUserId:row.assigned_to_user_id,title:"Follow-up overdue",message:`${row.title} is past its due date.`,category:"operations",priority:"urgent",linkedEntityType:"director_task",linkedEntityId:row.id,createdBy:actorId,ruleKey:"director_task_overdue",dedupeWindow:window}))
  const supportCapabilities=await learnerSupportReminderCapabilities()
  const assignmentRecipient=supportCapabilities.assignments?"COALESCE(case_assignment.assigned_user_id,cycle.owner_user_id,c.owner_user_id)":"COALESCE(cycle.owner_user_id,c.owner_user_id)"
  const assignmentJoin=supportCapabilities.assignments?`LEFT JOIN learner_support_case_assignments case_assignment ON case_assignment.id=(SELECT next_assignment.id FROM learner_support_case_assignments next_assignment WHERE next_assignment.school_id=c.school_id AND next_assignment.case_id=c.id AND next_assignment.assignment_status IN ('assigned','acknowledged') ORDER BY FIELD(next_assignment.assignment_type,'action','support_teacher','owner'),next_assignment.id DESC LIMIT 1)`:""
  const supportSessions=await safeRows(`SELECT sess.id,c.id case_id,${assignmentRecipient} recipient_user_id,sess.scheduled_at,CONCAT(student.first_name,' ',student.last_name) learner_name,subject.name subject_name
    FROM intervention_sessions sess
    JOIN intervention_cycles cycle ON cycle.school_id=sess.school_id AND cycle.id=sess.cycle_id
    JOIN learner_support_cases c ON c.school_id=cycle.school_id AND c.id=cycle.case_id
    ${assignmentJoin}
    LEFT JOIN students student ON student.school_id=c.school_id AND student.id=c.learner_id
    LEFT JOIN subjects subject ON subject.school_id=c.school_id AND subject.id=c.subject_id
    WHERE sess.school_id=? AND sess.status='planned' AND sess.scheduled_at<DATE_ADD(CURRENT_DATE,INTERVAL 8 DAY)`,[schoolId])
  for(const row of supportSessions) if(row.recipient_user_id) {
    const overdue=new Date(row.scheduled_at).getTime()<Date.now()
    created.push(await createInAppNotification({schoolId,recipientUserId:row.recipient_user_id,title:overdue?"Support session overdue":"Support session due",message:`${row.learner_name||"A learner-support group"}${row.subject_name?` in ${row.subject_name}`:""} has support work ${overdue?"past its scheduled time":"due this week"}.`,category:"academics",priority:overdue?"urgent":"high",linkedEntityType:"learner_support_case",linkedEntityId:row.case_id,createdBy:actorId,ruleKey:overdue?"support_session_overdue":"support_session_due",dedupeWindow:`${window}:${row.id}`}))
  }
  const reassessmentDueAt=supportCapabilities.reassessmentDueAt?"reassessment.due_at":"c.next_review_at"
  const supportReassessments=await safeRows(`SELECT reassessment.id,c.id case_id,${assignmentRecipient} recipient_user_id,${reassessmentDueAt} due_at,CONCAT(student.first_name,' ',student.last_name) learner_name,subject.name subject_name
    FROM academic_intervention_reassessments reassessment
    JOIN learner_support_cases c ON c.school_id=reassessment.school_id AND c.id=reassessment.support_case_id
    LEFT JOIN intervention_cycles cycle ON cycle.school_id=reassessment.school_id AND cycle.id=reassessment.intervention_cycle_id
    ${assignmentJoin}
    LEFT JOIN students student ON student.school_id=c.school_id AND student.id=c.learner_id
    LEFT JOIN subjects subject ON subject.school_id=c.school_id AND subject.id=c.subject_id
    WHERE reassessment.school_id=? AND reassessment.outcome='pending' AND ${reassessmentDueAt} IS NOT NULL AND ${reassessmentDueAt}<DATE_ADD(CURRENT_DATE,INTERVAL 8 DAY)`,[schoolId])
  for(const row of supportReassessments) if(row.recipient_user_id) created.push(await createInAppNotification({schoolId,recipientUserId:row.recipient_user_id,title:"Learner-support reassessment due",message:`A reassessment is due for ${row.learner_name||"a learner-support group"}${row.subject_name?` in ${row.subject_name}`:""}.`,category:"academics",priority:new Date(row.due_at).getTime()<Date.now()?"urgent":"high",linkedEntityType:"learner_support_case",linkedEntityId:row.case_id,createdBy:actorId,ruleKey:"support_reassessment_due",dedupeWindow:`${window}:${row.id}`}))
  return {checked_at:new Date().toISOString(),created:created.filter(item=>!item?.duplicate).length,duplicates_skipped:created.filter(item=>item?.duplicate).length,detected:{overdue_marks:overdueMarks.length,unrecorded_attendance:attendance.length,payment_promises:promises.length,withdrawals:withdrawals.length,overdue_tasks:overdueTasks.length,support_sessions_due:supportSessions.length,support_reassessments_due:supportReassessments.length}}
}
