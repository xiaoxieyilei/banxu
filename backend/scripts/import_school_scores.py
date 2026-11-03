#!/usr/bin/env python3
"""把学校网站下载的“班级全学科成绩简表”导入新版后端。

用法：
    backend/.venv/bin/python backend/scripts/import_school_scores.py 成绩表.xlsx --name "2026年10月11日周练"
    ... --date 2026-10-11      # 省略时从文件名里的 8 位日期推断
    ... --dry-run               # 只解析并统计，不写入
    ... --select                # 导入后把这场考试设为当前考试并打开成绩显示

表结构约定（与学校导出保持一致）：第 2 行是科目名，第 3 行是“得分/校次/班次”，
第 4 行起是学生；姓名需与软件内名单一致（同名会被拒绝，需先处理重名）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

try:
    import openpyxl
except ImportError:  # pragma: no cover
    raise SystemExit("缺少 openpyxl，请先安装：backend/.venv/bin/pip install openpyxl")

EMPTY_MARKS = {"", "缺考", "未考", "未录入", "免考", "—", "-", "未扫，不计排名"}


def to_number(value: Any) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip().replace(",", "")
    if text in EMPTY_MARKS:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def find_header_row(rows: List[Tuple[Any, ...]]) -> Tuple[int, int, bool]:
    """返回 (表头行下标, 得分标记行下标, 是否单行表头)。

    两种学校导出格式：
    1) 两行表头：第 N 行科目、第 N+1 行“得分/校次/班次”；
    2) 单科成绩表：第 N 行表头本身含“得分/校次/班次”（科目名在文件名或工作表名里）。
    """
    for index, row in enumerate(rows[:4]):
        cells = [str(cell).strip() if cell is not None else "" for cell in row]
        if "序号" not in cells or not ("姓名" in cells or "准考证号" in cells):
            continue
        if "得分" in cells or "总分" in cells:
            return index, index, True
        for offset in (1, 2):
            if index + offset < len(rows):
                next_cells = [str(cell).strip() if cell is not None else "" for cell in rows[index + offset]]
                if "得分" in next_cells:
                    return index, index + offset, False
    raise SystemExit("没找到“序号/姓名/得分”表头，请确认这是学校导出的成绩表")


def guess_subject(workbook_path: str, sheet_name: str, fallback: str) -> str:
    subjects = ["语文", "数学", "英语", "物理", "化学", "生物", "政治", "历史", "地理", "技术"]
    name = workbook_path.split("/")[-1]
    brackets = re.findall(r"[（(]([^）)]+)[）)]", name)
    for chunk in reversed(brackets):
        for subject in subjects:
            if subject in chunk:
                return subject
    for subject in subjects:
        if subject in name:
            return subject
    for subject in subjects:
        if "班级%s" % subject in sheet_name:
            return subject
    return fallback


def parse(workbook_path: str) -> Dict[str, Any]:
    workbook = openpyxl.load_workbook(workbook_path, data_only=True)
    names = workbook.sheetnames
    preferred = (
        [name for name in names if re.search(r"班级.*成绩简表", name)]
        or [name for name in names if "汇总" in name]
        or names[:1]
    )
    sheet = workbook[preferred[0]]
    rows = list(sheet.values)
    header_row, score_row, single_row = find_header_row(rows)
    subjects_row = [str(cell).strip() if cell is not None else "" for cell in rows[header_row]]
    marks_row = [str(cell).strip() if cell is not None else "" for cell in rows[score_row]]

    columns: List[Dict[str, Any]] = []
    if single_row:
        subject = guess_subject(workbook_path, sheet.title, "成绩")
        score_index = marks_row.index("得分") if "得分" in marks_row else marks_row.index("总分")
        school_index = marks_row.index("校次") if "校次" in marks_row else None
        class_index = marks_row.index("班次") if "班次" in marks_row else None
        columns.append({"name": subject, "score": score_index, "school": school_index, "klass": class_index})
    else:
        current_subject = ""
        for index, subject in enumerate(subjects_row):
            if subject:
                current_subject = "总分" if subject in {"总成绩", "合计"} else subject
            mark = marks_row[index] if index < len(marks_row) else ""
            if not current_subject or not mark:
                continue
            if mark == "得分":
                columns.append({"name": current_subject, "score": index, "school": None, "klass": None})
            elif mark in {"校次", "校次进退步"} and columns:
                columns[-1]["school"] = index
            elif mark in {"班次", "班次进退步"} and columns:
                columns[-1]["klass"] = index

    name_col = subjects_row.index("姓名") if "姓名" in subjects_row else -1
    if name_col < 0:
        raise SystemExit("成绩表缺少“姓名”列")
    if not columns:
        raise SystemExit("没有解析到任何科目列")

    records: List[Dict[str, Any]] = []
    for row in rows[score_row + 1:]:
        name = str(row[name_col]).strip() if row[name_col] is not None else ""
        if not name:
            continue
        scores: Dict[str, Optional[float]] = {}
        ranks: Dict[str, Dict[str, Optional[int]]] = {}
        for column in columns:
            scores[column["name"]] = to_number(row[column["score"]])
            school = to_number(row[column["school"]]) if column["school"] is not None else None
            klass = to_number(row[column["klass"]]) if column["klass"] is not None else None
            if school is not None or klass is not None:
                ranks[column["name"]] = {
                    "school": int(school) if school else None,
                    "class": int(klass) if klass else None,
                }
        records.append({"name": name, "scores": scores, "ranks": ranks})
    subjects = [column["name"] for column in columns]
    if single_row and "总分" not in subjects:
        pass  # 单科成绩表本身即单科，不生成“总分”列
    return {"subjects": subjects, "records": records, "singleRow": single_row}


def main() -> int:
    parser = argparse.ArgumentParser(description="导入学校全学科成绩表")
    parser.add_argument("workbook")
    parser.add_argument("--name", help="考试名称，默认从文件名生成")
    parser.add_argument("--date", help="考试日期 YYYY-MM-DD，默认从文件名推断")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--select", action="store_true", help="导入后设为当前考试并显示成绩")
    args = parser.parse_args()

    parsed = parse(args.workbook)
    filename = args.workbook.split("/")[-1]
    match = re.search(r"(20\d{2})(\d{2})(\d{2})", filename)
    date = args.date or ("%s-%s-%s" % match.groups() if match else "")
    if not date:
        raise SystemExit("无法从文件名推断日期，请用 --date 指定")
    name = args.name or "%s年%s月%s日周练" % (int(match.group(1)), int(match.group(2)), int(match.group(3))) if match else "周练"

    base = "http://%s:%d" % (args.host, args.port)
    with urllib.request.urlopen(base + "/api/state", timeout=10) as response:
        state = json.loads(response.read().decode("utf-8"))
    by_name: Dict[str, List[str]] = {}
    for student in state["students"]:
        by_name.setdefault(student["name"], []).append(student["id"])

    scores: Dict[str, Dict[str, Any]] = {}
    ranks: Dict[str, Dict[str, Any]] = {}
    missing: List[str] = []
    ambiguous: List[str] = []
    for record in parsed["records"]:
        ids = by_name.get(record["name"], [])
        if not ids:
            missing.append(record["name"])
            continue
        if len(ids) > 1:
            ambiguous.append(record["name"])
            continue
        scores[ids[0]] = record["scores"]
        if record["ranks"]:
            ranks[ids[0]] = record["ranks"]

    print("科目：%s" % "、".join(parsed["subjects"]))
    print("匹配学生 %d 人（表内 %d 行）" % (len(scores), len(parsed["records"])))
    if missing:
        print("未在名单中找到：%s" % "、".join(missing))
    if ambiguous:
        print("名单重名，需先处理：%s" % "、".join(ambiguous))
    if not scores:
        return 1

    if args.dry_run:
        print("--dry-run：未写入后端（考试名称=%s，日期=%s）" % (name, date))
        return 0

    payload = {
        "name": name,
        "date": date,
        "subjects": parsed["subjects"],
        "scores": scores,
        "ranks": ranks,
        "sourceFormat": "学校成绩汇总表",
    }
    request = urllib.request.Request(
        base + "/api/exams",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        print("导入失败（HTTP %s）：%s" % (error.code, error.read().decode("utf-8", "replace")), file=sys.stderr)
        return 1

    created = [exam for exam in result["exams"] if exam["name"] == name and exam["date"] == date]
    print("已导入考试：%s（%s），共 %d 场考试" % (name, date, len(result["exams"])))
    if args.select and created:
        exam_id = created[0]["id"]
        patch = {"examId": exam_id, "subject": "总分" if "总分" in parsed["subjects"] else parsed["subjects"][0], "showScores": True}
        request = urllib.request.Request(
            base + "/api/settings",
            data=json.dumps(patch, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="PATCH",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            response.read()
        print("已设为当前考试，并打开成绩显示")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
