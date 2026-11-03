from __future__ import annotations


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert {"seatRange", "pdfExamImport", "autoClassRanks", "examFullMarks"} <= set(body["features"])


def test_initial_state(client):
    state = client.get("/api/state").json()
    assert state["students"] == []
    assert state["exams"] == []
    assert state["seats"] == {}
    assert state["discipline"] == {}
    assert state["settings"]["rows"] == 7
    assert state["settings"]["extraRow"] == 5
    assert state["settings"]["showScores"] is False


def test_roster_import_merges_and_keeps_unlisted(client):
    client.post("/api/roster/import", json={"records": [{"id": "001", "name": "张三"}, {"id": "002", "name": "李四"}]})
    client.post("/api/roster/import", json={"records": [{"id": "001", "name": "张三丰"}, {"id": "003", "name": "王五"}]})
    state = client.get("/api/state").json()
    names = {student["id"]: student["name"] for student in state["students"]}
    assert names == {"001": "张三丰", "002": "李四", "003": "王五"}


def test_roster_import_rejects_blank_name(client):
    response = client.post("/api/roster/import", json={"records": [{"id": "001", "name": "  "}]})
    assert response.status_code == 400
    assert client.get("/api/state").json()["students"] == []


def test_create_student_conflict(client):
    client.post("/api/students", json={"id": "001", "name": "张三"})
    response = client.post("/api/students", json={"id": "001", "name": "重复"})
    assert response.status_code == 409
    assert response.json()["code"] == "student_exists"


def test_update_and_delete_student(client, seeded):
    updated = client.patch("/api/students/001", json={"note": "班长"}).json()
    assert updated["students"][0]["note"] == "班长"
    client.post("/api/seats/move", json={"studentId": "001", "target": "R1C1"})
    client.post("/api/discipline", json={"studentId": "001", "date": "2026-10-01", "type": "迟到违纪"})
    deleted = client.delete("/api/students/001")
    assert deleted.status_code == 200
    state = deleted.json()
    assert "001" not in {student["id"] for student in state["students"]}
    assert "001" not in state["seats"].values()
    assert "001" not in state["discipline"]
    assert all("001" not in exam["scores"] for exam in state["exams"])


def test_update_missing_student(client):
    response = client.patch("/api/students/none", json={"name": "x"})
    assert response.status_code == 404


def test_roster_import_rejects_duplicate_ids_in_one_request(client):
    response = client.post(
        "/api/roster/import",
        json={"records": [{"id": "001", "name": "张三"}, {"id": "001", "name": "张三丰"}]},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "duplicate_student"
    assert client.get("/api/state").json()["students"] == []
