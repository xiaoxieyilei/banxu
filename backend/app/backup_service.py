"""每日备份：把完整状态写成 JSON 到用户文档目录下的「班序备份」。

备份由软件自身的后台任务完成（每天 21:30）；只有数据相对上一份备份发生变化时才落盘，
内容没变则跳过，避免同一份数据每天反复生成相同的备份文件。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from datetime import datetime, time, timedelta
from pathlib import Path
from typing import Callable, Optional

from . import repository
from .db import read_tx

# 跨平台：Windows / macOS / Linux 都使用当前用户的主目录，不能写死用户名
DEFAULT_BACKUP_DIR = Path.home() / "Documents" / "班序备份"
# 每天 21:30 自动备份（可用 BANXU_BACKUP_AT=HH:MM 覆盖，便于测试）
DEFAULT_BACKUP_AT = "21:30"
BACKUP_PATTERN = "班序备份-*.json"

logger = logging.getLogger("banxu.backup")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)


def backup_time() -> time:
    raw = os.environ.get("BANXU_BACKUP_AT", DEFAULT_BACKUP_AT)
    try:
        hour, minute = (int(part) for part in raw.split(":", 1))
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return time(hour, minute)
    except (ValueError, TypeError):
        pass
    return time(21, 30)


def backup_directory() -> Path:
    return Path(os.environ.get("BANXU_BACKUP_DIR", str(DEFAULT_BACKUP_DIR))).expanduser()


def backup_filename(now: Optional[datetime] = None) -> str:
    moment = now or datetime.now()
    return "班序备份-%s.json" % moment.strftime("%Y-%m-%d")


def next_run_at(now: Optional[datetime] = None) -> datetime:
    """下一次 21:30 的时间点（已过则顺延到明天）。"""
    moment = now or datetime.now()
    scheduled = backup_time()
    target = moment.replace(hour=scheduled.hour, minute=scheduled.minute, second=0, microsecond=0)
    if target <= moment:
        target += timedelta(days=1)
    return target


def state_digest(state: dict) -> str:
    """状态指纹：与缩进、键顺序无关，只反映数据内容。"""
    payload = json.dumps(state, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def latest_backup_path(directory: Optional[Path] = None) -> Optional[Path]:
    """最近一份「班序备份-YYYY-MM-DD.json」；其他历史命名文件不参与比较。"""
    folder = directory or backup_directory()
    if not folder.is_dir():
        return None
    files = sorted(folder.glob(BACKUP_PATTERN))
    return files[-1] if files else None


def _load_state(conn) -> dict:
    with read_tx(conn):
        return repository.load_state(conn)


def _previous_state(path: Optional[Path]) -> Optional[dict]:
    if path is None:
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def change_since_last_backup(conn) -> dict:
    """当前数据是否与最近一份备份不同。

    changed=False 表示数据自上次备份后没有变化，此时不必再生成备份。
    """
    state = _load_state(conn)
    digest = state_digest(state)
    previous_path = latest_backup_path()
    if previous_path is None:
        return {"changed": True, "reason": "no_previous_backup", "state": state, "previous": None}
    previous_state = _previous_state(previous_path)
    if previous_state is None:
        return {"changed": True, "reason": "previous_unreadable", "state": state, "previous": previous_path}
    changed = state_digest(previous_state) != digest
    return {
        "changed": changed,
        "reason": "changed" if changed else "unchanged",
        "state": state,
        "previous": previous_path,
    }


def _file_time(path: Optional[Path]) -> str:
    if path is None:
        return ""
    try:
        return datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds")
    except OSError:
        return ""


def write_backup(conn, now: Optional[datetime] = None, force: bool = False) -> dict:
    """写一份完整状态备份。

    force=False（自动备份）时，若数据自上一份备份后没有变化则跳过；
    force=True（手动导出）总是落盘，同一天重复执行覆盖当天文件。
    """
    moment = now or datetime.now()
    if force:
        state = _load_state(conn)
    else:
        info = change_since_last_backup(conn)
        state = info["state"]
        if not info["changed"]:
            result = {
                "path": str(info["previous"]),
                "savedAt": moment.isoformat(timespec="seconds"),
                "students": len(state["students"]),
                "exams": len(state["exams"]),
                "skipped": True,
                "reason": "unchanged",
            }
            logger.info("数据自上次备份后没有变化，跳过备份（上一份：%s）", info["previous"])
            return result

    directory = backup_directory()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        os.chmod(directory, 0o700)
    except OSError:
        pass
    path = directory / backup_filename(moment)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    result = {
        "path": str(path),
        "savedAt": moment.isoformat(timespec="seconds"),
        "students": len(state["students"]),
        "exams": len(state["exams"]),
    }
    logger.info("已写入备份：%s（%d 名学生 / %d 场考试）", path, result["students"], result["exams"])
    return result


def startup_backup(connect: Callable) -> Optional[dict]:
    """应用启动时补一次备份；数据没变会自动跳过。测试可用 BANXU_BACKUP_ON_START=0 关闭。"""
    if os.environ.get("BANXU_BACKUP_ON_START", "1") != "1":
        return None
    conn = connect()
    try:
        return write_backup(conn)
    finally:
        conn.close()


def backup_status(conn=None, now: Optional[datetime] = None) -> dict:
    """备份现状：目录、每日时间、最近一份备份、下一次自动备份时间。

    传入 conn 时额外返回 pendingChanges：当前数据是否还没进入任何备份。
    """
    moment = now or datetime.now()
    last = latest_backup_path()
    result = {
        "backupDir": str(backup_directory()),
        "backupTime": backup_time().strftime("%H:%M"),
        "nextRunAt": next_run_at(moment).isoformat(timespec="seconds"),
        "lastBackupPath": str(last) if last else None,
        "lastBackupAt": _file_time(last) if last else None,
        "pendingChanges": None,
        "changeReason": None,
    }
    if conn is not None:
        info = change_since_last_backup(conn)
        result["pendingChanges"] = info["changed"]
        result["changeReason"] = info["reason"]
    return result


async def daily_backup_loop(connect: Callable) -> None:
    """后台任务：每天 21:30 检查一次，有更新才写备份。"""
    while True:
        now = datetime.now()
        target = next_run_at(now)
        wait_seconds = max(1.0, (target - now).total_seconds())
        logger.info("下一次自动备份：%s（%.0f 秒后）", target.isoformat(timespec="seconds"), wait_seconds)
        await asyncio.sleep(wait_seconds)
        try:
            conn = connect()
            try:
                result = write_backup(conn)
                if result.get("skipped"):
                    logger.info("今日无数据更新，跳过备份（保留上一份：%s）", result["path"])
                else:
                    logger.info("自动备份完成：%s", result["path"])
            finally:
                conn.close()
        except Exception:  # 备份失败不影响服务
            logger.exception("自动备份失败")
        await asyncio.sleep(1)
