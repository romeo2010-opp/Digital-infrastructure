import os

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("TIMETABLE_SOLVER_INTERNAL_TOKEN", "test-token")

from app.main import app  # noqa: E402


@pytest.fixture()
async def client() -> AsyncClient:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as test_client:
        yield test_client


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def school_payload() -> dict:
    return {
        "schoolId": "1",
        "academicYearId": "2026",
        "termId": "1",
        "timetableVersionId": "1",
        "cycleDays": [
            {"id": "mon", "code": "MON", "weekday": 1, "sortOrder": 1},
            {"id": "tue", "code": "TUE", "weekday": 2, "sortOrder": 2},
        ],
        "bellScheduleSlots": [
            {"id": "p1", "code": "P1", "startTime": "08:00", "endTime": "08:40", "slotNumber": 1, "sortOrder": 1},
            {"id": "p2", "code": "P2", "startTime": "08:40", "endTime": "09:20", "slotNumber": 2, "sortOrder": 2},
            {"id": "break", "code": "BREAK", "startTime": "09:20", "endTime": "09:40", "slotNumber": 3, "sortOrder": 3, "teachingAllowed": False},
            {"id": "p3", "code": "P3", "startTime": "09:40", "endTime": "10:20", "slotNumber": 4, "sortOrder": 4},
        ],
        "teachers": [
            {"id": "t1", "name": "Teacher One"},
            {"id": "t2", "name": "Teacher Two"},
        ],
        "classes": [
            {"id": "c1", "name": "Year 3A", "size": 20},
            {"id": "c2", "name": "Year 4A", "size": 18},
        ],
        "subjects": [
            {"id": "math", "name": "Mathematics", "important": True},
            {"id": "science", "name": "Science"},
        ],
        "facilities": [
            {"id": "r1", "name": "Room 1", "facilityType": "CLASSROOM", "normalCapacity": 35, "canHostNormalLessons": True},
            {"id": "lab1", "name": "Science Lab", "facilityType": "SCIENCE_LABORATORY", "normalCapacity": 25, "canHostNormalLessons": True, "canHostPracticalExaminations": True},
        ],
        "curriculumRequirements": [
            {"id": "req-math", "subjectId": "math", "classId": "c1", "teacherId": "t1", "periodsPerCycle": 2, "blockLength": 1},
            {"id": "req-science", "entryType": "LABORATORY_LESSON", "subjectId": "science", "classId": "c1", "teacherId": "t2", "requiredFacilityType": "LABORATORY", "periodsPerCycle": 1, "blockLength": 1},
        ],
        "maxAlternatives": 2,
        "timeLimitSeconds": 5,
    }


def exam_payload(scope_type: str = "WHOLE_SCHOOL", refs: list[str] | None = None) -> dict:
    return {
        "schoolId": "1",
        "academicYearId": "2026",
        "termId": "1",
        "examSeriesId": "midterm1",
        "scopeType": scope_type,
        "scopeReferenceIds": refs or [],
        "operatingMode": "NORMAL_LESSONS_CONTINUE",
        "dateRange": {"startDate": "2026-06-30", "endDate": "2026-07-02"},
        "availableExamWindows": [
            {"id": "w1", "date": "2026-06-30", "startTime": "08:00", "endTime": "10:00"},
            {"id": "w2", "date": "2026-07-01", "startTime": "08:00", "endTime": "10:00"},
        ],
        "facilities": [
            {"id": "hall", "name": "Main Hall", "facilityType": "HALL", "examinationCapacity": 120, "canHostExaminations": True},
            {"id": "lab", "name": "Science Lab", "facilityType": "SCIENCE_LABORATORY", "examinationCapacity": 25, "canHostExaminations": True, "canHostPracticalExaminations": True},
            {"id": "comp", "name": "Computer Lab", "facilityType": "COMPUTER_LABORATORY", "examinationCapacity": 30, "functionalComputerCount": 20, "canHostExaminations": True, "canHostComputerExaminations": True},
        ],
        "papers": [
            {"id": "p-math", "name": "Math Paper", "subjectId": "math", "classId": "c1", "gradeLevel": "3", "candidateIds": ["s1", "s2"], "durationMinutes": 90, "majorPaper": True},
            {"id": "p-eng", "name": "English Paper", "subjectId": "eng", "classId": "c1", "gradeLevel": "3", "candidateIds": ["s1", "s2"], "durationMinutes": 90},
            {"id": "p-sci", "name": "Science Practical", "subjectId": "sci", "classId": "c2", "gradeLevel": "4", "candidateIds": ["s3"], "durationMinutes": 90, "requiresLab": True},
        ],
        "maxAlternatives": 1,
        "timeLimitSeconds": 5,
    }
