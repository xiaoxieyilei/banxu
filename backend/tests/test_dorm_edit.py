from __future__ import annotations


def _save(client, **payload):
    payload.setdefault("originalRoom", "")
    return client.post("/api/dorms/save", json=payload)


def _rooms(state):
    return {student["id"]: student["dorm"] for student in state["students"]}


def _dorm_records(state):
    return {
        student_id: [record for record in records if record["type"] == "寝室违纪"]
        for student_id, records in state["discipline"].items()
    }


def test_create_dorm_with_members_and_incidents(client, seeded):
    response = _save(
        client,
        room="A301",
        studentIds=["001", "002"],
        incidents=[{"date": "2026-10-13", "reason": "熄灯后讲话"}],
    )
    assert response.status_code == 200
    state = response.json()
    assert _rooms(state) == {"001": "A301", "002": "A301", "003": ""}
    records = _dorm_records(state)
    assert len(records["001"]) == 1
    assert len(records["002"]) == 1
    assert records["001"][0]["date"] == "2026-10-13"
    assert records["001"][0]["reason"] == "熄灯后讲话"


def test_rename_dorm_keeps_members_and_incidents(client, seeded):
    _save(client, room="A301", studentIds=["001", "002"], incidents=[{"date": "2026-10-13", "reason": ""}])
    response = _save(
        client,
        originalRoom="A301",
        room="B205",
        studentIds=["001", "002"],
        incidents=[{"date": "2026-10-13", "reason": ""}],
    )
    assert response.status_code == 200
    state = response.json()
    assert _rooms(state) == {"001": "B205", "002": "B205", "003": ""}
    records = _dorm_records(state)
    assert len(records["001"]) == 1
    assert len(records["002"]) == 1


def test_edit_members_moves_added_and_unassigns_removed(client, seeded):
    _save(client, room="A301", studentIds=["001", "002"])
    response = _save(client, originalRoom="A301", room="A301", studentIds=["001", "003"])
    assert response.status_code == 200
    assert _rooms(response.json()) == {"001": "A301", "002": "", "003": "A301"}


def test_edit_incidents_replaces_changed_event(client, seeded):
    _save(client, room="A301", studentIds=["001", "002"], incidents=[{"date": "2026-10-13", "reason": "旧备注"}])
    response = _save(
        client,
        originalRoom="A301",
        room="A301",
        studentIds=["001", "002"],
        incidents=[{"date": "2026-10-20", "reason": "新备注"}],
    )
    assert response.status_code == 200
    records = _dorm_records(response.json())
    assert len(records["001"]) == 1
    assert records["001"][0]["date"] == "2026-10-20"
    assert records["001"][0]["reason"] == "新备注"


def test_clear_incidents_keeps_other_discipline_types(client, seeded):
    client.post(
        "/api/discipline",
        json={"studentId": "001", "date": "2026-10-12", "type": "晚自习违纪", "reason": "讲话"},
    )
    _save(client, room="A301", studentIds=["001"], incidents=[{"date": "2026-10-13", "reason": ""}])
    response = _save(client, originalRoom="A301", room="A301", studentIds=["001"], incidents=[])
    assert response.status_code == 200
    records = response.json()["discipline"]["001"]
    assert [record["type"] for record in records] == ["晚自习违纪"]


def test_new_room_requires_at_least_one_member(client, seeded):
    response = _save(client, room="A301", studentIds=[])
    assert response.status_code == 400
    assert response.json()["code"] == "dorm_empty"


def test_blank_room_rejected(client, seeded):
    response = _save(client, room="   ", studentIds=["001"])
    assert response.status_code == 400


def test_duplicate_student_in_members_rejected(client, seeded):
    response = _save(client, room="A301", studentIds=["001", "001"])
    assert response.status_code == 400
    assert response.json()["code"] == "duplicate_student"


def test_unknown_student_rejected_without_changes(client, seeded):
    response = _save(client, room="A301", studentIds=["001", "999"])
    assert response.status_code == 400
    assert response.json()["code"] == "unknown_student"
    state = client.get("/api/state").json()
    assert _rooms(state) == {"001": "", "002": "", "003": ""}


