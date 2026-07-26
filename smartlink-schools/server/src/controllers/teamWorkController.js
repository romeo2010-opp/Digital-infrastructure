import { pool } from "../config/db.js"
import { safeTeamRequestMetadata } from "../middleware/teamAuth.js"
import {
  TEAM_PERMISSIONS,
  assertTeamSchoolAccess,
  hasTeamPermission,
  resolveTeamSchool,
} from "../services/teamAccessService.js"
import {
  createTeamNotification,
  enumValue,
  nullableDate,
  optionalText,
  paginationFrom,
  paginationMeta,
  requiredText,
  safeLike,
  writeTeamAudit,
} from "../services/teamSuiteService.js"
import { HttpError } from "../utils/http.js"

const TASK_STATUSES=["not_started","in_progress","waiting_on_school","blocked","completed","cancelled"]
const PRIORITIES=["low","medium","high","critical"]
const MEETING_TYPES=["discovery","introductory","product_demo","technical","pricing","contract","onboarding","training","support_review"]
const MEETING_OUTCOMES=["pending","strong_interest","moderate_interest","needs_another_meeting","proposal_requested","price_objection","feature_objection","existing_contract","decision_pending","not_interested","completed","cancelled"]
const TICKET_SEVERITIES=["critical","high","medium","low"]
const TICKET_STATUSES=["new","investigating","waiting_for_school","assigned_to_development","fix_ready","testing","resolved","closed","reopened"]
const TICKET_CATEGORIES=["login_problem","permissions","student_records","fees","results","assessment_builder","report_cards","migration","performance_issue","data_correction","training_request","feature_request","bug","configuration_request","other"]
const DEMO_CHECKLIST=["school_researched","internet_confirmed","laptop_ready","demo_account_tested","sample_data_ready","modules_selected","attendees_confirmed","pricing_prepared","offline_backup_prepared","presenter_assigned"]

function value(body,snake,camel=snake){return body?.[snake]??body?.[camel]}

async function userId(connection,publicRef,label,{required=true}={}){
  const ref=String(publicRef||"").trim()
  if(!ref&&!required)return null
  const [[user]]=await connection.query("SELECT id FROM team_users WHERE public_ref=? AND is_active=1 LIMIT 1",[ref])
  if(!user)throw new HttpError(400,`${label} is invalid`,{code:"TEAM_VALIDATION_ERROR"})
  return Number(user.id)
}

async function schoolFromBody(connection,body,user,{required=false}={}){
  const ref=value(body,"school_ref","schoolRef")
  if(!ref&&!required)return null
  const school=await resolveTeamSchool(connection,requiredText(ref,"School",36))
  await assertTeamSchoolAccess(connection,user,school.id)
  return school
}

