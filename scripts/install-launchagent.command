#!/bin/bash
# 可选：把班序安装成 macOS 登录自启服务（LaunchAgent）。
# 默认只监听 127.0.0.1；需要手机访问时用：ALLOW_PHONE=1 ./scripts/install-launchagent.command
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
PROJECT="$(pwd)"
PORT="${PORT:-8000}"
HOST="127.0.0.1"
if [ "${ALLOW_PHONE:-0}" = "1" ]; then HOST="0.0.0.0"; fi
LABEL="local.banxu.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/banxu-server.log"

if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
  echo "班序已经在运行（${PORT}）。请先停止当前进程/关闭终端，再安装开机自启。"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${PROJECT}/scripts/start-server.sh</string>
  </array>
  <key>WorkingDirectory</key><string>${PROJECT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BANXU_HOST</key><string>${HOST}</string>
    <key>PORT</key><string>${PORT}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
PLISTEOF

if [ "${1:-}" = "--print" ]; then
  echo "已生成（未加载）：$PLIST"
  cat "$PLIST"
  exit 0
fi

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1; then
  launchctl load -w "$PLIST"
fi
echo "已安装并启动：$LABEL"
echo "访问：http://127.0.0.1:${PORT}  （监听 ${HOST}）"
echo "日志：${LOG}"
echo "卸载：./scripts/uninstall-launchagent.command"
