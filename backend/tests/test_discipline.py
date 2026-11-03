from __future__ import annotations

from datetime import date, timedelta


def _today(offset: int = 0) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


def test_add_and_delete_discipline(client, seeded):
    state = client.post(
        "/api/discipline",
        json={"studentId": "001", "date": "2026-10-01", "type": "晚自习违纪", "reason": "讲话"},
    ).json()
    record = state["discipline"]["001"][0]
    assert (record["type"], record["reason"]) == ("晚自习违纪", "讲话")
    state = client.delete("/api/discipline/001/%s" % record["id"]).json()
    assert state["discipline"] == {}


def test_reject_unknown_type(client, seeded):
    response = client.post(
        "/api/discipline", json={"studentId": "001", "date": "2026-10-01", "type": "随便写的"}
    )
    assert response.status_code == 400


def test_reject_unknown_student(client):
    response = client.post("/api/discipline", json={"studentId": "999", "date": "2026-10-01", "type": "迟到违纪"})
    assert response.status_code == 404


def test_missing_record_delete(client, seeded):
    assert client.delete("/api/discipline/001/none").status_code == 404


def test_import_keeps_same_day_repeats_by_default(client, seeded):
    records = [
        {"studentId": "001", "date": "2026-10-01", "type": "晚自习违纪", "reason": ""},
        {"studentId": "001", "date": "2026-10-01", "type": "晚自习违纪", "reason": ""},
        {"studentId": "002", "date": "2026-10-02", "type": "迟到违纪", "reason": "迟到 5 分钟"},
    ]
    state = client.post("/api/discipline/import", json={"records": records}).json()
    assert len(state["discipline"]["001"]) == 2, "同一天同类型多次是独立记录，不能被合并"
    assert len(state["discipline"]["002"]) == 1


def test_import_can_skip_existing_when_asked(client, seeded):
    records = [
        {"studentId": "001", "date": "2026-10-01", "type": "晚自习违纪", "reason": "第1次"},
        {"studentId": "001", "date": "2026-10-01", "type": "晚自习违纪", "reason": "第1次"},
    ]
    first = client.post("/api/discipline/import", json={"records": records}).json()
    assert len(first["discipline"]["001"]) == 2
    second = client.post(
        "/api/discipline/import", json={"records": records, "skipDuplicates": True}
    ).json()
    assert len(second["discipline"]["001"]) == 2, "显式要求时重复粘贴不重复写入"


def test_import_discipline_rejects_unknown_student(client, seeded):
    response = client.post(
        "/api/discipline/import",
        json={"records": [{"studentId": "999", "date": "2026-10-01", "type": "迟到违纪"}]},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "unknown_student"


def test_summary_counts_and_range(client, seeded):
    client.post("/api/discipline/import", json={"records": [
        {"studentId": "001", "date": _today(-1), "type": "晚自习违纪"},
        {"studentId": "001", "date": _today(-2), "type": "迟到违纪"},
        {"studentId": "002", "date": "2020-01-01", "type": "午休违纪"},
    ]})
    summary = client.get("/api/discipline/summary").json()
    assert summary["total"] == 3
    assert summary["students"] == 2
    assert summary["rows"][0]["studentId"] == "001"
    assert summary["rows"][0]["count"] == 2
    assert summary["rows"][0]["types"] == {"晚自习违纪": 1, "迟到违纪": 1}
    recent = client.get("/api/discipline/summary", params={"days": 7}).json()
    assert recent["total"] == 2
    assert recent["students"] == 1


def test_discipline_page_has_no_unlisted_students(client, seeded):
    client.post("/api/discipline", json={"studentId": "001", "date": "2026-10-01", "type": "迟到违纪"})
    summary = client.get("/api/discipline/summary").json()
    ids = [row["studentId"] for row in summary["rows"]]
    assert ids == ["001"]
