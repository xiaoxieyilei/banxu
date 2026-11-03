from __future__ import annotations


def _seed_rooms(client):
    client.post(
        "/api/dorms/import",
        json={
            "records": [
                {"room": "A301", "studentId": "001"},
                {"room": "A301", "studentId": "002"},
                {"room": "A302", "studentId": "003"},
            ]
        },
    )


def test_add_dorm_discipline_marks_every_member_once(client, seeded):
    _seed_rooms(client)
    state = client.post(
        "/api/discipline/dorm", json={"room": "A301", "date": "2026-10-13", "reason": "熄灯后讲话"}
    ).json()
    assert len(state["discipline"]["001"]) == 1
    assert len(state["discipline"]["002"]) == 1
    assert state["discipline"]["001"][0]["type"] == "寝室违纪"
    assert state["discipline"]["001"][0]["reason"] == "熄灯后讲话"
    assert state["discipline"].get("003") is None


def test_delete_dorm_discipline_removes_whole_event(client, seeded):
    _seed_rooms(client)
    client.post("/api/discipline/dorm", json={"room": "A301", "date": "2026-10-13", "reason": "讲话"})
    state = client.request(
        "DELETE", "/api/discipline/dorm", json={"room": "A301", "date": "2026-10-13", "reason": "讲话"}
    ).json()
    assert state["discipline"].get("001") is None
    assert state["discipline"].get("002") is None


def test_delete_dorm_discipline_only_matching_event(client, seeded):
    _seed_rooms(client)
    client.post("/api/discipline/dorm", json={"room": "A301", "date": "2026-10-13", "reason": "讲话"})
    client.post("/api/discipline/dorm", json={"room": "A301", "date": "2026-10-14", "reason": "讲话"})
    state = client.request(
        "DELETE", "/api/discipline/dorm", json={"room": "A301", "date": "2026-10-13", "reason": "讲话"}
    ).json()
    assert len(state["discipline"]["001"]) == 1
    assert state["discipline"]["001"][0]["date"] == "2026-10-14"


def test_add_dorm_discipline_requires_members(client, seeded):
    response = client.post("/api/discipline/dorm", json={"room": "X999", "date": "2026-10-13"})
    assert response.status_code == 404
    assert response.json()["code"] == "dorm_empty"


def test_dorm_discipline_validates_date(client, seeded):
    _seed_rooms(client)
    assert client.post("/api/discipline/dorm", json={"room": "A301", "date": "2026-02-30"}).status_code == 400
