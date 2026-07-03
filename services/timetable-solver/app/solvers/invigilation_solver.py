from __future__ import annotations

import time
from collections import defaultdict
from math import ceil

from ortools.sat.python import cp_model

from app.constraints.diagnostics import diagnostic
from app.models.common import SolverMetrics, SolverStatus, Teacher
from app.models.exam_timetable import InvigilationRequest, InvigilationResponse
from app.services.scoring import clamp_time_limit


def _required_count(room_allocation: dict, payload: InvigilationRequest) -> int:
    candidate_count = int(room_allocation.get("candidateCount") or room_allocation.get("capacity") or 0)
    ratio_count = ceil(candidate_count / max(1, int(payload.candidatePerInvigilatorRatio)))
    return max(int(payload.minimumInvigilatorsPerRoom), ratio_count)


def _teacher_available(teacher: Teacher, room_allocation: dict, payload: InvigilationRequest) -> bool:
    window_id = str(room_allocation.get("windowId") or "")
    for rule in payload.teacherAvailability:
        if rule.resourceType != "TEACHER" or rule.resourceId != teacher.id:
            continue
        if rule.status not in {"UNAVAILABLE", "MAINTENANCE", "RESTRICTED"}:
            continue
        if not rule.cycleDayId and not rule.startSlotId:
            return False
        if rule.startSlotId and rule.startSlotId == window_id:
            return False
    return True


def allocate_invigilators(payload: InvigilationRequest) -> InvigilationResponse:
    started = time.perf_counter()
    if not payload.roomAllocations:
        return InvigilationResponse(
            status=SolverStatus.model_invalid,
            diagnostics=[diagnostic("NO_ROOM_ALLOCATIONS", "No exam room allocations were provided.")],
        )
    teachers = [teacher for teacher in payload.invigilators if teacher.active]
    if not teachers:
        return InvigilationResponse(
            status=SolverStatus.infeasible,
            diagnostics=[diagnostic("NO_INVIGILATORS", "No eligible invigilators were provided.")],
        )

    model = cp_model.CpModel()
    variables: dict[str, cp_model.IntVar] = {}
    meta: dict[str, tuple[str, str]] = {}
    teacher_window_groups: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    workload_terms: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    constraints = 0

    for index, room in enumerate(payload.roomAllocations):
        room_key = str(room.get("allocationId") or f"{room.get('paperId')}:{room.get('windowId')}:{room.get('facilityId')}:{index}")
        window_id = str(room.get("windowId") or room.get("sessionId") or "")
        room_vars: list[cp_model.IntVar] = []
        required = _required_count(room, payload)
        for teacher in teachers:
            if not _teacher_available(teacher, room, payload):
                continue
            if payload.avoidOwnSubject and room.get("subjectId") and room.get("subjectId") in teacher.subjectIds:
                continue
            key = f"{room_key}:{teacher.id}"
            var = model.NewBoolVar(key)
            variables[key] = var
            meta[key] = (room_key, teacher.id)
            room_vars.append(var)
            teacher_window_groups[f"{teacher.id}:{window_id}"].append(var)
            workload_terms[teacher.id].append(var)
        if len(room_vars) < required:
            return InvigilationResponse(
                status=SolverStatus.infeasible,
                diagnostics=[diagnostic("INSUFFICIENT_INVIGILATORS", f"Room allocation {room_key} needs {required} invigilators but only {len(room_vars)} are eligible.")],
            )
        model.Add(sum(room_vars) >= required)
        constraints += 1

    for group in teacher_window_groups.values():
        if len(group) > 1:
            model.AddAtMostOne(group)
            constraints += 1

    max_load = model.NewIntVar(0, len(payload.roomAllocations), "max_invigilator_load")
    for teacher_id, vars_for_teacher in workload_terms.items():
        load = model.NewIntVar(0, len(payload.roomAllocations), f"load_{teacher_id}")
        model.Add(load == sum(vars_for_teacher))
        model.Add(load <= max_load)
        constraints += 2
    model.Minimize(max_load)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = clamp_time_limit(payload.timeLimitSeconds)
    solver.parameters.num_search_workers = 8
    status = solver.Solve(model)
    has_solution = status in (cp_model.OPTIMAL, cp_model.FEASIBLE)
    assignments: list[dict] = []
    if has_solution:
        for key, var in variables.items():
            if solver.BooleanValue(var):
                room_key, teacher_id = meta[key]
                assignments.append({
                    "allocationId": room_key,
                    "teacherId": teacher_id,
                    "role": "INVIGILATOR",
                })
    metrics = SolverMetrics(
        durationMs=int((time.perf_counter() - started) * 1000),
        variables=len(variables),
        constraints=constraints,
        conflicts=solver.NumConflicts(),
        branches=solver.NumBranches(),
        wallTime=solver.WallTime(),
    )
    return InvigilationResponse(
        status=SolverStatus.feasible if has_solution else SolverStatus.infeasible,
        assignments=assignments,
        solverMetrics=metrics,
    )

