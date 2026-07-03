from typing import Any, Literal

from pydantic import BaseModel, Field

from app.models.common import (
    AvailabilityRule,
    DateRange,
    Diagnostic,
    Equipment,
    Facility,
    HardSoftConfig,
    OccupancyRecord,
    SolverMetrics,
    SolverStatus,
    Strategy,
    Teacher,
    WeeklyActivity,
)


class ExamWindow(BaseModel):
    id: str
    date: str
    startTime: str
    endTime: str
    name: str | None = None
    slotStartId: str | None = None
    slotEndId: str | None = None
    facilityIds: list[str] = Field(default_factory=list)
    canBeOverridden: bool = False


class ExamPaper(BaseModel):
    id: str
    name: str | None = None
    subjectId: str | None = None
    classId: str | None = None
    gradeLevel: str | None = None
    streamId: str | None = None
    studentGroupIds: list[str] = Field(default_factory=list)
    candidateIds: list[str] = Field(default_factory=list)
    durationMinutes: int = 120
    setupBufferMinutes: int = 0
    collectionBufferMinutes: int = 0
    requiresLab: bool = False
    requiresComputer: bool = False
    requiresListening: bool = False
    requiresTechnicalAssistant: bool = False
    fixedWindowId: str | None = None
    allowedWindowIds: list[str] = Field(default_factory=list)
    allowedFacilityIds: list[str] = Field(default_factory=list)
    requiredFacilityType: str | None = None
    difficultyWeight: int = 1
    majorPaper: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)


class CandidateRegistration(BaseModel):
    candidateId: str
    paperIds: list[str] = Field(default_factory=list)
    classId: str | None = None
    gradeLevel: str | None = None
    streamId: str | None = None
    studentGroupIds: list[str] = Field(default_factory=list)
    extraTimePercent: int = 0
    accommodationFacilityIds: list[str] = Field(default_factory=list)


class ExamTimetableSolveRequest(BaseModel):
    schoolId: str
    academicYearId: str | None = None
    termId: str | None = None
    examSeriesId: str | None = None
    scopeType: Literal["WHOLE_SCHOOL", "GRADE", "CLASS", "STREAM", "STUDENT_GROUP", "SUBJECT", "CUSTOM"] = "WHOLE_SCHOOL"
    scopeReferenceIds: list[str] = Field(default_factory=list)
    operatingMode: Literal["NORMAL_LESSONS_CONTINUE", "PARTIAL_SUSPENSION", "FULL_SCHOOL_SUSPENSION", "CUSTOM"] = "NORMAL_LESSONS_CONTINUE"
    dateRange: DateRange | None = None
    schoolOperatingHours: dict[str, Any] = Field(default_factory=dict)
    schoolClosureDates: list[str] = Field(default_factory=list)
    availableExamWindows: list[ExamWindow] = Field(default_factory=list)
    weeklyActivities: list[WeeklyActivity] = Field(default_factory=list)
    activityExamPolicies: list[dict[str, Any]] = Field(default_factory=list)
    normalSchoolTimetableOccupancy: list[OccupancyRecord] = Field(default_factory=list)
    dailyAdjustments: list[dict[str, Any]] = Field(default_factory=list)
    facilities: list[Facility] = Field(default_factory=list)
    laboratories: list[Facility] = Field(default_factory=list)
    computerLabs: list[Facility] = Field(default_factory=list)
    equipment: list[Equipment] = Field(default_factory=list)
    papers: list[ExamPaper] = Field(default_factory=list)
    candidateRegistrations: list[CandidateRegistration] = Field(default_factory=list)
    candidateGroups: list[dict[str, Any]] = Field(default_factory=list)
    accommodations: list[dict[str, Any]] = Field(default_factory=list)
    invigilators: list[Teacher] = Field(default_factory=list)
    teacherAvailability: list[AvailabilityRule] = Field(default_factory=list)
    facilityAvailability: list[AvailabilityRule] = Field(default_factory=list)
    existingExamSessions: list[dict[str, Any]] = Field(default_factory=list)
    existingFacilityReservations: list[OccupancyRecord] = Field(default_factory=list)
    hardConstraints: list[HardSoftConfig] = Field(default_factory=list)
    softConstraints: list[HardSoftConfig] = Field(default_factory=list)
    strategy: Strategy = Strategy.candidate_friendly
    maxAlternatives: int = 1
    timeLimitSeconds: int = 20


class ExamPaperAssignment(BaseModel):
    paperId: str
    windowId: str
    date: str
    startTime: str
    endTime: str
    slotStartId: str | None = None
    slotEndId: str | None = None
    facilityId: str | None = None
    candidateIds: list[str] = Field(default_factory=list)


class ExamSessionDraft(BaseModel):
    sessionId: str
    windowId: str
    date: str
    startTime: str
    endTime: str
    paperIds: list[str] = Field(default_factory=list)
    facilityIds: list[str] = Field(default_factory=list)


class ExamAlternative(BaseModel):
    alternativeId: str
    strategy: str
    objectiveScore: float | None = None
    hardConflictCount: int = 0
    softPenaltyScore: float = 0
    sessions: list[ExamSessionDraft] = Field(default_factory=list)
    paperAssignments: list[ExamPaperAssignment] = Field(default_factory=list)
    roomAllocations: list[dict[str, Any]] = Field(default_factory=list)
    invigilationRequirements: list[dict[str, Any]] = Field(default_factory=list)
    requiredOverrides: list[dict[str, Any]] = Field(default_factory=list)
    affectedNormalLessons: list[dict[str, Any]] = Field(default_factory=list)
    affectedWeeklyActivities: list[dict[str, Any]] = Field(default_factory=list)
    candidatePressureReport: dict[str, Any] = Field(default_factory=dict)
    facilityUtilizationReport: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class ExamTimetableSolveResponse(BaseModel):
    status: SolverStatus
    alternatives: list[ExamAlternative] = Field(default_factory=list)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    infeasibilityHints: list[str] = Field(default_factory=list)
    solverMetrics: SolverMetrics = Field(default_factory=SolverMetrics)


class ExamRoomAllocationRequest(BaseModel):
    schoolId: str
    paperAssignments: list[ExamPaperAssignment] = Field(default_factory=list)
    papers: list[ExamPaper] = Field(default_factory=list)
    facilities: list[Facility] = Field(default_factory=list)
    candidateRegistrations: list[CandidateRegistration] = Field(default_factory=list)
    allowMultiplePapersPerRoom: bool = False
    allowPaperSplitAcrossRooms: bool = True
    timeLimitSeconds: int = 20


class ExamRoomAllocationResponse(BaseModel):
    status: SolverStatus
    allocations: list[dict[str, Any]] = Field(default_factory=list)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    solverMetrics: SolverMetrics = Field(default_factory=SolverMetrics)


class InvigilationRequest(BaseModel):
    schoolId: str
    roomAllocations: list[dict[str, Any]] = Field(default_factory=list)
    invigilators: list[Teacher] = Field(default_factory=list)
    teacherAvailability: list[AvailabilityRule] = Field(default_factory=list)
    avoidOwnSubject: bool = True
    candidatePerInvigilatorRatio: int = 30
    minimumInvigilatorsPerRoom: int = 1
    requireChiefInvigilator: bool = True
    requireTechnicalAssistantForComputerOrLab: bool = True
    timeLimitSeconds: int = 20


class InvigilationResponse(BaseModel):
    status: SolverStatus
    assignments: list[dict[str, Any]] = Field(default_factory=list)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    solverMetrics: SolverMetrics = Field(default_factory=SolverMetrics)
