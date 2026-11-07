"""数据访问层：所有 SQL 集中在这里，写操作由调用方包在 write_tx 中。"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import date as date_type, datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional, Tuple

from . import domain
from .domain import DomainError

DEFAULT_SUBJECT = "总分"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def load_settings(conn: sqlite3.Connection) -> dict:
    return _settings_dict(conn)


def _settings_dict(conn: sqlite3.Connection) -> dict:
    row = conn.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    if row is None:
        raise DomainError("班级设置缺失，数据库可能未初始化", status=500, code="db_uninitialized")
    return {
        "class_name": row["class_name"],
        "rows": row["rows"],
        "extra_row": row["extra_row"],
        "show_scores": bool(row["show_scores"]),
        "exam_id": row["exam_id"],
        "subject": row["subject"],
        "call_range": row["call_range"],
        "call_subject": row["call_subject"],
        "seat_range": row["seat_range"],
    }


def load_students(conn: sqlite3.Connection) -> List[dict]:
    rows = conn.execute("SELECT id, name, gender, note, dorm FROM students ORDER BY sort_order, id").fetchall()
    return [
        {"id": r["id"], "name": r["name"], "gender": r["gender"], "note": r["note"], "dorm": r["dorm"]}
        for r in rows
    ]


def load_exams(conn: sqlite3.Connection) -> List[dict]:
    exams = conn.execute("SELECT * FROM exams ORDER BY date DESC, imported_at DESC, id DESC").fetchall()
    result: List[dict] = []
    for exam in exams:
        subject_rows = conn.execute(
            "SELECT subject, full_marks FROM exam_subjects WHERE exam_id = ? ORDER BY ordinal", (exam["id"],)
        ).fetchall()
        subjects = [r["subject"] for r in subject_rows]
        full_marks = {r["subject"]: r["full_marks"] for r in subject_rows if r["full_marks"] is not None}
        scores: Dict[str, Dict[str, Optional[float]]] = {}
        ranks: Dict[str, Dict[str, dict]] = {}
        for row in conn.execute(
            "SELECT student_id, subject, score, school_rank, class_rank FROM scores WHERE exam_id = ?",
            (exam["id"],),
        ).fetchall():
            sid = row["student_id"]
            scores.setdefault(sid, {})[row["subject"]] = row["score"]
            if row["school_rank"] is not None or row["class_rank"] is not None:
                ranks.setdefault(sid, {})[row["subject"]] = {
                    "school": row["school_rank"],
                    "class": row["class_rank"],
                }
        result.append(
            {
                "id": exam["id"],
                "name": exam["name"],
                "date": exam["date"],
                "subjects": subjects,
                "source_format": exam["source_format"],
                "scores": scores,
                "ranks": ranks,
                "full_marks": full_marks,
            }
        )
    return result


def load_seats(conn: sqlite3.Connection) -> Dict[str, str]:
    return {r["seat_id"]: r["student_id"] for r in conn.execute("SELECT seat_id, student_id FROM seats").fetchall()}


def load_discipline(conn: sqlite3.Connection) -> Dict[str, List[dict]]:
    rows = conn.execute(
        "SELECT id, student_id, date, type, reason, room FROM discipline ORDER BY date ASC, created_at ASC, id ASC"
    ).fetchall()
    grouped: Dict[str, List[dict]] = {}
    for row in rows:
        grouped.setdefault(row["student_id"], []).append(
            {
                "id": row["id"],
                "date": row["date"],
                "type": row["type"],
                "reason": row["reason"],
                "room": row["room"],
            }
        )
    return grouped


def load_state(conn: sqlite3.Connection) -> dict:
    return {
        "settings": _settings_dict(conn),
        "students": load_students(conn),
        "exams": load_exams(conn),
        "seats": load_seats(conn),
        "discipline": load_discipline(conn),
    }


def _student_ids(conn: sqlite3.Connection) -> set:
    return {row["id"] for row in conn.execute("SELECT id FROM students").fetchall()}


MAX_ROSTER_ROWS = 2000
MAX_EXAM_STUDENTS = 500
MAX_DISCIPLINE_ROWS = 2000


def import_roster(conn: sqlite3.Connection, records: Iterable[dict]) -> Tuple[int, int]:
    """按学号合并：已存在则更新，新学号追加；未包含的学生保留。"""
    records = list(records)
    if len(records) > MAX_ROSTER_ROWS:
        raise DomainError("一次最多导入 %d 名学生" % MAX_ROSTER_ROWS)
    existing = _student_ids(conn)
    seen_ids = set()
    duplicates = set()
    for record in records:
        sid = str(record["id"]).strip()
        if sid in seen_ids:
            duplicates.add(sid)
        else:
            seen_ids.add(sid)
    if duplicates:
        raise DomainError("名单中存在重复学号：" + "、".join(sorted(duplicates)[:10]), code="duplicate_student")
    max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) FROM students").fetchone()[0]
    added = updated = 0
    for record in records:
        sid = str(record["id"]).strip()
        name = str(record["name"]).strip()
        gender = str(record.get("gender") or "").strip()
        note = str(record.get("note") or "").strip()
        domain.validate_student(sid, name, gender, note)
        dorm = str(record.get("dorm") or "").strip()
        if sid in existing:
            if dorm:
                conn.execute(
                    "UPDATE students SET name = ?, gender = ?, note = ?, dorm = ? WHERE id = ?",
                    (name, gender, note, dorm, sid),
                )
            else:
                conn.execute("UPDATE students SET name = ?, gender = ?, note = ? WHERE id = ?", (name, gender, note, sid))
            updated += 1
        else:
            max_order += 1
            conn.execute(
                "INSERT INTO students (id, name, gender, note, dorm, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
                (sid, name, gender, note, dorm, max_order),
            )
            existing.add(sid)
            added += 1
    return added, updated


def create_student(
    conn: sqlite3.Connection, student_id: str, name: str, gender: str = "", note: str = "", dorm: str = ""
) -> None:
    student_id, name, gender, note = student_id.strip(), name.strip(), gender.strip(), note.strip()
    domain.validate_student(student_id, name, gender, note)
    if student_id in _student_ids(conn):
        raise DomainError("学号已存在", status=409, code="student_exists")
    max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) FROM students").fetchone()[0]
    conn.execute(
        "INSERT INTO students (id, name, gender, note, dorm, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
        (student_id, name, gender, note, dorm.strip(), max_order + 1),
    )


def update_student(
    conn: sqlite3.Connection,
    student_id: str,
    name: Optional[str],
    gender: Optional[str],
    note: Optional[str],
    dorm: Optional[str] = None,
) -> None:
    row = conn.execute("SELECT * FROM students WHERE id = ?", (student_id,)).fetchone()
    if row is None:
        raise DomainError("学生不存在", status=404, code="student_not_found")
    new_name = row["name"] if name is None else name.strip()
    new_gender = row["gender"] if gender is None else gender.strip()
    new_note = row["note"] if note is None else note.strip()
    new_dorm = row["dorm"] if dorm is None else dorm.strip()
    domain.validate_student(student_id, new_name, new_gender, new_note)
    if len(new_dorm) > 20:
        raise DomainError("寝室号不超过 20 个字符")
    conn.execute(
        "UPDATE students SET name = ?, gender = ?, note = ?, dorm = ? WHERE id = ?",
        (new_name, new_gender, new_note, new_dorm, student_id),
    )


def delete_student(conn: sqlite3.Connection, student_id: str) -> None:
    if conn.execute("SELECT 1 FROM students WHERE id = ?", (student_id,)).fetchone() is None:
        raise DomainError("学生不存在", status=404, code="student_not_found")
    conn.execute("DELETE FROM students WHERE id = ?", (student_id,))


MAX_DORM_ROWS = 500


def import_dorms(conn: sqlite3.Connection, records: Iterable[dict]) -> int:
    """按 寝室号 + 学生 批量登记寝室（同一学生只保留一个寝室，后导入覆盖）。"""
    records = list(records)
    if len(records) > MAX_DORM_ROWS:
        raise DomainError("一次最多导入 %d 条寝室记录" % MAX_DORM_ROWS)
    known = _student_ids(conn)
    unknown = sorted({str(item["student_id"]).strip() for item in records if str(item["student_id"]).strip() not in known})
    if unknown:
        raise DomainError("以下学号不在名单中：" + "、".join(unknown[:10]), code="unknown_student")
    updated = 0
    for item in records:
        sid = str(item["student_id"]).strip()
        room = str(item["room"]).strip()
        if not room or len(room) > 20:
            raise DomainError("寝室号不能为空且不超过 20 个字符")
        conn.execute("UPDATE students SET dorm = ? WHERE id = ?", (room, sid))
        updated += 1
    return updated


def _validate_exam_payload(
    conn: sqlite3.Connection,
    name: str,
    date: str,
    subjects: List[str],
    scores: Dict[str, Dict[str, Optional[float]]],
    ranks: Dict[str, Dict[str, dict]],
    source_format: str,
    full_marks: Optional[Dict[str, Optional[float]]] = None,
) -> Tuple[str, List[str], str, Dict[str, float]]:
    name = name.strip()
    subjects = domain.validate_exam(name, date, subjects)
    if len(scores) > MAX_EXAM_STUDENTS or len(ranks) > MAX_EXAM_STUDENTS:
        raise DomainError("一次最多导入 %d 名学生的成绩" % MAX_EXAM_STUDENTS)
    known = _student_ids(conn)
    unknown = sorted({sid for sid in list(scores) + list(ranks)} - known)
    if unknown:
        raise DomainError("以下学号不在名单中：" + "、".join(unknown[:10]), code="unknown_student")
    for per_subject in scores.values():
        for subject, value in per_subject.items():
            if subject not in subjects:
                raise DomainError("成绩包含未声明的科目：%s" % subject)
            domain.validate_score(subject, value)
    for per_subject in ranks.values():
        for subject, rank in per_subject.items():
            if subject not in subjects:
                raise DomainError("排名包含未声明的科目：%s" % subject)
            domain.validate_rank(subject, rank.get("school"), "校次")
            domain.validate_rank(subject, rank.get("class"), "班次")
    source_format = (source_format or "").strip()
    if len(source_format) > 40:
        raise DomainError("来源说明不超过 40 个字符")
    clean_full_marks = domain.validate_full_marks(subjects, full_marks or {})
    return name, subjects, source_format, clean_full_marks


def _insert_exam_rows(
    conn: sqlite3.Connection,
    exam_id: str,
    subjects: List[str],
    scores: Dict[str, Dict[str, Optional[float]]],
    ranks: Dict[str, Dict[str, dict]],
    full_marks: Optional[Dict[str, float]] = None,
) -> None:
    full_marks = full_marks or {}
    for index, subject in enumerate(subjects):
        conn.execute(
            "INSERT INTO exam_subjects (exam_id, subject, ordinal, full_marks) VALUES (?, ?, ?, ?)",
            (exam_id, subject, index, full_marks.get(subject)),
        )
    for sid in sorted(set(list(scores) + list(ranks))):
        per_subject = scores.get(sid, {})
        per_rank = ranks.get(sid, {})
        for subject in subjects:
            rank = per_rank.get(subject) or {}
            conn.execute(
                "INSERT INTO scores (exam_id, student_id, subject, score, school_rank, class_rank)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (exam_id, sid, subject, per_subject.get(subject), rank.get("school"), rank.get("class")),
            )


def create_exam(
    conn: sqlite3.Connection,
    name: str,
    date: str,
    subjects: List[str],
    scores: Dict[str, Dict[str, Optional[float]]],
    ranks: Dict[str, Dict[str, dict]],
    source_format: str = "",
    exam_id: Optional[str] = None,
    full_marks: Optional[Dict[str, Optional[float]]] = None,
) -> str:
    name, subjects, source_format, full_marks = _validate_exam_payload(
        conn, name, date, subjects, scores, ranks, source_format, full_marks
    )
    exam_id = exam_id or uuid.uuid4().hex
    if conn.execute("SELECT 1 FROM exams WHERE id = ?", (exam_id,)).fetchone():
        raise DomainError("备份中存在重复考试编号", code="duplicate_exam")
    conn.execute(
        "INSERT INTO exams (id, name, date, source_format, imported_at) VALUES (?, ?, ?, ?, ?)",
        (exam_id, name, date, source_format, _now()),
    )
    _insert_exam_rows(conn, exam_id, subjects, scores, ranks, full_marks)
    return exam_id


def replace_exam(
    conn: sqlite3.Connection,
    exam_id: str,
    name: str,
    date: str,
    subjects: List[str],
    scores: Dict[str, Dict[str, Optional[float]]],
    ranks: Dict[str, Dict[str, dict]],
    source_format: str = "",
    full_marks: Optional[Dict[str, Optional[float]]] = None,
) -> None:
    """用新导入的成绩覆盖同一场考试（保留考试 id，座位表选中的考试不会丢）。"""
    if conn.execute("SELECT 1 FROM exams WHERE id = ?", (exam_id,)).fetchone() is None:
        raise DomainError("考试不存在", status=404, code="exam_not_found")
    name, subjects, source_format, full_marks = _validate_exam_payload(
        conn, name, date, subjects, scores, ranks, source_format, full_marks
    )
    conn.execute("DELETE FROM scores WHERE exam_id = ?", (exam_id,))
    conn.execute("DELETE FROM exam_subjects WHERE exam_id = ?", (exam_id,))
    conn.execute(
        "UPDATE exams SET name = ?, date = ?, source_format = ?, imported_at = ? WHERE id = ?",
        (name, date, source_format, _now(), exam_id),
    )
    _insert_exam_rows(conn, exam_id, subjects, scores, ranks, full_marks)
    settings = _settings_dict(conn)
    if settings["exam_id"] == exam_id and settings["subject"] not in subjects:
        conn.execute("UPDATE settings SET subject = ? WHERE id = 1", (subjects[0],))


def fill_missing_class_ranks(conn: sqlite3.Connection) -> int:
    """为没有班次数据的科目按分数补算班次；已有班次（含部分）的科目不动。

    调用方需包在 write_tx 内。返回补算的成绩行数。
    """
    missing = conn.execute(
        "SELECT exam_id, subject FROM scores GROUP BY exam_id, subject"
        " HAVING SUM(CASE WHEN class_rank IS NOT NULL THEN 1 ELSE 0 END) = 0"
    ).fetchall()
    filled = 0
    for group in missing:
        entries = conn.execute(
            "SELECT student_id, score FROM scores WHERE exam_id = ? AND subject = ?",
            (group["exam_id"], group["subject"]),
        ).fetchall()
        scores = {entry["student_id"]: entry["score"] for entry in entries}
        for student_id, rank in domain.compute_class_ranks(scores).items():
            conn.execute(
                "UPDATE scores SET class_rank = ? WHERE exam_id = ? AND student_id = ? AND subject = ?",
                (rank, group["exam_id"], student_id, group["subject"]),
            )
            filled += 1
    return filled


def update_exam(
    conn: sqlite3.Connection,
    exam_id: str,
    name: Optional[str],
    date: Optional[str],
    full_marks: Optional[Dict[str, Optional[float]]] = None,
) -> None:
    row = conn.execute("SELECT * FROM exams WHERE id = ?", (exam_id,)).fetchone()
    if row is None:
        raise DomainError("考试不存在", status=404, code="exam_not_found")
    new_name = row["name"] if name is None else name.strip()
    new_date = row["date"] if date is None else date
    subjects = [r["subject"] for r in conn.execute("SELECT subject FROM exam_subjects WHERE exam_id = ?", (exam_id,))]
    domain.validate_exam(new_name, new_date, subjects)
    conn.execute("UPDATE exams SET name = ?, date = ? WHERE id = ?", (new_name, new_date, exam_id))
    if full_marks is not None:
        for subject, value in full_marks.items():
            if subject not in subjects:
                raise DomainError("满分包含未声明的科目：%s" % subject)
            if value is None:
                conn.execute(
                    "UPDATE exam_subjects SET full_marks = NULL WHERE exam_id = ? AND subject = ?",
                    (exam_id, subject),
                )
                continue
            if (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or value != value
                or value <= 0
                or value > domain.SCORE_MAX
            ):
                raise DomainError("科目 %s 的满分必须是 0–%d 之间的正数" % (subject, domain.SCORE_MAX))
            conn.execute(
                "UPDATE exam_subjects SET full_marks = ? WHERE exam_id = ? AND subject = ?",
                (float(value), exam_id, subject),
            )


def delete_exam(conn: sqlite3.Connection, exam_id: str) -> None:
    if conn.execute("SELECT 1 FROM exams WHERE id = ?", (exam_id,)).fetchone() is None:
        raise DomainError("考试不存在", status=404, code="exam_not_found")
    conn.execute("DELETE FROM exams WHERE id = ?", (exam_id,))
    # 删掉正在单场显示的考试后，自动回落到全部考试平均，避免座位表突然没有成绩
    conn.execute(
        "UPDATE settings SET exam_id = '', seat_range = 'all'"
        " WHERE id = 1 AND exam_id = ? AND seat_range = 'single'",
        (exam_id,),
    )
    conn.execute("UPDATE settings SET exam_id = '' WHERE id = 1 AND exam_id = ?", (exam_id,))


def _rows(conn: sqlite3.Connection) -> int:
    return _settings_dict(conn)["rows"]


def replace_seats(conn: sqlite3.Connection, seats: Dict[str, str]) -> None:
    rows = _rows(conn)
    known = _student_ids(conn)
    seen_students = set()
    for seat_id, student_id in seats.items():
        domain.validate_seat_id(seat_id, rows)
        if student_id not in known:
            raise DomainError("学生不存在：%s" % student_id, status=404, code="student_not_found")
        if student_id in seen_students:
            raise DomainError("同一学生不能占用多个座位：%s" % student_id, code="duplicate_seat")
        seen_students.add(student_id)
    conn.execute("DELETE FROM seats")
    for seat_id, student_id in seats.items():
        conn.execute("INSERT INTO seats (seat_id, student_id) VALUES (?, ?)", (seat_id, student_id))


def move_student(conn: sqlite3.Connection, student_id: str, target: Optional[str]) -> None:
    rows = _rows(conn)
    if conn.execute("SELECT 1 FROM students WHERE id = ?", (student_id,)).fetchone() is None:
        raise DomainError("学生不存在", status=404, code="student_not_found")
    current = conn.execute("SELECT seat_id FROM seats WHERE student_id = ?", (student_id,)).fetchone()
    current_seat = current["seat_id"] if current else None
    if target is None:
        conn.execute("DELETE FROM seats WHERE student_id = ?", (student_id,))
        return
    domain.validate_seat_id(target, rows)
    if current_seat == target:
        return
    occupant = conn.execute("SELECT student_id FROM seats WHERE seat_id = ?", (target,)).fetchone()
    conn.execute("DELETE FROM seats WHERE student_id = ?", (student_id,))
    if occupant:
        if current_seat:
            # 互换：原占位学生搬到被拖动学生的空出来的位置
            conn.execute(
                "UPDATE seats SET seat_id = ? WHERE student_id = ?", (current_seat, occupant["student_id"])
            )
        else:
            conn.execute("DELETE FROM seats WHERE seat_id = ?", (target,))
    conn.execute("INSERT INTO seats (seat_id, student_id) VALUES (?, ?)", (target, student_id))


def rotate_seats(conn: sqlite3.Connection) -> int:
    """第一组→第二组→第三组→第四组→第一组；组内排数与左右位置不变，中央加座不动。"""
    rows = _rows(conn)
    current = load_seats(conn)
    moved = 0
    next_seats: Dict[str, str] = {}
    for seat_id, student_id in current.items():
        if seat_id in domain.EXTRA_SEAT_IDS:
            next_seats[seat_id] = student_id
            continue
        match = domain.SEAT_RE.match(seat_id)
        if not match:
            raise DomainError("数据库中存在非法座位 %s" % seat_id, status=500, code="corrupt_seat")
        row_index, column = int(match.group(1)), int(match.group(2))
        if row_index > rows:
            raise DomainError("座位 %s 超出当前排数，请先恢复排数" % seat_id, code="seat_out_of_range")
        next_column = column + 6 if column <= 2 else column - 2
        next_seats["R%dC%d" % (row_index, next_column)] = student_id
        moved += 1
    conn.execute("DELETE FROM seats")
    for seat_id, student_id in next_seats.items():
        conn.execute("INSERT INTO seats (seat_id, student_id) VALUES (?, ?)", (seat_id, student_id))
    return moved


def clear_seats(conn: sqlite3.Connection) -> None:
    conn.execute("DELETE FROM seats")


def add_discipline(
    conn: sqlite3.Connection,
    student_id: str,
    date: str,
    type_name: str,
    reason: str,
    room: str = "",
) -> str:
    student = conn.execute("SELECT dorm FROM students WHERE id = ?", (student_id,)).fetchone()
    if student is None:
        raise DomainError("学生不存在", status=404, code="student_not_found")
    domain.validate_discipline(date, type_name, reason)
    owned_room = ""
    if type_name == "寝室违纪":
        supplied = str(room or "").strip()
        if len(supplied) > 20:
            raise DomainError("寝室号不超过 20 个字符")
        # 恢复刚删除的记录时用记录原来的寝室；新登记则用学生当前寝室
        owned_room = supplied or (student["dorm"] or "").strip()
    record_id = uuid.uuid4().hex
    conn.execute(
        "INSERT INTO discipline (id, student_id, date, type, reason, room, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (record_id, student_id, date, type_name, reason.strip(), owned_room, _now()),
    )
    return record_id


def delete_discipline(conn: sqlite3.Connection, student_id: str, record_id: str) -> None:
    row = conn.execute(
        "SELECT id FROM discipline WHERE id = ? AND student_id = ?", (record_id, student_id)
    ).fetchone()
    if row is None:
        raise DomainError("违纪记录不存在", status=404, code="discipline_not_found")
    conn.execute("DELETE FROM discipline WHERE id = ?", (record_id,))


def _room_members(conn: sqlite3.Connection, room: str) -> list:
    return [
        row["id"]
        for row in conn.execute("SELECT id FROM students WHERE dorm = ? ORDER BY sort_order", (room.strip(),)).fetchall()
    ]


def _dorm_room_exists(conn: sqlite3.Connection, room: str) -> bool:
    return conn.execute("SELECT 1 FROM students WHERE dorm = ? LIMIT 1", (room.strip(),)).fetchone() is not None


def _dorm_room_has_incidents(conn: sqlite3.Connection, room: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM discipline WHERE type = '寝室违纪' AND room = ? LIMIT 1", (room.strip(),)
        ).fetchone()
        is not None
    )


def save_dorm(
    conn: sqlite3.Connection,
    original_room: str,
    room: str,
    student_ids: Iterable[str],
    incidents: Iterable[dict],
) -> None:
    """新增/编辑整间寝室：改寝室号、调整成员、增删违纪事件，全部在一次写事务内完成。

    original_room 为空表示新增；否则表示正在编辑该寝室。
    成员以提交的 student_ids 为准：原来在寝室内、这次没有勾选的学生会被移出寝室（变为未登记）。
    违纪事件归属于寝室号（记录里保存 room）：改名时跟着寝室走，成员调入调出既不会带走、
    也不会删除其他寝室的违纪记录。incidents 按 日期+备注 匹配，保留已有、补上新增、删掉移除的。
    """
    original = str(original_room or "").strip()
    target = str(room or "").strip()
    if not target or len(target) > 20:
        raise DomainError("寝室号不能为空且不超过 20 个字符")
    ids: List[str] = []
    seen_ids = set()
    for raw in student_ids:
        sid = str(raw).strip()
        if not sid:
            continue
        if sid in seen_ids:
            raise DomainError("同一名学生被重复选择：" + sid, code="duplicate_student")
        seen_ids.add(sid)
        ids.append(sid)
    known = _student_ids(conn)
    unknown = [sid for sid in ids if sid not in known]
    if unknown:
        raise DomainError("以下学号不在名单中：" + "、".join(unknown[:10]), code="unknown_student")
    original_exists = bool(original) and (
        _dorm_room_exists(conn, original) or _dorm_room_has_incidents(conn, original)
    )
    if original and not original_exists:
        raise DomainError("寝室 %s 不存在" % original, status=404, code="dorm_not_found")
    if not ids and not original:
        raise DomainError("寝室至少要有一名学生", code="dorm_empty")
    if target != original and (_dorm_room_exists(conn, target) or _dorm_room_has_incidents(conn, target)):
        raise DomainError("寝室 %s 已存在，请直接编辑该寝室" % target, status=409, code="dorm_exists")

    cleaned: List[Tuple[str, str]] = []
    for item in incidents:
        date = str(item.get("date") or "").strip()
        reason = str(item.get("reason") or "").strip()
        domain.validate_discipline(date, "寝室违纪", reason)
        key = (date, reason)
        if key in cleaned:
            continue
        cleaned.append(key)
    if not ids and cleaned:
        raise DomainError("该寝室已没有在册成员，请先勾选成员或删除全部违纪记录", code="dorm_empty")

    # 先记下原寝室成员与各学生当前寝室，改名/调寝后就不能再按旧寝室号查了
    previous_members = _room_members(conn, original) if original else []
    student_dorm = {
        row["id"]: (row["dorm"] or "").strip()
        for row in conn.execute("SELECT id, dorm FROM students").fetchall()
    }
    # 旧版记录没有 room：按学生当前寝室补上归属，避免调寝时把历史违纪串到新寝室
    for sid in dict.fromkeys(previous_members + ids):
        old_room = student_dorm.get(sid, "")
        if old_room:
            conn.execute(
                "UPDATE discipline SET room = ? WHERE type = '寝室违纪' AND room = '' AND student_id = ?",
                (old_room, sid),
            )

    for sid in ids:
        conn.execute("UPDATE students SET dorm = ? WHERE id = ?", (target, sid))
    for sid in previous_members:
        if sid not in seen_ids:
            conn.execute("UPDATE students SET dorm = '' WHERE id = ?", (sid,))
    if original and original != target:
        conn.execute(
            "UPDATE discipline SET room = ? WHERE type = '寝室违纪' AND room = ?",
            (target, original),
        )

    existing: Dict[Tuple[str, str], List[str]] = {}
    rows = conn.execute(
        "SELECT id, date, reason FROM discipline WHERE type = '寝室违纪' AND room = ?", (target,)
    ).fetchall()
    for row in rows:
        existing.setdefault((row["date"], row["reason"]), []).append(row["id"])
    desired = set(cleaned)
    for key, record_ids in existing.items():
        if key in desired:
            continue
        conn.executemany("DELETE FROM discipline WHERE id = ?", [(record_id,) for record_id in record_ids])
    for date, reason in cleaned:
        if (date, reason) in existing:
            continue
        for sid in ids:
            conn.execute(
                "INSERT INTO discipline (id, student_id, date, type, reason, room, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (uuid.uuid4().hex, sid, date, "寝室违纪", reason, target, _now()),
            )


def add_dorm_discipline(
    conn: sqlite3.Connection,
    room: str,
    date: str,
    reason: str = "",
    student_ids: Optional[Iterable[str]] = None,
) -> int:
    """登记一次寝室违纪；可选择该寝室中的部分成员，统计侧仍按一次事件计算。

    student_ids 省略/为 None 时兼容旧客户端，默认整间每人一条。
    """
    room = room.strip()
    members = _room_members(conn, room)
    if not members:
        raise DomainError("寝室 %s 还没有登记学生" % room, status=404, code="dorm_empty")
    domain.validate_discipline(date, "寝室违纪", reason)
    member_set = set(members)
    if student_ids is None:
        selected = members
    else:
        selected = [str(student_id).strip() for student_id in student_ids if str(student_id).strip()]
        if not selected:
            raise DomainError("请至少选择一名寝室成员", code="dorm_member_required")
        invalid = [student_id for student_id in selected if student_id not in member_set]
        if invalid:
            raise DomainError(
                "只能选择该寝室的当前成员：" + "、".join(invalid[:10]),
                code="dorm_member_invalid",
            )
    existing = {
        (row["student_id"], row["date"], row["reason"])
        for row in conn.execute(
            "SELECT student_id, date, reason FROM discipline WHERE type = '寝室违纪' AND room = ?",
            (room,),
        ).fetchall()
    }
    added = 0
    for student_id in dict.fromkeys(selected):
        if (student_id, date, reason.strip()) in existing:
            continue
        conn.execute(
            "INSERT INTO discipline (id, student_id, date, type, reason, room, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (uuid.uuid4().hex, student_id, date, "寝室违纪", reason.strip(), room, _now()),
        )
        added += 1
    return added


def delete_dorm_discipline(conn: sqlite3.Connection, room: str, date: str, reason: str = "") -> int:
    """撤销整间那一次寝室违纪（按 日期+备注 匹配归属于该寝室的记录）。"""
    room = room.strip()
    if not room:
        return 0
    members = _room_members(conn, room)
    params: List[str] = [date, reason.strip(), room]
    sql = (
        "DELETE FROM discipline WHERE type = '寝室违纪' AND date = ? AND reason = ?"
        " AND (room = ?"
    )
    if members:
        placeholders = ",".join("?" for _ in members)
        sql += " OR (room = '' AND student_id IN (%s))" % placeholders
        params += members
    sql += ")"
    cursor = conn.execute(sql, params)
    return cursor.rowcount or 0


def import_discipline(conn: sqlite3.Connection, records: Iterable[dict], skip_duplicates: bool = False) -> Tuple[int, int]:
    records = list(records)
    if len(records) > MAX_DISCIPLINE_ROWS:
        raise DomainError("一次最多导入 %d 条违纪记录" % MAX_DISCIPLINE_ROWS)
    known = _student_ids(conn)
    unknown = sorted({str(r["student_id"]) for r in records if str(r["student_id"]) not in known})
    if unknown:
        raise DomainError("以下学号不在名单中：" + "、".join(unknown[:10]), code="unknown_student")
    student_dorm = {
        row["id"]: (row["dorm"] or "").strip()
        for row in conn.execute("SELECT id, dorm FROM students").fetchall()
    }
    existing = {
        (r["student_id"], r["date"], r["type"], r["reason"])
        for r in conn.execute("SELECT student_id, date, type, reason FROM discipline").fetchall()
    }
    added = skipped = 0
    for record in records:
        student_id = str(record["student_id"])
        date = record["date"]
        type_name = record["type"]
        reason = str(record.get("reason") or "").strip()
        domain.validate_discipline(date, type_name, reason)
        key = (student_id, date, type_name, reason)
        # 同一天同类型的多次违纪是合法的，默认不合并；只有显式要求时才跳过库中已有记录
        if skip_duplicates and key in existing:
            skipped += 1
            continue
        room = student_dorm.get(student_id, "") if type_name == "寝室违纪" else ""
        conn.execute(
            "INSERT INTO discipline (id, student_id, date, type, reason, room, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (uuid.uuid4().hex, student_id, date, type_name, reason, room, _now()),
        )
        existing.add(key)
        added += 1
    return added, skipped


def update_settings(conn: sqlite3.Connection, payload: dict) -> None:
    current = _settings_dict(conn)
    updated = dict(current)
    for key in (
        "class_name",
        "rows",
        "extra_row",
        "show_scores",
        "exam_id",
        "subject",
        "call_range",
        "call_subject",
        "seat_range",
    ):
        if key in payload and payload[key] is not None:
            updated[key] = payload[key]
    class_name, subject, call_subject = domain.validate_settings_values(
        updated["class_name"],
        updated["rows"],
        updated["extra_row"],
        updated["call_range"],
        updated["seat_range"],
        updated["subject"],
        updated["call_subject"],
    )
    rows, extra_row = int(updated["rows"]), int(updated["extra_row"])
    exam_id = str(updated["exam_id"] or "")
    if exam_id and conn.execute("SELECT 1 FROM exams WHERE id = ?", (exam_id,)).fetchone() is None:
        raise DomainError("引用的考试不存在", status=404, code="exam_not_found")
    # 显示成绩与是否选中考试解耦：平均模式下不需要单场考试也能显示
    show_scores = bool(updated["show_scores"])

    if rows < 7:
        conn.execute("DELETE FROM seats WHERE seat_id LIKE 'R7%'")
    conn.execute(
        "UPDATE settings SET class_name = ?, rows = ?, extra_row = ?, show_scores = ?, exam_id = ?,"
        " subject = ?, call_range = ?, call_subject = ?, seat_range = ? WHERE id = 1",
        (
            class_name,
            rows,
            extra_row,
            1 if show_scores else 0,
            exam_id,
            subject,
            updated["call_range"],
            call_subject,
            updated["seat_range"],
        ),
    )


def discipline_summary(conn: sqlite3.Connection, days: Optional[int]) -> dict:
    params: List[str] = []
    sql = "SELECT d.student_id, d.date, d.type, s.name FROM discipline d JOIN students s ON s.id = d.student_id"
    if days:
        cutoff = (date_type.today() - timedelta(days=days - 1)).isoformat()
        sql += " WHERE d.date >= ?"
        params.append(cutoff)
    sql += " ORDER BY d.student_id, d.date"
    rows = conn.execute(sql, params).fetchall()
    grouped: Dict[str, dict] = {}
    for row in rows:
        entry = grouped.setdefault(
            row["student_id"],
            {"student_id": row["student_id"], "name": row["name"], "count": 0, "last_date": "", "types": {}},
        )
        entry["count"] += 1
        entry["last_date"] = max(entry["last_date"], row["date"])
        entry["types"][row["type"]] = entry["types"].get(row["type"], 0) + 1
    ordered = sorted(grouped.values(), key=lambda item: (-item["count"], item["name"]))
    return {
        "rows": ordered,
        "total": sum(item["count"] for item in ordered),
        "students": len(ordered),
    }


def replace_state(conn: sqlite3.Connection, state: dict) -> None:
    """整库恢复（备份还原）：先校验布局，再清空重写。"""
    settings = state["settings"]
    seat_range = settings.get("seat_range", "all")
    class_name, subject, call_subject = domain.validate_settings_values(
        settings["class_name"],
        settings["rows"],
        settings["extra_row"],
        settings["call_range"],
        seat_range,
        settings["subject"],
        settings["call_subject"],
    )
    if len(state.get("exams") or []) > 500:
        raise DomainError("备份中的考试数量超出上限")
    discipline_total = sum(len(records or []) for records in (state.get("discipline") or {}).values())
    if discipline_total > MAX_DISCIPLINE_ROWS:
        raise DomainError("备份中的违纪记录超过 %d 条上限" % MAX_DISCIPLINE_ROWS)
    exam_ids = {exam["id"] for exam in state["exams"]}
    if settings.get("exam_id") and settings["exam_id"] not in exam_ids:
        raise DomainError("备份引用了不存在的考试", code="unknown_exam")
    show_scores = bool(settings.get("show_scores"))
    if len(state["students"]) > MAX_ROSTER_ROWS:
        raise DomainError("备份数据量超出上限")
    normalized_students = []
    for student in state["students"]:
        normalized = {
            "id": str(student["id"]).strip(),
            "name": str(student["name"]).strip(),
            "gender": str(student.get("gender", "")).strip(),
            "note": str(student.get("note", "")).strip(),
            "dorm": str(student.get("dorm", "") or "").strip(),
        }
        domain.validate_student(normalized["id"], normalized["name"], normalized["gender"], normalized["note"])
        normalized_students.append(normalized)
    student_ids = {student["id"] for student in normalized_students}
    if len(student_ids) != len(normalized_students):
        raise DomainError("备份中存在重复学号")
    state["students"] = normalized_students
    discipline_state = {}
    for raw_student_id, records in (state.get("discipline") or {}).items():
        student_id = str(raw_student_id).strip()
        if student_id not in student_ids:
            raise DomainError("备份中的违纪记录引用了不存在的学生：%s" % student_id)
        if student_id in discipline_state:
            raise DomainError("备份中的违纪记录存在重复的学生键：%s" % student_id)
        discipline_state[student_id] = records
    state["discipline"] = discipline_state

    seats = {}
    for raw_seat, raw_student in (state.get("seats") or {}).items():
        seats[str(raw_seat).strip()] = str(raw_student).strip()
    seen = set()
    for seat_id, student_id in seats.items():
        domain.validate_seat_id(seat_id, int(settings["rows"]))
        if student_id not in student_ids:
            raise DomainError("备份中的座位引用了不存在的学生：%s" % student_id)
        if student_id in seen:
            raise DomainError("备份中同一学生占了多个座位：%s" % student_id)
        seen.add(student_id)

    conn.execute("DELETE FROM seats")
    conn.execute("DELETE FROM discipline")
    conn.execute("DELETE FROM scores")
    conn.execute("DELETE FROM exam_subjects")
    conn.execute("DELETE FROM exams")
    conn.execute("DELETE FROM students")
    conn.execute("DELETE FROM settings")

    conn.execute(
        "INSERT INTO settings (id, class_name, rows, extra_row, show_scores, exam_id, subject, call_range, call_subject, seat_range)"
        " VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            class_name,
            int(settings["rows"]),
            int(settings["extra_row"]),
            1 if show_scores else 0,
            settings.get("exam_id", ""),
            subject,
            settings.get("call_range", "single"),
            call_subject,
            seat_range,
        ),
    )
    for index, student in enumerate(state["students"]):
        conn.execute(
            "INSERT INTO students (id, name, gender, note, dorm, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
            (
                str(student["id"]).strip(),
                str(student["name"]).strip(),
                str(student.get("gender", "")).strip(),
                str(student.get("note", "")).strip(),
                str(student.get("dorm", "") or "").strip()[:20],
                index,
            ),
        )
    # 逆序写入：备份是按“日期倒序 + 导入倒序”排列的，逆序插入可让 imported_at 递增方向与备份顺序一致
    for exam in reversed(state["exams"]):
        # 备份里 Rank 可能是 snake_case（class_rank）或 camelCase（class），统一成内部键
        ranks = {
            sid: {
                subject: {"school": rank.get("school"), "class": rank.get("class", rank.get("class_rank"))}
                for subject, rank in per.items()
            }
            for sid, per in (exam.get("ranks") or {}).items()
        }
        create_exam(
            conn,
            exam["name"],
            exam["date"],
            exam["subjects"],
            exam.get("scores", {}),
            ranks,
            exam.get("source_format", ""),
            exam.get("id"),
            exam.get("full_marks", {}),
        )
    for seat_id, student_id in seats.items():
        conn.execute("INSERT INTO seats (seat_id, student_id) VALUES (?, ?)", (seat_id, student_id))
    student_dorms = {student["id"]: student["dorm"] for student in state["students"]}
    for student_id, records in (state.get("discipline") or {}).items():
        for record in records:
            domain.validate_discipline(record["date"], record["type"], record.get("reason", ""))
            room = str(record.get("room") or "").strip()[:20]
            if record["type"] == "寝室违纪" and not room:
                # 旧备份的寝室违纪没有归属寝室，按学生当前寝室补上
                room = student_dorms.get(student_id, "")[:20]
            conn.execute(
                "INSERT INTO discipline (id, student_id, date, type, reason, room, created_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    uuid.uuid4().hex,
                    student_id,
                    record["date"],
                    record["type"],
                    record.get("reason", ""),
                    room,
                    _now(),
                ),
            )
