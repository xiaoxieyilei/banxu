"""macOS/Windows 打包版入口：启动本地服务并打开浏览器。"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path


def data_dir() -> Path:
    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "班序"
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA") or Path.home())
        return base / "班序"
    return Path.home() / ".local" / "share" / "班序"


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def running(url: str) -> bool:
    try:
        with urllib.request.urlopen(url + "/api/health", timeout=1) as response:
            return response.status == 200
    except Exception:
        return False


def main() -> int:
    location = data_dir()
    location.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(location, 0o700)
    except OSError:
        pass

    os.environ.setdefault("BANXU_DB", str(location / "banxu.sqlite3"))
    os.environ.setdefault("BANXU_PASSWORD_FILE", str(location / ".password"))
    os.environ.setdefault("BANXU_DATA_DIR", str(location))
    os.environ.setdefault("BANXU_BACKUP_DIR", str(Path.home() / "Documents" / "班序备份（安装版）"))
    os.environ.setdefault("BANXU_PACKAGED", "1")
    # 桌面版只监听本机，本机浏览器无需再输入口令；手机访问不在此模式内
    os.environ.setdefault("BANXU_LOCAL_AUTO_LOGIN", "1")

    log = (location / "server.log").open("a", encoding="utf-8", buffering=1)
    sys.stdout = log
    sys.stderr = log

    if running("http://127.0.0.1:8000"):
        webbrowser.open("http://127.0.0.1:8000")
        return 0

    port = next((candidate for candidate in range(8000, 8020) if port_free(candidate)), 8000)
    url = "http://127.0.0.1:%d" % port
    threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))
    import uvicorn

    from app.main import create_app

    uvicorn.run(create_app(), host="127.0.0.1", port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
