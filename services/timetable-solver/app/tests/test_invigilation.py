async def test_invigilation(client, auth_headers):
    payload = {
        "schoolId": "1",
        "roomAllocations": [
            {"allocationId": "a1", "paperId": "p1", "windowId": "w1", "facilityId": "hall", "candidateCount": 30, "subjectId": "math"},
            {"allocationId": "a2", "paperId": "p2", "windowId": "w2", "facilityId": "hall", "candidateCount": 30, "subjectId": "eng"},
        ],
        "invigilators": [
            {"id": "t1", "name": "One", "subjectIds": ["math"]},
            {"id": "t2", "name": "Two", "subjectIds": []},
            {"id": "t3", "name": "Three", "subjectIds": []},
        ],
        "minimumInvigilatorsPerRoom": 1,
    }
    response = await client.post("/solve/invigilation", json=payload, headers=auth_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] in {"OPTIMAL", "FEASIBLE"}
    assert len(body["assignments"]) >= 2
