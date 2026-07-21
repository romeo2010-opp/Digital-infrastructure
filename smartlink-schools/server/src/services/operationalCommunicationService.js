import crypto from "crypto"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { broadcastUserEvent } from "../realtime/websocketServer.js"
import { createDirectorTask } from "./directorOperationsService.js"

const notificationCategories = new Set(["finance","academics","library","staff","admissions","operations","system"])
const priorities = new Set(["low","medium","high","urgent"])
const encryptionKey = () => crypto.createHash("sha256").update(String(process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET || "smartlink-local-settings-key")).digest()
function encrypt(value) { if (!value) return null; const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv("aes-256-gcm",encryptionKey(),iv); const data=Buffer.concat([cipher.update(String(value),"utf8"),cipher.final()]); return [iv.toString("base64"),cipher.getAuthTag().toString("base64"),data.toString("base64")].join(".") }
function decrypt(value) { if (!value) return null; const [iv,tag,data]=String(value).split("."); const decipher=crypto.createDecipheriv("aes-256-gcm",encryptionKey(),Buffer.from(iv,"base64")); decipher.setAuthTag(Buffer.from(tag,"base64")); return Buffer.concat([decipher.update(Buffer.from(data,"base64")),decipher.final()]).toString("utf8") }

async function safeAudit(schoolId,actorId,action,entityType,entityId,afterValue) { try { await pool.query("INSERT INTO audit_logs (school_id,actor_user_id,action,entity_type,entity_id,after_value) VALUES (?,?,?,?,?,?)",[schoolId,actorId,action,entityType,entityId||null,JSON.stringify(afterValue||{})]) } catch (error) { if (!["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error } }

export async function createInAppNotification({ schoolId,recipientUserId,title,message,category="system",priority="medium",linkedEntityType=null,linkedEntityId=null,createdBy=null,ruleKey=null,dedupeWindow=null }) {
  const [result] = await pool.query(`INSERT IGNORE INTO notifications (public_ref,school_id,recipient_user_id,title,message,category,priority,channel,status,linked_entity_type,linked_entity_id,created_by,sent_at,rule_key,dedupe_window) VALUES (UUID(),?,?,?,?,?,?,'in_app','sent',?,?,?,CURRENT_TIMESTAMP,?,?)`,[schoolId,recipientUserId,title,message,notificationCategories.has(category)?category:"system",priorities.has(priority)?priority:"medium",linkedEntityType,linkedEntityId,createdBy,ruleKey,dedupeWindow])
  if (!result.insertId) return { duplicate:true }
  const [[item]]=await pool.query("SELECT public_ref AS publicId,title,message,category AS type,priority,created_at AS createdAt FROM notifications WHERE id=?",[result.insertId])
  if (recipientUserId) broadcastUserEvent({schoolId,userId:recipientUserId,type:"smartlink_notification",data:{...item,linkedEntityType,linkedEntityId}})
  return item
}

export async function broadcastSchoolNotification({ schoolId,roles=[],userIds=[],excludeUserId=null,title,message,category="system",priority="medium",linkedEntityType=null,linkedEntityId=null,createdBy=null }) {
  const roleList = [...new Set(roles.map((role)=>String(role||"").toLowerCase()).filter(Boolean))]
  const explicitIds = [...new Set(userIds.map(Number).filter(Boolean))]
  let recipients = explicitIds
  if (roleList.length) {
    const [rows] = await pool.query(
      `SELECT id FROM users WHERE school_id=? AND is_active=1 AND role IN (${roleList.map(()=>"?").join(",")})`,
      [schoolId,...roleList],
    )
    recipients = [...new Set([...recipients,...rows.map((row)=>Number(row.id))])]
  }
  if (excludeUserId) recipients = recipients.filter((id)=>Number(id)!==Number(excludeUserId))
  const notifications = []
  for (const recipientUserId of recipients) {
    notifications.push(await createInAppNotification({schoolId,recipientUserId,title,message,category,priority,linkedEntityType,linkedEntityId,createdBy}))
  }
  return notifications
}

export async function isWhatsAppConfigured(schoolId) { const [[row]]=await pool.query("SELECT is_enabled,phone_number_id,access_token_encrypted,display_phone_number FROM school_whatsapp_settings WHERE school_id=?",[schoolId]); return { configured:Boolean(row?.is_enabled&&row?.phone_number_id&&row?.access_token_encrypted),display_phone_number:row?.display_phone_number||null } }
export async function queueWhatsAppMessage({schoolId,recipientType,recipientUserId=null,recipientName,recipientPhone,templateKey,messageBody,linkedEntityType,linkedEntityId,createdBy}) {
  const configuration=await isWhatsAppConfigured(schoolId)
  const status=configuration.configured&&recipientPhone?"queued":"skipped"
  const reason=!configuration.configured?"WhatsApp is not configured for this school.":!recipientPhone?"Recipient phone number is missing.":null
  const [result]=await pool.query(`INSERT INTO message_outbox (public_ref,school_id,recipient_type,recipient_user_id,recipient_name,recipient_phone,channel,template_key,message_body,status,linked_entity_type,linked_entity_id,error_message,created_by) VALUES (UUID(),?,?,?,?,?,'whatsapp',?,?,?,?,?,?,?)`,[schoolId,recipientType,recipientUserId,recipientName||null,recipientPhone||null,templateKey||null,messageBody,status,linkedEntityType||null,linkedEntityId||null,reason,createdBy||null])
  await safeAudit(schoolId,createdBy,status==="queued"?"WHATSAPP_QUEUED":"WHATSAPP_SKIPPED","message_outbox",result.insertId,{reason,templateKey})
  return {status,reason,configured:configuration.configured}
}

export async function sendWhatsAppMessage(schoolId,outboxPublicRef) {
  const [[settings]]=await pool.query("SELECT phone_number_id,access_token_encrypted,is_enabled FROM school_whatsapp_settings WHERE school_id=?",[schoolId])
  const [[message]]=await pool.query("SELECT * FROM message_outbox WHERE school_id=? AND public_ref=? AND channel='whatsapp' LIMIT 1",[schoolId,outboxPublicRef])
  if(!message) throw new HttpError(404,"WhatsApp outbox message was not found.")
  if(!settings?.is_enabled||!settings.phone_number_id||!settings.access_token_encrypted||!message.recipient_phone){await pool.query("UPDATE message_outbox SET status='skipped',error_message=? WHERE id=?",["WhatsApp configuration or recipient phone is missing.",message.id]);return {status:"skipped"}}
  try { const response=await fetch(`https://graph.facebook.com/v22.0/${encodeURIComponent(settings.phone_number_id)}/messages`,{method:"POST",headers:{Authorization:`Bearer ${decrypt(settings.access_token_encrypted)}`,"Content-Type":"application/json"},body:JSON.stringify({messaging_product:"whatsapp",to:String(message.recipient_phone).replace(/\D/g,""),type:"text",text:{body:message.message_body}})}); const payload=await response.json(); if(!response.ok) throw new Error(payload?.error?.message||"WhatsApp provider rejected the message."); const providerId=payload?.messages?.[0]?.id||null; await pool.query("UPDATE message_outbox SET status='sent',provider_message_id=?,sent_at=CURRENT_TIMESTAMP,error_message=NULL WHERE id=?",[providerId,message.id]); return {status:"sent",provider_message_id:providerId} } catch(error) { await pool.query("UPDATE message_outbox SET status='failed',error_message=? WHERE id=?",[String(error?.message||error).slice(0,255),message.id]); return {status:"failed",error:String(error?.message||error)} }
}
export async function sendTemplateMessage(schoolId,outboxPublicRef) { return sendWhatsAppMessage(schoolId,outboxPublicRef) }
export async function handleWhatsAppWebhook(payload={}) { return {accepted:true,statuses:Array.isArray(payload?.entry)?payload.entry.length:0} }

export async function saveWhatsAppSettings(schoolId,actorId,body={}) {
  const current=(await pool.query("SELECT * FROM school_whatsapp_settings WHERE school_id=?",[schoolId]))[0][0]||{}
  const token=body.access_token?encrypt(body.access_token):current.access_token_encrypted||null
  await pool.query(`INSERT INTO school_whatsapp_settings (school_id,provider,business_account_id,phone_number_id,display_phone_number,access_token_encrypted,webhook_verify_token,is_enabled,configured_by) VALUES (?,'meta_cloud_api',?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE business_account_id=VALUES(business_account_id),phone_number_id=VALUES(phone_number_id),display_phone_number=VALUES(display_phone_number),access_token_encrypted=VALUES(access_token_encrypted),webhook_verify_token=VALUES(webhook_verify_token),is_enabled=VALUES(is_enabled),configured_by=VALUES(configured_by)`,[schoolId,body.business_account_id||null,body.phone_number_id||null,body.display_phone_number||null,token,body.webhook_verify_token||current.webhook_verify_token||null,body.is_enabled?1:0,actorId])
  return getWhatsAppSettings(schoolId)
}
export async function getWhatsAppSettings(schoolId) { const [[row]]=await pool.query("SELECT provider,business_account_id,phone_number_id,display_phone_number,is_enabled,access_token_encrypted IS NOT NULL has_access_token,webhook_verify_token IS NOT NULL has_webhook_token FROM school_whatsapp_settings WHERE school_id=?",[schoolId]); const [templates]=await pool.query("SELECT template_key,provider_template_name,category,language_code,body_preview,is_approved FROM message_templates WHERE school_id=? ORDER BY category,template_key",[schoolId]); return {settings:row||{provider:"meta_cloud_api",is_enabled:0,has_access_token:0},templates} }

export async function sendOperationalReminder(schoolId,actorId,body={}) {
  const [[recipient]]=await pool.query("SELECT id,public_ref,full_name,phone FROM users WHERE school_id=? AND public_ref=? AND is_active=1 LIMIT 1",[schoolId,body.recipient_user_ref])
  if (!recipient) throw new HttpError(400,"Recipient was not found in this school.")
  const message=String(body.message||"").trim(); if(!message) throw new HttpError(400,"Reminder message is required.")
  const category=notificationCategories.has(body.category)?body.category:"system"; const priority=priorities.has(body.priority)?body.priority:"medium"
  const notification=await createInAppNotification({schoolId,recipientUserId:recipient.id,title:body.title||"Operational reminder",message,category,priority,linkedEntityType:body.linked_entity_type||null,linkedEntityId:body.linked_entity_id||null,createdBy:actorId})
  let whatsapp=null; if(body.channel==="whatsapp") whatsapp=await queueWhatsAppMessage({schoolId,recipientType:"staff",recipientUserId:recipient.id,recipientName:recipient.full_name,recipientPhone:recipient.phone,templateKey:body.template_key,messageBody:message,linkedEntityType:body.linked_entity_type,linkedEntityId:body.linked_entity_id,createdBy:actorId})
  let task=null; if(body.create_follow_up) task=await createDirectorTask(schoolId,actorId,{title:body.task_title||body.title||"Reminder follow-up",description:message,category:category==="system"?"general":category,priority,assigned_to_user_id:recipient.id,due_date:body.due_date||null,linked_entity_type:body.linked_entity_type,linked_entity_id:body.linked_entity_id,context_snapshot:body.context_snapshot})
  await safeAudit(schoolId,actorId,"REMINDER_CREATED",body.linked_entity_type||"notification",body.linked_entity_id,{recipient:recipient.public_ref,channel:body.channel||"in_app"})
  return {notification,whatsapp,task,message:whatsapp?.reason||"In-app reminder sent."}
}

export async function escalateToHeadteacher(schoolId,actorId,body={}) {
  const [[headteacher]]=await pool.query("SELECT id,public_ref,full_name FROM users WHERE school_id=? AND role='headteacher' AND is_active=1 ORDER BY id LIMIT 1",[schoolId])
  if(!headteacher) throw new HttpError(400,"No Headteacher account is configured for this school.")
  const title=String(body.title||"Operational escalation").trim(); const message=String(body.message||body.reason||"").trim(); if(!message) throw new HttpError(400,"Escalation reason is required.")
  const task=await createDirectorTask(schoolId,actorId,{title,description:message,category:body.category||"academics",priority:body.priority||"high",assigned_to_user_id:headteacher.id,due_date:body.due_date||null,linked_entity_type:body.linked_entity_type,linked_entity_id:body.linked_entity_id,context_snapshot:body.context_snapshot})
  await createInAppNotification({schoolId,recipientUserId:headteacher.id,title,message,category:body.category||"academics",priority:body.priority||"high",linkedEntityType:"director_task",linkedEntityId:null,createdBy:actorId})
  await safeAudit(schoolId,actorId,"ESCALATION_CREATED",body.linked_entity_type||"director_task",body.linked_entity_id,{headteacher:headteacher.public_ref,task:task.id})
  return {task,headteacher:{public_ref:headteacher.public_ref,full_name:headteacher.full_name}}
}

export async function getStaffAttendanceToday(schoolId,date=new Date().toISOString().slice(0,10)) {
  const [[settings],[rows]] = await Promise.all([
    pool.query("SELECT expected_arrival_time,late_after_minutes,require_daily_staff_attendance,allow_teacher_self_check_in FROM staff_attendance_settings WHERE school_id=?",[schoolId]),
    pool.query(`SELECT u.public_ref AS staff_ref,u.full_name,u.role,u.phone,
      COALESCE(sa.status,CASE WHEN lr.id IS NOT NULL THEN 'on_leave' ELSE 'unrecorded' END) status,
      sa.public_ref AS attendance_ref,sa.check_in_time,sa.check_out_time,sa.source,sa.notes,rec.full_name recorded_by_name,
      lr.public_ref leave_ref,lr.leave_type,lr.end_date leave_end_date
      FROM users u
      LEFT JOIN staff_attendance sa ON sa.staff_user_id=u.id AND sa.school_id=u.school_id AND sa.attendance_date=?
      LEFT JOIN staff_leave_requests lr ON lr.staff_user_id=u.id AND lr.school_id=u.school_id AND lr.status='approved' AND ? BETWEEN lr.start_date AND lr.end_date
      LEFT JOIN users rec ON rec.id=sa.recorded_by
      WHERE u.school_id=? AND u.role IN ('teacher','headteacher') AND u.is_active=1 ORDER BY u.full_name`,[date,date,schoolId]),
  ])
  const counts=Object.fromEntries(["present","absent","late","excused","on_leave","unrecorded"].map(status=>[status,rows.filter(row=>row.status===status).length]))
  return {date,settings:settings[0]||null,rows,summary:{...counts,total:rows.length,attendance_rate:rows.length?Number((((counts.present+counts.late)/rows.length)*100).toFixed(1)):0}}
}
export async function recordStaffAttendance(schoolId,actor,body={}) {
  const [[staff]]=await pool.query("SELECT id FROM users WHERE school_id=? AND public_ref=? AND role IN ('teacher','headteacher') LIMIT 1",[schoolId,body.staff_user_ref]); if(!staff) throw new HttpError(400,"Staff member was not found.")
  const status=["present","absent","late","excused","on_leave"].includes(body.status)?body.status:"present"; const date=body.attendance_date||new Date().toISOString().slice(0,10)
  const [[leave]]=await pool.query("SELECT public_ref FROM staff_leave_requests WHERE school_id=? AND staff_user_id=? AND status='approved' AND ? BETWEEN start_date AND end_date LIMIT 1",[schoolId,staff.id,date])
  if(leave && status==='absent') throw new HttpError(409,"This staff member is on approved leave for this date.")
  await pool.query(`INSERT INTO staff_attendance (public_ref,school_id,staff_user_id,attendance_date,status,check_in_time,check_out_time,source,recorded_by,notes) VALUES (UUID(),?,?,?,?,?,?,?, ?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),check_in_time=VALUES(check_in_time),check_out_time=VALUES(check_out_time),source=VALUES(source),recorded_by=VALUES(recorded_by),notes=VALUES(notes)`,[schoolId,staff.id,date,status,body.check_in_time||null,body.check_out_time||null,"manual",actor.id,body.notes||null])
  await safeAudit(schoolId,actor.id,"STAFF_ATTENDANCE_RECORDED","user",staff.id,{date,status})
  return getStaffAttendanceToday(schoolId,date)
}
export async function selfCheckIn(schoolId,actor) {
  const [[settings]]=await pool.query("SELECT * FROM staff_attendance_settings WHERE school_id=?",[schoolId]); if(!settings?.allow_teacher_self_check_in) throw new HttpError(403,"Teacher self check-in is not enabled for this school.")
  const now=new Date(); const time=now.toTimeString().slice(0,8); const threshold=new Date(`1970-01-01T${settings.expected_arrival_time}Z`).getTime()+Number(settings.late_after_minutes||0)*60000; const current=new Date(`1970-01-01T${time}Z`).getTime(); const status=current>threshold?"late":"present"
  await pool.query(`INSERT INTO staff_attendance (public_ref,school_id,staff_user_id,attendance_date,status,check_in_time,source,recorded_by) VALUES (UUID(),?,?,CURDATE(),?,?,'self_check_in',?) ON DUPLICATE KEY UPDATE status=VALUES(status),check_in_time=VALUES(check_in_time),source='self_check_in',recorded_by=VALUES(recorded_by)`,[schoolId,actor.id,status,time,actor.id])
  return {status,check_in_time:time}
}

export async function createPaymentPromise(schoolId,actorId,body={}) {
  const [[student]]=await pool.query("SELECT id FROM students WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,body.student_ref]); if(!student) throw new HttpError(400,"Student was not found.")
  const amount=Number(body.promised_amount); if(!(amount>0)||!/^\d{4}-\d{2}-\d{2}$/.test(String(body.promised_date||""))) throw new HttpError(400,"A valid promised amount and date are required.")
  const [result]=await pool.query(`INSERT INTO fee_payment_promises (public_ref,school_id,student_id,guardian_name,guardian_phone,promised_amount,promised_date,note,status,created_by) VALUES (UUID(),?,?,?,?,?,?,?,'pending',?)`,[schoolId,student.id,body.guardian_name||null,body.guardian_phone||null,amount,body.promised_date,body.note||null,actorId])
  const [[row]]=await pool.query("SELECT public_ref AS id,guardian_name,promised_amount,promised_date,status,note FROM fee_payment_promises WHERE id=?",[result.insertId]); await safeAudit(schoolId,actorId,"PAYMENT_PROMISE_RECORDED","fee_payment_promise",result.insertId,row); return row
}
export async function updatePaymentPromise(schoolId,publicRef,body={}) { const status=["pending","fulfilled","missed","cancelled"].includes(body.status)?body.status:null; if(!status) throw new HttpError(400,"Promise status is invalid."); await pool.query("UPDATE fee_payment_promises SET status=?,note=COALESCE(?,note) WHERE school_id=? AND public_ref=?",[status,body.note||null,schoolId,publicRef]); return {ok:true,status} }

export async function sendFeeReminder(schoolId,actorId,body={},dependencies={}) {
  const db=dependencies.db||pool
  const notify=dependencies.createInAppNotification||createInAppNotification
  const queueWhatsapp=dependencies.queueWhatsAppMessage||queueWhatsAppMessage
  const createTask=dependencies.createDirectorTask||createDirectorTask
  const audit=dependencies.safeAudit||safeAudit
  const [[row]]=await db.query(`SELECT s.id,s.public_ref,CONCAT(s.first_name,' ',s.last_name) student_name,sg.full_name guardian_name,sg.primary_phone guardian_phone,guardian_user.id guardian_user_id,sch.name school_name,COALESCE(SUM(GREATEST(fa.amount_due-fa.amount_paid,0)),0) balance FROM students s JOIN schools sch ON sch.id=s.school_id LEFT JOIN student_guardians sg ON sg.student_id=s.id AND sg.school_id=s.school_id AND sg.guardian_number=1 LEFT JOIN users guardian_user ON guardian_user.id=sg.user_id AND guardian_user.school_id=s.school_id AND guardian_user.role='parent' AND guardian_user.is_active=1 LEFT JOIN fee_accounts fa ON fa.student_id=s.id AND fa.school_id=s.school_id WHERE s.school_id=? AND s.public_ref=? GROUP BY s.id,s.public_ref,s.first_name,s.last_name,sg.full_name,sg.primary_phone,guardian_user.id,sch.name`,[schoolId,body.student_ref])
  if(!row) throw new HttpError(400,"Student fee record was not found.")
  const message=body.message||`Dear guardian, this is a fee reminder from ${row.school_name}. The current outstanding balance for ${row.student_name} is MWK ${Number(row.balance).toLocaleString()}. Please contact the school bursar for payment assistance.`
  const channel=body.channel==="whatsapp"?"whatsapp":"in_app"
  const priority=priorities.has(body.priority)?body.priority:"high"
  const notification=row.guardian_user_id?await notify({schoolId,recipientUserId:row.guardian_user_id,title:body.title||`Fee reminder for ${row.student_name}`,message,category:"finance",priority,linkedEntityType:"student",linkedEntityId:row.id,createdBy:actorId}):null
  if(channel==="in_app"&&!notification) throw new HttpError(409,"This learner does not have a linked, active guardian login for an in-app fee reminder.")
  const whatsapp=channel==="whatsapp"?await queueWhatsapp({schoolId,recipientType:"guardian",recipientUserId:row.guardian_user_id||null,recipientName:row.guardian_name,recipientPhone:row.guardian_phone,templateKey:"guardian_fee_reminder",messageBody:message,linkedEntityType:"student",linkedEntityId:row.id,createdBy:actorId}):null
  if(channel==="whatsapp"&&whatsapp?.status==="skipped"&&!notification) throw new HttpError(409,`${whatsapp.reason||"WhatsApp could not be queued."} No linked guardian login is available for in-app fallback.`)
  const task=body.create_follow_up?await createTask(schoolId,actorId,{title:`Fee recovery: ${row.student_name}`,description:message,category:"finance",priority,assigned_to_user_id:body.assigned_to_user_id||null,due_date:body.due_date||null,linked_entity_type:"student",linked_entity_id:row.id,context_snapshot:{student_name:row.student_name,balance:`MWK ${Number(row.balance).toLocaleString()}`,guardian_name:row.guardian_name}}):null
  await audit(schoolId,actorId,"FEE_REMINDER_CREATED","student",row.id,{channel,balance:row.balance,notification_sent:Boolean(notification),whatsapp_status:whatsapp?.status||null})
  const resultMessage=channel==="in_app"?"In-app fee reminder sent.":whatsapp?.status==="queued"?`WhatsApp fee reminder queued${notification?"; in-app copy sent.":"."}`:`${whatsapp?.reason||"WhatsApp could not be queued."} In-app reminder sent instead.`
  return {notification,whatsapp,task,message:resultMessage}
}
