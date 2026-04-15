import { ok } from "../../utils/http.js"
import * as settingsService from "./settings.service.js"

export async function getSettings(req, res) {
  const data = await settingsService.getSettingsSnapshot(req.params.stationPublicId)
  return ok(res, data)
}

export async function patchStation(req, res) {
  const data = await settingsService.patchStation({
    stationPublicId: req.params.stationPublicId,
    userId: req.auth?.userId,
    payload: req.body,
  })
  return ok(res, data)
}

export async function getTanks(req, res) {
  const data = await settingsService.listTanks(req.params.stationPublicId)
  return ok(res, data)
}

export async function createTank(req, res) {
  const data = await settingsService.createTank({
    stationPublicId: req.params.stationPublicId,
    userId: req.auth?.userId,
    payload: req.body,
  })
  return ok(res, data, 201)
}

export async function patchTank(req, res) {
  const data = await settingsService.patchTank({
    stationPublicId: req.params.stationPublicId,
    tankPublicId: req.params.tankPublicId,
    userId: req.auth?.userId,
    payload: req.body,
  })
  return ok(res, data)
}

export async function getPumps(req, res) {
  const data = await settingsService.listPumps(req.params.stationPublicId)
  return ok(res, data)
}

export async function createPump(req, res) {
  const data = await settingsService.createPump({
    stationPublicId: req.params.stationPublicId,
    userId: req.auth?.userId,
    payload: req.body,
  })
  return ok(res, data, 201)
}

export async function patchPump(req, res) {
  const data = await settingsService.patchPump({
    stationPublicId: req.params.stationPublicId,
    pumpPublicId: req.params.pumpPublicId,
    userId: req.auth?.userId,
    payload: req.body,
  })
  return ok(res, data)
}

export async function createPumpNozzle(req, res) {
  const data = await settingsService.createPumpNozzle({
    stationPublicId: req.params.stationPublicId,
    pumpPublicId: req.params.pumpPublicId,
    userId: req.auth?.userId,
    payload: req.body,
  })
  return ok(res, data, 201)
}

export async function patchPumpNozzle(req, res) {
  const data = await settingsService.patchPumpNozzle({
    stationPublicId: req.params.stationPublicId,
    nozzlePublicId: req.params.nozzlePublicId,
    userId: req.auth?.userId,
    payload: req.body,
  })
  return ok(res, data)
}

export async function deletePumpNozzle(req, res) {
  const data = await settingsService.deletePumpNozzle({
    stationPublicId: req.params.stationPublicId,
    nozzlePublicId: req.params.nozzlePublicId,
    userId: req.auth?.userId,
  })
  return ok(res, data)
}

export async function deletePump(req, res) {
  const data = await settingsService.deletePump({
    stationPublicId: req.params.stationPublicId,
    pumpPublicId: req.params.pumpPublicId,
    userId: req.auth?.userId,
  })
  return ok(res, data)
}

export async function getStaff(req, res) {
  const data = await settingsService.listStaff(req.params.stationPublicId)
  return ok(res, data)
}

export async function patchStaff(req, res) {
  const data = await settingsService.patchStaff({
    stationPublicId: req.params.stationPublicId,
    staffId: Number(req.params.staffId),
    userId: req.auth?.userId,
    payload: req.body,
  })
  return ok(res, data)
}

export async function patchMe(req, res) {
  const data = await settingsService.patchMe({
    userId: req.auth?.userId,
    auth: req.auth,
    payload: req.body,
  })
  return ok(res, data)
}

export async function getMe(req, res) {
  const data = await settingsService.getMe({
    userId: req.auth?.userId,
    auth: req.auth,
  })
  return ok(res, data)
}

export async function getMyPreferences(req, res) {
  const data = await settingsService.getMyPreferences({
    userId: req.auth?.userId,
  })
  return ok(res, data)
}

export async function patchMyPreferences(req, res) {
  const data = await settingsService.patchMyPreferences({
    userId: req.auth?.userId,
    auth: req.auth,
    payload: req.body,
  })
  return ok(res, data)
}

export async function exportMyData(req, res) {
  const data = await settingsService.exportMyData({
    userId: req.auth?.userId,
    auth: req.auth,
  })
  return ok(res, data)
}

export async function requestDeleteMyAccount(req, res) {
  const data = await settingsService.requestDeleteMyAccount({
    userId: req.auth?.userId,
    auth: req.auth,
    payload: req.body,
  })
  return ok(res, data)
}

export async function patchQueue(req, res) {
  const data = await settingsService.patchQueue({
    stationPublicId: req.params.stationPublicId,
    userId: req.auth?.userId,
    payload: req.body,
  })
  return ok(res, data)
}
