from __future__ import annotations

import pytest


def _exam_payload(**overrides):
    payload = {
        "name": "周练",
        "date": "2026-10-11",
        "subjects": ["语文", "总分"],
        "scores": {"001": {"语文": 90, "总分": 90}},
        "ranks": {"001": {"总分": {"school": 5, "class": 2}}},
    }
    payload.update(overrides)
    return payload


def test_create_exam_reads_scores_and_ranks(client):
    client.post("/api/students", json={"id": "001", "name": "张三"})
    response = client.post("/api/exams", json=_exam_payload())
    assert response.status_code == 201
    exam = response.json()["exams"][0]
    assert exam["scores"]["001"]["语文"] == 90
    assert exam["ranks"]["001"]["总分"] == {"school": 5, "class": 2}
    assert exam["subjects"] == ["语文", "总分"]


def test_exam_sorted_by_date_desc(client):
    client.post("/api/students", json={"id": "001", "name": "张三"})
    client.post("/api/exams", json=_exam_payload(name="早", date="2026-09-01"))
    client.post("/api/exams", json=_exam_payload(name="晚", date="2026-10-11"))
    exams = client.get("/api/state").json()["exams"]
    assert [exam["name"] for exam in exams] == ["晚", "早"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": ""},
        {"date": "2026-13-01"},
        {"date": "2026/10/11"},
        {"subjects": []},
        {"subjects": ["语文", "语文"]},
        {"scores": {"001": {"数学": 90}}},
        {"scores": {"001": {"语文": -1}}},
        {"scores": {"999": {"语文": 90}}},
        {"ranks": {"001": {"语文": {"school": 0}}}},
    ],
)
def test_exam_validation(client, overrides):
    client.post("/api/students", json={"id": "001", "name": "张三"})
    response = client.post("/api/exams", json=_exam_payload(**overrides))
    assert response.status_code == 400
    assert client.get("/api/state").json()["exams"] == []


def test_update_exam_name_and_date(client, seeded):
    exam_id = client.get("/api/state").json()["exams"][0]["id"]
    response = client.patch("/api/exams/%s" % exam_id, json={"name": "期中考试", "date": "2026-11-01"})
    exam = response.json()["exams"][0]
    assert (exam["name"], exam["date"]) == ("期中考试", "2026-11-01")


def test_update_exam_rejects_bad_date(client, seeded):
    exam_id = client.get("/api/state").json()["exams"][0]["id"]
    assert client.patch("/api/exams/%s" % exam_id, json={"date": "2026-02-31x"}).status_code == 400


def test_delete_exam_clears_selection(client, seeded):
    exam_id = client.get("/api/state").json()["exams"][0]["id"]
    client.patch("/api/settings", json={"examId": exam_id, "showScores": True})
    state = client.delete("/api/exams/%s" % exam_id).json()
    assert state["exams"] == []
    assert state["settings"]["examId"] == ""
    assert state["settings"]["showScores"] is False


def test_delete_missing_exam(client):
    assert client.delete("/api/exams/none").status_code == 404


def test_exam_rejects_impossible_date(client):
    client.post("/api/students", json={"id": "001", "name": "张三"})
    response = client.post("/api/exams", json=_exam_payload(date="2026-02-30"))
    assert response.status_code == 400


def test_blank_exam_name_rejected(client):
    client.post("/api/students", json={"id": "001", "name": "张三"})
    response = client.post("/api/exams", json=_exam_payload(name="   "))
    assert response.status_code == 400
    assert client.get("/api/state").json()["exams"] == []


def test_exam_source_format_length_limited(client):
    client.post("/api/students", json={"id": "001", "name": "张三"})
    response = client.post("/api/exams", json=_exam_payload(sourceFormat="x" * 41))
    assert response.status_code in (400, 422)


def _seed_three(client):
    for sid, name in (("001", "张三"), ("002", "李四"), ("003", "王五")):
        client.post("/api/students", json={"id": sid, "name": name})


def test_exam_without_ranks_derives_class_ranks(client):
    _seed_three(client)
    response = client.post(
        "/api/exams",
        json={
            "name": "数学限时训练",
            "date": "2026-11-02",
            "subjects": ["数学"],
            "scores": {"001": {"数学": 90}, "002": {"数学": 90}, "003": {"数学": 80}},
            "ranks": {},
        },
    )
    assert response.status_code == 201
    ranks = response.json()["exams"][0]["ranks"]
    assert ranks["001"]["数学"] == {"school": None, "class": 1}
    assert ranks["002"]["数学"] == {"school": None, "class": 1}
    assert ranks["003"]["数学"] == {"school": None, "class": 3}


