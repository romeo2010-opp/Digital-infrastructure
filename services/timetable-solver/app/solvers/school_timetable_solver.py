from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass
from math import ceil
from typing import Any

from ortools.sat.python import cp_model

from app.constraints.diagnostics import diagnostic, hint_from_diagnostic
from app.constraints.hard_constraints import add_at_most_one_groups
from app.constraints.soft_constraints import weighted_bool
from app.models.common import (
    AvailabilityRule,
    BellSlot,
    Diagnostic,
    Facility,
    OccupancyRecord,
    SolverMetrics,
    SolverStatus,
    slot_overlaps,
)
from app.models.school_timetable import (
    AlternativeSlotRequest,
    AlternativeSlotResponse,
    AlternativeSlotSuggestion,
    CurriculumRequirement,
    LockedAssignment,
    SchoolAlternative,
    SchoolAssignment,
    SchoolTimetableSolveRequest,
    SchoolTimetableSolveResponse,
    StreamSchedulingRule,
    SubjectFocusAssignment,
    SubjectFocusRule,
)
from app.services.normalization import unique_facilities
from app.services.scoring import clamp_time_limit, early_slot_penalty
from app.services.validation import validate_school_problem


@dataclass(frozen=True)
class Candidate:
    requirement: CurriculumRequirement
    occurrence: int
    cycle_day_id: str
    start_slot_id: str
    end_slot_id: str
    occupied_slot_ids: tuple[str, ...]
    teacher_id: str | None
    facility_id: str | None
    locked: bool = False
    penalty: int = 0
    focus_violations: tuple[dict[str, Any], ...] = ()


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


def _slot_number_map(slots: list[BellSlot]) -> dict[str, int]:
    return {slot.id: int(slot.sortOrder or slot.slotNumber) for slot in slots}


def _slot_by_id(slots: list[BellSlot]) -> dict[str, BellSlot]:
    return {slot.id: slot for slot in slots}


def _slot_tag_map(payload: SchoolTimetableSolveRequest) -> dict[str, set[str]]:
    tags: dict[str, set[str]] = defaultdict(set)
    for item in payload.bellScheduleSlotTags:
        tags[item.slotId].update(str(code).upper() for code in item.tagCodes if code)
        for tag in item.tags:
            code = str(tag.get("tagCode") or tag.get("tag_code") or "").upper()
            if code:
                tags[item.slotId].add(code)
    return tags


def _requirement_grade(req: CurriculumRequirement, classes: dict[str, Any]) -> str | None:
    if not req.classId:
        return None
    class_row = classes.get(req.classId)
    return getattr(class_row, "gradeLevel", None) if class_row else None


def _same_text(left: str | None, right: str | None) -> bool:
    if left is None or right is None:
        return False
    if str(left).strip() == "" or str(right).strip() == "":
        return False
    return str(left).strip().lower() == str(right).strip().lower()


def _focus_assignment_matches(
    assignment: SubjectFocusAssignment,
    req: CurriculumRequirement,
    classes: dict[str, Any],
) -> bool:
    if assignment.subjectId != req.subjectId:
        return False
    if assignment.classId and assignment.classId != req.classId:
        return False
    if assignment.streamId and assignment.streamId != req.streamId:
        return False
    if assignment.gradeLevel and not _same_text(assignment.gradeLevel, _requirement_grade(req, classes)):
        return False
    return True


def _focus_scope_matches(rule: SubjectFocusRule, req: CurriculumRequirement, classes: dict[str, Any]) -> bool:
    scope = str(rule.scopeType or "WHOLE_SCHOOL").upper()
    grade = _requirement_grade(req, classes)
    if rule.classId and rule.classId != req.classId:
        return False
    if rule.streamId and rule.streamId != req.streamId:
        return False
    if rule.gradeLevel and not _same_text(rule.gradeLevel, grade):
        return False
    if scope == "CLASS" and rule.scopeReferenceId and rule.scopeReferenceId != req.classId:
        return False
    if scope == "STREAM" and rule.scopeValue and not _same_text(rule.scopeValue, req.streamId):
        return False
    if scope == "GRADE" and rule.scopeValue and not _same_text(rule.scopeValue, grade):
        return False
    if scope == "SUBJECT" and rule.scopeReferenceId and rule.scopeReferenceId != req.subjectId:
        return False
    return True


def _matching_focus_rules(
    req: CurriculumRequirement,
    payload: SchoolTimetableSolveRequest,
    classes: dict[str, Any],
) -> list[SubjectFocusRule]:
    matching: list[SubjectFocusRule] = []
    assignments = payload.subjectFocusAssignments
    for rule in payload.subjectFocusRules:
        if rule.subjectId and rule.subjectId != req.subjectId:
            continue
        if rule.focusCategoryId:
            category_match = any(
                assignment.focusCategoryId == rule.focusCategoryId
                and _focus_assignment_matches(assignment, req, classes)
                for assignment in assignments
            )
            if not category_match:
                continue
        if not rule.subjectId and not rule.focusCategoryId:
            continue
        if not _focus_scope_matches(rule, req, classes):
            continue
        matching.append(rule)
    return matching


def _slot_tag_codes(slot_ids: tuple[str, ...], slot_tags: dict[str, set[str]]) -> set[str]:
    codes: set[str] = set()
    for slot_id in slot_ids:
        codes.update(slot_tags.get(slot_id, set()))
    return codes


def _focus_rule_is_preferred(rule: SubjectFocusRule, start_slot_id: str, occupied_slot_ids: tuple[str, ...], tag_codes: set[str]) -> bool:
    if rule.preferredSlotIds and start_slot_id in rule.preferredSlotIds:
        return True
    preferred_tags = {str(tag).upper() for tag in rule.preferredSlotTags}
    return bool(preferred_tags and preferred_tags.intersection(tag_codes))


def _focus_rule_is_avoided(rule: SubjectFocusRule, start_slot_id: str, occupied_slot_ids: tuple[str, ...], tag_codes: set[str]) -> bool:
    if start_slot_id in rule.avoidedSlotIds or any(slot_id in rule.avoidedSlotIds for slot_id in occupied_slot_ids):
        return True
    avoided_tags = {str(tag).upper() for tag in rule.avoidedSlotTags}
    return bool(avoided_tags and avoided_tags.intersection(tag_codes))


