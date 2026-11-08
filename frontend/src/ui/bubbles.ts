import type { AppState } from '../types.js';
import type { Store } from '../store.js';
import { examDateLabel, todayISO } from '../lib/dates.js';
import { DEFAULT_DISCIPLINE_TYPE, DISCIPLINE_TYPES, parseDisciplineText, summariseDiscipline } from '../lib/discipline.js';
import { $, $all, esc, closeModal, openModal, setHTML, setText, toast } from './dom.js';
import { ui } from './state.js';
import { seatLabel, seatsOfStudent } from '../lib/seats.js';
import { dualRankSvg, rankSeries, studentSubjects, trendArrow } from '../lib/trend.js';

function renderTypeChips(): void {
  setHTML(
    '#discTypes',
    DISCIPLINE_TYPES.map(
      (type) =>
        `<button type="button" data-disc-type="${esc(type)}" class="${type === ui.discType ? 'on' : ''}" aria-pressed="${
          type === ui.discType
        }">${esc(type)}</button>`,
    ).join(''),
  );
}

export function renderBubbles(store: Store): void {
  const state = store.state;
  if (!state) return;
  const studentId = ui.bubbleStudentId;
  if (!studentId) return;
  const student = state.students.find((item) => item.id === studentId);
  if (!student) return;
  const records = state.discipline?.[studentId] ?? [];
  const seat = seatsOfStudent(state.seats, studentId);
  setText(
    '#disciplineStudent',
    `${student.name} · 学号 ${student.id} · 违纪 ${records.length} 条`,
  );
  setText('#scoreStudent', `${student.name} · ${seat ? seatLabel(seat, state.settings.extraRow) : '待安排'}`);
  const restoreButton = $('#restoreDiscipline') as HTMLButtonElement | null;
  if (restoreButton) {
    restoreButton.hidden = !(ui.lastDeletedDiscipline && ui.lastDeletedDiscipline.studentId === studentId);
  }
  setHTML(
    '#disciplineList',
    records.length
      ? records
          .map((record, index) => ({ record, index }))
          .reverse()
          .map(
            ({ record }) =>
              `<div class="bubble-item"><span class="disc-type-badge">${esc(record.type || '未分类')}</span>` +
              `<b>${esc(record.date || '未填写日期')}</b>` +
              `<button class="bubble-del" data-del-disc="${esc(record.id)}" title="删除这条违纪记录">删除</button>` +
              `${record.reason ? `<br>${esc(record.reason)}` : ''}</div>`,
          )
          .join('')
      : '<div class="bubble-empty">暂时没有违纪记录</div>',
  );

  const subjects = studentSubjects(state, studentId);
  if (!subjects.includes(ui.bubbleSubject)) {
    ui.bubbleSubject = subjects.includes('总分') ? '总分' : subjects[0] ?? '';
  }
  const chartSubject = ui.bubbleSubject;
  if (ui.bubbleDetailSubject && !subjects.includes(ui.bubbleDetailSubject)) ui.bubbleDetailSubject = '';
  const detailSubject = ui.bubbleDetailSubject;
  const schoolPoints = chartSubject ? rankSeries(state, studentId, chartSubject, 'school') : [];
  const classPoints = chartSubject ? rankSeries(state, studentId, chartSubject, 'class') : [];

  const chartChips = subjects
    .map(
      (item) =>
        `<button data-chart-subject="${esc(item)}" class="${item === chartSubject ? 'on' : ''}" aria-pressed="${
          item === chartSubject
        }">${esc(item)}</button>`,
    )
    .join('');

  if (!chartSubject) {
    setHTML('#scoreHistory', '<div class="bubble-empty">暂无考试成绩记录</div>');
    return;
  }

  const rankedSchool = schoolPoints.filter((point) => point.score !== null);
  const rankedClass = classPoints.filter((point) => point.score !== null);
  const latestSchool = rankedSchool[rankedSchool.length - 1];
  const latestClass = rankedClass[rankedClass.length - 1];
  const hasRank = rankedSchool.length > 0 || rankedClass.length > 0;

  const chart = hasRank
    ? `<div class="bubble-chart-wrap">` +
      `<div class="chart-title">${esc(chartSubject)} 排名走势（名次越小越靠上）</div>` +
      `<div class="rank-legend"><span class="legend-line school"></span>校次<span class="legend-line class"></span>班次</div>` +
      `${dualRankSvg(schoolPoints, classPoints, { width: 330, height: 168 })}</div>`
    : '<div class="bubble-chart-wrap"><div class="chart-title">排名走势</div><div class="trend-empty">该科目暂无排名数据</div></div>';

  const movedSchool =
    rankedSchool.length >= 2
      ? rankedSchool[rankedSchool.length - 2].score! - rankedSchool[rankedSchool.length - 1].score!
      : null;
  const summary = latestSchool || latestClass
    ? `<div class="bubble-item"><b>${esc(chartSubject)}</b> 最新 ` +
      (latestSchool ? `校次第 <b>${latestSchool.score}</b> 名` : '校次无数据') +
      (latestClass ? ` · 班次第 <b>${latestClass.score}</b> 名` : '') +
      (latestSchool ? `（${esc(examDateLabel(latestSchool.exam))}）` : '') +
      (movedSchool === null
        ? ''
        : ` · 校次较上次 <span class="score-delta ${movedSchool > 0 ? 'up' : movedSchool < 0 ? 'down' : ''}">${trendArrow(
            movedSchool > 0 ? 'up' : movedSchool < 0 ? 'down' : 'flat',
          )}${movedSchool === 0 ? '' : ` ${Math.abs(movedSchool)} 名`}</span>`) +
      `<br><span style="opacity:.85">共 ${Math.max(rankedSchool.length, rankedClass.length)} 次有排名` +
      (rankedSchool.length ? ` · 最好校次第 ${Math.min(...rankedSchool.map((point) => point.score!))} 名` : '') +
      `</span></div>`
    : '<div class="bubble-item">该科目暂无排名数据</div>';

  const examsNewestFirst = [...state.exams]
    .sort((a, b) => b.date.localeCompare(a.date))
    .filter((exam) => {
      const values = exam.scores?.[studentId] ?? {};
      const ranks = exam.ranks?.[studentId] ?? {};
      if (detailSubject) return values[detailSubject] != null || Boolean(ranks[detailSubject]);
      return Object.values(values).some((value) => value !== null) || Object.keys(ranks).length > 0;
    });

  const blocks = examsNewestFirst
    .map((exam) => {
      const values = exam.scores?.[studentId] ?? {};
      const ranks = exam.ranks?.[studentId] ?? {};
      const rows = exam.subjects
        .filter((subject) =>
          detailSubject ? subject === detailSubject : subject === '总分' || values[subject] != null || ranks[subject],
        )
        .sort((a, b) => (a === '总分' ? -1 : b === '总分' ? 1 : 0))
        .map((subject) => {
          const rank = ranks[subject];
          return (
            `<tr class="${subject === '总分' ? 'latest' : ''}"><td>${esc(subject)}</td>` +
            `<td class="num">${values[subject] ?? '—'}</td>` +
            `<td class="num">${rank?.school ?? '—'}</td>` +
            `<td class="num">${rank?.class ?? '—'}</td></tr>`
          );
        })
        .join('');
      const totalRank = ranks['总分'];
      return (
        `<div class="exam-block"><div class="exam-block-head"><b>${esc(exam.name)}</b>` +
        `<span>${esc(examDateLabel(exam))}</span>` +
        `${
          totalRank?.school || totalRank?.class
            ? `<span class="exam-rank">总分第 ${totalRank?.school ?? '—'} 名 · 班内第 ${totalRank?.class ?? '—'} 名</span>`
            : ''
        }</div>` +
        `<table class="score-table"><thead><tr><th>科目</th><th>分数</th><th>校次</th><th>班次</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>`
      );
    })
    .join('');

  setHTML(
    '#scoreHistory',
    `<div class="chart-controls"><div class="subject-chips" id="scoreSubjects">${chartChips}</div>` +
      `<span class="chart-hint">虚线＝班次</span></div>` +
      `<div class="detail-filter-row"><label for="bubbleDetailSubject">逐场明细科目</label>` +
      `<select id="bubbleDetailSubject" class="bubble-detail-select" aria-label="按科目筛选逐场明细">` +
      `<option value="">全部科目</option>` +
      subjects.map((subject) => `<option value="${esc(subject)}"${subject === detailSubject ? ' selected' : ''}>${esc(subject)}</option>`).join('') +
      `</select></div>` +
      summary +
      chart +
      `<div id="rankTooltip" class="rank-tooltip" hidden></div>` +
      `<div class="exam-list-title">逐场成绩明细（鼠标移到排名点上可看校次/班次）</div>` +
      (blocks || '<div class="bubble-empty">该科目暂无逐场成绩</div>'),
  );
  schedulePosition();
}

