async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "timetable-solver",
        "solver": "ortools-cp-sat",
    }


async def test_invalid_token_rejected(client):
    response = await client.post("/solve/school-timetable", json={}, headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401
