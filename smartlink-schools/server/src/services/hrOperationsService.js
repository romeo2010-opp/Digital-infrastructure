import { pool } from "../config/db.js"
import { HttpError } from "../utils/http.js"
import { broadcastSchoolNotification, createInAppNotification } from "./operationalCommunicationService.js"
import { createDirectorTask } from "./directorOperationsService.js"

const leaveTypes = new Set(["sick","annual","maternity","paternity","compassionate","unpaid","study","other"])
const money = (value) => Number(Number(value || 0).toFixed(2))
const text = (value, max=2000) => String(value ?? "").trim().slice(0,max)
const dateValue = (value, name) => { const result=text(value,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new HttpError(400,`${name} must use YYYY-MM-DD`); return result }
const daysInclusive = (start,end) => { const days=Math.floor((new Date(`${end}T00:00:00Z`)-new Date(`${start}T00:00:00Z`))/86400000)+1; if(!(days>0)) throw new HttpError(400,"End date must be on or after start date"); return days }

async function audit(schoolId,actorId,action,entityType,entityId,after={}) {
  try { await pool.query("INSERT INTO audit_logs (school_id,actor_user_id,action,entity_type,entity_id,after_value) VALUES (?,?,?,?,?,?)",[schoolId,actorId,action,entityType,entityId||null,JSON.stringify(after)]) }
  catch(error){ if(!["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error }
}

async function userByRef(connection,schoolId,ref) {
  const [[row]]=await connection.query("SELECT id,public_ref,full_name,role,is_active FROM users WHERE school_id=? AND public_ref=? LIMIT 1",[schoolId,text(ref,36)])
  if(!row) throw new HttpError(400,"Staff member was not found in this school")
  return row
}

async function payrollRunByRef(connection,schoolId,ref,lock=false) {
  const [[row]]=await connection.query(`SELECT * FROM payroll_runs WHERE school_id=? AND public_ref=? LIMIT 1${lock?" FOR UPDATE":""}`,[schoolId,text(ref,36)])
  if(!row) throw new HttpError(404,"Payroll run was not found")
  return row
}

async function payrollItemByRef(connection,schoolId,ref,lock=false) {
  const [[row]]=await connection.query(`SELECT pi.*,pr.status run_status,pr.public_ref run_ref FROM payroll_items pi JOIN payroll_runs pr ON pr.id=pi.payroll_run_id AND pr.school_id=pi.school_id WHERE pi.school_id=? AND pi.public_ref=? LIMIT 1${lock?" FOR UPDATE":""}`,[schoolId,text(ref,36)])
  if(!row) throw new HttpError(404,"Payroll item was not found")
  return row
}

async function recalculatePayroll(connection,schoolId,runId,itemId=null) {
  if(itemId){
    const [[totals]]=await connection.query(`SELECT COALESCE((SELECT SUM(amount) FROM payroll_allowances WHERE school_id=? AND payroll_item_id=?),0) allowances,
      COALESCE((SELECT SUM(amount) FROM payroll_deductions WHERE school_id=? AND payroll_item_id=?),0) deductions`,[schoolId,itemId,schoolId,itemId])
    await connection.query("UPDATE payroll_items SET allowances_total=?,deductions_total=?,gross_pay=base_salary+?,net_pay=GREATEST(base_salary+?-?,0) WHERE school_id=? AND id=?",[money(totals.allowances),money(totals.deductions),money(totals.allowances),money(totals.allowances),money(totals.deductions),schoolId,itemId])
  }
  const [[runTotals]]=await connection.query("SELECT COALESCE(SUM(gross_pay),0) gross_pay,COALESCE(SUM(allowances_total),0) allowances,COALESCE(SUM(deductions_total),0) deductions,COALESCE(SUM(net_pay),0) net_pay FROM payroll_items WHERE school_id=? AND payroll_run_id=? AND status<>'cancelled'",[schoolId,runId])
  await connection.query("UPDATE payroll_runs SET total_gross_pay=?,total_allowances=?,total_deductions=?,total_net_pay=? WHERE school_id=? AND id=?",[money(runTotals.gross_pay),money(runTotals.allowances),money(runTotals.deductions),money(runTotals.net_pay),schoolId,runId])
}

export async function getHrSettings(schoolId) {
  const [[row]]=await pool.query("SELECT * FROM school_hr_settings WHERE school_id=?",[schoolId])
  return row||{payroll_frequency:"monthly",default_currency:"MWK",payroll_requires_director_approval:1,allow_bursar_payroll_access:0,allow_teacher_payslip_view:0,default_annual_leave_days:0,default_sick_leave_days:0,allow_teacher_leave_requests:0,require_leave_coverage:1,notify_director_leave_request:1}
}

export async function saveHrSettings(schoolId,actorId,body={}) {
  const frequency=["monthly","weekly","termly","custom"].includes(body.payroll_frequency)?body.payroll_frequency:"monthly"
  const currency=(text(body.default_currency||"MWK",3).toUpperCase()||"MWK")
  await pool.query(`INSERT INTO school_hr_settings (school_id,payroll_frequency,default_currency,payroll_requires_director_approval,allow_bursar_payroll_access,allow_teacher_payslip_view,default_annual_leave_days,default_sick_leave_days,allow_teacher_leave_requests,require_leave_coverage,notify_director_leave_request)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE payroll_frequency=VALUES(payroll_frequency),default_currency=VALUES(default_currency),payroll_requires_director_approval=VALUES(payroll_requires_director_approval),allow_bursar_payroll_access=VALUES(allow_bursar_payroll_access),allow_teacher_payslip_view=VALUES(allow_teacher_payslip_view),default_annual_leave_days=VALUES(default_annual_leave_days),default_sick_leave_days=VALUES(default_sick_leave_days),allow_teacher_leave_requests=VALUES(allow_teacher_leave_requests),require_leave_coverage=VALUES(require_leave_coverage),notify_director_leave_request=VALUES(notify_director_leave_request)`,
    [schoolId,frequency,currency,body.payroll_requires_director_approval!==false,Boolean(body.allow_bursar_payroll_access),Boolean(body.allow_teacher_payslip_view),Math.max(0,Number(body.default_annual_leave_days||0)),Math.max(0,Number(body.default_sick_leave_days||0)),Boolean(body.allow_teacher_leave_requests),body.require_leave_coverage!==false,body.notify_director_leave_request!==false])
  await audit(schoolId,actorId,"HR_SETTINGS_UPDATED","school_hr_settings",schoolId,{frequency,currency})
  return getHrSettings(schoolId)
}

export async function getPayrollDashboard(schoolId) {
  const [runs,profiles,staffMissing,history,collections] = await Promise.all([
    pool.query(`SELECT pr.public_ref,pr.title,pr.payroll_period_start,pr.payroll_period_end,pr.status,pr.currency,pr.total_gross_pay,pr.total_allowances,pr.total_deductions,pr.total_net_pay,pr.approved_at,pr.paid_at,creator.full_name created_by_name,approver.full_name approved_by_name,payer.full_name paid_by_name,
      (SELECT COUNT(*) FROM payroll_items pi WHERE pi.payroll_run_id=pr.id AND pi.school_id=pr.school_id) staff_count,
      (SELECT COUNT(*) FROM payroll_items pi WHERE pi.payroll_run_id=pr.id AND pi.school_id=pr.school_id AND pi.status IN ('draft','approved','withheld')) unpaid_count
      FROM payroll_runs pr LEFT JOIN users creator ON creator.id=pr.created_by LEFT JOIN users approver ON approver.id=pr.approved_by LEFT JOIN users payer ON payer.id=pr.paid_by
      WHERE pr.school_id=? ORDER BY pr.payroll_period_end DESC,pr.created_at DESC LIMIT 50`,[schoolId]),
    pool.query(`SELECT sp.public_ref,u.public_ref staff_ref,u.full_name,u.role,sp.base_salary,sp.currency,sp.payment_frequency,sp.bank_name,sp.bank_account_name,sp.mobile_money_provider,sp.is_active
      FROM staff_salary_profiles sp JOIN users u ON u.id=sp.staff_user_id AND u.school_id=sp.school_id WHERE sp.school_id=? ORDER BY u.full_name`,[schoolId]),
    pool.query(`SELECT u.public_ref staff_ref,u.full_name,u.role FROM users u LEFT JOIN staff_salary_profiles sp ON sp.staff_user_id=u.id AND sp.school_id=u.school_id AND sp.is_active=1
      WHERE u.school_id=? AND u.role IN ('teacher','headteacher','bursar') AND u.is_active=1 AND sp.id IS NULL ORDER BY u.full_name`,[schoolId]),
    pool.query("SELECT payroll_period_end,total_net_pay FROM payroll_runs WHERE school_id=? AND status IN ('approved','paid') ORDER BY payroll_period_end DESC LIMIT 12",[schoolId]),
    pool.query("SELECT COALESCE(SUM(amount),0) collected FROM fee_payments WHERE school_id=? AND status='posted' AND paid_at>=DATE_SUB(CURDATE(),INTERVAL 12 MONTH)",[schoolId]).catch(()=>[[]]),
  ])
  const runRows=runs[0], current=runRows.find((row)=>row.status!=="cancelled")||null
  const collected=money(collections?.[0]?.[0]?.collected)
  const payroll=money(current?.total_net_pay)
  return {settings:await getHrSettings(schoolId),current_run:current,runs:runRows,salary_profiles:profiles[0],missing_salary_profiles:staffMissing[0],history:history[0].reverse(),summary:{net_total:payroll,gross_total:money(current?.total_gross_pay),deductions:money(current?.total_deductions),allowances:money(current?.total_allowances),staff_count:Number(current?.staff_count||0),status:current?.status||"not_created",missing_profiles:staffMissing[0].length,fee_collections:collected,payroll_collection_percent:collected?Number(((payroll/collected)*100).toFixed(1)):0}}
}

export async function saveSalaryProfile(schoolId,actorId,profileRef,body={}) {
  const connection=await pool.getConnection()
  try{
    const staff=await userByRef(connection,schoolId,body.staff_user_ref)
    const base=money(body.base_salary); if(!(base>=0)) throw new HttpError(400,"Base salary must be zero or greater")
    const frequency=["monthly","weekly","termly","custom"].includes(body.payment_frequency)?body.payment_frequency:"monthly"
    if(profileRef){
      const [result]=await connection.query("UPDATE staff_salary_profiles SET staff_user_id=?,base_salary=?,currency=?,payment_frequency=?,bank_name=?,bank_account_name=?,bank_account_number=?,mobile_money_provider=?,mobile_money_number=?,is_active=? WHERE school_id=? AND public_ref=?",[staff.id,base,text(body.currency||"MWK",3).toUpperCase(),frequency,text(body.bank_name,120)||null,text(body.bank_account_name,160)||null,text(body.bank_account_number,120)||null,text(body.mobile_money_provider,80)||null,text(body.mobile_money_number,60)||null,body.is_active!==false,schoolId,profileRef]); if(!result.affectedRows) throw new HttpError(404,"Salary profile was not found")
    }else{
      await connection.query(`INSERT INTO staff_salary_profiles (public_ref,school_id,staff_user_id,base_salary,currency,payment_frequency,bank_name,bank_account_name,bank_account_number,mobile_money_provider,mobile_money_number,is_active,created_by)
       VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE base_salary=VALUES(base_salary),currency=VALUES(currency),payment_frequency=VALUES(payment_frequency),bank_name=VALUES(bank_name),bank_account_name=VALUES(bank_account_name),bank_account_number=VALUES(bank_account_number),mobile_money_provider=VALUES(mobile_money_provider),mobile_money_number=VALUES(mobile_money_number),is_active=VALUES(is_active)`,[schoolId,staff.id,base,text(body.currency||"MWK",3).toUpperCase(),frequency,text(body.bank_name,120)||null,text(body.bank_account_name,160)||null,text(body.bank_account_number,120)||null,text(body.mobile_money_provider,80)||null,text(body.mobile_money_number,60)||null,body.is_active!==false,actorId])
    }
    await audit(schoolId,actorId,profileRef?"SALARY_PROFILE_UPDATED":"SALARY_PROFILE_CREATED","staff_salary_profile",staff.id,{staff_ref:staff.public_ref,base_salary:base})
    const [[saved]]=await connection.query("SELECT public_ref FROM staff_salary_profiles WHERE school_id=? AND staff_user_id=?",[schoolId,staff.id]); return saved
  }finally{connection.release()}
}

export async function createPayrollRun(schoolId,actorId,body={}) {
  const start=dateValue(body.payroll_period_start,"Payroll period start"),end=dateValue(body.payroll_period_end,"Payroll period end"); daysInclusive(start,end)
  const title=text(body.title,180)||`Payroll ${start} to ${end}`, settings=await getHrSettings(schoolId)
  const [result]=await pool.query("INSERT INTO payroll_runs (public_ref,school_id,payroll_period_start,payroll_period_end,title,currency,created_by,notes) VALUES (UUID(),?,?,?,?,?,?,?)",[schoolId,start,end,title,settings.default_currency||"MWK",actorId,text(body.notes)||null])
  const [[run]]=await pool.query("SELECT public_ref FROM payroll_runs WHERE id=?",[result.insertId]); await audit(schoolId,actorId,"PAYROLL_RUN_CREATED","payroll_run",result.insertId,{title,start,end}); return run
}

export async function generatePayrollItems(schoolId,actorId,runRef) {
  const connection=await pool.getConnection()
  try{await connection.beginTransaction(); const run=await payrollRunByRef(connection,schoolId,runRef,true); if(run.status!=="draft") throw new HttpError(409,"Payroll items can only be generated while the run is draft")
    const [profiles]=await connection.query("SELECT * FROM staff_salary_profiles WHERE school_id=? AND is_active=1",[schoolId]); if(!profiles.length) throw new HttpError(409,"No staff salary profiles are configured yet")
    for(const profile of profiles){
      const [[unpaid]]=await connection.query("SELECT COALESCE(SUM(total_days),0) days FROM staff_leave_requests WHERE school_id=? AND staff_user_id=? AND leave_type='unpaid' AND status='approved' AND start_date<=? AND end_date>=?",[schoolId,profile.staff_user_id,run.payroll_period_end,run.payroll_period_start])
      await connection.query(`INSERT INTO payroll_items (public_ref,school_id,payroll_run_id,staff_user_id,base_salary,gross_pay,net_pay,unpaid_leave_days,status) VALUES (UUID(),?,?,?,?,?,?,?,'draft')
       ON DUPLICATE KEY UPDATE base_salary=VALUES(base_salary),gross_pay=base_salary+allowances_total,net_pay=GREATEST(base_salary+allowances_total-deductions_total,0),unpaid_leave_days=VALUES(unpaid_leave_days)`,[schoolId,run.id,profile.staff_user_id,profile.base_salary,profile.base_salary,profile.base_salary,money(unpaid.days)])
    }
    await recalculatePayroll(connection,schoolId,run.id); await connection.commit(); await audit(schoolId,actorId,"PAYROLL_ITEMS_GENERATED","payroll_run",run.id,{staff_count:profiles.length}); return getPayrollRun(schoolId,runRef)
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function getPayrollRun(schoolId,runRef) {
  const run=await payrollRunByRef(pool,schoolId,runRef)
  const [items]=await pool.query(`SELECT pi.public_ref,u.public_ref staff_ref,u.full_name,u.role,pi.base_salary,pi.allowances_total,pi.deductions_total,pi.gross_pay,pi.net_pay,pi.unpaid_leave_days,pi.status,pi.payment_reference,pi.notes
    FROM payroll_items pi JOIN users u ON u.id=pi.staff_user_id AND u.school_id=pi.school_id WHERE pi.school_id=? AND pi.payroll_run_id=? ORDER BY u.full_name`,[schoolId,run.id])
  const [components]=await pool.query(`SELECT pi.public_ref item_ref,'allowance' component_type,pa.public_ref,pa.title,pa.amount,pa.notes FROM payroll_allowances pa JOIN payroll_items pi ON pi.id=pa.payroll_item_id WHERE pa.school_id=? AND pi.payroll_run_id=?
    UNION ALL SELECT pi.public_ref,'deduction',pd.public_ref,pd.title,pd.amount,pd.notes FROM payroll_deductions pd JOIN payroll_items pi ON pi.id=pd.payroll_item_id WHERE pd.school_id=? AND pi.payroll_run_id=? ORDER BY item_ref,title`,[schoolId,run.id,schoolId,run.id])
  const people=await pool.query("SELECT u.full_name creator,a.full_name approver,p.full_name payer FROM payroll_runs pr LEFT JOIN users u ON u.id=pr.created_by LEFT JOIN users a ON a.id=pr.approved_by LEFT JOIN users p ON p.id=pr.paid_by WHERE pr.id=?",[run.id])
  const visible={...run,id:undefined,school_id:undefined,created_by:undefined,approved_by:undefined,paid_by:undefined,...people[0][0]}
  return {run:visible,items:items.map((item)=>({...item,components:components.filter((part)=>part.item_ref===item.public_ref)})),summary:{gross:money(run.total_gross_pay),allowances:money(run.total_allowances),deductions:money(run.total_deductions),net:money(run.total_net_pay),staff_count:items.length,unpaid_or_withheld:items.filter((item)=>["draft","approved","withheld"].includes(item.status)).length,unpaid_leave_days:money(items.reduce((sum,item)=>sum+Number(item.unpaid_leave_days||0),0))}}
}

export async function updatePayrollItem(schoolId,actorId,itemRef,body={}) {
  const connection=await pool.getConnection()
  try{await connection.beginTransaction(); const item=await payrollItemByRef(connection,schoolId,itemRef,true); if(item.run_status!=="draft") throw new HttpError(409,"Only draft payroll can be edited")
    if(body.base_salary!==undefined) await connection.query("UPDATE payroll_items SET base_salary=? WHERE id=?",[Math.max(0,money(body.base_salary)),item.id])
    if(body.status && ["draft","withheld"].includes(body.status)) await connection.query("UPDATE payroll_items SET status=? WHERE id=?",[body.status,item.id])
    if(body.payment_reference!==undefined||body.notes!==undefined) await connection.query("UPDATE payroll_items SET payment_reference=COALESCE(?,payment_reference),notes=COALESCE(?,notes) WHERE id=?",[text(body.payment_reference,160)||null,text(body.notes)||null,item.id])
    for(const kind of ["allowances","deductions"]){ if(!Array.isArray(body[kind])) continue; const table=kind==="allowances"?"payroll_allowances":"payroll_deductions"; await connection.query(`DELETE FROM ${table} WHERE school_id=? AND payroll_item_id=?`,[schoolId,item.id]); for(const part of body[kind]){const amount=money(part.amount);if(!(amount>0)||!text(part.title,140))continue;await connection.query(`INSERT INTO ${table} (public_ref,school_id,payroll_item_id,title,amount,notes) VALUES (UUID(),?,?,?,?,?)`,[schoolId,item.id,text(part.title,140),amount,text(part.notes)||null])}}
    await recalculatePayroll(connection,schoolId,item.payroll_run_id,item.id); await connection.commit(); await audit(schoolId,actorId,"PAYROLL_ITEM_UPDATED","payroll_item",item.id,{item_ref:itemRef}); return getPayrollRun(schoolId,item.run_ref)
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
}

export async function transitionPayrollRun(schoolId,actor,runRef,action) {
  const transitions={submit:["draft","pending_approval"],approve:["pending_approval","approved"],pay:["approved","paid"],cancel:[null,"cancelled"]}; const rule=transitions[action]; if(!rule) throw new HttpError(400,"Unsupported payroll action")
  const ownerIsFinalApprover=["school_owner","director","owner","super_admin"].includes(String(actor?.role||"").toLowerCase())
  const connection=await pool.getConnection(); let run
  try{await connection.beginTransaction();run=await payrollRunByRef(connection,schoolId,runRef,true);if(action==="cancel"&&["paid","cancelled"].includes(run.status))throw new HttpError(409,"Paid or already-cancelled payroll cannot be cancelled");const directOwnerApproval=action==="approve"&&ownerIsFinalApprover&&run.status==="draft";if(rule[0]&&run.status!==rule[0]&&!directOwnerApproval)throw new HttpError(409,`Payroll must be ${rule[0].replaceAll("_"," ")} before this action`)
    const [[count]]=await connection.query("SELECT COUNT(*) total FROM payroll_items WHERE school_id=? AND payroll_run_id=?",[schoolId,run.id]);if(["submit","approve","pay"].includes(action)&&!Number(count.total))throw new HttpError(409,"Generate payroll items before continuing")
    const extra=action==="approve"?",approved_by=?,approved_at=CURRENT_TIMESTAMP":action==="pay"?",paid_by=?,paid_at=CURRENT_TIMESTAMP":""; const params=[rule[1],...(extra?[actor.id]:[]),schoolId,run.id]
    await connection.query(`UPDATE payroll_runs SET status=?${extra} WHERE school_id=? AND id=?`,params)
    if(action==="approve")await connection.query("UPDATE payroll_items SET status='approved' WHERE school_id=? AND payroll_run_id=? AND status='draft'",[schoolId,run.id])
    if(action==="pay")await connection.query("UPDATE payroll_items SET status='paid' WHERE school_id=? AND payroll_run_id=? AND status='approved'",[schoolId,run.id])
    if(action==="cancel")await connection.query("UPDATE payroll_items SET status='cancelled' WHERE school_id=? AND payroll_run_id=? AND status<>'paid'",[schoolId,run.id])
    await connection.commit()
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
  await audit(schoolId,actor.id,`PAYROLL_${rule[1].toUpperCase()}`,"payroll_run",run.id,{run_ref:runRef,status:rule[1]})
  if(action==="submit")await broadcastSchoolNotification({schoolId,roles:["school_owner","director","owner"],excludeUserId:actor.id,title:"Payroll requires approval",message:`${run.title} has been submitted for approval.`,category:"finance",priority:"high",linkedEntityType:"payroll_run",linkedEntityId:run.id,createdBy:actor.id})
  if(action==="pay"){const [staff]=await pool.query("SELECT staff_user_id FROM payroll_items WHERE school_id=? AND payroll_run_id=? AND status='paid'",[schoolId,run.id]);await broadcastSchoolNotification({schoolId,userIds:staff.map((r)=>r.staff_user_id),title:"Payroll marked as paid",message:`${run.title} has been marked as paid.`,category:"finance",linkedEntityType:"payroll_run",linkedEntityId:run.id,createdBy:actor.id})}
  return getPayrollRun(schoolId,runRef)
}

async function leaveByRef(connection,schoolId,ref,lock=false){const [[row]]=await connection.query(`SELECT * FROM staff_leave_requests WHERE school_id=? AND public_ref=? LIMIT 1${lock?" FOR UPDATE":""}`,[schoolId,text(ref,36)]);if(!row)throw new HttpError(404,"Leave request was not found");return row}

const closedLeaveStatuses = new Set(["completed", "cancelled", "rejected"])
const leaveTransitionRules = Object.freeze({
  approve: { from: "pending", to: "approved" },
  reject: { from: "pending", to: "rejected" },
  cancel: { from: null, to: "cancelled" },
  complete: { from: "approved", to: "completed" },
})

export function planLeaveTransition(currentStatus, action) {
  const rule = leaveTransitionRules[action]
  if (!rule) throw new HttpError(400, "Unsupported leave action")
  if (currentStatus === rule.to) return { ...rule, applied: false, balanceDirection: 0 }
  if (rule.from && currentStatus !== rule.from) throw new HttpError(409, `Only ${rule.from} leave can be ${action}d`)
  if (closedLeaveStatuses.has(currentStatus)) throw new HttpError(409, "This leave request is already closed")
  return {
    ...rule,
    applied: true,
    balanceDirection: action === "approve" ? 1 : action === "cancel" && currentStatus === "approved" ? -1 : 0,
  }
}

export async function adjustLeaveBalance(connection, schoolId, leave, direction) {
  if (!direction) return
  const days = money(leave.total_days)
  const leaveYear = Number(String(leave.start_date).slice(0, 4))
  if (!(days > 0) || !Number.isInteger(leaveYear)) throw new HttpError(409, "Leave balance could not be adjusted because the leave dates or duration are invalid")

  const identity = [schoolId, leave.staff_user_id, leave.leave_type, leaveYear]
  if (direction > 0) {
    await connection.query(
      `INSERT INTO staff_leave_balances (public_ref,school_id,staff_user_id,leave_type,leave_year,entitlement_days,used_days,remaining_days)
       VALUES (UUID(),?,?,?,?,0,?,0)
       ON DUPLICATE KEY UPDATE used_days=used_days+VALUES(used_days)`,
      [...identity, days],
    )
  } else {
    await connection.query(
      `UPDATE staff_leave_balances
       SET used_days=GREATEST(used_days-?,0)
       WHERE school_id=? AND staff_user_id=? AND leave_type=? AND leave_year=?`,
      [days, ...identity],
    )
  }

  await connection.query(
    `UPDATE staff_leave_balances
     SET remaining_days=GREATEST(entitlement_days-used_days,0)
     WHERE school_id=? AND staff_user_id=? AND leave_type=? AND leave_year=?`,
    identity,
  )
}

export async function getLeaveDashboard(schoolId,filters={}) {
  const conditions=["lr.school_id=?"],params=[schoolId]
  if(filters.status){conditions.push("lr.status=?");params.push(filters.status)} if(filters.leave_type){conditions.push("lr.leave_type=?");params.push(filters.leave_type)}
  if(filters.staff_user_id){conditions.push("lr.staff_user_id=?");params.push(Number(filters.staff_user_id))}
  const [rows]=await pool.query(`SELECT lr.public_ref,u.public_ref staff_ref,u.full_name staff_name,u.role,lr.leave_type,lr.start_date,lr.end_date,lr.total_days,lr.reason,lr.status,coverage.public_ref coverage_ref,coverage.full_name coverage_name,approver.full_name approved_by_name,creator.full_name requested_by_name,lr.approved_at,lr.decision_notes,lr.created_at,
    GROUP_CONCAT(DISTINCT CONCAT(c.name,COALESCE(CONCAT(' · ',subj.name),'')) ORDER BY c.name SEPARATOR ', ') affected_responsibilities
    FROM staff_leave_requests lr JOIN users u ON u.id=lr.staff_user_id AND u.school_id=lr.school_id LEFT JOIN users coverage ON coverage.id=lr.coverage_staff_user_id LEFT JOIN users approver ON approver.id=lr.approved_by LEFT JOIN users creator ON creator.id=lr.created_by
    LEFT JOIN teacher_class_subject_assignments a ON a.teacher_id=lr.staff_user_id AND a.school_id=lr.school_id AND a.is_active=1 LEFT JOIN classes c ON c.id=a.class_id LEFT JOIN subjects subj ON subj.id=a.subject_id
    WHERE ${conditions.join(" AND ")} GROUP BY lr.id,u.public_ref,u.full_name,u.role,coverage.public_ref,coverage.full_name,approver.full_name,creator.full_name ORDER BY lr.start_date DESC,lr.created_at DESC`,params)
  const today=new Date().toISOString().slice(0,10),weekEnd=new Date(Date.now()+7*86400000).toISOString().slice(0,10)
  const current=rows.filter((r)=>r.status==="approved"&&String(r.start_date).slice(0,10)<=today&&String(r.end_date).slice(0,10)>=today)
  const typeCounts=rows.reduce((m,r)=>(m[r.leave_type]=(m[r.leave_type]||0)+1,m),{})
  return {settings:await getHrSettings(schoolId),requests:rows,summary:{currently_on_leave:current.length,pending:rows.filter((r)=>r.status==="pending").length,ending_this_week:current.filter((r)=>String(r.end_date).slice(0,10)<=weekEnd).length,uncovered:current.filter((r)=>!r.coverage_ref).length,approved:rows.filter((r)=>r.status==="approved").length,rejected_or_cancelled:rows.filter((r)=>["rejected","cancelled"].includes(r.status)).length},leave_by_type:Object.entries(typeCounts).map(([name,value])=>({name,value}))}
}

const teacherLeaveRequestsAllowed = (actor, settings) => String(actor?.role || "").toLowerCase() !== "teacher" || settings?.allow_teacher_leave_requests === true || Number(settings?.allow_teacher_leave_requests) === 1

export async function getOwnLeaveDashboard(schoolId,actor) {
  const userId=Number(actor?.id)
  const dashboard=await getLeaveDashboard(schoolId,{staff_user_id:userId})
  const [balances]=await pool.query("SELECT public_ref,leave_type,leave_year,entitlement_days,used_days,remaining_days FROM staff_leave_balances WHERE school_id=? AND staff_user_id=? ORDER BY leave_year DESC,leave_type",[schoolId,userId])
  const today=new Date().toISOString().slice(0,10)
  const upcoming=dashboard.requests.filter((row)=>["pending","approved"].includes(row.status)&&String(row.end_date).slice(0,10)>=today).length
  return {...dashboard,balances,can_request_leave:teacherLeaveRequestsAllowed(actor,dashboard.settings),summary:{...dashboard.summary,upcoming}}
}

export async function getLeaveRequest(schoolId,ref){const leave=await leaveByRef(pool,schoolId,ref);const dashboard=await getLeaveDashboard(schoolId);const request=dashboard.requests.find((r)=>r.public_ref===ref);const [balances]=await pool.query("SELECT public_ref,leave_type,leave_year,entitlement_days,used_days,remaining_days FROM staff_leave_balances WHERE school_id=? AND staff_user_id=? ORDER BY leave_year DESC,leave_type",[schoolId,leave.staff_user_id]);return {request,balances}}

export async function createLeaveRequest(schoolId,actor,body={}) {
  const connection=await pool.getConnection();let staff,result
  try{staff=await userByRef(connection,schoolId,body.staff_user_ref||actor.publicRef);const type=leaveTypes.has(body.leave_type)?body.leave_type:"other",start=dateValue(body.start_date,"Leave start date"),end=dateValue(body.end_date,"Leave end date"),days=daysInclusive(start,end),reason=text(body.reason);if(!reason)throw new HttpError(400,"Leave reason is required")
    const [[overlap]]=await connection.query("SELECT public_ref FROM staff_leave_requests WHERE school_id=? AND staff_user_id=? AND status IN ('pending','approved') AND start_date<=? AND end_date>=? LIMIT 1",[schoolId,staff.id,end,start]);if(overlap)throw new HttpError(409,"This staff member already has an overlapping leave request")
    let coverage=null;if(body.coverage_staff_ref){coverage=await userByRef(connection,schoolId,body.coverage_staff_ref);if(coverage.id===staff.id)throw new HttpError(400,"Coverage must be assigned to another staff member")}
    ;[result]=await connection.query("INSERT INTO staff_leave_requests (public_ref,school_id,staff_user_id,leave_type,start_date,end_date,total_days,reason,coverage_staff_user_id,created_by) VALUES (UUID(),?,?,?,?,?,?,?,?,?)",[schoolId,staff.id,type,start,end,days,reason,coverage?.id||null,actor.id])
    const [[saved]]=await connection.query("SELECT public_ref FROM staff_leave_requests WHERE id=?",[result.insertId]);await audit(schoolId,actor.id,"LEAVE_REQUEST_CREATED","staff_leave",result.insertId,{staff_ref:staff.public_ref,type,start,end});
    const settings=await getHrSettings(schoolId);if(settings.notify_director_leave_request)await broadcastSchoolNotification({schoolId,roles:["school_owner","director","owner","headteacher"],excludeUserId:actor.id,title:"Leave request awaiting review",message:`${staff.full_name} requested ${type.replaceAll("_"," ")} leave from ${start} to ${end}.`,category:"staff",priority:"high",linkedEntityType:"staff_leave",linkedEntityId:result.insertId,createdBy:actor.id});return {public_ref:saved.public_ref}
  }finally{connection.release()}
}

export async function createOwnLeaveRequest(schoolId,actor,body={}) {
  const settings=await getHrSettings(schoolId)
  if(!teacherLeaveRequestsAllowed(actor,settings))throw new HttpError(403,"Teacher leave requests are disabled by the school's leave settings")
  const [[staff]]=await pool.query("SELECT public_ref FROM users WHERE school_id=? AND id=? AND is_active=1 LIMIT 1",[schoolId,actor.id])
  if(!staff)throw new HttpError(403,"Your staff account is not active in this school")
  return createLeaveRequest(schoolId,actor,{...body,staff_user_ref:staff.public_ref,coverage_staff_ref:null})
}

export async function cancelOwnLeaveRequest(schoolId,actor,ref) {
  const connection=await pool.getConnection()
  let leave
  try{
    await connection.beginTransaction()
    leave=await leaveByRef(connection,schoolId,ref,true)
    if(Number(leave.staff_user_id)!==Number(actor.id))throw new HttpError(403,"You can only cancel your own leave request")
    if(leave.status!=="pending")throw new HttpError(409,"Only a pending leave request can be cancelled by staff")
    await connection.query("UPDATE staff_leave_requests SET status='cancelled',decision_notes=COALESCE(decision_notes,'Cancelled by staff member') WHERE id=? AND school_id=?",[leave.id,schoolId])
    await connection.commit()
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
  await audit(schoolId,actor.id,"LEAVE_CANCELLED_BY_STAFF","staff_leave",leave.id,{leave_ref:ref})
  await broadcastSchoolNotification({schoolId,roles:["school_owner","director","owner","headteacher"],excludeUserId:actor.id,title:"Leave request cancelled",message:`A pending ${String(leave.leave_type).replaceAll("_"," ")} leave request was cancelled by the staff member.`,category:"staff",linkedEntityType:"staff_leave",linkedEntityId:leave.id,createdBy:actor.id})
  return {ok:true,public_ref:ref,status:"cancelled"}
}

export async function transitionLeave(schoolId,actor,ref,action,body={}) {
  const connection=await pool.getConnection();let leave,staff,coverage,transition
  try{await connection.beginTransaction();leave=await leaveByRef(connection,schoolId,ref,true);transition=planLeaveTransition(leave.status,action)
    if(transition.applied){
      const coverageProvided=Object.prototype.hasOwnProperty.call(body,"coverage_staff_ref")
      if(coverageProvided&&body.coverage_staff_ref){coverage=await userByRef(connection,schoolId,body.coverage_staff_ref);if(coverage.id===leave.staff_user_id)throw new HttpError(400,"Coverage must be assigned to another staff member")}
      else if(!coverageProvided&&leave.coverage_staff_user_id){[[coverage]]=await connection.query("SELECT id,public_ref,full_name FROM users WHERE school_id=? AND id=? LIMIT 1",[schoolId,leave.coverage_staff_user_id])}
      const approval=action==="approve"?",approved_by=?,approved_at=CURRENT_TIMESTAMP":""
      const coverageUpdate=coverageProvided?"coverage_staff_user_id=?":"coverage_staff_user_id=coverage_staff_user_id"
      const [updated]=await connection.query(`UPDATE staff_leave_requests SET status=?,${coverageUpdate},decision_notes=COALESCE(?,decision_notes)${approval} WHERE id=? AND school_id=? AND status=?`,[transition.to,...(coverageProvided?[coverage?.id||null]:[]),text(body.decision_notes)||null,...(approval?[actor.id]:[]),leave.id,schoolId,leave.status])
      if(!updated.affectedRows)throw new HttpError(409,"The leave request changed while this action was being processed")
      await adjustLeaveBalance(connection,schoolId,leave,transition.balanceDirection)
      ;[[staff]]=await connection.query("SELECT id,full_name FROM users WHERE school_id=? AND id=?",[schoolId,leave.staff_user_id])
    }
    await connection.commit()
  }catch(error){await connection.rollback();throw error}finally{connection.release()}
  if(!transition.applied)return getLeaveRequest(schoolId,ref)
  await audit(schoolId,actor.id,`LEAVE_${transition.to.toUpperCase()}`,"staff_leave",leave.id,{leave_ref:ref,coverage_ref:coverage?.public_ref||null})
  await createInAppNotification({schoolId,recipientUserId:staff.id,title:`Leave request ${transition.to.replaceAll("_"," ")}`,message:`Your ${leave.leave_type.replaceAll("_"," ")} leave request has been ${transition.to.replaceAll("_"," ")}.`,category:"staff",priority:"medium",linkedEntityType:"staff_leave",linkedEntityId:leave.id,createdBy:actor.id})
  if(action==="approve"&&coverage)await createInAppNotification({schoolId,recipientUserId:coverage.id,title:"Leave coverage assigned",message:`You have been assigned to cover ${staff.full_name} from ${String(leave.start_date).slice(0,10)} to ${String(leave.end_date).slice(0,10)}.`,category:"staff",priority:"high",linkedEntityType:"staff_leave",linkedEntityId:leave.id,createdBy:actor.id})
  if(action==="approve"&&!coverage){const settings=await getHrSettings(schoolId);if(settings.require_leave_coverage)await createDirectorTask(schoolId,actor.id,{title:`Assign coverage for ${staff.full_name}'s leave`,description:`Approved ${leave.leave_type} leave from ${String(leave.start_date).slice(0,10)} to ${String(leave.end_date).slice(0,10)} has no coverage teacher.`,category:"staff",priority:"high",assigned_to_user_id:actor.id,due_date:String(leave.start_date).slice(0,10),linked_entity_type:"staff_leave",linked_entity_id:leave.id,context_snapshot:{staff_name:staff.full_name,leave_type:leave.leave_type}})}
  return getLeaveRequest(schoolId,ref)
}

export async function updateLeaveRequest(schoolId,actorId,ref,body={}) {
  const connection=await pool.getConnection();try{const leave=await leaveByRef(connection,schoolId,ref);if(!["pending","approved"].includes(leave.status))throw new HttpError(409,"Closed leave cannot be edited");const coverageProvided=Object.prototype.hasOwnProperty.call(body,"coverage_staff_ref"),notesProvided=Object.prototype.hasOwnProperty.call(body,"decision_notes");let coverage=null;if(coverageProvided&&body.coverage_staff_ref){coverage=await userByRef(connection,schoolId,body.coverage_staff_ref);if(coverage.id===leave.staff_user_id)throw new HttpError(400,"Coverage must be assigned to another staff member")};const updates=[],params=[];if(coverageProvided){updates.push("coverage_staff_user_id=?");params.push(coverage?.id||null)}if(notesProvided){updates.push("decision_notes=?");params.push(text(body.decision_notes)||null)}if(updates.length)await connection.query(`UPDATE staff_leave_requests SET ${updates.join(",")} WHERE id=? AND school_id=?`,[...params,leave.id,schoolId]);await audit(schoolId,actorId,"LEAVE_COVERAGE_UPDATED","staff_leave",leave.id,{coverage_ref:coverageProvided?coverage?.public_ref||null:undefined});return getLeaveRequest(schoolId,ref)}finally{connection.release()}
}

export async function saveLeaveBalance(schoolId,actorId,ref,body={}) {
  const [result]=await pool.query("UPDATE staff_leave_balances SET entitlement_days=?,remaining_days=GREATEST(?-used_days,0) WHERE school_id=? AND public_ref=?",[Math.max(0,Number(body.entitlement_days||0)),Math.max(0,Number(body.entitlement_days||0)),schoolId,ref]);if(!result.affectedRows)throw new HttpError(404,"Leave balance was not found");await audit(schoolId,actorId,"LEAVE_BALANCE_UPDATED","staff_leave_balance",null,{ref,entitlement_days:body.entitlement_days});return {ok:true}
}