const schedulePosition = (): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(positionBubbles);
  else setTimeout(positionBubbles, 0);
};

const BUBBLE_WIDTH = 320;
const BUBBLE_GAP = 10;
const VIEW_MARGIN = 8;

/** 把两张气泡放到该学生座位卡的两侧（左侧违纪、右侧成绩），空间不足时自动换边/上下错开。 */
export function positionBubbles(): void {
  if (typeof window === 'undefined' || !window.innerWidth) return;
  const studentId = ui.bubbleStudentId;
  const root = $('#studentBubbles');
  const red = root?.querySelector<HTMLElement>('.bubble-red');
  const green = root?.querySelector<HTMLElement>('.bubble-green');
  if (!studentId || !red || !green) return;

  const anchor =
    document.querySelector<HTMLElement>(`#seating [data-student="${CSS.escape(studentId)}"]`) ??
    document.querySelector<HTMLElement>(`[data-open-student="${CSS.escape(studentId)}"]`);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxHeight = vh - VIEW_MARGIN * 2;
  red.style.maxHeight = `${maxHeight}px`;
  green.style.maxHeight = `${maxHeight}px`;

  if (!anchor) {
    // 没有座位/行可锚定时退回居中
    red.style.left = `${Math.round((vw - BUBBLE_WIDTH) / 2 - BUBBLE_WIDTH / 2 - BUBBLE_GAP)}px`;
    red.style.top = `${Math.round(vh / 2 - red.offsetHeight / 2)}px`;
    green.style.left = `${Math.round((vw + BUBBLE_WIDTH) / 2 + BUBBLE_GAP)}px`;
    green.style.top = `${Math.round(vh / 2 - green.offsetHeight / 2)}px`;
    return;
  }

  const rect = anchor.getBoundingClientRect();
  const redWidth = red.offsetWidth || BUBBLE_WIDTH;
  const greenWidth = green.offsetWidth || BUBBLE_WIDTH;
  const leftRoom = rect.left - BUBBLE_GAP - redWidth;
  const rightRoom = vw - rect.right - BUBBLE_GAP - greenWidth;

  let redLeft: number;
  let greenLeft: number;
  if (leftRoom >= VIEW_MARGIN && rightRoom >= VIEW_MARGIN) {
    redLeft = leftRoom;
    greenLeft = rect.right + BUBBLE_GAP;
  } else if (leftRoom >= VIEW_MARGIN) {
    redLeft = leftRoom;
    greenLeft = Math.max(VIEW_MARGIN, vw - VIEW_MARGIN - greenWidth);
  } else if (rightRoom >= VIEW_MARGIN) {
    greenLeft = rect.right + BUBBLE_GAP;
    redLeft = Math.max(VIEW_MARGIN, greenLeft - redWidth - BUBBLE_GAP);
  } else {
    // 两侧都放不下：红贴左、绿贴右，必要时上下错开
    redLeft = VIEW_MARGIN;
    greenLeft = Math.max(VIEW_MARGIN, vw - VIEW_MARGIN - greenWidth);
  }

  const alignedTop = Math.max(VIEW_MARGIN, Math.min(rect.top - 6, vh - Math.max(red.offsetHeight, green.offsetHeight) - VIEW_MARGIN));
  let redTop = alignedTop;
  let greenTop = alignedTop;
  const overlap = redLeft < greenLeft + greenWidth && greenLeft < redLeft + redWidth;
  if (overlap) {
    redTop = VIEW_MARGIN;
    greenTop = Math.max(VIEW_MARGIN, vh - VIEW_MARGIN - green.offsetHeight);
  }

  red.style.left = `${Math.round(redLeft)}px`;
  red.style.top = `${Math.round(redTop)}px`;
  green.style.left = `${Math.round(greenLeft)}px`;
  green.style.top = `${Math.round(greenTop)}px`;
}