def test_rename_to_existing_room_rejected(client, seeded):
    _save(client, room="A301", studentIds=["001"])
    _save(client, room="A302", studentIds=["002"])
    response = _save(client, originalRoom="A301", room="A302", studentIds=["001", "002"])
    assert response.status_code == 409
    assert response.json()["code"] == "dorm_exists"


def test_new_room_with_existing_number_rejected(client, seeded):
    _save(client, room="A301", studentIds=["001"])
    response = _save(client, room="A301", studentIds=["002"])
    assert response.status_code == 409


def test_edit_missing_room_rejected(client, seeded):
    response = _save(client, originalRoom="Z999", room="Z999", studentIds=["001"])
    assert response.status_code == 404
    assert response.json()["code"] == "dorm_not_found"


def test_invalid_incident_rolls_back_everything(client, seeded):
    response = _save(
        client,
        room="A301",
        studentIds=["001", "002"],
        incidents=[{"date": "2026-02-30", "reason": ""}],
    )
    assert response.status_code == 400
    state = client.get("/api/state").json()
    assert _rooms(state) == {"001": "", "002": "", "003": ""}
    assert _dorm_records(state) == {}


def test_duplicate_incident_rows_are_merged(client, seeded):
    response = _save(
        client,
        room="A301",
        studentIds=["001"],
        incidents=[
            {"date": "2026-10-13", "reason": "熄灯后讲话"},
            {"date": "2026-10-13", "reason": "熄灯后讲话"},
        ],
    )
    assert response.status_code == 200
    assert len(_dorm_records(response.json())["001"]) == 1


def test_added_member_does_not_inherit_past_incident(client, seeded):
    _save(client, room="A301", studentIds=["001"], incidents=[{"date": "2026-10-13", "reason": ""}])
    response = _save(
        client,
        originalRoom="A301",
        room="A301",
        studentIds=["001", "002"],
        incidents=[{"date": "2026-10-13", "reason": ""}],
    )
    assert response.status_code == 200
    records = _dorm_records(response.json())
    assert len(records["001"]) == 1
    assert len(records.get("002", [])) == 0


def test_adding_member_keeps_their_old_room_incident(client, seeded):
    _save(client, room="A301", studentIds=["001"], incidents=[{"date": "2026-10-13", "reason": "旧寝室事件"}])
    _save(client, room="B201", studentIds=["002"], incidents=[{"date": "2026-10-14", "reason": "新寝室事件"}])
    response = _save(
        client,
        originalRoom="B201",
        room="B201",
        studentIds=["001", "002"],
        incidents=[{"date": "2026-10-14", "reason": "新寝室事件"}],
    )
    assert response.status_code == 200
    state = response.json()
    assert _rooms(state) == {"001": "B201", "002": "B201", "003": ""}
    records = _dorm_records(state)
    assert [(record["date"], record["room"]) for record in records["001"]] == [("2026-10-13", "A301")]
    assert [(record["date"], record["room"]) for record in records["002"]] == [("2026-10-14", "B201")]


def test_renaming_room_moves_incident_ownership(client, seeded):
    _save(client, room="A301", studentIds=["001"], incidents=[{"date": "2026-10-13", "reason": ""}])
    response = _save(
        client,
        originalRoom="A301",
        room="B205",
        studentIds=["001"],
        incidents=[{"date": "2026-10-13", "reason": ""}],
    )
    assert response.status_code == 200
    record = _dorm_records(response.json())["001"][0]
    assert record["room"] == "B205"


def test_removing_member_keeps_room_event_and_their_record(client, seeded):
    _save(client, room="A301", studentIds=["001", "002"], incidents=[{"date": "2026-10-13", "reason": ""}])
    response = _save(
        client,
        originalRoom="A301",
        room="A301",
        studentIds=["001"],
        incidents=[{"date": "2026-10-13", "reason": ""}],
    )
    assert response.status_code == 200
    state = response.json()
    assert _rooms(state)["002"] == ""
    records = _dorm_records(state)
    assert len(records["001"]) == 1
    assert len(records["002"]) == 1
    assert records["002"][0]["room"] == "A301"


