from conftest import exam_payload


async def test_exam_solver_class_specific(client, auth_headers):
    response = await client.post("/solve/exam-timetable", json=exam_payload("CLASS", ["c1"]), headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    paper_ids = {item["paperId"] for item in body["alternatives"][0]["paperAssignments"]}
    assert paper_ids == {"p-math", "p-eng"}


async def test_computer_lab_functional_machine_limit(client, auth_headers):
    payload = exam_payload("CLASS", ["c1"])
    payload["papers"] = [
        {"id": "p-ict", "name": "ICT", "subjectId": "ict", "classId": "c1", "candidateIds": [f"s{i}" for i in range(25)], "durationMinutes": 60, "requiresComputer": True}
    ]
    response = await client.post("/solve/exam-timetable", json=payload, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["status"] == "INFEASIBLE"
