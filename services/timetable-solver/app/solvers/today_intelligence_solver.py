from __future__ import annotations

from datetime import datetime
from typing import Any

from app.models.today import TodayIntelligenceRequest, TodayIntelligenceResponse


def _time_minutes(value: str | None) -> int | None:
    if not value:
        return None
    try:
        hours, minutes = [int(part) for part in value.split(":")[:2]]
    except ValueError:
        return None
    return hours * 60 + minutes


def _now_minutes() -> int:
    now = datetime.now()
    return now.hour * 60 + now.minute


def _entry_time(entry: dict[str, Any]) -> tuple[int, int]:
    start = _time_minutes(entry.get("startTime") or entry.get("start_time")) or 0
    end = _time_minutes(entry.get("endTime") or entry.get("end_time")) or start
    return start, end


def _active_now(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    now = _now_minutes()
    result = []
    for entry in entries:
        start, end = _entry_time(entry)
        if start <= now <= end:
            result.append(entry)
    return result


def _next_block(entries: list[dict[str, Any]]) -> dict[str, Any] | None:
    now = _now_minutes()
    upcoming = [entry for entry in entries if _entry_time(entry)[0] > now]
    upcoming.sort(key=lambda entry: _entry_time(entry)[0])
    return upcoming[0] if upcoming else None


def _group_by(entries: list[dict[str, Any]], key: str) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for entry in entries:
        value = entry.get(key) or entry.get(key.replace("Id", "_id"))
        if value is None:
            continue
        grouped.setdefault(str(value), []).append(entry)
    return grouped


def _school_status(payload: TodayIntelligenceRequest) -> tuple[str, str]:
    closures = [item for item in payload.schoolClosures if item.get("closure_date") == payload.date or item.get("date") == payload.date]
    if closures:
        closure_type = str(closures[0].get("closure_type") or closures[0].get("type") or "").upper()
        if closure_type in {"HOLIDAY", "PUBLIC_HOLIDAY"}:
            return "HOLIDAY", "CLOSED"
        return "CLOSED", "CLOSED"
    if payload.publishedExamTimetableEntries:
        class_ids = {str(item.get("classId") or item.get("class_id")) for item in payload.publishedExamTimetableEntries if item.get("classId") or item.get("class_id")}
        normal_class_ids = {str(item.get("classId") or item.get("class_id")) for item in payload.publishedSchoolTimetableEntries if item.get("classId") or item.get("class_id")}
        if normal_class_ids and class_ids != normal_class_ids:
            return "PARTIAL_EXAM_DAY", "NORMAL_WITH_EXAMS"
        return "EXAM_DAY", "EXAM_MODE_FULL_SUSPENSION"
    if payload.events:
        whole_school = any(str(item.get("scope") or item.get("scope_type") or "").upper() in {"WHOLE_SCHOOL", "SCHOOL"} for item in payload.events)
        if whole_school:
            return "SPECIAL_EVENT_DAY", "EVENT_OVERRIDE"
    return "NORMAL_SCHOOL_DAY", "NORMAL_TIMETABLE"


def compute_today_intelligence(payload: TodayIntelligenceRequest) -> TodayIntelligenceResponse:
    lessons = [
        dict(entry)
        for entry in payload.publishedSchoolTimetableEntries
        if (entry.get("calendarDate") or entry.get("calendar_date") or payload.date) == payload.date
    ]
    exams = [
        dict(entry)
        for entry in payload.publishedExamTimetableEntries
        if (entry.get("date") or entry.get("examDate") or entry.get("exam_date") or payload.date) == payload.date
    ]
    activities = [
        dict(activity)
        for activity in payload.weeklyActivities
        if activity.get("scopeType") == "WHOLE_SCHOOL" or activity.get("scope_type") == "WHOLE_SCHOOL"
    ]
    cancelled_lessons = [item for item in payload.dailyAdjustments if str(item.get("adjustment_type") or item.get("type") or "").upper() == "CANCELLED_LESSON"]
    room_changes = [item for item in payload.dailyAdjustments if str(item.get("adjustment_type") or item.get("type") or "").upper() == "ROOM_CHANGE"]
    expected_lessons = [
        lesson for lesson in lessons
        if lesson.get("id") not in {item.get("timetable_entry_id") or item.get("entryId") for item in cancelled_lessons}
    ]
    logged_ids = {str(item.get("timetable_entry_id") or item.get("timetableEntryId") or "") for item in payload.lessonLogs}
    already_logged = [lesson for lesson in expected_lessons if str(lesson.get("id") or "") in logged_ids]
    missed = [lesson for lesson in expected_lessons if str(lesson.get("id") or "") not in logged_ids]
    classes_exam = sorted({str(item.get("classId") or item.get("class_id")) for item in exams if item.get("classId") or item.get("class_id")})
    lesson_class_ids = sorted({str(item.get("classId") or item.get("class_id")) for item in lessons if item.get("classId") or item.get("class_id")})
    classes_continuing = [class_id for class_id in lesson_class_ids if class_id not in classes_exam]
    alerts: list[dict[str, Any]] = []
    recommendations: list[str] = []

    if exams:
        alerts.append({"code": "EXAMS_TODAY", "message": f"{len(exams)} exam session(s) are scheduled today.", "severity": "INFO"})
    if payload.teacherAbsences:
        alerts.append({"code": "TEACHER_ABSENCES", "message": f"{len(payload.teacherAbsences)} teacher absence(s) require coverage.", "severity": "WARNING"})
        recommendations.append("Review substitution cover before the next teaching block.")
    if missed:
        alerts.append({"code": "LESSON_LOGS_PENDING", "message": f"{len(missed)} expected lesson log(s) are not complete.", "severity": "WARNING"})
    if payload.facilityMaintenance:
        maintenance_ids = {str(item.get("facilityId") or item.get("facility_id")) for item in payload.facilityMaintenance}
        conflicting = [lesson for lesson in lessons if str(lesson.get("facilityId") or lesson.get("facility_id")) in maintenance_ids]
        if conflicting:
            alerts.append({"code": "FACILITY_MAINTENANCE_CONFLICT", "message": f"{len(conflicting)} lesson(s) use facilities under maintenance.", "severity": "ERROR"})
            recommendations.append("Move affected lessons or clear the maintenance block.")

    status, mode = _school_status(payload)
    all_blocks = [*lessons, *exams, *activities]
    return TodayIntelligenceResponse(
        date=payload.date,
        schoolStatus=status,  # type: ignore[arg-type]
        operatingMode=mode,  # type: ignore[arg-type]
        activeAcademicYear=payload.activeAcademicYear,
        activeTerm=payload.activeTerm,
        todayBellSchedule=[slot.model_dump() for slot in payload.todayBellSchedule],
        currentTimeBlock=(_active_now(all_blocks)[0] if _active_now(all_blocks) else None),
        nextTimeBlock=_next_block(all_blocks),
        wholeSchoolActivities=activities,
        classSchedules=_group_by(lessons, "classId"),
        teacherSchedules=_group_by(lessons, "teacherId"),
        facilitySchedules=_group_by([*lessons, *exams], "facilityId"),
        laboratorySchedules=_group_by([entry for entry in [*lessons, *exams] if "LAB" in str(entry.get("facilityType") or entry.get("facility_type") or "").upper()], "facilityId"),
        examSessionsToday=exams,
        classesWritingExams=classes_exam,
        classesContinuingNormalLessons=classes_continuing,
        suspendedLessons=[],
        substitutions=payload.substitutions,
        teacherAbsences=payload.teacherAbsences,
        roomChanges=room_changes,
        cancelledLessons=cancelled_lessons,
        pendingAttendanceRegisters=payload.attendanceSessions,
        lessonsExpectedToBeTaught=expected_lessons,
        lessonsAlreadyLogged=already_logged,
        missedOrUnloggedLessons=missed,
        facilitiesInUseNow=_active_now([*lessons, *exams]),
        laboratoriesInUseNow=_active_now([entry for entry in [*lessons, *exams] if "LAB" in str(entry.get("facilityType") or entry.get("facility_type") or "").upper()]),
        upcomingCriticalEvents=payload.events[:10],
        alerts=alerts,
        recommendations=recommendations,
    )

