import type { AppState, CallRange, Category, ClassSettings } from './types.js';
import { api } from './api.js';
import { store } from './store.js';
import { sortExams, toISODate } from './lib/dates.js';
import { fillOrderFor } from './lib/seats.js';
import { callSubjectOptions, examSubjects, resolveSubject } from './lib/ranking.js';
import { $, $all, esc, confirmAction, toast, openModal, closeModal } from './ui/dom.js';
import { pageTitles, rangeToDays, ui } from './ui/state.js';
import { renderSeatPage, setupSeatPage, setUndoAvailable } from './ui/seats.js';
import { renderRosterPage, renderExamsPage, renderDisciplinePage, renderCallPage } from './ui/pages.js';
import { drawStudent, markPreviewSort, previewExamId, resetCallRound, setCallCategory } from './ui/pages.js';
import { openStudentBubbles, refreshOpenBubble, setupBubbles, openDisciplineImport, closeStudentBubbles } from './ui/bubbles.js';
import { openImportModal, downloadTemplate } from './ui/import-modal.js';
import { confirmDeleteDormEvent, openDormDisciplineModal, openDormEditor, openDormImport, renderDormPage } from './ui/dorm-page.js';
import { downloadBackup, exportExam, exportRoster, exportSeats, demoStudents } from './ui/exporters.js';

function setPage(page: string): void {
  ui.page = page as typeof ui.page;
  for (const button of $all<HTMLButtonElement>('nav button')) {
    if (button.classList.contains('nav-parent')) continue;
    const samePage = button.dataset.page === page;
    const sameExamTab = !button.dataset.examTab || button.dataset.examTab === ui.examTab;
    const sameDiscTab = !button.dataset.discTab || button.dataset.discTab === ui.discTab;
    button.classList.toggle('active', samePage && sameExamTab && sameDiscTab);
  }
  setExamMenuState(page === 'exams');
  setDisciplineMenuState(page === 'discipline');
  for (const name of ['seat', 'roster', 'exams', 'discipline', 'call']) {
    $(`#${name}View`)?.classList.toggle('hidden', name !== page);
  }
  const [eyebrow, title, subtitle] = pageTitles[ui.page];
  const setText = (selector: string, value: string): void => {
    const node = $(selector);
    if (node) node.textContent = value;
  };
  setText('#pageEyebrow', eyebrow);
  setText('#pageTitle', title);
  setText('#pageSubtitle', subtitle);
  const importButton = $('#importBtn');
  if (importButton) importButton.textContent = page === 'exams' ? '＋ 导入考试成绩' : '＋ 导入学生名单';
  render();
}

function setExamMenuState(current: boolean): void {
  const group = $('#examsNavGroup');
  const parent = $('#examsNavParent');
  group?.classList.toggle('current', current);
  if (current) group?.classList.add('open');
  parent?.setAttribute('aria-expanded', String(group?.classList.contains('open') ?? false));
}

function setDisciplineMenuState(current: boolean): void {
  const group = $('#disciplineNavGroup');
  const parent = $('#disciplineNavParent');
  group?.classList.toggle('current', current);
  if (current) group?.classList.add('open');
  parent?.setAttribute('aria-expanded', String(group?.classList.contains('open') ?? false));
}

function render(): void {
  const state = store.state;
  if (!state) return;
  const classNameInput = $('#className') as HTMLInputElement | null;
  if (classNameInput && document.activeElement !== classNameInput) classNameInput.value = state.settings.className;
  setUndoAvailable(store.canUndo());
  if (ui.page === 'seat') renderSeatPage(state);
  if (ui.page === 'roster') renderRosterPage(state);
  if (ui.page === 'exams') renderExamsPage(state);
  if (ui.page === 'call') renderCallPage(state);
  if (ui.page === 'discipline') {
    $('#discPersonalPane')?.classList.toggle('hidden', ui.discTab !== 'personal');
    $('#discDormPane')?.classList.toggle('hidden', ui.discTab !== 'dorm');
    if (ui.discTab === 'personal') void refreshDiscipline();
    else renderDormPage(state);
  }
  refreshOpenBubble(store);
}

