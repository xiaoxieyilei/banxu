#!/usr/bin/env python3
"""由 /api/update/apply 启动的后台更新器：解压、备份源码、安装依赖、构建、重启服务。

保留用户数据：backend/data、backend/.venv、frontend/node_modules、backups、.git、update.json。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATUS_FILE = ROOT / "backend" / "data" / "update-status.json"
DATA_DIR = ROOT / "backend" / "data"
PROTECTED_NAMES = {
    "data",
    ".venv",
    "node_modules",
    ".git",
    "backups",
    ".npm-cache",
    "dist",
    "__pycache__",
    ".DS_Store",
    "update.json",
    "update-status.json",
}


def write_status(**payload) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload.setdefault("updatedAt", time.strftime("%Y-%m-%dT%H:%M:%S"))
    temporary = STATUS_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, STATUS_FILE)


def log(message: str) -> None:
    print("[%s] %s" % (time.strftime("%H:%M:%S"), message), flush=True)


def run(command, cwd: Path, timeout: int) -> None:
    log("$ " + " ".join(str(item) for item in command))
    subprocess.run(command, cwd=str(cwd), check=True, timeout=timeout)


def extract_archive(archive: Path) -> tuple:
    temp = Path(tempfile.mkdtemp(prefix="banxu-update-"))
    try:
        with zipfile.ZipFile(archive) as bundle:
            root = temp.resolve()
            for name in bundle.namelist():
                target = (temp / name).resolve()
                if target != root and root not in target.parents:
                    raise RuntimeError("更新包含非法路径：%s" % name)
            bundle.extractall(temp)
        entries = [entry for entry in temp.iterdir() if entry.is_dir()]
        source = entries[0] if len(entries) == 1 else temp
        for required in ("backend/app/main.py", "frontend/package.json", "VERSION"):
            if not (source / required).is_file():
                raise RuntimeError("更新包缺少 %s" % required)
        return source, temp
    except Exception:
        shutil.rmtree(temp, ignore_errors=True)
        raise


def backup_source() -> Path:
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target = ROOT / "backups" / ("update-%s" % stamp)
    target.mkdir(parents=True, exist_ok=True)
    for name in (
        "backend/app",
        "backend/tests",
        "backend/requirements.txt",
        "backend/requirements-dev.txt",
        "backend/scripts",
        "frontend/src",
        "frontend/index.html",
        "frontend/package.json",
        "frontend/package-lock.json",
        "frontend/scripts",
        "frontend/tests",
        "frontend/public",
        "scripts",
        "run.sh",
        "启动班序.command",
        "启动班序（手机访问）.command",
        "README.md",
        "LICENSE",
        "VERSION",
        "update.json",
        "docs",
    ):
        source = ROOT / name
        destination = target / name
        try:
            if source.is_dir():
                shutil.copytree(source, destination, dirs_exist_ok=True)
            elif source.is_file():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
        except OSError as error:
            log("备份 %s 失败：%s" % (name, error))
    return target


def restore_source(backup: Path) -> None:
    for entry in backup.iterdir():
        target = ROOT / entry.name
        if entry.is_dir():
            shutil.copytree(entry, target, dirs_exist_ok=True)
        else:
            shutil.copy2(entry, target)


def ignore_source(directory: str, names):
    return [name for name in names if name in PROTECTED_NAMES or name.endswith(".pyc")]


def copy_source(source: Path) -> None:
    shutil.copytree(source, ROOT, dirs_exist_ok=True, ignore=ignore_source)


def wait_health(port: int, timeout: int = 45) -> bool:
    deadline = time.time() + timeout
    url = "http://127.0.0.1:%d/api/health" % port
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def wait_pid(pid: int, timeout: int = 15) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            return
        time.sleep(0.25)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--parent-pid", type=int, required=True)
    args = parser.parse_args()

    archive = Path(args.zip)
    extracted_parent = None
    backup = None
    try:
        write_status(phase="applying", message="正在解压更新包…", tag=args.tag, current=args.current)
        source, extracted_parent = extract_archive(archive)
        new_version = (source / "VERSION").read_text(encoding="utf-8").strip()
        if not new_version:
            raise RuntimeError("更新包 VERSION 为空")
        log("准备更新 %s -> %s" % (args.current, new_version))
        write_status(phase="applying", message="正在备份当前源码…", tag=args.tag, current=args.current)
        backup = backup_source()
        write_status(phase="applying", message="正在替换源码…", tag=args.tag, current=args.current)
        copy_source(source)
        (ROOT / "VERSION").write_text(new_version + "\n", encoding="utf-8")

        python = ROOT / "backend" / ".venv" / "bin" / "python"
        if python.exists():
            write_status(phase="installing", message="正在安装后端依赖…", tag=args.tag, current=args.current)
            run([str(python), "-m", "pip", "install", "-q", "-r", "backend/requirements.txt"], ROOT, 900)
        else:
            raise RuntimeError("缺少 backend/.venv，请先运行一次 ./run.sh")

        npm = shutil.which("npm")
        if not npm:
            raise RuntimeError("找不到 npm，无法构建前端")
        write_status(phase="building", message="正在安装前端依赖并构建…", tag=args.tag, current=args.current)
        run([npm, "install", "--no-audit", "--no-fund"], ROOT / "frontend", 900)
        run([npm, "run", "build"], ROOT / "frontend", 900)

        write_status(phase="restarting", message="正在重启服务…", tag=args.tag, current=args.current)
        supervised = bool(os.environ.get("XPC_SERVICE_NAME") or os.environ.get("LAUNCH_JOB_LABEL"))
        try:
            os.kill(args.parent_pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        wait_pid(args.parent_pid)
        if not wait_health(args.port, 20):
            if supervised:
                # launchd 会按 KeepAlive 自动拉起；再等一轮
                pass
            else:
                env = {
                    **os.environ,
                    "BANXU_HOST": args.host,
                    "PORT": str(args.port),
                }
                server_log = DATA_DIR / "update-server.log"
                DATA_DIR.mkdir(parents=True, exist_ok=True)
                handle = server_log.open("ab")
                subprocess.Popen(
                    ["/bin/bash", str(ROOT / "scripts" / "start-server.sh")],
                    cwd=str(ROOT),
                    stdout=handle,
                    stderr=handle,
                    start_new_session=True,
                    close_fds=True,
                    env=env,
                )
        if not wait_health(args.port, 60):
            raise RuntimeError("服务重启后未通过健康检查，请查看 backend/data/update-server.log")
        write_status(phase="done", message="更新完成，服务已重启", tag=args.tag, current=new_version)
        log("更新完成：%s" % new_version)
        archive.unlink(missing_ok=True)
        return 0
    except Exception as error:
        log("更新失败：%s" % error)
        if backup is not None:
            try:
                restore_source(backup)
                log("已恢复更新前的源码备份")
            except Exception as restore_error:
                log("恢复源码失败：%s" % restore_error)
        write_status(phase="error", message="更新失败：%s" % error, tag=args.tag, current=args.current)
        return 1
    finally:
        if extracted_parent:
            shutil.rmtree(extracted_parent, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
