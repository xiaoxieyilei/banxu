import type { AppState, Category, DisciplineSummary, Exam, Student } from '../types.js';
import { CATEGORY_LABELS, RANGE_LABELS } from '../types.js';
import { examDateLabel, sortExams, toISODate } from '../lib/dates.js';
import {
  buildGroups,
  callSubjectOptions,
  examPool,
  examSubjects,
  resolveSubject,
  sortPreview,
  weightedOverallForStudent,
} from '../lib/ranking.js';
import type { Groups } from '../lib/ranking.js';
import { $, esc, setHTML, setText } from './dom.js';
import { seatLabel } from '../lib/seats.js';
import { allSubjects, subjectRows, trendArrow } from '../lib/trend.js';
import { ui } from './state.js';
import { currentExam } from './seats.js';

/* ---------------- 学生名单 ---------------- */

export function renderRosterPage(state: AppState): void {
  const query = (($('#rosterSearch') as HTMLInputElement | null)?.value ?? '').trim().toLowerCase();
  const list = state.students.filter((student) => (student.name + student.id).toLowerCase().includes(query));
  const seatOf = (id: string): string => {
    const seat = Object.entries(state.seats).find(([, occupant]) => occupant === id);
    return seat ? seat[0] : '';
  };
  setHTML(
    '#rosterTable',
    list.length
      ? `<table><thead><tr><th>学号</th><th>姓名</th><th>性别</th><th>当前座位</th><th>备注</th><th>操作</th></tr></thead><tbody>${list
          .map(
            (student) =>
              `<tr><td>${esc(student.id)}</td><td><b>${esc(student.name)}</b></td><td>${esc(student.gender || '—')}</td>` +
              `<td><span class="badge">${
                seatOf(student.id) ? esc(seatLabel(seatOf(student.id), state.settings.extraRow)) : '待安排'
              }</span></td>` +
              `<td>${esc(student.note || '—')}</td><td><button class="small" data-edit="${esc(student.id)}">编辑</button> ` +
              `<button class="small danger" data-delete="${esc(student.id)}">删除</button></td></tr>`,
          )
          .join('')}</tbody></table>`
      : `<div class="table-empty">${query ? '没有匹配的学生' : '暂无学生名单<br>导入 Excel 文件，或手动添加学生。'}</div>`,
  );
}

/* ---------------- 考试成绩 ---------------- */

function examPreviewMarkup(state: AppState, exam: Exam, rawQuery: string): string {
  const rawSubjects = examSubjects(exam);
  const subjects = [
    ...rawSubjects.filter((subject) => subject === '总分'),
    ...rawSubjects
      .filter((subject) => subject !== '总分')
      .sort((a, b) => {
        const indexA = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '技术'].indexOf(a);
        const indexB = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '技术'].indexOf(b);
        return (indexA < 0 ? 99 : indexA) - (indexB < 0 ? 99 : indexB);
      }),
  ];
  const query = rawQuery.trim().toLowerCase();
  const matched = state.students.filter((student) => (student.name + student.id).toLowerCase().includes(query));
  const people = sortPreview(matched, exam, ui.previewSort.key, ui.previewSort.dir);
  const mark = (key: string): string =>
    ui.previewSort.key === key ? (ui.previewSort.dir > 0 ? ' ▲' : ' ▼') : '';
  const header = (key: string, label: string, extra = ''): string =>
    `<th><button class="sort-btn" data-sort="${esc(key)}" title="按${esc(label)}排序">${esc(label)}${mark(key)}</button>${extra}</th>`;
  const body = people
    .map((student) => {
      const values = exam.scores[student.id] ?? {};
      const ranks = exam.ranks?.[student.id] ?? {};
      const overall = weightedOverallForStudent(state, student.id);
      return `<tr><td>${esc(student.id)}</td><td><b>${esc(student.name)}</b></td>${subjects
        .map((subject) => {
          const rank = ranks[subject];
          return `<td>${values[subject] ?? '—'}<br><span class="rank-cell">${rank?.school ?? '—'} / ${rank?.class ?? '—'}</span></td>`;
        })
        .join('')}<td>${overall.score ?? '—'}<br><span class="rank-cell" title="${
          overall.missingFullMarks ? `${overall.missingFullMarks} 项缺少满分，未计入` : '所有历次考试、各科折算成百分制后的总平均'
        }">${overall.count ? `${overall.count} 项` : '缺满分'}</span></td></tr>`;
    })
    .join('');
  return (
    `<div class="exam-preview-head"><div><h2>${esc(exam.name)}</h2>` +
    `<p>${esc(examDateLabel(exam))} · ${people.length} 位学生 · 点表头排序</p></div>` +
    `<input id="examPreviewSearch" class="preview-filter" placeholder="搜索姓名或学号" value="${esc(rawQuery)}"></div>` +
    `<div class="exam-preview-table"><table><thead><tr>${header('id', '学号')}${header('name', '姓名')}${subjects
      .map((subject) => header(subject, subject, '<br><span class="rank-cell">成绩 / 校次 / 班次</span>'))
      .join('')}<th>历次加权平均<br><span class="rank-cell">各科百分制</span></th></tr></thead><tbody>${body}</tbody></table>${people.length ? '' : '<div class="table-empty">没有匹配的学生</div>'}</div>`
  );
}

