import { getScopedSchoolId } from "../utils/tenantScope.js"
import {
  cancelOwnLeaveRequest,
  createOwnLeaveRequest,
  createLeaveRequest,
  createPayrollRun,
  generatePayrollItems,
  getHrSettings,
  getLeaveDashboard,
  getOwnLeaveDashboard,
  getLeaveRequest,
  getPayrollDashboard,
  getPayrollRun,
  saveHrSettings,
  saveLeaveBalance,
  saveSalaryProfile,
  transitionLeave,
  transitionPayrollRun,
  updateLeaveRequest,
  updatePayrollItem,
} from "../services/hrOperationsService.js"

const school = (req) => getScopedSchoolId(req)

export async function payrollDashboard(req,res){res.json(await getPayrollDashboard(school(req)))}
export async function payrollRun(req,res){res.json(await getPayrollRun(school(req),req.params.runRef))}
export async function createRun(req,res){res.status(201).json(await createPayrollRun(school(req),req.user.id,req.body))}
export async function generateItems(req,res){res.json(await generatePayrollItems(school(req),req.user.id,req.params.runRef))}
export async function patchPayrollItem(req,res){res.json(await updatePayrollItem(school(req),req.user.id,req.params.itemRef,req.body))}
export async function saveProfile(req,res){res.status(req.params.profileRef?200:201).json(await saveSalaryProfile(school(req),req.user.id,req.params.profileRef||null,req.body))}
export async function payrollTransition(req,res){res.json(await transitionPayrollRun(school(req),req.user,req.params.runRef,req.params.action))}
export async function leaveDashboard(req,res){res.json(await getLeaveDashboard(school(req),req.query))}
export async function leaveRequest(req,res){res.json(await getLeaveRequest(school(req),req.params.leaveRef))}
export async function createLeave(req,res){res.status(201).json(await createLeaveRequest(school(req),req.user,req.body))}
export async function myLeaveDashboard(req,res){res.json(await getOwnLeaveDashboard(school(req),req.user))}
export async function createMyLeave(req,res){res.status(201).json(await createOwnLeaveRequest(school(req),req.user,req.body))}
export async function cancelMyLeave(req,res){res.json(await cancelOwnLeaveRequest(school(req),req.user,req.params.leaveRef))}
export async function patchLeave(req,res){res.json(await updateLeaveRequest(school(req),req.user.id,req.params.leaveRef,req.body))}
export async function leaveTransition(req,res){res.json(await transitionLeave(school(req),req.user,req.params.leaveRef,req.params.action,req.body))}
export async function patchLeaveBalance(req,res){res.json(await saveLeaveBalance(school(req),req.user.id,req.params.balanceRef,req.body))}
export async function hrSettings(req,res){res.json(await getHrSettings(school(req)))}
export async function patchHrSettings(req,res){res.json(await saveHrSettings(school(req),req.user.id,req.body))}
