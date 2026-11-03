"""API 数据契约（pydantic v2）：字段对外使用 camelCase，与前端 TS 类型一致。"""

from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Student(CamelModel):
    id: str
    name: str
    gender: str = ""
    note: str = ""
    dorm: str = ""


CallRangeLiteral = Literal["single", "recent3", "recent5", "all"]


class Settings(CamelModel):
    class_name: str
    rows: int
    extra_row: int
    show_scores: bool
    exam_id: str = ""
    subject: str = "总分"
    call_range: CallRangeLiteral = "single"
    call_subject: str = ""
    # 座位表成绩统计方式：单次考试 / 最近 3 次平均 / 最近 5 次平均 / 全部考试平均
    seat_range: CallRangeLiteral = "all"


class Rank(CamelModel):
    school: Optional[int] = None
    class_rank: Optional[int] = Field(default=None, alias="class")


class Exam(CamelModel):
    id: str
    name: str
    date: str
    subjects: List[str] = Field(default_factory=list)
    source_format: str = ""
    scores: Dict[str, Dict[str, Optional[float]]] = Field(default_factory=dict)
    ranks: Dict[str, Dict[str, Rank]] = Field(default_factory=dict)


class DisciplineRecord(CamelModel):
    id: str
    date: str
    type: str
    reason: str = ""
    # 寝室违纪归属的寝室号；个人违纪为空串。旧备份没有该字段时由恢复逻辑补齐。
    room: str = ""


class AppState(CamelModel):
    settings: Settings
    students: List[Student] = Field(default_factory=list)
    exams: List[Exam] = Field(default_factory=list)
    seats: Dict[str, str] = Field(default_factory=dict)
    discipline: Dict[str, List[DisciplineRecord]] = Field(default_factory=dict)


class HealthResponse(CamelModel):
    status: str
    version: str


# ---------- 请求体 ----------


class RosterImportRequest(CamelModel):
    records: List[Student]


class DormAssignment(CamelModel):
    room: str
    student_id: str


class DormImportRequest(CamelModel):
    records: List[DormAssignment]


class StudentCreateRequest(CamelModel):
    id: str
    name: str
    gender: str = ""
    note: str = ""
    dorm: str = ""


class StudentUpdateRequest(CamelModel):
    name: Optional[str] = None
    gender: Optional[str] = None
    note: Optional[str] = None
    dorm: Optional[str] = None


class ExamCreateRequest(CamelModel):
    name: str = Field(max_length=200)
    date: str
    subjects: List[str]
    scores: Dict[str, Dict[str, Optional[float]]] = Field(default_factory=dict)
    ranks: Dict[str, Dict[str, Rank]] = Field(default_factory=dict)
    source_format: str = Field(default="", max_length=40)


class ExamUpdateRequest(CamelModel):
    name: Optional[str] = None
    date: Optional[str] = None


class PdfExamRequest(CamelModel):
    """前端把 PDF 读成 base64 提交，避免额外依赖 multipart。"""

    file_name: str = Field(default="", max_length=200)
    data: str = Field(min_length=8, max_length=28 * 1024 * 1024)


class PdfScoreRow(CamelModel):
    name: str
    exam_no: str = ""
    total: float


class PdfExamParse(CamelModel):
    exam_name: str
    subject: str = ""
    full_marks: Optional[float] = None
    page_count: int
    rows: List[PdfScoreRow] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)


class SeatsReplaceRequest(CamelModel):
    seats: Dict[str, str]


class SeatMoveRequest(CamelModel):
    student_id: str
    target: Optional[str] = None


class DisciplineCreateRequest(CamelModel):
    student_id: str
    date: str
    type: str
    reason: str = ""
    # 仅「寝室违纪」使用：恢复刚删除的记录时带上原寝室，避免归属跑到学生当前寝室
    room: str = ""


class DormIncident(CamelModel):
    date: str
    reason: str = ""


class DormSaveRequest(CamelModel):
    """新增/编辑寝室：原寝室号留空表示新增。"""

    original_room: str = ""
    room: str
    student_ids: List[str] = Field(default_factory=list)
    incidents: List[DormIncident] = Field(default_factory=list)


class DormDisciplineRequest(CamelModel):
    room: str
    date: str
    reason: str = ""


class DisciplineImportRow(CamelModel):
    student_id: str
    date: str
    type: str
    reason: str = ""


class DisciplineImportRequest(CamelModel):
    records: List[DisciplineImportRow]
    skip_duplicates: bool = False


class SettingsUpdateRequest(CamelModel):
    class_name: Optional[str] = Field(default=None, max_length=100)
    rows: Optional[int] = None
    extra_row: Optional[int] = None
    show_scores: Optional[bool] = None
    exam_id: Optional[str] = Field(default=None, max_length=64)
    subject: Optional[str] = Field(default=None, max_length=20)
    call_range: Optional[CallRangeLiteral] = None
    call_subject: Optional[str] = Field(default=None, max_length=20)
    seat_range: Optional[CallRangeLiteral] = None


class BackupRequest(CamelModel):
    state: AppState


class DisciplineSummaryRow(CamelModel):
    student_id: str
    name: str
    count: int
    last_date: str
    types: Dict[str, int] = Field(default_factory=dict)


class LoginRequest(CamelModel):
    password: str


class AuthStatus(CamelModel):
    required: bool
    authenticated: bool


class BackupExportResult(CamelModel):
    path: str
    saved_at: str
    students: int
    exams: int


class BackupStatus(CamelModel):
    backup_dir: str
    backup_time: str
    next_run_at: str
    last_backup_path: Optional[str] = None
    last_backup_at: Optional[str] = None
    pending_changes: Optional[bool] = None
    change_reason: Optional[str] = None


class DisciplineSummary(CamelModel):
    rows: List[DisciplineSummaryRow]
    total: int
    students: int
