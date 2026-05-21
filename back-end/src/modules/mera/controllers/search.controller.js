import { ok } from "../../../utils/http.js"
import * as searchService from "../services/search.service.js"

export async function quickSearch(req, res) {
  return ok(res, await searchService.quickSearch(req.query, req.meraAuth))
}

export async function fullSearch(req, res) {
  return ok(res, await searchService.fullSearch(req.query, req.meraAuth))
}

export async function getLicenseDetail(req, res) {
  return ok(
    res,
    await searchService.getLicenseDetail(req.params.licenseId, req.meraAuth, {
      fromSearch: String(req.query?.fromSearch || "").toLowerCase() === "true",
    })
  )
}

export async function getStationManagerDetail(req, res) {
  return ok(res, await searchService.getStationManagerDetail(req.params.publicId, req.meraAuth))
}

export async function getStationDetail(req, res) {
  return ok(res, await searchService.getStationDetail(req.params.publicId, req.meraAuth))
}

export async function getComplaintDetail(req, res) {
  return ok(res, await searchService.getComplaintDetail(req.params.publicId, req.meraAuth))
}

export async function getCaseDetail(req, res) {
  return ok(res, await searchService.getCaseDetail(req.params.caseId, req.meraAuth))
}

export async function getTaskEvidenceDetail(req, res) {
  return ok(res, await searchService.getTaskEvidenceDetail(req.params.evidenceId, req.meraAuth))
}

export async function getComplaintMediaDetail(req, res) {
  return ok(res, await searchService.getComplaintMediaDetail(req.params.publicId, req.meraAuth))
}

export async function getUserDetail(req, res) {
  return ok(res, await searchService.getUserDetail(req.params.publicId, req.meraAuth))
}
