"""REST 接口：所有写操作在单个事务内完成，并统一返回最新完整状态。"""

from __future__ import annotations

import base64
import logging
from pathlib import Path
import os
import sqlite3
from typing import Iterator, Optional

from fastapi import APIRouter, Depends, Query, Request, Response

from . import auth, backup_service, domain, pdf_exam, repository, updater
from .db import read_tx, write_tx
from .domain import DomainError
from .schemas import (
    AppState,
    AuthStatus,
    BackupExportResult,
    BackupStatus,
    DormImportRequest,
    DormSaveRequest,
    BackupRequest,
    DisciplineCreateRequest,
    DormDisciplineRequest,
    LoginRequest,
    DisciplineImportRequest,
    DisciplineSummary,
    ExamCreateRequest,
    ExamUpdateRequest,
    HealthResponse,
    PdfExamParse,
    PdfExamRequest,
    RosterImportRequest,
    SeatMoveRequest,
    SeatsReplaceRequest,
    SettingsUpdateRequest,
    StudentCreateRequest,
    StudentUpdateRequest,
    UpdateApplyRequest,
)

logger = logging.getLogger("banxu.api")

def _read_version() -> str:
    try:
        text = (Path(__file__).resolve().parents[2] / "VERSION").read_text(encoding="utf-8").strip()
        return text or "2.1.0"
    except OSError:
        return "2.1.0"


VERSION = _read_version()
# 前端启动时会核对这些能力；缺少说明后端进程仍是旧版本
FEATURES = ("seatRange", "pdfExamImport", "autoClassRanks", "examFullMarks")
router = APIRouter(prefix="/api")


def state_of(conn: sqlite3.Connection) -> dict:
    """读取完整状态时使用读事务快照，避免多条 SELECT 之间被并发写插入。"""
    with read_tx(conn):
        return repository.load_state(conn)


def db_session(request: Request) -> Iterator[sqlite3.Connection]:
    conn = request.app.state.connect()
    try:
        yield conn
    finally:
        conn.close()


@router.get("/auth/status", response_model=AuthStatus)
def auth_status(request: Request) -> dict:
    return {"required": True, "authenticated": auth.authenticated(request)}


@router.post("/login")
def login(payload: LoginRequest, response: Response) -> dict:
    if not auth.check_password(payload.password):
        raise DomainError("口令不正确", status=401, code="bad_password")
    response.set_cookie(
        auth.COOKIE_NAME,
        auth.token(),
        max_age=60 * 60 * 24 * 30,
        httponly=True,
        samesite="lax",
    )
    return {"ok": True}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie(auth.COOKIE_NAME)
    return {"ok": True}


@router.get("/health", response_model=HealthResponse)
def health() -> dict:
    return {"status": "ok", "version": VERSION, "features": list(FEATURES)}


@router.get("/state", response_model=AppState)
def read_state(conn: sqlite3.Connection = Depends(db_session)) -> dict:
    return state_of(conn)


# ---------- 名单 ----------


