import crypto, { randomUUID } from "crypto"
import fs from "fs/promises"
import path from "path"
import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { createInAppNotification, broadcastSchoolNotification } from "./operationalCommunicationService.js"
import { syncCurriculumFromLesson } from "./academicIntelligenceEngine.js"

const RESOURCE_STATUSES = new Set(['DRAFT','SUBMITTED','UNDER_REVIEW','CHANGES_REQUESTED','APPROVED','REJECTED','ARCHIVED','UNCLASSIFIED'])
const RESOURCE_TRANSITIONS = {
  DRAFT: new Set(['SUBMITTED','ARCHIVED']),
  UNCLASSIFIED: new Set(['UNDER_REVIEW','ARCHIVED']),
  SUBMITTED: new Set(['UNDER_REVIEW','CHANGES_REQUESTED','REJECTED']),
  UNDER_REVIEW: new Set(['CHANGES_REQUESTED','APPROVED','REJECTED']),
  CHANGES_REQUESTED: new Set(['SUBMITTED','ARCHIVED']),
  APPROVED: new Set(['ARCHIVED']),
  REJECTED: new Set(['DRAFT','ARCHIVED']),
  ARCHIVED: new Set([]),
}
const PRINT_TRANSITIONS = {
  DRAFT: new Set(['SUBMITTED','CANCELLED']),
  SUBMITTED: new Set(['APPROVED','REJECTED','CANCELLED']),
  APPROVED: new Set(['QUEUED','CANCELLED']),
  QUEUED: new Set(['PRINTING','CANCELLED']),
  PRINTING: new Set(['READY','CANCELLED']),
  READY: new Set(['COLLECTED','CANCELLED']),
  COLLECTED: new Set([]), REJECTED: new Set([]), CANCELLED: new Set([]),
}
const SAFE_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png','image/jpeg','image/webp','text/plain','audio/mpeg','video/mp4',
])
const MAX_RESOURCE_BYTES = 40 * 1024 * 1024

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max)
}

function numberOrNull(value) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? number : null
}

function jsonValue(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'object' && !Buffer.isBuffer(value)) return value
  try { return JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value)) } catch { return fallback }
}

function schoolClock() {
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:process.env.SCHOOL_TIMEZONE||'Africa/Blantyre',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).formatToParts(new Date())
  const values=Object.fromEntries(parts.filter((part)=>part.type!=='literal').map((part)=>[part.type,part.value]))
  return `${values.hour}:${values.minute}:${values.second}`
}

function decodeDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!match) throw new HttpError(400, 'Attach a valid base64 file data URL.')
  const mimeType = match[1].toLowerCase()
  if (!SAFE_MIME_TYPES.has(mimeType)) throw new HttpError(415, `Files of type ${mimeType} are not allowed.`)
  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  if (!buffer.length) throw new HttpError(400, 'The attached file is empty.')
  if (buffer.length > MAX_RESOURCE_BYTES) throw new HttpError(413, 'Teaching resources must be 40 MB or smaller.')
  return { mimeType, buffer, checksum: crypto.createHash('sha256').update(buffer).digest('hex') }
}

function safeName(name, mimeType) {
  const extensions = {
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'text/plain': '.txt', 'audio/mpeg': '.mp3', 'video/mp4': '.mp4',
  }
  const base = path.basename(clean(name, 180) || 'resource').replace(/[^a-zA-Z0-9._-]/g, '-')
  return path.extname(base) ? base : `${base}${extensions[mimeType] || '.bin'}`
}

