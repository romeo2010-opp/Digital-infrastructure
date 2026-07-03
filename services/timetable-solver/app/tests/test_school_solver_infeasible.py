from conftest import school_payload


async def test_school_solver_infeasible_due_to_teacher_overload(client, auth_headers):
    payload = school_payload()
    payload["cycleDays"] = [{"id": "mon", "code": "MON", "weekday": 1, "sortOrder": 1}]
    payload["bellScheduleSlots"] = [
        {"id": "p1", "code": "P1", "startTime": "08:00", "endTime": "08:40", "slotNumber": 1, "sortOrder": 1}
    ]
    payload["curriculumRequirements"] = [
        {"id": "req-1", "subjectId": "math", "classId": "c1", "teacherId": "t1", "periodsPerCycle": 1},
        {"id": "req-2", "subjectId": "science", "classId": "c2", "teacherId": "t1", "periodsPerCycle": 1},
    ]
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "INFEASIBLE"


async def test_school_solver_infeasible_due_to_lab_shortage(client, auth_headers):
    payload = school_payload()
    payload["facilities"] = [{"id": "r1", "name": "Room 1", "facilityType": "CLASSROOM", "normalCapacity": 35, "canHostNormalLessons": True}]
    payload["laboratories"] = []
    payload["curriculumRequirements"] = [
        {"id": "req-lab", "entryType": "LABORATORY_LESSON", "subjectId": "science", "classId": "c1", "teacherId": "t2", "requiredFacilityType": "LABORATORY", "periodsPerCycle": 1}
    ]
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "INFEASIBLE"
    assert body["infeasibilityHints"]
