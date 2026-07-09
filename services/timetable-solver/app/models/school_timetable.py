from typing import Any, Literal

from pydantic import BaseModel, Field

from app.models.common import (
    AvailabilityRule,
    BellSlot,
    ClassGroup,
    CycleDay,
    Diagnostic,
    Equipment,
    Facility,
    HardSoftConfig,
    OccupancyRecord,
    SolverMetrics,
    SolverStatus,
    Strategy,
    StudentGroup,
    Subject,
    Teacher,
    WeeklyActivity,
)


class LockedAssignment(BaseModel):
    requirementId: str | None = None
    entryType: str = "LESSON"
    subjectId: str | None = None
    classId: str | None = None
    streamId: str | None = None
    studentGroupIds: list[str] = Field(default_factory=list)
    teacherId: str | None = None
    assistantTeacherId: str | None = None
    facilityId: str | None = None
    equipmentIds: list[str] = Field(default_factory=list)
    cycleWeek: int = 1
    cycleDayId: str | None = None
    slotStartId: str
    slotEndId: str | None = None
    locked: bool = True
    sourceWeeklyActivityId: str | None = None
    notes: str | None = None


class CurriculumRequirement(BaseModel):
    id: str
    entryType: str = "LESSON"
    subjectId: str | None = None
    classId: str | None = None
    streamId: str | None = None
    studentGroupIds: list[str] = Field(default_factory=list)
    teacherId: str | None = None
    eligibleTeacherIds: list[str] = Field(default_factory=list)
    assistantTeacherId: str | None = None
    requiredFacilityId: str | None = None
    preferredFacilityIds: list[str] = Field(default_factory=list)
    requiredFacilityType: str | None = None
    equipmentIds: list[str] = Field(default_factory=list)
    periodsPerCycle: int = 1
    blockLength: int = 1
    priority: int = 50
    allowedBlockLengths: list[int] = Field(default_factory=list)
    minPeriodsPerDay: int | None = None
    maxPeriodsPerDay: int | None = None
    allowedCycleDayIds: list[str] = Field(default_factory=list)
    preferredCycleDayIds: list[str] = Field(default_factory=list)
    avoidedCycleDayIds: list[str] = Field(default_factory=list)
    allowedSlotIds: list[str] = Field(default_factory=list)
    preferredSlotIds: list[str] = Field(default_factory=list)
    avoidedSlotIds: list[str] = Field(default_factory=list)
    lockedAssignments: list[LockedAssignment] = Field(default_factory=list)
    requiredCapacity: int | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class BellScheduleSlotTag(BaseModel):
    slotId: str
    tagCodes: list[str] = Field(default_factory=list)
    tags: list[dict[str, Any]] = Field(default_factory=list)


class SubjectFocusCategory(BaseModel):
    id: str
    code: str
    name: str
    defaultPriority: int = 50


class SubjectFocusAssignment(BaseModel):
    id: str
    subjectId: str
    focusCategoryId: str
    academicYearId: str | None = None
    termId: str | None = None
    gradeLevel: str | None = None
    classId: str | None = None
    streamId: str | None = None


class SubjectFocusRule(BaseModel):
    id: str
    name: str
    focusCategoryId: str | None = None
    subjectId: str | None = None
    academicYearId: str | None = None
    termId: str | None = None
    scopeType: str = "WHOLE_SCHOOL"
    scopeReferenceId: str | None = None
    scopeValue: str | None = None
    classId: str | None = None
    streamId: str | None = None
    gradeLevel: str | None = None
    preferredSlotTags: list[str] = Field(default_factory=list)
    avoidedSlotTags: list[str] = Field(default_factory=list)
    preferredSlotIds: list[str] = Field(default_factory=list)
    avoidedSlotIds: list[str] = Field(default_factory=list)
    severity: Literal["HARD", "SOFT"] = "SOFT"
    penaltyWeight: int = 50
    maxAfterLunchPerCycle: int | None = None
    maxLastPeriodPerCycle: int | None = None
    minimumPreferredPerCycle: int | None = None
    allowOverride: bool = True


class StreamSchedulingRule(BaseModel):
    id: str
    name: str
    academicYearId: str | None = None
    termId: str | None = None
    scopeType: str = "WHOLE_SCHOOL"
    scopeReferenceId: str | None = None
    scopeValue: str | None = None
    gradeLevel: str | None = None
    classId: str | None = None
    streamId: str | None = None
    subjectId: str | None = None
    policy: str = "DISALLOW_PARALLEL_SAME_SUBJECT"
    severity: Literal["HARD", "SOFT"] = "HARD"
    penaltyWeight: int = 80
    maxParallelCount: int | None = None
    requireDifferentTeachers: bool = False
    requireDifferentRooms: bool = False
    allowOverride: bool = False


