# 班序 · 班级管理

给班主任用的本地班级管理工具：**Excel / PDF 导入名单与成绩、拖拽排座、按成绩点名、违纪记录与统计**。

- 项目主页：<https://github.com/xiaoxieyilei/banxu>
- **详细使用说明：[docs/使用说明.md](docs/使用说明.md)**
- 开源协议：[MIT](LICENSE)
- 路线图 / TODO：[Issue #9](https://github.com/xiaoxieyilei/banxu/issues/9)（Windows/Linux 安装包、签名公证、成绩编辑、CI 等）

本目录是「固化为正式项目」后的版本：

| 部分 | 技术栈 | 目录 |
|---|---|---|
| 前端 | TypeScript（浏览器原生 ES Module） | `frontend/` |
| 后端 | Python 3.9+ / FastAPI / SQLite | `backend/` |
| 旧版单文件 | 早期零依赖单文件（保留作参考与应急） | `app/`、`dist/` |

## 系统支持

| 系统 | 启动方式 | 说明 |
|---|---|---|
| macOS | 双击 `启动班序.command`，或 `./run.sh` | 支持 LaunchAgent 开机自启 |
| Windows 10/11 | 双击 `启动班序.bat` | 需要 Python 3.9+ 与 Node.js 20+ |
| Linux | `./run.sh` | 需要桌面环境/浏览器；无 LaunchAgent 脚本 |

后端 FastAPI、SQLite、PDF 解析（PyMuPDF）和前端都是跨平台的；只有双击启动器和 macOS LaunchAgent 是系统专属的。自动更新在三个系统上都能工作。

## 下载安装包（无需 Python/Node）

Release 里提供 macOS 独立安装包（内置 Python 运行时和前端，无需安装 Python/Node）：

1. 打开 <https://github.com/xiaoxieyilei/banxu/releases>，下载最新的 `banxu-macOS-arm64.zip`；
2. 解压后把 `班序.app` 拖到「应用程序」；
3. 首次打开如果被 Gatekeeper 拦截，右键 `班序.app` → **打开**（安装包未做 Apple 公证）；
4. 之后双击即用，数据保存在 `~/Library/Application Support/班序`，备份在 `~/Documents/班序备份（安装版）`。

> 当前 Release 只提供 macOS Apple Silicon 安装包；Intel Mac / Windows / Linux 可先用源码启动，安装包在 TODO issue 中。

## 快速开始

```bash
# 1. 后端依赖（首次）
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt

# 2. 前端构建（首次或改动 src 后）
cd frontend && npm install && npm run build && cd ..

# 3. 启动（后端顺带托管前端产物，同一端口）
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000
# 打开 http://127.0.0.1:8000

# 也可以直接 ./run.sh（自动装依赖 + 构建 + 启动；默认只监听 127.0.0.1，PORT 可覆盖端口）
```

数据库默认在 `backend/data/banxu.sqlite3`（可用环境变量 `BANXU_DB` 指定）。

> 安全提醒：本项目是**本机单用户**工具，用访问口令保护。默认只监听 `127.0.0.1`；需要手机访问时用 `启动班序（手机访问）.command`（macOS）/ `启动班序（手机访问）.bat`（Windows），或 `BANXU_HOST=0.0.0.0 ./run.sh`，并只在可信 Wi-Fi / Tailscale 下使用。

### 可选：开机自启（仅 macOS）

先手动运行一次 `./run.sh` 完成依赖安装与前端构建，然后：

```bash
./scripts/install-launchagent.command          # 只监听 127.0.0.1
ALLOW_PHONE=1 ./scripts/install-launchagent.command   # 允许手机访问（0.0.0.0）
```

日志在 `~/Library/Logs/banxu-server.log`；卸载用 `./scripts/uninstall-launchagent.command`。安装前需先停止当前正在运行的班序进程。

## 从旧版备份迁移

旧版单文件（localStorage 结构）的 JSON 备份可以用脚本导入新版：

```bash
# 先启动后端（./run.sh 或 uvicorn），再执行：
backend/.venv/bin/python backend/scripts/import_legacy_backup.py 旧备份.json
# 只想看会导入什么、不写入：
backend/.venv/bin/python backend/scripts/import_legacy_backup.py 旧备份.json --dry-run
```

脚本把 `className/extraRow/showScores/examId/subject` 映射到新版 `settings`，补 `rows=7`、`callRange=single`，
转换座位、考试（含校次/班次）与违纪记录；**会整库替换**当前数据，导入前建议先在软件里导出一次备份。

旧版备份里通常**没有考试成绩**（导出时间早于成绩导入）。原始成绩表（学校网站下载的“班级全学科成绩简表”）
可以用另一个脚本直接导入，自动识别两行表头与得分/校次/班次：

```bash
backend/.venv/bin/python backend/scripts/import_school_scores.py 成绩表.xlsx --select
# --dry-run 只解析；--date/--name 可覆盖从文件名推断的日期与名称
```

注意：导入学校成绩表需要 `openpyxl`（`backend/.venv/bin/pip install openpyxl`）。

支持的两种学校表格（软件里的「导入考试成绩」同样支持）：

| 类型 | 表头 | 科目来源 |
|---|---|---|
| 全学科汇总/简表 | 两行：科目行 + `得分/校次/班次` 行 | 表头科目行 |
| 单科成绩表（如“语文限时练/英语周练”） | 首行标题，第 2 行单行表头 `序号/准考证号/姓名/得分/校次/班次` | 文件名里的 `(语文)`、`(英语)` 或工作表名 |

两种都按**姓名**匹配学生（准考证号与软件学号不同，仅作干扰列忽略）；单科表不会额外生成“总分”列。
导入后即可在「随机点名」里按该科目自动分档（优秀 30% / 中等 40% / 后进 30%）。

## 功能

- **名单**：Excel 导入（按学号合并：更新已有、追加新学生、不删未列出的人），手动增删改，导出。
- **成绩**：支持班序模板、学校网站“班级全学科成绩汇总”表（两行表头、得分/校次/班次），以及学校「学生成绩单」**PDF**（按姓名匹配，单科只导入总分；逐题得分暂不保存）。缺少班次的成绩会按本班分数**自动计算班次**，校次留空；PDF 科目与满分自动带入，也可手动修改；同名同日期的考试可勾选「覆盖同名同日期考试」直接替换该场成绩。考试名称与考试时间必填，按时间倒序。
- **左侧菜单「考试成绩」为可展开分组**（点开下拉出两个视图）：
  - **单次考试成绩**：考试档案用一个下拉框选择考试，下方显示该场明细表；**总分列在最前**、各科按学科顺序，每格显示「分数／校次／班次」，可点表头排序、可搜索。
  - **学科成绩总表**：按学科把全学期各次考试横向排开。
    大字为分数，**绿/红小字为校次变化、蓝/橙小字为班次变化**（↑ 前进 / ↓ 后退），末列汇总最新分数、均分、最新校次与进退步；点任意一行打开该生趋势气泡。
- **个人详情气泡（跟随座位）**：点座位上的学生后，**违纪气泡贴在座位左侧（红）、成绩气泡贴在右侧（绿）**，不遮挡也不压缩座位表，两类数据同屏可见；点其他学生直接切换，滚动/缩放会跟随座位；空间不足时自动换边或上下错开；**点击空白处、按 Esc 或“关闭”都会收起**；气泡为半透明毛玻璃，能透出下方座位。
- **个人趋势图**：抽屉内绿色气泡展示**排名走势折线图**——同一张图里校次（实线，左轴）与班次（虚线，右轴）叠加对比，可按学科切换，名次越小越靠上、不显示分数；下方按考试分块列出**该场全部科目**的分数与校次/班次。
- **座位**：8 列 × 6 或 7 排 + 中央加座 2 个（50 / 58 座）；拖动吸附、占座互换、点选后点座位移动、待安排区拖回；大组轮换（1→2→3→4→1，组内位置不变，中央加座不动）；勾选「显示成绩」后可选择**单次考试 / 最近 3、5 次平均 / 全部考试平均**，并选择**科目**（如数学），**姓名下方显示该口径的成绩与班级排名（班次，缺考不计分母）**；平均模式下若每场都填了该科满分，会按**百分制**折算后再平均；打印。
- **点名**：优秀前 30% / 中间 40% / 后进生后 30%（并列同分同一档）；支持单次考试或最近 3/5 次、全部考试的平均分；本轮不重复。
- **违纪**：8 类类型按钮（默认晚自习违纪）+ 日期 + 可选备注；单条删除、撤销上一条、恢复刚删除；备忘录文字批量导入（**同一天多次违纪各记一条，默认不合并**，可在导入窗口勾选“跳过已存在的相同记录”）；按学生汇总的违纪情况页（只列有记录的学生）。
- **寝室违纪统计**：按寝室聚合「寝室违纪」事件（同寝室同一天同备注算 1 次），可整间或选择个别成员登记/撤销整次；支持「添加寝室」和逐间「编辑」（改寝室号、调成员、增删违纪事件）。违纪记录归属寝室号，学生调寝后事件仍留在原寝室并标注“已调出”，不会带走或误删其他寝室的记录。
- **满分口径**：考试信息弹窗可为每科填写满分；PDF 导入自动带入；用于把不同满分的考试换算成可比的百分制。
- **数据安全**：数据在本机 SQLite；支持导出/恢复 JSON 备份；顶部「↶ 撤销」或 ⌘Z 可全局撤销最近 30 步。
- **自动更新**：源码启动版顶部「检查更新」可一键下载、重建、重启；安装包版会提示从 Releases 下载新安装包（避免破坏应用签名与运行时）。
- **手机访问**：双击 `启动班序（手机访问）.command`（macOS）或 `.bat`（Windows）后监听 0.0.0.0 + 访问口令登录；手机经 Tailscale（或同一 Wi-Fi）打开 `http://<电脑IP>:8000`，可“添加到主屏幕”当 App 用，与电脑共用同一份数据。详见 `docs/手机访问与同步.md`。
- **每日自动备份**：后端每天 **21:30** 检查一次，只有数据相对上一份备份有变化时，才把完整状态写入 `<用户文档目录>/班序备份/班序备份-YYYY-MM-DD.json`（目录自动创建，同一天覆盖）；当天没有改动就跳过，不生成重复备份。软件启动时还会补一次备份（数据没变则跳过），避免 21:30 时电脑没开机而漏备；备份完全由软件自身完成，不再由 DSH 定时任务代为调用；DSH 定时任务只做只读自检（21:45 报告备份状态）。页面右上角「备份到文件夹」可随时手动生成当天备份（手动导出总是落盘）。备份状态可查 `GET /api/backup/status`。

## 目录

```
frontend/
  index.html              页面骨架（单一 HTML，无框架）
  src/main.ts             入口：页面切换、事件绑定
  src/api.ts              类型化 API 客户端
  src/store.ts            状态仓库（服务端为唯一事实来源 + 撤销快照）
  src/types.ts            与后端 camelCase 契约一致的类型
  src/lib/dates.ts        日期解析与考试排序
  src/lib/seats.ts        座位布局、角标、大组轮换映射
  src/lib/ranking.ts      科目过滤、平均分、分档、预览排序
  src/lib/discipline.ts   违纪类型与备忘录文字解析
  src/lib/excel.ts        Excel 解析（名单 / 成绩 / 学校汇总表）与模板
  src/lib/pdf-exam.ts     PDF 成绩单的姓名匹配与单科成绩映射
  src/ui/*.ts             各页面渲染与交互
  tests/*.test.mjs        Node 内置 test runner（跑 dist 产物）
backend/
  app/main.py             FastAPI 工厂、CORS、错误映射、静态托管
  app/api.py              REST 路由（写操作单事务 + 统一返回完整状态）
  app/repository.py       全部 SQL
  app/domain.py           业务规则与校验
  app/schemas.py          pydantic v2 契约（camelCase 别名）
  app/db.py               SQLite 连接、建表、事务
  tests/                  pytest（TestClient）
```

## API 速览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/state` | 完整状态（设置、学生、考试、座位、违纪） |
| POST | `/api/roster/import` | 名单导入（按学号合并） |
| POST/PATCH/DELETE | `/api/students[/{id}]` | 学生增改删 |
| POST | `/api/exams/pdf-parse` | 解析学校成绩单 PDF（只返回预览数据，不写库） |
| POST/PATCH/DELETE | `/api/exams[/{id}]` | 考试导入 / 改名称与时间 / 删除 |
| PUT | `/api/seats` | 整表覆盖座位 |
| POST | `/api/seats/move` | 移动或互换（`target: null` 回到待安排） |
| POST | `/api/seats/rotate` | 大组轮换 |
| DELETE | `/api/seats` | 清空座位 |
| POST | `/api/discipline` | 添加违纪（类型受服务端枚举校验） |
| DELETE | `/api/discipline/{studentId}/{recordId}` | 删除单条 |
| POST | `/api/discipline/import` | 批量导入（自动跳过重复） |
| GET | `/api/discipline/summary?days=` | 按学生汇总（只返回有记录的学生） |
| PATCH | `/api/settings` | 班级名、排数、中央加座、显示成绩、点名口径等 |
| POST | `/api/dorms/import` | 批量登记寝室（寝室号 + 学生） |
| POST | `/api/dorms/save` | 新增/编辑整间寝室（改名、成员、寝室违纪事件一次提交） |
| GET/POST | `/api/backup` | 导出备份 / 恢复备份（也用于撤销） |
| GET | `/api/update/check` | 检查 GitHub 更新（可加 `?force=true`） |
| GET | `/api/update/status` | 更新进度 |
| POST | `/api/update/apply` | 下载并应用指定版本 |

交互式文档：`http://127.0.0.1:8000/api/docs`。

## 测试

```bash
# 后端（139 项）
cd backend && .venv/bin/python -m pytest -q && cd ..

# 前端（91 项，需先 npm run build）
cd frontend && npm run build && npm test && cd ..

# 浏览器 E2E（真实 Chrome + 临时后端，不接触用户数据）
cd frontend && npm run test:e2e && cd ..
```

## 构建 macOS 安装包

```bash
./packaging/build-macos.sh
# 产物：packaging/dist/班序.app 与 packaging/dist/banxu-macOS-arm64.zip
```

需要本机已运行过一次 `./run.sh`（有 `backend/.venv` 和 `frontend/dist`）。

## 发布新版本

1. 修改根目录 `VERSION`（例如 `2.2.0`）并提交；
2. 推送后打标签并创建 GitHub Release：

```bash
git tag v2.2.0
git push origin main --tags
gh release create v2.2.0 --generate-notes
```

3. 把 `packaging/dist/banxu-macOS-arm64.zip` 上传到 Release；
4. 源码版朋友点「检查更新 → 更新到 v2.2.0」即可自动更新；安装包版按提示下载新安装包覆盖。

更新仓库配置在项目根目录 `update.json`；只允许从该仓库的 Release/Tag 下载，避免任意地址更新。

## 设计取舍

- **单用户本机应用**：访问口令登录，不做多租户；SQLite 用 `BEGIN IMMEDIATE` 串行化写入。多设备请靠备份文件迁移。
- **写操作返回完整状态**：每次变更后前端整体替换状态，避免局部同步 bug；数据量小，开销可忽略。
- **撤销在前端**：保留最近 30 份快照，撤销即调用 `/api/backup` 还原。
- **不使用前端框架**：静态骨架 + 模板字符串渲染，TypeScript 负责类型安全，`tsc` 同时完成编译与类型检查。