function examPickerMarkup(state: AppState, ordered: Exam[]): string {
  const selected = state.exams.find((exam) => exam.id === ui.previewExamId);
  const count = selected ? examSubjects(selected).length : 0;
  const actions = selected
    ? `<button class="exam-action" data-rename-exam="${esc(selected.id)}" title="修改考试信息" aria-label="修改考试信息">✎</button>` +
      `<button class="exam-action" data-export-exam="${esc(selected.id)}" title="导出成绩" aria-label="导出成绩">↓</button>` +
      `<button class="exam-action danger" data-delete-exam="${esc(selected.id)}" title="删除考试" aria-label="删除考试">✕</button>`
    : '';
  return (
    `<div class="panel exam-picker"><div class="exam-picker-head">` +
    `<label for="examArchiveSelect">考试档案</label>` +
    `<select id="examArchiveSelect" aria-label="选择考试" title="${selected ? esc(selected.name) : '选择考试'}">${ordered
      .map(
        (exam) =>
          `<option value="${esc(exam.id)}"${exam.id === ui.previewExamId ? ' selected' : ''}>${esc(exam.name)}（${esc(
            examDateLabel(exam),
          )}）</option>`,
      )
      .join('')}</select>` +
    `<span class="exam-picker-count">${ordered.length} 场</span>` +
    `<span class="exam-picker-meta">${selected ? `${count ? `${count} 科` : '暂无成绩'}` : ''}</span>` +
    `<div class="exam-actions">${actions}</div>` +
    `</div></div>`
  );
}

export function renderExamsPage(state: AppState): void {
  $('#examSinglePane')?.classList.toggle('hidden', ui.examTab !== 'single');
  $('#examTrendPane')?.classList.toggle('hidden', ui.examTab !== 'trend');
  if (!ui.previewExamId || !state.exams.some((exam) => exam.id === ui.previewExamId)) {
    ui.previewExamId = sortExams(state.exams)[0]?.id ?? '';
  }
  const ordered = sortExams(state.exams);
  const selected = state.exams.find((exam) => exam.id === ui.previewExamId);
  const previousSearch = $('#examPreviewSearch') as HTMLInputElement | null;
  const hadFocus = document.activeElement === previousSearch;
  const caret = previousSearch?.selectionStart ?? null;
  const rawQuery = previousSearch?.value ?? '';

  setHTML(
    '#examCards',
    ordered.length
      ? examPickerMarkup(state, ordered)
      : '<div class="panel table-empty">还没有考试记录<br>导入成绩后，这里会显示在线预览表。</div>',
  );

  if (!selected) {
    setHTML('#examPreviewPanel', '<div class="table-empty">导入考试后会在这里生成在线预览表。</div>');
    renderTrendPanel(state);
    return;
  }
  setHTML('#examPreviewPanel', examPreviewMarkup(state, selected, rawQuery));
  if (hadFocus) {
    const nextInput = $('#examPreviewSearch') as HTMLInputElement | null;
    if (nextInput) {
      nextInput.focus();
      if (caret != null) nextInput.setSelectionRange(caret, caret);
    }
  }
  renderTrendPanel(state);
}

/* ---------------- 违纪情况 ---------------- */

