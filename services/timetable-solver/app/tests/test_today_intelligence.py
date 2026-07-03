async def test_today_intelligence(client, auth_headers):
    payload = {
        "schoolId": "1",
        "date": "2026-06-30",
        "activeAcademicYear": {"id": "2026", "name": "2026"},
        "activeTerm": {"id": "1", "name": "Term 1"},
        "publishedSchoolTimetableEntries": [
            {"id": "l1", "classId": "c1", "teacherId": "t1", "facilityId": "r1", "startTime": "08:00", "endTime": "08:40", "title": "Math"}
        ],
        "publishedExamTimetableEntries": [
            {"id": "e1", "classId": "c2", "facilityId": "hall", "startTime": "08:00", "endTime": "10:00", "title": "Science Exam", "date": "2026-06-30"}
        ],
        "lessonLogs": [],
    }
    response = await client.post("/intelligence/today", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["schoolStatus"] == "PARTIAL_EXAM_DAY"
    assert body["operatingMode"] == "NORMAL_WITH_EXAMS"
    assert body["examSessionsToday"]
