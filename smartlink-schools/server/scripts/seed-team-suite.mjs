import bcrypt from "bcryptjs"
import dotenv from "dotenv"
import mysql from "mysql2/promise"

dotenv.config()

if (String(process.env.ALLOW_TEAM_DEMO_SEED || "").toLowerCase() !== "true") {
  throw new Error("Set ALLOW_TEAM_DEMO_SEED=true to acknowledge that fictional Team Suite demonstration data will be created.")
}
if (String(process.env.NODE_ENV || "").toLowerCase() === "production" && String(process.env.ALLOW_PRODUCTION_DEMO_SEED || "").toLowerCase() !== "true") {
  throw new Error("Production demo seeding is disabled. Use a development database or explicitly set ALLOW_PRODUCTION_DEMO_SEED=true.")
}
const temporaryPassword = String(process.env.TEAM_DEMO_PASSWORD || "")
if (temporaryPassword.length < 10) throw new Error("Set TEAM_DEMO_PASSWORD to a temporary password of at least 10 characters.")
const databaseUrl = String(process.env.DATABASE_URL || "").trim()
if (!databaseUrl) throw new Error("DATABASE_URL is required.")

const connection = await mysql.createConnection({ uri: databaseUrl, dateStrings: ["DATE"] })
const passwordHash = await bcrypt.hash(temporaryPassword, 12)

const users = [
  ["Amara Phiri", "owner@team.smartlink.example.test", "Platform Owner", "platform_owner"],
  ["Thoko Banda", "operations@team.smartlink.example.test", "Operations & Partnerships Manager", "operations_partnerships_manager"],
  ["Luka Mbewe", "outreach@team.smartlink.example.test", "Outreach Officer", "outreach_officer"],
  ["Tadala Nkhoma", "implementation@team.smartlink.example.test", "Implementation & Support Officer", "implementation_support_officer"],
  ["Chikondi Zimba", "finance@team.smartlink.example.test", "Finance Officer", "finance_officer"],
  ["Mwayi Gondwe", "developer@team.smartlink.example.test", "Developer", "developer"],
]

const schools = [
  ["Mitsinje Learning Academy", "combined", "Blantyre", "Blantyre", "high", "negotiation"],
  ["Ndirande Horizon School", "secondary", "Ndirande", "Blantyre", "high", "proposal_sent"],
  ["Michiru View Primary", "primary", "Chilomoni", "Blantyre", "medium", "demo_scheduled"],
  ["Soche Hills Academy", "combined", "Soche", "Blantyre", "critical", "closed_won"],
  ["Chichiri Scholars School", "secondary", "Chichiri", "Blantyre", "medium", "closed_lost"],
  ["Nyambadwe Preparatory", "primary", "Nyambadwe", "Blantyre", "medium", "awaiting_response"],
  ["Kameza Community College", "college", "Kameza", "Blantyre", "low", "researching"],
  ["Zomba Cedar Academy", "combined", "Zomba", "Zomba", "medium", "qualified"],
  ["Machinga Future School", "secondary", "Liwonde", "Machinga", "low", "discovered"],
  ["Mulanje Sunrise Primary", "primary", "Mulanje", "Mulanje", "medium", "ready_for_outreach"],
  ["Thyolo Valley School", "combined", "Thyolo", "Thyolo", "high", "needs_assessment"],
  ["Chikwawa River Academy", "primary", "Chikwawa", "Chikwawa", "low", "first_message_sent"],
  ["Balaka Gateway School", "secondary", "Balaka", "Balaka", "medium", "meeting_scheduled"],
  ["Ntcheu Beacon College", "college", "Ntcheu", "Ntcheu", "low", "follow_up_later"],
  ["Dedza Highlands Academy", "combined", "Dedza", "Dedza", "medium", "responded"],
]

async function idFor(table, key, value) {
  const [[row]] = await connection.query(`SELECT id FROM ${table} WHERE ${key}=? LIMIT 1`, [value])
  return row?.id || null
}