async function audit(connection, schoolId, actor, action, entityType, entityId, beforeValue, afterValue) {
  await connection.query(
    `INSERT INTO audit_logs (school_id,actor_user_id,actor_role,action,entity_type,entity_id,before_value,after_value)
     VALUES (?,?,?,?,?,?,?,?)`,
    [schoolId, actor?.id || null, actor?.role || null, action, entityType, entityId || null,
      beforeValue ? JSON.stringify(beforeValue) : null, afterValue ? JSON.stringify(afterValue) : null],
  ).catch((error) => { if (!['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error?.code)) throw error })
}

async function resourceByRef(connection, schoolId, ref, lock = false) {
  const [[row]] = await connection.query(
    `SELECT tr.*,subj.name subject_name,c.name class_name,t.topic_name,st.topic_name subtopic_name,
      u.full_name uploader_name,rl.full_name librarian_name,ap.full_name approver_name
     FROM teaching_resources tr
     LEFT JOIN subjects subj ON subj.id=tr.subject_id AND subj.school_id=tr.school_id
     LEFT JOIN classes c ON c.id=tr.class_id AND c.school_id=tr.school_id
     LEFT JOIN syllabus_topics t ON t.id=tr.topic_id AND t.school_id=tr.school_id
     LEFT JOIN syllabus_topics st ON st.id=tr.subtopic_id AND st.school_id=tr.school_id
     JOIN users u ON u.id=tr.uploader_id
     LEFT JOIN users rl ON rl.id=tr.reviewing_librarian_id
     LEFT JOIN users ap ON ap.id=tr.approving_user_id
     WHERE tr.school_id=? AND tr.public_ref=? LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [schoolId, ref],
  )
  if (!row) throw new HttpError(404, 'Teaching resource was not found.')
  return row
}

function publicResource(row) {
  const output = { ...row }
  delete output.id
  delete output.school_id
  delete output.subject_id
  delete output.class_id
  delete output.curriculum_id
  delete output.topic_id
  delete output.subtopic_id
  delete output.learning_objective_id
  delete output.academic_year_id
  delete output.term_id
  delete output.current_version_id
  delete output.original_creator_id
  delete output.uploader_id
  delete output.reviewing_librarian_id
  delete output.approving_user_id
  return output
}

export async function createTeachingResource(schoolId, actor, body = {}) {
  const title = clean(body.title, 240)
  const resourceType = clean(body.resource_type, 80)
  if (!title || !resourceType) throw new HttpError(400, 'Resource title and type are required.')
  const file = decodeDataUrl(body.file_data_url || body.fileDataUrl)
  const ref = randomUUID()
  const versionRef = randomUUID()
  const filename = safeName(body.original_filename || body.filename, file.mimeType)
  const folder = path.resolve(process.cwd(), 'uploads', 'teaching-resources', String(schoolId), ref)
  const storedFilename = `${versionRef}-${filename}`
  const absolutePath = path.join(folder, storedFilename)
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(absolutePath, file.buffer)
  const relativePath = path.relative(process.cwd(), absolutePath)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [insert] = await connection.query(
      `INSERT INTO teaching_resources (
        public_ref,school_id,title,description,resource_type,subject_id,class_id,stream_section,curriculum_id,
        topic_id,subtopic_id,learning_objective_id,academic_year_id,term_id,language,estimated_duration_minutes,
        source,copyright_status,confidentiality,approval_status,original_creator_id,uploader_id,printable,download_allowed
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ref,schoolId,title,clean(body.description,4000)||null,resourceType,numberOrNull(body.subject_id),numberOrNull(body.class_id),
        clean(body.stream_section,80)||null,numberOrNull(body.curriculum_id),numberOrNull(body.topic_id),numberOrNull(body.subtopic_id),
        numberOrNull(body.learning_objective_id),numberOrNull(body.academic_year_id),numberOrNull(body.term_id),clean(body.language,60)||'English',
        numberOrNull(body.estimated_duration_minutes),clean(body.source,180)||null,body.copyright_status||'unknown',
        body.confidentiality||'normal',body.submit ? 'SUBMITTED' : 'DRAFT',actor.id,actor.id,body.printable===false?0:1,body.download_allowed===false?0:1],
    )
    const resourceId = insert.insertId
    const [versionInsert] = await connection.query(
      `INSERT INTO teaching_resource_versions (
        public_ref,school_id,resource_id,version_number,change_description,original_filename,stored_filename,file_path,
        mime_type,file_size,checksum,page_count,approval_status,created_by,is_current
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [versionRef,schoolId,resourceId,1,clean(body.change_description,2000)||'Initial version',filename,storedFilename,relativePath,
        file.mimeType,file.buffer.length,file.checksum,numberOrNull(body.page_count),body.submit?'SUBMITTED':'DRAFT',actor.id],
    )
    await connection.query('UPDATE teaching_resources SET current_version_id=? WHERE id=? AND school_id=?', [versionInsert.insertId,resourceId,schoolId])
    await audit(connection,schoolId,actor,'TEACHING_RESOURCE_UPLOADED','teaching_resource',resourceId,null,{public_ref:ref,title,status:body.submit?'SUBMITTED':'DRAFT',checksum:file.checksum})
    await connection.commit()
    if (body.submit) {
      await broadcastSchoolNotification({schoolId,roles:['librarian'],title:'Teaching resource submitted',message:`${actor.fullName || actor.full_name || 'A teacher'} submitted “${title}” for file-quality and metadata review.`,category:'library',priority:'medium',linkedEntityType:'teaching_resource',linkedEntityId:resourceId,createdBy:actor.id})
    }
    return getTeachingResource(schoolId, ref)
  } catch (error) {
    await connection.rollback()
    await fs.unlink(absolutePath).catch(() => {})
    throw error
  } finally { connection.release() }
}

export async function listTeachingResources(schoolId, actor, query = {}) {
  const params = [schoolId]
  const where = ['tr.school_id=?']
  const status = clean(query.status,40).toUpperCase()
  if (status && RESOURCE_STATUSES.has(status)) { where.push('tr.approval_status=?'); params.push(status) }
  else if (!['librarian','school_owner','director','owner','headteacher','super_admin'].includes(String(actor.role).toLowerCase())) where.push("tr.approval_status='APPROVED'")
  if (String(actor.role).toLowerCase() === 'teacher') {
    where.push(`(tr.subject_id IS NULL OR EXISTS (
      SELECT 1 FROM teacher_class_subject_assignments ta
      WHERE ta.school_id=tr.school_id AND ta.teacher_id=? AND ta.subject_id=tr.subject_id
        AND ta.is_active=1 AND (tr.class_id IS NULL OR ta.class_id=tr.class_id)
    ))`)
    params.push(actor.id)
  }
  if (query.subject_id) { where.push('tr.subject_id=?'); params.push(Number(query.subject_id)) }
  if (query.class_id) { where.push('(tr.class_id=? OR tr.class_id IS NULL)'); params.push(Number(query.class_id)) }
  if (query.topic_id) { where.push('(tr.topic_id=? OR tr.topic_id IS NULL)'); params.push(Number(query.topic_id)) }
  if (query.resource_type) { where.push('tr.resource_type=?'); params.push(clean(query.resource_type,80)) }
  if (query.archived === 'false') where.push("tr.approval_status<>'ARCHIVED'")
  if (query.q) {
    const term = `%${clean(query.q,180)}%`
    where.push('(tr.title LIKE ? OR tr.description LIKE ? OR subj.name LIKE ? OR t.topic_name LIKE ?)')
    params.push(term,term,term,term)
  }
  const limit = Math.min(100,Math.max(1,Number(query.limit||40)))
  const offset = Math.max(0,Number(query.offset||0))
  const [rows] = await pool.query(
    `SELECT tr.public_ref,tr.title,tr.description,tr.resource_type,tr.language,tr.confidentiality,tr.approval_status,
      tr.printable,tr.download_allowed,tr.usage_count,tr.last_used_at,tr.created_at,tr.updated_at,
      subj.name subject_name,c.name class_name,t.topic_name,st.topic_name subtopic_name,
      v.public_ref version_ref,v.version_number,v.mime_type,v.file_size,v.page_count,v.is_current,u.full_name uploader_name
     FROM teaching_resources tr
     LEFT JOIN subjects subj ON subj.id=tr.subject_id AND subj.school_id=tr.school_id
     LEFT JOIN classes c ON c.id=tr.class_id AND c.school_id=tr.school_id
     LEFT JOIN syllabus_topics t ON t.id=tr.topic_id AND t.school_id=tr.school_id
     LEFT JOIN syllabus_topics st ON st.id=tr.subtopic_id AND st.school_id=tr.school_id
     LEFT JOIN teaching_resource_versions v ON v.id=tr.current_version_id AND v.school_id=tr.school_id
     JOIN users u ON u.id=tr.uploader_id
     WHERE ${where.join(' AND ')} ORDER BY FIELD(tr.approval_status,'SUBMITTED','UNDER_REVIEW','CHANGES_REQUESTED','DRAFT','APPROVED','REJECTED','ARCHIVED'),tr.updated_at DESC LIMIT ? OFFSET ?`,
    [...params,limit,offset],
  )
  return { resources: rows, limit, offset }
}

export async function getTeachingResource(schoolId, ref, actor = null) {
  const resource = await resourceByRef(pool,schoolId,ref)
  if (actor && String(actor.role).toLowerCase() === 'teacher') {
    const [[assignment]] = await pool.query(
      `SELECT 1 allowed FROM teacher_class_subject_assignments
       WHERE school_id=? AND teacher_id=? AND subject_id=? AND is_active=1
         AND (? IS NULL OR class_id=?) LIMIT 1`,
      [schoolId,actor.id,resource.subject_id||0,resource.class_id,resource.class_id],
    )
    if (resource.subject_id && !assignment) throw new HttpError(403,'Teachers can only access resources for assigned classes and subjects.')
  }
  const [versions,reviews,usage] = await Promise.all([
    pool.query(`SELECT public_ref,version_number,change_description,original_filename,mime_type,file_size,page_count,approval_status,is_current,approved_at,created_at FROM teaching_resource_versions WHERE school_id=? AND resource_id=? ORDER BY version_number DESC`,[schoolId,resource.id]),
    pool.query(`SELECT rr.public_ref,rr.review_type,rr.decision,rr.quality_flags_json,rr.notes,rr.reviewed_at,rr.created_at,u.full_name reviewer_name FROM teaching_resource_reviews rr JOIN users u ON u.id=rr.reviewer_id WHERE rr.school_id=? AND rr.resource_id=? ORDER BY rr.created_at DESC`,[schoolId,resource.id]),
    pool.query(`SELECT usage_type,COUNT(*) total,MAX(created_at) last_used_at FROM teaching_resource_usage WHERE school_id=? AND resource_id=? GROUP BY usage_type`,[schoolId,resource.id]),
  ])
  return { resource: publicResource(resource), versions: versions[0], reviews: reviews[0].map((row)=>({...row,quality_flags:jsonValue(row.quality_flags_json,[]),quality_flags_json:undefined})), usage: usage[0] }
}

export async function transitionTeachingResource(schoolId, ref, actor, body = {}) {
  const next = clean(body.status,40).toUpperCase()
  if (!RESOURCE_STATUSES.has(next)) throw new HttpError(400,'Resource status is invalid.')
  const actorPermissions = new Set((actor.permissions || []).map((value)=>String(value).toUpperCase()))
  if (next === 'APPROVED' && !actorPermissions.has('TEACHING_RESOURCE_APPROVE')) throw new HttpError(403,'Academic approval requires the teaching-resource approval permission.')
  if (next === 'ARCHIVED' && !actorPermissions.has('TEACHING_RESOURCE_ARCHIVE')) throw new HttpError(403,'Archiving resources requires the teaching-resource archive permission.')
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const resource = await resourceByRef(connection,schoolId,ref,true)
    if (!RESOURCE_TRANSITIONS[resource.approval_status]?.has(next)) throw new HttpError(409,`A ${resource.approval_status.toLowerCase()} resource cannot move directly to ${next.toLowerCase()}.`)
    if (next === 'APPROVED') {
      const [reviews] = await connection.query("SELECT review_type,decision FROM teaching_resource_reviews WHERE school_id=? AND resource_id=? AND version_id=?",[schoolId,resource.id,resource.current_version_id])
      const fileApproved = reviews.some((row)=>row.review_type==='file_quality'&&row.decision==='approved')
      const academicApproved = reviews.some((row)=>row.review_type==='academic_content'&&row.decision==='approved')
      if (!fileApproved || !academicApproved) throw new HttpError(409,'Both file-quality and academic-content reviews must be approved first.')
    }
    await connection.query(
      `UPDATE teaching_resources SET approval_status=?,reviewing_librarian_id=CASE WHEN ?='UNDER_REVIEW' THEN ? ELSE reviewing_librarian_id END,
        approving_user_id=CASE WHEN ?='APPROVED' THEN ? ELSE approving_user_id END,archived_at=CASE WHEN ?='ARCHIVED' THEN CURRENT_TIMESTAMP ELSE archived_at END
       WHERE id=? AND school_id=?`,
      [next,next,actor.id,next,actor.id,next,resource.id,schoolId],
    )
    await connection.query("UPDATE teaching_resource_versions SET approval_status=?,approved_by=CASE WHEN ?='APPROVED' THEN ? ELSE approved_by END,approved_at=CASE WHEN ?='APPROVED' THEN CURRENT_TIMESTAMP ELSE approved_at END WHERE school_id=? AND id=?",[next,next,actor.id,next,schoolId,resource.current_version_id])
    if (body.review_type) await connection.query(
      `INSERT INTO teaching_resource_reviews (public_ref,school_id,resource_id,version_id,review_type,decision,quality_flags_json,notes,reviewer_id,reviewed_at)
       VALUES (UUID(),?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
      [schoolId,resource.id,resource.current_version_id,body.review_type,body.decision||(['CHANGES_REQUESTED','REJECTED'].includes(next)?next.toLowerCase():'pending'),JSON.stringify(body.quality_flags||[]),clean(body.notes,4000)||null,actor.id],
    )
    await audit(connection,schoolId,actor,'TEACHING_RESOURCE_STATUS_CHANGED','teaching_resource',resource.id,{status:resource.approval_status},{status:next,notes:body.notes||null})
    await connection.commit()
    if (resource.uploader_id !== actor.id) await createInAppNotification({schoolId,recipientUserId:resource.uploader_id,title:`Resource ${next.toLowerCase().replace('_',' ')}`,message:`“${resource.title}” is now ${next.toLowerCase().replace('_',' ')}${body.notes?`: ${clean(body.notes,240)}`:'.'}`,category:'library',priority:['CHANGES_REQUESTED','REJECTED'].includes(next)?'high':'medium',linkedEntityType:'teaching_resource',linkedEntityId:resource.id,createdBy:actor.id})
    return getTeachingResource(schoolId,ref)
  } catch(error){await connection.rollback();throw error} finally {connection.release()}
}

export async function reviewTeachingResource(schoolId, ref, actor, body = {}) {
  const reviewType = body.review_type
  if (!['file_quality','academic_content'].includes(reviewType)) throw new HttpError(400,'Review type must be file_quality or academic_content.')
  if (reviewType === 'academic_content' && !(actor.permissions || []).includes('TEACHING_RESOURCE_APPROVE')) throw new HttpError(403,'Academic-content review requires academic approval permission.')
  const decision = body.decision
  if (!['pending','approved','changes_requested','rejected'].includes(decision)) throw new HttpError(400,'Review decision is invalid.')
  const resource = await resourceByRef(pool,schoolId,ref)
  await pool.query(
    `INSERT INTO teaching_resource_reviews (public_ref,school_id,resource_id,version_id,review_type,decision,quality_flags_json,notes,reviewer_id,reviewed_at)
     VALUES (UUID(),?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`,
    [schoolId,resource.id,resource.current_version_id,reviewType,decision,JSON.stringify(body.quality_flags||[]),clean(body.notes,4000)||null,actor.id],
  )
  if (decision === 'changes_requested') await pool.query("UPDATE teaching_resources SET approval_status='CHANGES_REQUESTED' WHERE school_id=? AND id=?",[schoolId,resource.id])
  else if (decision === 'rejected') await pool.query("UPDATE teaching_resources SET approval_status='REJECTED' WHERE school_id=? AND id=?",[schoolId,resource.id])
  else await pool.query("UPDATE teaching_resources SET approval_status='UNDER_REVIEW',reviewing_librarian_id=CASE WHEN ?='file_quality' THEN ? ELSE reviewing_librarian_id END WHERE school_id=? AND id=?",[reviewType,actor.id,schoolId,resource.id])
  await audit(pool,schoolId,actor,'TEACHING_RESOURCE_REVIEWED','teaching_resource',resource.id,null,{review_type:reviewType,decision,quality_flags:body.quality_flags||[]})
  return getTeachingResource(schoolId,ref)
}

export async function createTeachingResourceVersion(schoolId,ref,actor,body={}){
  const file=decodeDataUrl(body.file_data_url||body.fileDataUrl)
  const resource=await resourceByRef(pool,schoolId,ref)
  const versionRef=randomUUID();const filename=safeName(body.original_filename||body.filename,file.mimeType)
  const folder=path.resolve(process.cwd(),'uploads','teaching-resources',String(schoolId),ref)
  const storedFilename=`${versionRef}-${filename}`;const absolutePath=path.join(folder,storedFilename)
  await fs.mkdir(folder,{recursive:true});await fs.writeFile(absolutePath,file.buffer)
  const connection=await pool.getConnection()
  try{await connection.beginTransaction();const [[latest]]=await connection.query("SELECT MAX(version_number) version_number FROM teaching_resource_versions WHERE school_id=? AND resource_id=? FOR UPDATE",[schoolId,resource.id]);const versionNumber=Number(latest?.version_number||0)+1;await connection.query("UPDATE teaching_resource_versions SET is_current=0 WHERE school_id=? AND resource_id=?",[schoolId,resource.id]);const [insert]=await connection.query(`INSERT INTO teaching_resource_versions (public_ref,school_id,resource_id,version_number,change_description,original_filename,stored_filename,file_path,mime_type,file_size,checksum,page_count,approval_status,created_by,supersedes_version_id,is_current) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,[versionRef,schoolId,resource.id,versionNumber,clean(body.change_description,2000)||`Version ${versionNumber}`,filename,storedFilename,path.relative(process.cwd(),absolutePath),file.mimeType,file.buffer.length,file.checksum,numberOrNull(body.page_count),body.submit?'SUBMITTED':'DRAFT',actor.id,resource.current_version_id]);await connection.query("UPDATE teaching_resources SET current_version_id=?,approval_status=? WHERE school_id=? AND id=?",[insert.insertId,body.submit?'SUBMITTED':'DRAFT',schoolId,resource.id]);await audit(connection,schoolId,actor,'TEACHING_RESOURCE_VERSION_CREATED','teaching_resource',resource.id,{current_version_id:resource.current_version_id},{version_ref:versionRef,version_number:versionNumber,checksum:file.checksum});await connection.commit();return getTeachingResource(schoolId,ref,actor)}catch(error){await connection.rollback();await fs.unlink(absolutePath).catch(()=>{});throw error}finally{connection.release()}
}

export async function resolveTeachingResourceDownload(schoolId, ref, actor, versionRef = null) {
  const resource = await resourceByRef(pool,schoolId,ref)
  if (!resource.download_allowed) throw new HttpError(403,'Downloads are disabled for this resource.')
  if (['restricted_assessment','marking_scheme','confidential'].includes(resource.confidentiality) && !['school_owner','director','owner','headteacher','super_admin'].includes(String(actor.role).toLowerCase()) && !actor.permissions?.includes('ARCHIVED_MARKING_SCHEME_VIEW')) {
    throw new HttpError(403,'This confidential academic file requires explicit access.')
  }
  const params = [schoolId,resource.id]
  let clause = 'v.id=?'; params.push(resource.current_version_id)
  if (versionRef) { clause='v.public_ref=?';params[2]=versionRef }
  const [[version]] = await pool.query(`SELECT v.id,v.public_ref,v.original_filename,v.file_path,v.mime_type FROM teaching_resource_versions v WHERE v.school_id=? AND v.resource_id=? AND ${clause} LIMIT 1`,params)
  if (!version) throw new HttpError(404,'Resource file version was not found.')
  const resolved = path.resolve(process.cwd(),version.file_path)
  const root = path.resolve(process.cwd(),'uploads','teaching-resources',String(schoolId))
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new HttpError(404,'Resource file is unavailable.')
  await pool.query("INSERT INTO teaching_resource_usage (public_ref,school_id,resource_id,version_id,user_id,usage_type) VALUES (UUID(),?,?,?,?,?)",[schoolId,resource.id,version.id,actor.id,'download'])
  await pool.query("UPDATE teaching_resources SET usage_count=usage_count+1,last_used_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=?",[resource.id,schoolId])
  await audit(pool,schoolId,actor,'TEACHING_RESOURCE_DOWNLOADED','teaching_resource',resource.id,null,{version_ref:version.public_ref,confidentiality:resource.confidentiality})
  return {path:resolved,filename:version.original_filename,mime_type:version.mime_type}
}

export async function createTeachingResourceRequest(schoolId,actor,body={}) {
  const requestText=clean(body.request_text,3000)
  if(!requestText)throw new HttpError(400,'Describe the teaching resource you need.')
  let classId=numberOrNull(body.class_id),subjectId=numberOrNull(body.subject_id),topicId=numberOrNull(body.topic_id)
  if(!classId&&body.class_ref){const [[row]]=await pool.query("SELECT id FROM classes WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,clean(body.class_ref,80)]);classId=row?.id||null}
  if(!subjectId&&body.subject_ref){const [[row]]=await pool.query("SELECT id FROM subjects WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,clean(body.subject_ref,80)]);subjectId=row?.id||null}
  if(!topicId&&body.topic_ref){const [[row]]=await pool.query("SELECT id FROM syllabus_topics WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,clean(body.topic_ref,80)]);topicId=row?.id||null}
  const ref=randomUUID();const priority=['low','medium','high','urgent'].includes(body.priority)?body.priority:'medium'
  const [insert]=await pool.query("INSERT INTO teaching_resource_requests (public_ref,school_id,requested_by,subject_id,class_id,topic_id,request_text,required_at,priority,status) VALUES (?,?,?,?,?,?,?,?,?,'submitted')",[ref,schoolId,actor.id,subjectId,classId,topicId,requestText,body.required_at||null,priority])
  await broadcastSchoolNotification({schoolId,roles:['librarian'],title:'Teacher resource request',message:`${actor.fullName||'A teacher'} requested classroom material: ${requestText.slice(0,180)}`,category:'library',priority,linkedEntityType:'teaching_resource_request',linkedEntityId:insert.insertId,createdBy:actor.id})
  await audit(pool,schoolId,actor,'TEACHING_RESOURCE_REQUESTED','teaching_resource_request',insert.insertId,null,{public_ref:ref,priority})
  return {public_ref:ref,status:'submitted'}
}

export async function listTeachingResourceRequests(schoolId,actor,query={}) {
  const params=[schoolId];const where=['rr.school_id=?']
  if(String(actor.role).toLowerCase()==='teacher'){where.push('rr.requested_by=?');params.push(actor.id)}
  if(query.status){where.push('rr.status=?');params.push(clean(query.status,40))}
  const [rows]=await pool.query(`SELECT rr.public_ref,rr.request_text,rr.required_at,rr.priority,rr.status,rr.response_note,rr.created_at,
    u.full_name requested_by_name,c.name class_name,s.name subject_name,t.topic_name,tr.public_ref fulfilled_resource_ref,tr.title fulfilled_resource_title
    FROM teaching_resource_requests rr JOIN users u ON u.id=rr.requested_by
    LEFT JOIN classes c ON c.id=rr.class_id AND c.school_id=rr.school_id
    LEFT JOIN subjects s ON s.id=rr.subject_id AND s.school_id=rr.school_id
    LEFT JOIN syllabus_topics t ON t.id=rr.topic_id AND t.school_id=rr.school_id
    LEFT JOIN teaching_resources tr ON tr.id=rr.fulfilled_resource_id AND tr.school_id=rr.school_id
    WHERE ${where.join(' AND ')} ORDER BY FIELD(rr.status,'submitted','accepted','locating','fulfilled','not_available','cancelled'),FIELD(rr.priority,'urgent','high','medium','low'),rr.required_at LIMIT 100`,params)
  return {requests:rows}
}

export async function updateTeachingResourceRequest(schoolId,ref,actor,body={}) {
  const allowed=new Set(['submitted','accepted','locating','fulfilled','not_available','cancelled']);const status=clean(body.status,40)
  if(!allowed.has(status))throw new HttpError(400,'Resource request status is invalid.')
  const [[request]]=await pool.query("SELECT id,requested_by,request_text,status FROM teaching_resource_requests WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,ref])
  if(!request)throw new HttpError(404,'Teaching resource request was not found.')
  let resourceId=null;if(body.fulfilled_resource_ref){const resource=await resourceByRef(pool,schoolId,body.fulfilled_resource_ref);resourceId=resource.id}
  const [result]=await pool.query("UPDATE teaching_resource_requests SET status=?,response_note=?,assigned_librarian_id=?,fulfilled_resource_id=COALESCE(?,fulfilled_resource_id) WHERE school_id=? AND public_ref=?",[status,clean(body.response_note,2000)||null,actor.id,resourceId,schoolId,ref])
  if(!result.affectedRows)throw new HttpError(404,'Teaching resource request was not found.')
  await audit(pool,schoolId,actor,'TEACHING_RESOURCE_REQUEST_UPDATED','teaching_resource_request',request.id,{status:request.status},{status})
  if(request.requested_by!==actor.id)await createInAppNotification({schoolId,recipientUserId:request.requested_by,title:`Resource request ${status.replaceAll('_',' ')}`,message:body.response_note||`Your request “${String(request.request_text).slice(0,140)}” is now ${status.replaceAll('_',' ')}.`,category:'library',priority:status==='fulfilled'?'high':'medium',linkedEntityType:'teaching_resource_request',linkedEntityId:request.id,createdBy:actor.id})
  return {public_ref:ref,status}
}

export async function getLibrarianDashboard(schoolId) {
  const [loanCounts,reviewCounts,printCounts,resourceCounts,archiveCounts,deviceCounts,recent,requestCounts] = await Promise.all([
    pool.query(`SELECT SUM(status='borrowed') borrowed,SUM(status='overdue' OR (status='borrowed' AND expected_return_date<CURDATE())) overdue,SUM(status IN ('lost','damaged')) lost_damaged FROM library_loans WHERE school_id=?`,[schoolId]),
    pool.query(`SELECT SUM(approval_status IN ('SUBMITTED','UNDER_REVIEW')) awaiting_review,SUM(approval_status='UNCLASSIFIED') unclassified,SUM(approval_status='CHANGES_REQUESTED') metadata_issues FROM teaching_resources WHERE school_id=?`,[schoolId]),
    pool.query(`SELECT SUM(status IN ('SUBMITTED','APPROVED','QUEUED','PRINTING')) pending,SUM(required_at<NOW() AND status NOT IN ('READY','COLLECTED','CANCELLED','REJECTED')) overdue,SUM(assessment_security=1 AND status NOT IN ('COLLECTED','CANCELLED','REJECTED')) confidential FROM print_requests WHERE school_id=?`,[schoolId]),
    pool.query(`SELECT COUNT(*) total,SUM(approval_status='APPROVED') approved,SUM(usage_count>0) used FROM teaching_resources WHERE school_id=?`,[schoolId]),
    pool.query(`SELECT COUNT(DISTINCT term_id) archived_terms,SUM(archive_status='MISSING') missing,SUM(archive_status='METADATA_WARNING') metadata_warnings FROM institutional_archive_records WHERE school_id=?`,[schoolId]),
    pool.query(`SELECT SUM(working_status='active') active,SUM(working_status IN ('unavailable','maintenance')) unavailable FROM library_computers WHERE school_id=?`,[schoolId]),
    pool.query(`SELECT public_ref,title,resource_type,approval_status,usage_count,updated_at FROM teaching_resources WHERE school_id=? ORDER BY updated_at DESC LIMIT 8`,[schoolId]),
    pool.query("SELECT SUM(status IN ('submitted','accepted','locating')) open_requests,SUM(priority IN ('urgent','high') AND status IN ('submitted','accepted','locating')) priority_requests FROM teaching_resource_requests WHERE school_id=?",[schoolId]),
  ])
  const counts=(row)=>Object.fromEntries(Object.entries(row||{}).map(([key,value])=>[key,Number(value||0)]))
  return {loans:counts(loanCounts[0][0]),reviews:counts(reviewCounts[0][0]),printing:counts(printCounts[0][0]),resources:counts(resourceCounts[0][0]),archive:counts(archiveCounts[0][0]),devices:counts(deviceCounts[0][0]),resource_requests:counts(requestCounts[0][0]),recent_resources:recent[0]}
}

export async function listLibraryResources(schoolId, query={}) {
  const params=[schoolId];const where=['lr.school_id=?']
  if(query.status){where.push('lr.status=?');params.push(query.status)}
  if(query.q){const term=`%${clean(query.q,160)}%`;where.push('(lr.title LIKE ? OR lr.author LIKE ? OR lr.isbn LIKE ? OR lr.category LIKE ?)');params.push(term,term,term,term)}
  const [rows]=await pool.query(`SELECT lr.public_ref,lr.title,lr.author,lr.publisher,lr.edition,lr.publication_year,lr.isbn,lr.category,lr.class_level,lr.shelf_location,lr.replacement_cost,lr.status,subj.name subject_name,COUNT(c.id) copies,COALESCE(SUM(c.availability_status='available'),0) available_copies FROM library_resources lr LEFT JOIN subjects subj ON subj.id=lr.subject_id AND subj.school_id=lr.school_id LEFT JOIN library_resource_copies c ON c.resource_id=lr.id AND c.school_id=lr.school_id WHERE ${where.join(' AND ')} GROUP BY lr.id ORDER BY lr.title LIMIT 100`,params)
  return {resources:rows}
}

export async function createLibraryResource(schoolId,actor,body={}) {
  const title=clean(body.title,240);if(!title)throw new HttpError(400,'Library resource title is required.')
  const ref=randomUUID();const copies=Math.min(500,Math.max(0,Number(body.number_of_copies||0)))
  const connection=await pool.getConnection()
  try{await connection.beginTransaction();const [insert]=await connection.query(`INSERT INTO library_resources (public_ref,school_id,title,author,publisher,edition,publication_year,isbn,category,subject_id,class_level,curriculum_id,topic_tags_json,shelf_location,acquisition_source,acquisition_date,replacement_cost,status,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[ref,schoolId,title,clean(body.author,180)||null,clean(body.publisher,180)||null,clean(body.edition,80)||null,numberOrNull(body.publication_year),clean(body.isbn,40)||null,clean(body.category,100)||null,numberOrNull(body.subject_id),clean(body.class_level,80)||null,numberOrNull(body.curriculum_id),JSON.stringify(body.topic_tags||[]),clean(body.shelf_location,100)||null,clean(body.acquisition_source,160)||null,body.acquisition_date||null,body.replacement_cost||null,'active',clean(body.notes,4000)||null,actor.id]);for(let index=0;index<copies;index+=1)await connection.query("INSERT INTO library_resource_copies (public_ref,school_id,resource_id,barcode,condition_status,availability_status) VALUES (UUID(),?,?,?,?,?)",[schoolId,insert.insertId,body.barcode_prefix?`${clean(body.barcode_prefix,60)}-${String(index+1).padStart(3,'0')}`:null,body.condition||'good','available']);await audit(connection,schoolId,actor,'LIBRARY_RESOURCE_CREATED','library_resource',insert.insertId,null,{public_ref:ref,title,copies});await connection.commit();return {public_ref:ref,title,copies}}catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function listLibraryLoans(schoolId,query={}) {
  const params=[schoolId];let clause=''
  if(query.status){clause=' AND ll.status=?';params.push(query.status)}
  const [rows]=await pool.query(`SELECT ll.public_ref,ll.borrower_type,ll.issue_date,ll.expected_return_date,ll.actual_return_date,ll.status,ll.condition_on_issue,ll.condition_on_return,ll.penalty_note,lr.public_ref resource_ref,lr.title,lc.public_ref copy_ref,lc.barcode,COALESCE(CONCAT(s.first_name,' ',s.last_name),u.full_name) borrower_name,issuer.full_name issuing_librarian,receiver.full_name receiving_librarian FROM library_loans ll JOIN library_resource_copies lc ON lc.id=ll.resource_copy_id AND lc.school_id=ll.school_id JOIN library_resources lr ON lr.id=lc.resource_id AND lr.school_id=ll.school_id LEFT JOIN students s ON s.id=ll.borrower_student_id AND s.school_id=ll.school_id LEFT JOIN users u ON u.id=ll.borrower_user_id AND u.school_id=ll.school_id JOIN users issuer ON issuer.id=ll.issued_by LEFT JOIN users receiver ON receiver.id=ll.received_by WHERE ll.school_id=?${clause} ORDER BY FIELD(ll.status,'overdue','borrowed','lost','damaged','returned'),ll.expected_return_date LIMIT 150`,params)
  return {loans:rows}
}

export async function listLibraryComputers(schoolId){const [rows]=await pool.query("SELECT public_ref,device_name,library_location,device_type,operating_system,serial_number,working_status,internet_available,printer_connected,assigned_purpose,last_maintenance_date,issue_notes,updated_at FROM library_computers WHERE school_id=? ORDER BY FIELD(working_status,'unavailable','maintenance','active','retired'),device_name",[schoolId]);return {computers:rows}}
export async function saveLibraryComputer(schoolId,actor,body={},ref=null){const deviceName=clean(body.device_name,160);if(!deviceName)throw new HttpError(400,'Device name is required.');if(ref){const [result]=await pool.query(`UPDATE library_computers SET device_name=?,library_location=?,device_type=?,operating_system=?,serial_number=?,working_status=?,internet_available=?,printer_connected=?,assigned_purpose=?,last_maintenance_date=?,issue_notes=? WHERE school_id=? AND public_ref=?`,[deviceName,clean(body.library_location,160)||null,clean(body.device_type,80)||null,clean(body.operating_system,120)||null,clean(body.serial_number,120)||null,body.working_status||'active',body.internet_available?1:0,body.printer_connected?1:0,clean(body.assigned_purpose,120)||null,body.last_maintenance_date||null,clean(body.issue_notes,2000)||null,schoolId,ref]);if(!result.affectedRows)throw new HttpError(404,'Library computer was not found.');await audit(pool,schoolId,actor,'LIBRARY_COMPUTER_UPDATED','library_computer',null,null,{public_ref:ref,working_status:body.working_status});return {public_ref:ref}}const publicRef=randomUUID();const [insert]=await pool.query(`INSERT INTO library_computers (public_ref,school_id,device_name,library_location,device_type,operating_system,serial_number,working_status,internet_available,printer_connected,assigned_purpose,last_maintenance_date,issue_notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[publicRef,schoolId,deviceName,clean(body.library_location,160)||null,clean(body.device_type,80)||null,clean(body.operating_system,120)||null,clean(body.serial_number,120)||null,body.working_status||'active',body.internet_available?1:0,body.printer_connected?1:0,clean(body.assigned_purpose,120)||null,body.last_maintenance_date||null,clean(body.issue_notes,2000)||null]);await audit(pool,schoolId,actor,'LIBRARY_COMPUTER_CREATED','library_computer',insert.insertId,null,{public_ref:publicRef,device_name:deviceName});return {public_ref:publicRef}}

export async function issueLibraryLoan(schoolId,actor,body={}) {
  const connection=await pool.getConnection()
  try{await connection.beginTransaction();const [[copy]]=await connection.query("SELECT lc.id,lc.availability_status,lr.title FROM library_resource_copies lc JOIN library_resources lr ON lr.id=lc.resource_id AND lr.school_id=lc.school_id WHERE lc.school_id=? AND lc.public_ref=? LIMIT 1 FOR UPDATE",[schoolId,body.copy_ref]);if(!copy)throw new HttpError(404,'Library copy was not found.');if(copy.availability_status!=='available')throw new HttpError(409,'This copy is not currently available.');const type=body.borrower_type;if(!['student','teacher','staff'].includes(type))throw new HttpError(400,'Borrower type is invalid.');let studentId=null,userId=null;if(type==='student'){const [[student]]=await connection.query("SELECT id FROM students WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,body.borrower_ref]);if(!student)throw new HttpError(400,'Student borrower was not found.');studentId=student.id}else{const [[user]]=await connection.query("SELECT id FROM users WHERE school_id=? AND public_ref=? AND is_active=1 LIMIT 1",[schoolId,body.borrower_ref]);if(!user)throw new HttpError(400,'Staff borrower was not found.');userId=user.id}const [insert]=await connection.query(`INSERT INTO library_loans (public_ref,school_id,resource_copy_id,borrower_type,borrower_student_id,borrower_user_id,issue_date,expected_return_date,issued_by,condition_on_issue,status) VALUES (UUID(),?,?,?,?,?,?,?,?,'good','borrowed')`,[schoolId,copy.id,type,studentId,userId,body.issue_date||new Date().toISOString().slice(0,10),body.expected_return_date,actor.id]);await connection.query("UPDATE library_resource_copies SET availability_status='borrowed' WHERE id=? AND school_id=?",[copy.id,schoolId]);await audit(connection,schoolId,actor,'LIBRARY_LOAN_ISSUED','library_loan',insert.insertId,null,{title:copy.title,borrower_type:type});await connection.commit();return {ok:true}}catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function returnLibraryLoan(schoolId,loanRef,actor,body={}) {
  const connection=await pool.getConnection()
  try{await connection.beginTransaction();const [[loan]]=await connection.query("SELECT * FROM library_loans WHERE school_id=? AND public_ref=? LIMIT 1 FOR UPDATE",[schoolId,loanRef]);if(!loan)throw new HttpError(404,'Library loan was not found.');if(!['borrowed','overdue','damaged'].includes(loan.status))throw new HttpError(409,'This loan is not open for return.');const condition=body.condition_on_return||'good';const status=condition==='lost'?'lost':condition==='damaged'?'damaged':'returned';await connection.query("UPDATE library_loans SET actual_return_date=COALESCE(?,CURDATE()),received_by=?,condition_on_return=?,status=?,penalty_note=? WHERE id=? AND school_id=?",[body.actual_return_date||null,actor.id,condition,status,clean(body.penalty_note,2000)||null,loan.id,schoolId]);await connection.query("UPDATE library_resource_copies SET condition_status=?,availability_status=? WHERE id=? AND school_id=?",[condition,status==='returned'?'available':status,loan.resource_copy_id,schoolId]);await audit(connection,schoolId,actor,'LIBRARY_LOAN_RETURNED','library_loan',loan.id,{status:loan.status},{status,condition});await connection.commit();return {public_ref:loanRef,status}}catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function createPrintRequest(schoolId,actor,body={}) {
  const resource=await resourceByRef(pool,schoolId,body.resource_ref);if(!resource.printable)throw new HttpError(409,'This resource is not marked as printable.')
  let classId=numberOrNull(body.class_id);if(!classId&&body.class_ref){const [[row]]=await pool.query("SELECT id FROM classes WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,clean(body.class_ref,80)]);classId=row?.id||null}
  const copies=Math.min(5000,Math.max(1,Number(body.copies||1)));const sensitive=['restricted_assessment','marking_scheme','confidential'].includes(resource.confidentiality)
  const ref=randomUUID();const [insert]=await pool.query(`INSERT INTO print_requests (public_ref,school_id,requested_by,resource_id,version_id,class_id,copies,paper_size,print_sides,colour_mode,required_at,confidentiality,assessment_security,notes,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[ref,schoolId,actor.id,resource.id,resource.current_version_id,classId,copies,body.paper_size||'A4',body.print_sides||'single',body.colour_mode||'black_white',body.required_at||null,resource.confidentiality,sensitive?1:0,clean(body.notes,2000)||null,'SUBMITTED']);await pool.query("INSERT INTO print_request_events (public_ref,school_id,print_request_id,next_status,note,actor_user_id) VALUES (UUID(),?,?,'SUBMITTED',?,?)",[schoolId,insert.insertId,clean(body.notes,2000)||null,actor.id]);await pool.query("INSERT INTO teaching_resource_usage (public_ref,school_id,resource_id,version_id,user_id,class_id,usage_type) VALUES (UUID(),?,?,?,?,?,'print_request')",[schoolId,resource.id,resource.current_version_id,actor.id,classId]);await broadcastSchoolNotification({schoolId,roles:['librarian'],title:sensitive?'Confidential print request':'New print request',message:`${actor.fullName||'A teacher'} requested ${copies} copies of “${resource.title}”.`,category:'library',priority:sensitive?'high':'medium',linkedEntityType:'print_request',linkedEntityId:insert.insertId,createdBy:actor.id});await audit(pool,schoolId,actor,'PRINT_REQUEST_CREATED','print_request',insert.insertId,null,{public_ref:ref,copies,sensitive});return {public_ref:ref,status:'SUBMITTED'}
}

export async function listPrintRequests(schoolId,query={}) {
  const params=[schoolId];let clause='';if(query.status){clause=' AND pr.status=?';params.push(query.status)}
  const [rows]=await pool.query(`SELECT pr.public_ref,pr.copies,pr.paper_size,pr.print_sides,pr.colour_mode,pr.required_at,pr.confidentiality,pr.assessment_security,pr.notes,pr.status,pr.damaged_copy_count,pr.cancelled_copy_count,pr.created_at,tr.public_ref resource_ref,tr.title,u.full_name requested_by_name,c.name class_name,p.full_name processed_by_name FROM print_requests pr JOIN teaching_resources tr ON tr.id=pr.resource_id AND tr.school_id=pr.school_id JOIN users u ON u.id=pr.requested_by LEFT JOIN classes c ON c.id=pr.class_id AND c.school_id=pr.school_id LEFT JOIN users p ON p.id=pr.processed_by WHERE pr.school_id=?${clause} ORDER BY FIELD(pr.status,'SUBMITTED','APPROVED','QUEUED','PRINTING','READY','DRAFT','REJECTED','CANCELLED','COLLECTED'),pr.assessment_security DESC,pr.required_at LIMIT 150`,params);return {requests:rows}
}

export async function transitionPrintRequest(schoolId,ref,actor,body={}) {
  const next=clean(body.status,40).toUpperCase();const connection=await pool.getConnection();try{await connection.beginTransaction();const [[request]]=await connection.query("SELECT * FROM print_requests WHERE school_id=? AND public_ref=? LIMIT 1 FOR UPDATE",[schoolId,ref]);if(!request)throw new HttpError(404,'Print request was not found.');if(!PRINT_TRANSITIONS[request.status]?.has(next))throw new HttpError(409,`A ${request.status.toLowerCase()} request cannot move directly to ${next.toLowerCase()}.`);await connection.query(`UPDATE print_requests SET status=?,approved_by=CASE WHEN ?='APPROVED' THEN ? ELSE approved_by END,processed_by=CASE WHEN ? IN ('QUEUED','PRINTING','READY','COLLECTED') THEN ? ELSE processed_by END,completed_at=CASE WHEN ?='COLLECTED' THEN CURRENT_TIMESTAMP ELSE completed_at END,damaged_copy_count=COALESCE(?,damaged_copy_count),cancelled_copy_count=COALESCE(?,cancelled_copy_count) WHERE id=? AND school_id=?`,[next,next,actor.id,next,actor.id,next,body.damaged_copy_count??null,body.cancelled_copy_count??null,request.id,schoolId]);await connection.query("INSERT INTO print_request_events (public_ref,school_id,print_request_id,previous_status,next_status,note,actor_user_id) VALUES (UUID(),?,?,?,?,?,?)",[schoolId,request.id,request.status,next,clean(body.note,2000)||null,actor.id]);await audit(connection,schoolId,actor,request.assessment_security?'CONFIDENTIAL_PRINT_PROCESSED':'PRINT_REQUEST_STATUS_CHANGED','print_request',request.id,{status:request.status},{status:next});await connection.commit();if(request.requested_by!==actor.id)await createInAppNotification({schoolId,recipientUserId:request.requested_by,title:`Print request ${next.toLowerCase()}`,message:next==='READY'?'Your print request is ready for collection.':`Your print request is now ${next.toLowerCase()}.`,category:'library',priority:next==='READY'?'high':'medium',linkedEntityType:'print_request',linkedEntityId:request.id,createdBy:actor.id});return {public_ref:ref,status:next}}catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function createArchiveSnapshot(schoolId,termId,actor) {
  const connection=await pool.getConnection();try{await connection.beginTransaction();const [[term]]=await connection.query("SELECT t.*,ay.name academic_year_name FROM terms t JOIN academic_years ay ON ay.id=t.academic_year_id AND ay.school_id=t.school_id WHERE t.school_id=? AND t.id=? LIMIT 1",[schoolId,termId]);if(!term)throw new HttpError(404,'Academic term was not found.');const sources=[
    {type:'syllabus',query:`SELECT su.id source_id,CONCAT('Syllabus · ',COALESCE(subj.name,su.original_filename)) title,JSON_OBJECT('filename',su.original_filename,'status',su.processing_status,'material_type',su.material_type) metadata,'normal' confidentiality FROM syllabus_uploads su LEFT JOIN subjects subj ON subj.id=su.subject_id AND subj.school_id=su.school_id WHERE su.school_id=? AND su.term_id=?`},
    {type:'lesson_log',query:`SELECT l.id source_id,CONCAT(c.name,' · ',subj.name,' · ',l.lesson_date) title,JSON_OBJECT('status',l.status,'coverage_status',l.coverage_status,'coverage_percentage',l.coverage_percentage) metadata,'normal' confidentiality FROM teacher_lesson_logs l JOIN classes c ON c.id=l.class_id AND c.school_id=l.school_id JOIN subjects subj ON subj.id=l.subject_id AND subj.school_id=l.school_id WHERE l.school_id=? AND l.term_id=?`},
    {type:'assessment',query:`SELECT a.id source_id,a.name title,JSON_OBJECT('status',a.status,'assessment_type',a.assessment_type,'total_marks',a.total_marks) metadata,'normal' confidentiality FROM assessments a WHERE a.school_id=? AND a.term_id=?`},
    {type:'teaching_resource',query:`SELECT tr.id source_id,tr.title,JSON_OBJECT('resource_type',tr.resource_type,'approval_status',tr.approval_status,'version_id',tr.current_version_id,'confidentiality',tr.confidentiality) metadata,CASE WHEN tr.confidentiality IN ('restricted_assessment','marking_scheme','confidential') THEN 'confidential_staff' ELSE 'normal' END confidentiality FROM teaching_resources tr WHERE tr.school_id=? AND tr.term_id=? AND tr.approval_status IN ('APPROVED','ARCHIVED')`},
    {type:'timetable',query:`SELECT t.id source_id,t.name title,JSON_OBJECT('status',t.status,'timetable_type',t.timetable_type) metadata,'normal' confidentiality FROM timetables t WHERE t.school_id=? AND t.term_id=?`},
    {type:'result_summary',query:`SELECT MIN(tr.id) source_id,CONCAT('Term results · ',c.name) title,JSON_OBJECT('class',c.name,'student_count',COUNT(*),'average',ROUND(AVG(tr.average_score),1)) metadata,'anonymous_statistics' confidentiality FROM term_results tr JOIN classes c ON c.id=tr.class_id AND c.school_id=tr.school_id WHERE tr.school_id=? AND tr.term_id=? GROUP BY c.id,c.name`},
  ];let archived=0;for(const source of sources){let rows=[];try{[rows]=await connection.query(source.query,[schoolId,termId])}catch(error){if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code))continue;throw error}for(const row of rows){await connection.query(`INSERT INTO institutional_archive_records (public_ref,school_id,academic_year_id,term_id,record_type,source_entity_type,source_entity_id,title,metadata_json,confidentiality,archive_status,immutable_at,archived_by,archived_at) VALUES (UUID(),?,?,?,?,?,?,?,?,?,'ARCHIVED',CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE title=VALUES(title),metadata_json=VALUES(metadata_json),archive_status='ARCHIVED',immutable_at=COALESCE(immutable_at,CURRENT_TIMESTAMP),archived_by=VALUES(archived_by),archived_at=CURRENT_TIMESTAMP`,[schoolId,term.academic_year_id,termId,source.type,source.type,row.source_id,row.title,typeof row.metadata==='string'?row.metadata:JSON.stringify(row.metadata||{}),row.confidentiality,actor.id]);archived+=1}}await audit(connection,schoolId,actor,'TERM_ARCHIVE_SNAPSHOT_CREATED','term',termId,null,{academic_year:term.academic_year_name,term:term.name,records:archived});await connection.commit();return {records_archived:archived}}catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function browseArchive(schoolId,actor,query={}) {
  const params=[schoolId];const where=['iar.school_id=?'];if(query.term_id){where.push('iar.term_id=?');params.push(Number(query.term_id))}if(query.academic_year_id){where.push('iar.academic_year_id=?');params.push(Number(query.academic_year_id))}if(query.record_type){where.push('iar.record_type=?');params.push(clean(query.record_type,100))}if(query.q){const term=`%${clean(query.q,160)}%`;where.push('iar.title LIKE ?');params.push(term)}
  const canNamed=actor.permissions?.includes('ARCHIVED_NAMED_RESULTS_VIEW')||['school_owner','director','owner','headteacher','super_admin'].includes(String(actor.role).toLowerCase());if(!canNamed)where.push("iar.confidentiality<>'named_results'")
  const canConfidential=actor.permissions?.includes('ARCHIVED_MARKING_SCHEME_VIEW')||['school_owner','director','owner','headteacher','super_admin'].includes(String(actor.role).toLowerCase());if(!canConfidential)where.push("iar.confidentiality<>'confidential_staff'")
  const [rows]=await pool.query(`SELECT iar.public_ref,iar.record_type,iar.title,iar.metadata_json,iar.confidentiality,iar.archive_status,iar.archived_at,ay.name academic_year,t.name term_name FROM institutional_archive_records iar LEFT JOIN academic_years ay ON ay.id=iar.academic_year_id AND ay.school_id=iar.school_id LEFT JOIN terms t ON t.id=iar.term_id AND t.school_id=iar.school_id WHERE ${where.join(' AND ')} ORDER BY ay.start_date DESC,t.term_number DESC,iar.record_type,iar.title LIMIT 200`,params);return {records:rows.map((row)=>({...row,metadata:jsonValue(row.metadata_json,{}),metadata_json:undefined}))}
}

export async function getClassroomSetup(schoolId,actor) {
  const [rows]=await pool.query(`SELECT c.public_ref class_ref,c.name class_name,c.grade_level,
    subj.id subject_id,subj.public_ref subject_ref,subj.name subject_name,subj.code subject_code
    FROM teacher_class_subject_assignments a
    JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
    JOIN subjects subj ON subj.id=a.subject_id AND subj.school_id=a.school_id
    LEFT JOIN academic_years ay ON ay.id=a.academic_year_id AND ay.school_id=a.school_id
    LEFT JOIN terms t ON t.id=a.term_id AND t.school_id=a.school_id
    WHERE a.school_id=? AND a.teacher_id=? AND a.is_active=1
      AND (a.academic_year_id IS NULL OR ay.status='active')
      AND (a.term_id IS NULL OR t.status IN ('open','marking'))
    ORDER BY c.name,subj.name`,[schoolId,actor.id])
  const subjectIds=[...new Set(rows.map((row)=>Number(row.subject_id)).filter(Boolean))]
  const topicsBySubject=new Map()
  if(subjectIds.length){const [topics]=await pool.query(`SELECT st.public_ref,st.subject_id,st.topic_name,NULL topic_code,1 is_mandatory,gl.name grade_name
    FROM syllabus_topics st LEFT JOIN grade_levels gl ON gl.id=st.grade_id AND gl.school_id=st.school_id
    WHERE st.school_id=? AND st.subject_id IN (${subjectIds.map(()=>'?').join(',')})
    ORDER BY COALESCE(st.order_number,999999),st.topic_name`,[schoolId,...subjectIds]);for(const topic of topics){const key=`${Number(topic.subject_id)}:${topic.grade_name||'*'}`;const list=topicsBySubject.get(key)||[];list.push({public_ref:topic.public_ref,name:topic.topic_name,code:topic.topic_code,is_mandatory:Boolean(topic.is_mandatory)});topicsBySubject.set(key,list)}}
  const grouped=new Map()
  for(const row of rows){const current=grouped.get(row.class_ref)||{public_ref:row.class_ref,name:row.class_name,grade_level:row.grade_level,subjects:[]};const exact=topicsBySubject.get(`${Number(row.subject_id)}:${row.grade_level}`)||[];const generic=topicsBySubject.get(`${Number(row.subject_id)}:*`)||[];current.subjects.push({public_ref:row.subject_ref,name:row.subject_name,code:row.subject_code,topics:[...exact,...generic]});grouped.set(row.class_ref,current)}
  return {classes:[...grouped.values()]}
}

export async function startClassroomSession(schoolId,actor,body={}) {
  let classId=numberOrNull(body.class_id)
  let subjectId=numberOrNull(body.subject_id)
  if(!classId&&body.class_ref){const [[row]]=await pool.query("SELECT id FROM classes WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,clean(body.class_ref,80)]);classId=row?.id||null}
  if(!subjectId&&body.subject_ref){const [[row]]=await pool.query("SELECT id FROM subjects WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,clean(body.subject_ref,80)]);subjectId=row?.id||null}
  if(!classId||!subjectId)throw new HttpError(400,'Class and subject are required.')
  let topicId=numberOrNull(body.topic_id)
  if(!topicId&&body.topic_ref){const [[row]]=await pool.query("SELECT id FROM syllabus_topics WHERE school_id=? AND subject_id=? AND public_ref=? LIMIT 1",[schoolId,subjectId,clean(body.topic_ref,80)]);topicId=row?.id||null}
  if(body.topic_ref&&!topicId)throw new HttpError(400,'The selected topic does not belong to this assigned subject.')
  const offlineId=clean(body.offline_client_id,120)||null
  const lessonDate=body.lesson_date||new Date().toISOString().slice(0,10)
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    if(offlineId){
      const [[existing]]=await connection.query("SELECT public_ref FROM classroom_sessions WHERE school_id=? AND teacher_id=? AND offline_client_id=? LIMIT 1",[schoolId,actor.id,offlineId])
      if(existing){await connection.commit();return getClassroomSession(schoolId,existing.public_ref,actor)}
    }
    const [[active]]=await connection.query("SELECT public_ref FROM classroom_sessions WHERE school_id=? AND teacher_id=? AND status='active' ORDER BY started_at DESC LIMIT 1",[schoolId,actor.id])
    if(active){await connection.commit();return getClassroomSession(schoolId,active.public_ref,actor)}
    const [[assignment]]=await connection.query("SELECT id FROM teacher_class_subject_assignments WHERE school_id=? AND teacher_id=? AND class_id=? AND subject_id=? AND is_active=1 LIMIT 1",[schoolId,actor.id,classId,subjectId])
    if(!assignment)throw new HttpError(403,'Classroom Mode can only open an assigned class and subject.')
    const [[academicSession]]=await connection.query("SELECT ay.id academic_year_id,t.id term_id FROM academic_years ay JOIN terms t ON t.academic_year_id=ay.id AND t.school_id=ay.school_id WHERE ay.school_id=? AND ay.status='active' AND t.status IN ('open','marking') ORDER BY t.start_date DESC LIMIT 1",[schoolId])
    if(!academicSession)throw new HttpError(409,'Open an academic term before starting Classroom Mode.')
    let timetableEntryId=numberOrNull(body.timetable_entry_id)
    if(!timetableEntryId){
      try{
        const [[scheduled]]=await connection.query(`SELECT e.id FROM timetables tt
          JOIN timetable_versions tv ON tv.id=tt.current_published_version_id AND tv.timetable_id=tt.id
          JOIN timetable_entries e ON e.timetable_version_id=tv.id
          LEFT JOIN timetable_cycle_days cd ON cd.id=e.cycle_day_id
          JOIN bell_schedule_slots ss ON ss.id=e.slot_start_id
          JOIN bell_schedule_slots se ON se.id=e.slot_end_id
          WHERE tt.school_id=? AND tt.timetable_type='SCHOOL_TIMETABLE' AND e.teacher_id=? AND e.class_id=? AND e.subject_id=?
            AND (e.calendar_date=? OR (e.calendar_date IS NULL AND cd.weekday=DAYOFWEEK(?)-1))
            AND CURTIME() BETWEEN ss.start_time AND se.end_time
          ORDER BY ss.start_time LIMIT 1`,[schoolId,actor.id,classId,subjectId,lessonDate,lessonDate])
        timetableEntryId=scheduled?.id||null
      }catch(error){if(!['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error?.code))throw error}
    }
    const [lesson]=await connection.query(`INSERT INTO teacher_lesson_logs (
      school_id,academic_year_id,term_id,teacher_id,class_id,subject_id,timetable_entry_id,lesson_date,started_at,status,
      main_topic_id,coverage_status,coverage_percentage,lesson_outcome,difficulty_observed
    ) VALUES (?,?,?,?,?,?,NULL,?,COALESCE(?,CURTIME()),'draft',?,'introduced',0,'not_assessed','none')`,
    [schoolId,academicSession.academic_year_id,academicSession.term_id,actor.id,classId,subjectId,lessonDate,body.started_at||null,topicId])
    const ref=randomUUID()
    await connection.query(`INSERT INTO classroom_sessions (
      public_ref,school_id,lesson_log_id,teacher_id,class_id,subject_id,timetable_entry_id,status,sync_token,offline_client_id,last_synced_at
    ) VALUES (?,?,?,?,?,?,?,'active',UUID(),?,CURRENT_TIMESTAMP)`,[ref,schoolId,lesson.insertId,actor.id,classId,subjectId,timetableEntryId,offlineId])
    if(topicId)await connection.query("INSERT IGNORE INTO teacher_lesson_log_topics (lesson_log_id,syllabus_topic_id,topic_role,coverage_percentage,difficulty_observed,drill_priority_override) VALUES (?,?,'main',0,'none','normal')",[lesson.insertId,topicId])
    await audit(connection,schoolId,actor,'CLASSROOM_SESSION_STARTED','teacher_lesson_log',lesson.insertId,null,{public_ref:ref,class_id:classId,subject_id:subjectId,timetable_entry_id:timetableEntryId})
    await connection.commit()
    return getClassroomSession(schoolId,ref,actor)
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function getClassroomSession(schoolId,ref,actor) {
  const [[session]]=await pool.query(`SELECT cs.id,cs.public_ref,cs.status,cs.sync_token,cs.timetable_entry_id,cs.teacher_id,cs.understanding_estimate,cs.understanding_confidence,cs.observation_note,cs.formal_check_used,cs.formative_activity_type,cs.formative_summary_json,cs.last_synced_at,cs.started_at,cs.completed_at,l.lesson_date,l.started_at lesson_started_at,l.ended_at,l.coverage_status,l.coverage_percentage,l.lesson_outcome,l.difficulty_observed,l.lesson_notes,l.misconceptions_observed,l.homework_assigned,l.next_lesson_action,c.public_ref class_ref,c.name class_name,s.public_ref subject_ref,s.name subject_name,t.public_ref topic_ref,t.topic_name,u.full_name teacher_name FROM classroom_sessions cs JOIN teacher_lesson_logs l ON l.id=cs.lesson_log_id AND l.school_id=cs.school_id JOIN classes c ON c.id=cs.class_id AND c.school_id=cs.school_id JOIN subjects s ON s.id=cs.subject_id AND s.school_id=cs.school_id LEFT JOIN syllabus_topics t ON t.id=l.main_topic_id AND t.school_id=l.school_id JOIN users u ON u.id=cs.teacher_id WHERE cs.school_id=? AND cs.public_ref=? LIMIT 1`,[schoolId,ref]);if(!session)throw new HttpError(404,'Classroom session was not found.');if(String(actor.role).toLowerCase()==='teacher'){const [[ownership]]=await pool.query("SELECT id FROM classroom_sessions WHERE school_id=? AND public_ref=? AND teacher_id=?",[schoolId,ref,actor.id]);if(!ownership)throw new HttpError(403,'Teachers can only access their own Classroom Mode sessions.')}
  const [attendance,objectives,resources,observations,followUps,recommended]=await Promise.all([
    pool.query(`SELECT s.public_ref student_ref,s.first_name,s.last_name,COALESCE(ar.status,'present') status,ar.note FROM classroom_sessions cs JOIN teacher_lesson_logs l ON l.id=cs.lesson_log_id JOIN student_enrollments se ON se.school_id=cs.school_id AND se.class_id=cs.class_id AND se.academic_year_id=l.academic_year_id AND se.term_id=l.term_id AND se.enrollment_status='active' JOIN students s ON s.id=se.student_id AND s.school_id=se.school_id LEFT JOIN attendance_records ar ON ar.school_id=s.school_id AND ar.student_id=s.id AND ar.attendance_date=l.lesson_date WHERE cs.school_id=? AND cs.public_ref=? ORDER BY s.last_name,s.first_name`,[schoolId,ref]),
    pool.query(`SELECT lo.public_ref,lo.objective_text,COALESCE(tllo.achievement_status,'not_assessed') achievement_status FROM classroom_sessions cs JOIN teacher_lesson_logs l ON l.id=cs.lesson_log_id JOIN learning_objectives lo ON lo.topic_id=l.main_topic_id AND lo.school_id=l.school_id LEFT JOIN teacher_lesson_log_objectives tllo ON tllo.lesson_log_id=l.id AND tllo.learning_objective_id=lo.id WHERE cs.school_id=? AND cs.public_ref=? AND lo.is_active=1 ORDER BY lo.curriculum_order,lo.id`,[schoolId,ref]),
    pool.query(`SELECT tr.public_ref,tr.title,tr.resource_type,v.public_ref version_ref,csr.usage_note FROM classroom_session_resources csr JOIN teaching_resources tr ON tr.id=csr.resource_id AND tr.school_id=csr.school_id LEFT JOIN teaching_resource_versions v ON v.id=csr.resource_version_id WHERE csr.school_id=? AND csr.classroom_session_id=?`,[schoolId,session.id]),
    pool.query("SELECT public_ref,observation_code,note,created_at FROM classroom_observations WHERE school_id=? AND classroom_session_id=? ORDER BY created_at",[schoolId,session.id]),
    pool.query("SELECT public_ref,action_type,description,due_date,status FROM classroom_follow_up_actions WHERE school_id=? AND classroom_session_id=? ORDER BY created_at",[schoolId,session.id]),
    pool.query(`SELECT tr.public_ref,tr.title,tr.resource_type,tr.description,subj.name subject_name,t.topic_name,v.public_ref version_ref FROM classroom_sessions cs JOIN teacher_lesson_logs l ON l.id=cs.lesson_log_id JOIN teaching_resources tr ON tr.school_id=cs.school_id AND tr.approval_status='APPROVED' AND tr.subject_id=cs.subject_id AND (tr.class_id=cs.class_id OR tr.class_id IS NULL) AND (tr.topic_id=l.main_topic_id OR tr.topic_id IS NULL) LEFT JOIN subjects subj ON subj.id=tr.subject_id AND subj.school_id=tr.school_id LEFT JOIN syllabus_topics t ON t.id=tr.topic_id AND t.school_id=tr.school_id LEFT JOIN teaching_resource_versions v ON v.id=tr.current_version_id WHERE cs.school_id=? AND cs.public_ref=? ORDER BY (tr.topic_id=l.main_topic_id) DESC,tr.usage_count DESC LIMIT 12`,[schoolId,ref]),
  ]);
  let periods=[]
  try {
    ;[periods]=await pool.query(`SELECT e.id timetable_entry_id,e.title,ss.start_time,se.end_time,
      subj.name subject_name,c.name class_name,e.entry_type
      FROM timetables tt
      JOIN timetable_versions tv ON tv.id=tt.current_published_version_id AND tv.timetable_id=tt.id
      JOIN timetable_entries e ON e.timetable_version_id=tv.id AND e.teacher_id=?
      LEFT JOIN timetable_cycle_days cd ON cd.id=e.cycle_day_id
      JOIN bell_schedule_slots ss ON ss.id=e.slot_start_id
      JOIN bell_schedule_slots se ON se.id=e.slot_end_id
      LEFT JOIN subjects subj ON subj.id=e.subject_id
      LEFT JOIN classes c ON c.id=e.class_id
      WHERE tt.school_id=? AND tt.timetable_type='SCHOOL_TIMETABLE'
        AND (e.calendar_date=? OR (e.calendar_date IS NULL AND cd.weekday=DAYOFWEEK(?)-1))
      ORDER BY ss.start_time`,[session.teacher_id,schoolId,session.lesson_date,session.lesson_date])
  } catch(error) { if(!['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error?.code)) throw error }
  const now=schoolClock()
  const currentIndex=periods.findIndex((period)=>Number(period.timetable_entry_id)===Number(session.timetable_entry_id)||(String(period.start_time)<=now&&String(period.end_time)>now))
  const futureIndex=periods.findIndex((period)=>String(period.start_time)>now)
  const currentPeriod=currentIndex>=0?periods[currentIndex]:null
  const nextPeriod=currentIndex>=0?(periods[currentIndex+1]||null):(futureIndex>=0?periods[futureIndex]:null)
  delete session.id;delete session.teacher_id;session.formative_summary=jsonValue(session.formative_summary_json,{});delete session.formative_summary_json
  session.scheduled_start_time=currentPeriod?.start_time||session.lesson_started_at||null
  session.scheduled_end_time=currentPeriod?.end_time||null
  return {session,schedule:{server_time:now,current_period:currentPeriod,next_period:nextPeriod},attendance:attendance[0],objectives:objectives[0],resources:resources[0],observations:observations[0],follow_ups:followUps[0],recommended_resources:recommended[0]}
}

export async function saveClassroomSession(schoolId,ref,actor,body={}) {
  const connection=await pool.getConnection();try{await connection.beginTransaction();const [[session]]=await connection.query("SELECT cs.*,l.main_topic_id FROM classroom_sessions cs JOIN teacher_lesson_logs l ON l.id=cs.lesson_log_id AND l.school_id=cs.school_id WHERE cs.school_id=? AND cs.public_ref=? LIMIT 1 FOR UPDATE",[schoolId,ref]);if(!session)throw new HttpError(404,'Classroom session was not found.');if(String(actor.role).toLowerCase()==='teacher'&&Number(session.teacher_id)!==Number(actor.id))throw new HttpError(403,'Teachers can only edit their own Classroom Mode sessions.');if(session.status==='completed')throw new HttpError(409,'Completed lessons are read-only.');const estimate=body.understanding_estimate||session.understanding_estimate;if(!['STRONG','SATISFACTORY','MIXED','WEAK','NOT_ASSESSED'].includes(estimate))throw new HttpError(400,'Understanding estimate is invalid.');await connection.query(`UPDATE classroom_sessions SET understanding_estimate=?,understanding_confidence=?,observation_note=?,formal_check_used=?,formative_activity_type=?,formative_summary_json=?,last_synced_at=CURRENT_TIMESTAMP,sync_token=UUID() WHERE id=? AND school_id=?`,[estimate,body.understanding_confidence||session.understanding_confidence,body.observation_note??session.observation_note,body.formal_check_used===undefined?session.formal_check_used:(body.formal_check_used?1:0),body.formative_activity_type||session.formative_activity_type,body.formative_summary?JSON.stringify(body.formative_summary):session.formative_summary_json,session.id,schoolId]);const topicId=numberOrNull(body.topic_id)||session.main_topic_id;await connection.query(`UPDATE teacher_lesson_logs SET main_topic_id=?,coverage_status=COALESCE(?,coverage_status),coverage_percentage=COALESCE(?,coverage_percentage),lesson_outcome=?,difficulty_observed=COALESCE(?,difficulty_observed),lesson_notes=COALESCE(?,lesson_notes),misconceptions_observed=COALESCE(?,misconceptions_observed),homework_assigned=COALESCE(?,homework_assigned),next_lesson_action=COALESCE(?,next_lesson_action) WHERE id=? AND school_id=?`,[topicId,body.coverage_status||null,body.coverage_percentage??null,estimate==='STRONG'?'students_understood':estimate==='WEAK'?'students_struggled':estimate==='NOT_ASSESSED'?'not_assessed':'mixed_understanding',body.difficulty_observed||null,body.lesson_notes||null,body.misconceptions_observed||null,body.homework_assigned||null,body.next_lesson_action||null,session.lesson_log_id,schoolId]);if(topicId){await connection.query("DELETE FROM teacher_lesson_log_topics WHERE lesson_log_id=? AND topic_role='main'",[session.lesson_log_id]);await connection.query("INSERT INTO teacher_lesson_log_topics (lesson_log_id,syllabus_topic_id,topic_role,coverage_percentage,difficulty_observed,drill_priority_override) VALUES (?,?,'main',?,?,?)",[session.lesson_log_id,topicId,body.coverage_percentage??0,body.difficulty_observed||'none',estimate==='WEAK'?'high':'normal'])}if(Array.isArray(body.objectives)){for(const item of body.objectives){const [[objective]]=await connection.query("SELECT id FROM learning_objectives WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,item.objective_ref]);if(objective)await connection.query("INSERT INTO teacher_lesson_log_objectives (lesson_log_id,learning_objective_id,achievement_status) VALUES (?,?,?) ON DUPLICATE KEY UPDATE achievement_status=VALUES(achievement_status)",[session.lesson_log_id,objective.id,item.achievement_status||'not_assessed'])}}if(Array.isArray(body.observations)){for(const item of body.observations){if(!clean(item.code,80))continue;await connection.query("INSERT INTO classroom_observations (public_ref,school_id,classroom_session_id,observation_code,note,created_by) VALUES (UUID(),?,?,?,?,?)",[schoolId,session.id,clean(item.code,80),clean(item.note,2000)||null,actor.id])}}await audit(connection,schoolId,actor,'CLASSROOM_SESSION_SAVED','classroom_session',session.id,null,{estimate,offline_retry:Boolean(body.offline_retry)});await connection.commit();return getClassroomSession(schoolId,ref,actor)}catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function saveClassroomAttendance(schoolId,ref,actor,body={}) {
  const [[session]]=await pool.query("SELECT cs.id,cs.teacher_id,cs.class_id,l.lesson_date FROM classroom_sessions cs JOIN teacher_lesson_logs l ON l.id=cs.lesson_log_id AND l.school_id=cs.school_id WHERE cs.school_id=? AND cs.public_ref=? LIMIT 1",[schoolId,ref]);if(!session)throw new HttpError(404,'Classroom session was not found.');if(String(actor.role).toLowerCase()==='teacher'&&Number(session.teacher_id)!==Number(actor.id))throw new HttpError(403,'Teachers can only mark attendance for their lessons.');const records=Array.isArray(body.records)?body.records:[];const connection=await pool.getConnection();try{await connection.beginTransaction();for(const record of records){const [[student]]=await connection.query(`SELECT s.id FROM students s JOIN student_enrollments se ON se.student_id=s.id AND se.school_id=s.school_id WHERE s.school_id=? AND s.public_ref=? AND se.class_id=? AND se.enrollment_status='active' LIMIT 1`,[schoolId,record.student_ref,session.class_id]);if(!student)throw new HttpError(400,'One attendance record does not belong to this class.');const status=['present','absent','late','sick','excused','left_early'].includes(record.status)?record.status:'present';await connection.query(`INSERT INTO attendance_records (school_id,class_id,student_id,attendance_date,status,note,marked_by) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status),note=VALUES(note),marked_by=VALUES(marked_by)`,[schoolId,session.class_id,student.id,session.lesson_date,status,clean(record.note,255)||null,actor.id])}await audit(connection,schoolId,actor,'CLASSROOM_ATTENDANCE_SUBMITTED','classroom_session',session.id,null,{records:records.length});await connection.commit();return {saved:records.length}}catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function attachClassroomResource(schoolId,ref,actor,body={}) {
  const [[session]]=await pool.query("SELECT id,lesson_log_id,class_id,teacher_id FROM classroom_sessions WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,ref]);if(!session)throw new HttpError(404,'Classroom session was not found.');if(String(actor.role).toLowerCase()==='teacher'&&Number(session.teacher_id)!==Number(actor.id))throw new HttpError(403,'Teachers can only update their Classroom Mode sessions.');const resource=await resourceByRef(pool,schoolId,body.resource_ref);if(resource.approval_status!=='APPROVED')throw new HttpError(409,'Only approved teaching resources can be attached to a lesson.');await pool.query("INSERT INTO classroom_session_resources (public_ref,school_id,classroom_session_id,resource_id,resource_version_id,usage_note) VALUES (UUID(),?,?,?,?,?) ON DUPLICATE KEY UPDATE resource_version_id=VALUES(resource_version_id),usage_note=VALUES(usage_note)",[schoolId,session.id,resource.id,resource.current_version_id,clean(body.usage_note,2000)||null]);await pool.query("INSERT INTO teaching_resource_usage (public_ref,school_id,resource_id,version_id,user_id,class_id,lesson_log_id,usage_type) VALUES (UUID(),?,?,?,?,?,?,'lesson_attachment')",[schoolId,resource.id,resource.current_version_id,actor.id,session.class_id,session.lesson_log_id]);await pool.query("UPDATE teaching_resources SET usage_count=usage_count+1,last_used_at=CURRENT_TIMESTAMP WHERE school_id=? AND id=?",[schoolId,resource.id]);return getClassroomSession(schoolId,ref,actor)
}

export async function closeClassroomSession(schoolId,ref,actor,body={}) {
  await saveClassroomSession(schoolId,ref,actor,body);const connection=await pool.getConnection();let lessonId=null;try{await connection.beginTransaction();const [[session]]=await connection.query("SELECT * FROM classroom_sessions WHERE school_id=? AND public_ref=? LIMIT 1 FOR UPDATE",[schoolId,ref]);if(!session)throw new HttpError(404,'Classroom session was not found.');if(session.status==='completed'){await connection.commit();return getClassroomSession(schoolId,ref,actor)}lessonId=session.lesson_log_id;await connection.query("UPDATE classroom_sessions SET status='completed',completed_at=CURRENT_TIMESTAMP,last_synced_at=CURRENT_TIMESTAMP WHERE id=? AND school_id=?",[session.id,schoolId]);await connection.query("UPDATE teacher_lesson_logs SET status='finalized',ended_at=COALESCE(?,CURTIME()),finalized_at=CURRENT_TIMESTAMP,finalized_by=? WHERE id=? AND school_id=?",[body.ended_at||null,actor.id,lessonId,schoolId]);if(body.follow_up_required&&clean(body.follow_up_description,2000)){await connection.query("INSERT INTO classroom_follow_up_actions (public_ref,school_id,classroom_session_id,action_type,description,due_date,created_by) VALUES (UUID(),?,?,?,?,?,?)",[schoolId,session.id,body.follow_up_type||'revision',clean(body.follow_up_description,2000),body.follow_up_due_date||null,actor.id])}if(['WEAK','MIXED'].includes(session.understanding_estimate)){const [[lesson]]=await connection.query("SELECT l.main_topic_id,t.topic_name,s.name subject_name,c.name class_name FROM teacher_lesson_logs l LEFT JOIN syllabus_topics t ON t.id=l.main_topic_id AND t.school_id=l.school_id JOIN subjects s ON s.id=l.subject_id AND s.school_id=l.school_id JOIN classes c ON c.id=l.class_id AND c.school_id=l.school_id WHERE l.school_id=? AND l.id=?",[schoolId,lessonId]);await connection.query(`INSERT INTO academic_recommendations (public_ref,school_id,recommendation_type,audience_role,assigned_user_id,class_id,subject_id,topic_id,title,reason,evidence_json,suggested_action,priority,confidence_score,rule_key,dedupe_window,created_by) VALUES (UUID(),?,'lesson_revision','teacher',?,?,?,?,?,?,?,?,?,?,?,'classroom_understanding',DATE_FORMAT(CURDATE(),'%Y-%m-%d'),?) ON DUPLICATE KEY UPDATE reason=VALUES(reason),evidence_json=VALUES(evidence_json),suggested_action=VALUES(suggested_action),priority=VALUES(priority),status='NEW',updated_at=CURRENT_TIMESTAMP`,[schoolId,session.teacher_id,session.class_id,session.subject_id,lesson?.main_topic_id||null,`Review ${lesson?.topic_name||'today’s lesson'}`,`${lesson?.class_name||'The class'} showed ${session.understanding_estimate.toLowerCase()} understanding. This is an observational signal and should be checked with assessment evidence.`,JSON.stringify({source:'classroom_observation',estimate:session.understanding_estimate,formal_check_used:Boolean(session.formal_check_used)}),`Use a short paper-based check before advancing in ${lesson?.subject_name||'this subject'}.`,session.understanding_estimate==='WEAK'?'high':'medium',session.formal_check_used?55:30,actor.id])}await audit(connection,schoolId,actor,'CLASSROOM_SESSION_COMPLETED','classroom_session',session.id,{status:session.status},{status:'completed',lesson_log_id:lessonId});await connection.commit()}catch(error){await connection.rollback();throw error}finally{connection.release()}const curriculum=await syncCurriculumFromLesson(schoolId,lessonId,actor);return {...await getClassroomSession(schoolId,ref,actor),curriculum_update:curriculum}
}

export async function listClassroomHistory(schoolId,actor,query={}) {
  const params=[schoolId];const where=['cs.school_id=?'];if(String(actor.role).toLowerCase()==='teacher'){where.push('cs.teacher_id=?');params.push(actor.id)}if(query.class_ref){where.push('c.public_ref=?');params.push(query.class_ref)}if(query.subject_id){where.push('cs.subject_id=?');params.push(Number(query.subject_id))}if(query.status){where.push('cs.status=?');params.push(query.status)}const [rows]=await pool.query(`SELECT cs.public_ref,cs.status,cs.understanding_estimate,cs.formative_activity_type,cs.started_at,cs.completed_at,l.lesson_date,l.coverage_status,l.coverage_percentage,l.lesson_outcome,c.public_ref class_ref,c.name class_name,s.name subject_name,t.topic_name,u.full_name teacher_name FROM classroom_sessions cs JOIN teacher_lesson_logs l ON l.id=cs.lesson_log_id AND l.school_id=cs.school_id JOIN classes c ON c.id=cs.class_id AND c.school_id=cs.school_id JOIN subjects s ON s.id=cs.subject_id AND s.school_id=cs.school_id LEFT JOIN syllabus_topics t ON t.id=l.main_topic_id AND t.school_id=l.school_id JOIN users u ON u.id=cs.teacher_id WHERE ${where.join(' AND ')} ORDER BY l.lesson_date DESC,cs.started_at DESC LIMIT 100`,params);return {sessions:rows}
}
