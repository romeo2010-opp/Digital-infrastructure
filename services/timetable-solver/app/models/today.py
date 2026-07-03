from typing import Any, Literal

from pydantic import BaseModel, Field

from app.models.common import BellSlot, OccupancyRecord


class TodayIntelligenceRequest(BaseModel):
    schoolId: str
    date: str
    timezone: str = "Africa/Blantyre"
    activeAcademicYear: dict[str, Any] | None = None
    activeTerm: dict[str, Any] | None = None
    todayBellSchedule: list[BellSlot] = Field(default_factory=list)
    publishedSchoolTimetableEntries: list[dict[str, Any]] = Field(default_factory=list)
    weeklyActivities: list[dict[str, Any]] = Field(default_factory=list)
    dailyAdjustments: list[dict[str, Any]] = Field(default_factory=list)
    teacherAbsences: list[dict[str, Any]] = Field(default_factory=list)
    substitutions: list[dict[str, Any]] = Field(default_factory=list)
    publishedExamTimetableEntries: list[dict[str, Any]] = Field(default_factory=list)
    examSessions: list[dict[str, Any]] = Field(default_factory=list)
    facilityMaintenance: list[dict[str, Any]] = Field(default_factory=list)
    schoolClosures: list[dict[str, Any]] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)
    attendanceSessions: list[dict[str, Any]] = Field(default_factory=list)
    lessonLogs: list[dict[str, Any]] = Field(default_factory=list)
    notifications: list[dict[str, Any]] = Field(default_factory=list)
    calendarEntries: list[dict[str, Any]] = Field(default_factory=list)
    occupancy: list[OccupancyRecord] = Field(default_factory=list)


class TodayIntelligenceResponse(BaseModel):
    date: str
    schoolStatus: Literal[
        "NORMAL_SCHOOL_DAY",
        "EXAM_DAY",
        "PARTIAL_EXAM_DAY",
        "HOLIDAY",
        "CLOSED",
        "SPECIAL_EVENT_DAY",
        "EMERGENCY_ADJUSTED_DAY",
    ]
    operatingMode: Literal[
        "NORMAL_TIMETABLE",
        "EXAM_MODE_FULL_SUSPENSION",
        "EXAM_MODE_PARTIAL_SUSPENSION",
        "NORMAL_WITH_EXAMS",
        "EVENT_OVERRIDE",
        "CLOSED",
    ]
    activeAcademicYear: dict[str, Any] | None = None
    activeTerm: dict[str, Any] | None = None
    todayBellSchedule: list[dict[str, Any]] = Field(default_factory=list)
    currentTimeBlock: dict[str, Any] | None = None
    nextTimeBlock: dict[str, Any] | None = None
    wholeSchoolActivities: list[dict[str, Any]] = Field(default_factory=list)
    classSchedules: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    teacherSchedules: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    facilitySchedules: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    laboratorySchedules: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    examSessionsToday: list[dict[str, Any]] = Field(default_factory=list)
    classesWritingExams: list[str] = Field(default_factory=list)
    classesContinuingNormalLessons: list[str] = Field(default_factory=list)
    suspendedLessons: list[dict[str, Any]] = Field(default_factory=list)
    substitutions: list[dict[str, Any]] = Field(default_factory=list)
    teacherAbsences: list[dict[str, Any]] = Field(default_factory=list)
    roomChanges: list[dict[str, Any]] = Field(default_factory=list)
    cancelledLessons: list[dict[str, Any]] = Field(default_factory=list)
    pendingAttendanceRegisters: list[dict[str, Any]] = Field(default_factory=list)
    lessonsExpectedToBeTaught: list[dict[str, Any]] = Field(default_factory=list)
    lessonsAlreadyLogged: list[dict[str, Any]] = Field(default_factory=list)
    missedOrUnloggedLessons: list[dict[str, Any]] = Field(default_factory=list)
    facilitiesInUseNow: list[dict[str, Any]] = Field(default_factory=list)
    laboratoriesInUseNow: list[dict[str, Any]] = Field(default_factory=list)
    upcomingCriticalEvents: list[dict[str, Any]] = Field(default_factory=list)
    alerts: list[dict[str, Any]] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)

