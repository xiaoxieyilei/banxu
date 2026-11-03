#!/bin/bash
# 卸载班序的开机自启服务。
set -euo pipefail
LABEL="local.banxu.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"
echo "已卸载：$LABEL"
