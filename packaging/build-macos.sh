#!/bin/bash
# 构建 macOS 独立应用（内含 Python 运行时和前端产物，无需安装 Python/Node）
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
VERSION="$(cat VERSION)"

[ -f frontend/dist/index.html ] || { echo "请先运行一次 ./run.sh 或 cd frontend && npm run build"; exit 1; }
[ -x backend/.venv/bin/python ] || { echo "请先运行一次 ./run.sh 安装后端依赖"; exit 1; }
backend/.venv/bin/python -m pip install -q pyinstaller

rm -rf packaging/dist packaging/build packaging/班序.spec
backend/.venv/bin/python -m PyInstaller --noconfirm --clean --windowed --name "班序" \
  --paths "$ROOT/backend" \
  --add-data "$ROOT/frontend/dist:frontend/dist" \
  --add-data "$ROOT/VERSION:." \
  --add-data "$ROOT/update.json:." \
  --collect-all uvicorn --collect-all pymupdf --hidden-import fitz \
  --osx-bundle-identifier "local.banxu.app" \
  --distpath "$ROOT/packaging/dist" \
  --workpath "$ROOT/packaging/build" \
  --specpath "$ROOT/packaging" \
  "$ROOT/packaging/launcher.py"

APP="$ROOT/packaging/dist/班序.app"
plutil -replace CFBundleShortVersionString -string "$VERSION" "$APP/Contents/Info.plist"
plutil -replace CFBundleVersion -string "$VERSION" "$APP/Contents/Info.plist"
codesign --deep --force --sign - "$APP"
ARCH="$(uname -m)"
ZIP="$ROOT/packaging/dist/班序-macOS-${ARCH}.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
echo "构建完成：$APP"
echo "发布包：$ZIP"