export function openStudentBubbles(store: Store, studentId: string): void {
  ui.bubbleStudentId = studentId;
  ui.bubbleSubject = '';
  ui.bubbleDetailSubject = '';
  ui.lastDeletedDiscipline = null;
  renderTypeChips();
  const dateInput = $('#disciplineDate') as HTMLInputElement | null;
  if (dateInput) dateInput.value = todayISO();
  const reason = $('#disciplineReason') as HTMLTextAreaElement | null;
  if (reason) reason.value = '';
  renderBubbles(store);
  document.body.classList.add('bubbles-open');
  $('#studentBubbles')?.classList.add('open');
  schedulePosition();
  const state = store.state;
  if (state) {
    setText(
      '#disciplineStudent',
      `${state.students.find((item) => item.id === studentId)?.name ?? ''} · 学号 ${studentId} · 违纪 ${
        (state.discipline?.[studentId] ?? []).length
      } 条`,
    );
  }
}

export function closeStudentBubbles(): void {
  ui.bubbleStudentId = null;
  document.body.classList.remove('bubbles-open');
  $('#studentBubbles')?.classList.remove('open');
}

function showRankTooltip(event: MouseEvent): void {
  const target = event.target as Element | null;
  const hit = target?.closest?.('.rank-hit') as Element | null;
  const tip = $('#rankTooltip') as HTMLElement | null;
  if (!hit || !tip) return;
  const exam = hit.getAttribute('data-exam') ?? '考试';
  const date = hit.getAttribute('data-date') ?? '';
  const school = hit.getAttribute('data-school') ?? '';
  const klass = hit.getAttribute('data-class') ?? '';
  tip.innerHTML =
    `<b>${esc(exam)}</b>` +
    `<div class="rank-tooltip-date">${esc(date)}</div>` +
    `<div>校次：${school ? `第 ${esc(school)} 名` : '—'}</div>` +
    `<div>班次：${klass ? `第 ${esc(klass)} 名` : '—'}</div>`;
  tip.hidden = false;
  const width = tip.offsetWidth || 180;
  const height = tip.offsetHeight || 70;
  const left = Math.max(8, Math.min(event.clientX + 12, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(event.clientY + 12, window.innerHeight - height - 8));
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function hideRankTooltip(event: MouseEvent): void {
  const target = event.target as Element | null;
  if (!target?.closest?.('.rank-hit')) return;
  const tip = $('#rankTooltip') as HTMLElement | null;
  if (tip) tip.hidden = true;
}

export function setupBubbles(store: Store): void {
  $('#discTypes')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-disc-type]');
    if (!button) return;
    ui.discType = button.dataset.discType ?? DEFAULT_DISCIPLINE_TYPE;
    renderTypeChips();
  });

  $('#addDiscipline')?.addEventListener('click', () => {
    const state = store.state;
    if (!state || !ui.bubbleStudentId) return;
    const button = $('#addDiscipline') as HTMLButtonElement | null;
    if (button?.disabled) return;
    if (button) button.disabled = true;
    const date = ($('#disciplineDate') as HTMLInputElement | null)?.value || todayISO();
    const reason = ($('#disciplineReason') as HTMLTextAreaElement | null)?.value.trim() ?? '';
    void store
      .addDiscipline(ui.bubbleStudentId, ui.discType, reason, date)
      .then(() => {
        const field = $('#disciplineReason') as HTMLTextAreaElement | null;
        if (field) field.value = '';
        renderBubbles(store);
        toast(`已添加：${ui.discType}`);
      })
      .catch((error: Error) => toast(error.message))
      .finally(() => {
        if (button) button.disabled = false;
      });
  });

  $('#disciplineList')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-del-disc]');
    const state = store.state;
    if (!button || !state || !ui.bubbleStudentId) return;
    const recordId = button.dataset.delDisc ?? '';
    const records = state.discipline?.[ui.bubbleStudentId] ?? [];
    const index = records.findIndex((record) => record.id === recordId);
    if (index < 0) return;
    const snapshot = { studentId: ui.bubbleStudentId, index, record: records[index] };
    void store
      .removeDiscipline(ui.bubbleStudentId, recordId)
      .then(() => {
        ui.lastDeletedDiscipline = snapshot;
        renderBubbles(store);
        toast('违纪记录已删除，可点“恢复刚删除”放回');
      })
      .catch((error: Error) => toast(error.message));
  });

  $('#undoDiscipline')?.addEventListener('click', () => {
    const state = store.state;
    if (!state || !ui.bubbleStudentId) return;
    const records = state.discipline?.[ui.bubbleStudentId] ?? [];
    if (!records.length) {
      toast('没有可撤销的违纪记录');
      return;
    }
    const last = records[records.length - 1];
    const snapshot = { studentId: ui.bubbleStudentId, index: records.length - 1, record: last };
    void store
      .removeDiscipline(ui.bubbleStudentId, last.id)
      .then(() => {
        ui.lastDeletedDiscipline = snapshot;
        renderBubbles(store);
        toast('已撤销最近一条违纪记录');
      })
      .catch((error: Error) => toast(error.message));
  });

  $('#restoreDiscipline')?.addEventListener('click', () => {
    const pending = ui.lastDeletedDiscipline;
    if (!pending) return;
    void store
      .addDiscipline(
        pending.studentId,
        pending.record.type,
        pending.record.reason,
        pending.record.date,
        pending.record.room ?? '',
      )
      .then(() => {
        ui.lastDeletedDiscipline = null;
        renderBubbles(store);
        toast('已恢复刚才删除的违纪记录');
      })
      .catch((error: Error) => toast(error.message));
  });

  $('#scoreHistory')?.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    if (select.id === 'bubbleDetailSubject') {
      ui.bubbleDetailSubject = select.value;
      renderBubbles(store);
    }
  });

  $('#scoreHistory')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const subjectButton = target.closest<HTMLElement>('[data-chart-subject]');
    if (subjectButton) {
      ui.bubbleSubject = subjectButton.dataset.chartSubject ?? '';
      renderBubbles(store);
      return;
    }
    const rankButton = target.closest<HTMLElement>('[data-rank-mode]');
    if (rankButton) {
      ui.bubbleRankMode = (rankButton.dataset.rankMode as 'school' | 'class') ?? 'school';
      renderBubbles(store);
    }
  });

  $('#scoreHistory')?.addEventListener('mouseover', showRankTooltip);
  $('#scoreHistory')?.addEventListener('mousemove', showRankTooltip);
  $('#scoreHistory')?.addEventListener('mouseout', hideRankTooltip);

  // 点击气泡与座位/学生行以外的空白处 → 自动收起
  // 注意：气泡内点击会立即重渲染（DOM 被替换），此时 event.target 已脱离文档，
  // closest() 会失效，所以改用事件路径（composedPath）判断是否发生在气泡内。
  document.addEventListener('click', (event) => {
    if (!ui.bubbleStudentId) return;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    // 拿不到事件路径时不做判断，避免误关（旧浏览器兜底）
    if (!path.length) return;
    const isElement = (node: EventTarget): node is HTMLElement => node instanceof HTMLElement;
    const insideBubble = path.some(
      (node) => isElement(node) && (node.classList.contains('bubble') || node.id === 'studentBubbles'),
    );
    if (insideBubble) return;
    const onAnchor = path.some(
      (node) => isElement(node) && (node.dataset.student || node.dataset.seat || node.dataset.openStudent),
    );
    if (onAnchor) return;
    if (path.some((node) => isElement(node) && node.tagName === 'DIALOG')) return;
    closeStudentBubbles();
  });

  const follow = (): void => {
    if (!ui.bubbleStudentId) return;
    schedulePosition();
  };
  window.addEventListener('scroll', follow, true);
  window.addEventListener('resize', follow);

  for (const button of $all('[data-close-bubbles]')) {
    button.addEventListener('click', closeStudentBubbles);
  }
  $('#studentBubbles')?.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).id === 'studentBubbles') closeStudentBubbles();
  });
}

