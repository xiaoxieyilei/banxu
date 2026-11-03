#!/usr/bin/env bash
# 一键启动：安装依赖（首次）→ 构建前端 → 启动后端并托管前端
set -euo pipefail
cd "$(dirname "$0")"

[ -d backend/.venv ] || python3 -m venv backend/.venv
backend/.venv/bin/pip install -q -r backend/requirements.txt
[ -d frontend/node_modules ] || (cd frontend && npm install --no-audit --no-fund)
(cd frontend && npm run build)

exec backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host "${BANXU_HOST:-0.0.0.0}" --port "${PORT:-8000}"
