from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from math import ceil

from ortools.sat.python import cp_model

from app.constraints.diagnostics import diagnostic, hint_from_diagnostic
from app.constraints.hard_constraints import add_at_most_one_groups
from app.constraints.soft_constraints import weighted_bool
from app.models.common import Diagnostic, Facility, SolverMetrics, SolverStatus, minutes_since_midnight, slot_overlaps
from app.models.exam_timetable import (
    ExamAlternative,
    ExamPaper,
    ExamPaperAssignment,
    ExamSessionDraft,
    ExamTimetableSolveRequest,
    ExamTimetableSolveResponse,
    ExamWindow,
)
from app.services.normalization import unique_facilities
from app.services.scoring import clamp_time_limit


@dataclass(frozen=True)
class ExamCandidate:
    paper: ExamPaper
    window: ExamWindow
    facility: Facility
    penalty: int


def _stable_status(status: int, has_solution: bool) -> SolverStatus:
    if status == cp_model.OPTIMAL:
        return SolverStatus.optimal
    if status == cp_model.FEASIBLE:
        return SolverStatus.feasible
    if status == cp_model.INFEASIBLE:
        return SolverStatus.infeasible
    if status == cp_model.MODEL_INVALID:
        return SolverStatus.model_invalid
    if status == cp_model.UNKNOWN:
        return SolverStatus.time_limit_with_solution if has_solution else SolverStatus.time_limit_without_solution
    return SolverStatus.failed


def _duration_minutes(start_time: str, end_time: str) -> int:
    start = minutes_since_midnight(start_time)
    end = minutes_since_midnight(end_time)
    if start is None or end is None:
        return 0
    return max(0, end - start)


def _paper_candidate_ids(payload: ExamTimetableSolveRequest, paper: ExamPaper) -> list[str]:
    if paper.candidateIds:
        return list(dict.fromkeys(paper.candidateIds))
    candidates = [
        row.candidateId
        for row in payload.candidateRegistrations
        if paper.id in row.paperIds
    ]
    return list(dict.fromkeys(candidates))


def _paper_in_scope(payload: ExamTimetableSolveRequest, paper: ExamPaper) -> bool:
    refs = set(payload.scopeReferenceIds)
    if payload.scopeType == "WHOLE_SCHOOL" or not refs:
        return True
    if payload.scopeType == "CLASS":
        return paper.classId in refs
    if payload.scopeType == "GRADE":
        return paper.gradeLevel in refs
    if payload.scopeType == "STREAM":
        return paper.streamId in refs
    if payload.scopeType == "SUBJECT":
        return paper.subjectId in refs
    if payload.scopeType == "STUDENT_GROUP":
        return bool(refs.intersection(paper.studentGroupIds))
    return True


def _facility_supports_paper(facility: Facility, paper: ExamPaper, candidate_count: int) -> bool:
    if not facility.active or not facility.canHostExaminations:
        return False
    if paper.allowedFacilityIds and facility.id not in paper.allowedFacilityIds:
        return False
    if paper.requiresLab and not (
        facility.canHostPracticalExaminations
        or "LABORATORY" in facility.facilityType.upper()
        or facility.facilityType.upper() in {"WORKSHOP", "HOME_ECONOMICS_ROOM", "AGRICULTURE_FACILITY"}
    ):
        return False
    if paper.requiresComputer and not facility.canHostComputerExaminations:
        return False
    if paper.requiresListening and not facility.canHostListeningExaminations:
        return False
    if paper.requiredFacilityType and paper.requiredFacilityType.upper() not in facility.facilityType.upper():
        return False
    capacity = facility.examinationCapacity or facility.normalCapacity or 0
    if capacity and candidate_count > capacity:
        return False
    if paper.requiresComputer and facility.functionalComputerCount and candidate_count > facility.functionalComputerCount:
        return False
    return True


def _normal_occupancy_blocks(
    payload: ExamTimetableSolveRequest,
    paper: ExamPaper,
    window: ExamWindow,
    facility: Facility,
) -> bool:
    if payload.operatingMode == "FULL_SCHOOL_SUSPENSION":
        return False
    window_start = minutes_since_midnight(window.startTime)
    window_end = minutes_since_midnight(window.endTime)
    if window_start is None or window_end is None:
        return False
    for item in [*payload.normalSchoolTimetableOccupancy, *payload.existingFacilityReservations]:
        if not item.blocking:
            continue
        if item.date and item.date != window.date:
            continue
        if item.occupancyType == "NORMAL_LESSON" and payload.operatingMode == "PARTIAL_SUSPENSION":
            if item.resourceType.upper() == "CLASS" and item.resourceId == paper.classId:
                continue
        item_start = minutes_since_midnight(item.startTime)
        item_end = minutes_since_midnight(item.endTime)
        if item_start is None or item_end is None or not slot_overlaps(window_start, window_end, item_start, item_end):
            continue
        if item.resourceType.upper() in {"FACILITY", "LABORATORY"} and item.resourceId == facility.id:
            return True
        if payload.operatingMode == "NORMAL_LESSONS_CONTINUE" and item.resourceType.upper() == "CLASS" and item.resourceId == paper.classId:
            return True
    return False


