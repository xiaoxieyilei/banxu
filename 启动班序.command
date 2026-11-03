#!/bin/bash
# 双击本文件即可启动「班序」：会自动构建前端（如需要）、启动后端，并打开浏览器。
# 关闭这个终端窗口即可停止服务。
umask 077
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8000}"

echo "=============================================="
echo " 班序 · 班级管理"
echo " 启动后请使用浏览器访问： http://127.0.0.1:${PORT}"
echo " 数据保存在： backend/data/banxu.sqlite3"
echo " 关闭此窗口即可停止服务。"
echo "=============================================="

# 已经在运行就直接打开页面，不重复启动
if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "班序已在运行，直接打开：http://127.0.0.1:${PORT}"
  open "http://127.0.0.1:${PORT}"
  exit 0
fi

# 4 秒后自动打开浏览器（首次安装依赖会更久，可在浏览器里手动刷新）
( sleep 4 && open "http://127.0.0.1:${PORT}" ) &

exec ./run.sh
