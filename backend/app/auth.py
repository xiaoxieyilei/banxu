"""简单访问口令：首次启动自动生成，可用 BANXU_PASSWORD 覆盖。"""

from __future__ import annotations

import hmac
import os
import secrets
from pathlib import Path
from typing import Optional

from fastapi import Request

COOKIE_NAME = "banxu_auth"
PASSWORD_FILE = Path(
    os.environ.get("BANXU_PASSWORD_FILE", str(Path(__file__).resolve().parent.parent / "data" / ".password"))
).expanduser()
_cached_password: Optional[str] = None


def password() -> str:
    """访问口令：环境变量优先，其次 data/.password（不存在则生成 8 位随机口令）。"""
    global _cached_password
    if _cached_password:
        return _cached_password
    env = os.environ.get("BANXU_PASSWORD", "").strip()
    if env:
        _cached_password = env
        return env
    if PASSWORD_FILE.exists():
        saved = PASSWORD_FILE.read_text(encoding="utf-8").strip()
        if saved:
            try:
                os.chmod(PASSWORD_FILE, 0o600)
            except OSError:
                pass
            _cached_password = saved
            return saved
    PASSWORD_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz23456789") for _ in range(8))
    PASSWORD_FILE.write_text(generated, encoding="utf-8")
    try:
        os.chmod(PASSWORD_FILE, 0o600)
    except OSError:
        pass
    _cached_password = generated
    return generated


def token() -> str:
    """登录 Cookie 中的令牌（口令的 HMAC，避免明文放 Cookie）。"""
    return hmac.new(password().encode("utf-8"), b"banxu-auth-token", "sha256").hexdigest()


def authenticated(request: Request) -> bool:
    # 桌面打包版只监听 127.0.0.1 时自动放行本机浏览器；手机访问仍必须口令
    if os.environ.get("BANXU_LOCAL_AUTO_LOGIN") == "1" and request.client is not None:
        if request.client.host in ("127.0.0.1", "::1"):
            return True
    cookie = request.cookies.get(COOKIE_NAME, "")
    if cookie and hmac.compare_digest(cookie, token()):
        return True
    header = request.headers.get("authorization", "")
    if header.startswith("Bearer "):
        supplied = header[7:].strip()
        # 允许直接使用口令（方便 curl / 自动化任务）
        return hmac.compare_digest(supplied, password()) or hmac.compare_digest(supplied, token())
    return False


def check_password(candidate: str) -> bool:
    return hmac.compare_digest(candidate or "", password())
