import { ok } from "../../../utils/http.js"
import * as taskService from "../services/task.service.js"

export async function listTasks(req, res) {
  return ok(res, await taskService.listTasks(req.query, req.meraAuth))
}

export async function listMyTasks(req, res) {
  return ok(res, await taskService.listMyTasks(req.query, req.meraAuth))
}

export async function getTask(req, res) {
  return ok(res, await taskService.getTask(req.params.taskNumber, req.meraAuth))
}

export async function createTask(req, res) {
  return ok(res, await taskService.createTask(req.body, req.meraAuth), 201)
}

export async function updateTask(req, res) {
  return ok(res, await taskService.updateTask(req.params.taskNumber, req.body, req.meraAuth))
}

export async function changeTaskStatus(req, res) {
  return ok(res, await taskService.changeTaskStatus(req.params.taskNumber, req.body, req.meraAuth))
}

export async function addTaskNote(req, res) {
  return ok(res, await taskService.addTaskNote(req.params.taskNumber, req.body, req.meraAuth), 201)
}

export async function addTaskEvidence(req, res) {
  return ok(
    res,
    await taskService.addTaskEvidence(
      req.params.taskNumber,
      {
        ...req.body,
        fileUrl: req.uploadedFileUrl || req.body?.fileUrl || null,
        evidenceType: req.body?.evidenceType || req.uploadedFileType || "DOCUMENT",
      },
      req.meraAuth
    ),
    201
  )
}

export async function escalateTask(req, res) {
  return ok(res, await taskService.escalateTask(req.params.taskNumber, req.body, req.meraAuth))
}

export async function completeTask(req, res) {
  return ok(res, await taskService.completeTask(req.params.taskNumber, req.body, req.meraAuth))
}

export async function taskStatsOverview(req, res) {
  return ok(res, await taskService.getTaskStatsOverview(req.meraAuth))
}

export async function listAssignableUsers(req, res) {
  return ok(res, await taskService.listAssignableUsers(req.meraAuth))
}

export async function listNotifications(req, res) {
  return ok(res, await taskService.listNotifications(req.query, req.meraAuth))
}

export async function markNotificationRead(req, res) {
  return ok(res, await taskService.markNotificationRead(req.params.publicId, req.meraAuth))
}
