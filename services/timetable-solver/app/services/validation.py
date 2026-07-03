from app.constraints.diagnostics import diagnostic
from app.models.common import Diagnostic
from app.models.school_timetable import SchoolTimetableSolveRequest


def _usable_teaching_slots(payload: SchoolTimetableSolveRequest) -> int:
    active_days = [day for day in payload.cycleDays if day.active]
    return sum(
        1
        for day in active_days
        for slot in payload.bellScheduleSlots
        if slot.teachingAllowed and (not slot.cycleDayIds or day.id in slot.cycleDayIds)
    )


def validate_school_problem(payload: SchoolTimetableSolveRequest) -> list[Diagnostic]:
    diagnostics: list[Diagnostic] = []
    if not payload.cycleDays:
        diagnostics.append(diagnostic("NO_CYCLE_DAYS", "No active cycle days were provided."))
    if not payload.bellScheduleSlots:
        diagnostics.append(diagnostic("NO_BELL_SLOTS", "No bell schedule slots were provided."))
    if not payload.curriculumRequirements:
        diagnostics.append(diagnostic("NO_CURRICULUM_REQUIREMENTS", "No curriculum period requirements were provided."))
    total_usable = _usable_teaching_slots(payload)
    required = sum(max(0, req.periodsPerCycle) for req in payload.curriculumRequirements)
    severity = "WARNING" if payload.allowPartialTimetable else "ERROR"
    class_names = {item.id: item.name or item.id for item in payload.classes}
    required_by_group: dict[str, tuple[str, str, int]] = {}
    for req in payload.curriculumRequirements:
        if not req.classId:
            continue
        group_id = f"{req.classId}:stream:{req.streamId}" if req.streamId else req.classId
        entity_type = "stream" if req.streamId else "class"
        label = f"{class_names.get(req.classId, f'Class {req.classId}')} stream {req.streamId}" if req.streamId else class_names.get(req.classId, f"Class {req.classId}")
        previous = required_by_group.get(group_id)
        required_by_group[group_id] = (entity_type, label, (previous[2] if previous else 0) + max(0, req.periodsPerCycle))
    for group_id, (entity_type, label, group_required) in required_by_group.items():
        if total_usable and group_required > total_usable:
            diagnostics.append(diagnostic(
                "CLASS_PERIOD_OVERLOAD",
                f"{label} asks for {group_required} periods, but only {total_usable} teaching slots exist in the cycle.",
                severity,
                entity_type=entity_type,
                entity_id=group_id,
                requiredPeriods=group_required,
                availableTeachingSlots=total_usable,
                overflowPeriods=group_required - total_usable,
                allowPartialTimetable=payload.allowPartialTimetable,
            ))
    if total_usable and required > total_usable * max(1, len(required_by_group)):
        diagnostics.append(diagnostic(
            "POSSIBLE_PERIOD_OVERLOAD",
            f"Requirements ask for {required} periods across only {total_usable} usable slots per class cycle.",
            "WARNING",
        ))
    return diagnostics