def test_delete_incident_does_not_touch_other_rooms_records(client, seeded):
    _save(client, room="A301", studentIds=["001"], incidents=[{"date": "2026-10-13", "reason": "旧事件"}])
    _save(client, room="B201", studentIds=["002"])
    _save(client, originalRoom="B201", room="B201", studentIds=["001", "002"], incidents=[])
    response = client.request(
        "DELETE",
        "/api/discipline/dorm",
        json={"room": "B201", "date": "2026-10-13", "reason": "旧事件"},
    )
    assert response.status_code == 200
    records = _dorm_records(response.json())
    assert len(records["001"]) == 1
    assert records["001"][0]["room"] == "A301"


def test_orphan_room_can_be_cleared(client, seeded):
    _save(client, room="A301", studentIds=["001"], incidents=[{"date": "2026-10-13", "reason": ""}])
    response = _save(client, originalRoom="A301", room="A301", studentIds=[], incidents=[])
    assert response.status_code == 200
    state = response.json()
    assert _rooms(state) == {"001": "", "002": "", "003": ""}
    assert _dorm_records(state) == {}


def test_orphan_room_keeps_records_until_cleared(client, seeded):
    _save(client, room="A301", studentIds=["001"], incidents=[{"date": "2026-10-13", "reason": ""}])
    response = _save(
        client,
        originalRoom="A301",
        room="A301",
        studentIds=[],
        incidents=[{"date": "2026-10-13", "reason": ""}],
    )
    assert response.status_code == 400
    assert response.json()["code"] == "dorm_empty"


def test_import_dorms_keeps_incident_with_old_room(client, seeded):
    _save(client, room="A301", studentIds=["001"], incidents=[{"date": "2026-10-13", "reason": ""}])
    response = client.post("/api/dorms/import", json={"records": [{"room": "B205", "studentId": "001"}]})
    assert response.status_code == 200
    state = response.json()
    assert _rooms(state)["001"] == "B205"
    record = _dorm_records(state)["001"][0]
    assert record["room"] == "A301"


def test_restore_backup_backfills_room_ownership(client, seeded):
    _save(client, room="A301", studentIds=["001"], incidents=[{"date": "2026-10-13", "reason": ""}])
    snapshot = client.get("/api/backup").json()
    for records in snapshot["discipline"].values():
        for record in records:
            record.pop("room", None)
    restored = client.post("/api/backup", json={"state": snapshot}).json()
    record = _dorm_records(restored)["001"][0]
    assert record["room"] == "A301"


def test_personal_dorm_discipline_gets_room_from_current_dorm(client, seeded):
    _save(client, room="A301", studentIds=["001"])
    response = client.post(
        "/api/discipline",
        json={"studentId": "001", "date": "2026-10-13", "type": "寝室违纪", "reason": "个人入口"},
    )
    assert response.status_code == 200
    record = _dorm_records(response.json())["001"][0]
    assert record["room"] == "A301"


def test_imported_dorm_discipline_gets_room_from_current_dorm(client, seeded):
    _save(client, room="A301", studentIds=["001"])
    response = client.post(
        "/api/discipline/import",
        json={"records": [{"studentId": "001", "date": "2026-10-13", "type": "寝室违纪", "reason": "导入"}]},
    )
    assert response.status_code == 200
    record = _dorm_records(response.json())["001"][0]
    assert record["room"] == "A301"


def test_restore_deleted_dorm_record_keeps_original_room(client, seeded):
    _save(client, room="A301", studentIds=["001"], incidents=[{"date": "2026-10-13", "reason": "熄灯"}])
    record = _dorm_records(client.get("/api/state").json())["001"][0]
    client.delete("/api/discipline/001/%s" % record["id"])
    _save(client, room="B201", studentIds=["001"])
    response = client.post(
        "/api/discipline",
        json={"studentId": "001", "date": "2026-10-13", "type": "寝室违纪", "reason": "熄灯", "room": "A301"},
    )
    assert response.status_code == 200
    restored = _dorm_records(response.json())["001"][0]
    assert restored["room"] == "A301"


def test_new_dorm_record_without_room_uses_current_dorm(client, seeded):
    _save(client, room="B201", studentIds=["001"])
    response = client.post(
        "/api/discipline",
        json={"studentId": "001", "date": "2026-10-13", "type": "寝室违纪", "reason": "新登记"},
    )
    assert response.status_code == 200
    record = _dorm_records(response.json())["001"][0]
    assert record["room"] == "B201"
