from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class SolverStatus(str, Enum):
    optimal = "OPTIMAL"
    feasible = "FEASIBLE"
    infeasible = "INFEASIBLE"
    model_invalid = "MODEL_INVALID"
    time_limit_with_solution = "TIME_LIMIT_REACHED_WITH_SOLUTION"
    time_limit_without_solution = "TIME_LIMIT_REACHED_WITHOUT_SOLUTION"
    failed = "FAILED"


class Strategy(str, Enum):
    balanced = "BALANCED"
    teacher_friendly = "TEACHER_FRIENDLY"
    student_learning_optimized = "STUDENT_LEARNING_OPTIMIZED"
    candidate_friendly = "CANDIDATE_FRIENDLY"
    operationally_efficient = "OPERATIONALLY_EFFICIENT"
    custom = "CUSTOM"


class CycleDay(BaseModel):
    id: str
    code: str | None = None
    name: str | None = None
    weekday: int | None = None
    sortOrder: int = 0
    active: bool = True


class BellSlot(BaseModel):
    id: str
    templateId: str | None = None
    code: str | None = None
    name: str | None = None
    startTime: str
    endTime: str
    slotNumber: int
    sortOrder: int = 0
    slotType: str = "TEACHING_PERIOD"
    teachingAllowed: bool = True
    canSpan: bool = True
    cycleDayIds: list[str] = Field(default_factory=list)


class Teacher(BaseModel):
    id: str
    name: str | None = None
    subjectIds: list[str] = Field(default_factory=list)
    maxPeriodsPerCycle: int | None = None
    active: bool = True


class ClassGroup(BaseModel):
    id: str
    name: str | None = None
    gradeLevel: str | None = None
    size: int = 0
    homeFacilityId: str | None = None
    teacherId: str | None = None
    active: bool = True


class StudentGroup(BaseModel):
    id: str
    classId: str | None = None
    name: str | None = None
    studentIds: list[str] = Field(default_factory=list)


class Subject(BaseModel):
    id: str
    name: str | None = None
    code: str | None = None
    difficultyWeight: int = 1
    important: bool = False


class Equipment(BaseModel):
    id: str
    name: str | None = None
    usableQuantity: int = 0
    active: bool = True


class Facility(BaseModel):
    id: str
    name: str | None = None
    facilityType: str = "CLASSROOM"
    normalCapacity: int | None = None
    examinationCapacity: int | None = None
    workstationCount: int | None = None
    functionalComputerCount: int | None = None
    accessible: bool = False
    active: bool = True
    canHostNormalLessons: bool = True
    canHostExaminations: bool = False
    canHostPracticalExaminations: bool = False
    canHostComputerExaminations: bool = False
    canHostListeningExaminations: bool = False
    canHostMultipleGroups: bool = False
    equipmentIds: list[str] = Field(default_factory=list)
    supportedSubjectIds: list[str] = Field(default_factory=list)

    def supports_lesson_type(self, entry_type: str, subject_id: str | None = None) -> bool:
        kind = entry_type.upper()
        facility_type = self.facilityType.upper()
        if not self.active:
            return False
        if "EXAM" in kind and not self.canHostExaminations:
            return False
        if "EXAM" not in kind and not self.canHostNormalLessons:
            return False
        if ("PRACTICAL" in kind or "LABORATORY" in kind) and not (
            "LABORATORY" in facility_type
            or facility_type in {"WORKSHOP", "HOME_ECONOMICS_ROOM", "AGRICULTURE_FACILITY"}
        ):
            return False
        if "COMPUTER" in kind and facility_type != "COMPUTER_LABORATORY":
            return False
        if subject_id and self.supportedSubjectIds and subject_id not in self.supportedSubjectIds:
            return False
        return True


class WeeklyActivity(BaseModel):
    id: str
    name: str
    activityType: str = "CUSTOM"
    cycleDayId: str | None = None
    weekday: int | None = None
    startSlotId: str | None = None
    endSlotId: str | None = None
    scopeType: str = "WHOLE_SCHOOL"
    classIds: list[str] = Field(default_factory=list)
    studentGroupIds: list[str] = Field(default_factory=list)
    teacherId: str | None = None
    facilityId: str | None = None
    blocksNormalLessons: bool = True
    allowsExamOverride: bool = True
    examPolicy: str = "REQUIRE_MANUAL_DECISION"
    active: bool = True


class AvailabilityRule(BaseModel):
    resourceType: Literal["TEACHER", "FACILITY", "LABORATORY", "EQUIPMENT"]
    resourceId: str
    cycleDayId: str | None = None
    weekday: int | None = None
    startSlotId: str | None = None
    endSlotId: str | None = None
    status: Literal["AVAILABLE", "PREFERRED", "AVOID", "RESTRICTED", "UNAVAILABLE", "MAINTENANCE"] = "AVAILABLE"
    reason: str | None = None


class OccupancyRecord(BaseModel):
    resourceType: str
    resourceId: str
    date: str | None = None
    cycleDayId: str | None = None
    startTime: str | None = None
    endTime: str | None = None
    startSlotId: str | None = None
    endSlotId: str | None = None
    occupancyType: str = "CUSTOM"
    sourceEntityType: str | None = None
    sourceEntityId: str | None = None
    title: str | None = None
    blocking: bool = True
    canOverride: bool = False
    overridePermission: str | None = None
    priority: int = 50
    metadata: dict[str, Any] = Field(default_factory=dict)


class HardSoftConfig(BaseModel):
    code: str
    enabled: bool = True
    weight: int = 1000
    configuration: dict[str, Any] = Field(default_factory=dict)


class SolverMetrics(BaseModel):
    durationMs: int = 0
    variables: int = 0
    constraints: int = 0
    conflicts: int = 0
    branches: int = 0
    wallTime: float = 0.0


class Diagnostic(BaseModel):
    code: str
    message: str
    severity: Literal["INFO", "WARNING", "ERROR"] = "ERROR"
    entityType: str | None = None
    entityId: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class DateRange(BaseModel):
    startDate: str
    endDate: str

    @model_validator(mode="after")
    def validate_range(self) -> "DateRange":
        if self.endDate < self.startDate:
            raise ValueError("endDate must be on or after startDate")
        return self


def minutes_since_midnight(value: str | None) -> int | None:
    if not value:
        return None
    parts = value.split(":")
    if len(parts) < 2:
        return None
    try:
        return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        return None


def slot_overlaps(
    start_a: int,
    end_a: int,
    start_b: int,
    end_b: int,
) -> bool:
    return start_a <= end_b and end_a >= start_b