def _focus_block_reason(
    req: CurriculumRequirement,
    start_slot_id: str,
    occupied_slot_ids: tuple[str, ...],
    slot_tags: dict[str, set[str]],
    focus_rules: list[SubjectFocusRule],
) -> str | None:
    tag_codes = _slot_tag_codes(occupied_slot_ids, slot_tags)
    for rule in focus_rules:
        if str(rule.severity).upper() != "HARD":
            continue
        if _focus_rule_is_avoided(rule, start_slot_id, occupied_slot_ids, tag_codes):
            return f"{rule.name} forbids this subject in slots tagged {', '.join(sorted(tag_codes)) or start_slot_id}."
        if (rule.preferredSlotIds or rule.preferredSlotTags) and not _focus_rule_is_preferred(rule, start_slot_id, occupied_slot_ids, tag_codes):
            if rule.allowOverride:
                continue
            return f"{rule.name} requires a preferred focus slot for this subject."
    return None


def _focus_penalty_and_violations(
    req: CurriculumRequirement,
    start_slot_id: str,
    occupied_slot_ids: tuple[str, ...],
    slot_tags: dict[str, set[str]],
    focus_rules: list[SubjectFocusRule],
) -> tuple[int, tuple[dict[str, Any], ...]]:
    tag_codes = _slot_tag_codes(occupied_slot_ids, slot_tags)
    penalty = 0
    violations: list[dict[str, Any]] = []
    for rule in focus_rules:
        if str(rule.severity).upper() == "HARD" and not rule.allowOverride:
            continue
        weight = max(1, int(rule.penaltyWeight or 50))
        preferred_configured = bool(rule.preferredSlotIds or rule.preferredSlotTags)
        preferred = _focus_rule_is_preferred(rule, start_slot_id, occupied_slot_ids, tag_codes)
        avoided = _focus_rule_is_avoided(rule, start_slot_id, occupied_slot_ids, tag_codes)
        rule_penalty = 0
        if avoided:
            rule_penalty += weight + (weight // 2 if "LAST_PERIOD" in tag_codes else 0)
        elif preferred_configured and not preferred:
            rule_penalty += max(1, weight // 2)
        if rule_penalty:
            penalty += rule_penalty
            violations.append({
                "code": "SUBJECT_FOCUS_SOFT_WARNING",
                "message": f"{rule.name} preferred different timing for this subject.",
                "ruleId": rule.id,
                "ruleName": rule.name,
                "requirementId": req.id,
                "subjectId": req.subjectId,
                "classId": req.classId,
                "streamId": req.streamId,
                "slotStartId": start_slot_id,
                "slotTags": sorted(tag_codes),
                "penalty": rule_penalty,
            })
    return penalty, tuple(violations)


def _stream_scope_matches(rule: StreamSchedulingRule, req: CurriculumRequirement, classes: dict[str, Any]) -> bool:
    if not req.streamId or not req.subjectId:
        return False
    scope = str(rule.scopeType or "WHOLE_SCHOOL").upper()
    grade = _requirement_grade(req, classes)
    if rule.subjectId and rule.subjectId != req.subjectId:
        return False
    if rule.classId and rule.classId != req.classId:
        return False
    if rule.streamId and rule.streamId != req.streamId:
        return False
    if rule.gradeLevel and not _same_text(rule.gradeLevel, grade):
        return False
    if scope == "SUBJECT" and rule.scopeReferenceId and rule.scopeReferenceId != req.subjectId:
        return False
    if scope == "CLASS" and rule.scopeReferenceId and rule.scopeReferenceId != req.classId:
        return False
    if scope == "STREAM" and rule.scopeValue and not _same_text(rule.scopeValue, req.streamId):
        return False
    if scope == "GRADE" and rule.scopeValue and not _same_text(rule.scopeValue, grade):
        return False
    return True


def _stream_bucket(req: CurriculumRequirement, classes: dict[str, Any]) -> str:
    grade = _requirement_grade(req, classes)
    if req.classId:
        return f"class:{req.classId}"
    if grade:
        return f"grade:{grade}"
    return "school"


def _stream_rule_limit(rule: StreamSchedulingRule) -> int:
    if str(rule.policy).upper() == "LIMIT_PARALLEL_SAME_SUBJECT" and rule.maxParallelCount is not None:
        return max(1, int(rule.maxParallelCount))
    return 1


def _stream_rule_group_keys(
    rule: StreamSchedulingRule,
    candidate: Candidate,
    classes: dict[str, Any],
) -> list[tuple[str, int]]:
    req = candidate.requirement
    if not _stream_scope_matches(rule, req, classes):
        return []
    policy = str(rule.policy or "DISALLOW_PARALLEL_SAME_SUBJECT").upper()
    if policy == "ALLOW_PARALLEL_SAME_SUBJECT":
        return []
    limit = _stream_rule_limit(rule)
    bucket = _stream_bucket(req, classes)
    keys = []
    for slot_id in candidate.occupied_slot_ids:
        base = f"{rule.id}:{bucket}:subject:{req.subjectId}:day:{candidate.cycle_day_id}:slot:{slot_id}"
        if policy == "ALLOW_ONLY_WITH_DIFFERENT_TEACHERS":
            keys.append((f"{base}:teacher:{candidate.teacher_id or 'UNASSIGNED'}", 1))
        elif policy == "ALLOW_ONLY_WITH_DIFFERENT_ROOMS":
            keys.append((f"{base}:room:{candidate.facility_id or 'UNASSIGNED'}", 1))
        else:
            keys.append((base, limit))
    return keys


def _add_soft_parallel_penalties(
    model: cp_model.CpModel,
    soft_groups: dict[str, tuple[list[cp_model.IntVar], int]],
    objective_terms: list[cp_model.LinearExpr],
) -> int:
    constraints = 0
    for group_index, (variables, weight) in enumerate(soft_groups.values()):
        if len(variables) < 2:
            continue
        for left_index in range(len(variables)):
            for right_index in range(left_index + 1, len(variables)):
                both = model.NewBoolVar(f"soft_stream_parallel_{group_index}_{left_index}_{right_index}")
                model.AddBoolAnd([variables[left_index], variables[right_index]]).OnlyEnforceIf(both)
                model.AddBoolOr([variables[left_index].Not(), variables[right_index].Not(), both])
                objective_terms.append(weighted_bool(both, max(1, int(weight or 80))))
                constraints += 2
    return constraints


def _selected_stream_soft_violations(
    selected: list[Candidate],
    payload: SchoolTimetableSolveRequest,
) -> list[dict[str, Any]]:
    classes = {item.id: item for item in payload.classes}
    grouped: dict[str, tuple[StreamSchedulingRule, int, list[Candidate]]] = {}
    for candidate in selected:
        for rule in payload.streamSchedulingRules:
            if str(rule.severity).upper() == "HARD":
                continue
            for key, limit in _stream_rule_group_keys(rule, candidate, classes):
                current_rule, current_limit, candidates = grouped.get(key, (rule, limit, []))
                candidates.append(candidate)
                grouped[key] = (current_rule, current_limit, candidates)
    violations: list[dict[str, Any]] = []
    for rule, limit, candidates in grouped.values():
        if len(candidates) <= limit:
            continue
        first = candidates[0]
        violations.append({
            "code": "STREAM_PARALLEL_SUBJECT_LIMIT_EXCEEDED" if str(rule.policy).upper() == "LIMIT_PARALLEL_SAME_SUBJECT" else "STREAM_PARALLEL_SUBJECT_FORBIDDEN",
            "message": f"{rule.name} allowed {limit} parallel stream placement(s), but {len(candidates)} were selected.",
            "ruleId": rule.id,
            "ruleName": rule.name,
            "subjectId": first.requirement.subjectId,
            "cycleDayId": first.cycle_day_id,
            "slotStartId": first.start_slot_id,
            "selectedCount": len(candidates),
            "allowedCount": limit,
            "severity": "SOFT",
        })
    return violations


def _slot_available_on_day(slot: BellSlot, day_id: str) -> bool:
    return not slot.cycleDayIds or day_id in slot.cycleDayIds


def _slots_for_day(slots: list[BellSlot], day_id: str) -> list[BellSlot]:
    return sorted(
        [slot for slot in slots if _slot_available_on_day(slot, day_id)],
        key=lambda item: int(item.sortOrder or item.slotNumber),
    )


def _slot_duration_minutes(slots: list[BellSlot], start_slot_id: str, end_slot_id: str) -> int:
    by_id = _slot_by_id(slots)
    start = by_id.get(start_slot_id)
    end = by_id.get(end_slot_id)
    if not start or not end:
        return 0
    try:
        sh, sm = [int(part) for part in start.startTime.split(":")[:2]]
        eh, em = [int(part) for part in end.endTime.split(":")[:2]]
    except ValueError:
        return 0
    return max(0, (eh * 60 + em) - (sh * 60 + sm))


def _overlaps(
    slot_numbers: dict[str, int],
    start_a: str,
    end_a: str,
    start_b: str | None,
    end_b: str | None,
) -> bool:
    if not start_b or not end_b:
        return False
    if start_a not in slot_numbers or end_a not in slot_numbers or start_b not in slot_numbers or end_b not in slot_numbers:
        return False
    return slot_overlaps(slot_numbers[start_a], slot_numbers[end_a], slot_numbers[start_b], slot_numbers[end_b])


def _teacher_candidates(req: CurriculumRequirement) -> list[str | None]:
    if req.teacherId:
        return [req.teacherId]
    if req.eligibleTeacherIds:
        return list(dict.fromkeys(req.eligibleTeacherIds))
    return [None]


def _facility_matches_required_type(facility: Facility, required_type: str | None) -> bool:
    if not required_type:
        return True
    required = required_type.upper()
    actual = facility.facilityType.upper()
    if required in actual:
        return True
    if required in {"LABORATORY", "LAB"}:
        return "LABORATORY" in actual
    if required in {"COMPUTER", "COMPUTER_LAB"}:
        return actual == "COMPUTER_LABORATORY"
    return actual == required


def _facility_candidates(
    req: CurriculumRequirement,
    facilities: list[Facility],
    class_sizes: dict[str, int],
) -> list[str | None]:
    if req.requiredFacilityId:
        return [req.requiredFacilityId]

    requires_specialist = any(
        token in req.entryType.upper()
        for token in ("PRACTICAL", "LABORATORY", "COMPUTER", "EXAM")
    ) or bool(req.requiredFacilityType or req.equipmentIds)
    compatible: list[Facility] = []
    required_capacity = req.requiredCapacity or (class_sizes.get(req.classId or "", 0) if req.classId else 0)
    preferred = set(req.preferredFacilityIds)

    for facility in facilities:
        if not facility.supports_lesson_type(req.entryType, req.subjectId):
            continue
        if not _facility_matches_required_type(facility, req.requiredFacilityType):
            continue
        if req.equipmentIds and not set(req.equipmentIds).issubset(set(facility.equipmentIds)):
            continue
        if required_capacity and facility.normalCapacity and required_capacity > facility.normalCapacity:
            continue
        compatible.append(facility)

    compatible.sort(key=lambda item: (0 if item.id in preferred else 1, item.name or item.id))
    if compatible:
        return [facility.id for facility in compatible]
    return [] if requires_specialist else [None]


def _entry_matches_activity(req: CurriculumRequirement, teacher_id: str | None, facility_id: str | None, activity: Any) -> bool:
    scope = str(activity.scopeType or "").upper()
    if scope == "WHOLE_SCHOOL":
        return True
    if req.classId and req.classId in activity.classIds:
        return True
    if req.studentGroupIds and set(req.studentGroupIds).intersection(activity.studentGroupIds):
        return True
    if teacher_id and activity.teacherId and activity.teacherId == teacher_id:
        return True
    if facility_id and activity.facilityId and activity.facilityId == facility_id:
        return True
    return False


def _activity_blocks_candidate(
    req: CurriculumRequirement,
    teacher_id: str | None,
    facility_id: str | None,
    cycle_day_id: str,
    start_slot_id: str,
    end_slot_id: str,
    payload: SchoolTimetableSolveRequest,
    slot_numbers: dict[str, int],
) -> str | None:
    day = next((item for item in payload.cycleDays if item.id == cycle_day_id), None)
    for activity in payload.weeklyActivities:
        if not activity.active or not activity.blocksNormalLessons:
            continue
        if activity.cycleDayId and activity.cycleDayId != cycle_day_id:
            continue
        if activity.weekday and day and day.weekday and int(activity.weekday) != int(day.weekday):
            continue
        if activity.startSlotId and activity.endSlotId and not _overlaps(slot_numbers, start_slot_id, end_slot_id, activity.startSlotId, activity.endSlotId):
            continue
        if _entry_matches_activity(req, teacher_id, facility_id, activity):
            return activity.name
    return None


def _resource_occupancy_match(
    occupancy: OccupancyRecord,
    req: CurriculumRequirement,
    teacher_id: str | None,
    facility_id: str | None,
) -> bool:
    resource_type = occupancy.resourceType.upper()
    if resource_type == "SCHOOL":
        return True
    if resource_type in {"CLASS", "GRADE"} and req.classId and occupancy.resourceId == req.classId:
        return True
    if resource_type == "STREAM" and req.streamId and occupancy.resourceId == req.streamId:
        return True
    if resource_type == "STUDENT_GROUP" and occupancy.resourceId in req.studentGroupIds:
        return True
    if resource_type in {"TEACHER", "INVIGILATOR"} and teacher_id and occupancy.resourceId == teacher_id:
        return True
    if resource_type in {"FACILITY", "LABORATORY"} and facility_id and occupancy.resourceId == facility_id:
        return True
    return False


def _occupancy_blocks_candidate(
    req: CurriculumRequirement,
    teacher_id: str | None,
    facility_id: str | None,
    cycle_day_id: str,
    start_slot_id: str,
    end_slot_id: str,
    occupancy: list[OccupancyRecord],
    slot_numbers: dict[str, int],
) -> str | None:
    for item in occupancy:
        if not item.blocking or item.canOverride:
            continue
        if item.cycleDayId and item.cycleDayId != cycle_day_id:
            continue
        if not _overlaps(slot_numbers, start_slot_id, end_slot_id, item.startSlotId, item.endSlotId):
            continue
        if _resource_occupancy_match(item, req, teacher_id, facility_id):
            return item.title or item.occupancyType
    return None


def _rule_blocks_candidate(
    rules: list[AvailabilityRule],
    resource_type: str,
    resource_id: str | None,
    cycle_day_id: str,
    start_slot_id: str,
    end_slot_id: str,
    slot_numbers: dict[str, int],
) -> str | None:
    if not resource_id:
        return None
    for rule in rules:
        if rule.resourceType.upper() != resource_type or rule.resourceId != resource_id:
            continue
        if rule.status not in {"UNAVAILABLE", "MAINTENANCE", "RESTRICTED"}:
            continue
        if rule.cycleDayId and rule.cycleDayId != cycle_day_id:
            continue
        if rule.startSlotId and rule.endSlotId and not _overlaps(slot_numbers, start_slot_id, end_slot_id, rule.startSlotId, rule.endSlotId):
            continue
        return rule.reason or rule.status
    return None


def _block_slot_ids(slots: list[BellSlot], start_slot_id: str, duration: int) -> tuple[str, ...]:
    by_id = _slot_by_id(slots)
    start = by_id.get(start_slot_id)
    if not start:
        return ()
    ordered = sorted(slots, key=lambda item: int(item.sortOrder or item.slotNumber))
    start_index = int(start.sortOrder or start.slotNumber)
    wanted = [
        slot
        for slot in ordered
        if start_index <= int(slot.sortOrder or slot.slotNumber) <= start_index + max(1, duration) - 1
    ]
    if len(wanted) != max(1, duration):
        return ()
    if any(not slot.teachingAllowed for slot in wanted):
        return ()
    if duration > 1 and any(not slot.canSpan for slot in wanted[:-1]):
        return ()
    return tuple(slot.id for slot in wanted)


def _locked_assignment_diagnostic(
    req: CurriculumRequirement,
    occurrence: int,
    locked: LockedAssignment,
    slots: list[BellSlot],
    active_day_ids: set[str],
) -> Diagnostic | None:
    end_slot_id = locked.slotEndId or locked.slotStartId
    slot_by_id = _slot_by_id(slots)
    if locked.cycleDayId and locked.cycleDayId not in active_day_ids:
        return diagnostic(
            "STALE_LOCKED_DAY",
            f"Requirement {req.id} occurrence {occurrence + 1} is locked to cycle day {locked.cycleDayId}, but that day is not active in the current timetable.",
            entity_type="curriculum_requirement",
            entity_id=req.id,
            requirementId=req.id,
            occurrence=occurrence + 1,
            cycleDayId=locked.cycleDayId,
            slotStartId=locked.slotStartId,
            slotEndId=end_slot_id,
        )
    missing_slots = [slot_id for slot_id in (locked.slotStartId, end_slot_id) if slot_id not in slot_by_id]
    if missing_slots:
        unique_missing = list(dict.fromkeys(missing_slots))
        return diagnostic(
            "STALE_LOCKED_SLOT",
            f"Requirement {req.id} occurrence {occurrence + 1} is locked to slot {', '.join(unique_missing)}, but that slot is not in the current bell schedule.",
            entity_type="curriculum_requirement",
            entity_id=req.id,
            requirementId=req.id,
            occurrence=occurrence + 1,
            cycleDayId=locked.cycleDayId,
            slotStartId=locked.slotStartId,
            slotEndId=end_slot_id,
            missingSlotIds=unique_missing,
        )
    if locked.cycleDayId:
        day_slot_by_id = _slot_by_id(_slots_for_day(slots, locked.cycleDayId))
        unavailable_slots = [slot_id for slot_id in (locked.slotStartId, end_slot_id) if slot_id not in day_slot_by_id]
        if unavailable_slots:
            unique_unavailable = list(dict.fromkeys(unavailable_slots))
            return diagnostic(
                "LOCKED_SLOT_NOT_AVAILABLE_ON_DAY",
                f"Requirement {req.id} occurrence {occurrence + 1} is locked to slot {', '.join(unique_unavailable)}, but that slot is not available on cycle day {locked.cycleDayId}.",
                entity_type="curriculum_requirement",
                entity_id=req.id,
                requirementId=req.id,
                occurrence=occurrence + 1,
                cycleDayId=locked.cycleDayId,
                slotStartId=locked.slotStartId,
                slotEndId=end_slot_id,
                unavailableSlotIds=unique_unavailable,
            )
    return None


def _locked_candidate(
    req: CurriculumRequirement,
    occurrence: int,
    locked: LockedAssignment,
    slots: list[BellSlot],
) -> Candidate | None:
    if not locked.cycleDayId:
        return None
    duration = max(1, req.blockLength)
    end_slot_id = locked.slotEndId or locked.slotStartId
    occupied = _block_slot_ids(slots, locked.slotStartId, duration)
    if not occupied:
        occupied = (locked.slotStartId,)
    return Candidate(
        requirement=req,
        occurrence=occurrence,
        cycle_day_id=locked.cycleDayId,
        start_slot_id=locked.slotStartId,
        end_slot_id=end_slot_id,
        occupied_slot_ids=occupied,
        teacher_id=locked.teacherId or req.teacherId,
        facility_id=locked.facilityId or req.requiredFacilityId,
        locked=True,
    )


def _candidate_penalty(
    req: CurriculumRequirement,
    day_id: str,
    start_slot: BellSlot,
    facility_id: str | None,
) -> int:
    penalty = 0
    if req.preferredCycleDayIds and day_id not in req.preferredCycleDayIds:
        penalty += 8
    if day_id in req.avoidedCycleDayIds:
        penalty += 30
    if req.preferredSlotIds and start_slot.id not in req.preferredSlotIds:
        penalty += 8
    if start_slot.id in req.avoidedSlotIds:
        penalty += 30
    if req.preferredFacilityIds and facility_id and facility_id not in req.preferredFacilityIds:
        penalty += 3
    if req.subjectId and req.metadata.get("preferEarlier"):
        penalty += early_slot_penalty(start_slot)
    return penalty


def _build_candidates(
    payload: SchoolTimetableSolveRequest,
) -> tuple[dict[str, list[Candidate]], list[Diagnostic]]:
    diagnostics: list[Diagnostic] = []
    slots = sorted(payload.bellScheduleSlots, key=lambda item: int(item.sortOrder or item.slotNumber))
    slot_by_id = _slot_by_id(slots)
    slot_numbers = _slot_number_map(slots)
    days = [day for day in sorted(payload.cycleDays, key=lambda item: item.sortOrder) if day.active]
    active_day_ids = {day.id for day in days}
    all_facilities = unique_facilities(payload.facilities, payload.laboratories)
    classes = {item.id: item for item in payload.classes}
    class_sizes = {item.id: item.size for item in payload.classes}
    slot_tags = _slot_tag_map(payload)

    fixed_occupancy = list(payload.existingOccupancy)
    for entry in [*payload.fixedEntries, *payload.lockedEntries]:
        if entry.classId:
            fixed_occupancy.append(OccupancyRecord(resourceType="STREAM" if entry.streamId else "CLASS", resourceId=entry.streamId or entry.classId, cycleDayId=entry.cycleDayId, startSlotId=entry.slotStartId, endSlotId=entry.slotEndId or entry.slotStartId, occupancyType=entry.entryType, title=entry.notes or "Locked timetable entry", blocking=True))
        if entry.teacherId:
            fixed_occupancy.append(OccupancyRecord(resourceType="TEACHER", resourceId=entry.teacherId, cycleDayId=entry.cycleDayId, startSlotId=entry.slotStartId, endSlotId=entry.slotEndId or entry.slotStartId, occupancyType=entry.entryType, title=entry.notes or "Locked timetable entry", blocking=True))
        if entry.facilityId:
            fixed_occupancy.append(OccupancyRecord(resourceType="FACILITY", resourceId=entry.facilityId, cycleDayId=entry.cycleDayId, startSlotId=entry.slotStartId, endSlotId=entry.slotEndId or entry.slotStartId, occupancyType=entry.entryType, title=entry.notes or "Locked timetable entry", blocking=True))

    candidates_by_occurrence: dict[str, list[Candidate]] = {}

    for req in payload.curriculumRequirements:
        block_length = max(1, int(req.blockLength or 1))
        occurrence_count = max(len(req.lockedAssignments), ceil(max(0, req.periodsPerCycle) / block_length))
        focus_rules = _matching_focus_rules(req, payload, classes)
        if occurrence_count <= 0:
            continue
        teachers = _teacher_candidates(req)
        facilities = _facility_candidates(req, all_facilities, class_sizes)
        if not facilities:
            diagnostics.append(diagnostic(
                "NO_COMPATIBLE_FACILITY",
                f"Requirement {req.id} has no compatible facility or laboratory.",
                entity_type="curriculum_requirement",
                entity_id=req.id,
            ))
            continue
        for occurrence in range(occurrence_count):
            key = f"{req.id}:{occurrence}"
            locked = req.lockedAssignments[occurrence] if occurrence < len(req.lockedAssignments) else None
            if locked:
                locked_issue = _locked_assignment_diagnostic(req, occurrence, locked, slots, active_day_ids)
                if locked_issue:
                    diagnostics.append(locked_issue)
                    continue
                candidate = _locked_candidate(req, occurrence, locked, _slots_for_day(slots, locked.cycleDayId))
                if candidate:
                    candidates_by_occurrence[key] = [candidate]
                    continue

            candidates: list[Candidate] = []
            last_focus_block: str | None = None
            for day in days:
                if req.allowedCycleDayIds and day.id not in req.allowedCycleDayIds:
                    continue
                day_slots = _slots_for_day(slots, day.id)
                for start_slot in day_slots:
                    if req.allowedSlotIds and start_slot.id not in req.allowedSlotIds:
                        continue
                    if not start_slot.teachingAllowed:
                        continue
                    occupied = _block_slot_ids(day_slots, start_slot.id, block_length)
                    if not occupied:
                        continue
                    end_slot_id = occupied[-1]
                    if start_slot.id not in slot_by_id or end_slot_id not in slot_by_id:
                        continue
                    focus_block = _focus_block_reason(req, start_slot.id, occupied, slot_tags, focus_rules)
                    if focus_block:
                        last_focus_block = focus_block
                        continue
                    for teacher_id in teachers:
                        teacher_block = _rule_blocks_candidate(
                            payload.teacherAvailability,
                            "TEACHER",
                            teacher_id,
                            day.id,
                            start_slot.id,
                            end_slot_id,
                            slot_numbers,
                        )
                        if teacher_block:
                            continue
                        for facility_id in facilities:
                            facility_block = _rule_blocks_candidate(
                                payload.facilityAvailability,
                                "FACILITY",
                                facility_id,
                                day.id,
                                start_slot.id,
                                end_slot_id,
                                slot_numbers,
                            )
                            if facility_block:
                                continue
                            activity_block = _activity_blocks_candidate(
                                req,
                                teacher_id,
                                facility_id,
                                day.id,
                                start_slot.id,
                                end_slot_id,
                                payload,
                                slot_numbers,
                            )
                            if activity_block:
                                continue
                            occupancy_block = _occupancy_blocks_candidate(
                                req,
                                teacher_id,
                                facility_id,
                                day.id,
                                start_slot.id,
                                end_slot_id,
                                fixed_occupancy,
                                slot_numbers,
                            )
                            if occupancy_block:
                                continue
                            if req.classId and req.classId in classes:
                                class_size = classes[req.classId].size
                                if facility_id:
                                    facility = next((item for item in all_facilities if item.id == facility_id), None)
                                    if facility and facility.normalCapacity and class_size > facility.normalCapacity:
                                        continue
                            base_penalty = _candidate_penalty(req, day.id, start_slot, facility_id)
                            focus_penalty, focus_violations = _focus_penalty_and_violations(req, start_slot.id, occupied, slot_tags, focus_rules)
                            candidates.append(Candidate(
                                requirement=req,
                                occurrence=occurrence,
                                cycle_day_id=day.id,
                                start_slot_id=start_slot.id,
                                end_slot_id=end_slot_id,
                                occupied_slot_ids=occupied,
                                teacher_id=teacher_id,
                                facility_id=facility_id,
                                penalty=base_penalty + focus_penalty,
                                focus_violations=focus_violations,
                            ))
            if not candidates:
                if last_focus_block:
                    diagnostics.append(diagnostic(
                        "SUBJECT_FOCUS_HARD_VIOLATION",
                        f"Requirement {req.id} occurrence {occurrence + 1} was blocked by a hard subject focus rule. {last_focus_block}",
                        "WARNING" if payload.allowPartialTimetable else "ERROR",
                        entity_type="curriculum_requirement",
                        entity_id=req.id,
                        requirementId=req.id,
                        occurrence=occurrence + 1,
                        subjectId=req.subjectId,
                        classId=req.classId,
                        streamId=req.streamId,
                    ))
                diagnostics.append(diagnostic(
                    "NO_VALID_PLACEMENT",
                    f"Requirement {req.id} occurrence {occurrence + 1} has no valid teacher/facility/slot placement.",
                    "WARNING" if payload.allowPartialTimetable else "ERROR",
                    entity_type="curriculum_requirement",
                    entity_id=req.id,
                    requirementId=req.id,
                    occurrence=occurrence + 1,
                    allowPartialTimetable=payload.allowPartialTimetable,
                ))
                if payload.allowPartialTimetable:
                    candidates_by_occurrence[key] = []
            else:
                candidates_by_occurrence[key] = candidates

    return candidates_by_occurrence, diagnostics


def _assignment_from_candidate(candidate: Candidate) -> SchoolAssignment:
    req = candidate.requirement
    return SchoolAssignment(
        requirementId=req.id,
        entryType=req.entryType,
        subjectId=req.subjectId,
        classId=req.classId,
        streamId=req.streamId,
        studentGroupIds=req.studentGroupIds,
        teacherId=candidate.teacher_id,
        assistantTeacherId=req.assistantTeacherId,
        facilityId=candidate.facility_id,
        equipmentIds=req.equipmentIds,
        cycleDayId=candidate.cycle_day_id,
        slotStartId=candidate.start_slot_id,
        slotEndId=candidate.end_slot_id,
        locked=candidate.locked,
        notes=req.metadata.get("notes") if isinstance(req.metadata, dict) else None,
    )


def _summaries(assignments: list[SchoolAssignment]) -> tuple[dict[str, Any], dict[str, Any]]:
    teacher_counts: dict[str, int] = defaultdict(int)
    facility_counts: dict[str, int] = defaultdict(int)
    for assignment in assignments:
        if assignment.teacherId:
            teacher_counts[assignment.teacherId] += 1
        if assignment.facilityId:
            facility_counts[assignment.facilityId] += 1
    return {
        "periodsByTeacher": dict(teacher_counts),
        "teacherCount": len(teacher_counts),
    }, {
        "periodsByFacility": dict(facility_counts),
        "facilityCount": len(facility_counts),
    }


def _candidates_are_consecutive(left: Candidate, right: Candidate, slot_numbers: dict[str, int]) -> bool:
    left_start = slot_numbers.get(left.start_slot_id)
    left_end = slot_numbers.get(left.end_slot_id)
    right_start = slot_numbers.get(right.start_slot_id)
    right_end = slot_numbers.get(right.end_slot_id)
    if None in (left_start, left_end, right_start, right_end):
        return False
    return int(left_end) + 1 == int(right_start) or int(right_end) + 1 == int(left_start)


def _add_same_subject_double_period_constraints(
    model: cp_model.CpModel,
    same_subject_day_groups: dict[str, list[tuple[cp_model.IntVar, Candidate]]],
    slot_numbers: dict[str, int],
) -> int:
    constraints = 0
    for candidates in same_subject_day_groups.values():
        for left_index in range(len(candidates)):
            left_var, left_candidate = candidates[left_index]
            for right_var, right_candidate in candidates[left_index + 1:]:
                if left_candidate.occurrence == right_candidate.occurrence:
                    continue
                if _candidates_are_consecutive(left_candidate, right_candidate, slot_numbers):
                    continue
                model.AddBoolOr([left_var.Not(), right_var.Not()])
                constraints += 1
    return constraints


def _clamped_requirement_priority(req: CurriculumRequirement) -> int:
    return max(0, min(100, int(req.priority or 50)))


def _unscheduled_penalty(req: CurriculumRequirement, occurrence: int) -> int:
    base = 1_000_000
    block_length = max(1, int(req.blockLength or 1))
    occurrence_count = max(1, ceil(max(0, req.periodsPerCycle) / block_length))
    coverage_weight = max(1, occurrence_count - occurrence)
    base += _clamped_requirement_priority(req) * 10_000
    base += coverage_weight * 1_000
    if req.lockedAssignments:
        base += 100_000
    if str(req.entryType or "").upper() in {"EXAM", "EXAM_PAPER", "PRACTICAL_EXAM"}:
        base += 200_000
    return base


def _unscheduled_violation(req: CurriculumRequirement, occurrence: int) -> dict[str, Any]:
    return {
        "code": "UNSCHEDULED_REQUIREMENT_OCCURRENCE",
        "message": f"Requirement {req.id} occurrence {occurrence + 1} could not fit in the available teaching slots.",
        "requirementId": req.id,
        "occurrence": occurrence + 1,
        "entryType": req.entryType,
        "subjectId": req.subjectId,
        "classId": req.classId,
        "teacherId": req.teacherId,
    }


def solve_school_timetable(payload: SchoolTimetableSolveRequest) -> SchoolTimetableSolveResponse:
    started = time.perf_counter()
    diagnostics = validate_school_problem(payload)
    errors = [item for item in diagnostics if item.severity == "ERROR"]
    if errors:
        return SchoolTimetableSolveResponse(
            status=SolverStatus.model_invalid,
            diagnostics=diagnostics,
            infeasibilityHints=[hint_from_diagnostic(item) for item in errors],
            solverMetrics=SolverMetrics(durationMs=int((time.perf_counter() - started) * 1000)),
        )

    candidates_by_occurrence, candidate_diagnostics = _build_candidates(payload)
    diagnostics.extend(candidate_diagnostics)
    errors = [item for item in diagnostics if item.severity == "ERROR"]
    if errors:
        return SchoolTimetableSolveResponse(
            status=SolverStatus.infeasible,
            diagnostics=diagnostics,
            infeasibilityHints=[hint_from_diagnostic(item) for item in errors],
            solverMetrics=SolverMetrics(durationMs=int((time.perf_counter() - started) * 1000)),
        )

    model = cp_model.CpModel()
    variables: dict[str, cp_model.IntVar] = {}
    candidate_meta: dict[str, Candidate] = {}
    unscheduled_variables: dict[str, cp_model.IntVar] = {}
    unscheduled_meta: dict[str, tuple[CurriculumRequirement, int]] = {}
    objective_terms: list[cp_model.LinearExpr] = []
    occupancy_groups: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    same_subject_day_groups: dict[str, list[tuple[cp_model.IntVar, Candidate]]] = defaultdict(list)
    stream_hard_groups: dict[str, tuple[list[cp_model.IntVar], int]] = {}
    stream_soft_groups: dict[str, tuple[list[cp_model.IntVar], int]] = {}
    slot_numbers = _slot_number_map(payload.bellScheduleSlots)
    classes = {item.id: item for item in payload.classes}
    constraints = 0

    for occurrence_key, candidates in candidates_by_occurrence.items():
        occurrence_vars: list[cp_model.IntVar] = []
        for index, candidate in enumerate(candidates):
            key = f"{occurrence_key}:{index}"
            var = model.NewBoolVar(key)
            variables[key] = var
            candidate_meta[key] = candidate
            occurrence_vars.append(var)
            req = candidate.requirement
            for slot_id in candidate.occupied_slot_ids:
                if candidate.teacher_id:
                    occupancy_groups[f"TEACHER:{candidate.teacher_id}:{candidate.cycle_day_id}:{slot_id}"].append(var)
                if req.classId:
                    if req.streamId:
                        occupancy_groups[f"CLASS_STREAM:{req.classId}:{req.streamId}:{candidate.cycle_day_id}:{slot_id}"].append(var)
                    else:
                        occupancy_groups[f"CLASS:{req.classId}:{candidate.cycle_day_id}:{slot_id}"].append(var)
                if req.streamId:
                    occupancy_groups[f"STREAM:{req.streamId}:{candidate.cycle_day_id}:{slot_id}"].append(var)
                for group_id in req.studentGroupIds:
                    occupancy_groups[f"STUDENT_GROUP:{group_id}:{candidate.cycle_day_id}:{slot_id}"].append(var)
                if candidate.facility_id:
                    occupancy_groups[f"FACILITY:{candidate.facility_id}:{candidate.cycle_day_id}:{slot_id}"].append(var)
            if req.classId and req.subjectId:
                same_subject_day_groups[f"{req.classId}:{req.subjectId}:{candidate.cycle_day_id}"].append((var, candidate))
            for rule in payload.streamSchedulingRules:
                for group_key, limit in _stream_rule_group_keys(rule, candidate, classes):
                    target = stream_hard_groups if str(rule.severity).upper() == "HARD" else stream_soft_groups
                    variables_for_group, current_limit = target.get(group_key, ([], limit))
                    variables_for_group.append(var)
                    target[group_key] = (variables_for_group, current_limit)
            if candidate.penalty:
                objective_terms.append(weighted_bool(var, candidate.penalty))
        if payload.allowPartialTimetable:
            req = candidates[0].requirement if candidates else next((item for item in payload.curriculumRequirements if occurrence_key.startswith(f"{item.id}:")), None)
            occurrence = candidates[0].occurrence if candidates else int(occurrence_key.rsplit(":", 1)[-1])
            if req:
                key = f"{occurrence_key}:unscheduled"
                var = model.NewBoolVar(key)
                unscheduled_variables[key] = var
                unscheduled_meta[key] = (req, occurrence)
                occurrence_vars.append(var)
                objective_terms.append(weighted_bool(var, _unscheduled_penalty(req, occurrence)))
        if not occurrence_vars:
            continue
        model.AddExactlyOne(occurrence_vars)
        constraints += 1

    constraints += add_at_most_one_groups(model, occupancy_groups.values())
    constraints += _add_same_subject_double_period_constraints(model, same_subject_day_groups, slot_numbers)
    for variables_for_group, limit in stream_hard_groups.values():
        if len(variables_for_group) > limit:
            model.Add(sum(variables_for_group) <= limit)
            constraints += 1
    constraints += _add_soft_parallel_penalties(model, stream_soft_groups, objective_terms)
    if objective_terms:
        model.Minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = clamp_time_limit(payload.timeLimitSeconds)
    solver.parameters.num_search_workers = 8

    alternatives: list[SchoolAlternative] = []
    max_alternatives = max(1, min(5, int(payload.maxAlternatives or 1)))
    final_status = SolverStatus.failed

    for alt_index in range(max_alternatives):
        status = solver.Solve(model)
        selected_keys = [key for key, var in variables.items() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) and solver.BooleanValue(var)]
        selected_unscheduled_keys = [key for key, var in unscheduled_variables.items() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) and solver.BooleanValue(var)]
        has_solution = bool(selected_keys or selected_unscheduled_keys)
        final_status = _stable_status(status, has_solution)
        if not has_solution:
            break
        selected_candidates = [candidate_meta[key] for key in selected_keys]
        assignments = [_assignment_from_candidate(candidate) for candidate in selected_candidates]
        workload, facility_summary = _summaries(assignments)
        soft_score = float(solver.ObjectiveValue()) if objective_terms else 0.0
        focus_soft_violations = [
            violation
            for candidate in selected_candidates
            for violation in candidate.focus_violations
        ]
        stream_soft_violations = _selected_stream_soft_violations(selected_candidates, payload)
        soft_violations = [
            *[_unscheduled_violation(*unscheduled_meta[key]) for key in selected_unscheduled_keys],
            *focus_soft_violations,
            *stream_soft_violations,
        ]
        warnings = []
        if selected_unscheduled_keys:
            warnings.append(f"{len(selected_unscheduled_keys)} required lesson period{'' if len(selected_unscheduled_keys) == 1 else 's'} could not fit and were left unscheduled.")
        if focus_soft_violations:
            warnings.append(f"{len(focus_soft_violations)} subject focus preference{'' if len(focus_soft_violations) == 1 else 's'} were softened to keep the timetable feasible.")
        if stream_soft_violations:
            warnings.append(f"{len(stream_soft_violations)} stream scheduling preference{'' if len(stream_soft_violations) == 1 else 's'} were softened.")
        alternatives.append(SchoolAlternative(
            alternativeId=f"school-alt-{alt_index + 1}",
            strategy=payload.strategy.value,
            objectiveScore=soft_score,
            hardConflictCount=0,
            softPenaltyScore=soft_score,
            assignments=assignments,
            softViolations=soft_violations,
            workloadSummary=workload,
            facilityUtilizationSummary=facility_summary,
            warnings=warnings,
        ))
        selected_vars = [variables[key] for key in selected_keys] + [unscheduled_variables[key] for key in selected_unscheduled_keys]
        model.AddBoolOr([var.Not() for var in selected_vars])
        constraints += 1

    if not alternatives and final_status not in {SolverStatus.model_invalid, SolverStatus.failed}:
        diagnostics.append(diagnostic(
            "NO_SOLVER_SOLUTION",
            "The hard constraints could not be satisfied by the solver.",
        ))

    metrics = SolverMetrics(
        durationMs=int((time.perf_counter() - started) * 1000),
        variables=len(variables),
        constraints=constraints,
        conflicts=solver.NumConflicts(),
        branches=solver.NumBranches(),
        wallTime=solver.WallTime(),
    )
    if alternatives and final_status in {SolverStatus.infeasible, SolverStatus.time_limit_without_solution}:
        final_status = SolverStatus.time_limit_with_solution
    if alternatives and alternatives[0].softViolations:
        diagnostics.append(diagnostic(
            "PARTIAL_TIMETABLE_GENERATED",
            alternatives[0].warnings[0],
            "WARNING",
            unscheduledCount=len(alternatives[0].softViolations),
        ))
    return SchoolTimetableSolveResponse(
        status=final_status if alternatives or final_status != SolverStatus.failed else SolverStatus.infeasible,
        alternatives=alternatives,
        diagnostics=diagnostics,
        infeasibilityHints=[hint_from_diagnostic(item) for item in diagnostics if item.severity == "ERROR"],
        solverMetrics=metrics,
    )


