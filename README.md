# 班序 · 班级管理

给班主任用的本地班级管理工具：**名单 / 成绩 / 座位 / 违纪 / 寝室 / 备份**，数据保存在本机，支持手机浏览器访问。

**版本 2.2.3** · [MIT](LICENSE) · macOS / Windows / Linux

- 项目主页：<https://github.com/xiaoxieyilei/banxu>
- **详细使用说明：[docs/使用说明.md](docs/使用说明.md)**
- 最新安装包：<https://github.com/xiaoxieyilei/banxu/releases>
- 路线图 / TODO：[Issue #9](https://github.com/xiaoxieyilei/banxu/issues/9)

## 下载安装（推荐，无需 Python/Node）

| 平台 | Release 资产 | 状态 |
|---|---|---|
| macOS Apple Silicon | `banxu-macOS-arm64.zip` | ✅ 已在本机实测 |
| Windows 10/11 x64 | `banxu-windows-x64.zip` | 🧪 内置运行时，用康辉的真机验证了 |
| Linux x64 | `banxu-linux-x64.tar.gz` | 🧪 内置运行时，尚未真机验证 |

安装步骤：

1. 打开 [Releases](https://github.com/xiaoxieyilei/banxu/releases)，下载对应资产；
2. macOS 解压后把 `班序.app` 拖进「应用程序」；Windows 解压后双击 `启动班序.bat`；Linux 解压后运行 `./启动班序.sh`；
3. macOS 首次打开若被 Gatekeeper 拦截，右键应用 → **打开**（当前未做 Apple 公证）；
4. 浏览器会自动打开班序。如果没打开，手动访问 `http://127.0.0.1:8000`。

**数据目录**

| 平台 | 数据 | 备份 |
|---|---|---|
| macOS | `~/Library/Application Support/班序` | `~/Documents/班序备份（安装版）` |
| Windows | `%APPDATA%\班序` | `文档\班序备份（安装版）` |
| Linux | `~/.local/share/班序` | `~/Documents/班序备份（安装版）` |

- Windows/Linux 包是 **v2.2.2 实验包**，内含 Python 运行时和前端，不需要安装环境；如启动失败，请把数据目录里的 `server.log` 发到 [Issue #1](https://github.com/xiaoxieyilei/banxu/issues/1)。
- macOS Intel 安装包与签名公证跟踪在 Issue #2；安装包版自动更新已在 v2.2.2 支持。
- 安装包版和源码版是**独立数据目录**；迁移时先在源码版「导出备份」，再在安装包版「恢复备份」。

> **v2.2.2 起，安装包版支持软件内直接升级**：点「检查更新 → 立即更新」，应用会自动下载新包、替换自身并重启，数据目录不变，不需要重新下载或迁移。旧安装包需要先手动装一次 v2.2.2，之后才能使用这个能力。

## 从源码运行

适合开发或需要自行修改的场景。

```bash
# 1. 后端依赖（首次）
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# 2. 前端构建（首次或改动 src 后）
cd frontend && npm install && npm run build && cd ..

# 3. 启动（后端同时托管前端产物）
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000
# 打开 http://127.0.0.1:8000

# 或者直接 ./run.sh（自动安装依赖、构建并启动）
```

要求 Python 3.9+、Node.js 20+。数据库默认在 `backend/data/banxu.sqlite3`，可用 `BANXU_DB` 指定。

Windows 源码启动：双击 `启动班序.bat`；macOS：双击 `启动班序.command`。

## 主要功能

- **名单**：Excel 导入（按学号合并：更新已有、追加新学生、不删未列出的人），手动增删改，导出。
- **成绩**：支持班序模板、学校全学科成绩表、学校「学生成绩单」PDF；缺少班次时按本班分数自动计算；PDF 自动带科目和满分，也可手动修改；支持覆盖同名同日期考试。
- **成绩浏览**：
  - 单次考试：下拉选择考试，总分在最前，各科显示「分数／校次／班次」，可排序、搜索；
  - 学科总表：按学科横向展开，绿/红显示校次变化、蓝/橙显示班次变化；
  - 个人趋势：点座位学生，左侧违纪气泡、右侧成绩气泡，含排名折线图；逐场成绩明细可按科目筛选。
  - 历次加权平均：单次考试表新增「历次加权平均」列；学科总表显示「加权均分」。每场成绩按该科满分折算成百分制后再平均，缺满分的场次不计入（需在考试信息里填写满分）。
- **座位**：8 列 × 6/7 排 + 中央加座；拖拽吸附、互换、点选移动、大组轮换、打印；可显示单次考试、最近 3/5 次或全部考试平均，按科目显示成绩与班次；平均模式支持按满分折算百分制。
- **点名**：优秀 30% / 中等 40% / 后进 30%，按单次或最近 3/5 次、全部考试平均分，本轮不重复。
- **违纪**：8 类违纪 + 日期 + 备注；单条删除、撤销上一条、恢复刚删除；备忘录文字批量导入；按学生汇总。
- **寝室违纪**：按寝室聚合事件（同寝室同一天同备注算 1 次）；可整间登记，也可在「＋ 记一次」中只勾选实际涉及的成员；学生调寝后历史事件仍归属原寝室并标注「已调出」。
- **满分口径**：考试信息可填每科满分；PDF 自动带入；用于不同满分考试的百分制比较。
- **数据安全**：本机 SQLite；导出/恢复 JSON 备份；顶部「↶ 撤销」或 ⌘Z 全局撤销最近 30 步。
- **自动更新**：源码版顶部「检查更新」可下载、重建、重启；安装包版（v2.2.2+）会下载平台安装包、自动替换应用并重启，数据无需迁移。
- **手机访问**：`启动班序（手机访问）.command`（macOS）/ `.bat`（Windows）监听 `0.0.0.0`，手机经同一 Wi-Fi 或 Tailscale 打开 `http://<电脑IP>:8000`，使用访问口令登录。
- **自动备份**：每天 21:30 检查一次，数据有变化才写入「文档/班序备份/班序备份-YYYY-MM-DD.json」；启动时补一次；页面右上角可手动备份。

更多操作细节见 **[使用说明](docs/使用说明.md)**。

## 数据备份与恢复

- 页面顶部「备份到文件夹」：立即写入当天备份；
- 「导出备份」：下载 JSON 文件；
- 「恢复备份」：从 JSON 恢复整库；
- 自动备份路径：`<用户文档>/班序备份/`（安装包版为 `班序备份（安装版）`）；
- 备份状态：`GET /api/backup/status`。

安全提醒：本项目是**本机单用户**工具，用访问口令保护。默认只监听 `127.0.0.1`；手机访问只在可信 Wi-Fi / Tailscale 下使用。备份包含学生成绩，请不要上传到公开位置。

## 项目结构

```
frontend/
  index.html              页面骨架
  src/main.ts             入口、页面切换、事件绑定
  src/api.ts              类型化 API 客户端
  src/store.ts            状态仓库 + 撤销快照
  src/lib/                日期、座位、排名、违纪、Excel、PDF
  src/ui/                 各页面渲染
  tests/                  Node test runner + 浏览器 E2E
backend/
  app/main.py             FastAPI 工厂、静态托管
  app/api.py              REST 路由
  app/repository.py       SQL
  app/domain.py           业务规则与校验
  app/schemas.py          pydantic v2 契约
  app/db.py               SQLite 连接与迁移
  tests/                  pytest
packaging/
  launcher.py             安装包启动入口
  build-macos.sh          macOS .app 构建
  build_binary.py         Windows/Linux PyInstaller 构建
docs/                     使用说明、手机访问等
```

## API 速览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 完整状态（设置、学生、考试、座位、违纪） |
| POST | `/api/roster/import` | 名单导入（按学号合并） |
| POST/PATCH/DELETE | `/api/students[/{id}]` | 学生增改删 |
| POST | `/api/exams/pdf-parse` | 解析成绩单 PDF（只预览，不写库） |
| POST/PATCH/DELETE | `/api/exams[/{id}]` | 考试导入 / 修改 / 删除 |
| PUT | `/api/seats` | 整表覆盖座位 |
| POST | `/api/seats/move` | 移动或互换 |
| POST | `/api/seats/rotate` | 大组轮换 |
| POST | `/api/discipline` | 添加违纪 |
| POST | `/api/discipline/dorm` | 登记寝室违纪（可选 `studentIds` 只登记部分成员） |
| DELETE | `/api/discipline/dorm` | 撤销整次寝室违纪 |
| DELETE | `/api/discipline/{studentId}/{recordId}` | 删除单条 |
| POST | `/api/discipline/import` | 批量导入 |
| GET | `/api/discipline/summary?days=` | 按学生汇总 |
| PATCH | `/api/settings` | 班级名、排数、显示成绩等 |
| POST | `/api/dorms/import` | 批量登记寝室 |
| POST | `/api/dorms/save` | 新增/编辑整间寝室 |
| GET/POST | `/api/backup` | 导出 / 恢复备份 |
| GET | `/api/update/check` | 检查 GitHub 更新 |
| GET | `/api/update/status` | 更新进度 |
| POST | `/api/update/apply` | 应用更新（仅源码版） |

交互式文档：`http://127.0.0.1:8000/api/docs`。

## 开发与测试

```bash
# 后端（145 项）
cd backend && .venv/bin/python -m pytest -q && cd ..

# 前端（92 项，需先构建）
cd frontend && npm run build && npm test && cd ..

# 浏览器 E2E（真实 Chrome + 临时后端，不接触用户数据）
cd frontend && npm run test:e2e && cd ..
```

## 构建安装包

```bash
# macOS .app（需要先运行过 ./run.sh）
./packaging/build-macos.sh
# 产物：packaging/dist/班序.app、packaging/dist/banxu-macOS-arm64.zip

# Windows/Linux（在对应系统运行；需要 PyInstaller）
python packaging/build_binary.py
# Windows：packaging/dist/banxu-windows-x64.zip
# Linux：  packaging/dist/banxu-linux-x64.tar.gz
```

Windows/Linux 安装包目前由维护者构建并上传；三平台自动构建流水线在 Issue #8 中继续完善。

## 发布新版本

1. 修改根目录 `VERSION`；
2. 提交并推送；
3. 打标签并创建 Release：

```bash
git tag v2.2.2
git push origin main --tags
gh release create v2.2.2 --generate-notes
```

4. 上传安装包资产：
   - `packaging/dist/banxu-macOS-arm64.zip`
   - `packaging/dist/banxu-windows-x64.zip`
   - `packaging/dist/banxu-linux-x64.tar.gz`
   - 对应 `.sha256`；
5. 源码版用户点「检查更新」即可升级；安装包版（v2.2.2+）也直接点「立即更新」升级。

更新仓库配置在 `update.json`，只允许从该仓库的 Release/Tag 下载。

## 路线图

- [Issue #9](https://github.com/xiaoxieyilei/banxu/issues/9)：持续更新的 TODO；
- #1 Windows/Linux 真实机器验证；
- #2 macOS Intel/universal 与签名公证；
- #3 安装包版自动更新（v2.2.2 已支持，待跨平台验证）；
- #4 历史满分回填与科目别名；
- #5 成绩/班次编辑与重导入合并；
- #6 登录限流与备份保留/加密；
- #7 批量 PDF 导入与考试搜索；
- #8 GitHub Actions 测试与发布流水线。

## 设计取舍

- **单用户本机应用**：访问口令登录，不做多租户；SQLite 用 `BEGIN IMMEDIATE` 串行化写入。多设备请通过备份迁移。
- **写操作返回完整状态**：每次变更整体替换前端状态，避免局部同步 bug；数据量小，开销可忽略。
- **撤销在前端**：保留最近 30 份快照，撤销时调用 `/api/backup` 还原。
- **不使用前端框架**：静态骨架 + 模板字符串渲染，TypeScript 负责类型与编译。

## 许可证

[MIT](LICENSE)。欢迎提交 Issue / PR；使用中遇到问题请附上系统、安装方式和 `server.log`。
