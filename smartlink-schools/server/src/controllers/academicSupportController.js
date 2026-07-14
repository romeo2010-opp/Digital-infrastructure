import { getScopedSchoolId } from "../utils/tenantScope.js"
import {
  assignSupportCase,
  carryForwardSupportCase,
  createSupportIntervention,
  draftGuardianSummary,
  escalateSupportCase,
  getEscalationPolicy,
  getLearnerSupport,
  getSupportCase,
  getSupportEvidence,
  getSupportInterventions,
  getSupportTimeline,
  listSupportCases,
  recordSupportSession,
  requestAcademicReview,
  resolveSupportCase,
  reviewSupportOutcome,
  scheduleSupportReassessment,
} from "../services/academicSupportService.js"

const school = (req) => getScopedSchoolId(req)
const caseId = (req) => String(req.params.caseId || "")

export async function supportCases(req, res) { res.json(await listSupportCases(school(req), req.user, req.query)) }
export async function supportCase(req, res) { res.json(await getSupportCase(school(req), caseId(req), req.user)) }
export async function learnerSupport(req, res) { res.json(await getLearnerSupport(school(req), req.params.learnerId, req.user)) }
export async function supportTimeline(req, res) { res.json(await getSupportTimeline(school(req), caseId(req), req.user, req.query)) }
export async function supportEvidence(req, res) { res.json(await getSupportEvidence(school(req), caseId(req), req.user)) }
export async function supportInterventions(req, res) { res.json(await getSupportInterventions(school(req), caseId(req), req.user)) }
export async function escalationPolicy(req, res) { res.json(await getEscalationPolicy(school(req))) }
export async function postSupportAssignment(req, res) { res.json(await assignSupportCase(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportIntervention(req, res) { res.status(201).json(await createSupportIntervention(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportSession(req, res) { res.status(201).json(await recordSupportSession(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportReassessment(req, res) { res.status(201).json(await scheduleSupportReassessment(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportOutcome(req, res) { res.json(await reviewSupportOutcome(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportEscalation(req, res) { res.json(await escalateSupportCase(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportResolution(req, res) { res.json(await resolveSupportCase(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportCarryForward(req, res) { res.status(201).json(await carryForwardSupportCase(school(req), caseId(req), req.user, req.body || {})) }
export async function postAcademicReviewRequest(req, res) { res.status(201).json(await requestAcademicReview(school(req), caseId(req), req.user, req.body || {})) }
export async function postGuardianSummaryDraft(req, res) { res.status(201).json(await draftGuardianSummary(school(req), caseId(req), req.user, req.body || {})) }
