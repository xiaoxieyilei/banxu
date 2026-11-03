from __future__ import annotations

from fastapi.testclient import TestClient

from app import auth
from app.main import create_app


def _anonymous_client(tmp_path):
    app = create_app(str(tmp_path / "auth.sqlite3"))
    return TestClient(app)


def test_api_requires_password(tmp_path):
    client = _anonymous_client(tmp_path)
    assert client.get("/api/state").status_code == 401
    status = client.get("/api/auth/status").json()
    assert status == {"required": True, "authenticated": False}
    assert client.get("/api/health").status_code == 200


def test_login_with_wrong_password(tmp_path):
    client = _anonymous_client(tmp_path)
    response = client.post("/api/login", json={"password": "nope"})
    assert response.status_code == 401
    assert response.json()["code"] == "bad_password"
    assert client.get("/api/state").status_code == 401


def test_login_sets_cookie_and_unlocks(tmp_path):
    client = _anonymous_client(tmp_path)
    assert client.post("/api/login", json={"password": "test-pass"}).status_code == 200
    assert client.get("/api/auth/status").json()["authenticated"] is True
    assert client.get("/api/state").status_code == 200
    assert client.post("/api/logout").status_code == 200
    assert client.get("/api/state").status_code == 401


def test_bearer_password_works_for_automation(tmp_path):
    client = _anonymous_client(tmp_path)
    response = client.get("/api/state", headers={"Authorization": "Bearer test-pass"})
    assert response.status_code == 200


def test_password_file_generated_when_env_missing(tmp_path, monkeypatch):
    monkeypatch.delenv("BANXU_PASSWORD", raising=False)
    monkeypatch.setattr(auth, "PASSWORD_FILE", tmp_path / ".password")
    auth._cached_password = None
    generated = auth.password()
    assert len(generated) == 8
    assert (tmp_path / ".password").read_text(encoding="utf-8") == generated
    auth._cached_password = None
