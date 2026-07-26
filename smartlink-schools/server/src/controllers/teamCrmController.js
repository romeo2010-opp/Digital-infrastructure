import { pool } from "../config/db.js"
import { safeTeamRequestMetadata } from "../middleware/teamAuth.js"
import {
  TEAM_PERMISSIONS,
  assertTeamSchoolAccess,
  hasTeamPermission,
  resolveTeamSchool,
} from "../services/teamAccessService.js"
import {
  LATE_STAGE_START_INDEX,
  OPPORTUNITY_STAGES,
  createTeamNotification,
  enumValue,
  nullableDate,
  numberInRange,
  optionalText,
  paginationFrom,
  paginationMeta,
  requiredText,
  safeLike,
  validateCriticalStageInput,
  validateOpportunityStage,
  writeTeamAudit,
} from "../services/teamSuiteService.js"
import { HttpError } from "../utils/http.js"

const SCHOOL_TYPES = ["preschool", "primary", "secondary", "combined", "college", "other"]
const SCHOOL_STATUSES = ["prospect", "qualified_prospect", "active_opportunity", "customer", "former_customer", "disqualified", "competitor_managed", "follow_up_later", "do_not_contact"]
const PRIORITIES = ["low", "medium", "high", "critical"]
const URGENCIES = ["low", "medium", "high", "urgent"]
const ACTIVITY_TYPES = ["whatsapp_sent", "whatsapp_reply", "phone_call", "email_sent", "email_received", "school_visit", "meeting", "demo", "proposal_sent", "follow_up", "internal_note", "document_uploaded", "stage_changed", "task_completed", "payment_recorded", "support_created"]
const CONTACT_CLASSIFICATIONS = ["decision_maker", "champion", "influencer", "blocker", "end_user", "technical_contact", "finance_contact", "unknown"]

function value(body, snake, camel = snake) {
  return body?.[snake] ?? body?.[camel]
}

function booleanFlag(input) {
  return input === true || input === 1 || ["true", "1", "yes", "on"].includes(String(input || "").toLowerCase()) ? 1 : 0
}

function schoolScope(user, alias = "school") {
  if (hasTeamPermission(user, TEAM_PERMISSIONS.SCHOOLS_VIEW_ALL)) return { sql: "1=1", params: [] }
  return {
    sql: `(
      ${alias}.assigned_user_id=?
      OR EXISTS (SELECT 1 FROM team_sales_opportunities scoped_opportunity WHERE scoped_opportunity.school_id=${alias}.id AND scoped_opportunity.archived_at IS NULL AND (scoped_opportunity.assigned_owner_id=? OR scoped_opportunity.implementation_owner_id=?))
      OR EXISTS (SELECT 1 FROM team_onboarding_projects scoped_onboarding WHERE scoped_onboarding.school_id=${alias}.id AND scoped_onboarding.implementation_owner_id=?)
      OR EXISTS (SELECT 1 FROM team_support_tickets scoped_ticket WHERE scoped_ticket.school_id=${alias}.id AND scoped_ticket.assigned_user_id=?)
    )`,
    params: [user.id, user.id, user.id, user.id, user.id],
  }
}

