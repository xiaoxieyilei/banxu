from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import auth  # noqa: E402
from app.main import create_app  # noqa: E402

os.environ["BANXU_PASSWORD"] = "test-pass"
# 测试不写用户目录里的真实备份
os.environ.setdefault("BANXU_BACKUP_ON_START", "0")
os.environ.setdefault("BANXU_BACKUP_ON_IMPORT", "0")
auth._cached_password = None
TEST_PASSWORD = "test-pass"


@pytest.fixture()
def client(tmp_path):
    db_path = tmp_path / "test.sqlite3"
    app = create_app(str(db_path))
    with TestClient(app, headers={"Authorization": "Bearer " + TEST_PASSWORD}) as test_client:
        yield test_client


@pytest.fixture()
def seeded(client):
    """三个学生 + 一份成绩，供后续用例复用。"""
    client.post(
        "/api/roster/import",
        json={
            "records": [
                {"id": "001", "name": "张三", "gender": "男"},
                {"id": "002", "name": "李四", "gender": "女"},
                {"id": "003", "name": "王五", "gender": "男"},
            ]
        },
    )
    client.post(
        "/api/exams",
        json={
            "name": "第一次周练",
            "date": "2026-10-11",
            "subjects": ["语文", "数学", "总分"],
            "scores": {
                "001": {"语文": 90, "数学": 80, "总分": 170},
                "002": {"语文": 70, "数学": 60, "总分": 130},
                "003": {"语文": None, "数学": 100, "总分": None},
            },
            "ranks": {"001": {"总分": {"school": 3, "class": 1}}},
        },
    )
    return client
