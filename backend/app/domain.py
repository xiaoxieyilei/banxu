"""领域规则：座位布局、违纪类型、校验错误。"""

from __future__ import annotations

import re
from datetime import date
from typing import Iterable, List

SEATS_PER_ROW = 8
ROWS_ALLOWED = (6, 7)
EXTRA_SEAT_IDS = ("X1", "X2")
DISCIPLINE_TYPES = (
    "晚自习违纪",
    "晚自习静校期间违纪",
    "早自习违纪",
    "迟到违纪",
    "眼保健操违纪",
    "午休违纪",
    "寝室违纪",
    "带水杯进教室",
)
CALL_RANGES = ("single", "recent3", "recent5", "all")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SEAT_RE = re.compile(r"^R([1-7])C([1-8])$")
EXAM_SUBJECT_MAX = 20
STUDENT_ID_MAX = 64
STUDENT_NAME_MAX = 100
EXAM_NAME_MAX = 80
REASON_MAX = 300
SCORE_MAX = 10000


class DomainError(Exception):
    """业务校验失败；由 API 层转换为 4xx。"""

    def __init__(self, message: str, status: int = 400, code: str = "invalid_request") -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code


def regular_seat_ids(rows: int) -> List[str]:
    return ["R%dC%d" % (r, c) for r in range(1, rows + 1) for c in range(1, SEATS_PER_ROW + 1)]


def seat_ids(rows: int) -> List[str]:
    return regular_seat_ids(rows) + list(EXTRA_SEAT_IDS)


def capacity(rows: int) -> int:
    return rows * SEATS_PER_ROW + len(EXTRA_SEAT_IDS)


def validate_layout(rows: int, extra_row: int) -> None:
    if rows not in ROWS_ALLOWED:
        raise DomainError("排数只能是 6 或 7")
    if not (1 <= extra_row <= rows - 1):
        raise DomainError("中央加座必须落在第 1 至 %d 排之间" % (rows - 1))


def validate_seat_id(seat_id: str, rows: int) -> None:
    if seat_id in EXTRA_SEAT_IDS:
        return
    match = SEAT_RE.match(seat_id)
    if not match or int(match.group(1)) > rows:
        raise DomainError("座位 %s 不在当前 %d 排布局内" % (seat_id, rows))


def validate_date(value: str, label: str = "日期") -> str:
    if not DATE_RE.match(value or ""):
        raise DomainError("%s 必须是 YYYY-MM-DD 格式" % label)
    try:
        date.fromisoformat(value)
    except ValueError:
        raise DomainError("%s 不是有效日期" % label)
    return value


def validate_student(student_id: str, name: str, gender: str = "", note: str = "") -> None:
    if not student_id or len(student_id) > STUDENT_ID_MAX:
        raise DomainError("学号不能为空且不超过 %d 个字符" % STUDENT_ID_MAX)
    if not name or len(name) > STUDENT_NAME_MAX:
        raise DomainError("姓名不能为空且不超过 %d 个字符" % STUDENT_NAME_MAX)
    if len(gender) > 20:
        raise DomainError("性别不超过 20 个字符")
    if len(note) > 200:
        raise DomainError("备注不超过 200 个字符")


def validate_exam(name: str, date: str, subjects: Iterable[str]) -> List[str]:
    if not name or len(name) > EXAM_NAME_MAX:
        raise DomainError("考试名称不能为空且不超过 %d 个字符" % EXAM_NAME_MAX)
    validate_date(date, "考试时间")
    cleaned = [str(subject).strip() for subject in subjects]
    if not cleaned:
        raise DomainError("考试至少要有一个科目")
    if any(len(subject) > 20 for subject in cleaned):
        raise DomainError("科目名称不超过 20 个字符")
    if len(cleaned) > EXAM_SUBJECT_MAX:
        raise DomainError("科目数量不能超过 %d 个" % EXAM_SUBJECT_MAX)
    if any(not subject for subject in cleaned):
        raise DomainError("科目名称不能为空")
    if len(set(cleaned)) != len(cleaned):
        raise DomainError("科目名称不能重复")
    return cleaned


def validate_score(subject: str, score: float | None) -> None:
    if score is None:
        return
    if isinstance(score, bool):
        raise DomainError("科目 %s 的成绩必须是数字" % subject)
    if score != score or score in (float("inf"), float("-inf")):
        raise DomainError("科目 %s 的成绩不是有效数字" % subject)
    if score < 0:
        raise DomainError("科目 %s 的成绩不能为负数" % subject)
    if score > SCORE_MAX:
        raise DomainError("科目 %s 的成绩不能超过 %d" % (subject, SCORE_MAX))


MAX_RANK = 100000


def validate_rank(subject: str, rank: int | None, label: str) -> None:
    if rank is None:
        return
    if isinstance(rank, bool):
        raise DomainError("科目 %s 的%s必须是整数" % (subject, label))
    if rank < 1 or rank > MAX_RANK:
        raise DomainError("科目 %s 的%s必须在 1 到 %d 之间" % (subject, label, MAX_RANK))


def compute_class_ranks(scores: dict) -> dict:
    """按分数从高到低计算班次；同分同名次（1, 1, 3），缺考不参与排名。"""
    rows = [(str(student_id), float(score)) for student_id, score in scores.items() if score is not None]
    rows.sort(key=lambda item: (-item[1], item[0]))
    result = {}
    index = 0
    while index < len(rows):
        end = index + 1
        while end < len(rows) and rows[end][1] == rows[index][1]:
            end += 1
        for cursor in range(index, end):
            result[rows[cursor][0]] = index + 1
        index = end
    return result


def validate_settings_values(
    class_name: str,
    rows: int,
    extra_row: int,
    call_range: str,
    seat_range: str,
    subject: str,
    call_subject: str,
) -> tuple:
    """PATCH 设置与恢复备份共用；返回 (班级名, 科目, 点名科目) 的规范化值。"""
    name = str(class_name or "").strip()
    if not name or len(name) > 100:
        raise DomainError("班级名称不能为空且不超过 100 个字符")
    validate_layout(int(rows), int(extra_row))
    if call_range not in CALL_RANGES:
        raise DomainError("统计方式只能是 single / recent3 / recent5 / all")
    if seat_range not in CALL_RANGES:
        raise DomainError("座位表统计方式只能是 single / recent3 / recent5 / all")
    clean_subject = str(subject or "总分").strip()
    if not clean_subject or len(clean_subject) > 20:
        raise DomainError("排名科目不能为空且不超过 20 个字符")
    clean_call_subject = str(call_subject or "").strip()
    if len(clean_call_subject) > 20:
        raise DomainError("点名科目不超过 20 个字符")
    return name, clean_subject, clean_call_subject


def validate_discipline(date: str, type_name: str, reason: str) -> None:
    validate_date(date, "违纪日期")
    if type_name not in DISCIPLINE_TYPES:
        raise DomainError("违纪类型只能是：" + "、".join(DISCIPLINE_TYPES))
    if len(reason or "") > REASON_MAX:
        raise DomainError("违纪备注不超过 %d 个字符" % REASON_MAX)
