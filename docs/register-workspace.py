#!/usr/bin/env python3
"""幂等地把「班级管理软件beta」注册为 DSH 工作区。

用法：
    python3 register-workspace.py            # 注册（已存在则跳过）
    python3 register-workspace.py --remove   # 移除该注册（不动目录和会话）

注意：DSH 服务在启动时把工作区域读进内存，只在变更时回写文件。
所以本脚本改文件后，**必须重启 DSH Desktop** 才会在左侧栏出现；
运行中直接改文件，下一次会话变更会用它内存里的旧状态覆盖掉。
"""
from __future__ import annotations

import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE_PATH = Path("/Users/Apple/Deepseek Harness/班级管理软件beta")
STORE = Path.home() / ".dsh" / "storages" / "workspace.json"
TITLE = "班级管理软件beta"


def main() -> int:
    remove = "--remove" in sys.argv[1:]
    if not STORE.exists():
        print(f"注册表不存在: {STORE}", file=sys.stderr)
        return 1
    data = json.loads(STORE.read_text())
    tables = data.setdefault("tables", {}).setdefault("workspaces", {})
    ids = data.setdefault("global", {}).setdefault("workspaceIds", [])

    hits = [(k, v) for k, v in tables.items() if v.get("path") == str(WORKSPACE_PATH)]

    if remove:
        for k, _ in hits:
            tables.pop(k, None)
            if k in ids:
                ids.remove(k)
        STORE.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        print(f"已移除 {len(hits)} 条注册")
        return 0

    if hits:
        print(f"已注册，跳过（{len(hits)} 条）: {[k for k, _ in hits]}")
        return 0

    new_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    tables[new_id] = {
        "path": str(WORKSPACE_PATH),
        "title": TITLE,
        "sessionIds": [],
        "createdAt": now,
        "updatedAt": now,
    }
    ids.append(new_id)
    STORE.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(f"已注册: {new_id} -> {WORKSPACE_PATH}")
    print(f"当前工作区数: {len(tables)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
