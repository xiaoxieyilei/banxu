from __future__ import annotations

from app import db


def test_biology_subject_is_migrated_to_biology(tmp_path):
    path = tmp_path / "banxu.sqlite3"
    conn = db.connect(path)
    db.initialize(conn)
    conn.execute("INSERT INTO students (id, name, gender, note, dorm, sort_order) VALUES ('001', '张三', '', '', '', 1)")
    conn.execute("INSERT INTO exams (id, name, date, source_format, imported_at) VALUES ('e1', '生物周练', '2026-10-12', '', '2026-10-12')")
    conn.execute("INSERT INTO exam_subjects (exam_id, subject, ordinal, full_marks) VALUES ('e1', '生物学', 0, 100)")
    conn.execute("INSERT INTO scores (exam_id, student_id, subject, score, school_rank, class_rank) VALUES ('e1', '001', '生物学', 88, 3, 1)")
    conn.execute("UPDATE settings SET subject = '生物学', call_subject = '生物学' WHERE id = 1")
    db.initialize(conn)
    assert [row["subject"] for row in conn.execute("SELECT subject FROM exam_subjects WHERE exam_id = 'e1'")] == ["生物"]
    row = conn.execute("SELECT subject, score, school_rank, class_rank FROM scores WHERE exam_id = 'e1'").fetchone()
    assert (row["subject"], row["score"], row["school_rank"], row["class_rank"]) == ("生物", 88, 3, 1)
    assert conn.execute("SELECT full_marks FROM exam_subjects WHERE exam_id = 'e1' AND subject = '生物'").fetchone()[0] == 100
    settings = conn.execute("SELECT subject, call_subject FROM settings WHERE id = 1").fetchone()
    assert (settings["subject"], settings["call_subject"]) == ("生物", "生物")
    conn.close()