def _activity_blocks_exam(payload: ExamTimetableSolveRequest, window: ExamWindow) -> str | None:
    try:
        weekday = date.fromisoformat(window.date).isoweekday()
    except ValueError:
        weekday = None
    for activity in payload.weeklyActivities:
        if not activity.active or activity.examPolicy != "EXAMS_CANNOT_OVERRIDE":
            continue
        if activity.weekday and weekday and int(activity.weekday) != int(weekday):
            continue
        return activity.name
    return None


def _build_exam_candidates(payload: ExamTimetableSolveRequest) -> tuple[dict[str, list[ExamCandidate]], list[Diagnostic]]:
    diagnostics: list[Diagnostic] = []
    papers = [paper for paper in payload.papers if _paper_in_scope(payload, paper)]
    if not papers:
        return {}, [diagnostic("NO_EXAM_PAPERS", "No exam papers matched the selected exam scope.")]
    if not payload.availableExamWindows:
        return {}, [diagnostic("NO_EXAM_WINDOWS", "No available examination windows were provided.")]

    all_facilities = unique_facilities(payload.facilities, payload.laboratories, payload.computerLabs)
    if not all_facilities:
        return {}, [diagnostic("NO_EXAM_FACILITIES", "No examination rooms or laboratories were provided.")]

    by_paper: dict[str, list[ExamCandidate]] = {}
    closures = set(payload.schoolClosureDates)

    for paper in papers:
        candidates: list[ExamCandidate] = []
        candidate_ids = _paper_candidate_ids(payload, paper)
        candidate_count = len(candidate_ids)
        required_minutes = paper.durationMinutes + paper.setupBufferMinutes + paper.collectionBufferMinutes
        for window in payload.availableExamWindows:
            if payload.dateRange and not (payload.dateRange.startDate <= window.date <= payload.dateRange.endDate):
                continue
            if window.date in closures:
                continue
            if paper.fixedWindowId and window.id != paper.fixedWindowId:
                continue
            if paper.allowedWindowIds and window.id not in paper.allowedWindowIds:
                continue
            if required_minutes > _duration_minutes(window.startTime, window.endTime):
                continue
            activity_block = _activity_blocks_exam(payload, window)
            if activity_block:
                continue
            window_facilities = [facility for facility in all_facilities if not window.facilityIds or facility.id in window.facilityIds]
            for facility in window_facilities:
                if not _facility_supports_paper(facility, paper, candidate_count):
                    continue
                if _normal_occupancy_blocks(payload, paper, window, facility):
                    continue
                penalty = 0
                if paper.majorPaper and minutes_since_midnight(window.startTime) and minutes_since_midnight(window.startTime) > 10 * 60:
                    penalty += 20
                if candidate_count and facility.examinationCapacity:
                    unused = max(0, facility.examinationCapacity - candidate_count)
                    penalty += min(20, unused // 5)
                candidates.append(ExamCandidate(paper=paper, window=window, facility=facility, penalty=penalty))
        if not candidates:
            diagnostics.append(diagnostic(
                "NO_VALID_EXAM_SESSION",
                f"Paper {paper.name or paper.id} has no valid exam window and facility.",
                entity_type="exam_paper",
                entity_id=paper.id,
            ))
        else:
            by_paper[paper.id] = candidates
    return by_paper, diagnostics


def _assignment_from_candidate(payload: ExamTimetableSolveRequest, candidate: ExamCandidate) -> ExamPaperAssignment:
    paper = candidate.paper
    return ExamPaperAssignment(
        paperId=paper.id,
        windowId=candidate.window.id,
        date=candidate.window.date,
        startTime=candidate.window.startTime,
        endTime=candidate.window.endTime,
        slotStartId=candidate.window.slotStartId,
        slotEndId=candidate.window.slotEndId,
        facilityId=candidate.facility.id,
        candidateIds=_paper_candidate_ids(payload, paper),
    )


def _exam_reports(assignments: list[ExamPaperAssignment]) -> tuple[dict[str, int], dict[str, int]]:
    candidate_load: dict[str, int] = defaultdict(int)
    facility_load: dict[str, int] = defaultdict(int)
    for assignment in assignments:
        if assignment.facilityId:
            facility_load[assignment.facilityId] += 1
        for candidate_id in assignment.candidateIds:
            candidate_load[f"{candidate_id}:{assignment.date}"] += 1
    overloaded = sum(1 for count in candidate_load.values() if count > 1)
    return {
        "candidateExamDays": len(candidate_load),
        "sameDayMultiplePaperCandidateCount": overloaded,
    }, dict(facility_load)


def solve_exam_timetable(payload: ExamTimetableSolveRequest) -> ExamTimetableSolveResponse:
    started = time.perf_counter()
    candidates_by_paper, diagnostics = _build_exam_candidates(payload)
    errors = [item for item in diagnostics if item.severity == "ERROR"]
    if errors:
        return ExamTimetableSolveResponse(
            status=SolverStatus.infeasible,
            diagnostics=diagnostics,
            infeasibilityHints=[hint_from_diagnostic(item) for item in errors],
            solverMetrics=SolverMetrics(durationMs=int((time.perf_counter() - started) * 1000)),
        )

    model = cp_model.CpModel()
    variables: dict[str, cp_model.IntVar] = {}
    candidate_meta: dict[str, ExamCandidate] = {}
    occupancy_groups: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    objective_terms: list[cp_model.LinearExpr] = []
    constraints = 0

    for paper_id, candidates in candidates_by_paper.items():
        paper_vars: list[cp_model.IntVar] = []
        for index, candidate in enumerate(candidates):
            key = f"{paper_id}:{index}"
            var = model.NewBoolVar(key)
            variables[key] = var
            candidate_meta[key] = candidate
            paper_vars.append(var)
            paper = candidate.paper
            window = candidate.window
            if candidate.facility.id:
                occupancy_groups[f"FACILITY:{candidate.facility.id}:{window.id}"].append(var)
            for candidate_id in _paper_candidate_ids(payload, paper):
                occupancy_groups[f"CANDIDATE:{candidate_id}:{window.id}"].append(var)
            if paper.classId:
                occupancy_groups[f"CLASS:{paper.classId}:{window.id}"].append(var)
            if candidate.penalty:
                objective_terms.append(weighted_bool(var, candidate.penalty))
        model.AddExactlyOne(paper_vars)
        constraints += 1

    constraints += add_at_most_one_groups(model, occupancy_groups.values())
    if objective_terms:
        model.Minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = clamp_time_limit(payload.timeLimitSeconds)
    solver.parameters.num_search_workers = 8

    alternatives: list[ExamAlternative] = []
    max_alternatives = max(1, min(5, int(payload.maxAlternatives or 1)))
    final_status = SolverStatus.failed

    for alt_index in range(max_alternatives):
        status = solver.Solve(model)
        selected = [key for key, var in variables.items() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) and solver.BooleanValue(var)]
        has_solution = bool(selected)
        final_status = _stable_status(status, has_solution)
        if not has_solution:
            break
        assignments = [_assignment_from_candidate(payload, candidate_meta[key]) for key in selected]
        sessions_by_window: dict[str, ExamSessionDraft] = {}
        for assignment in assignments:
            session = sessions_by_window.setdefault(
                assignment.windowId,
                ExamSessionDraft(
                    sessionId=f"session-{assignment.windowId}",
                    windowId=assignment.windowId,
                    date=assignment.date,
                    startTime=assignment.startTime,
                    endTime=assignment.endTime,
                ),
            )
            session.paperIds.append(assignment.paperId)
            if assignment.facilityId and assignment.facilityId not in session.facilityIds:
                session.facilityIds.append(assignment.facilityId)
        pressure, facility_report = _exam_reports(assignments)
        soft_score = float(solver.ObjectiveValue()) if objective_terms else 0.0
        alternatives.append(ExamAlternative(
            alternativeId=f"exam-alt-{alt_index + 1}",
            strategy=payload.strategy.value,
            objectiveScore=soft_score,
            softPenaltyScore=soft_score,
            sessions=list(sessions_by_window.values()),
            paperAssignments=assignments,
            candidatePressureReport=pressure,
            facilityUtilizationReport={"papersByFacility": facility_report},
            invigilationRequirements=[
                {
                    "paperId": assignment.paperId,
                    "windowId": assignment.windowId,
                    "facilityId": assignment.facilityId,
                    "minimumInvigilators": max(1, ceil(len(assignment.candidateIds) / 30)),
                }
                for assignment in assignments
            ],
        ))
        model.AddBoolOr([variables[key].Not() for key in selected])
        constraints += 1

    if not alternatives:
        diagnostics.append(diagnostic(
            "NO_EXAM_SOLVER_SOLUTION",
            "The exam hard constraints could not be satisfied.",
        ))

    metrics = SolverMetrics(
        durationMs=int((time.perf_counter() - started) * 1000),
        variables=len(variables),
        constraints=constraints,
        conflicts=solver.NumConflicts(),
        branches=solver.NumBranches(),
        wallTime=solver.WallTime(),
    )
    return ExamTimetableSolveResponse(
        status=final_status if alternatives else SolverStatus.infeasible,
        alternatives=alternatives,
        diagnostics=diagnostics,
        infeasibilityHints=[hint_from_diagnostic(item) for item in diagnostics if item.severity == "ERROR"],
        solverMetrics=metrics,
    )
