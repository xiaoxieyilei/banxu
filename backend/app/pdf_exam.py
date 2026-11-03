"""解析学校「学生成绩单」PDF（TFB-SCHOOL 打印版）。

这类 PDF 每名学生占一张 4 行小表：
    姓名 | 总分 | 1 | 2 | ... | 11
    学号 | 总分 | 各题得分 ...
    12 | 13 | ... | 17-3
    各题得分 ...
第一页顶部另有「题目 / 班级平均分 / 年级平均分」汇总表。
本模块只提取姓名、学号与总分（单科成绩）；逐题得分不入库。

依赖 PyMuPDF（`pymupdf`，导入名 `fitz`）。延迟导入，避免未安装时后端无法启动。
"""

from __future__ import annotations

import io
import os
import re
from typing import List, Optional, Tuple

from .domain import DomainError

KNOWN_SUBJECTS = ("语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理", "技术")
MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_PAGES = 40
MAX_STUDENTS = 500
ROW_TOLERANCE = 3.0
NAME_RE = re.compile(r"^[\u4e00-\u9fff·•.\-]{2,12}$")
STUDENT_NO_RE = re.compile(r"^\d{4,20}$")
FULL_MARKS_RE = re.compile(r"满分\s*([0-9]+(?:\.[0-9]+)?)")


def _fit():
    try:
        import fitz  # type: ignore

        return fitz
    except Exception:  # pragma: no cover - 仅未安装依赖时触发
        raise DomainError(
            "服务器未安装 PDF 解析组件（PyMuPDF），请运行 pip install pymupdf 后重启",
            status=500,
            code="pdf_dependency_missing",
        )


def _rows(page) -> List[List[str]]:
    """把一页的文字按 y 坐标聚成行，行内按 x 排序，近似还原表格单元格。"""
    words = page.get_text("words")
    rows: List[dict] = []
    for x0, y0, _x1, _y1, text, *_rest in sorted(words, key=lambda item: (item[1], item[0])):
        text = str(text).strip()
        if not text:
            continue
        for row in rows:
            if abs(row["y"] - y0) <= ROW_TOLERANCE:
                row["cells"].append((x0, text))
                break
        else:
            rows.append({"y": y0, "cells": [(x0, text)]})
    return [[text for _x, text in sorted(row["cells"], key=lambda cell: cell[0])] for row in rows]


def _number(value: str) -> Optional[float]:
    text = str(value or "").strip().replace(",", "")
    if not text or not re.fullmatch(r"\d+(?:\.\d+)?", text):
        return None
    return float(text)


def _clean_name(cells: List[str], total_index: int) -> str:
    name = "".join(cells[:total_index]).strip()
    return name if NAME_RE.fullmatch(name) else ""


def _exam_name(doc, file_name: str) -> str:
    first_page_text = doc[0].get_text("text") if doc.page_count else ""
    for line in [item.strip() for item in first_page_text.splitlines()]:
        if line:
            return line[:80]
    stem = os.path.splitext(os.path.basename(file_name or ""))[0]
    stem = re.sub(r"[-_ ]*\d*班[-_ ]*学生成绩单$", "", stem).strip()
    return stem[:80]


def _detect_subject(text: str) -> str:
    hits = [(text.find(subject), subject) for subject in KNOWN_SUBJECTS if subject in text]
    return min(hits)[1] if hits else ""


def _full_marks(text: str) -> Optional[float]:
    match = FULL_MARKS_RE.search(text)
    if not match:
        return None
    value = float(match.group(1))
    return value if value > 0 else None


def parse_score_pdf(data: bytes, file_name: str = "") -> dict:
    """返回 {exam_name, subject, full_marks, page_count, rows, warnings}。"""
    if not data:
        raise DomainError("PDF 文件为空", code="pdf_empty")
    if len(data) > MAX_PDF_BYTES:
        raise DomainError("PDF 超过 20 MB，请拆分后再导入", status=413, code="pdf_too_large")
    if not data.startswith(b"%PDF-"):
        raise DomainError("文件不是有效的 PDF", code="pdf_invalid")

    fitz = _fit()
    try:
        doc = fitz.open(stream=io.BytesIO(data), filetype="pdf")
    except Exception:
        raise DomainError("PDF 无法打开，文件可能已损坏", code="pdf_invalid")

    try:
        if doc.needs_pass:
            raise DomainError("PDF 已加密，请先解除密码后再导入", code="pdf_encrypted")
        if doc.page_count > MAX_PAGES:
            raise DomainError("PDF 页数过多（超过 %d 页），请拆分后再导入" % MAX_PAGES, code="pdf_too_large")

        rows_out: List[dict] = []
        seen_names = set()
        for page in doc:
            rows = _rows(page)
            for index in range(len(rows) - 1):
                cells = rows[index]
                if len(cells) < 2 or "总分" not in cells:
                    continue
                total_index = cells.index("总分")
                if total_index == 0:
                    continue
                name = _clean_name(cells, total_index)
                if not name or name in ("题目", "班级平均分", "年级平均分"):
                    continue
                following = rows[index + 1]
                if len(following) < 2:
                    continue
                student_no = following[0].strip()
                total = _number(following[1])
                if not STUDENT_NO_RE.fullmatch(student_no) or total is None:
                    continue
                if total < 0 or total > 10000:
                    continue
                if name in seen_names:
                    raise DomainError("成绩单中姓名「%s」出现多次，无法唯一匹配" % name, code="pdf_duplicate_name")
                seen_names.add(name)
                rows_out.append({"name": name, "exam_no": student_no, "total": total})
                if len(rows_out) > MAX_STUDENTS:
                    raise DomainError("成绩单学生过多（超过 %d 人）" % MAX_STUDENTS, code="pdf_too_large")

        if not rows_out:
            raise DomainError(
                "PDF 中没有识别到「姓名 / 总分」成绩行。请确认是学校导出的学生成绩单（带文字层），而不是扫描图片。",
                code="pdf_no_records",
            )

        first_text = doc[0].get_text("text") if doc.page_count else ""
        exam_name = _exam_name(doc, file_name)
        subject = _detect_subject((file_name or "") + "\n" + first_text)
        warnings: List[str] = []
        if not subject:
            warnings.append("未能从 PDF 标题或文件名识别科目，将按「成绩」导入；可在导入前改名。")
        full_marks = _full_marks(first_text)
        return {
            "exam_name": exam_name,
            "subject": subject,
            "full_marks": full_marks,
            "page_count": doc.page_count,
            "rows": rows_out,
            "warnings": warnings,
        }
    finally:
        doc.close()