export function renderDisciplinePage(state: AppState, summary: DisciplineSummary | null): void {
  const query = (($('#discSearch') as HTMLInputElement | null)?.value ?? '').trim().toLowerCase();
  const rangeSelect = $('#discPageRange') as HTMLSelectElement | null;
  if (rangeSelect) rangeSelect.value = ui.discRange;
  const rows = (summary?.rows ?? [])
    .filter((row) => (row.name + row.studentId).toLowerCase().includes(query))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  setText(
    '#discSummary',
    summary && summary.total
      ? `${summary.total} 条违纪记录 · ${summary.students} 位学生 · ${ui.discRange === 'all' ? '全部时间' : `近 ${ui.discRange} 天`}`
      : '',
  );
  if (summary === null) {
    setHTML('#discTable', '<div class="table-empty">正在统计违纪情况…</div>');
    return;
  }
  setHTML(
    '#discTable',
    rows.length
      ? `<table><thead><tr><th style="width:90px">学号</th><th style="width:110px">姓名</th><th style="width:100px">违纪次数</th><th style="width:120px">最近一次</th><th>违纪类型明细</th><th style="width:80px">操作</th></tr></thead><tbody>${rows
          .map((row) => {
            const badges = Object.entries(row.types)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => `<span class="disc-badge">${esc(type)} × ${count}</span>`)
              .join('');
            return (
              `<tr class="disc-row" data-open-student="${esc(row.studentId)}"><td>${esc(row.studentId)}</td><td><b>${esc(row.name)}</b></td>` +
              `<td><span class="disc-person-count">${row.count}</span> 次</td><td>${esc(toISODate(row.lastDate) || '—')}</td>` +
              `<td>${badges || '<span class="disc-empty-types">未分类</span>'}</td>` +
              `<td><button class="disc-open" data-open-student="${esc(row.studentId)}">查看</button></td></tr>`
            );
          })
          .join('')}</tbody></table>`
      : `<div class="table-empty">${
          state.students.length
            ? query
              ? '没有匹配的学生'
              : '暂无违纪记录<br>在座位上点学生即可添加，或用右上角“快速导入”粘贴备忘录文字。'
            : '还没有学生名单'
        }</div>`,
  );
}

/* ---------------- 随机点名 ---------------- */

interface CallSession {
  signature: string;
  called: Set<string>;
  log: Array<{ id: string; name: string }>;
  result: { student: Student; rank?: number } | null;
}

const session: CallSession = { signature: '', called: new Set(), log: [], result: null };

export function callGroups(state: AppState): { groups: Groups; subject: string; pool: ReturnType<typeof examPool> } {
  const range = state.settings.callRange;
  const options = callSubjectOptions(state.exams, range, state.settings.examId);
  const subject = resolveSubject(options, state.settings.callSubject, state.settings.subject);
  const pool = examPool(state.exams, range, subject, state.settings.examId);
  const groups = buildGroups(state.students, pool, subject);
  return { groups, subject, pool };
}

function syncSession(state: AppState): void {
  const signature = JSON.stringify([
    state.settings.examId,
    state.settings.callRange,
    state.settings.callSubject,
    state.settings.subject,
    state.students,
    state.exams.map((exam) => [exam.id, exam.date, exam.subjects, exam.scores]),
  ]);
  if (signature !== session.signature) {
    session.signature = signature;
    session.called.clear();
    session.log = [];
    session.result = null;
  }
}

