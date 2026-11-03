import type { AppState, CallRange } from '../types.js';
import { RANGE_LABELS } from '../types.js';
import type { Store } from '../store.js';
import type { AverageTotal } from '../lib/ranking.js';
import { callSubjectOptions, examPool, resolveSubject, scoreRanking } from '../lib/ranking.js';
import { sortExams } from '../lib/dates.js';
import {
  capacityFor,
  groupLabels,
  gridColumnFor,
  seatCode,
  seatLabel,
  seatsOfStudent,
  SEATS_PER_ROW,
} from '../lib/seats.js';
import { $, $all, esc, setHTML, setText, toast } from './dom.js';
import { ui } from './state.js';

export function currentExam(state: AppState) {
  return state.exams.find((exam) => exam.id === state.settings.examId);
}

/** 平均分去掉无意义的尾随 0：92 → “92”，92.4 → “92.4”。 */
export function formatAverage(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

interface SeatScoreContext {
  range: CallRange;
  examId: string;
  subject: string;
  subjectOptions: string[];
  pool: ReturnType<typeof examPool>;
  scores: Map<string, AverageTotal>;
  /** 平均模式是否按各场满分折算成百分制 */
  normalized: boolean;
  /** 单场考试若官方班次齐全，优先显示学校导入的班次 */
  rankSource: 'official' | 'score';
}

/** 座位表当前统计口径：单场考试或最近 3/5 次、全部考试平均，以及所选科目。 */
export function seatScoreContext(state: AppState): SeatScoreContext {
  const range = state.settings.seatRange ?? 'all';
  const fallbackExamId = sortExams(state.exams)[0]?.id ?? '';
  const examId = range === 'single' ? state.settings.examId || fallbackExamId : state.settings.examId;
  const subjectOptions = callSubjectOptions(state.exams, range, examId);
  const subject = resolveSubject(subjectOptions, state.settings.subject, '总分');
  const pool = examPool(state.exams, range, subject, examId);
  const normalized =
    range !== 'single' &&
    pool.length > 0 &&
    pool.every((exam) => {
      const full = exam.fullMarks?.[subject];
      return typeof full === 'number' && Number.isFinite(full) && full > 0;
    });
  const scores = scoreRanking(state.students, pool, subject, normalized);
  let rankSource: 'official' | 'score' = 'score';
  if (range === 'single') {
    const exam = state.exams.find((item) => item.id === examId);
    const official = new Map<string, number>();
    let scored = 0;
    for (const student of state.students) {
      const value = exam?.scores?.[student.id]?.[subject];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      scored += 1;
      const klass = exam?.ranks?.[student.id]?.[subject]?.class;
      if (typeof klass === 'number' && klass > 0) official.set(student.id, klass);
    }
    if (scored > 0 && official.size === scored) {
      for (const [studentId, rank] of official) {
        const entry = scores.get(studentId);
        if (entry) {
          entry.rank = rank;
          entry.ranked = scored;
        }
      }
      rankSource = 'official';
    }
  }
  return { range, examId, subject, subjectOptions, pool, scores, normalized, rankSource };
}

function scoreMarkup(score: AverageTotal | undefined, single: boolean, normalized: boolean): string {
  if (!score || score.score === null) return '<span class="seat-score">暂无成绩</span>';
  const prefix = single ? '' : '<span class="score-prefix">均分 </span>';
  const unit = single ? ' 分' : normalized ? '%' : '';
  const scoreText = `<span class="seat-score">${prefix}${esc(formatAverage(score.score))}${unit}</span>`;
  const rankText = score.rank === null ? '' : `<span class="seat-rank">班次 ${score.rank}</span>`;
  return scoreText + rankText;
}

function scoreTitle(score: AverageTotal | undefined, context: SeatScoreContext): string {
  const mode = RANGE_LABELS[context.range] ?? '全部考试平均';
  if (!score || score.score === null) return ` · ${mode} · ${context.subject} 暂无成绩`;
  const value = formatAverage(score.score);
  const basis =
    context.range === 'single'
      ? `${context.subject} ${value} 分`
      : context.normalized
        ? `${mode} · ${context.subject} 均分 ${value}%（百分制，${score.count} 场）`
        : `${mode} · ${context.subject} 平均 ${value} 分（${score.count} 场）`;
  const rankLabel =
    score.rank === null
      ? ''
      : context.rankSource === 'official'
        ? ` · 班次 ${score.rank} / ${score.ranked}（学校数据）`
        : ` · 班次 ${score.rank} / ${score.ranked}（按分数计算）`;
  return ` · ${basis}${rankLabel}`;
}

function seatMarkup(
  state: AppState,
  context: SeatScoreContext,
  seatId: string,
  row: number,
  column: number,
  central: boolean,
): string {
  const occupantId = state.seats[seatId];
  const student = state.students.find((item) => item.id === occupantId);
  const gender = String(student?.gender ?? '').trim().toLowerCase();
  const genderClass = ['男', '男生', '男性', 'male', 'm'].includes(gender)
    ? 'gender-boy'
    : ['女', '女生', '女性', 'female', 'f'].includes(gender)
      ? 'gender-girl'
      : '';
  const label = seatLabel(seatId, state.settings.extraRow) + (student ? ` ${student.name}` : ' 空座');
  const score = student ? context.scores.get(student.id) : undefined;
  const single = context.range === 'single';
  const title = student
    ? `${student.name} · ${seatLabel(seatId, state.settings.extraRow)}${
        state.settings.showScores ? scoreTitle(score, context) : ''
      }`
    : seatLabel(seatId, state.settings.extraRow);
  const content = student
    ? `<span class="seat-name">${esc(student.name)}</span>${
        state.settings.showScores ? scoreMarkup(score, single, context.normalized) : ''
      }`
    : '<span class="empty-plus">＋</span>';
  return (
    `<button class="seat ${student ? 'occupied' : ''} ${genderClass} ${central ? 'central' : ''} ${
      student && ui.selected === student.id ? 'selected' : ''
    }" data-seat="${seatId}" ${student ? `data-student="${esc(student.id)}"` : ''} ` +
    `style="grid-row:${row};grid-column:${column}" aria-label="${esc(label)}" title="${esc(title)}">` +
    `<span class="seat-code">${seatCode(seatId, state.settings.extraRow)}</span>${content}</button>`
  );
}

export function renderSeatPage(state: AppState): void {
  const classNameInput = $('#className') as HTMLInputElement | null;
  if (classNameInput && document.activeElement !== classNameInput) classNameInput.value = state.settings.className;
  const seated = Object.keys(state.seats).length;
  const rows = state.settings.rows;
  const context = seatScoreContext(state);
  setHTML('#statStudents', `${state.students.length}<small>人</small>`);
  setHTML('#statSeated', `${seated}<small>/ ${capacityFor(rows)}</small>`);
  setHTML('#statWaiting', `${state.students.length - seated}<small>人</small>`);
  setHTML('#statExams', `${state.exams.length}<small>次</small>`);
  $('#intro')?.classList.toggle('hidden', state.students.length > 0);
  setText('#legendRegular', `常规座位 ${rows * SEATS_PER_ROW}`);
  setText('#legendCapacity', `4 组 × 2 列 × ${rows} 排 · 共 ${capacityFor(rows)} 座`);

  const showScores = $('#showScores') as HTMLInputElement | null;
  if (showScores) {
    showScores.checked = state.settings.showScores;
    showScores.disabled = state.exams.length === 0;
  }

  const rangeSelect = $('#seatRange') as HTMLSelectElement | null;
  if (rangeSelect) {
    rangeSelect.value = context.range;
    rangeSelect.disabled = state.exams.length === 0;
  }
  const examSelect = $('#examSelect') as HTMLSelectElement | null;
  if (examSelect) {
    examSelect.innerHTML = state.exams.length
      ? sortExams(state.exams)
          .map((exam) => `<option value="${esc(exam.id)}">${esc(exam.name)}</option>`)
          .join('')
      : '<option value="">暂无考试</option>';
    examSelect.value = context.examId;
    examSelect.disabled = state.exams.length === 0;
    examSelect.classList.toggle('hidden', context.range !== 'single');
  }
  const subjectSelect = $('#subjectSelect') as HTMLSelectElement | null;
  if (subjectSelect) {
    subjectSelect.innerHTML = context.subjectOptions.length
      ? context.subjectOptions.map((subject) => `<option>${esc(subject)}</option>`).join('')
      : '<option>暂无科目</option>';
    subjectSelect.value = context.subject;
    subjectSelect.disabled = context.subjectOptions.length === 0;
  }

  const rowsSelect = $('#rowsSelect') as HTMLSelectElement | null;
  if (rowsSelect) rowsSelect.value = String(rows);
  const extraRow = state.settings.extraRow;
  const extraSelect = $('#extraRow') as HTMLSelectElement | null;
  if (extraSelect) {
    extraSelect.innerHTML = Array.from(
      { length: rows - 1 },
      (_, index) => `<option value="${index + 1}">第 ${index + 1}–${index + 2} 排</option>`,
    ).join('');
    extraSelect.value = String(Math.min(extraRow, rows - 1));
  }

  const undo = $('#undoBtn') as HTMLButtonElement | null;
  if (undo) undo.disabled = !uiCanUndo;
  const modeLabel = RANGE_LABELS[context.range] ?? '全部考试平均';
  setText(
    '#printTitle',
    `${state.settings.className} · 座位表${
      state.settings.showScores
        ? `（${modeLabel} · ${context.subject}${context.normalized ? ' · 百分制' : ''}${context.range !== 'single' && context.pool.length ? ` · ${context.pool.length} 场` : ''}）`
        : ''
    }`,
  );

  let html = '';
  for (const group of groupLabels()) {
    html += `<div class="group-label" style="grid-column:${group.columnStart}/${group.columnEnd};grid-row:1">${group.label}</div>`;
  }
  for (let row = 1; row <= rows; row += 1) {
    html += `<div class="row-label" style="grid-row:${row + 1};grid-column:1">${String(row).padStart(2, '0')}</div>`;
    for (let column = 1; column <= SEATS_PER_ROW; column += 1) {
      html += seatMarkup(state, context, `R${row}C${column}`, row + 1, gridColumnFor(column), false);
    }
  }
  html += seatMarkup(state, context, 'X1', extraRow + 1, 7, true);
  html += seatMarkup(state, context, 'X2', extraRow + 2, 7, true);
  setHTML('#seating', html);
  $('#seating')?.classList.toggle('rows-7', rows === 7);

  renderWaiting(state, context);
}

let uiCanUndo = false;
export function setUndoAvailable(value: boolean): void {
  uiCanUndo = value;
  const undo = $('#undoBtn') as HTMLButtonElement | null;
  if (undo) undo.disabled = !value;
  const globalUndo = $('#globalUndoBtn') as HTMLButtonElement | null;
  if (globalUndo) globalUndo.disabled = !value;
}

function renderWaiting(state: AppState, context: SeatScoreContext): void {
  const waiting = state.students.filter((student) => !seatsOfStudent(state.seats, student.id));
  setText('#waitingCount', String(waiting.length));
  const query = (($('#searchWaiting') as HTMLInputElement | null)?.value ?? '').trim().toLowerCase();
  const visible = waiting.filter((student) => (student.name + student.id).toLowerCase().includes(query));
  const single = context.range === 'single';
  const smallOf = (studentId: string): string => {
    if (!state.settings.showScores) return studentId;
    const score = context.scores.get(studentId);
    if (!score || score.score === null) return '暂无成绩';
    const value = `${single ? '' : '均分 '}${formatAverage(score.score)}${single ? ' 分' : context.normalized ? '%' : ''}`;
    return `${value}${score.rank === null ? '' : ` · 班次 ${score.rank}`}`;
  };
  setHTML(
    '#waitingList',
    visible.length
      ? visible
          .map(
            (student) =>
              `<button class="student ${ui.selected === student.id ? 'selected' : ''}" data-student="${esc(student.id)}" title="${esc(student.id)}"><span>${esc(student.name)}</span><small>${esc(
                smallOf(student.id),
              )}</small></button>`,
          )
          .join('')
      : `<div class="empty-state">${
          query ? '没有匹配的学生' : state.students.length ? '✓ 所有同学已安排入座' : '还没有学生<br>点击右上角导入名单'
        }</div>`,
  );
}

interface DragState {
  studentId: string;
  startX: number;
  startY: number;
  active: boolean;
  ghost: HTMLElement | null;
}

export function setupSeatPage(store: Store): void {
  let drag: DragState | null = null;
  let suppressClick = false;

  const clearOver = (): void => {
    for (const node of $all('.over')) node.classList.remove('over');
  };

  const clearDrag = (): void => {
    drag?.ghost?.remove();
    clearOver();
    drag = null;
  };

  document.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null;
    const handle = target?.closest<HTMLElement>('[data-student]');
    const dialogOpen = ($('#modal') as HTMLDialogElement | null)?.open;
    if (!handle || event.button !== 0 || dialogOpen) return;
    drag = { studentId: handle.dataset.student ?? '', startX: event.clientX, startY: event.clientY, active: false, ghost: null };
  });

  document.addEventListener(
    'pointermove',
    (event) => {
      if (!drag) return;
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) {
        drag.active = true;
        const state = store.state;
        const student = state?.students.find((item) => item.id === drag?.studentId);
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'drag-ghost';
        drag.ghost.textContent = student?.name ?? '';
        document.body.append(drag.ghost);
      }
      if (!drag.active) return;
      event.preventDefault();
      if (drag.ghost) {
        drag.ghost.style.left = `${event.clientX}px`;
        drag.ghost.style.top = `${event.clientY}px`;
      }
      clearOver();
      const dropTarget = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<
        HTMLElement
      >('[data-seat],#waitingDrop');
      dropTarget?.classList.add('over');
    },
    { passive: false },
  );

  document.addEventListener('pointerup', (event) => {
    if (!drag) return;
    if (!drag.active) {
      clearDrag();
      return;
    }
    suppressClick = true;
    const studentId = drag.studentId;
    const dropTarget = (document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null)?.closest<
      HTMLElement
    >('[data-seat],#waitingDrop');
    clearDrag();
    if (dropTarget) {
      const seat = (dropTarget as HTMLElement).dataset.seat ?? null;
      void store
        .moveStudent(studentId, seat)
        .then(() => toast(seat ? '座位已更新' : '已移回待安排区'))
        .catch((error: Error) => toast(error.message));
    }
    window.setTimeout(() => {
      suppressClick = false;
    }, 100);
  });

  document.addEventListener('pointercancel', clearDrag);
  window.addEventListener('blur', clearDrag);

  $('#seating')?.addEventListener('click', (event) => {
    if (suppressClick) return;
    const seat = (event.target as HTMLElement).closest<HTMLElement>('[data-seat]');
    if (!seat) return;
    const state = store.state;
    if (!state) return;
    const seatId = seat.dataset.seat ?? '';
    if (ui.selected && ui.selected !== seat.dataset.student) {
      const studentId = ui.selected;
      ui.selected = null;
      void store
        .moveStudent(studentId, seatId)
        .then(() => toast('座位已更新'))
        .catch((error: Error) => toast(error.message));
      return;
    }
    const studentId = seat.dataset.student;
    if (studentId) {
      ui.selected = null;
      void import('./bubbles.js').then((module) => module.openStudentBubbles(store, studentId));
    }
  });

  $('#waitingDrop')?.addEventListener('click', (event) => {
    if (suppressClick) return;
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>('[data-student]');
    if (handle?.dataset.student) {
      ui.selected = ui.selected === handle.dataset.student ? null : handle.dataset.student;
      const state = store.state;
      if (state) renderSeatPage(state);
      return;
    }
    if (ui.selected && !target.closest('input')) {
      const studentId = ui.selected;
      ui.selected = null;
      void store
        .moveStudent(studentId, null)
        .then(() => toast('已移回待安排区'))
        .catch((error: Error) => toast(error.message));
    }
  });
}