let disciplineRequestSeq = 0;

async function refreshDiscipline(): Promise<void> {
  const state = store.state;
  if (!state) return;
  const seq = ++disciplineRequestSeq;
  try {
    const summary = await api.disciplineSummary(rangeToDays(ui.discRange));
    if (seq !== disciplineRequestSeq) return;
    const latest = store.state;
    if (!latest) return;
    renderDisciplinePage(latest, summary);
  } catch (error) {
    if (seq === disciplineRequestSeq) toast((error as Error).message);
  }
}

const REQUIRED_BACKEND_FEATURES = ['seatRange', 'pdfExamImport', 'autoClassRanks'];

function showVersionWarning(): void {
  $('#versionWarning')?.classList.remove('hidden');
}

async function checkBackendFeatures(): Promise<void> {
  try {
    const health = await api.health();
    const features = new Set(health.features ?? []);
    if (REQUIRED_BACKEND_FEATURES.some((name) => !features.has(name))) showVersionWarning();
  } catch {
    // health 只是提示，失败不阻塞使用
  }
}

function undoLast(): void {
  guard(async () => {
    const ok = await store.undo();
    toast(ok ? '已撤销上一步' : '没有可撤销的操作');
  });
}

function guard(action: () => Promise<unknown>): void {
  void action().catch((error: Error & { status?: number }) => {
    if (error.status === 422 && /Extra inputs|extra_forbidden/i.test(error.message)) showVersionWarning();
    toast(error.message);
    // 失败时按服务端状态重绘，避免下拉/复选框停留在未保存的值
    render();
  });
}

function setupNavigation(): void {
  $('#examsNavParent')?.addEventListener('click', () => {
    const group = $('#examsNavGroup');
    const open = !group?.classList.contains('open');
    group?.classList.toggle('open', open);
    $('#examsNavParent')?.setAttribute('aria-expanded', String(open));
  });
  $('#disciplineNavParent')?.addEventListener('click', () => {
    const group = $('#disciplineNavGroup');
    const open = !group?.classList.contains('open');
    group?.classList.toggle('open', open);
    $('#disciplineNavParent')?.setAttribute('aria-expanded', String(open));
  });
  for (const button of $all<HTMLButtonElement>('nav button')) {
    if (button.classList.contains('nav-parent')) continue;
    button.addEventListener('click', () => {
      if (button.dataset.examTab) ui.examTab = button.dataset.examTab as 'single' | 'trend';
      if (button.dataset.discTab) ui.discTab = button.dataset.discTab as 'personal' | 'dorm';
      setPage(button.dataset.page ?? 'seat');
    });
  }
}