export function renderCallPage(state: AppState): void {
  syncSession(state);
  const { groups, subject, pool } = callGroups(state);
  const single = state.settings.callRange === 'single';
  const options = callSubjectOptions(state.exams, state.settings.callRange, state.settings.examId);

  const examSelect = $('#callExam') as HTMLSelectElement | null;
  if (examSelect) {
    examSelect.innerHTML = state.exams.length
      ? sortExams(state.exams)
          .map(
            (exam) =>
              `<option value="${esc(exam.id)}">${esc(exam.name)}${
                toISODate(exam.date) ? `（${esc(toISODate(exam.date))}）` : ''
              }</option>`,
          )
          .join('')
      : '<option value="">暂无考试</option>';
    examSelect.value = state.settings.examId;
    examSelect.disabled = state.exams.length === 0;
  }
  $('#callExamWrap')?.classList.toggle('hidden', !single);
  const rangeSelect = $('#callRange') as HTMLSelectElement | null;
  if (rangeSelect) {
    rangeSelect.value = state.settings.callRange;
    rangeSelect.disabled = state.exams.length === 0;
  }
  const subjectSelect = $('#callSubject') as HTMLSelectElement | null;
  if (subjectSelect) {
    subjectSelect.innerHTML = options.length
      ? options.map((item) => `<option>${esc(item)}</option>`).join('')
      : '<option>暂无已考科目</option>';
    subjectSelect.value = subject;
    subjectSelect.disabled = options.length === 0;
  }

  const noRepeat = ($('#noRepeat') as HTMLInputElement | null)?.checked ?? true;
  const activeCategory = ui.callCategory;
  const poolList = groups[activeCategory];
  const available = poolList.filter((entry) => !noRepeat || !session.called.has(entry.student.id));

  setHTML(
    '#callCategories',
    (Object.keys(CATEGORY_LABELS) as Category[])
      .map((key) => {
        const descriptions: Record<Category, string> = {
          all: '全部名单（含暂无成绩）',
          excellent: '成绩前 30%',
          middle: '成绩中间 40%',
          support: '成绩后 30%',
          ungraded: '缺考／未录入',
        };
        return `<button class="call-category ${activeCategory === key ? 'active' : ''}" data-category="${key}" aria-pressed="${
          activeCategory === key
        }">${CATEGORY_LABELS[key]}<b>${groups[key].length} <small>人</small></b><small>${descriptions[key]}</small></button>`;
      })
      .join(''),
  );
  setText(
    '#callPoolLabel',
    `当前范围：${CATEGORY_LABELS[activeCategory]} · ${RANGE_LABELS[state.settings.callRange]}${subject ? ` · ${subject}` : ''}`,
  );
  setText('#callName', session.result ? session.result.student.name : '准备好了吗？');
  const basis = single
    ? `${currentExam(state)?.name ?? '暂无考试'} · ${subject}`
    : `${RANGE_LABELS[state.settings.callRange]} · ${subject} · 实际取 ${pool.length} 场`;
  const detail = session.result
    ? `学号 ${session.result.student.id} · ${basis}`
    : basis;
  setText('#callDetail', detail);
  const draw = $('#drawStudent') as HTMLButtonElement | null;
  if (draw) {
    draw.disabled = available.length === 0;
    draw.textContent = poolList.length && !available.length ? '本类已全部点过' : '随机点名';
  }
  setText(
    '#callRemaining',
    `当前范围 ${poolList.length} 人 · ${noRepeat ? '本轮还可抽取' : '可抽取'} ${available.length} 人`,
  );
  setText(
    '#callHistory',
    session.log.length
      ? `本轮已点名 ${session.log.length} 次（最近 12 次）：${session.log
          .slice(-12)
          .reverse()
          .map((entry) => `${entry.name}（${entry.id}）`)
          .join('、')}`
      : '本轮还没有点名记录。',
  );
  const scoreHead = single ? subject : `${subject}（均分）`;
  setHTML(
    '#callMembers',
    poolList.length
      ? `<table><thead><tr><th>名次</th><th>学号</th><th>姓名</th><th>${esc(scoreHead)}</th><th>参与场次</th><th>分类</th><th>本轮状态</th></tr></thead><tbody>${poolList
          .map(
            (entry) =>
              `<tr><td>${entry.rank ?? '—'}</td><td>${esc(entry.student.id)}</td><td>${esc(entry.student.name)}</td>` +
              `<td>${entry.score ?? '—'}</td><td>${entry.total ? `${entry.count} / ${entry.total}` : '—'}</td>` +
              `<td>${CATEGORY_LABELS[entry.category ?? 'middle']}</td><td>${session.called.has(entry.student.id) ? '已点名' : '未点名'}</td></tr>`,
          )
          .join('')}</tbody></table>`
      : '<div class="table-empty">此分类暂无学生，请选择其他分类或导入成绩。</div>',
  );
}

export function drawStudent(state: AppState): Student | null {
  syncSession(state);
  const noRepeat = ($('#noRepeat') as HTMLInputElement | null)?.checked ?? true;
  const { groups } = callGroups(state);
  const pool = groups[ui.callCategory].filter((entry) => !noRepeat || !session.called.has(entry.student.id));
  if (!pool.length) return null;
  const choice = pool[Math.floor(Math.random() * pool.length)];
  session.called.add(choice.student.id);
  session.log.push({ id: choice.student.id, name: choice.student.name });
  session.result = { student: choice.student, rank: choice.rank };
  return choice.student;
}

export function resetCallRound(): void {
  session.called.clear();
  session.log = [];
  session.result = null;
}

export function setCallCategory(category: Category): void {
  ui.callCategory = category;
}

export function markPreviewSort(key: string): void {
  ui.previewSort = ui.previewSort.key === key
    ? { key, dir: -ui.previewSort.dir as 1 | -1 }
    : { key, dir: key === 'id' || key === 'name' ? 1 : -1 };
}

export function previewExamId(id: string): void {
  ui.previewExamId = id;
}



/* ---------------- 学科成绩趋势（全班横向） ---------------- */

