from __future__ import annotations


def test_update_settings_roundtrip(client, seeded):
    exam_id = client.get("/api/state").json()["exams"][0]["id"]
    state = client.patch(
        "/api/settings",
        json={
            "className": "高一(20)班",
            "rows": 6,
            "extraRow": 3,
            "showScores": True,
            "subject": "数学",
            "examId": exam_id,
            "seatRange": "recent3",
        },
    ).json()
    settings = state["settings"]
    assert settings["className"] == "高一(20)班"
    assert settings["rows"] == 6
    assert settings["extraRow"] == 3
    assert settings["showScores"] is True
    assert settings["subject"] == "数学"
    assert settings["seatRange"] == "recent3"


def test_show_scores_can_enable_without_exam(client):
    # 平均模式不需要选中单场考试，也应允许打开座位表成绩显示
    state = client.patch("/api/settings", json={"showScores": True, "seatRange": "all"}).json()
    assert state["settings"]["showScores"] is True
    assert state["settings"]["seatRange"] == "all"


def test_settings_reject_bad_names_and_ranges(client):
    assert client.patch("/api/settings", json={"className": "  "}).status_code == 400
    invalid_range = client.patch("/api/settings", json={"callRange": "weird"})
    assert invalid_range.status_code == 422
    assert invalid_range.json()["code"] == "validation_error"
    invalid_seat_range = client.patch("/api/settings", json={"seatRange": "weird"})
    assert invalid_seat_range.status_code == 422
    assert invalid_seat_range.json()["code"] == "validation_error"
    assert client.patch("/api/settings", json={"examId": "missing"}).status_code == 404


def test_settings_extra_row_clamped_by_rows(client):
    client.patch("/api/settings", json={"rows": 6, "extraRow": 5})
    assert client.patch("/api/settings", json={"extraRow": 6}).status_code == 400
    state = client.patch("/api/settings", json={"rows": 7, "extraRow": 6}).json()
    assert state["settings"]["extraRow"] == 6


def test_backup_restore_roundtrip(client, seeded):
    client.post("/api/seats/move", json={"studentId": "001", "target": "R1C1"})
    client.post("/api/discipline", json={"studentId": "001", "date": "2026-10-01", "type": "迟到违纪"})
    exam_id = client.get("/api/state").json()["exams"][0]["id"]
    client.patch(
        "/api/settings",
        json={"className": "备份班", "showScores": True, "subject": "语文", "examId": exam_id},
    )
    snapshot = client.get("/api/backup").json()

    client.delete("/api/students/001")
    client.patch("/api/settings", json={"className": "改坏了"})

    restored = client.post("/api/backup", json={"state": snapshot}).json()
    assert restored["settings"]["className"] == "备份班"
    assert restored["settings"]["showScores"] is True
    assert restored["seats"] == {"R1C1": "001"}
    assert len(restored["discipline"]["001"]) == 1
    assert restored["exams"][0]["scores"]["001"]["语文"] == 90
    assert len(restored["students"]) == 3


def test_restore_rejects_duplicate_seat_students(client, seeded):
    snapshot = client.get("/api/backup").json()
    snapshot["seats"] = {"R1C1": "001", "R1C2": "001"}
    response = client.post("/api/backup", json={"state": snapshot})
    assert response.status_code == 400
    assert client.get("/api/state").json()["students"] != []


def test_restore_keeps_exam_id_consistent(client, seeded):
    exam_id = client.get("/api/state").json()["exams"][0]["id"]
    client.patch("/api/settings", json={"examId": exam_id, "showScores": True})
    snapshot = client.get("/api/backup").json()
    client.delete("/api/exams/%s" % exam_id)
    restored = client.post("/api/backup", json={"state": snapshot}).json()
    ids = [exam["id"] for exam in restored["exams"]]
    assert restored["settings"]["examId"] == exam_id
    assert exam_id in ids
    assert restored["settings"]["showScores"] is True


def test_restore_rejects_unknown_exam_reference(client, seeded):
    before = client.get("/api/state").json()
    snapshot = client.get("/api/backup").json()
    snapshot["settings"]["examId"] = "ghost"
    response = client.post("/api/backup", json={"state": snapshot})
    assert response.status_code == 400
    assert response.json()["code"] == "unknown_exam"
    assert client.get("/api/state").json() == before