function setupHeader(): void {
  const className = $('#className') as HTMLInputElement | null;
  className?.addEventListener('change', () => {
    guard(() => store.updateSettings({ className: className.value.trim() || '我的班级' }));
  });
  $('#localBackupBtn')?.addEventListener('click', () => {
    guard(async () => {
      const result = await api.exportBackupToFolder();
      toast(`已备份 ${result.students} 名学生到 ${result.path}`);
    });
  });
  $('#backupBtn')?.addEventListener('click', () => {
    if (store.state) downloadBackup(store.state);
  });
  $('#restoreBtn')?.addEventListener('click', () => ($('#restoreFile') as HTMLInputElement | null)?.click());
  ($('#restoreFile') as HTMLInputElement | null)?.addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as AppState;
      const validShape =
        parsed &&
        typeof parsed === 'object' &&
        parsed.settings &&
        Array.isArray(parsed.students) &&
        Array.isArray(parsed.exams) &&
        parsed.seats &&
        typeof parsed.seats === 'object' &&
        parsed.discipline &&
        typeof parsed.discipline === 'object';
      if (!validShape) throw new Error('备份格式不正确');
      confirmAction(
        '恢复班级备份',
        `将替换当前班级，恢复“${parsed.settings.className}”的 ${parsed.students.length} 位学生与全部记录。建议先导出当前备份。`,
        () => guard(async () => {
          await store.restore(parsed);
          toast('备份已恢复');
        }),
        '替换并恢复',
      );
    } catch {
      toast('备份无效或格式不完整，当前数据未改动。');
    } finally {
      input.value = '';
    }
  });
  $('#helpBtn')?.addEventListener('click', () => {
    openModal(
      '使用指南',
      '<p><b>1. 导入名单</b>：下载模板填写学号与姓名，重复导入按学号更新，不会删除未包含的学生。</p>' +
        '<p><b>2. 导入成绩</b>：支持班序模板和学校成绩汇总表，考试名称与考试时间必填，自动读取得分与校次／班次。</p>' +
        '<p><b>3. 安排座位</b>：8 列 × 6/7 排，每排两列一组，中央另加 2 座；拖动吸附，拖到已占座位自动互换。</p>' +
        '<p><b>4. 违纪记录</b>：点座位上的学生打开红色气泡，选择类型后添加；也可在“违纪情况”页粘贴备忘录文字批量导入。</p>' +
        '<p><b>5. 数据保存</b>：数据保存在本机 Python 后端（SQLite），换设备请用“导出备份 / 恢复备份”。</p>',
    );
  });
}

function setupSeatControls(): void {
  ($('#showScores') as HTMLInputElement | null)?.addEventListener('change', (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    guard(() => store.updateSettings({ showScores: checked }));
  });
  ($('#seatRange') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
    const state = store.state;
    if (!state) return;
    const seatRange = (event.target as HTMLSelectElement).value as CallRange;
    const fallbackExamId = sortExams(state.exams)[0]?.id ?? '';
    const examId =
      seatRange === 'single'
        ? state.exams.some((exam) => exam.id === state.settings.examId)
          ? state.settings.examId
          : fallbackExamId
        : state.settings.examId;
    const options = callSubjectOptions(state.exams, seatRange, examId);
    const subject = resolveSubject(options, state.settings.subject, '总分');
    const patch: Partial<ClassSettings> = { seatRange, subject };
    if (seatRange === 'single') patch.examId = examId;
    guard(() => store.updateSettings(patch));
  });
  ($('#examSelect') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
    const state = store.state;
    if (!state) return;
    const examId = (event.target as HTMLSelectElement).value;
    const subjects = examSubjects(state.exams.find((exam) => exam.id === examId));
    const subject = subjects.includes('总分') ? '总分' : subjects[0] ?? '总分';
    guard(() => store.updateSettings({ examId, subject }));
  });
  ($('#subjectSelect') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
    guard(() => store.updateSettings({ subject: (event.target as HTMLSelectElement).value }));
  });
  ($('#extraRow') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
    guard(() => store.updateSettings({ extraRow: Number((event.target as HTMLSelectElement).value) }));
  });
  ($('#rowsSelect') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
    const state = store.state;
    const select = event.target as HTMLSelectElement;
    if (!state) return;
    const next = Number(select.value);
    if (next === state.settings.rows) return;
    const row7Count = Object.keys(state.seats).filter((seat) => seat.startsWith('R7')).length;
    if (next < state.settings.rows && row7Count) {
      select.value = String(state.settings.rows);
      confirmAction(
        '减少排数',
        `第 7 排还有 ${row7Count} 名学生，切换后他们会回到待安排区（可撤销恢复）。`,
        () => guard(() => store.updateSettings({ rows: next, extraRow: Math.min(state.settings.extraRow, next - 1) })),
        '仍然切换',
      );
      return;
    }
    guard(() => store.updateSettings({ rows: next, extraRow: Math.min(state.settings.extraRow, next - 1) }));
  });
  $('#undoBtn')?.addEventListener('click', undoLast);
  $('#rotateBtn')?.addEventListener('click', () => {
    guard(async () => {
      await store.rotateSeats();
      toast('大组已轮换：1 → 2 → 3 → 4 → 1；中央加座保持原位');
    });
  });
  $('#printBtn')?.addEventListener('click', () => window.print());
  ($('#searchWaiting') as HTMLInputElement | null)?.addEventListener('input', () => {
    if (store.state) renderSeatPage(store.state);
  });

  $('#seatMenuBtn')?.addEventListener('click', () => {
    openModal(
      '排座操作',
      '<p>自动安排仅填充空座，保留已安排学生的位置。</p><div class="actions">' +
        '<button id="fillSeats" class="primary">按名单顺序填充</button>' +
        '<button id="randomSeats">随机填充空座</button>' +
        '<button id="exportSeats">导出座位 Excel</button>' +
        '<button id="clearSeats" class="danger">清空座位安排</button></div>',
    );
    $('#fillSeats')?.addEventListener('click', () => {
      closeModal();
      guard(() => arrange('order'));
    });
    $('#randomSeats')?.addEventListener('click', () => {
      closeModal();
      guard(() => arrange('random'));
    });
    $('#exportSeats')?.addEventListener('click', () => {
      if (store.state) exportSeats(store.state);
    });
    $('#clearSeats')?.addEventListener('click', () => {
      confirmAction('清空座位安排', '所有学生将移回待安排区，名单和成绩保留，可撤销恢复。', () =>
        guard(async () => {
          await store.clearSeats();
          toast('已清空座位');
        }),
      );
    });
  });
}

