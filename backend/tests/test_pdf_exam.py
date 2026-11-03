from __future__ import annotations

import base64

import fitz

from app import pdf_exam


def _pdf_bytes(
    rows=(
        ("戴怀煊", "10456", 98.0),
        ("苏熙哲", "10460", 81.0),
    ),
    full_marks: float = 120.0,
    title: str = "瑞安中学2026级高一数学限时训练（8）",
) -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((40, 50), title, fontsize=12, fontname="china-s")
    page.insert_text((40, 66), "高一年级20班学生成绩单（满分%.1f分）" % full_marks, fontsize=10, fontname="china-s")
    y = 100.0
    for name, student_no, total in rows:
        page.insert_text((40, y), name, fontsize=10, fontname="china-s")
        page.insert_text((110, y), "总分", fontsize=10, fontname="china-s")
        page.insert_text((180, y), "1", fontsize=10, fontname="china-s")
        y += 16
        page.insert_text((40, y), student_no, fontsize=10)
        page.insert_text((110, y), "%.1f" % total, fontsize=10)
        page.insert_text((180, y), "5.0", fontsize=10)
        y += 20
    data = doc.tobytes()
    doc.close()
    return data


def test_parse_pdf_endpoint_extracts_total_scores(client):
    payload = {
        "fileName": "瑞安中学2026级高一数学限时训练（8）-20班-学生成绩单.pdf",
        "data": base64.b64encode(_pdf_bytes()).decode("ascii"),
    }
    response = client.post("/api/exams/pdf-parse", json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["examName"] == "瑞安中学2026级高一数学限时训练（8）"
    assert body["subject"] == "数学"
    assert body["fullMarks"] == 120.0
    assert body["pageCount"] == 1
    assert body["rows"] == [
        {"name": "戴怀煊", "examNo": "10456", "total": 98.0},
        {"name": "苏熙哲", "examNo": "10460", "total": 81.0},
    ]
    assert body["warnings"] == []


def test_parse_pdf_rejects_invalid_payload(client):
    response = client.post("/api/exams/pdf-parse", json={"fileName": "x.pdf", "data": "not-base64!!"})
    assert response.status_code == 400
    assert response.json()["code"] == "pdf_invalid"

    response = client.post(
        "/api/exams/pdf-parse",
        json={"fileName": "x.pdf", "data": base64.b64encode(b"hello world").decode("ascii")},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "pdf_invalid"


def test_parse_pdf_without_score_rows_returns_clear_error(client):
    response = client.post(
        "/api/exams/pdf-parse",
        json={"fileName": "empty.pdf", "data": base64.b64encode(_pdf_bytes(rows=())).decode("ascii")},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "pdf_no_records"


def test_parser_detects_unknown_subject_warning():
    result = pdf_exam.parse_score_pdf(
        _pdf_bytes(title="高一年级20班学生成绩单", full_marks=100),
        "某次周练.pdf",
    )
    assert result["subject"] == ""
    assert result["warnings"]
    assert len(result["rows"]) == 2
