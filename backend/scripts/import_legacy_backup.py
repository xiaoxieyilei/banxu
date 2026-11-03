#!/usr/bin/env python3
"""把旧版单文件（localStorage 结构）备份导入到新版前后端项目。

用法：
    backend/.venv/bin/python backend/scripts/import_legacy_backup.py 旧备份.json
    backend/.venv/bin/python backend/scripts/import_legacy_backup.py 旧备份.json --dry-run
    backend/.venv/bin/python backend/scripts/import_legacy_backup.py 旧备份.json --port 8000

需要新版后端已经启动（默认 http://127.0.0.1:8000）。
转换规则：version/className/extraRow 等旧字段映射到 settings；补 rows=7、callRange='single'；
违纪记录缺少 id/type 时用空 id 和“晚自习违纪”；旧格式里没有的字段用空值，不臆造数据。
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any, Dict, List

DEFAULT_TYPE = "晚自习违纪"
DEFAULT_CALL_RANGE = "single"


def normalise_date(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        return text
    # 旧版有 2026/10/21 这类写法
    parts = text.replace("/", "-").replace(".", "-").split("-")
    if len(parts) == 3 and all(part.isdigit() for part in parts):
        year, month, day = parts
        return "%04d-%02d-%02d" % (int(year), int(month), int(day))
    return text


def convert(legacy: Dict[str, Any]) -> Dict[str, Any]:
    if "settings" in legacy and "students" in legacy:
        raise SystemExit("这看起来已经是新版备份，请在软件里用“恢复备份”直接导入。")

    students: List[Dict[str, Any]] = [
        {
            "id": str(student.get("id", "")).strip(),
            "name": str(student.get("name", "")).strip(),
            "gender": str(student.get("gender", "") or "").strip(),
            "note": str(student.get("note", "") or "").strip(),
        }
        for student in legacy.get("students") or []
    ]

    exams: List[Dict[str, Any]] = []
    for exam in legacy.get("exams") or []:
        scores: Dict[str, Dict[str, Any]] = {}
        for student_id, per_subject in (exam.get("scores") or {}).items():
            scores[str(student_id)] = {
                str(subject): (None if value is None else float(value))
                for subject, value in (per_subject or {}).items()
            }
        ranks: Dict[str, Dict[str, Any]] = {}
        for student_id, per_subject in (exam.get("ranks") or {}).items():
            ranks[str(student_id)] = {
                str(subject): {
                    "school": rank.get("school"),
                    "class": rank.get("class", rank.get("class_rank")),
                }
                for subject, rank in (per_subject or {}).items()
            }
        exams.append(
            {
                "id": str(exam.get("id") or ""),
                "name": str(exam.get("name") or "未命名考试").strip(),
                "date": normalise_date(exam.get("date")),
                "subjects": [str(subject) for subject in exam.get("subjects") or []],
                "sourceFormat": str(exam.get("sourceFormat") or ""),
                "scores": scores,
                "ranks": ranks,
            }
        )
    # 只保留真正有成绩或排名的考试，避免空考试污染列表
    exams = [exam for exam in exams if exam["scores"] or exam["ranks"]]

    seats = {str(seat).strip(): str(student).strip() for seat, student in (legacy.get("seats") or {}).items()}

    discipline: Dict[str, List[Dict[str, Any]]] = {}
    for student_id, records in (legacy.get("discipline") or {}).items():
        converted = []
        for index, record in enumerate(records or []):
            converted.append(
                {
                    "id": "%s-%d" % (student_id, index),
                    "date": normalise_date(record.get("date")),
                    "type": str(record.get("type") or DEFAULT_TYPE),
                    "reason": str(record.get("reason") or ""),
                }
            )
        if converted:
            discipline[str(student_id).strip()] = converted

    settings = {
        "className": str(legacy.get("className") or "我的班级").strip(),
        "rows": int(legacy.get("rows") or 7),
        "extraRow": int(legacy.get("extraRow") or 5),
        "showScores": bool(legacy.get("showScores")),
        "examId": str(legacy.get("examId") or ""),
        "subject": str(legacy.get("subject") or "总分"),
        "callRange": str(legacy.get("callRange") or DEFAULT_CALL_RANGE),
        "callSubject": str(legacy.get("callSubject") or ""),
    }

    return {"settings": settings, "students": students, "exams": exams, "seats": seats, "discipline": discipline}


def main() -> int:
    parser = argparse.ArgumentParser(description="导入旧版班序备份到新版后端")
    parser.add_argument("backup", help="旧版导出的 JSON 备份路径")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--dry-run", action="store_true", help="只转换并打印统计，不写入")
    args = parser.parse_args()

    with open(args.backup, "r", encoding="utf-8") as handle:
        legacy = json.load(handle)

    state = convert(legacy)
    summary = "学生 %d 人 · 座位 %d 个 · 考试 %d 场 · 违纪记录 %d 条" % (
        len(state["students"]),
        len(state["seats"]),
        len(state["exams"]),
        sum(len(records) for records in state["discipline"].values()),
    )
    print("转换完成：" + summary)

    if args.dry_run:
        print("--dry-run：未写入后端")
        return 0

    url = "http://%s:%d/api/backup" % (args.host, args.port)
    body = json.dumps({"state": state}, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        print("导入失败（HTTP %s）：%s" % (error.code, detail), file=sys.stderr)
        return 1
    except urllib.error.URLError as error:
        print("连不上后端 %s：%s\n请先启动：./run.sh" % (url, error), file=sys.stderr)
        return 1

    print(
        "导入成功：学生 %d 人 · 座位 %d 个 · 考试 %d 场"
        % (len(result["students"]), len(result["seats"]), len(result["exams"]))
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
