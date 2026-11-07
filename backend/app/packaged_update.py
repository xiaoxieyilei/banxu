"""安装包版自更新：下载 GitHub Release 中的平台安装包，替换自身并重启。

数据目录（Application Support / APPDATA / XDG）在应用包之外，因此替换应用不会
移动学生数据，也不需要手动迁移备份。
"""
from __future__ import annotations

import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional

from .domain import DomainError

MAX_DOWNLOAD_BYTES = 320 * 1024 * 1024


def asset_name() -> str:
    if sys.platform == "darwin":
        return "banxu-macOS-arm64.zip" if platform.machine().lower() in {"arm64", "aarch64"} else ""
    if os.name == "nt":
        return "banxu-windows-x64.zip"
    return "banxu-linux-x64.tar.gz"


def asset_entry(info: Optional[dict], name: str) -> Optional[dict]:
    if not info or not name:
        return None
    for item in info.get("assets") or []:
        if isinstance(item, dict) and item.get("name") == name:
            return item
    return None


def allowed_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and (
        host in {"github.com", "api.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"}
        or host.endswith(".github.com")
        or host.endswith(".githubusercontent.com")
    )


def app_path() -> Path:
    configured = os.environ.get("BANXU_PACKAGED_APP_ROOT", "").strip()
    if configured:
        return Path(configured).resolve()
    executable = Path(sys.executable).resolve()
    if sys.platform == "darwin":
        for parent in executable.parents:
            if parent.suffix == ".app":
                return parent
    return executable.parent


def download(url: str, destination: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "banxu-updater"})
    try:
        with urllib.request.urlopen(request, timeout=180) as response, destination.open("wb") as handle:
            total = 0
            while True:
                chunk = response.read(1024 * 256)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_DOWNLOAD_BYTES:
                    raise DomainError("安装包超过 320 MB", status=413, code="update_too_large")
                handle.write(chunk)
    except DomainError:
        destination.unlink(missing_ok=True)
        raise
    except Exception as error:
        destination.unlink(missing_ok=True)
        raise DomainError("安装包下载失败：%s" % error, status=502, code="update_network")
    try:
        destination.chmod(0o600)
    except OSError:
        pass


def extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    try:
        if sys.platform == "darwin":
            result = subprocess.run(
                ["/usr/bin/ditto", "-x", "-k", str(archive), str(destination)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=180,
            )
            if result.returncode != 0:
                raise RuntimeError(result.stderr.decode("utf-8", "replace")[:300])
        elif archive.suffix == ".zip":
            with zipfile.ZipFile(archive) as bundle:
                bundle.extractall(destination)
        else:
            with tarfile.open(archive, "r:gz") as bundle:
                bundle.extractall(destination)
    except Exception as error:
        raise DomainError("安装包解压失败：%s" % error, status=500, code="update_extract")


def new_app(extract_dir: Path) -> Path:
    if sys.platform == "darwin":
        candidates = sorted(extract_dir.rglob("*.app"))
        if not candidates:
            raise DomainError("安装包里没有找到 .app", status=500, code="update_package_invalid")
        return candidates[0]
    if sys.platform.startswith("linux") and (extract_dir / "banxu").is_dir():
        return extract_dir / "banxu"
    return extract_dir


def version_of(app: Path) -> str:
    candidates = list(app.rglob("VERSION")) if sys.platform == "darwin" else [app / "VERSION"]
    for candidate in candidates:
        try:
            value = candidate.read_text(encoding="utf-8").strip()
            if value:
                return value
        except OSError:
            pass
    return ""


def write_helper(updater, tag: str, current: str, old: Path, new: Path, extract_dir: Path) -> Path:
    status = updater.STATUS_FILE
    if os.name == "nt":
        helper = updater.DATA_DIR / "apply-packaged-update.ps1"
        helper.write_text(r'''$ErrorActionPreference = "Stop"
$old = $env:BANXU_OLD_APP
$new = $env:BANXU_NEW_APP
$backup = "$old.banxu-old"
$status = $env:BANXU_STATUS
$tag = $env:BANXU_TAG
$current = $env:BANXU_CURRENT
function Write-State([string]$phase, [string]$message) {
    $now = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss")
    $json = @{phase=$phase; message=$message; tag=$tag; current=$current; updatedAt=$now} | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($status, $json)
}
try {
    Wait-Process -Id ([int]$env:BANXU_OLD_PID) -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }
    Rename-Item -LiteralPath $old -NewName (Split-Path -Leaf $backup)
    Move-Item -LiteralPath $new -Destination $old
    Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $env:BANXU_EXTRACT_DIR -Recurse -Force -ErrorAction SilentlyContinue
    Write-State "done" "更新完成，正在重启"
    $env:BANXU_NO_BROWSER = "1"
    if ($env:BANXU_LAUNCH_KIND -eq "exe") {
        Start-Process -FilePath (Join-Path $old "banxu.exe")
    } else {
        Start-Process -FilePath (Join-Path $old "runtime\pythonw.exe") -ArgumentList "launcher.py" -WorkingDirectory $old
    }
} catch {
    Write-State "error" ("自动更新失败：" + $_.Exception.Message)
    if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $old)) {
        Rename-Item -LiteralPath $backup -NewName (Split-Path -Leaf $old)
    }
    if ($env:BANXU_LAUNCH_KIND -eq "exe") {
        Start-Process -FilePath (Join-Path $old "banxu.exe")
    } else {
        Start-Process -FilePath (Join-Path $old "runtime\pythonw.exe") -ArgumentList "launcher.py" -WorkingDirectory $old
    }
}
''', encoding="utf-8")
        return helper

    helper = updater.DATA_DIR / "apply-packaged-update.sh"
    helper.write_text('''#!/bin/sh
set -u
OLD="$BANXU_OLD_APP"
NEW="$BANXU_NEW_APP"
BACKUP="${OLD}.banxu-old"
STATUS="$BANXU_STATUS"
TAG="$BANXU_TAG"
CURRENT="$BANXU_CURRENT"
export BANXU_NO_BROWSER=1
write_state() {
    printf '{"phase":"%s","message":"%s","tag":"%s","current":"%s","updatedAt":"%s"}\\n' \\
        "$1" "$2" "$TAG" "$CURRENT" "$(date +%Y-%m-%dT%H:%M:%S)" > "${STATUS}.tmp"
    mv "${STATUS}.tmp" "$STATUS"
}
launch_old() {
    if [ "$(uname -s)" = "Darwin" ]; then
        /usr/bin/open "$OLD" >/dev/null 2>&1 || true
    elif [ "$BANXU_LAUNCH_KIND" = "exe" ]; then
        nohup "$OLD/banxu" >/dev/null 2>&1 &
    else
        nohup /bin/sh "$OLD/启动班序.sh" >/dev/null 2>&1 &
    fi
}
while kill -0 "$BANXU_OLD_PID" 2>/dev/null; do sleep 0.5; done
sleep 2
if [ -e "$BACKUP" ]; then rm -r "$BACKUP" 2>/dev/null || true; fi
if mv "$OLD" "$BACKUP" && mv "$NEW" "$OLD"; then
    rm -r "$BACKUP" 2>/dev/null || true
    rm -r "$BANXU_EXTRACT_DIR" 2>/dev/null || true
    if [ "$(uname -s)" = "Darwin" ]; then
        xattr -dr com.apple.quarantine "$OLD" >/dev/null 2>&1 || true
    fi
    write_state done "更新完成，正在重启"
    launch_old
else
    if [ -e "$OLD" ]; then rm -r "$OLD" 2>/dev/null || true; fi
    [ -d "$BACKUP" ] && mv "$BACKUP" "$OLD" 2>/dev/null || true
    write_state error "自动更新失败，已恢复旧版本"
    launch_old
fi
''', encoding="utf-8")
    helper.chmod(0o700)
    return helper


def apply(updater, tag: str, host: str, port: int) -> dict:
    repo = updater.repo_slug()
    if not repo:
        raise DomainError("尚未配置 GitHub 更新仓库", status=400, code="update_unconfigured")
    current = updater.current_version()
    if not tag or str(tag).strip() != tag or len(tag) > 120:
        raise DomainError("版本号不合法", code="update_tag_invalid")
    info = updater._resolve_tag(repo, tag)
    if not updater.is_newer(info["tag"], current):
        raise DomainError("该版本不比当前版本新", status=400, code="update_not_newer")
    name = asset_name()
    asset = asset_entry(info, name)
    if not name or not asset:
        raise DomainError("该 Release 没有当前平台的安装包", status=400, code="update_asset_missing")
    url = str(asset.get("browser_download_url") or "")
    if not allowed_url(url):
        raise DomainError("安装包地址不在 GitHub 允许范围内", status=502, code="update_url_invalid")

    updater._write_status(phase="downloading", tag=info["tag"], current=current, message="正在下载新安装包…")
    updater.DATA_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", info["tag"])
    archive = updater.DATA_DIR / ("package-%s%s" % (safe, ".tar.gz" if name.endswith(".tar.gz") else ".zip"))
    download(url, archive)
    extract_dir = updater.DATA_DIR / ("extract-%s" % safe)
    shutil.rmtree(extract_dir, ignore_errors=True)
    updater._write_status(phase="applying", tag=info["tag"], current=current, message="正在解压安装包…")
    extract(archive, extract_dir)
    candidate = new_app(extract_dir)
    installed_version = version_of(candidate)
    expected = info["tag"].lstrip("vV")
    if installed_version != expected:
        raise DomainError("安装包版本校验失败（%s）" % (installed_version or "缺少 VERSION"), code="update_package_invalid")
    old = app_path()
    if not old.exists():
        raise DomainError("找不到当前应用目录，无法自动替换", status=500, code="update_app_missing")

    launch_kind = "app" if sys.platform == "darwin" else (
        "exe" if (old / ("banxu.exe" if os.name == "nt" else "banxu")).exists() else "script"
    )
    helper = write_helper(updater, info["tag"], current, old, candidate, extract_dir)
    updater._write_status(phase="restarting", tag=info["tag"], current=current, message="正在替换应用并重启…")
    log = updater.UPDATE_LOG.open("ab")
    env = {
        **os.environ,
        "BANXU_OLD_APP": str(old),
        "BANXU_NEW_APP": str(candidate),
        "BANXU_EXTRACT_DIR": str(extract_dir),
        "BANXU_STATUS": str(updater.STATUS_FILE),
        "BANXU_TAG": info["tag"],
        "BANXU_CURRENT": current,
        "BANXU_OLD_PID": str(os.getpid()),
        "BANXU_LAUNCH_KIND": launch_kind,
    }
    command = (
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(helper)]
        if os.name == "nt"
        else ["/bin/sh", str(helper)]
    )
    subprocess.Popen(
        command,
        cwd=str(updater.DATA_DIR),
        stdout=log,
        stderr=log,
        start_new_session=True,
        close_fds=True,
        env=env,
    )
    threading.Timer(2.0, lambda: os._exit(0)).start()
    return {"ok": True, "tag": info["tag"], "status": updater.status()}