export async function listTeamTasks(req,res){
  const pagination=paginationFrom(req.query)
  const clauses=["task.archived_at IS NULL"]
  const params=[]
  if(!hasTeamPermission(req.teamUser,TEAM_PERMISSIONS.SCHOOLS_VIEW_ALL)){clauses.push("(task.assigned_user_id=? OR task.created_by=?)");params.push(req.teamUser.id,req.teamUser.id)}
  if(String(req.query.assigned_to_me||"")==="true"){clauses.push("task.assigned_user_id=?");params.push(req.teamUser.id)}
  if(String(req.query.overdue||"")==="true"){clauses.push("task.due_at<CURRENT_TIMESTAMP AND task.status NOT IN ('completed','cancelled')")}
  if(String(req.query.due_today||"")==="true"){clauses.push("DATE(task.due_at)=CURRENT_DATE AND task.status NOT IN ('completed','cancelled')")}
  if(req.query.status){clauses.push("task.status=?");params.push(enumValue(req.query.status,TASK_STATUSES,"Task status"))}
  if(req.query.priority){clauses.push("task.priority=?");params.push(enumValue(req.query.priority,PRIORITIES,"Task priority"))}
  const search=safeLike(req.query.search||req.query.q)
  if(search){clauses.push("(task.title LIKE ? ESCAPE '\\\\' OR school.name LIKE ? ESCAPE '\\\\')");params.push(`%${search}%`,`%${search}%`)}
  const where=clauses.join(" AND ")
  const [[count],[rows]]=await Promise.all([
    pool.query(`SELECT COUNT(*) total FROM team_tasks task LEFT JOIN team_school_prospects school ON school.id=task.school_id WHERE ${where}`,params),
    pool.query(`SELECT task.public_ref,task.title,task.description,task.due_at,task.priority,task.category,task.status,task.reminder_at,task.outcome,task.completed_at,task.created_at,task.updated_at,CASE WHEN task.due_at<CURRENT_TIMESTAMP AND task.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END is_overdue,school.public_ref school_ref,school.name school_name,assignee.public_ref assigned_user_ref,assignee.full_name assigned_user_name,creator.full_name created_by_name FROM team_tasks task LEFT JOIN team_school_prospects school ON school.id=task.school_id JOIN team_users assignee ON assignee.id=task.assigned_user_id JOIN team_users creator ON creator.id=task.created_by WHERE ${where} ORDER BY (task.status NOT IN ('completed','cancelled')) DESC,CASE WHEN task.due_at<CURRENT_TIMESTAMP THEN 0 ELSE 1 END,task.due_at LIMIT ? OFFSET ?`,[...params,pagination.pageSize,pagination.offset]),
  ])
  res.json({items:rows,pagination:paginationMeta(count.total,pagination)})
}