try {
  await connection.beginTransaction()

  const teamUserIds = {}
  for (const [fullName, email, title, roleCode] of users) {
    let id = await idFor("team_users", "email", email)
    if (!id) {
      const [result] = await connection.query(
        `INSERT INTO team_users (public_ref,full_name,email,password_hash,job_title,must_change_password,is_active)
         VALUES (UUID(),?,?,?,?,1,1)`,
        [fullName, email, passwordHash, title],
      )
      id = result.insertId
    }
    const roleId = await idFor("team_roles", "code", roleCode)
    if (!roleId) throw new Error(`Migration 066 is missing role ${roleCode}`)
    await connection.query("INSERT IGNORE INTO team_user_roles (user_id,role_id) VALUES (?,?)", [id, roleId])
    teamUserIds[roleCode] = id
  }

  const schoolIds = []
  for (const [index, school] of schools.entries()) {
    const [name, type, location, district, priority, stage] = school
    let id = await idFor("team_school_prospects", "name", name)
    if (!id) {
      const status = stage === "closed_won" ? "customer" : stage === "closed_lost" ? "follow_up_later" : "active_opportunity"
      const [result] = await connection.query(
        `INSERT INTO team_school_prospects
           (public_ref,name,school_type,status,location,district,email,email_domain,estimated_enrolment,curriculum,estimated_deal_value,conversion_probability,priority,urgency,lead_source,assigned_user_id,pipeline_stage,next_action,next_action_at,notes,created_by,updated_by)
         VALUES (UUID(),?,?,?,?,?,?,'example.test',?,?,?,?,?,?,'Referral',?,?,?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY),'Fictional Team Suite demonstration record.',?,?)`,
        [name,type,status,location,district,`school${index + 1}@example.test`,250+index*45,"Malawi National Curriculum",1500000+index*125000,Math.max(10,75-index*3),priority,index%4===0?"high":"medium",teamUserIds.outreach_officer,stage,index===13?null:`Follow up with ${name}`,index-3,teamUserIds.platform_owner,teamUserIds.platform_owner],
      )
      id = result.insertId
    }
    schoolIds.push(id)
    let contactId = await idFor("team_school_contacts", "school_id", id)
    if (!contactId) {
      const [contactResult] = await connection.query(
        `INSERT INTO team_school_contacts
           (public_ref,school_id,full_name,position,email,preferred_channel,influence_level,decision_authority,relationship_strength,communication_consent,created_by)
         VALUES (UUID(),?,?,?,?,'email','high','final','developing',1,?)`,
        [id,`Fictional Contact ${index + 1}`,index===2?"Bursar":"Headteacher",`contact${index + 1}@example.test`,teamUserIds.outreach_officer],
      )
      contactId = contactResult.insertId
      await connection.query("INSERT INTO team_contact_classifications (contact_id,classification) VALUES (?,?)", [contactId,index===4?"blocker":index%3===0?"champion":"decision_maker"])
    }

    let opportunityId = await idFor("team_sales_opportunities", "school_id", id)
    if (!opportunityId) {
      const [opportunityResult] = await connection.query(
        `INSERT INTO team_sales_opportunities
           (public_ref,school_id,title,assigned_owner_id,stage,estimated_setup_revenue,estimated_term_revenue,total_expected_value,probability,expected_close_date,proposed_package,main_contact_id,next_action,next_action_at,loss_reason,loss_notes,win_notes,contract_reference,contract_signed_at,payment_schedule,implementation_owner_id,planned_onboarding_date,expected_go_live_date,closed_at,created_by,updated_by)
         VALUES (UUID(),?,?,?,?,?,?,?,?,DATE_ADD(CURRENT_DATE,INTERVAL ? DAY),'SmartLink Core',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id,`${name} SmartLink rollout`,teamUserIds.outreach_officer,stage,500000+index*20000,1000000+index*50000,1500000+index*70000,Math.max(10,80-index*4),30-index,contactId,stage==="closed_lost"?null:"Confirm the next commercial step",new Date(Date.now()+(index-3)*86400000),stage==="closed_lost"?"existing_contract":null,stage==="closed_lost"?"The fictional prospect renewed its existing agreement.":null,stage==="closed_won"?"Agreement confirmed for demonstration.":null,stage==="closed_won"?"DEMO-CONTRACT-REFERENCE":null,stage==="closed_won"?new Date():null,stage==="closed_won"?"Two instalments":null,stage==="closed_won"?teamUserIds.implementation_support_officer:null,stage==="closed_won"?new Date():null,stage==="closed_won"?new Date(Date.now()+21*86400000):null,["closed_won","closed_lost"].includes(stage)?new Date():null,teamUserIds.platform_owner,teamUserIds.platform_owner],
      )
      opportunityId = opportunityResult.insertId
      await connection.query("INSERT INTO team_opportunity_stage_history (public_ref,opportunity_id,previous_stage,new_stage,changed_by,reason) VALUES (UUID(),?,NULL,?,?,?)", [opportunityId,stage,teamUserIds.platform_owner,"Demonstration stage"])
    }
  }

  const firstOpportunity = await idFor("team_sales_opportunities", "school_id", schoolIds[0])
  const secondOpportunity = await idFor("team_sales_opportunities", "school_id", schoolIds[1])
  const wonOpportunity = await idFor("team_sales_opportunities", "school_id", schoolIds[3])
  const firstContact = await idFor("team_school_contacts", "school_id", schoolIds[0])

  if (!(await idFor("team_tasks", "title", "Call back Mitsinje Learning Academy"))) {
    await connection.query(`INSERT INTO team_tasks (public_ref,title,description,school_id,opportunity_id,assigned_user_id,created_by,due_at,priority,category,status) VALUES (UUID(),'Call back Mitsinje Learning Academy','Demonstrates an overdue follow-up.',?,?,?, ?,DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 2 DAY),'high','follow_up','in_progress'),(UUID(),'Prepare Ndirande proposal review','Demonstrates an approval follow-up.',?,?,?, ?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY),'critical','send_proposal','not_started'),(UUID(),'Verify Michiru demo equipment','Demonstrates upcoming demo preparation.',?,NULL,?, ?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 3 DAY),'medium','prepare_demo','not_started')`,[schoolIds[0],firstOpportunity,teamUserIds.outreach_officer,teamUserIds.operations_partnerships_manager,schoolIds[1],secondOpportunity,teamUserIds.operations_partnerships_manager,teamUserIds.platform_owner,schoolIds[2],teamUserIds.outreach_officer,teamUserIds.operations_partnerships_manager])
  }

  if (!(await idFor("team_meetings", "school_id", schoolIds[2]))) {
    await connection.query(`INSERT INTO team_meetings (public_ref,school_id,opportunity_id,meeting_type,scheduled_at,location,attendance_mode,agenda,organised_by) VALUES (UUID(),? ,(SELECT id FROM team_sales_opportunities WHERE school_id=? LIMIT 1),'product_demo',DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 2 DAY),'School computer lab','physical','Review school operations and demonstrate the core workflow.',?)`,[schoolIds[2],schoolIds[2],teamUserIds.outreach_officer])
  }

  if (!(await idFor("team_proposals", "opportunity_id", secondOpportunity))) {
    const [proposalResult] = await connection.query(`INSERT INTO team_proposals (public_ref,proposal_number,school_id,opportunity_id,package_name,campus_count,estimated_students,setup_fee,term_subscription,original_amount,requested_discount,approved_discount,final_amount,payment_terms,expires_at,prepared_by,recipient_contact_id,status,internal_notes) VALUES (UUID(),'SLP-DEMO-0001',?,?,'SmartLink Core',1,640,600000,1200000,1800000,150000,0,1650000,'Setup fee followed by term subscription.',DATE_ADD(CURRENT_DATE,INTERVAL 14 DAY),?,(SELECT id FROM team_school_contacts WHERE school_id=? LIMIT 1),'awaiting_approval','Fictional proposal awaiting approval.')`,[schoolIds[1],secondOpportunity,teamUserIds.operations_partnerships_manager,schoolIds[1]])
    await connection.query("INSERT INTO team_proposal_modules (proposal_id,module_code,module_name,amount) VALUES (?,'core_school_operations','Core School Operations',1200000),(?,'implementation','Implementation and Training',600000)",[proposalResult.insertId,proposalResult.insertId])
    await connection.query("INSERT INTO team_proposal_approvals (public_ref,proposal_id,requested_by,requested_discount,reason) VALUES (UUID(),?,?,150000,'Fictional multi-campus launch incentive.')",[proposalResult.insertId,teamUserIds.operations_partnerships_manager])
  }

  let onboardingId = await idFor("team_onboarding_projects", "opportunity_id", wonOpportunity)
  if (!onboardingId) {
    const [onboardingResult] = await connection.query(`INSERT INTO team_onboarding_projects (public_ref,school_id,opportunity_id,implementation_owner_id,start_date,expected_go_live_date,stage,completion_percentage,risk_status,notes,created_by) VALUES (UUID(),?,?,?,CURRENT_DATE,DATE_ADD(CURRENT_DATE,INTERVAL 21 DAY),'school_configuration',26.32,'watch','Fictional onboarding project.',?)`,[schoolIds[3],wonOpportunity,teamUserIds.implementation_support_officer,teamUserIds.platform_owner])
    onboardingId = onboardingResult.insertId
    const checklist = ["School profile confirmed","Academic year configured","Terms configured","Classes configured","Streams configured","Subjects configured","Fee structure configured","Roles confirmed","Teachers imported","Students imported","Guardians imported","Opening balances imported","Branding applied","Permissions tested","Reports tested","Administrator trained","Bursar trained","Teachers trained","School sign-off received"]
    for (const [index,label] of checklist.entries()) await connection.query("INSERT INTO team_onboarding_checklist_items (public_ref,project_id,item_code,label,sort_order,is_required,is_complete,completed_by,completed_at) VALUES (UUID(),?,?,?,?,1,?,?,?)",[onboardingId,label.toLowerCase().replaceAll(" ","_"),label,index+1,index<5?1:0,index<5?teamUserIds.implementation_support_officer:null,index<5?new Date():null])
  }

  if (!(await idFor("team_subscriptions", "school_id", schoolIds[3]))) {
    await connection.query(`INSERT INTO team_subscriptions (public_ref,school_id,onboarding_project_id,package_name,starts_on,expires_on,academic_term,duration_months,amount,invoice_status,payment_status,grace_period_days,renewal_owner_id,status,notes,created_by) VALUES (UUID(),?,?, 'SmartLink Core',DATE_SUB(CURRENT_DATE,INTERVAL 11 MONTH),DATE_ADD(CURRENT_DATE,INTERVAL 14 DAY),'Term 3',12,1800000,'issued','pending',7,?,'renewal_approaching','Fictional renewal warning.',?)`,[schoolIds[3],onboardingId,teamUserIds.finance_officer,teamUserIds.finance_officer])
  }

  if (!(await idFor("team_support_tickets", "ticket_number", "SL-DEMO-0001"))) {
    await connection.query(`INSERT INTO team_support_tickets (public_ref,ticket_number,school_id,reporter_name,module_name,category,description,severity,status,assigned_user_id,target_resolution_at,internal_notes,created_by) VALUES (UUID(),'SL-DEMO-0001',?,'Fictional School Administrator','Results','results','Published results are not visible in the fictional demonstration account.','critical','investigating',?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 4 HOUR),'Demonstration critical incident.',?),(UUID(),'SL-DEMO-0002',?,'Fictional Bursar','Fees','fees','A fictional receipt needs verification.','medium','waiting_for_school',?,DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 2 DAY),'Waiting for sample evidence.',?)`,[schoolIds[3],teamUserIds.developer,teamUserIds.implementation_support_officer,schoolIds[0],teamUserIds.implementation_support_officer,teamUserIds.implementation_support_officer])
  }

  await connection.query(`INSERT INTO team_school_activities (public_ref,school_id,contact_id,opportunity_id,activity_type,occurred_at,team_user_id,summary,notes,next_action,next_action_at) SELECT UUID(),?, ?,?,'whatsapp_reply',DATE_SUB(CURRENT_TIMESTAMP,INTERVAL 1 DAY),?,'Decision-maker replied to the introduction.','Fictional manual communication record.','Confirm a discovery call',DATE_ADD(CURRENT_TIMESTAMP,INTERVAL 1 DAY) WHERE NOT EXISTS (SELECT 1 FROM team_school_activities WHERE school_id=? AND summary='Decision-maker replied to the introduction.')`,[schoolIds[0],firstContact,firstOpportunity,teamUserIds.outreach_officer,schoolIds[0]])

  await connection.commit()
  console.log(`SmartLink Team Suite demonstration data is ready: ${users.length} users and ${schools.length} fictional schools.`)
  console.log("All seeded users must change the temporary password at first login.")
} catch (error) {
  await connection.rollback()
  throw error
} finally {
  await connection.end()
}