class SchoolTimetableSolveRequest(BaseModel):
    schoolId: str
    academicYearId: str | None = None
    termId: str | None = None
    timetableVersionId: str | None = None
    timetableCycleWeeks: int = 1
    cycleWeeks: list[dict[str, Any]] = Field(default_factory=list)
    cycleDays: list[CycleDay] = Field(default_factory=list)
    bellScheduleSlots: list[BellSlot] = Field(default_factory=list)
    bellScheduleSlotTags: list[BellScheduleSlotTag] = Field(default_factory=list)
    teachers: list[Teacher] = Field(default_factory=list)
    classes: list[ClassGroup] = Field(default_factory=list)
    streams: list[dict[str, Any]] = Field(default_factory=list)
    studentGroups: list[StudentGroup] = Field(default_factory=list)
    subjects: list[Subject] = Field(default_factory=list)
    facilities: list[Facility] = Field(default_factory=list)
    laboratories: list[Facility] = Field(default_factory=list)
    equipment: list[Equipment] = Field(default_factory=list)
    weeklyActivities: list[WeeklyActivity] = Field(default_factory=list)
    fixedEntries: list[LockedAssignment] = Field(default_factory=list)
    lockedEntries: list[LockedAssignment] = Field(default_factory=list)
    curriculumRequirements: list[CurriculumRequirement] = Field(default_factory=list)
    subjectFocusCategories: list[SubjectFocusCategory] = Field(default_factory=list)
    subjectFocusAssignments: list[SubjectFocusAssignment] = Field(default_factory=list)
    subjectFocusRules: list[SubjectFocusRule] = Field(default_factory=list)
    streamSchedulingRules: list[StreamSchedulingRule] = Field(default_factory=list)
    teacherAvailability: list[AvailabilityRule] = Field(default_factory=list)
    facilityAvailability: list[AvailabilityRule] = Field(default_factory=list)
    existingOccupancy: list[OccupancyRecord] = Field(default_factory=list)
    hardConstraints: list[HardSoftConfig] = Field(default_factory=list)
    softConstraints: list[HardSoftConfig] = Field(default_factory=list)
    strategy: Strategy = Strategy.balanced
    allowPartialTimetable: bool = False
    maxAlternatives: int = 1
    timeLimitSeconds: int = 20


class SchoolAssignment(BaseModel):
    requirementId: str
    entryType: str = "LESSON"
    subjectId: str | None = None
    classId: str | None = None
    streamId: str | None = None
    studentGroupIds: list[str] = Field(default_factory=list)
    teacherId: str | None = None
    assistantTeacherId: str | None = None
    facilityId: str | None = None
    equipmentIds: list[str] = Field(default_factory=list)
    cycleWeek: int = 1
    cycleDayId: str
    slotStartId: str
    slotEndId: str
    locked: bool = False
    sourceWeeklyActivityId: str | None = None
    notes: str | None = None


class SchoolAlternative(BaseModel):
    alternativeId: str
    strategy: str
    objectiveScore: float | None = None
    hardConflictCount: int = 0
    softPenaltyScore: float = 0
    assignments: list[SchoolAssignment] = Field(default_factory=list)
    softViolations: list[dict[str, Any]] = Field(default_factory=list)
    workloadSummary: dict[str, Any] = Field(default_factory=dict)
    facilityUtilizationSummary: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class SchoolTimetableSolveResponse(BaseModel):
    status: SolverStatus
    alternatives: list[SchoolAlternative] = Field(default_factory=list)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
    infeasibilityHints: list[str] = Field(default_factory=list)
    solverMetrics: SolverMetrics = Field(default_factory=SolverMetrics)


class AlternativeSlotRequest(BaseModel):
    schoolId: str
    entryType: str = "LESSON"
    subjectId: str | None = None
    classId: str | None = None
    teacherId: str | None = None
    facilityId: str | None = None
    cycleWeek: int = 1
    cycleDays: list[CycleDay] = Field(default_factory=list)
    bellScheduleSlots: list[BellSlot] = Field(default_factory=list)
    facilities: list[Facility] = Field(default_factory=list)
    weeklyActivities: list[WeeklyActivity] = Field(default_factory=list)
    teacherAvailability: list[AvailabilityRule] = Field(default_factory=list)
    facilityAvailability: list[AvailabilityRule] = Field(default_factory=list)
    existingOccupancy: list[OccupancyRecord] = Field(default_factory=list)
    durationSlots: int = 1
    maxAlternatives: int = 10
    allowedResourceChanges: list[Literal["TEACHER", "FACILITY", "ROOM"]] = Field(default_factory=list)


class AlternativeSlotSuggestion(BaseModel):
    cycleWeek: int = 1
    cycleDayId: str
    slotStartId: str
    slotEndId: str
    teacherId: str | None = None
    facilityId: str | None = None
    score: int
    softPenaltyScore: int
    reasons: list[str] = Field(default_factory=list)


class AlternativeSlotResponse(BaseModel):
    status: SolverStatus = SolverStatus.feasible
    suggestions: list[AlternativeSlotSuggestion] = Field(default_factory=list)
    diagnostics: list[Diagnostic] = Field(default_factory=list)