@router.post("/roster/import", response_model=AppState)
def import_roster(payload: RosterImportRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.import_roster(conn, [record.model_dump() for record in payload.records])
    return state_of(conn)


@router.post("/dorms/import", response_model=AppState)
def import_dorms(payload: DormImportRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.import_dorms(conn, [record.model_dump() for record in payload.records])
    return state_of(conn)


@router.post("/dorms/save", response_model=AppState)
def save_dorm(payload: DormSaveRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.save_dorm(
            conn,
            payload.original_room,
            payload.room,
            payload.student_ids,
            [incident.model_dump() for incident in payload.incidents],
        )
    return state_of(conn)


@router.post("/students", response_model=AppState, status_code=201)
def create_student(payload: StudentCreateRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.create_student(conn, payload.id, payload.name, payload.gender, payload.note, payload.dorm)
    return state_of(conn)


@router.patch("/students/{student_id}", response_model=AppState)
def update_student(
    student_id: str, payload: StudentUpdateRequest, conn: sqlite3.Connection = Depends(db_session)
) -> dict:
    with write_tx(conn):
        repository.update_student(conn, student_id, payload.name, payload.gender, payload.note, payload.dorm)
    return state_of(conn)


@router.delete("/students/{student_id}", response_model=AppState)
def delete_student(student_id: str, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.delete_student(conn, student_id)
    return state_of(conn)


# ---------- 自动更新 ----------


@router.get("/update/check")
def update_check(force: bool = Query(False)) -> dict:
    return updater.check_for_update(force=force)


@router.get("/update/status")
def update_status() -> dict:
    return updater.status()


@router.post("/update/apply")
def update_apply(payload: UpdateApplyRequest) -> dict:
    current = updater.status()
    if current.get("phase") in {"downloading", "applying", "installing", "building", "restarting"}:
        raise DomainError("已有更新正在进行，请稍候", status=409, code="update_busy")
    host, port = updater.server_bind()
    return updater.apply_update(payload.tag, host, int(port), parent_pid=None)


# ---------- 考试 ----------


@router.post("/exams/pdf-parse", response_model=PdfExamParse)
def parse_exam_pdf(payload: PdfExamRequest) -> dict:
    """只解析学校成绩单 PDF，不写库；前端预览确认后再调用 /exams 创建考试。"""
    try:
        raw = base64.b64decode(payload.data, validate=True)
    except Exception:
        raise DomainError("PDF 数据无法解码，请重新选择文件", code="pdf_invalid")
    return pdf_exam.parse_score_pdf(raw, payload.file_name)


def _backup_after_import(conn: sqlite3.Connection) -> None:
    """导入考试成绩后立刻落一份备份，避免当天 21:30 前关机丢新数据。测试可关闭。"""
    if os.environ.get("BANXU_BACKUP_ON_IMPORT", "1") != "1":
        return
    try:
        backup_service.write_backup(conn)
    except Exception:
        logger.exception("导入后备份失败")


def _derive_missing_class_ranks(payload: ExamCreateRequest, ranks: dict) -> None:
    """没有随成绩提供班次的科目（如 PDF 成绩单），按本班分数自动计算班次；校次保持原样。"""
    for subject in payload.subjects:
        if any((per.get(subject) or {}).get("class") is not None for per in ranks.values()):
            continue
        scores = {sid: (per or {}).get(subject) for sid, per in payload.scores.items()}
        for sid, rank in domain.compute_class_ranks(scores).items():
            entry = ranks.setdefault(sid, {}).setdefault(subject, {"school": None, "class": None})
            entry["class"] = rank


@router.post("/exams", response_model=AppState, status_code=201)
def create_exam(payload: ExamCreateRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    ranks = {
        sid: {subject: rank.model_dump(by_alias=True) for subject, rank in per.items()}
        for sid, per in payload.ranks.items()
    }
    _derive_missing_class_ranks(payload, ranks)
    with write_tx(conn):
        repository.create_exam(
            conn,
            payload.name,
            payload.date,
            payload.subjects,
            payload.scores,
            ranks,
            payload.source_format,
            full_marks=payload.full_marks,
        )
    _backup_after_import(conn)
    return state_of(conn)


@router.put("/exams/{exam_id}", response_model=AppState)
def replace_exam(exam_id: str, payload: ExamCreateRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    """重新导入并覆盖同一场考试：保留考试 id 与当前选中状态。"""
    ranks = {
        sid: {subject: rank.model_dump(by_alias=True) for subject, rank in per.items()}
        for sid, per in payload.ranks.items()
    }
    _derive_missing_class_ranks(payload, ranks)
    with write_tx(conn):
        repository.replace_exam(
            conn,
            exam_id,
            payload.name,
            payload.date,
            payload.subjects,
            payload.scores,
            ranks,
            payload.source_format,
            full_marks=payload.full_marks,
        )
    _backup_after_import(conn)
    return state_of(conn)


@router.patch("/exams/{exam_id}", response_model=AppState)
def update_exam(exam_id: str, payload: ExamUpdateRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.update_exam(conn, exam_id, payload.name, payload.date, payload.full_marks)
    return state_of(conn)


@router.delete("/exams/{exam_id}", response_model=AppState)
def delete_exam(exam_id: str, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.delete_exam(conn, exam_id)
        # 一场考试都不剩时关闭座位表成绩显示；还有别的考试则保留（会自动回落到平均模式）
        if not conn.execute("SELECT 1 FROM exams LIMIT 1").fetchone():
            repository.update_settings(conn, {"show_scores": False})
    return state_of(conn)


# ---------- 座位 ----------


@router.put("/seats", response_model=AppState)
def replace_seats(payload: SeatsReplaceRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.replace_seats(conn, payload.seats)
    return state_of(conn)


@router.post("/seats/move", response_model=AppState)
def move_seat(payload: SeatMoveRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.move_student(conn, payload.student_id, payload.target)
    return state_of(conn)


@router.post("/seats/rotate", response_model=AppState)
def rotate_seats(conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.rotate_seats(conn)
    return state_of(conn)


@router.delete("/seats", response_model=AppState)
def clear_seats(conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.clear_seats(conn)
    return state_of(conn)


# ---------- 违纪 ----------


@router.post("/discipline", response_model=AppState)
def add_discipline(
    payload: DisciplineCreateRequest,
    conn: sqlite3.Connection = Depends(db_session),
) -> dict:
    with write_tx(conn):
        repository.add_discipline(conn, payload.student_id, payload.date, payload.type, payload.reason, payload.room)
    return state_of(conn)


@router.post("/discipline/dorm", response_model=AppState)
def add_dorm_discipline(payload: DormDisciplineRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.add_dorm_discipline(conn, payload.room, payload.date, payload.reason)
    return state_of(conn)


@router.delete("/discipline/dorm", response_model=AppState)
def delete_dorm_discipline(payload: DormDisciplineRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.delete_dorm_discipline(conn, payload.room, payload.date, payload.reason)
    return state_of(conn)


@router.delete("/discipline/{student_id}/{record_id}", response_model=AppState)
def delete_discipline(
    student_id: str, record_id: str, conn: sqlite3.Connection = Depends(db_session)
) -> dict:
    with write_tx(conn):
        repository.delete_discipline(conn, student_id, record_id)
    return state_of(conn)


@router.post("/discipline/import", response_model=AppState)
def import_discipline(payload: DisciplineImportRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    with write_tx(conn):
        repository.import_discipline(
            conn,
            [record.model_dump() for record in payload.records],
            skip_duplicates=payload.skip_duplicates,
        )
    return state_of(conn)


@router.get("/discipline/summary", response_model=DisciplineSummary)
def discipline_summary(
    days: Optional[int] = Query(default=None, ge=1, le=3650),
    conn: sqlite3.Connection = Depends(db_session),
) -> dict:
    with read_tx(conn):
        return repository.discipline_summary(conn, days)


# ---------- 设置与备份 ----------


@router.patch("/settings", response_model=AppState)
def update_settings(payload: SettingsUpdateRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    changes = {key: value for key, value in payload.model_dump(exclude_none=True).items()}
    with write_tx(conn):
        repository.update_settings(conn, changes)
    return state_of(conn)


@router.get("/backup/status", response_model=BackupStatus)
def backup_status(conn: sqlite3.Connection = Depends(db_session)) -> dict:
    """备份现状：备份目录、每日时间、最近一份备份、下一次自动备份时间、是否有未备份的改动。"""
    return backup_service.backup_status(conn)


@router.post("/backup/export", response_model=BackupExportResult)
def export_backup(conn: sqlite3.Connection = Depends(db_session)) -> dict:
    """立即把完整状态写到备份文件夹（默认 /Users/Apple/Documents/班序备份）。"""
    return backup_service.write_backup(conn, force=True)


@router.get("/backup", response_model=AppState)
def backup(conn: sqlite3.Connection = Depends(db_session)) -> dict:
    return state_of(conn)


@router.post("/backup", response_model=AppState)
def restore(payload: BackupRequest, conn: sqlite3.Connection = Depends(db_session)) -> dict:
    state = payload.state.model_dump()
    with write_tx(conn):
        repository.replace_state(conn, state)
    return state_of(conn)
