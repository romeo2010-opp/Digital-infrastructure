import { getScopedSchoolId } from "../utils/tenantScope.js"
import {
  acceptSupportOwnership,
  acknowledgeSupportCase,
  addSupportNote,
  assignSupportCase,
  carryForwardSupportCase,
  completeSupportAssignment,
  createCaseTargetedAssessment,
  createSupportIntervention,
  draftGuardianSummary,
  escalateSupportCase,
  getEscalationPolicy,
  getLearnerSupport,
  getSupportCase,
  getSupportEvidence,
  getSupportInterventions,
  getSupportTimeline,
  getTeacherSupportSummary,
  listSupportCases,
  recordSupportSession,
  requestAcademicReview,
  requestSupportReassignment,
  resolveSupportCase,
  reviewSupportOutcome,
  scheduleSupportReassessment,
} from "../services/academicSupportService.js"

const school = (req) => getScopedSchoolId(req)
const caseId = (req) => String(req.params.caseId || "")

export async function supportCases(req, res) { res.json(await listSupportCases(school(req), req.user, req.query)) }
export async function teacherSupportSummary(req, res) { res.json(await getTeacherSupportSummary(school(req), req.user)) }
export async function supportCase(req, res) { res.json(await getSupportCase(school(req), caseId(req), req.user)) }
export async function learnerSupport(req, res) { res.json(await getLearnerSupport(school(req), req.params.learnerId, req.user)) }
export async function supportTimeline(req, res) { res.json(await getSupportTimeline(school(req), caseId(req), req.user, req.query)) }
export async function supportEvidence(req, res) { res.json(await getSupportEvidence(school(req), caseId(req), req.user)) }
export async function supportInterventions(req, res) { res.json(await getSupportInterventions(school(req), caseId(req), req.user)) }
export async function escalationPolicy(req, res) { res.json(await getEscalationPolicy(school(req))) }
export async function postSupportAssignment(req, res) { res.json(await assignSupportCase(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportAcknowledgement(req, res) { res.json(await acknowledgeSupportCase(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportAssignmentCompletion(req, res) { res.json(await completeSupportAssignment(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportOwnershipAcceptance(req, res) { res.json(await acceptSupportOwnership(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportReassignmentRequest(req, res) { res.status(201).json(await requestSupportReassignment(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportNote(req, res) { res.status(201).json(await addSupportNote(school(req), caseId(req), req.user, req.body || {})) }
export async function postCaseTargetedAssessment(req, res) { res.status(201).json(await createCaseTargetedAssessment(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportIntervention(req, res) { res.status(201).json(await createSupportIntervention(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportSession(req, res) { res.status(201).json(await recordSupportSession(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportReassessment(req, res) { res.status(201).json(await scheduleSupportReassessment(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportOutcome(req, res) { res.json(await reviewSupportOutcome(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportEscalation(req, res) { res.json(await escalateSupportCase(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportResolution(req, res) { res.json(await resolveSupportCase(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportCarryForward(req, res) { res.status(201).json(await carryForwardSupportCase(school(req), caseId(req), req.user, req.body || {})) }
export async function postAcademicReviewRequest(req, res) { res.status(201).json(await requestAcademicReview(school(req), caseId(req), req.user, req.body || {})) }
export async function postSupportEscalationRecommendation(req, res) { res.status(201).json(await requestAcademicReview(school(req), caseId(req), req.user, { ...(req.body || {}), meeting_type: "strategy_review" })) }
export async function postGuardianSummaryDraft(req, res) { res.status(201).json(await draftGuardianSummary(school(req), caseId(req), req.user, req.body || {})) }