export function renderTrendPanel(state: AppState): void {
  const subjects = allSubjects(state.exams);
  if (!subjects.includes(ui.trendSubject)) ui.trendSubject = subjects[0] ?? '总分';
  const rows = subjectRows(state, ui.trendSubject);
  const exams = rows[0]?.points.map((point) => point.exam) ?? [];
  const chips = subjects
    .map(
      (subject) =>
        `<button class="small ${subject === ui.trendSubject ? 'primary' : ''}" data-trend-subject="${esc(subject)}">${esc(subject)}</button>`,
    )
    .join('');

  if (!exams.length) {
    setHTML(
      '#examTrendPanel',
      `<div class="trend-head"><div><h2>学科成绩总表</h2><p>按学科把全学期各次考试横向排开：大字为分数，小字为校次变化，便于整体分析。</p></div><div class="actions">${chips}</div></div>` +
        '<div class="trend-empty">还没有该科目的成绩记录。</div>',
    );
    return;
  }

  const header = exams
    .map((exam) => `<th title="${esc(exam.name)}">${esc(exam.date)}</th>`)
    .join('');
  const body = rows
    .map((row) => {
      const cells = row.values
        .map((value, index) => {
          const rank = row.schoolRanks[index];
          const previousRank = [...row.schoolRanks.slice(0, index)].reverse().find((item) => item !== null);
          const move = rank !== null && typeof previousRank === 'number' ? previousRank - rank : null;
          const moveLabel =
            move === null || move === 0
              ? ''
              : `<span class="rank-move ${move > 0 ? 'up' : 'down'}">${trendArrow(move > 0 ? 'up' : 'down')}${Math.abs(move)}</span>`;
          const scoreCell =
            value === null ? '<span class="trend-cell missing">—</span>' : `<span class="trend-cell">${value}</span>`;
          const classRank = row.classRanks[index];
          const previousClassRank = [...row.classRanks.slice(0, index)].reverse().find((item) => item !== null);
          const classMove =
            classRank !== null && typeof previousClassRank === 'number' ? previousClassRank - classRank : null;
          const classMoveLabel =
            classMove === null || classMove === 0
              ? ''
              : `<span class="rank-move class-move ${classMove > 0 ? 'up' : 'down'}">${trendArrow(classMove > 0 ? 'up' : 'down')}${Math.abs(classMove)}</span>`;
          const rankCell =
            rank === null && classRank === null
              ? ''
              : `<div class="rank-row">${
                  rank === null ? '' : `<span class="rank-num">校次 ${rank}${moveLabel}</span>`
                }${classRank === null ? '' : `<span class="rank-num class-rank">班次 ${classRank}${classMoveLabel}</span>`}</div>`;
          if (value === null && rank === null && classRank === null) {
            return '<td><span class="trend-cell missing">—</span></td>';
          }
          return `<td>${scoreCell}${rankCell}</td>`;
        })
        .join('');
      const weightedText =
        row.weightedAverage === null
          ? ''
          : ` · <span title="${row.weightedMissing ? `${row.weightedMissing} 场缺少满分，未计入` : '按各场满分折算成百分制'}">加权均分 ${row.weightedAverage}${row.weightedMissing ? '*' : ''}</span>`;
      const summary =
        row.last === null
          ? '<span class="trend-summary">暂无成绩</span>'
          : `<span class="trend-summary">最新 ${row.last} · 均分 ${row.average}${weightedText}${row.lastRank ? ` · 校次 ${row.lastRank}` : ''}${
              row.rankDelta === null || row.rankDelta === 0
                ? ''
                : `（${row.rankDelta > 0 ? '进步' : '退步'} ${Math.abs(row.rankDelta)} 名）`
            }${row.lastClassRank ? ` · 班次 ${row.lastClassRank}` : ''}${
              row.classRankDelta === null || row.classRankDelta === 0
                ? ''
                : `<span class="class-move-text">（班次${row.classRankDelta > 0 ? '进步' : '退步'} ${Math.abs(row.classRankDelta)} 名）</span>`
            }</span>`;
      return (
        `<tr class="disc-row" data-open-student="${esc(row.student.id)}">` +
        `<td class="name">${esc(row.student.name)}</td>${cells}<td>${summary}</td></tr>`
      );
    })
    .join('');

  setHTML(
    '#examTrendPanel',
    `<div class="trend-head"><div><h2>学科成绩总表 · ${esc(ui.trendSubject)}</h2>` +
      `<p>把全学期考过该科目的 ${exams.length} 次考试横向排开，便于整体分析走势；加权均分按各场满分折算成百分制，缺满分场次不计入（点任意一行查看该生详细趋势）</p></div>` +
      `<div class="actions">${chips}</div></div>` +
      `<div class="trend-table"><table><thead><tr><th class="name">姓名</th>${header}<th>最新 / 均分 / 加权均分 / 最高 / 最低</th></tr></thead>` +
      `<tbody>${body}</tbody></table></div>`,
  );
}
