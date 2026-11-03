# 重启之后的检查清单

DSH Desktop 重启后，`班级管理软件beta` 应该出现在左侧工作区列表里。

## 如果出现了

进这个工作区，先看两个文件确认内容完整：

- `README.md` —— 项目是什么、目录怎么分工、怎么跑
- `docs/PROJECT-CONTEXT.md` —— 需求原话、已实现能力、代码约定、待办

主程序是 `dist/班序-班级管理.html`，双击就能用（离线单文件）。

## 如果没出现

在能对话的会话里跟我说一句，我按顺序查：

1. `~/.dsh/storages/workspace.json` 里还有没有 `班级管理软件beta` 这条；
2. 应用是否在退出时用内存状态回写、把这条冲掉了——如果冲掉了，重新登记：
   `python3 "/Users/Apple/Deepseek Harness/班级管理软件beta/docs/register-workspace.py"` 然后再重启一次；
3. 实在不行就用 GUI 自带的"添加工作区 / 打开文件夹"选
   `/Users/Apple/Deepseek Harness/班级管理软件beta`，它走 `workspace.create` 命令，立即生效不用重启。

## 出问题时的现场证据

重启脚本的日志：`/tmp/dsh-restart.log`（记录了退出、补写注册表、重新打开三步的结果）。

## 背景（为什么会这样）

DSH 把工作区登记在 `~/.dsh/storages/workspace.json`，但服务启动时读进内存，之后以内存为准、只在变更时回写磁盘。
所以**运行中直接改这个文件，左侧栏不会更新**；必须让服务重新加载（重启），或者走应用自己的注册命令。

---

## 补充：会话记录（2026-10-21 二次导入）

第一次导入的会话被应用判为坏档：

```
stored log is corrupt: invalid committed event at line 1:
released v2 row 0 has seq gap (expected 0, got 1)
```

原因是 DSH 的 `session.v3` 事件流有硬性约束，我按错误逐个补齐：

1. `seq` 必须**从 0 开始**连续递增（我原来从 1 开始）
2. `assistant/message` 也必须带 `surfaceOp: "append"`
3. 消息必须带 `id`，assistant 消息还要带 `source: {kind:"model", provider, model}`
4. `assistant/message` 的 `data` 必须有 `stream` 数组与 `turn`/`step`

现在 `import-codex-sessions.mjs` 写完文件后会**用应用自带的严格格式化器自校验**（`dsh-session-format-catalog`），失败就自动删掉该会话并报错，不会再往库里塞坏档。

离线校验命令：`node /tmp/validate.mjs <session.v3.jsonl.zstd>`

当前导入结果：`session-370aca44-7944-4246-bdcd-3c7fe29b942d`（13 轮、42 条消息），已通过校验。
