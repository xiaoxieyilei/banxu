from __future__ import annotations

from app import updater


def test_version_compare_and_parse():
    assert updater.parse_version("v2.1.0") == (2, 1, 0)
    assert updater.is_newer("v2.2.0", "2.1.0")
    assert not updater.is_newer("v2.1.0", "2.1.0")
    assert not updater.is_newer("v2.0.9", "2.1.0")


def test_update_check_unconfigured(client, monkeypatch):
    monkeypatch.setattr(updater, "repo_slug", lambda: "")
    body = client.get("/api/update/check").json()
    assert body["configured"] is False
    assert body["available"] is False
    assert "update/check" not in str(body)  # 只返回提示，不暴露内部路径


def test_update_check_reports_new_release(client, monkeypatch):
    monkeypatch.setattr(updater, "repo_slug", lambda: "owner/repo")
    monkeypatch.setattr(updater, "current_version", lambda: "2.1.0")
    monkeypatch.setattr(
        updater,
        "fetch_latest",
        lambda repo: {
            "tag": "v2.2.0",
            "url": "https://github.com/owner/repo/releases/tag/v2.2.0",
            "notes": "新版本",
            "publishedAt": "2026-11-03T00:00:00Z",
            "zipball": "https://api.github.com/repos/owner/repo/zipball/v2.2.0",
            "kind": "release",
        },
    )
    updater._check_cache = {"at": 0.0, "data": None}
    body = client.get("/api/update/check?force=true").json()
    assert body["configured"] is True
    assert body["available"] is True
    assert body["latest"] == "v2.2.0"
    assert body["current"] == "2.1.0"


def test_apply_rejects_old_or_busy_version(client, monkeypatch):
    monkeypatch.setattr(updater, "repo_slug", lambda: "owner/repo")
    monkeypatch.setattr(updater, "current_version", lambda: "2.1.0")
    monkeypatch.setattr(
        updater,
        "_resolve_tag",
        lambda repo, tag: {
            "tag": tag,
            "url": "",
            "notes": "",
            "publishedAt": "",
            "zipball": "https://api.github.com/x.zip",
            "kind": "release",
        },
    )
    response = client.post("/api/update/apply", json={"tag": "v2.1.0"})
    assert response.status_code == 400
    assert response.json()["code"] == "update_not_newer"

    monkeypatch.setattr(updater, "status", lambda: {"phase": "building"})
    response = client.post("/api/update/apply", json={"tag": "v2.2.0"})
    assert response.status_code == 409
    assert response.json()["code"] == "update_busy"


def test_packaged_update_requires_platform_asset(client, monkeypatch):
    monkeypatch.setenv("BANXU_PACKAGED", "1")
    monkeypatch.setattr(updater, "repo_slug", lambda: "owner/repo")
    monkeypatch.setattr(updater, "current_version", lambda: "2.2.1")
    monkeypatch.setattr(updater.packaged_update, "asset_name", lambda: "banxu-macOS-arm64.zip")
    base = {
        "tag": "v2.2.2",
        "url": "https://github.com/owner/repo/releases/tag/v2.2.2",
        "notes": "",
        "publishedAt": "",
        "zipball": "https://api.github.com/x.zip",
        "kind": "release",
    }
    monkeypatch.setattr(updater, "fetch_latest", lambda repo: {**base, "assets": []})
    updater._check_cache = {"at": 0.0, "data": None}
    body = client.get("/api/update/check?force=true").json()
    assert body["packaged"] is True
    assert body["available"] is True
    assert body["applySupported"] is False

    monkeypatch.setattr(
        updater,
        "fetch_latest",
        lambda repo: {
            **base,
            "assets": [
                {"name": "banxu-macOS-arm64.zip", "browser_download_url": "https://github.com/x.zip"},
                {"name": "banxu-windows-x64.zip", "browser_download_url": "https://github.com/y.zip"},
            ],
        },
    )
    updater._check_cache = {"at": 0.0, "data": None}
    body = client.get("/api/update/check?force=true").json()
    assert body["applySupported"] is True
    assert body["assetName"] == "banxu-macOS-arm64.zip"