def test_exam_keeps_imported_ranks_and_fills_missing_class(client):
    _seed_three(client)
    response = client.post(
        "/api/exams",
        json={
            "name": "学校周练",
            "date": "2026-11-02",
            "subjects": ["数学"],
            "scores": {"001": {"数学": 90}, "002": {"数学": 80}},
            "ranks": {"001": {"数学": {"school": 5}}},
        },
    )
    assert response.status_code == 201
    ranks = response.json()["exams"][0]["ranks"]
    assert ranks["001"]["数学"] == {"school": 5, "class": 1}
    assert ranks["002"]["数学"] == {"school": None, "class": 2}


def test_fill_missing_class_ranks_repairs_existing_exam(client):
    from app import db, repository

    _seed_three(client)
    conn = client.app.state.connect()
    try:
        with db.write_tx(conn):
            repository.create_exam(
                conn,
                "旧 PDF 导入",
                "2026-11-02",
                ["数学"],
                {"001": {"数学": 70}, "002": {"数学": 95}, "003": {"数学": 70}},
                {},
                "PDF 导入",
            )
        assert client.get("/api/state").json()["exams"][0]["ranks"] == {}
        conn = client.app.state.connect()
        with db.write_tx(conn):
            filled = repository.fill_missing_class_ranks(conn)
        assert filled == 3
    finally:
        conn.close()
    ranks = client.get("/api/state").json()["exams"][0]["ranks"]
    assert ranks["002"]["数学"]["class"] == 1
    assert ranks["001"]["数学"]["class"] == 2
    assert ranks["003"]["数学"]["class"] == 2


def test_replace_exam_keeps_id_and_replaces_scores(client, seeded):
    exam_id = client.get("/api/state").json()["exams"][0]["id"]
    client.patch("/api/settings", json={"examId": exam_id, "showScores": True, "subject": "总分"})
    response = client.put(
        "/api/exams/%s" % exam_id,
        json={
            "name": "重新导入的周练",
            "date": "2026-10-12",
            "subjects": ["数学"],
            "scores": {"001": {"数学": 88}, "002": {"数学": 90}},
            "ranks": {},
            "sourceFormat": "PDF 导入",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["exams"]) == 1
    exam = body["exams"][0]
    assert exam["id"] == exam_id
    assert exam["name"] == "重新导入的周练"
    assert exam["subjects"] == ["数学"]
    assert exam["scores"] == {"001": {"数学": 88}, "002": {"数学": 90}}
    assert exam["ranks"]["001"]["数学"]["class"] == 2
    assert exam["ranks"]["002"]["数学"]["class"] == 1
    assert body["settings"]["examId"] == exam_id
    assert body["settings"]["showScores"] is True


def test_replace_missing_exam_returns_404(client):
    response = client.put(
        "/api/exams/nope",
        json={"name": "x", "date": "2026-10-11", "subjects": ["数学"], "scores": {}, "ranks": {}},
    )
    assert response.status_code == 404


def test_exam_full_marks_roundtrip_and_validation(client, seeded):
    response = client.post(
        "/api/exams",
        json={
            "name": "带满分",
            "date": "2026-11-06",
            "subjects": ["数学", "总分"],
            "scores": {"001": {"数学": 108, "总分": 108}},
            "ranks": {},
            "fullMarks": {"数学": 120, "总分": 120},
        },
    )
    assert response.status_code == 201
    exam = response.json()["exams"][0]
    assert exam["fullMarks"] == {"数学": 120, "总分": 120}

    exam_id = exam["id"]
    updated = client.patch("/api/exams/%s" % exam_id, json={"fullMarks": {"数学": 150}}).json()["exams"][0]
    assert updated["fullMarks"] == {"数学": 150, "总分": 120}

    snapshot = client.get("/api/backup").json()
    client.put(
        "/api/exams/%s" % exam_id,
        json={"name": "替换后", "date": "2026-11-06", "subjects": ["数学"], "scores": {}, "ranks": {}},
    )
    restored = client.post("/api/backup", json={"state": snapshot}).json()
    restored_exam = next(item for item in restored["exams"] if item["id"] == exam_id)
    assert restored_exam["fullMarks"] == {"数学": 150, "总分": 120}

    bad_subject = client.post(
        "/api/exams",
        json={
            "name": "坏满分",
            "date": "2026-11-07",
            "subjects": ["数学"],
            "scores": {},
            "ranks": {},
            "fullMarks": {"英语": 120},
        },
    )
    assert bad_subject.status_code == 400
    negative = client.patch("/api/exams/%s" % exam_id, json={"fullMarks": {"数学": -1}})
    assert negative.status_code == 400