/* ---------------- 违纪文字快速导入 ---------------- */

export function openDisciplineImport(store: Store): void {
  const state = store.state;
  if (!state) return;
  openModal(
    '快速导入违纪记录',
    '<p>把备忘录里的文字直接粘贴进来，每行一条。可写成“9月20日 张三 晚自习违纪”“2026-10-11 李四、王五 迟到”“张三 眼操”。姓名按班级名单匹配，类型支持晚自习／静校／早自习／迟到／眼操／午休／寝室／水杯等简称；缺日期时用下面的默认日期。</p>' +
      `<div class="form-row"><div class="field"><label for="discDefaultDate">缺省日期</label><input id="discDefaultDate" type="date" value="${todayISO()}"></div>` +
      '<div class="field" style="justify-content:flex-end"><label class="switch-label"><input type="checkbox" id="discSkipDup">跳过库中已存在的相同记录</label>' +
      '<span style="font-size:11px;color:var(--muted)">默认不勾选：同一天多次违纪会各记一条</span></div></div>' +
      '<div class="field"><label for="discText">粘贴文字（每行一条）</label><textarea id="discText" style="min-height:150px;width:100%" placeholder="9月20日 张三 晚自习违纪&#10;9月21日 李四、王五 迟到"></textarea></div>' +
      '<div id="discParseNotice" class="notice" style="display:none"></div><div id="discParsePreview" class="preview"></div>',
    '<button data-close>取消</button><button class="primary" id="discImportCommit" disabled>导入</button>',
  );

  let parsed = parseDisciplineText('', '', state.students);
  const commit = $('#discImportCommit') as HTMLButtonElement | null;

  const preview = (): void => {
    const text = ($('#discText') as HTMLTextAreaElement | null)?.value ?? '';
    const defaultDate = ($('#discDefaultDate') as HTMLInputElement | null)?.value ?? '';
    parsed = parseDisciplineText(text, defaultDate, state.students);
    const stats = summariseDiscipline(parsed);
    if (commit) commit.disabled = stats.ok === 0;
    const notice = $('#discParseNotice');
    if (notice) {
      notice.style.display = parsed.length ? 'block' : 'none';
      notice.className = `notice${stats.ok === stats.total ? '' : ' error'}`;
      notice.textContent = parsed.length
        ? `共 ${stats.total} 行，可导入 ${stats.ok} 条${stats.invalid ? `，${stats.invalid} 行需要修改（不会导入）` : ''}`
        : '';
    }
    setHTML(
      '#discParsePreview',
      parsed.length
        ? '<table><thead><tr><th>日期</th><th>学生</th><th>类型</th><th>备注</th><th>状态</th></tr></thead><tbody>' +
          parsed
            .slice(0, 100)
            .map(
              (row) =>
                `<tr><td>${esc(row.date || '—')}</td><td>${esc(row.student?.name ?? row.name ?? row.raw.slice(0, 24))}</td>` +
                `<td>${esc(row.type || '—')}</td><td>${esc(row.reason || '—')}</td><td>${esc(row.status)}</td></tr>`,
            )
            .join('') +
          '</tbody></table>'
        : '',
    );
  };

  $('#discText')?.addEventListener('input', preview);
  $('#discDefaultDate')?.addEventListener('change', preview);
  commit?.addEventListener('click', () => {
    const records = parsed
      .filter((row) => row.ok && row.student && row.type)
      .map((row) => ({
        studentId: row.student?.id ?? '',
        date: row.date,
        type: row.type as string,
        reason: row.reason,
      }));
    if (!records.length) return;
    const skipDuplicates = ($('#discSkipDup') as HTMLInputElement | null)?.checked ?? false;
    void store
      .importDiscipline(records, skipDuplicates)
      .then(() => {
        closeModal();
        toast(`已导入 ${records.length} 条违纪记录`);
      })
      .catch((error: Error) => toast(error.message));
  });
  preview();
}

export function refreshOpenBubble(store: Store): void {
  if (ui.bubbleStudentId) renderBubbles(store);
}

export type { AppState };
