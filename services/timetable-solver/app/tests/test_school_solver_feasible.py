from conftest import school_payload


async def test_school_solver_feasible(client, auth_headers):
    response = await client.post("/solve/school-timetable", json=school_payload(), headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    assert body["alternatives"]
    assert len(body["alternatives"][0]["assignments"]) == 3


async def test_locked_manual_entry_respected(client, auth_headers):
    payload = school_payload()
    payload["curriculumRequirements"][0]["lockedAssignments"] = [
        {"requirementId": "req-math", "classId": "c1", "teacherId": "t1", "facilityId": "r1", "cycleDayId": "mon", "slotStartId": "p1", "slotEndId": "p1"}
    ]
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    body = response.json()
    assignments = body["alternatives"][0]["assignments"]
    assert any(item["requirementId"] == "req-math" and item["cycleDayId"] == "mon" and item["slotStartId"] == "p1" and item["locked"] for item in assignments)


async def test_stale_locked_slot_returns_diagnostic(client, auth_headers):
    payload = school_payload()
    payload["curriculumRequirements"][0]["lockedAssignments"] = [
        {"requirementId": "req-math", "classId": "c1", "teacherId": "t1", "facilityId": "r1", "cycleDayId": "mon", "slotStartId": "20", "slotEndId": "20"}
    ]
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "INFEASIBLE"
    assert any(item["code"] == "STALE_LOCKED_SLOT" and item["metadata"]["missingSlotIds"] == ["20"] for item in body["diagnostics"])


async def test_day_specific_bell_template_places_friday_subject(client, auth_headers):
    payload = school_payload()
    payload["cycleDays"] = [
        {"id": "mon", "code": "MON", "weekday": 1, "sortOrder": 1},
        {"id": "fri", "code": "FRI", "weekday": 5, "sortOrder": 5},
    ]
    payload["bellScheduleSlots"] = [
        {"id": "mon-p1", "templateId": "standard", "cycleDayIds": ["mon"], "code": "P1", "startTime": "08:00", "endTime": "08:40", "slotNumber": 1, "sortOrder": 1},
        {"id": "fri-p1", "templateId": "friday", "cycleDayIds": ["fri"], "code": "FRI", "startTime": "07:30", "endTime": "08:10", "slotNumber": 1, "sortOrder": 1},
    ]
    payload["curriculumRequirements"] = [
        {
            "id": "req-friday-math",
            "subjectId": "math",
            "classId": "c1",
            "teacherId": "t1",
            "periodsPerCycle": 1,
            "blockLength": 1,
            "allowedCycleDayIds": ["fri"],
            "allowedSlotIds": ["fri-p1"],
        }
    ]
    payload["maxAlternatives"] = 1
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    assignments = body["alternatives"][0]["assignments"]
    assert assignments[0]["cycleDayId"] == "fri"
    assert assignments[0]["slotStartId"] == "fri-p1"


async def test_partial_timetable_leaves_overflow_periods_unscheduled(client, auth_headers):
    payload = school_payload()
    payload["allowPartialTimetable"] = True
    payload["cycleDays"] = [{"id": "fri", "code": "FRI", "weekday": 5, "sortOrder": 5}]
    payload["bellScheduleSlots"] = [
        {"id": "fri-p1", "templateId": "friday", "cycleDayIds": ["fri"], "code": "FRI", "startTime": "07:30", "endTime": "08:10", "slotNumber": 1, "sortOrder": 1},
    ]
    payload["curriculumRequirements"] = [
        {"id": "req-overflow", "subjectId": "math", "classId": "c1", "teacherId": "t1", "periodsPerCycle": 2, "blockLength": 1}
    ]
    payload["maxAlternatives"] = 1
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    alternative = body["alternatives"][0]
    assert len(alternative["assignments"]) == 1
    assert len(alternative["softViolations"]) == 1
    assert alternative["softViolations"][0]["code"] == "UNSCHEDULED_REQUIREMENT_OCCURRENCE"
    assert any(item["code"] == "CLASS_PERIOD_OVERLOAD" and item["severity"] == "WARNING" for item in body["diagnostics"])


async def test_partial_timetable_prefers_high_priority_requirement(client, auth_headers):
    payload = school_payload()
    payload["allowPartialTimetable"] = True
    payload["cycleDays"] = [{"id": "mon", "code": "MON", "weekday": 1, "sortOrder": 1}]
    payload["bellScheduleSlots"] = [
        {"id": "p1", "code": "P1", "startTime": "08:00", "endTime": "08:40", "slotNumber": 1, "sortOrder": 1},
        {"id": "p2", "code": "P2", "startTime": "08:40", "endTime": "09:20", "slotNumber": 2, "sortOrder": 2},
    ]
    payload["curriculumRequirements"] = [
        {"id": "req-low", "subjectId": "science", "classId": "c1", "teacherId": "t1", "periodsPerCycle": 2, "blockLength": 1, "priority": 20},
        {"id": "req-math", "subjectId": "math", "classId": "c1", "teacherId": "t1", "periodsPerCycle": 1, "blockLength": 1, "priority": 90},
    ]
    payload["maxAlternatives"] = 1
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    alternative = body["alternatives"][0]
    assert any(item["requirementId"] == "req-math" for item in alternative["assignments"])
    assert all(item["requirementId"] != "req-math" for item in alternative["softViolations"])


async def test_same_subject_twice_in_day_becomes_consecutive_double_period(client, auth_headers):
    payload = school_payload()
    payload["cycleDays"] = [{"id": "mon", "code": "MON", "weekday": 1, "sortOrder": 1}]
    payload["bellScheduleSlots"] = [
        {"id": "p1", "code": "P1", "startTime": "08:00", "endTime": "08:40", "slotNumber": 1, "sortOrder": 1},
        {"id": "p2", "code": "P2", "startTime": "08:40", "endTime": "09:20", "slotNumber": 2, "sortOrder": 2},
        {"id": "p3", "code": "P3", "startTime": "09:20", "endTime": "10:00", "slotNumber": 3, "sortOrder": 3},
    ]
    payload["curriculumRequirements"] = [
        {
            "id": "req-math-double",
            "subjectId": "math",
            "classId": "c1",
            "teacherId": "t1",
            "periodsPerCycle": 2,
            "blockLength": 1,
            "preferredSlotIds": ["p1", "p3"],
        }
    ]
    payload["maxAlternatives"] = 1
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    assignments = sorted(body["alternatives"][0]["assignments"], key=lambda item: item["slotStartId"])
    slot_numbers = {"p1": 1, "p2": 2, "p3": 3}
    assert len(assignments) == 2
    assert abs(slot_numbers[assignments[0]["slotStartId"]] - slot_numbers[assignments[1]["slotStartId"]]) == 1


async def test_subject_focus_prefers_tagged_morning_slot(client, auth_headers):
    payload = school_payload()
    payload["cycleDays"] = [{"id": "mon", "code": "MON", "weekday": 1, "sortOrder": 1}]
    payload["bellScheduleSlots"] = [
        {"id": "p1", "code": "P1", "startTime": "08:00", "endTime": "08:40", "slotNumber": 1, "sortOrder": 1},
        {"id": "p2", "code": "P2", "startTime": "13:00", "endTime": "13:40", "slotNumber": 2, "sortOrder": 2},
    ]
    payload["bellScheduleSlotTags"] = [
        {"slotId": "p1", "tagCodes": ["MORNING_FOCUS", "EARLY_MORNING"]},
        {"slotId": "p2", "tagCodes": ["AFTER_LUNCH", "AFTERNOON"]},
    ]
    payload["subjectFocusCategories"] = [{"id": "focus-high", "code": "HIGH_FOCUS", "name": "High Focus"}]
    payload["subjectFocusAssignments"] = [{"id": "assign-math", "subjectId": "math", "focusCategoryId": "focus-high"}]
    payload["subjectFocusRules"] = [
        {
            "id": "rule-morning",
            "name": "High focus in the morning",
            "focusCategoryId": "focus-high",
            "preferredSlotTags": ["MORNING_FOCUS"],
            "avoidedSlotTags": ["AFTER_LUNCH"],
            "severity": "SOFT",
            "penaltyWeight": 80,
        }
    ]
    payload["curriculumRequirements"] = [
        {"id": "req-math-focus", "subjectId": "math", "classId": "c1", "teacherId": "t1", "periodsPerCycle": 1, "blockLength": 1}
    ]
    payload["maxAlternatives"] = 1
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    assert body["alternatives"][0]["assignments"][0]["slotStartId"] == "p1"
    assert not any(item["code"] == "SUBJECT_FOCUS_SOFT_WARNING" for item in body["alternatives"][0]["softViolations"])


async def test_hard_subject_focus_rule_blocks_avoided_tag(client, auth_headers):
    payload = school_payload()
    payload["allowPartialTimetable"] = False
    payload["cycleDays"] = [{"id": "mon", "code": "MON", "weekday": 1, "sortOrder": 1}]
    payload["bellScheduleSlots"] = [
        {"id": "p2", "code": "P2", "startTime": "13:00", "endTime": "13:40", "slotNumber": 1, "sortOrder": 1},
    ]
    payload["bellScheduleSlotTags"] = [{"slotId": "p2", "tagCodes": ["AFTER_LUNCH", "AFTERNOON"]}]
    payload["subjectFocusCategories"] = [{"id": "focus-high", "code": "HIGH_FOCUS", "name": "High Focus"}]
    payload["subjectFocusAssignments"] = [{"id": "assign-math", "subjectId": "math", "focusCategoryId": "focus-high"}]
    payload["subjectFocusRules"] = [
        {
            "id": "rule-no-afternoon",
            "name": "No afternoon high focus",
            "focusCategoryId": "focus-high",
            "avoidedSlotTags": ["AFTER_LUNCH"],
            "severity": "HARD",
        }
    ]
    payload["curriculumRequirements"] = [
        {"id": "req-math-focus-hard", "subjectId": "math", "classId": "c1", "teacherId": "t1", "periodsPerCycle": 1, "blockLength": 1}
    ]
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "INFEASIBLE"
    assert any(item["code"] == "SUBJECT_FOCUS_HARD_VIOLATION" for item in body["diagnostics"])


async def test_hard_focus_preference_with_override_does_not_remove_subject(client, auth_headers):
    payload = school_payload()
    payload["cycleDays"] = [{"id": "mon", "code": "MON", "weekday": 1, "sortOrder": 1}]
    payload["bellScheduleSlots"] = [
        {"id": "p1", "code": "P1", "startTime": "08:00", "endTime": "08:40", "slotNumber": 1, "sortOrder": 1},
    ]
    payload["bellScheduleSlotTags"] = []
    payload["subjectFocusCategories"] = [{"id": "focus-high", "code": "HIGH_FOCUS", "name": "High Focus"}]
    payload["subjectFocusAssignments"] = [{"id": "assign-math", "subjectId": "math", "focusCategoryId": "focus-high"}]
    payload["subjectFocusRules"] = [
        {
            "id": "rule-morning",
            "name": "High focus in the morning",
            "focusCategoryId": "focus-high",
            "preferredSlotTags": ["MORNING_FOCUS"],
            "severity": "HARD",
            "allowOverride": True,
        }
    ]
    payload["curriculumRequirements"] = [
        {"id": "req-math-focus-hard", "subjectId": "math", "classId": "c1", "teacherId": "t1", "periodsPerCycle": 1, "blockLength": 1}
    ]
    payload["maxAlternatives"] = 1
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    assert body["alternatives"][0]["assignments"][0]["requirementId"] == "req-math-focus-hard"
    assert any(item["code"] == "SUBJECT_FOCUS_SOFT_WARNING" for item in body["alternatives"][0]["softViolations"])


async def test_stream_rule_blocks_parallel_same_subject_for_streams(client, auth_headers):
    payload = school_payload()
    payload["cycleDays"] = [{"id": "mon", "code": "MON", "weekday": 1, "sortOrder": 1}]
    payload["bellScheduleSlots"] = [
        {"id": "p1", "code": "P1", "startTime": "08:00", "endTime": "08:40", "slotNumber": 1, "sortOrder": 1},
    ]
    payload["curriculumRequirements"] = [
        {"id": "req-math-a", "subjectId": "math", "classId": "c1", "streamId": "A", "teacherId": "t1", "periodsPerCycle": 1, "blockLength": 1},
        {"id": "req-math-b", "subjectId": "math", "classId": "c1", "streamId": "B", "teacherId": "t2", "periodsPerCycle": 1, "blockLength": 1},
    ]
    payload["streamSchedulingRules"] = [
        {
            "id": "stream-no-parallel",
            "name": "No same subject in parallel",
            "policy": "DISALLOW_PARALLEL_SAME_SUBJECT",
            "severity": "HARD",
        }
    ]
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "INFEASIBLE"


async def test_weekly_activity_blocks_lessons(client, auth_headers):
    payload = school_payload()
    payload["weeklyActivities"] = [
        {"id": "assembly", "name": "Assembly", "cycleDayId": "mon", "startSlotId": "p1", "endSlotId": "p1", "scopeType": "WHOLE_SCHOOL", "blocksNormalLessons": True}
    ]
    response = await client.post("/solve/school-timetable", json=payload, headers=auth_headers)
    body = response.json()
    assignments = body["alternatives"][0]["assignments"]
    assert not any(item["cycleDayId"] == "mon" and item["slotStartId"] == "p1" for item in assignments)
