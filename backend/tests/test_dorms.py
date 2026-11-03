from __future__ import annotations


def test_import_dorms_assigns_rooms(client, seeded):
    response = client.post(
        "/api/dorms/import",
        json={
            "records": [
                {"room": "A301", "studentId": "001"},
                {"room": "A301", "studentId": "002"},
                {"room": "A302", "studentId": "003"},
            ]
        },
    )
    assert response.status_code == 200
    rooms = {student["id"]: student["dorm"] for student in response.json()["students"]}
    assert rooms == {"001": "A301", "002": "A301", "003": "A302"}


def test_import_dorms_rejects_unknown_student(client, seeded):
    response = client.post("/api/dorms/import", json={"records": [{"room": "A301", "studentId": "999"}]})
    assert response.status_code == 400
    assert response.json()["code"] == "unknown_student"


def test_import_dorms_rejects_blank_room(client, seeded):
    response = client.post("/api/dorms/import", json={"records": [{"room": "  ", "studentId": "001"}]})
    assert response.status_code == 400


def test_reimport_overrides_room(client, seeded):
    client.post("/api/dorms/import", json={"records": [{"room": "A301", "studentId": "001"}]})
    state = client.post("/api/dorms/import", json={"records": [{"room": "B205", "studentId": "001"}]}).json()
    assert state["students"][0]["dorm"] == "B205"


def test_student_create_and_update_dorm(client):
    created = client.post("/api/students", json={"id": "010", "name": "寝室生", "dorm": "C101"}).json()
    assert created["students"][0]["dorm"] == "C101"
    updated = client.patch("/api/students/010", json={"dorm": "C102"}).json()
    assert updated["students"][0]["dorm"] == "C102"


def test_backup_roundtrip_keeps_dorm(client, seeded):
    client.post("/api/dorms/import", json={"records": [{"room": "A301", "studentId": "001"}]})
    snapshot = client.get("/api/backup").json()
    client.delete("/api/students/001")
    restored = client.post("/api/backup", json={"state": snapshot}).json()
    assert restored["students"][0]["dorm"] == "A301"
