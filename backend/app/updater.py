"""GitHub 自动更新：只从配置仓库的 Release/Tag 获取源码，下载后交给后台脚本应用。

安全边界：
- 仓库地址来自项目根目录 update.json（或 BANXU_UPDATE_REPO），前端不能指定任意 URL；
- 只接受 GitHub API 返回的该仓库 release/tag 与 zipball 地址；
- 下载后由 scripts/apply_update.py 保留 data/venv/node_modules，重新构建并重启服务。
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

from .domain import DomainError
from . import packaged_update

ROOT = Path(os.environ.get("BANXU_APP_ROOT", getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2])))
VERSION_FILE = ROOT / "VERSION"
CONFIG_FILE = ROOT / "update.json"
DATA_DIR = Path(os.environ.get("BANXU_DATA_DIR", str(ROOT / "backend" / "data")))
STATUS_FILE = DATA_DIR / "update-status.json"
UPDATE_LOG = DATA_DIR / "update.log"
CACHE_SECONDS = 300
MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024
REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
VERSION_RE = re.compile(r"^[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?")

_check_cache: dict = {"at": 0.0, "data": None}


def current_version() -> str:
    try:
        return VERSION_FILE.read_text(encoding="utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


def repo_slug() -> str:
    raw = os.environ.get("BANXU_UPDATE_REPO", "").strip()
    if not raw:
        try:
            raw = str(json.loads(CONFIG_FILE.read_text(encoding="utf-8")).get("repo", "")).strip()
        except (OSError, ValueError, AttributeError):
            raw = ""
    return raw if REPO_RE.fullmatch(raw) else ""


def parse_version(value: str) -> Optional[tuple]:
    match = VERSION_RE.match(str(value or "").strip())
    if not match:
        return None
    return tuple(int(part or 0) for part in match.groups())


def is_newer(latest: str, current: str) -> bool:
    left, right = parse_version(latest), parse_version(current)
    if left is None or right is None:
        return str(latest).lstrip("vV") != str(current).lstrip("vV")
    return left > right


def _github_json(url: str):
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "banxu-updater"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise DomainError("GitHub 请求失败（HTTP %s）" % error.code, status=502, code="update_network")
    except Exception as error:  # 网络/解析错误
        raise DomainError("无法连接 GitHub：%s" % error, status=502, code="update_network")


def fetch_latest(repo: str) -> Optional[dict]:
    """优先最新 Release；没有 Release 时回落到最新 Tag（适合刚建仓库）。"""
    release = _github_json("https://api.github.com/repos/%s/releases/latest" % repo)
    if release and release.get("tag_name"):
        return {
            "tag": str(release["tag_name"]),
            "url": str(release.get("html_url") or ""),
            "notes": str(release.get("body") or ""),
            "publishedAt": str(release.get("published_at") or ""),
            "zipball": str(release.get("zipball_url") or ""),
            "assets": release.get("assets") or [],
            "kind": "release",
        }
    tags = _github_json("https://api.github.com/repos/%s/tags?per_page=10" % repo)
    if tags:
        tag = str(tags[0].get("name") or "")
        if tag:
            return {
                "tag": tag,
                "url": "https://github.com/%s/tree/%s" % (repo, urllib.parse.quote(tag)),
                "notes": "",
                "publishedAt": "",
                "zipball": "https://api.github.com/repos/%s/zipball/%s" % (repo, urllib.parse.quote(tag)),
                "assets": [],
                "kind": "tag",
            }
    return None


def check_for_update(force: bool = False) -> dict:
    repo = repo_slug()
    current = current_version()
    packaged = os.environ.get("BANXU_PACKAGED") == "1"
    if not repo:
        return {
            "configured": False,
            "current": current,
            "available": False,
            "packaged": packaged,
            "applySupported": not packaged,
            "message": "尚未配置 GitHub 更新仓库（update.json 的 repo 为空）",
        }
    now = time.time()
    if not force and _check_cache["data"] and now - _check_cache["at"] < CACHE_SECONDS:
        return _check_cache["data"]
    latest = fetch_latest(repo)
    asset_name = packaged_update.asset_name()
    if latest is None:
        data = {
            "configured": True,
            "current": current,
            "available": False,
            "message": "仓库还没有 Release 或 Tag",
            "repo": repo,
            "packaged": packaged,
            "applySupported": False if packaged else True,
            "assetName": asset_name or None,
        }
    else:
        asset = packaged_update.asset_entry(latest, asset_name)
        data = {
            "configured": True,
            "current": current,
            "available": is_newer(latest["tag"], current),
            "latest": latest["tag"],
            "url": latest["url"],
            "notes": latest["notes"],
            "publishedAt": latest["publishedAt"],
            "kind": latest["kind"],
            "repo": repo,
            "packaged": packaged,
            "applySupported": (not packaged) or bool(asset),
            "assetName": asset_name or None,
        }
    _check_cache["at"] = now
    _check_cache["data"] = data
    return data


def _resolve_tag(repo: str, tag: str) -> dict:
    encoded = urllib.parse.quote(tag, safe="")
    release = _github_json("https://api.github.com/repos/%s/releases/tags/%s" % (repo, encoded))
    if release and str(release.get("tag_name")) == tag:
        return {
            "tag": tag,
            "url": str(release.get("html_url") or ""),
            "notes": str(release.get("body") or ""),
            "publishedAt": str(release.get("published_at") or ""),
            "zipball": str(release.get("zipball_url") or ""),
            "assets": release.get("assets") or [],
            "kind": "release",
        }
    tags = _github_json("https://api.github.com/repos/%s/tags?per_page=100" % repo)
    if any(str(item.get("name")) == tag for item in tags or []):
        return {
            "tag": tag,
            "url": "https://github.com/%s/tree/%s" % (repo, encoded),
            "notes": "",
            "publishedAt": "",
            "zipball": "https://api.github.com/repos/%s/zipball/%s" % (repo, encoded),
            "assets": [],
            "kind": "tag",
        }
    raise DomainError("该版本不存在或不属于配置的仓库", status=404, code="update_tag_missing")


def _write_status(**payload) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload.setdefault("updatedAt", time.strftime("%Y-%m-%dT%H:%M:%S"))
    temp = STATUS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(temp, 0o600)
    os.replace(temp, STATUS_FILE)


def status() -> dict:
    try:
        data = json.loads(STATUS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"phase": "idle"}
    except (OSError, ValueError):
        return {"phase": "idle"}


def server_bind(argv=None) -> tuple:
    """从 uvicorn 参数/环境变量里还原监听地址，更新后按同样地址重启。"""
    argv = list(sys.argv if argv is None else argv)
    host = os.environ.get("BANXU_HOST", "").strip()
    port = os.environ.get("PORT", "").strip() or os.environ.get("BANXU_PORT", "").strip()
    for index, item in enumerate(argv):
        if item == "--host" and index + 1 < len(argv):
            host = argv[index + 1]
        if item in ("--port", "-p") and index + 1 < len(argv):
            port = argv[index + 1]
    return host or "127.0.0.1", int(port or 8000)


def _allowed_zipball(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return parsed.scheme == "https" and parsed.hostname in {"api.github.com", "codeload.github.com", "github.com"}


def apply_update(tag: str, host: str, port: int, parent_pid: Optional[int] = None) -> dict:
    if os.environ.get("BANXU_PACKAGED") == "1":
        return packaged_update.apply(sys.modules[__name__], tag, host, port)
    repo = repo_slug()
    if not repo:
        raise DomainError("尚未配置 GitHub 更新仓库", status=400, code="update_unconfigured")
    current = current_version()
    if not tag or str(tag).strip() != tag or len(tag) > 120:
        raise DomainError("版本号不合法", code="update_tag_invalid")
    info = _resolve_tag(repo, tag)
    if not is_newer(info["tag"], current):
        raise DomainError("该版本不比当前版本新", status=400, code="update_not_newer")
    if not _allowed_zipball(info["zipball"]):
        raise DomainError("更新地址不在 GitHub 允许范围内", status=502, code="update_url_invalid")

    _write_status(phase="downloading", tag=info["tag"], current=current, message="正在下载更新…")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    safe_tag = re.sub(r"[^A-Za-z0-9_.-]", "_", info["tag"])
    archive = DATA_DIR / ("update-%s.zip" % safe_tag)
    request = urllib.request.Request(info["zipball"], headers={"User-Agent": "banxu-updater"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response, archive.open("wb") as handle:
            total = 0
            while True:
                chunk = response.read(1024 * 256)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_DOWNLOAD_BYTES:
                    raise DomainError("更新包超过 80 MB", status=413, code="update_too_large")
                handle.write(chunk)
    except DomainError:
        archive.unlink(missing_ok=True)
        _write_status(phase="error", message="更新包下载失败或过大")
        raise
    except Exception as error:
        archive.unlink(missing_ok=True)
        _write_status(phase="error", message="更新包下载失败：%s" % error)
        raise DomainError("更新包下载失败：%s" % error, status=502, code="update_network")
    try:
        os.chmod(archive, 0o600)
    except OSError:
        pass

    script = ROOT / "scripts" / "apply_update.py"
    if not script.is_file():
        raise DomainError("缺少 scripts/apply_update.py，无法应用更新", status=500, code="update_script_missing")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    log = UPDATE_LOG.open("ab")
    command = [
        sys.executable,
        str(script),
        "--zip", str(archive),
        "--tag", info["tag"],
        "--current", current,
        "--host", host,
        "--port", str(port),
        "--parent-pid", str(parent_pid or os.getpid()),
    ]
    subprocess.Popen(
        command,
        cwd=str(ROOT),
        stdout=log,
        stderr=log,
        start_new_session=True,
        close_fds=True,
        env={**os.environ, "BANXU_HOST": host, "PORT": str(port)},
    )
    _write_status(
        phase="applying",
        tag=info["tag"],
        current=current,
        message="正在安装更新并重新构建前端，完成后服务会自动重启…",
    )
    return {"ok": True, "tag": info["tag"], "status": status()}