async function arrange(mode: 'order' | 'random'): Promise<void> {
  const state = store.state;
  if (!state) return;
  if (!state.students.length) {
    toast('请先导入学生名单');
    return;
  }
  const seated = new Set(Object.values(state.seats));
  const waiting = state.students.filter((student) => !seated.has(student.id));
  if (!waiting.length) {
    toast('没有待安排的学生');
    return;
  }
  let order = [...waiting];
  if (mode === 'random') {
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  const seats = { ...state.seats };
  let placed = 0;
  for (const seatId of fillOrder(state)) {
    if (!order.length) break;
    if (seats[seatId]) continue;
    const student = order.shift();
    if (student) {
      seats[seatId] = student.id;
      placed += 1;
    }
  }
  if (!placed) {
    toast('没有空座可安排');
    return;
  }
  await store.replaceSeats(seats);
  toast(`已安排 ${placed} 位学生${order.length ? `，还有 ${order.length} 人留在待安排区` : ''}`);
}

function fillOrder(state: AppState): string[] {
  return fillOrderFor(state.settings.rows, state.settings.extraRow);
}

function setupRoster(): void {
  ($('#rosterSearch') as HTMLInputElement | null)?.addEventListener('input', () => {
    if (store.state) renderRosterPage(store.state);
  });
  $('#exportRosterBtn')?.addEventListener('click', () => {
    if (store.state) exportRoster(store.state);
  });
  $('#addStudentBtn')?.addEventListener('click', () => editStudent(null));
  $('#rosterTable')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const edit = target.closest<HTMLElement>('[data-edit]');
    const remove = target.closest<HTMLElement>('[data-delete]');
    if (edit) editStudent(edit.dataset.edit ?? '');
    if (remove) {
      const id = remove.dataset.delete ?? '';
      const student = store.state?.students.find((item) => item.id === id);
      if (!student) return;
      confirmAction(
        '删除学生',
        `确定删除 ${student.name}（${student.id}）？其座位、成绩与违纪记录也会删除，可撤销恢复。`,
        () => guard(async () => {
          await store.removeStudent(id);
          toast('学生已删除');
        }),
        '删除',
      );
    }
  });
}

