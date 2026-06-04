import { ok } from "../../../utils/http.js"
import * as searchService from "../services/search.service.js"
import * as commandCentreService from "../services/commandCentre.service.js"
import * as globalSearchService from "../services/meraGlobalSearch.service.js"

export async function quickSearch(req, res) {
  const payload = await searchService.quickSearch(req.query, req.meraAuth)
  return ok(res, await globalSearchService.augmentSearchResponse(payload, req.query?.q || req.query?.query, req.meraAuth))
}

export async function fullSearch(req, res) {
  const payload = await searchService.fullSearch(req.query, req.meraAuth)
  const augmented = await globalSearchService.augmentSearchResponse(payload, req.query?.q || req.query?.query, req.meraAuth, {
    limit: Math.min(Number(req.query?.limit || 20), 20),
  })
  const results = augmented.groups.flatMap((group) =>
    (group.results || []).map((result) => ({ ...result, groupType: group.type, groupLabel: group.label }))
  )
  return ok(res, { ...augmented, results, total: results.length })
}

export async function suggestions(req, res) {
  return ok(res, await globalSearchService.searchSuggestions(req.query, req.meraAuth))
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
  const commandCase = await commandCentreService.getCaseRecordDetail(req.params.caseId, req.meraAuth).catch(() => null)
  if (commandCase?.case?.caseId) return ok(res, commandCase)
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