def find_alternative_slots(payload: AlternativeSlotRequest) -> AlternativeSlotResponse:
    slot_numbers = _slot_number_map(payload.bellScheduleSlots)
    slots = sorted(payload.bellScheduleSlots, key=lambda item: int(item.sortOrder or item.slotNumber))
    suggestions: list[AlternativeSlotSuggestion] = []
    synthetic_req = CurriculumRequirement(
        id="manual-entry",
        entryType=payload.entryType,
        subjectId=payload.subjectId,
        classId=payload.classId,
        teacherId=payload.teacherId,
        requiredFacilityId=payload.facilityId,
        periodsPerCycle=payload.durationSlots,
        blockLength=max(1, payload.durationSlots),
    )
    school_payload = SchoolTimetableSolveRequest(
        schoolId=payload.schoolId,
        cycleDays=payload.cycleDays,
        bellScheduleSlots=payload.bellScheduleSlots,
        facilities=payload.facilities,
        weeklyActivities=payload.weeklyActivities,
        teacherAvailability=payload.teacherAvailability,
        facilityAvailability=payload.facilityAvailability,
        existingOccupancy=payload.existingOccupancy,
        curriculumRequirements=[synthetic_req],
    )
    candidates, diagnostics = _build_candidates(school_payload)
    for candidate in next(iter(candidates.values()), []):
        start_slot = next((slot for slot in slots if slot.id == candidate.start_slot_id), None)
        score = 100 - candidate.penalty - (early_slot_penalty(start_slot) if start_slot else 0)
        suggestions.append(AlternativeSlotSuggestion(
            cycleDayId=candidate.cycle_day_id,
            slotStartId=candidate.start_slot_id,
            slotEndId=candidate.end_slot_id,
            teacherId=candidate.teacher_id,
            facilityId=candidate.facility_id,
            score=score,
            softPenaltyScore=candidate.penalty,
            reasons=["No hard conflict found for this slot."],
        ))
    suggestions.sort(key=lambda item: (-item.score, item.cycleDayId, slot_numbers.get(item.slotStartId, 0)))
    return AlternativeSlotResponse(
        status=SolverStatus.feasible if suggestions else SolverStatus.infeasible,
        suggestions=suggestions[: max(1, int(payload.maxAlternatives or 10))],
        diagnostics=diagnostics,
    )