function editStudent(id: string | null): void {
  const state = store.state;
  if (!state) return;
  const student = id ? state.students.find((item) => item.id === id) : null;
  openModal(
    student ? '编辑学生' : '添加学生',
    `<div class="form-row"><div class="field"><label>学号（唯一）</label><input id="editId" maxlength="64" value="${esc(student?.id ?? '')}" ${student ? 'disabled' : ''}></div>` +
      `<div class="field"><label>姓名</label><input id="editName" maxlength="100" value="${esc(student?.name ?? '')}"></div></div>` +
      `<div class="form-row"><div class="field"><label>性别（选填）</label><input id="editGender" maxlength="20" value="${esc(student?.gender ?? '')}"></div>` +
      `<div class="field"><label>寝室号（选填）</label><input id="editDorm" maxlength="20" value="${esc(student?.dorm ?? '')}" placeholder="例如 A301"></div>` +
      `<div class="field"><label>备注（选填）</label><input id="editNote" maxlength="200" value="${esc(student?.note ?? '')}"></div></div>`,
    '<button data-close>取消</button><button class="primary" id="saveStudent">保存</button>',
  );
  $('#saveStudent')?.addEventListener('click', () => {
    const newId = ($('#editId') as HTMLInputElement | null)?.value.trim() ?? '';
    const name = ($('#editName') as HTMLInputElement | null)?.value.trim() ?? '';
    const gender = ($('#editGender') as HTMLInputElement | null)?.value.trim() ?? '';
    const note = ($('#editNote') as HTMLInputElement | null)?.value.trim() ?? '';
    if (!newId || !name) {
      toast('请填写学号和姓名');
      return;
    }
    guard(async () => {
      const dorm = ($('#editDorm') as HTMLInputElement | null)?.value.trim() ?? '';
      if (student) await store.editStudent(student.id, { name, gender, note, dorm });
      else await store.addStudent({ id: newId, name, gender, note, dorm });
      closeModal();
      toast('学生信息已保存');
    });
  });
}

function setupExams(): void {
  $('#importExamBtn')?.addEventListener('click', () => openImportModal(store, 'exam'));
  $('#examCards')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const rename = target.closest<HTMLElement>('[data-rename-exam]');
    const exportButton = target.closest<HTMLElement>('[data-export-exam]');
    const remove = target.closest<HTMLElement>('[data-delete-exam]');
    if (rename) renameExam(rename.dataset.renameExam ?? '');
    if (exportButton && store.state) exportExam(store.state, exportButton.dataset.exportExam ?? '');
    if (remove) {
      const exam = store.state?.exams.find((item) => item.id === remove.dataset.deleteExam);
      if (!exam) return;
      confirmAction(
        '删除考试',
        `确定删除“${exam.name}”？学生名单和座位不受影响，可撤销恢复。`,
        () => guard(async () => {
          await store.removeExam(exam.id);
          toast('考试已删除');
        }),
        '删除',
      );
    }
  });
  $('#examTrendPanel')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const chip = target.closest<HTMLElement>('[data-trend-subject]');
    if (chip) {
      ui.trendSubject = chip.dataset.trendSubject ?? '';
      if (store.state) renderExamsPage(store.state);
      return;
    }
    const row = target.closest<HTMLElement>('[data-open-student]');
    if (row?.dataset.openStudent) openStudentBubbles(store, row.dataset.openStudent);
  });

  $('#examCards')?.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.id !== 'examArchiveSelect') return;
    previewExamId(select.value);
    render();
  });
  $('#examPreviewPanel')?.addEventListener('click', (event) => {
    const sortButton = (event.target as HTMLElement).closest<HTMLElement>('[data-sort]');
    if (sortButton) {
      markPreviewSort(sortButton.dataset.sort ?? 'id');
      render();
    }
  });
  $('#examPreviewPanel')?.addEventListener('input', (event) => {
    if ((event.target as HTMLElement).id === 'examPreviewSearch') render();
  });
}

