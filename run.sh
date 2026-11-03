#!/usr/bin/env bash
# 一键启动：安装依赖（首次）→ 构建前端 → 启动后端并托管前端
set -euo pipefail
umask 077
cd "$(dirname "$0")"

[ -d backend/.venv ] || python3 -m venv backend/.venv
backend/.venv/bin/pip install -q -r backend/requirements.txt
[ -d frontend/node_modules ] || (cd frontend && npm install --no-audit --no-fund)
(cd frontend && npm run build)

# 已在运行就直接退出，避免 8000 端口被旧进程占用时留下难懂的报错
if curl -fsS "http://127.0.0.1:${PORT:-8000}/api/health" >/dev/null 2>&1; then
  echo "班序已在运行：http://127.0.0.1:${PORT:-8000}"
  exit 0
fi

exec backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host "${BANXU_HOST:-127.0.0.1}" --port "${PORT:-8000}"
