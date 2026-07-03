from __future__ import annotations

import time
from collections import defaultdict

from ortools.sat.python import cp_model

from app.constraints.diagnostics import diagnostic
from app.models.common import Facility, SolverMetrics, SolverStatus
from app.models.exam_timetable import ExamPaper, ExamRoomAllocationRequest, ExamRoomAllocationResponse
from app.services.scoring import clamp_time_limit


def _paper_by_id(papers: list[ExamPaper]) -> dict[str, ExamPaper]:
    return {paper.id: paper for paper in papers}


def _candidate_count(payload: ExamRoomAllocationRequest, paper: ExamPaper) -> int:
    if paper.candidateIds:
        return len(set(paper.candidateIds))
    return len({
        registration.candidateId
        for registration in payload.candidateRegistrations
        if paper.id in registration.paperIds
    })


def _room_capacity(room: Facility, paper: ExamPaper) -> int:
    if paper.requiresComputer and room.functionalComputerCount:
        return int(room.functionalComputerCount)
    return int(room.examinationCapacity or room.normalCapacity or 0)


def _room_allowed(room: Facility, paper: ExamPaper) -> bool:
    if not room.active or not room.canHostExaminations:
        return False
    if paper.allowedFacilityIds and room.id not in paper.allowedFacilityIds:
        return False
    if paper.requiresComputer and not room.canHostComputerExaminations:
        return False
    if paper.requiresLab and not (room.canHostPracticalExaminations or "LABORATORY" in room.facilityType.upper()):
        return False
    return _room_capacity(room, paper) > 0


def allocate_exam_rooms(payload: ExamRoomAllocationRequest) -> ExamRoomAllocationResponse:
    started = time.perf_counter()
    papers = _paper_by_id(payload.papers)
    if not payload.paperAssignments:
        return ExamRoomAllocationResponse(
            status=SolverStatus.model_invalid,
            diagnostics=[diagnostic("NO_PAPER_ASSIGNMENTS", "No exam paper assignments were provided.")],
        )
    if not payload.facilities:
        return ExamRoomAllocationResponse(
            status=SolverStatus.model_invalid,
            diagnostics=[diagnostic("NO_ROOMS", "No rooms or laboratories were provided.")],
        )

    model = cp_model.CpModel()
    variables: dict[str, cp_model.IntVar] = {}
    meta: dict[str, tuple[str, str, str]] = {}
    constraints = 0
    room_session_groups: dict[str, list[cp_model.IntVar]] = defaultdict(list)

    for assignment in payload.paperAssignments:
        paper = papers.get(assignment.paperId)
        if not paper:
            return ExamRoomAllocationResponse(
                status=SolverStatus.model_invalid,
                diagnostics=[diagnostic("UNKNOWN_PAPER", f"Paper {assignment.paperId} was not found.")],
            )
        candidate_count = max(1, len(assignment.candidateIds) or _candidate_count(payload, paper))
        candidates = [room for room in payload.facilities if _room_allowed(room, paper)]
        if not candidates:
            return ExamRoomAllocationResponse(
                status=SolverStatus.infeasible,
                diagnostics=[diagnostic("NO_COMPATIBLE_ROOM", f"No room can host paper {paper.name or paper.id}.")],
            )
        paper_vars: list[cp_model.IntVar] = []
        capacity_terms: list[cp_model.LinearExpr] = []
        for room in candidates:
            key = f"{assignment.paperId}:{assignment.windowId}:{room.id}"
            var = model.NewBoolVar(key)
            variables[key] = var
            meta[key] = (assignment.paperId, assignment.windowId, room.id)
            paper_vars.append(var)
            capacity_terms.append(var * _room_capacity(room, paper))
            room_session_groups[f"{assignment.windowId}:{room.id}"].append(var)
        if payload.allowPaperSplitAcrossRooms:
            model.Add(sum(capacity_terms) >= candidate_count)
            model.Add(sum(paper_vars) >= 1)
            constraints += 2
        else:
            feasible_single = [var for key, var in variables.items() if key.startswith(f"{assignment.paperId}:{assignment.windowId}:") and _room_capacity(next(room for room in candidates if room.id == meta[key][2]), paper) >= candidate_count]
            if not feasible_single:
                return ExamRoomAllocationResponse(
                    status=SolverStatus.infeasible,
                    diagnostics=[diagnostic("ROOM_CAPACITY_EXCEEDED", f"Paper {paper.name or paper.id} cannot fit in one compatible room.")],
                )
            model.AddExactlyOne(feasible_single)
            constraints += 1

    if not payload.allowMultiplePapersPerRoom:
        for variables_for_room in room_session_groups.values():
            if len(variables_for_room) > 1:
                model.AddAtMostOne(variables_for_room)
                constraints += 1

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = clamp_time_limit(payload.timeLimitSeconds)
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)
    has_solution = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    allocations: list[dict] = []
    if has_solution:
        for key, var in variables.items():
            if solver.BooleanValue(var):
                paper_id, window_id, room_id = meta[key]
                paper = papers[paper_id]
                allocations.append({
                    "paperId": paper_id,
                    "windowId": window_id,
                    "facilityId": room_id,
                    "capacity": _room_capacity(next(room for room in payload.facilities if room.id == room_id), paper),
                    "role": "PRIMARY_ROOM",
                })
    metrics = SolverMetrics(
        durationMs=int((time.perf_counter() - started) * 1000),
        variables=len(variables),
        constraints=constraints,
        conflicts=solver.NumConflicts(),
        branches=solver.NumBranches(),
        wallTime=solver.WallTime(),
    )
    return ExamRoomAllocationResponse(
        status=SolverStatus.feasible if has_solution else SolverStatus.infeasible,
        allocations=allocations,
        solverMetrics=metrics,
    )