function renameExam(id: string): void {
  const exam = store.state?.exams.find((item) => item.id === id);
  if (!exam) return;
  openModal(
    '修改考试信息',
    `<div class="form-row"><div class="field"><label for="renameExamInput">考试名称（必填）</label><input id="renameExamInput" maxlength="80" value="${esc(exam.name)}"></div>` +
      `<div class="field"><label for="renameExamDate">考试时间（必填）</label><input id="renameExamDate" type="date" value="${esc(toISODate(exam.date))}"></div></div>`,
    '<button data-close>取消</button><button class="primary" id="saveExamName">保存信息</button>',
  );
  $('#saveExamName')?.addEventListener('click', () => {
    const name = ($('#renameExamInput') as HTMLInputElement | null)?.value.trim() ?? '';
    const date = ($('#renameExamDate') as HTMLInputElement | null)?.value ?? '';
    if (!name) {
      toast('请填写考试名称');
      return;
    }
    guard(async () => {
      await store.editExam(id, { name, date });
      closeModal();
      toast('考试信息已更新');
    });
  });
}

function setupCall(): void {
  $('#callExam')?.addEventListener('change', (event) => {
    const examId = (event.target as HTMLSelectElement).value;
    const exam = store.state?.exams.find((item) => item.id === examId);
    const subjects = exam ? examSubjects(exam) : [];
    const preferred = subjects.includes('总分') ? '总分' : subjects[0] ?? '';
    guard(() => store.updateSettings({ examId, callSubject: preferred }));
  });
  $('#callRange')?.addEventListener('change', (event) => {
    guard(() =>
      store.updateSettings({ callRange: (event.target as HTMLSelectElement).value as CallRange, callSubject: '' }),
    );
  });
  $('#callSubject')?.addEventListener('change', (event) => {
    guard(() => store.updateSettings({ callSubject: (event.target as HTMLSelectElement).value }));
  });
  $('#noRepeat')?.addEventListener('change', () => render());
  $('#resetRound')?.addEventListener('click', () => {
    resetCallRound();
    render();
    toast('已开始新一轮点名');
  });
  $('#callCategories')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-category]');
    if (!button) return;
    setCallCategory((button.dataset.category ?? 'all') as Category);
    render();
  });
  $('#drawStudent')?.addEventListener('click', () => {
    const state = store.state;
    if (!state) return;
    const student = drawStudent(state);
    if (!student) {
      render();
      toast('此范围暂无可点名学生，可切换分类或开始新一轮');
      return;
    }
    render();
    const nameNode = $('#callName');
    nameNode?.classList.remove('flash');
    if (nameNode) {
      void nameNode.offsetWidth;
      nameNode.classList.add('flash');
    }
  });
}

function setupDisciplinePage(): void {
  ($('#discSearch') as HTMLInputElement | null)?.addEventListener('input', () => {
    if (store.state) void refreshDiscipline();
  });
  ($('#discPageRange') as HTMLSelectElement | null)?.addEventListener('change', (event) => {
    ui.discRange = (event.target as HTMLSelectElement).value as typeof ui.discRange;
    void refreshDiscipline();
  });
  $('#discPageImport')?.addEventListener('click', () => openDisciplineImport(store));
  $('#dormAddBtn')?.addEventListener('click', () => openDormEditor(store, null));
  $('#dormImportBtn')?.addEventListener('click', () => openDormImport(store));
  ($('#dormSearch') as HTMLInputElement | null)?.addEventListener('input', () => {
    if (store.state) renderDormPage(store.state);
  });
  $('#dormTable')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const edit = target.closest<HTMLElement>('[data-dorm-edit]');
    if (edit?.dataset.dormEdit) {
      openDormEditor(store, edit.dataset.dormEdit);
      return;
    }
    const add = target.closest<HTMLElement>('[data-dorm-add]');
    if (add?.dataset.dormAdd) {
      openDormDisciplineModal(store, add.dataset.dormAdd);
      return;
    }
    const remove = target.closest<HTMLElement>('[data-dorm-del]');
    if (remove?.dataset.room && remove.dataset.date) {
      confirmDeleteDormEvent(store, remove.dataset.room, remove.dataset.date, remove.dataset.reason ?? '');
    }
  });
  $('#discTable')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-open-student]');
    if (button?.dataset.openStudent) openStudentBubbles(store, button.dataset.openStudent);
  });
}