function schoolPayload(body, { partial = false } = {}) {
  const payload = {
    name: partial && value(body, "name") === undefined ? undefined : requiredText(value(body, "name"), "School name", 220),
    school_type: value(body, "school_type", "schoolType") === undefined && partial ? undefined : enumValue(value(body, "school_type", "schoolType"), SCHOOL_TYPES, "School type", "other"),
    status: value(body, "status") === undefined && partial ? undefined : enumValue(value(body, "status"), SCHOOL_STATUSES, "School status", "prospect"),
    location: value(body, "location") === undefined && partial ? undefined : optionalText(value(body, "location"), 180),
    district: value(body, "district") === undefined && partial ? undefined : optionalText(value(body, "district"), 120),
    physical_address: value(body, "physical_address", "physicalAddress") === undefined && partial ? undefined : optionalText(value(body, "physical_address", "physicalAddress"), 500),
    website: value(body, "website") === undefined && partial ? undefined : optionalText(value(body, "website"), 500),
    social_page: value(body, "social_page", "socialPage") === undefined && partial ? undefined : optionalText(value(body, "social_page", "socialPage"), 500),
    main_phone: value(body, "main_phone", "mainPhone") === undefined && partial ? undefined : optionalText(value(body, "main_phone", "mainPhone"), 50),
    whatsapp_number: value(body, "whatsapp_number", "whatsappNumber") === undefined && partial ? undefined : optionalText(value(body, "whatsapp_number", "whatsappNumber"), 50),
    email: value(body, "email") === undefined && partial ? undefined : optionalText(value(body, "email"), 190)?.toLowerCase() || null,
    estimated_enrolment: value(body, "estimated_enrolment", "estimatedEnrolment") === undefined && partial ? undefined : numberInRange(value(body, "estimated_enrolment", "estimatedEnrolment"), "Estimated enrolment", 0, 1000000),
    estimated_fee_min: value(body, "estimated_fee_min", "estimatedFeeMin") === undefined && partial ? undefined : numberInRange(value(body, "estimated_fee_min", "estimatedFeeMin"), "Minimum estimated fee", 0, 999999999999),
    estimated_fee_max: value(body, "estimated_fee_max", "estimatedFeeMax") === undefined && partial ? undefined : numberInRange(value(body, "estimated_fee_max", "estimatedFeeMax"), "Maximum estimated fee", 0, 999999999999),
    campus_count: value(body, "campus_count", "campusCount") === undefined && partial ? undefined : numberInRange(value(body, "campus_count", "campusCount"), "Campus count", 1, 1000, 1),
    curriculum: value(body, "curriculum") === undefined && partial ? undefined : optionalText(value(body, "curriculum"), 160),
    attendance_mode: value(body, "attendance_mode", "attendanceMode") === undefined && partial ? undefined : enumValue(value(body, "attendance_mode", "attendanceMode"), ["boarding", "day", "mixed", "unknown"], "Boarding or day status", "unknown"),
    has_website: value(body, "has_website", "hasWebsite") === undefined && partial ? undefined : booleanFlag(value(body, "has_website", "hasWebsite")),
    has_portal: value(body, "has_portal", "hasPortal") === undefined && partial ? undefined : booleanFlag(value(body, "has_portal", "hasPortal")),
    has_management_system: value(body, "has_management_system", "hasManagementSystem") === undefined && partial ? undefined : booleanFlag(value(body, "has_management_system", "hasManagementSystem")),
    current_software_provider: value(body, "current_software_provider", "currentSoftwareProvider") === undefined && partial ? undefined : optionalText(value(body, "current_software_provider", "currentSoftwareProvider"), 180),
    uses_spreadsheets: value(body, "uses_spreadsheets", "usesSpreadsheets") === undefined && partial ? undefined : booleanFlag(value(body, "uses_spreadsheets", "usesSpreadsheets")),
    uses_paper_records: value(body, "uses_paper_records", "usesPaperRecords") === undefined && partial ? undefined : booleanFlag(value(body, "uses_paper_records", "usesPaperRecords")),
    internet_reliability: value(body, "internet_reliability", "internetReliability") === undefined && partial ? undefined : enumValue(value(body, "internet_reliability", "internetReliability"), ["unknown", "poor", "fair", "good", "excellent"], "Internet reliability", "unknown"),
    computer_availability: value(body, "computer_availability", "computerAvailability") === undefined && partial ? undefined : enumValue(value(body, "computer_availability", "computerAvailability"), ["unknown", "none", "limited", "adequate", "strong"], "Computer availability", "unknown"),
    teachers_with_laptops: value(body, "teachers_with_laptops", "teachersWithLaptops") === undefined && partial ? undefined : numberInRange(value(body, "teachers_with_laptops", "teachersWithLaptops"), "Teachers with laptops", 0, 1000000),
    library_computers: value(body, "library_computers", "libraryComputers") === undefined && partial ? undefined : numberInRange(value(body, "library_computers", "libraryComputers"), "Library computers", 0, 1000000),
    existing_system_renewal_date: value(body, "existing_system_renewal_date", "existingSystemRenewalDate") === undefined && partial ? undefined : nullableDate(value(body, "existing_system_renewal_date", "existingSystemRenewalDate"), "Existing system renewal date"),
    technology_limitations: value(body, "technology_limitations", "technologyLimitations") === undefined && partial ? undefined : optionalText(value(body, "technology_limitations", "technologyLimitations"), 10000),
    ability_to_pay_score: value(body, "ability_to_pay_score", "abilityToPayScore") === undefined && partial ? undefined : numberInRange(value(body, "ability_to_pay_score", "abilityToPayScore"), "Ability-to-pay score", 0, 100),
    operational_pain_score: value(body, "operational_pain_score", "operationalPainScore") === undefined && partial ? undefined : numberInRange(value(body, "operational_pain_score", "operationalPainScore"), "Operational-pain score", 0, 100),
    digital_readiness_score: value(body, "digital_readiness_score", "digitalReadinessScore") === undefined && partial ? undefined : numberInRange(value(body, "digital_readiness_score", "digitalReadinessScore"), "Digital-readiness score", 0, 100),
    decision_maker_access: value(body, "decision_maker_access", "decisionMakerAccess") === undefined && partial ? undefined : enumValue(value(body, "decision_maker_access", "decisionMakerAccess"), ["unknown", "none", "indirect", "direct"], "Decision-maker access", "unknown"),
    estimated_deal_value: value(body, "estimated_deal_value", "estimatedDealValue") === undefined && partial ? undefined : numberInRange(value(body, "estimated_deal_value", "estimatedDealValue"), "Estimated deal value", 0, 999999999999),
    conversion_probability: value(body, "conversion_probability", "conversionProbability") === undefined && partial ? undefined : numberInRange(value(body, "conversion_probability", "conversionProbability"), "Conversion probability", 0, 100),
    priority: value(body, "priority") === undefined && partial ? undefined : enumValue(value(body, "priority"), PRIORITIES, "Priority", "medium"),
    urgency: value(body, "urgency") === undefined && partial ? undefined : enumValue(value(body, "urgency"), URGENCIES, "Urgency", "medium"),
    lead_source: value(body, "lead_source", "leadSource") === undefined && partial ? undefined : optionalText(value(body, "lead_source", "leadSource"), 160),
    next_action: value(body, "next_action", "nextAction") === undefined && partial ? undefined : optionalText(value(body, "next_action", "nextAction"), 500),
    next_action_at: value(body, "next_action_at", "nextActionAt") === undefined && partial ? undefined : nullableDate(value(body, "next_action_at", "nextActionAt"), "Next-action date"),
    competitor: value(body, "competitor") === undefined && partial ? undefined : optionalText(value(body, "competitor"), 180),
    main_objection: value(body, "main_objection", "mainObjection") === undefined && partial ? undefined : optionalText(value(body, "main_objection", "mainObjection"), 500),
    notes: value(body, "notes") === undefined && partial ? undefined : optionalText(value(body, "notes"), 10000),
  }
  if (payload.estimated_fee_min != null && payload.estimated_fee_max != null && payload.estimated_fee_max < payload.estimated_fee_min) {
    throw new HttpError(400, "Maximum estimated fee cannot be lower than the minimum estimated fee", { code: "TEAM_VALIDATION_ERROR" })
  }
  if (payload.email !== undefined) payload.email_domain = payload.email?.includes("@") ? payload.email.split("@").pop() : null
  return payload
}

async function resolveTeamUserId(connection, publicRef, label, { required = false } = {}) {
  const ref = String(publicRef || "").trim()
  if (!ref && !required) return null
  if (!ref) throw new HttpError(400, `${label} is required`, { code: "TEAM_VALIDATION_ERROR" })
  const [[user]] = await connection.query("SELECT id FROM team_users WHERE public_ref=? AND is_active=1 LIMIT 1", [ref])
  if (!user) throw new HttpError(400, `${label} is invalid`, { code: "TEAM_VALIDATION_ERROR" })
  return Number(user.id)
}

