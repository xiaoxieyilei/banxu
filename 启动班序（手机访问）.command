#!/bin/bash
# 双击本文件启动「班序」并允许手机/平板通过局域网访问（监听 0.0.0.0）。
# 仅建议在可信 Wi-Fi 或 Tailscale 下使用，并保持访问口令足够强。
umask 077
cd "$(dirname "$0")" || exit 1
export BANXU_HOST=0.0.0.0
exec ./启动班序.command