function setupGlobal(): void {
  $('#globalUndoBtn')?.addEventListener('click', undoLast);
  $('#closeModal')?.addEventListener('click', closeModal);
  const modal = $('#modal') as HTMLDialogElement | null;
  modal?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('[data-close]')) {
      closeModal();
      return;
    }
    if (event.target === modal) {
      const rect = modal.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) closeModal();
    }
  });
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      undoLast();
      return;
    }
    if (event.key !== 'Escape') return;
    if ((document.querySelector('#modal') as HTMLDialogElement | null)?.open) return; // 交给原生弹窗关闭
    ui.selected = null;
    closeStudentBubbles();
    if (store.state) render();
  });
  $('#intro')?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).id !== 'demoBtn') return;
    guard(async () => {
      await store.importRoster(demoStudents());
      toast('已载入示例学生（可在学生名单里删除）');
    });
  });
  $('#templateBtn')?.addEventListener('click', () => downloadTemplate(store));
  $('#importBtn')?.addEventListener('click', () =>
    openImportModal(store, ui.page === 'exams' ? 'exam' : 'roster'),
  );
}

function showLogin(message = ''): void {
  const overlay = $('#loginOverlay');
  overlay?.classList.remove('hidden');
  const error = $('#loginError');
  if (error) {
    error.textContent = message;
    error.classList.toggle('hidden', !message);
  }
  window.setTimeout(() => ($('#loginPassword') as HTMLInputElement | null)?.focus(), 30);
}

function hideLogin(): void {
  $('#loginOverlay')?.classList.add('hidden');
}

async function authRequired(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/status');
    const data = (await response.json()) as { required?: boolean; authenticated?: boolean };
    if (!data.required || data.authenticated) return false;
    showLogin();
    return true;
  } catch {
    return false;
  }
}

function setupLogin(): void {
  const form = $('#loginForm') as HTMLFormElement | null;
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const password = ($('#loginPassword') as HTMLInputElement | null)?.value ?? '';
    const button = $('#loginSubmit') as HTMLButtonElement | null;
    if (button) button.disabled = true;
    void fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
      .then(async (response) => {
        if (!response.ok) {
          showLogin('口令不正确，请重试');
          return;
        }
        hideLogin();
        const field = $('#loginPassword') as HTMLInputElement | null;
        if (field) field.value = '';
        await boot();
      })
      .catch(() => showLogin('无法连接后端，请确认服务已启动'))
      .finally(() => {
        if (button) button.disabled = false;
      });
  });
}

async function boot(): Promise<void> {
  if (await authRequired()) return;
  try {
    await store.load();
  } catch (error) {
    toast(`加载失败：${(error as Error).message}`);
    return;
  }
  void checkBackendFeatures();
  $('#dismissVersionWarning')?.addEventListener('click', () => $('#versionWarning')?.classList.add('hidden'));
  store.subscribe(() => render());
  setupNavigation();
  setupHeader();
  setupSeatPage(store);
  setupSeatControls();
  setupRoster();
  setupExams();
  setupCall();
  setupDisciplinePage();
  setupBubbles(store);
  setupGlobal();
  setPage('seat');
  render();
}

setupLogin();
window.addEventListener('banxu-unauthorized', () => showLogin('登录已失效，请重新输入口令'));
void boot();
