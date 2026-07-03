from conftest import exam_payload


async def test_exam_solver_whole_school(client, auth_headers):
    response = await client.post("/solve/exam-timetable", json=exam_payload(), headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    assignments = body["alternatives"][0]["paperAssignments"]
    assert {item["paperId"] for item in assignments} == {"p-math", "p-eng", "p-sci"}


async def test_candidate_clash_prevention(client, auth_headers):
    payload = exam_payload()
    response = await client.post("/solve/exam-timetable", json=payload, headers=auth_headers)
    assignments = response.json()["alternatives"][0]["paperAssignments"]
    by_window = {}
    for item in assignments:
        for candidate_id in item["candidateIds"]:
            key = (candidate_id, item["windowId"])
            assert key not in by_window
            by_window[key] = item["paperId"]
