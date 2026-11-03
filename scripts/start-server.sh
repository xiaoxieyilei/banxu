#!/bin/bash
# 后台/服务方式启动：不构建、不安装依赖，只启动已构建好的后端。
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

if [ ! -x backend/.venv/bin/python ]; then
  echo "缺少 backend/.venv，请先运行一次 ./run.sh 完成安装" >&2
  exit 1
fi
if [ ! -f frontend/dist/index.html ]; then
  echo "缺少 frontend/dist，请先运行一次 ./run.sh 完成构建" >&2
  exit 1
fi

exec backend/.venv/bin/python -m uvicorn app.main:app \
  --app-dir backend \
  --host "${BANXU_HOST:-127.0.0.1}" \
  --port "${PORT:-8000}"
