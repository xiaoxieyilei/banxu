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


def app_version() -> str:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
    try:
        return (base / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def health(url: str) -> dict:
    try:
        with urllib.request.urlopen(url + "/api/health", timeout=1) as response:
            if response.status != 200:
                return {}
            import json
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        return {}


def main() -> int:
    location = data_dir()
    location.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(location, 0o700)
    except OSError:
        pass

    if not getattr(sys, "frozen", False):
        # 手工/嵌入式运行时包：应用根目录就是 launcher.py 所在目录
        root = Path(__file__).resolve().parent
        os.environ.setdefault("BANXU_APP_ROOT", str(root))
        os.environ.setdefault("BANXU_PACKAGED_APP_ROOT", str(root))
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

    version = app_version()
    existing = health("http://127.0.0.1:8000")
    if existing and existing.get("version") == version:
        webbrowser.open("http://127.0.0.1:8000")
        return 0
    if existing:
        # 8000 被旧版服务占用时，不能直接打开旧版页面；在新的端口启动当前版本
        print("端口 8000 上运行的是旧版本 %s，当前启动版本 %s" % (existing.get("version"), version))
    port = next((candidate for candidate in range(8000, 8020) if port_free(candidate)), 8000)
    url = "http://127.0.0.1:%d" % port
    if os.environ.get("BANXU_NO_BROWSER") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))
    import uvicorn

    from app.main import create_app

    uvicorn.run(create_app(), host="127.0.0.1", port=port, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