export async function listTeamSchools(req, res) {
  const pagination = paginationFrom(req.query)
  const scope = schoolScope(req.teamUser)
  const clauses = ["school.archived_at IS NULL", scope.sql]
  const params = [...scope.params]
  const search = safeLike(req.query.search || req.query.q)
  if (search) {
    clauses.push("(school.name LIKE ? ESCAPE '\\\\' OR school.district LIKE ? ESCAPE '\\\\' OR school.main_phone LIKE ? ESCAPE '\\\\' OR school.email LIKE ? ESCAPE '\\\\')")
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
  }
  if (req.query.status) { clauses.push("school.status=?"); params.push(enumValue(req.query.status, SCHOOL_STATUSES, "School status")) }
  if (req.query.priority) { clauses.push("school.priority=?"); params.push(enumValue(req.query.priority, PRIORITIES, "Priority")) }
  if (req.query.district) { clauses.push("school.district=?"); params.push(String(req.query.district).slice(0, 120)) }
  if (String(req.query.no_next_action || "") === "true") clauses.push("(school.next_action_at IS NULL OR school.next_action IS NULL)")
  const where = clauses.join(" AND ")
  const [[count], [rows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) total FROM team_school_prospects school WHERE ${where}`, params),
    pool.query(
      `SELECT school.public_ref,school.name,school.school_type,school.status,school.location,school.district,
              school.main_phone,school.whatsapp_number,school.email,school.estimated_enrolment,
              school.estimated_deal_value,school.priority,school.pipeline_stage,school.next_action,
              school.next_action_at,school.updated_at,owner.public_ref assigned_user_ref,owner.full_name assigned_user_name,
              (SELECT MAX(activity.occurred_at) FROM team_school_activities activity WHERE activity.school_id=school.id) last_activity_at
       FROM team_school_prospects school
       LEFT JOIN team_users owner ON owner.id=school.assigned_user_id
       WHERE ${where}
       ORDER BY FIELD(school.priority,'critical','high','medium','low'),COALESCE(school.next_action_at,'9999-12-31'),school.name
       LIMIT ? OFFSET ?`,
      [...params, pagination.pageSize, pagination.offset],
    ),
  ])
  res.json({ items: rows, pagination: paginationMeta(count.total, pagination) })
}

export async function findTeamSchoolDuplicates(req, res) {
  const name = safeLike(req.query.name)
  const phone = safeLike(req.query.phone)
  const whatsapp = safeLike(req.query.whatsapp)
  const domain = safeLike(req.query.email_domain || req.query.emailDomain)
  if (!name && !phone && !whatsapp && !domain) return res.json({ items: [] })
  const clauses = []
  const params = []
  if (name) { clauses.push("school.name LIKE ? ESCAPE '\\\\'"); params.push(`%${name}%`) }
  if (phone) { clauses.push("school.main_phone=?"); params.push(phone) }
  if (whatsapp) { clauses.push("school.whatsapp_number=?"); params.push(whatsapp) }
  if (domain) { clauses.push("school.email_domain=?"); params.push(domain.toLowerCase()) }
  const scope = schoolScope(req.teamUser)
  const [rows] = await pool.query(
    `SELECT school.public_ref,school.name,school.location,school.status,school.pipeline_stage,
            school.next_action,school.next_action_at,owner.full_name assigned_user_name,
            (SELECT MAX(activity.occurred_at) FROM team_school_activities activity WHERE activity.school_id=school.id) last_contact_at
     FROM team_school_prospects school
     LEFT JOIN team_users owner ON owner.id=school.assigned_user_id
     WHERE school.archived_at IS NULL AND (${clauses.join(" OR ")}) AND ${scope.sql}
     ORDER BY school.updated_at DESC LIMIT 10`,
    [...params, ...scope.params],
  )
  res.json({ items: rows })
}

export async function createTeamSchool(req, res) {
  const payload = schoolPayload(req.body)
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    let assignedUserId = req.teamUser.id
    if (value(req.body, "assigned_user_ref", "assignedUserRef")) {
      if (!hasTeamPermission(req.teamUser, TEAM_PERMISSIONS.SCHOOLS_ASSIGN)) throw new HttpError(403, "You cannot assign this school to another team member")
      assignedUserId = await resolveTeamUserId(connection, value(req.body, "assigned_user_ref", "assignedUserRef"), "Assigned team member", { required: true })
    }
    const insertPayload = {
      ...payload,
      assigned_user_id: assignedUserId,
      pipeline_stage: "discovered",
      created_by: req.teamUser.id,
      updated_by: req.teamUser.id,
    }
    const columns = Object.keys(insertPayload).filter((column) => insertPayload[column] !== undefined)
    const [result] = await connection.query(
      `INSERT INTO team_school_prospects (public_ref,${columns.join(",")}) VALUES (UUID(),${columns.map(() => "?").join(",")})`,
      columns.map((column) => insertPayload[column]),
    )
    const [[school]] = await connection.query("SELECT * FROM team_school_prospects WHERE id=?", [result.insertId])
    await writeTeamAudit(connection, { actorUserId: req.teamUser.id, action: "SCHOOL_CREATED", entityType: "school", entityId: school.id, entityRef: school.public_ref, schoolId: school.id, afterValue: school, ...safeTeamRequestMetadata(req) })
    if (assignedUserId !== req.teamUser.id) {
      await createTeamNotification(connection, { recipientUserId: assignedUserId, type: "school_assigned", title: "School assigned to you", message: `${school.name} is now in your school queue.`, entityType: "school", entityRef: school.public_ref, actionPath: `/team/schools/${school.public_ref}` })
    }
    await connection.commit()
    res.status(201).json({ school })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally { connection.release() }
}

export async function getTeamSchool(req, res) {
  const connection = await pool.getConnection()
  try {
    const school = await resolveTeamSchool(connection, req.params.schoolRef)
    await assertTeamSchoolAccess(connection, req.teamUser, school.id)
    const [[contacts], [activities], [opportunities], [tasks], [meetings], [proposals], [onboarding], [subscriptions], [tickets], [audit]] = await Promise.all([
      connection.query(`SELECT contact.*,GROUP_CONCAT(classification.classification ORDER BY classification.classification) classifications FROM team_school_contacts contact LEFT JOIN team_contact_classifications classification ON classification.contact_id=contact.id WHERE contact.school_id=? GROUP BY contact.id ORDER BY contact.is_active DESC,contact.full_name`, [school.id]),
      connection.query(`SELECT activity.*,contact.full_name contact_name,user.full_name team_user_name FROM team_school_activities activity LEFT JOIN team_school_contacts contact ON contact.id=activity.contact_id JOIN team_users user ON user.id=activity.team_user_id WHERE activity.school_id=? ORDER BY activity.occurred_at DESC LIMIT 100`, [school.id]),
      connection.query(`SELECT opportunity.*,owner.full_name owner_name FROM team_sales_opportunities opportunity JOIN team_users owner ON owner.id=opportunity.assigned_owner_id WHERE opportunity.school_id=? AND opportunity.archived_at IS NULL ORDER BY opportunity.updated_at DESC`, [school.id]),
      connection.query(`SELECT task.*,assignee.full_name assigned_user_name FROM team_tasks task JOIN team_users assignee ON assignee.id=task.assigned_user_id WHERE task.school_id=? AND task.archived_at IS NULL ORDER BY (task.status NOT IN ('completed','cancelled')) DESC,task.due_at`, [school.id]),
      connection.query(`SELECT meeting.*,organiser.full_name organiser_name FROM team_meetings meeting JOIN team_users organiser ON organiser.id=meeting.organised_by WHERE meeting.school_id=? ORDER BY meeting.scheduled_at DESC`, [school.id]),
      connection.query(`SELECT proposal.*,preparer.full_name prepared_by_name,approver.full_name approved_by_name FROM team_proposals proposal JOIN team_users preparer ON preparer.id=proposal.prepared_by LEFT JOIN team_users approver ON approver.id=proposal.approved_by WHERE proposal.school_id=? ORDER BY proposal.created_at DESC`, [school.id]),
      connection.query(`SELECT project.*,owner.full_name implementation_owner_name FROM team_onboarding_projects project JOIN team_users owner ON owner.id=project.implementation_owner_id WHERE project.school_id=? ORDER BY project.created_at DESC`, [school.id]),
      connection.query(`SELECT subscription.*,owner.full_name renewal_owner_name FROM team_subscriptions subscription JOIN team_users owner ON owner.id=subscription.renewal_owner_id WHERE subscription.school_id=? ORDER BY subscription.expires_on DESC`, [school.id]),
      connection.query(`SELECT ticket.*,assignee.full_name assigned_user_name FROM team_support_tickets ticket JOIN team_users assignee ON assignee.id=ticket.assigned_user_id WHERE ticket.school_id=? ORDER BY FIELD(ticket.severity,'critical','high','medium','low'),ticket.updated_at DESC`, [school.id]),
      hasTeamPermission(req.teamUser, TEAM_PERMISSIONS.AUDIT_VIEW) ? connection.query(`SELECT audit.public_ref,audit.action,audit.entity_type,audit.reason,audit.created_at,user.full_name actor_name FROM team_audit_logs audit LEFT JOIN team_users user ON user.id=audit.actor_user_id WHERE audit.school_id=? ORDER BY audit.created_at DESC LIMIT 100`, [school.id]) : Promise.resolve([[]]),
    ])
    res.json({ school, contacts, activities, opportunities, tasks, meetings, proposals, onboarding, subscriptions, support_tickets: tickets, audit_history: audit })
  } finally { connection.release() }
}

export async function updateTeamSchool(req, res) {
  const payload = schoolPayload(req.body, { partial: true })
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const school = await resolveTeamSchool(connection, req.params.schoolRef)
    await assertTeamSchoolAccess(connection, req.teamUser, school.id)
    const updates = []
    const params = []
    for (const [column, entry] of Object.entries(payload)) {
      if (entry !== undefined) { updates.push(`${column}=?`); params.push(entry) }
    }
    if (value(req.body, "assigned_user_ref", "assignedUserRef") !== undefined) {
      if (!hasTeamPermission(req.teamUser, TEAM_PERMISSIONS.SCHOOLS_ASSIGN)) throw new HttpError(403, "You cannot reassign schools")
      updates.push("assigned_user_id=?")
      params.push(await resolveTeamUserId(connection, value(req.body, "assigned_user_ref", "assignedUserRef"), "Assigned team member"))
    }
    if (!updates.length) throw new HttpError(400, "No supported school changes were supplied")
    updates.push("updated_by=?"); params.push(req.teamUser.id, school.id)
    await connection.query(`UPDATE team_school_prospects SET ${updates.join(",")} WHERE id=?`, params)
    const [[updated]] = await connection.query("SELECT * FROM team_school_prospects WHERE id=?", [school.id])
    await writeTeamAudit(connection, { actorUserId: req.teamUser.id, action: "SCHOOL_UPDATED", entityType: "school", entityId: school.id, entityRef: school.public_ref, schoolId: school.id, beforeValue: school, afterValue: updated, ...safeTeamRequestMetadata(req) })
    await connection.commit()
    res.json({ school: updated })
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function createTeamContact(req, res) {
  const classifications = [...new Set((Array.isArray(req.body?.classifications) ? req.body.classifications : []).map((item) => enumValue(item, CONTACT_CLASSIFICATIONS, "Contact classification")))]
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const school = await resolveTeamSchool(connection, req.params.schoolRef)
    await assertTeamSchoolAccess(connection, req.teamUser, school.id)
    const [result] = await connection.query(
      `INSERT INTO team_school_contacts
         (public_ref,school_id,full_name,position,phone,whatsapp_number,email,preferred_channel,preferred_contact_time,influence_level,decision_authority,relationship_strength,communication_consent,notes,created_by)
       VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [school.id,requiredText(value(req.body,"full_name","fullName"),"Contact name",180),optionalText(value(req.body,"position"),160),optionalText(value(req.body,"phone"),50),optionalText(value(req.body,"whatsapp_number","whatsappNumber"),50),optionalText(value(req.body,"email"),190)?.toLowerCase() || null,enumValue(value(req.body,"preferred_channel","preferredChannel"),["unknown","phone","whatsapp","email","visit"],"Preferred channel","unknown"),optionalText(value(req.body,"preferred_contact_time","preferredContactTime"),120),enumValue(value(req.body,"influence_level","influenceLevel"),["unknown","low","medium","high"],"Influence level","unknown"),enumValue(value(req.body,"decision_authority","decisionAuthority"),["unknown","none","recommender","joint","final"],"Decision authority","unknown"),enumValue(value(req.body,"relationship_strength","relationshipStrength"),["unknown","weak","developing","strong"],"Relationship strength","unknown"),value(req.body,"communication_consent","communicationConsent") ? 1 : 0,optionalText(value(req.body,"notes"),10000),req.teamUser.id],
    )
    for (const classification of classifications.length ? classifications : ["unknown"]) {
      await connection.query("INSERT INTO team_contact_classifications (contact_id,classification) VALUES (?,?)", [result.insertId, classification])
    }
    const [[contact]] = await connection.query("SELECT * FROM team_school_contacts WHERE id=?", [result.insertId])
    await writeTeamAudit(connection, { actorUserId: req.teamUser.id, action: "CONTACT_CREATED", entityType: "school_contact", entityId: contact.id, entityRef: contact.public_ref, schoolId: school.id, afterValue: { ...contact, classifications }, ...safeTeamRequestMetadata(req) })
    await connection.commit()
    res.status(201).json({ contact: { ...contact, classifications } })
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function updateTeamContact(req, res) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const school = await resolveTeamSchool(connection, req.params.schoolRef)
    await assertTeamSchoolAccess(connection, req.teamUser, school.id)
    const [[contact]] = await connection.query(
      "SELECT * FROM team_school_contacts WHERE public_ref=? AND school_id=? FOR UPDATE",
      [req.params.contactRef, school.id],
    )
    if (!contact) throw new HttpError(404, "School contact was not found")
    const next = {
      full_name: value(req.body, "full_name", "fullName") === undefined ? contact.full_name : requiredText(value(req.body, "full_name", "fullName"), "Contact name", 180),
      position: value(req.body, "position") === undefined ? contact.position : optionalText(value(req.body, "position"), 160),
      phone: value(req.body, "phone") === undefined ? contact.phone : optionalText(value(req.body, "phone"), 50),
      whatsapp_number: value(req.body, "whatsapp_number", "whatsappNumber") === undefined ? contact.whatsapp_number : optionalText(value(req.body, "whatsapp_number", "whatsappNumber"), 50),
      email: value(req.body, "email") === undefined ? contact.email : optionalText(value(req.body, "email"), 190)?.toLowerCase() || null,
      preferred_channel: value(req.body, "preferred_channel", "preferredChannel") === undefined ? contact.preferred_channel : enumValue(value(req.body, "preferred_channel", "preferredChannel"), ["unknown", "phone", "whatsapp", "email", "visit"], "Preferred channel"),
      preferred_contact_time: value(req.body, "preferred_contact_time", "preferredContactTime") === undefined ? contact.preferred_contact_time : optionalText(value(req.body, "preferred_contact_time", "preferredContactTime"), 120),
      influence_level: value(req.body, "influence_level", "influenceLevel") === undefined ? contact.influence_level : enumValue(value(req.body, "influence_level", "influenceLevel"), ["unknown", "low", "medium", "high"], "Influence level"),
      decision_authority: value(req.body, "decision_authority", "decisionAuthority") === undefined ? contact.decision_authority : enumValue(value(req.body, "decision_authority", "decisionAuthority"), ["unknown", "none", "recommender", "joint", "final"], "Decision authority"),
      relationship_strength: value(req.body, "relationship_strength", "relationshipStrength") === undefined ? contact.relationship_strength : enumValue(value(req.body, "relationship_strength", "relationshipStrength"), ["unknown", "weak", "developing", "strong"], "Relationship strength"),
      communication_consent: value(req.body, "communication_consent", "communicationConsent") === undefined ? contact.communication_consent : booleanFlag(value(req.body, "communication_consent", "communicationConsent")),
      notes: value(req.body, "notes") === undefined ? contact.notes : optionalText(value(req.body, "notes"), 10000),
      is_active: value(req.body, "is_active", "isActive") === undefined ? contact.is_active : booleanFlag(value(req.body, "is_active", "isActive")),
    }
    await connection.query(
      `UPDATE team_school_contacts
       SET full_name=?,position=?,phone=?,whatsapp_number=?,email=?,preferred_channel=?,preferred_contact_time=?,influence_level=?,decision_authority=?,relationship_strength=?,communication_consent=?,notes=?,is_active=?
       WHERE id=?`,
      [...Object.values(next), contact.id],
    )
    let classifications
    if (Array.isArray(req.body?.classifications)) {
      classifications = [...new Set(req.body.classifications.map((item) => enumValue(item, CONTACT_CLASSIFICATIONS, "Contact classification")))]
      await connection.query("DELETE FROM team_contact_classifications WHERE contact_id=?", [contact.id])
      for (const classification of classifications.length ? classifications : ["unknown"]) {
        await connection.query("INSERT INTO team_contact_classifications (contact_id,classification) VALUES (?,?)", [contact.id, classification])
      }
    }
    const [[updated]] = await connection.query("SELECT * FROM team_school_contacts WHERE id=?", [contact.id])
    await writeTeamAudit(connection, { actorUserId: req.teamUser.id, action: "CONTACT_UPDATED", entityType: "school_contact", entityId: contact.id, entityRef: contact.public_ref, schoolId: school.id, beforeValue: contact, afterValue: { ...updated, classifications }, ...safeTeamRequestMetadata(req) })
    await connection.commit()
    res.json({ contact: { ...updated, ...(classifications ? { classifications } : {}) } })
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function confirmTeamSchoolRelationship(req, res) {
  const relationship = enumValue(value(req.body,"relationship_type","relationshipType"), ["duplicate","separate_campus","related_school","same_group","not_a_match"], "Relationship type")
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const school = await resolveTeamSchool(connection, req.params.schoolRef)
    const related = await resolveTeamSchool(connection, requiredText(value(req.body,"related_school_ref","relatedSchoolRef"),"Related school",36))
    await assertTeamSchoolAccess(connection, req.teamUser, school.id)
    await assertTeamSchoolAccess(connection, req.teamUser, related.id)
    if (school.id === related.id) throw new HttpError(400, "A school cannot be related to itself")
    await connection.query(
      `INSERT INTO team_school_relationships (school_id,related_school_id,relationship_type,confirmed_by,notes)
       VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE relationship_type=VALUES(relationship_type),confirmed_by=VALUES(confirmed_by),notes=VALUES(notes)`,
      [school.id,related.id,relationship,req.teamUser.id,optionalText(req.body?.notes,500)],
    )
    await writeTeamAudit(connection, { actorUserId: req.teamUser.id, action: "SCHOOL_RELATIONSHIP_CONFIRMED", entityType: "school", entityId: school.id, entityRef: school.public_ref, schoolId: school.id, afterValue: { related_school_ref: related.public_ref, relationship }, ...safeTeamRequestMetadata(req) })
    await connection.commit()
    res.json({ relationship_type: relationship })
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function listTeamOpportunities(req, res) {
  const pagination = paginationFrom(req.query)
  const scope = schoolScope(req.teamUser)
  const clauses = ["opportunity.archived_at IS NULL", "school.archived_at IS NULL", scope.sql]
  const params = [...scope.params]
  const search = safeLike(req.query.search || req.query.q)
  if (search) { clauses.push("(opportunity.title LIKE ? ESCAPE '\\\\' OR school.name LIKE ? ESCAPE '\\\\')"); params.push(`%${search}%`,`%${search}%`) }
  if (req.query.stage) { clauses.push("opportunity.stage=?"); params.push(validateOpportunityStage(req.query.stage)) }
  if (String(req.query.assigned_to_me || "") === "true") { clauses.push("opportunity.assigned_owner_id=?"); params.push(req.teamUser.id) }
  const where = clauses.join(" AND ")
  const [[count], [rows]] = await Promise.all([
    pool.query(`SELECT COUNT(*) total FROM team_sales_opportunities opportunity JOIN team_school_prospects school ON school.id=opportunity.school_id WHERE ${where}`, params),
    pool.query(
      `SELECT opportunity.public_ref,opportunity.title,opportunity.stage,opportunity.total_expected_value,opportunity.probability,
              opportunity.expected_close_date,opportunity.next_action,opportunity.next_action_at,opportunity.updated_at,
              school.public_ref school_ref,school.name school_name,school.priority,owner.public_ref owner_ref,owner.full_name owner_name,
              (SELECT MAX(activity.occurred_at) FROM team_school_activities activity WHERE activity.opportunity_id=opportunity.id) last_activity_at
       FROM team_sales_opportunities opportunity
       JOIN team_school_prospects school ON school.id=opportunity.school_id
       JOIN team_users owner ON owner.id=opportunity.assigned_owner_id
       WHERE ${where}
       ORDER BY FIELD(opportunity.stage,'negotiation','proposal_sent','contract_sent','contract_signed','deposit_pending','demo_scheduled','meeting_scheduled'),opportunity.expected_close_date,opportunity.updated_at DESC
       LIMIT ? OFFSET ?`,
      [...params,pagination.pageSize,pagination.offset],
    ),
  ])
  res.json({ items: rows, stages: OPPORTUNITY_STAGES, pagination: paginationMeta(count.total,pagination) })
}

export async function createTeamOpportunity(req, res) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const school = await resolveTeamSchool(connection, requiredText(value(req.body,"school_ref","schoolRef"),"School",36))
    await assertTeamSchoolAccess(connection, req.teamUser, school.id)
    const ownerId = value(req.body,"assigned_owner_ref","assignedOwnerRef") ? await resolveTeamUserId(connection,value(req.body,"assigned_owner_ref","assignedOwnerRef"),"Opportunity owner",{required:true}) : req.teamUser.id
    const stage = validateOpportunityStage(value(req.body,"stage") || "discovered")
    if (OPPORTUNITY_STAGES.indexOf(stage) >= LATE_STAGE_START_INDEX && !hasTeamPermission(req.teamUser, TEAM_PERMISSIONS.OPPORTUNITIES_ADVANCE_LATE)) throw new HttpError(403,"You cannot create an opportunity in a late commercial stage")
    const setup = numberInRange(value(req.body,"estimated_setup_revenue","estimatedSetupRevenue"),"Setup revenue",0,999999999999,0)
    const term = numberInRange(value(req.body,"estimated_term_revenue","estimatedTermRevenue"),"Term revenue",0,999999999999,0)
    const [result] = await connection.query(
      `INSERT INTO team_sales_opportunities
         (public_ref,school_id,title,assigned_owner_id,stage,estimated_setup_revenue,estimated_term_revenue,total_expected_value,probability,expected_close_date,proposed_package,next_action,next_action_at,competitor,main_objection,created_by,updated_by)
       VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [school.id,requiredText(value(req.body,"title"),"Opportunity title",220),ownerId,stage,setup,term,setup+term,numberInRange(value(req.body,"probability"),"Probability",0,100,0),nullableDate(value(req.body,"expected_close_date","expectedCloseDate"),"Expected close date"),optionalText(value(req.body,"proposed_package","proposedPackage"),160),optionalText(value(req.body,"next_action","nextAction"),500),nullableDate(value(req.body,"next_action_at","nextActionAt"),"Next-action date"),optionalText(value(req.body,"competitor"),180),optionalText(value(req.body,"main_objection","mainObjection"),500),req.teamUser.id,req.teamUser.id],
    )
    const [[opportunity]] = await connection.query("SELECT * FROM team_sales_opportunities WHERE id=?",[result.insertId])
    await connection.query("INSERT INTO team_opportunity_stage_history (public_ref,opportunity_id,previous_stage,new_stage,changed_by,reason) VALUES (UUID(),?,NULL,?,?,?)",[opportunity.id,stage,req.teamUser.id,"Opportunity created"])
    await connection.query("UPDATE team_school_prospects SET status='active_opportunity',pipeline_stage=?,updated_by=? WHERE id=?",[stage,req.teamUser.id,school.id])
    await writeTeamAudit(connection,{actorUserId:req.teamUser.id,action:"OPPORTUNITY_CREATED",entityType:"opportunity",entityId:opportunity.id,entityRef:opportunity.public_ref,schoolId:school.id,afterValue:opportunity,...safeTeamRequestMetadata(req)})
    if(ownerId!==req.teamUser.id) await createTeamNotification(connection,{recipientUserId:ownerId,type:"opportunity_assigned",title:"Opportunity assigned to you",message:`${opportunity.title} at ${school.name} is now assigned to you.`,entityType:"opportunity",entityRef:opportunity.public_ref,actionPath:"/team/pipeline"})
    await connection.commit()
    res.status(201).json({opportunity})
  } catch(error){await connection.rollback();throw error} finally{connection.release()}
}

export async function getTeamOpportunity(req,res){
  const [[opportunity]]=await pool.query(`SELECT opportunity.*,school.public_ref school_ref,school.name school_name,owner.public_ref owner_ref,owner.full_name owner_name,implementation.public_ref implementation_owner_ref,implementation.full_name implementation_owner_name FROM team_sales_opportunities opportunity JOIN team_school_prospects school ON school.id=opportunity.school_id JOIN team_users owner ON owner.id=opportunity.assigned_owner_id LEFT JOIN team_users implementation ON implementation.id=opportunity.implementation_owner_id WHERE opportunity.public_ref=? AND opportunity.archived_at IS NULL LIMIT 1`,[req.params.opportunityRef])
  if(!opportunity) throw new HttpError(404,"Opportunity was not found")
  await assertTeamSchoolAccess(pool,req.teamUser,opportunity.school_id)
  const [[history],[proposals]]=await Promise.all([
    pool.query(`SELECT history.*,user.full_name changed_by_name FROM team_opportunity_stage_history history JOIN team_users user ON user.id=history.changed_by WHERE history.opportunity_id=? ORDER BY history.changed_at DESC`,[opportunity.id]),
    pool.query(`SELECT proposal.* FROM team_proposals proposal WHERE proposal.opportunity_id=? ORDER BY proposal.created_at DESC`,[opportunity.id]),
  ])
  res.json({opportunity,stage_history:history,proposals})
}

export async function updateTeamOpportunity(req, res) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[opportunity]] = await connection.query(
      "SELECT * FROM team_sales_opportunities WHERE public_ref=? AND archived_at IS NULL FOR UPDATE",
      [req.params.opportunityRef],
    )
    if (!opportunity) throw new HttpError(404, "Opportunity was not found")
    await assertTeamSchoolAccess(connection, req.teamUser, opportunity.school_id)
    const setup = value(req.body, "estimated_setup_revenue", "estimatedSetupRevenue") === undefined ? Number(opportunity.estimated_setup_revenue) : numberInRange(value(req.body, "estimated_setup_revenue", "estimatedSetupRevenue"), "Setup revenue", 0, 999999999999, 0)
    const term = value(req.body, "estimated_term_revenue", "estimatedTermRevenue") === undefined ? Number(opportunity.estimated_term_revenue) : numberInRange(value(req.body, "estimated_term_revenue", "estimatedTermRevenue"), "Term revenue", 0, 999999999999, 0)
    const ownerId = value(req.body, "assigned_owner_ref", "assignedOwnerRef") === undefined ? opportunity.assigned_owner_id : await resolveTeamUserId(connection, value(req.body, "assigned_owner_ref", "assignedOwnerRef"), "Opportunity owner", { required: true })
    await connection.query(
      `UPDATE team_sales_opportunities
       SET title=?,assigned_owner_id=?,estimated_setup_revenue=?,estimated_term_revenue=?,total_expected_value=?,probability=?,expected_close_date=?,proposed_package=?,competitor=?,main_objection=?,next_action=?,next_action_at=?,updated_by=?
       WHERE id=?`,
      [
        value(req.body, "title") === undefined ? opportunity.title : requiredText(value(req.body, "title"), "Opportunity title", 220),
        ownerId, setup, term, setup + term,
        value(req.body, "probability") === undefined ? opportunity.probability : numberInRange(value(req.body, "probability"), "Probability", 0, 100, 0),
        value(req.body, "expected_close_date", "expectedCloseDate") === undefined ? opportunity.expected_close_date : nullableDate(value(req.body, "expected_close_date", "expectedCloseDate"), "Expected close date"),
        value(req.body, "proposed_package", "proposedPackage") === undefined ? opportunity.proposed_package : optionalText(value(req.body, "proposed_package", "proposedPackage"), 160),
        value(req.body, "competitor") === undefined ? opportunity.competitor : optionalText(value(req.body, "competitor"), 180),
        value(req.body, "main_objection", "mainObjection") === undefined ? opportunity.main_objection : optionalText(value(req.body, "main_objection", "mainObjection"), 500),
        value(req.body, "next_action", "nextAction") === undefined ? opportunity.next_action : optionalText(value(req.body, "next_action", "nextAction"), 500),
        value(req.body, "next_action_at", "nextActionAt") === undefined ? opportunity.next_action_at : nullableDate(value(req.body, "next_action_at", "nextActionAt"), "Next-action date"),
        req.teamUser.id, opportunity.id,
      ],
    )
    const [[updated]] = await connection.query("SELECT * FROM team_sales_opportunities WHERE id=?", [opportunity.id])
    await writeTeamAudit(connection, { actorUserId: req.teamUser.id, action: "OPPORTUNITY_UPDATED", entityType: "opportunity", entityId: opportunity.id, entityRef: opportunity.public_ref, schoolId: opportunity.school_id, beforeValue: opportunity, afterValue: updated, ...safeTeamRequestMetadata(req) })
    if (ownerId !== opportunity.assigned_owner_id && ownerId !== req.teamUser.id) await createTeamNotification(connection, { recipientUserId: ownerId, type: "opportunity_assigned", title: "Opportunity assigned to you", message: updated.title, entityType: "opportunity", entityRef: opportunity.public_ref, actionPath: "/team/pipeline" })
    await connection.commit()
    res.json({ opportunity: updated })
  } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
}

export async function changeTeamOpportunityStage(req,res){
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const [[opportunity]]=await connection.query(`SELECT opportunity.*,implementation.public_ref implementation_owner_ref FROM team_sales_opportunities opportunity LEFT JOIN team_users implementation ON implementation.id=opportunity.implementation_owner_id WHERE opportunity.public_ref=? AND opportunity.archived_at IS NULL FOR UPDATE`,[req.params.opportunityRef])
    if(!opportunity) throw new HttpError(404,"Opportunity was not found")
    await assertTeamSchoolAccess(connection,req.teamUser,opportunity.school_id)
    const nextStage=validateOpportunityStage(value(req.body,"stage"))
    if(nextStage===opportunity.stage) return res.json({opportunity,unchanged:true})
    if(OPPORTUNITY_STAGES.indexOf(nextStage)>=LATE_STAGE_START_INDEX&&!hasTeamPermission(req.teamUser,TEAM_PERMISSIONS.OPPORTUNITIES_ADVANCE_LATE)) throw new HttpError(403,"Your role cannot move opportunities into late commercial stages")
    if(nextStage==="proposal_sent"){
      const [[proposal]]=await connection.query(`SELECT proposal.id,proposal.final_amount,proposal.payment_terms,proposal.recipient_contact_id,proposal.expires_at,(SELECT COUNT(*) FROM team_proposal_modules module WHERE module.proposal_id=proposal.id) module_count FROM team_proposals proposal WHERE proposal.opportunity_id=? AND proposal.status IN ('sent','viewed','accepted') ORDER BY proposal.created_at DESC LIMIT 1`,[opportunity.id])
      if(!proposal||Number(proposal.final_amount)<0||!proposal.payment_terms||!proposal.recipient_contact_id||!proposal.expires_at||Number(proposal.module_count)<1) throw new HttpError(409,"Proposal Sent requires an approved proposal with price, modules, payment terms, recipient and expiry date",{code:"TEAM_STAGE_REQUIREMENTS_MISSING"})
    }
    const critical=validateCriticalStageInput(nextStage,req.body,{...opportunity,implementation_owner_ref:opportunity.implementation_owner_ref})
    let implementationOwnerId=opportunity.implementation_owner_id
    if(critical.implementationOwnerRef) implementationOwnerId=await resolveTeamUserId(connection,critical.implementationOwnerRef,"Implementation owner",{required:true})
    const updates=["stage=?","updated_by=?"]
    const params=[nextStage,req.teamUser.id]
    const assign=(column,entry)=>{if(entry!==undefined){updates.push(`${column}=?`);params.push(entry)}}
    assign("loss_reason",critical.lossReason)
    if(nextStage==="closed_lost") assign("loss_notes",optionalText(value(req.body,"loss_notes","lossNotes"),10000))
    assign("contract_reference",critical.contractReference)
    assign("contract_signed_at",critical.contractSignedAt)
    assign("final_price",critical.finalPrice)
    assign("payment_schedule",critical.paymentSchedule)
    assign("implementation_owner_id",implementationOwnerId)
    assign("planned_onboarding_date",critical.plannedOnboardingDate)
    assign("expected_go_live_date",critical.expectedGoLiveDate)
    if(["closed_won","closed_lost"].includes(nextStage)){updates.push("closed_at=CURRENT_TIMESTAMP")}
    params.push(opportunity.id)
    await connection.query(`UPDATE team_sales_opportunities SET ${updates.join(",")} WHERE id=?`,params)
    await connection.query("INSERT INTO team_opportunity_stage_history (public_ref,opportunity_id,previous_stage,new_stage,changed_by,reason) VALUES (UUID(),?,?,?,?,?)",[opportunity.id,opportunity.stage,nextStage,req.teamUser.id,optionalText(req.body?.reason,5000)])
    await connection.query("UPDATE team_school_prospects SET pipeline_stage=?,status=?,updated_by=? WHERE id=?",[nextStage,nextStage==="closed_won"?"customer":nextStage==="closed_lost"?"follow_up_later":"active_opportunity",req.teamUser.id,opportunity.school_id])
    await connection.query(`INSERT INTO team_school_activities (public_ref,school_id,opportunity_id,activity_type,occurred_at,team_user_id,summary,notes) VALUES (UUID(),?,?,'stage_changed',CURRENT_TIMESTAMP,?,?,?)`,[opportunity.school_id,opportunity.id,req.teamUser.id,`Opportunity moved from ${opportunity.stage} to ${nextStage}`,optionalText(req.body?.reason,5000)])
    const [[updated]]=await connection.query("SELECT * FROM team_sales_opportunities WHERE id=?",[opportunity.id])
    await writeTeamAudit(connection,{actorUserId:req.teamUser.id,action:"OPPORTUNITY_STAGE_CHANGED",entityType:"opportunity",entityId:opportunity.id,entityRef:opportunity.public_ref,schoolId:opportunity.school_id,beforeValue:{stage:opportunity.stage},afterValue:{stage:nextStage},reason:req.body?.reason,...safeTeamRequestMetadata(req)})
    await connection.commit()
    res.json({opportunity:updated})
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function createTeamActivity(req,res){
  const connection=await pool.getConnection()
  try{
    await connection.beginTransaction()
    const school=await resolveTeamSchool(connection,requiredText(value(req.body,"school_ref","schoolRef"),"School",36))
    await assertTeamSchoolAccess(connection,req.teamUser,school.id)
    let contactId=null
    if(value(req.body,"contact_ref","contactRef")){
      const [[contact]]=await connection.query("SELECT id FROM team_school_contacts WHERE public_ref=? AND school_id=? LIMIT 1",[value(req.body,"contact_ref","contactRef"),school.id])
      if(!contact) throw new HttpError(400,"Contact does not belong to this school")
      contactId=contact.id
    }
    let opportunityId=null
    if(value(req.body,"opportunity_ref","opportunityRef")){
      const [[opportunity]]=await connection.query("SELECT id FROM team_sales_opportunities WHERE public_ref=? AND school_id=? AND archived_at IS NULL LIMIT 1",[value(req.body,"opportunity_ref","opportunityRef"),school.id])
      if(!opportunity) throw new HttpError(400,"Opportunity does not belong to this school")
      opportunityId=opportunity.id
    }
    const activityType=enumValue(value(req.body,"activity_type","activityType"),ACTIVITY_TYPES,"Activity type")
    const occurredAt=nullableDate(value(req.body,"occurred_at","occurredAt"),"Activity date")||new Date()
    const nextAction=optionalText(value(req.body,"next_action","nextAction"),500)
    const nextActionAt=nullableDate(value(req.body,"next_action_at","nextActionAt"),"Next-action date")
    const [result]=await connection.query(`INSERT INTO team_school_activities (public_ref,school_id,contact_id,opportunity_id,activity_type,occurred_at,team_user_id,summary,notes,outcome,next_action,next_action_at,visibility) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?)`,[school.id,contactId,opportunityId,activityType,occurredAt,req.teamUser.id,requiredText(value(req.body,"summary"),"Activity summary",500),optionalText(value(req.body,"notes"),10000),optionalText(value(req.body,"outcome"),500),nextAction,nextActionAt,enumValue(value(req.body,"visibility"),["team","management","finance","implementation"],"Visibility","team")])
    if(contactId) await connection.query("UPDATE team_school_contacts SET last_contacted_at=? WHERE id=?",[occurredAt,contactId])
    if(nextAction||nextActionAt) await connection.query("UPDATE team_school_prospects SET next_action=?,next_action_at=?,updated_by=? WHERE id=?",[nextAction,nextActionAt,req.teamUser.id,school.id])
    const [[activity]]=await connection.query("SELECT * FROM team_school_activities WHERE id=?",[result.insertId])
    await writeTeamAudit(connection,{actorUserId:req.teamUser.id,action:"SCHOOL_ACTIVITY_RECORDED",entityType:"school_activity",entityId:activity.id,entityRef:activity.public_ref,schoolId:school.id,afterValue:activity,...safeTeamRequestMetadata(req)})
    await connection.commit()
    res.status(201).json({activity,next_action_prompt:!nextActionAt})
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}