def test_restore_rejects_invalid_settings(client, seeded):
    before = client.get("/api/state").json()
    for patch in (
        {"className": " "},
        {"callRange": "weekly"},
        {"subject": "X" * 21},
    ):
        snapshot = client.get("/api/backup").json()
        snapshot["settings"].update(patch)
        assert client.post("/api/backup", json={"state": snapshot}).status_code in (400, 422)
        assert client.get("/api/state").json() == before


def test_settings_reject_blank_subject(client):
    assert client.patch("/api/settings", json={"subject": "  "}).status_code == 400


def test_restore_preserves_class_rank(client, seeded):
    snapshot = client.get("/api/backup").json()
    assert snapshot["exams"][0]["ranks"]["001"]["总分"]["class"] == 1
    client.delete("/api/students/001")
    restored = client.post("/api/backup", json={"state": snapshot}).json()
    assert restored["exams"][0]["ranks"]["001"]["总分"] == {"school": 3, "class": 1}


def test_lan_host_header_allowed(client):
    # 手机通过局域网/Tailscale IP 访问时 Host 不是 localhost，应放行（由口令保护）
    response = client.get("/api/health", headers={"host": "10.2.203.155:8000"})
    assert response.status_code == 200


def test_restore_rejects_discipline_for_unknown_student(client, seeded):
    snapshot = client.get("/api/backup").json()
    snapshot["discipline"] = {"999": [{"id": "x", "date": "2026-10-01", "type": "迟到违纪", "reason": ""}]}
    assert client.post("/api/backup", json={"state": snapshot}).status_code == 400


def test_failed_restore_keeps_settings_patchable(client, seeded):
    snapshot = client.get("/api/backup").json()
    snapshot["settings"]["callRange"] = "weekly"
    assert client.post("/api/backup", json={"state": snapshot}).status_code in (400, 422)
    assert client.patch("/api/settings", json={"showScores": False}).status_code == 200


def test_state_reads_use_a_snapshot_transaction(client, seeded, monkeypatch):
    from app import repository as repository_module

    seen = {}
    original = repository_module.load_state

    def wrapped(conn):
        seen["in_tx"] = conn.in_transaction
        return original(conn)

    monkeypatch.setattr(repository_module, "load_state", wrapped)
    assert client.get("/api/state").status_code == 200
    assert seen["in_tx"] is True


def test_restore_normalises_and_rejects_blank_name(client, seeded):
    snapshot = client.get("/api/backup").json()
    snapshot["students"].append({"id": " 7 ", "name": "   ", "gender": "", "note": ""})
    response = client.post("/api/backup", json={"state": snapshot})
    assert response.status_code == 400


def test_restore_normalises_ids_before_duplicate_check(client, seeded):
    snapshot = client.get("/api/backup").json()
    snapshot["students"].append({"id": " 001 ", "name": "重复学号", "gender": "", "note": ""})
    response = client.post("/api/backup", json={"state": snapshot})
    assert response.status_code == 400
    assert "重复学号" in response.json()["detail"]


def test_restore_accepts_normalised_values(client, seeded):
    snapshot = client.get("/api/backup").json()
    snapshot["students"].append({"id": " 8 ", "name": " 正常 ", "gender": "", "note": ""})
    snapshot["seats"]["R1C1"] = " 8 "
    snapshot["discipline"][" 8 "] = [{"id": "x", "date": "2026-10-01", "type": "迟到违纪", "reason": ""}]
    restored = client.post("/api/backup", json={"state": snapshot})
    assert restored.status_code == 200
    body = restored.json()
    ids = {student["id"] for student in body["students"]}
    assert "8" in ids
    assert body["seats"]["R1C1"] == "8"
    assert list(body["discipline"].keys()).count("8") == 1


def test_restore_rejects_conflicting_discipline_keys(client, seeded):
    snapshot = client.get("/api/backup").json()
    snapshot["students"].append({"id": "8", "name": "小王", "gender": "", "note": ""})
    record = [{"id": "x", "date": "2026-10-01", "type": "迟到违纪", "reason": ""}]
    snapshot["discipline"]["8"] = record
    snapshot["discipline"][" 8 "] = record
    response = client.post("/api/backup", json={"state": snapshot})
    assert response.status_code == 400
    assert "重复" in response.json()["detail"]


def test_restore_old_backup_defaults_seat_range(client, seeded):
    snapshot = client.get("/api/backup").json()
    snapshot["settings"].pop("seatRange", None)
    restored = client.post("/api/backup", json={"state": snapshot}).json()
    assert restored["settings"]["seatRange"] == "all"
