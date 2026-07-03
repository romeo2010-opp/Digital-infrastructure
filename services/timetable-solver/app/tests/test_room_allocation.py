from conftest import exam_payload


async def test_room_allocation(client, auth_headers):
    payload = exam_payload()
    allocation_payload = {
        "schoolId": "1",
        "paperAssignments": [
            {"paperId": "p-math", "windowId": "w1", "date": "2026-06-30", "startTime": "08:00", "endTime": "10:00", "candidateIds": ["s1", "s2"]}
        ],
        "papers": payload["papers"],
        "facilities": payload["facilities"],
    }
    response = await client.post("/solve/exam-room-allocation", json=allocation_payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    assert body["allocations"]