export async function createTeamTask(req,res){
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const school=await schoolFromBody(connection,req.body,req.teamUser)
    const assigneeId=value(req.body,"assigned_user_ref","assignedUserRef")?await userId(connection,value(req.body,"assigned_user_ref","assignedUserRef"),"Assigned user"):req.teamUser.id
    let contactId=null,opportunityId=null
    if(value(req.body,"contact_ref","contactRef")){
      if(!school)throw new HttpError(400,"A school is required when linking a contact")
      const [[contact]]=await connection.query("SELECT id FROM team_school_contacts WHERE public_ref=? AND school_id=? LIMIT 1",[value(req.body,"contact_ref","contactRef"),school.id]);if(!contact)throw new HttpError(400,"Contact does not belong to this school");contactId=contact.id
    }
    if(value(req.body,"opportunity_ref","opportunityRef")){
      if(!school)throw new HttpError(400,"A school is required when linking an opportunity")
      const [[opportunity]]=await connection.query("SELECT id FROM team_sales_opportunities WHERE public_ref=? AND school_id=? AND archived_at IS NULL LIMIT 1",[value(req.body,"opportunity_ref","opportunityRef"),school.id]);if(!opportunity)throw new HttpError(400,"Opportunity does not belong to this school");opportunityId=opportunity.id
    }
    const dueAt=nullableDate(value(req.body,"due_at","dueAt"),"Due date");if(!dueAt)throw new HttpError(400,"Due date is required")
    const [result]=await connection.query(`INSERT INTO team_tasks (public_ref,title,description,school_id,contact_id,opportunity_id,assigned_user_id,created_by,due_at,priority,category,status,reminder_at) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?)`,[requiredText(value(req.body,"title"),"Task title",240),optionalText(value(req.body,"description"),10000),school?.id||null,contactId,opportunityId,assigneeId,req.teamUser.id,dueAt,enumValue(value(req.body,"priority"),PRIORITIES,"Priority","medium"),optionalText(value(req.body,"category"),80)||"other",enumValue(value(req.body,"status"),TASK_STATUSES,"Task status","not_started"),nullableDate(value(req.body,"reminder_at","reminderAt"),"Reminder date")])
    const [[task]]=await connection.query("SELECT * FROM team_tasks WHERE id=?",[result.insertId])
    await writeTeamAudit(connection,{actorUserId:req.teamUser.id,action:"TASK_CREATED",entityType:"task",entityId:task.id,entityRef:task.public_ref,schoolId:school?.id||null,afterValue:task,...safeTeamRequestMetadata(req)})
    if(assigneeId!==req.teamUser.id)await createTeamNotification(connection,{recipientUserId:assigneeId,type:"task_assigned",title:"New task assigned",message:task.title,entityType:"task",entityRef:task.public_ref,actionPath:`/team/tasks?task=${task.public_ref}`})
    await connection.commit();res.status(201).json({task})
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function updateTeamTask(req,res){
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const [[task]]=await connection.query("SELECT * FROM team_tasks WHERE public_ref=? AND archived_at IS NULL FOR UPDATE",[req.params.taskRef])
    if(!task)throw new HttpError(404,"Task was not found")
    if(!hasTeamPermission(req.teamUser,TEAM_PERMISSIONS.SCHOOLS_VIEW_ALL)&&task.assigned_user_id!==req.teamUser.id&&task.created_by!==req.teamUser.id)throw new HttpError(404,"Task was not found")
    const status=value(req.body,"status")===undefined?task.status:enumValue(value(req.body,"status"),TASK_STATUSES,"Task status")
    const completionNote=value(req.body,"completion_note","completionNote")===undefined?task.completion_note:optionalText(value(req.body,"completion_note","completionNote"),10000)
    if(status==="completed"&&!completionNote)throw new HttpError(400,"A completion note is required when completing a task")
    const assigneeId=value(req.body,"assigned_user_ref","assignedUserRef")===undefined?task.assigned_user_id:await userId(connection,value(req.body,"assigned_user_ref","assignedUserRef"),"Assigned user")
    const dueAt=value(req.body,"due_at","dueAt")===undefined?task.due_at:nullableDate(value(req.body,"due_at","dueAt"),"Due date")
    await connection.query(`UPDATE team_tasks SET status=?,completion_note=?,outcome=?,assigned_user_id=?,due_at=?,priority=?,reminder_at=?,completed_at=CASE WHEN ?='completed' THEN COALESCE(completed_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE id=?`,[status,completionNote,value(req.body,"outcome")===undefined?task.outcome:optionalText(value(req.body,"outcome"),500),assigneeId,dueAt,value(req.body,"priority")===undefined?task.priority:enumValue(value(req.body,"priority"),PRIORITIES,"Priority"),value(req.body,"reminder_at","reminderAt")===undefined?task.reminder_at:nullableDate(value(req.body,"reminder_at","reminderAt"),"Reminder date"),status,task.id])
    const [[updated]]=await connection.query("SELECT * FROM team_tasks WHERE id=?",[task.id])
    await writeTeamAudit(connection,{actorUserId:req.teamUser.id,action:status==="completed"?"TASK_COMPLETED":"TASK_UPDATED",entityType:"task",entityId:task.id,entityRef:task.public_ref,schoolId:task.school_id,beforeValue:task,afterValue:updated,...safeTeamRequestMetadata(req)})
    if(status==="completed"&&task.school_id)await connection.query(`INSERT INTO team_school_activities (public_ref,school_id,contact_id,opportunity_id,activity_type,occurred_at,team_user_id,summary,notes) VALUES (UUID(),?,?,?,'task_completed',CURRENT_TIMESTAMP,?,?,?)`,[task.school_id,task.contact_id,task.opportunity_id,req.teamUser.id,task.title,completionNote])
    if(assigneeId!==task.assigned_user_id&&assigneeId!==req.teamUser.id)await createTeamNotification(connection,{recipientUserId:assigneeId,type:"task_assigned",title:"Task assigned to you",message:task.title,entityType:"task",entityRef:task.public_ref,actionPath:`/team/tasks?task=${task.public_ref}`})
    await connection.commit();res.json({task:updated,next_action_prompt:status==="completed"&&!value(req.body,"follow_up_task_ref","followUpTaskRef")})
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function listTeamMeetings(req,res){
  const pagination=paginationFrom(req.query)
  const clauses=[];const params=[]
  if(!hasTeamPermission(req.teamUser,TEAM_PERMISSIONS.SCHOOLS_VIEW_ALL)){clauses.push("(meeting.organised_by=? OR EXISTS (SELECT 1 FROM team_meeting_participants participant WHERE participant.meeting_id=meeting.id AND participant.team_user_id=?))");params.push(req.teamUser.id,req.teamUser.id)}
  if(String(req.query.upcoming||"")==="true")clauses.push("meeting.scheduled_at>=CURRENT_TIMESTAMP AND meeting.outcome='pending'")
  if(req.query.type){clauses.push("meeting.meeting_type=?");params.push(enumValue(req.query.type,MEETING_TYPES,"Meeting type"))}
  const where=clauses.length?clauses.join(" AND "):"1=1"
  const [[count],[rows]]=await Promise.all([
    pool.query(`SELECT COUNT(*) total FROM team_meetings meeting WHERE ${where}`,params),
    pool.query(`SELECT meeting.*,school.public_ref school_ref,school.name school_name,opportunity.public_ref opportunity_ref,opportunity.title opportunity_title,organiser.public_ref organiser_ref,organiser.full_name organiser_name FROM team_meetings meeting JOIN team_school_prospects school ON school.id=meeting.school_id LEFT JOIN team_sales_opportunities opportunity ON opportunity.id=meeting.opportunity_id JOIN team_users organiser ON organiser.id=meeting.organised_by WHERE ${where} ORDER BY (meeting.scheduled_at>=CURRENT_TIMESTAMP AND meeting.outcome='pending') DESC,meeting.scheduled_at ASC LIMIT ? OFFSET ?`,[...params,pagination.pageSize,pagination.offset]),
  ])
  res.json({items:rows,pagination:paginationMeta(count.total,pagination)})
}

export async function createTeamMeeting(req,res){
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const school=await schoolFromBody(connection,req.body,req.teamUser,{required:true})
    let opportunityId=null
    if(value(req.body,"opportunity_ref","opportunityRef")){const [[opportunity]]=await connection.query("SELECT id FROM team_sales_opportunities WHERE public_ref=? AND school_id=? AND archived_at IS NULL LIMIT 1",[value(req.body,"opportunity_ref","opportunityRef"),school.id]);if(!opportunity)throw new HttpError(400,"Opportunity does not belong to this school");opportunityId=opportunity.id}
    const scheduledAt=nullableDate(value(req.body,"scheduled_at","scheduledAt"),"Meeting date");if(!scheduledAt)throw new HttpError(400,"Meeting date is required")
    const meetingType=enumValue(value(req.body,"meeting_type","meetingType"),MEETING_TYPES,"Meeting type")
    const [result]=await connection.query(`INSERT INTO team_meetings (public_ref,school_id,opportunity_id,meeting_type,scheduled_at,location,attendance_mode,agenda,organised_by) VALUES (UUID(),?,?,?,?,?,?,?,?)`,[school.id,opportunityId,meetingType,scheduledAt,optionalText(value(req.body,"location"),500),enumValue(value(req.body,"attendance_mode","attendanceMode"),["remote","physical"],"Attendance mode","physical"),optionalText(value(req.body,"agenda"),10000),req.teamUser.id])
    const participants=Array.isArray(req.body?.team_participant_refs)?req.body.team_participant_refs:[]
    for(const ref of new Set([req.teamUser.publicRef,...participants])){const participantId=await userId(connection,ref,"Team participant");await connection.query("INSERT IGNORE INTO team_meeting_participants (meeting_id,participant_type,team_user_id,school_contact_id,attendance_status) VALUES (?,'team_user',?,NULL,'invited')",[result.insertId,participantId]);if(participantId!==req.teamUser.id)await createTeamNotification(connection,{recipientUserId:participantId,type:"meeting_scheduled",title:"Meeting scheduled",message:`${meetingType.replaceAll("_"," ")} with ${school.name}`,entityType:"meeting",actionPath:"/team/meetings"})}
    const contacts=Array.isArray(req.body?.school_contact_refs)?req.body.school_contact_refs:[]
    for(const ref of new Set(contacts)){const [[contact]]=await connection.query("SELECT id FROM team_school_contacts WHERE public_ref=? AND school_id=? LIMIT 1",[ref,school.id]);if(!contact)throw new HttpError(400,"A meeting contact does not belong to this school");await connection.query("INSERT IGNORE INTO team_meeting_participants (meeting_id,participant_type,team_user_id,school_contact_id,attendance_status) VALUES (?,'school_contact',NULL,?,'invited')",[result.insertId,contact.id])}
    if(meetingType==="product_demo")for(const code of DEMO_CHECKLIST)await connection.query("INSERT INTO team_demo_checklist_items (meeting_id,item_code) VALUES (?,?)",[result.insertId,code])
    const [[meeting]]=await connection.query("SELECT * FROM team_meetings WHERE id=?",[result.insertId])
    await writeTeamAudit(connection,{actorUserId:req.teamUser.id,action:"MEETING_CREATED",entityType:"meeting",entityId:meeting.id,entityRef:meeting.public_ref,schoolId:school.id,afterValue:meeting,...safeTeamRequestMetadata(req)})
    await connection.commit();res.status(201).json({meeting})
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function updateTeamMeeting(req,res){
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const [[meeting]]=await connection.query("SELECT * FROM team_meetings WHERE public_ref=? FOR UPDATE",[req.params.meetingRef]);if(!meeting)throw new HttpError(404,"Meeting was not found")
    await assertTeamSchoolAccess(connection,req.teamUser,meeting.school_id)
    const outcome=value(req.body,"outcome")===undefined?meeting.outcome:enumValue(value(req.body,"outcome"),MEETING_OUTCOMES,"Meeting outcome")
    await connection.query(`UPDATE team_meetings SET outcome=?,pain_points=?,current_system=?,budget_signals=?,objections=?,requested_features=?,decision_process=?,next_action=?,notes=? WHERE id=?`,[outcome,value(req.body,"pain_points","painPoints")===undefined?meeting.pain_points:optionalText(value(req.body,"pain_points","painPoints"),10000),value(req.body,"current_system","currentSystem")===undefined?meeting.current_system:optionalText(value(req.body,"current_system","currentSystem"),500),value(req.body,"budget_signals","budgetSignals")===undefined?meeting.budget_signals:optionalText(value(req.body,"budget_signals","budgetSignals"),10000),value(req.body,"objections")===undefined?meeting.objections:optionalText(value(req.body,"objections"),10000),value(req.body,"requested_features","requestedFeatures")===undefined?meeting.requested_features:optionalText(value(req.body,"requested_features","requestedFeatures"),10000),value(req.body,"decision_process","decisionProcess")===undefined?meeting.decision_process:optionalText(value(req.body,"decision_process","decisionProcess"),10000),value(req.body,"next_action","nextAction")===undefined?meeting.next_action:optionalText(value(req.body,"next_action","nextAction"),500),value(req.body,"notes")===undefined?meeting.notes:optionalText(value(req.body,"notes"),10000),meeting.id])
    if(Array.isArray(req.body?.demo_checklist))for(const item of req.body.demo_checklist){const code=enumValue(item.code,DEMO_CHECKLIST,"Demo checklist item");await connection.query("UPDATE team_demo_checklist_items SET is_complete=?,completed_by=CASE WHEN ?=1 THEN ? ELSE NULL END,completed_at=CASE WHEN ?=1 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE meeting_id=? AND item_code=?",[item.complete?1:0,item.complete?1:0,req.teamUser.id,item.complete?1:0,meeting.id,code])}
    const [[updated]]=await connection.query("SELECT * FROM team_meetings WHERE id=?",[meeting.id])
    await writeTeamAudit(connection,{actorUserId:req.teamUser.id,action:"MEETING_UPDATED",entityType:"meeting",entityId:meeting.id,entityRef:meeting.public_ref,schoolId:meeting.school_id,beforeValue:meeting,afterValue:updated,...safeTeamRequestMetadata(req)})
    await connection.commit();res.json({meeting:updated,next_action_prompt:outcome!=="pending"&&!updated.next_action})
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function listTeamSupportTickets(req,res){
  const pagination=paginationFrom(req.query)
  const clauses=[];const params=[]
  if(!hasTeamPermission(req.teamUser,TEAM_PERMISSIONS.SUPPORT_VIEW_ALL)){clauses.push("ticket.assigned_user_id=?");params.push(req.teamUser.id)}
  if(req.query.status){clauses.push("ticket.status=?");params.push(enumValue(req.query.status,TICKET_STATUSES,"Ticket status"))}
  if(req.query.severity){clauses.push("ticket.severity=?");params.push(enumValue(req.query.severity,TICKET_SEVERITIES,"Ticket severity"))}
  const search=safeLike(req.query.search||req.query.q);if(search){clauses.push("(ticket.ticket_number LIKE ? ESCAPE '\\\\' OR school.name LIKE ? ESCAPE '\\\\' OR ticket.description LIKE ? ESCAPE '\\\\')");params.push(`%${search}%`,`%${search}%`,`%${search}%`)}
  const where=clauses.length?clauses.join(" AND "):"1=1"
  const [[count],[rows]]=await Promise.all([
    pool.query(`SELECT COUNT(*) total FROM team_support_tickets ticket JOIN team_school_prospects school ON school.id=ticket.school_id WHERE ${where}`,params),
    pool.query(`SELECT ticket.*,school.public_ref school_ref,school.name school_name,assignee.public_ref assigned_user_ref,assignee.full_name assigned_user_name FROM team_support_tickets ticket JOIN team_school_prospects school ON school.id=ticket.school_id JOIN team_users assignee ON assignee.id=ticket.assigned_user_id WHERE ${where} ORDER BY FIELD(ticket.severity,'critical','high','medium','low'),FIELD(ticket.status,'new','reopened','investigating','assigned_to_development','fix_ready','testing','waiting_for_school','resolved','closed'),ticket.updated_at DESC LIMIT ? OFFSET ?`,[...params,pagination.pageSize,pagination.offset]),
  ])
  res.json({items:rows,pagination:paginationMeta(count.total,pagination)})
}

export async function createTeamSupportTicket(req,res){
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const school=await schoolFromBody(connection,req.body,req.teamUser,{required:true})
    const assigneeId=value(req.body,"assigned_user_ref","assignedUserRef")?await userId(connection,value(req.body,"assigned_user_ref","assignedUserRef"),"Assigned user"):req.teamUser.id
    const [[sequence]]=await connection.query("SELECT COUNT(*) total FROM team_support_tickets WHERE YEAR(created_at)=YEAR(CURRENT_DATE) FOR UPDATE")
    const ticketNumber=`SL-${new Date().getFullYear()}-${String(Number(sequence.total)+1).padStart(5,"0")}`
    const [result]=await connection.query(`INSERT INTO team_support_tickets (public_ref,ticket_number,school_id,reporter_name,module_name,category,description,severity,status,assigned_user_id,target_resolution_at,internal_notes,created_by) VALUES (UUID(),?,?,?,?,?,?,?,'new',?,?,?,?)`,[ticketNumber,school.id,requiredText(value(req.body,"reporter_name","reporterName"),"Reporter",180),optionalText(value(req.body,"module_name","moduleName"),160),enumValue(value(req.body,"category"),TICKET_CATEGORIES,"Ticket category"),requiredText(value(req.body,"description"),"Description",20000),enumValue(value(req.body,"severity"),TICKET_SEVERITIES,"Severity","medium"),assigneeId,nullableDate(value(req.body,"target_resolution_at","targetResolutionAt"),"Target resolution date"),optionalText(value(req.body,"internal_notes","internalNotes"),10000),req.teamUser.id])
    const [[ticket]]=await connection.query("SELECT * FROM team_support_tickets WHERE id=?",[result.insertId])
    await createTeamNotification(connection,{recipientUserId:assigneeId,type:ticket.severity==="critical"?"critical_ticket_opened":"support_ticket_assigned",title:ticket.severity==="critical"?"Critical support ticket":"Support ticket assigned",message:`${ticket.ticket_number} · ${school.name}`,entityType:"support_ticket",entityRef:ticket.public_ref,actionPath:"/team/support"})
    await connection.query(`INSERT INTO team_school_activities (public_ref,school_id,activity_type,occurred_at,team_user_id,summary,notes) VALUES (UUID(),?,'support_created',CURRENT_TIMESTAMP,?,?,?)`,[school.id,req.teamUser.id,`${ticket.ticket_number} created`,ticket.description])
    await writeTeamAudit(connection,{actorUserId:req.teamUser.id,action:"SUPPORT_TICKET_CREATED",entityType:"support_ticket",entityId:ticket.id,entityRef:ticket.public_ref,schoolId:school.id,afterValue:ticket,...safeTeamRequestMetadata(req)})
    await connection.commit();res.status(201).json({ticket})
  }catch(error){await connection.rollback();if(error?.code==="ER_DUP_ENTRY")throw new HttpError(409,"Ticket number collision; please retry");throw error}finally{connection.release()}
}

export async function updateTeamSupportTicket(req,res){
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const [[ticket]]=await connection.query("SELECT * FROM team_support_tickets WHERE public_ref=? FOR UPDATE",[req.params.ticketRef]);if(!ticket)throw new HttpError(404,"Support ticket was not found")
    if(!hasTeamPermission(req.teamUser,TEAM_PERMISSIONS.SUPPORT_VIEW_ALL)&&ticket.assigned_user_id!==req.teamUser.id)throw new HttpError(404,"Support ticket was not found")
    const status=value(req.body,"status")===undefined?ticket.status:enumValue(value(req.body,"status"),TICKET_STATUSES,"Ticket status")
    const resolution=value(req.body,"resolution")===undefined?ticket.resolution:optionalText(value(req.body,"resolution"),20000)
    if(["resolved","closed"].includes(status)&&!resolution)throw new HttpError(400,"A resolution is required before resolving or closing a ticket")
    const assigneeId=value(req.body,"assigned_user_ref","assignedUserRef")===undefined?ticket.assigned_user_id:await userId(connection,value(req.body,"assigned_user_ref","assignedUserRef"),"Assigned user")
    await connection.query(`UPDATE team_support_tickets SET status=?,severity=?,assigned_user_id=?,internal_notes=?,resolution=?,root_cause=?,school_confirmation=?,resolved_at=CASE WHEN ? IN ('resolved','closed') THEN COALESCE(resolved_at,CURRENT_TIMESTAMP) ELSE NULL END,closed_at=CASE WHEN ?='closed' THEN COALESCE(closed_at,CURRENT_TIMESTAMP) ELSE NULL END WHERE id=?`,[status,value(req.body,"severity")===undefined?ticket.severity:enumValue(value(req.body,"severity"),TICKET_SEVERITIES,"Severity"),assigneeId,value(req.body,"internal_notes","internalNotes")===undefined?ticket.internal_notes:optionalText(value(req.body,"internal_notes","internalNotes"),10000),resolution,value(req.body,"root_cause","rootCause")===undefined?ticket.root_cause:optionalText(value(req.body,"root_cause","rootCause"),10000),value(req.body,"school_confirmation","schoolConfirmation")===undefined?ticket.school_confirmation:optionalText(value(req.body,"school_confirmation","schoolConfirmation"),500),status,status,ticket.id])
    const [[updated]]=await connection.query("SELECT * FROM team_support_tickets WHERE id=?",[ticket.id])
    await writeTeamAudit(connection,{actorUserId:req.teamUser.id,action:status==="closed"?"SUPPORT_TICKET_CLOSED":"SUPPORT_TICKET_UPDATED",entityType:"support_ticket",entityId:ticket.id,entityRef:ticket.public_ref,schoolId:ticket.school_id,beforeValue:ticket,afterValue:updated,...safeTeamRequestMetadata(req)})
    if(assigneeId!==ticket.assigned_user_id)await createTeamNotification(connection,{recipientUserId:assigneeId,type:"support_ticket_assigned",title:"Support ticket assigned",message:ticket.ticket_number,entityType:"support_ticket",entityRef:ticket.public_ref,actionPath:"/team/support"})
    await connection.commit();res.json({ticket:updated})
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function addTeamTicketComment(req,res){
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction();const [[ticket]]=await connection.query("SELECT * FROM team_support_tickets WHERE public_ref=? LIMIT 1",[req.params.ticketRef]);if(!ticket)throw new HttpError(404,"Support ticket was not found")
    if(!hasTeamPermission(req.teamUser,TEAM_PERMISSIONS.SUPPORT_VIEW_ALL)&&ticket.assigned_user_id!==req.teamUser.id)throw new HttpError(404,"Support ticket was not found")
    const [result]=await connection.query("INSERT INTO team_ticket_comments (public_ref,ticket_id,author_user_id,body,visibility) VALUES (UUID(),?,?,?,?)",[ticket.id,req.teamUser.id,requiredText(req.body?.body,"Comment",20000),enumValue(req.body?.visibility,["internal","school_shareable"],"Comment visibility","internal")]);const [[comment]]=await connection.query("SELECT * FROM team_ticket_comments WHERE id=?",[result.insertId]);await connection.commit();res.status(201).json({comment})
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function listTeamNotifications(req,res){
  const pagination=paginationFrom(req.query,50);const unread=String(req.query.unread_only||"")==="true"
  const [[count],[rows],[unreadCount]]=await Promise.all([
    pool.query(`SELECT COUNT(*) total FROM team_notifications WHERE recipient_user_id=? ${unread?"AND read_at IS NULL":""}`,[req.teamUser.id]),
    pool.query(`SELECT public_ref,notification_type,title,message,entity_type,entity_ref,action_path,read_at,created_at FROM team_notifications WHERE recipient_user_id=? ${unread?"AND read_at IS NULL":""} ORDER BY created_at DESC LIMIT ? OFFSET ?`,[req.teamUser.id,pagination.pageSize,pagination.offset]),
    pool.query("SELECT COUNT(*) total FROM team_notifications WHERE recipient_user_id=? AND read_at IS NULL",[req.teamUser.id]),
  ])
  res.json({items:rows,unread_count:Number(unreadCount.total||0),pagination:paginationMeta(count.total,pagination)})
}

export async function readTeamNotification(req,res){
  const [result]=await pool.query("UPDATE team_notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE public_ref=? AND recipient_user_id=?",[req.params.notificationRef,req.teamUser.id]);if(!result.affectedRows)throw new HttpError(404,"Notification was not found");res.json({ok:true})
}

export async function readAllTeamNotifications(req,res){await pool.query("UPDATE team_notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE recipient_user_id=?",[req.teamUser.id]);res.json({ok:true})}
