import { buildDirectorPage, directorSummary, saveDirectorSettings } from "../services/directorAnalyticsService.js"
import { getScopedSchoolId } from "../utils/tenantScope.js"
import { createDirectorTask, deleteDirectorTask, getDailyClosure, getDirectorTask, getUnreadNotificationCount, listDirectorTasks, listUserNotifications, markUserNotification, reviewDailyClosure, updateDirectorTask } from "../services/directorOperationsService.js"
import { createPaymentPromise, escalateToHeadteacher, getStaffAttendanceToday, getWhatsAppSettings, recordStaffAttendance, saveWhatsAppSettings, selfCheckIn, sendFeeReminder, sendOperationalReminder, updatePaymentPromise } from "../services/operationalCommunicationService.js"
import { runReminderEngine } from "../services/reminderEngine.js"

export async function getDirectorOverview(req, res) {
  const schoolId = getScopedSchoolId(req)
  res.json({ overview: await directorSummary(schoolId) })
}

export async function getDirectorPage(req, res) {
  const schoolId = getScopedSchoolId(req)
  const page = await buildDirectorPage(schoolId, req.params.section || "overview", req.query || {})
  res.json({ page })
}

export async function getDirectorMappedPage(req, res) {
  const schoolId = getScopedSchoolId(req)
  const section = req.directorSection || req.params.section || "overview"
  const detailId = req.params.subjectId || req.params.batchId || req.params.classId || req.params.withdrawalId || req.params.teacherId || req.params.studentId || req.params.id || null
  const page = await buildDirectorPage(schoolId, section, { ...(req.query || {}), detail_id: detailId })
  res.json({ page })
}

export async function patchDirectorSettings(req, res) {
  const schoolId = getScopedSchoolId(req)
  const settings = await saveDirectorSettings(schoolId, req.user?.id, req.body || {})
  res.json({ settings })
}

export async function listTasks(req, res) {
  res.json({ tasks: await listDirectorTasks(getScopedSchoolId(req), req.query || {}, req.user) })
}

export async function createTask(req, res) {
  res.status(201).json({ task: await createDirectorTask(getScopedSchoolId(req), req.user.id, req.body || {}) })
}

export async function getTask(req,res) { res.json({ task: await getDirectorTask(getScopedSchoolId(req),req.params.taskId,req.user) }) }

export async function patchTask(req, res) {
  res.json({ task: await updateDirectorTask(getScopedSchoolId(req), req.params.taskId, req.user, req.body || {}) })
}

export async function completeTask(req, res) {
  res.json({ task: await updateDirectorTask(getScopedSchoolId(req), req.params.taskId, req.user, { ...(req.body || {}), status: "completed" }) })
}

export async function cancelTask(req, res) {
  res.json({ task: await updateDirectorTask(getScopedSchoolId(req), req.params.taskId, req.user, { status: "cancelled" }) })
}
export async function deleteTask(req,res) { res.json(await deleteDirectorTask(getScopedSchoolId(req),req.params.taskId,req.user)) }

export async function dailyClosure(req, res) {
  res.json({ closure: await getDailyClosure(getScopedSchoolId(req), req.query.date) })
}

export async function markDailyClosureReviewed(req, res) {
  res.json({ closure: await reviewDailyClosure(getScopedSchoolId(req), req.user.id, req.body || {}) })
}

export async function notifications(req,res) { res.json({ notifications: await listUserNotifications(getScopedSchoolId(req),req.user.id) }) }
export async function unreadNotifications(req,res) { res.json({unread_count:await getUnreadNotificationCount(getScopedSchoolId(req),req.user.id)}) }
export async function readNotification(req,res) { res.json(await markUserNotification(getScopedSchoolId(req),req.user.id,req.params.notificationId,"read")) }
export async function dismissNotification(req,res) { res.json(await markUserNotification(getScopedSchoolId(req),req.user.id,req.params.notificationId,"dismissed")) }
export async function remind(req,res) { res.status(201).json(await sendOperationalReminder(getScopedSchoolId(req),req.user.id,req.body||{})) }
export async function escalate(req,res) { res.status(201).json(await escalateToHeadteacher(getScopedSchoolId(req),req.user.id,req.body||{})) }
export async function staffAttendanceToday(req,res) { res.json({attendance:await getStaffAttendanceToday(getScopedSchoolId(req),req.query.date)}) }
export async function recordAttendance(req,res) { res.json({attendance:await recordStaffAttendance(getScopedSchoolId(req),req.user,req.body||{})}) }
export async function teacherSelfCheckIn(req,res) { res.json(await selfCheckIn(getScopedSchoolId(req),req.user)) }
export async function feeReminder(req,res) { res.status(201).json(await sendFeeReminder(getScopedSchoolId(req),req.user.id,req.body||{})) }
export async function paymentPromise(req,res) { res.status(201).json({promise:await createPaymentPromise(getScopedSchoolId(req),req.user.id,req.body||{})}) }
export async function patchPaymentPromise(req,res) { res.json(await updatePaymentPromise(getScopedSchoolId(req),req.params.promiseId,req.body||{})) }
export async function whatsappSettings(req,res) { res.json(await getWhatsAppSettings(getScopedSchoolId(req))) }
export async function patchWhatsappSettings(req,res) { res.json(await saveWhatsAppSettings(getScopedSchoolId(req),req.user.id,req.body||{})) }
export async function executeReminderEngine(req,res) { res.json(await runReminderEngine(getScopedSchoolId(req),req.user.id)) }
