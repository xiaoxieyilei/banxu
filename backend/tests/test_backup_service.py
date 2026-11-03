from __future__ import annotations

from datetime import datetime

from app import backup_service


def test_next_run_at_before_and_after_2130():
    before = datetime(2026, 10, 28, 20, 0)
    after = datetime(2026, 10, 28, 22, 0)
    exact = datetime(2026, 10, 28, 21, 30)
    assert backup_service.next_run_at(before) == datetime(2026, 10, 28, 21, 30)
    assert backup_service.next_run_at(after) == datetime(2026, 10, 29, 21, 30)
    assert backup_service.next_run_at(exact) == datetime(2026, 10, 29, 21, 30)


def test_backup_filename_by_date():
    assert backup_service.backup_filename(datetime(2026, 10, 28, 21, 30)) == "班序备份-2026-10-28.json"


def test_write_backup_creates_directory_and_file(client, seeded, tmp_path, monkeypatch):
    target = tmp_path / "班序备份"
    monkeypatch.setenv("BANXU_BACKUP_DIR", str(target))
    result = backup_service.write_backup(client.app.state.connect(), datetime(2026, 10, 28, 21, 30))
    path = target / "班序备份-2026-10-28.json"
    assert path.exists()
    assert result["path"] == str(path)
    assert result["students"] == 3
    assert result["exams"] == 1
    import json

    saved = json.loads(path.read_text(encoding="utf-8"))
    assert len(saved["students"]) == 3
    assert saved["exams"][0]["name"] == "第一次周练"


def test_backup_api_exports_to_folder(client, seeded, tmp_path, monkeypatch):
    target = tmp_path / "备份"
    monkeypatch.setenv("BANXU_BACKUP_DIR", str(target))
    response = client.post("/api/backup/export")
    assert response.status_code == 200
    body = response.json()
    assert body["students"] == 3
    assert (target / ("班序备份-%s.json" % datetime.now().strftime("%Y-%m-%d"))).exists()


def test_write_backup_skips_when_data_unchanged(client, seeded, tmp_path, monkeypatch):
    target = tmp_path / "备份"
    monkeypatch.setenv("BANXU_BACKUP_DIR", str(target))
    first = backup_service.write_backup(client.app.state.connect(), datetime(2026, 10, 28, 21, 30))
    assert not first.get("skipped")

    second = backup_service.write_backup(client.app.state.connect(), datetime(2026, 10, 29, 21, 30))
    assert second["skipped"] is True
    assert second["path"] == first["path"]
    assert not (target / "班序备份-2026-10-29.json").exists()


def test_write_backup_runs_after_data_change(client, seeded, tmp_path, monkeypatch):
    target = tmp_path / "备份"
    monkeypatch.setenv("BANXU_BACKUP_DIR", str(target))
    backup_service.write_backup(client.app.state.connect(), datetime(2026, 10, 28, 21, 30))
    client.patch("/api/settings", json={"className": "高一(20)班"})

    result = backup_service.write_backup(client.app.state.connect(), datetime(2026, 10, 29, 21, 30))
    assert not result.get("skipped")
    assert result["path"] == str(target / "班序备份-2026-10-29.json")
    assert (target / "班序备份-2026-10-29.json").exists()


def test_write_backup_force_ignores_unchanged(client, seeded, tmp_path, monkeypatch):
    target = tmp_path / "备份"
    monkeypatch.setenv("BANXU_BACKUP_DIR", str(target))
    backup_service.write_backup(client.app.state.connect(), datetime(2026, 10, 28, 21, 30))
    result = backup_service.write_backup(client.app.state.connect(), datetime(2026, 10, 28, 22, 0), force=True)
    assert not result.get("skipped")
    assert result["path"] == str(target / "班序备份-2026-10-28.json")


def test_manual_export_always_writes(client, seeded, tmp_path, monkeypatch):
    target = tmp_path / "备份"
    monkeypatch.setenv("BANXU_BACKUP_DIR", str(target))
    assert client.post("/api/backup/export").status_code == 200
    response = client.post("/api/backup/export")
    assert response.status_code == 200
    assert response.json()["path"] == str(target / ("班序备份-%s.json" % datetime.now().strftime("%Y-%m-%d")))


def test_backup_status_reports_latest(client, seeded, tmp_path, monkeypatch):
    target = tmp_path / "备份"
    monkeypatch.setenv("BANXU_BACKUP_DIR", str(target))
    empty = client.get("/api/backup/status").json()
    assert empty["backupDir"] == str(target)
    assert empty["backupTime"] == "21:30"
    assert empty["lastBackupPath"] is None
    assert empty["pendingChanges"] is True
    assert empty["changeReason"] == "no_previous_backup"

    export = client.post("/api/backup/export").json()
    status = client.get("/api/backup/status").json()
    assert status["lastBackupPath"] == export["path"]
    assert status["lastBackupAt"]
    assert status["pendingChanges"] is False
    assert status["changeReason"] == "unchanged"

    client.patch("/api/settings", json={"className": "高一(20)班"})
    assert client.get("/api/backup/status").json()["pendingChanges"] is True
