"""SQLite 连接与事务管理。"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    class_name TEXT NOT NULL,
    rows INTEGER NOT NULL,
    extra_row INTEGER NOT NULL,
    show_scores INTEGER NOT NULL,
    exam_id TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '总分',
    call_range TEXT NOT NULL DEFAULT 'single',
    call_subject TEXT NOT NULL DEFAULT '',
    seat_range TEXT NOT NULL DEFAULT 'all'
);

CREATE TABLE IF NOT EXISTS students (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gender TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    dorm TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    source_format TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exam_subjects (
    exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    PRIMARY KEY (exam_id, subject)
);

CREATE TABLE IF NOT EXISTS scores (
    exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    score REAL,
    school_rank INTEGER,
    class_rank INTEGER,
    PRIMARY KEY (exam_id, student_id, subject)
);

CREATE TABLE IF NOT EXISTS seats (
    seat_id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS discipline (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    room TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discipline_student ON discipline(student_id);
CREATE INDEX IF NOT EXISTS idx_scores_student ON scores(student_id);
"""

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "banxu.sqlite3"


def connect(path: Path | str) -> sqlite3.Connection:
    """打开连接；每次请求一个连接，行以 sqlite3.Row 返回。"""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(target), isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    # 学生数据的数据库与 WAL/SHM 只允许当前用户读写（旧库升级后也会被纠正）
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(str(target) + suffix)
        try:
            if candidate.exists():
                os.chmod(candidate, 0o600)
        except OSError:
            pass
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """轻量迁移：给旧库补上新增列。"""
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(students)").fetchall()}
    if "dorm" not in columns:
        conn.execute("ALTER TABLE students ADD COLUMN dorm TEXT NOT NULL DEFAULT ''")
    discipline_columns = {row["name"] for row in conn.execute("PRAGMA table_info(discipline)").fetchall()}
    if "room" not in discipline_columns:
        conn.execute("ALTER TABLE discipline ADD COLUMN room TEXT NOT NULL DEFAULT ''")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_discipline_room ON discipline(room)")
    # 座位表成绩统计方式：旧库默认「全部考试平均」，与升级前的显示保持一致
    settings_columns = {row["name"] for row in conn.execute("PRAGMA table_info(settings)").fetchall()}
    if "seat_range" not in settings_columns:
        conn.execute("ALTER TABLE settings ADD COLUMN seat_range TEXT NOT NULL DEFAULT 'all'")
    # 旧版寝室违纪靠“学生当前寝室”反推，这里固化归属，之后调寝不会再串到别的寝室
    conn.execute(
        "UPDATE discipline SET room = COALESCE((SELECT dorm FROM students WHERE students.id = discipline.student_id), '')"
        " WHERE type = '寝室违纪' AND room = ''"
    )


def initialize(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    _migrate(conn)
    with write_tx(conn):
        conn.execute(
            "INSERT OR IGNORE INTO settings"
            " (id, class_name, rows, extra_row, show_scores, exam_id, subject, call_range, call_subject, seat_range)"
            " VALUES (1, ?, ?, ?, 0, '', '总分', 'single', '', 'all')",
            ("我的班级", 7, 5),
        )


@contextmanager
def write_tx(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """写事务：BEGIN IMMEDIATE 串行化并发写入，异常回滚并向上抛出。"""
    if conn.in_transaction:
        raise RuntimeError("write_tx 不能在已有事务内嵌套使用")
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise


@contextmanager
def read_tx(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """读快照：保证一次读取多条 SELECT 时看到同一个数据库版本。"""
    if conn.in_transaction:
        raise RuntimeError("read_tx 不能在已有事务内嵌套使用")
    conn.execute("BEGIN")
    try:
        yield conn
    except BaseException:
        try:
            conn.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        raise
    else:
        try:
            conn.execute("COMMIT")
        except sqlite3.OperationalError:
            pass
