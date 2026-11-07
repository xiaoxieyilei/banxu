#!/usr/bin/env python3
"""Build standalone Windows/Linux packages with PyInstaller.

Outputs:
  packaging/dist/banxu-windows-x64.zip
  packaging/dist/banxu-linux-x64.tar.gz
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGING = ROOT / "packaging"
DIST = PACKAGING / "dist"
BUILD = PACKAGING / "build"
VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
SEP = os.pathsep


def run(command: list[str]) -> None:
    print("$", " ".join(command))
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> int:
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        raise SystemExit("frontend/dist 不存在，请先构建前端")
    DIST.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    for name in ("banxu", "banxu-windows-x64.zip", "banxu-linux-x64.tar.gz"):
        if (DIST / name).exists():
            shutil.rmtree(DIST / name) if (DIST / name).is_dir() else (DIST / name).unlink()

    pyinstaller = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
                   "--windowed", "--name", "banxu",
                   "--paths", str(ROOT / "backend"),
                   "--add-data", str(ROOT / "frontend" / "dist") + SEP + "frontend/dist",
                   "--add-data", str(ROOT / "VERSION") + SEP + ".",
                   "--add-data", str(ROOT / "update.json") + SEP + ".",
                   "--collect-all", "uvicorn", "--collect-all", "pymupdf",
                   "--hidden-import", "fitz",
                   "--distpath", str(DIST), "--workpath", str(BUILD),
                   "--specpath", str(PACKAGING), str(PACKAGING / "launcher.py")]
    run(pyinstaller)

    app_dir = DIST / "banxu"
    if not app_dir.is_dir():
        raise SystemExit("PyInstaller 没有生成 banxu 目录")
    readme = app_dir / "README-安装.txt"
    readme.write_text(
        "班序 %s\n\n"
        "Windows：双击 banxu.exe，或双击包内「启动班序.bat」。\n"
        "Linux：运行 ./启动班序.sh 或 ./banxu。\n\n"
        "首次启动会在浏览器打开班序；数据位于用户目录：\n"
        "  Windows: %%APPDATA%%\\班序\n"
        "  Linux: ~/.local/share/班序\n"
        "备份位于用户「文档/班序备份（安装版）」。\n"
        "无需安装 Python 或 Node。\n" % VERSION,
        encoding="utf-8",
    )
    if os.name == "nt":
        (app_dir / "启动班序.bat").write_text(
            '@echo off\r\ncd /d "%~dp0"\r\nstart "" "banxu.exe"\r\n',
            encoding="utf-8",
        )
        archive = DIST / "banxu-windows-x64.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(app_dir.rglob("*")):
                zf.write(path, path.relative_to(app_dir.parent))
        print("发布包：", archive)
    else:
        launcher = app_dir / "启动班序.sh"
        launcher.write_text('#!/bin/bash\ncd "$(dirname "$0")"\nexec ./banxu\n', encoding="utf-8")
        launcher.chmod(0o755)
        (app_dir / "banxu").chmod(0o755)
        archive = DIST / "banxu-linux-x64.tar.gz"
        with tarfile.open(archive, "w:gz") as tf:
            tf.add(app_dir, arcname="banxu")
        print("发布包：", archive)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
