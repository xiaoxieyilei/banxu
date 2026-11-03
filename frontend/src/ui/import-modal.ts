import type { Store } from '../store.js';
import type { PdfExamParse, Student } from '../types.js';
import { api } from '../api.js';
import { todayISO } from '../lib/dates.js';
import {
  buildTemplateWorkbook,
  downloadWorkbook,
  parseExamSheet,
  parseRosterSheet,
  readWorkbook,
  sheetRows,
  type Workbook,
} from '../lib/excel.js';
import { mapPdfRows, type PdfParsedExam } from '../lib/pdf-exam.js';
import { $, esc, closeModal, openModal, setHTML, toast } from './dom.js';
import { ui } from './state.js';

export function downloadTemplate(store: Store): void {
  const students = store.state?.students ?? [];
  downloadWorkbook(buildTemplateWorkbook(students), '班序_导入模板');
  toast('已下载模板：名单、十科成绩与填写说明（成绩表已预填当前学号姓名）');
}

export function openImportModal(store: Store, kind: 'roster' | 'exam'): void {
  ui.importState = { kind, workbook: null };
  ui.parsedRoster = null;
  ui.parsedExam = null;
  const examFields =
    kind === 'exam'
      ? '<div class="form-row"><div class="field"><label for="examName">考试名称（必填）</label>' +
        '<input id="examName" required maxlength="80" placeholder="例如：高一上学期第一次月考"></div>' +
        '<div class="field"><label for="examDate">考试时间（必填）</label><input id="examDate" type="date" required>' +
        '<span style="font-size:11px;color:var(--muted);margin-top:4px">用于按时间排序、管理历次考试</span></div></div>' +
        '<div class="form-row"><label class="switch-label"><input type="checkbox" id="overwriteExam">覆盖同名同日期考试（替换该场成绩）</label></div>'
      : '';
  const intro =
    kind === 'roster'
      ? '按学号匹配：已有学生更新资料，新学生追加，原有座位和成绩保留。'
      : '支持班序模板、学校网站成绩汇总表，以及学校「学生成绩单」PDF。Excel 会自动读取各科得分、总分及校次／班次排名；PDF 按姓名匹配，导入单科总分并自动计算班级排名（逐题得分暂不保存）。每次导入都会新增一场考试。';
  openModal(
    kind === 'roster' ? '导入学生名单' : '导入考试成绩',
    `<p>${esc(intro)}</p><button id="modalTemplate" class="small">↓ 下载 Excel 模板</button>
     <div class="upload"><b>选择 ${kind === 'exam' ? 'Excel 或 PDF' : 'Excel'} 文件</b><br><span style="font-size:12px;color:var(--muted)">支持 ${
       kind === 'exam' ? '.xlsx / .xls / .csv / .pdf' : '.xlsx / .xls / .csv'
     }</span><br>
     <input id="excelFile" type="file" accept="${kind === 'exam' ? '.xlsx,.xls,.csv,.pdf' : '.xlsx,.xls,.csv'}"></div>${examFields}
     <div id="pdfSubjectRow" class="form-row hidden"><div class="field"><label for="pdfSubject">科目（PDF 自动识别，可修改）</label><select id="pdfSubject"><option>语文</option><option>数学</option><option>英语</option><option>物理</option><option>化学</option><option>生物</option><option>政治</option><option>历史</option><option>地理</option><option>技术</option><option>总分</option><option>成绩</option></select><span style="font-size:11px;color:var(--muted);margin-top:4px">仅影响这一场考试写入的科目名</span></div></div>
     <div id="importOptions" class="hidden"><div class="form-row"><div class="field"><label>工作表</label><select id="sheetSelect"></select></div></div>
     <div id="importNotice"></div><div id="importPreview" class="preview"></div></div>`,
    '<button data-close>取消</button><button class="primary" id="commitImport" disabled>确认导入</button>',
  );

  $('#modalTemplate')?.addEventListener('click', () => downloadTemplate(store));

  const commit = $('#commitImport') as HTMLButtonElement | null;
  const fileInput = $('#excelFile') as HTMLInputElement | null;

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (commit) commit.disabled = true;
    $('#importOptions')?.classList.add('hidden');
    $('#pdfSubjectRow')?.classList.add('hidden');
    setHTML('#importPreview', '');
    setHTML('#importNotice', '');
    ui.parsedExam = null;
    ui.parsedRoster = null;
    if (file.size > 20 * 1024 * 1024) {
      toast('请选择小于 20 MB 的文件');
      return;
    }
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      await previewPdf(store, file, kind, commit);
      if (fileInput) fileInput.value = '';
      return;
    }
    try {
      const workbook: Workbook = readWorkbook(await file.arrayBuffer());
      ui.importState = { kind, workbook, fileName: file.name, source: 'excel' };
      if (fileInput) fileInput.value = '';
      const select = $('#sheetSelect') as HTMLSelectElement | null;
      if (select) {
        select.innerHTML = workbook.SheetNames.map((name) => `<option>${esc(name)}</option>`).join('');
        const preferred = workbook.SheetNames.find((name) =>
          kind === 'roster' ? /名单|学生/.test(name) : /成绩|考试/.test(name),
        );
        if (preferred) select.value = preferred;
      }
      const nameInput = $('#examName') as HTMLInputElement | null;
      if (nameInput) nameInput.value = file.name.replace(/\.[^.]+$/, '');
      const dateInput = $('#examDate') as HTMLInputElement | null;
      if (dateInput && !dateInput.value) {
        const guess = file.name.match(/20\d{6}/)?.[0] ?? '';
        if (guess) {
          const iso = `${guess.slice(0, 4)}-${guess.slice(4, 6)}-${guess.slice(6, 8)}`;
          dateInput.value = iso;
        }
      }
      $('#importOptions')?.classList.remove('hidden');
      if (select) select.onchange = () => previewSheet(store, workbook, select.value, kind, commit);
      previewSheet(store, workbook, select?.value ?? workbook.SheetNames[0], kind, commit);
    } catch {
      toast('文件无法读取，请使用有效的 Excel 或 CSV 文件。');
    }
  });

  $('#pdfSubject')?.addEventListener('change', (event) => {
    const parsed = ui.importState?.pdf;
    if (!parsed) return;
    applyPdfMapping(store, parsed, (event.target as HTMLSelectElement).value, commit);
  });

  commit?.addEventListener('click', () => {
    const state = store.state;
    if (!state) return;
    if (kind === 'roster') {
      const parsed = ui.parsedRoster as { records: Student[]; errors: string[] } | null;
      if (!parsed?.records.length) return;
      if (commit) commit.disabled = true; // 校验通过后才禁用，避免填错后按钮永久不可用
      void store
        .importRoster(parsed.records)
        .then(() => {
          closeModal();
          toast(`已导入 ${parsed.records.length} 位学生`);
        })
        .catch((error: Error) => {
          toast(error.message);
          if (commit) commit.disabled = false;
        });
      return;
    }
    const parsed = ui.parsedExam as
      | { subjects: string[]; scores: Record<string, Record<string, number | null>>; ranks: Record<string, any>; errors: string[]; matched: number }
      | null;
    const name = ($('#examName') as HTMLInputElement | null)?.value.trim() ?? '';
    const date = ($('#examDate') as HTMLInputElement | null)?.value ?? '';
    if (!name) {
      toast('请填写考试名称');
      return;
    }
    if (!date) {
      toast('请选择考试时间');
      return;
    }
    if (!parsed?.matched) return;
    const duplicate = state.exams.find((exam) => exam.name === name && exam.date === date);
    const overwrite = ($('#overwriteExam') as HTMLInputElement | null)?.checked ?? false;
    if (duplicate && !overwrite) {
      toast('已存在同名同日期的考试：请修改名称/日期，或勾选「覆盖同名同日期考试」。');
      return;
    }
    if (commit) commit.disabled = true;
    const source = ui.importState?.source === 'pdf' ? 'PDF 导入' : 'Excel 导入';
    const pdf = ui.importState?.source === 'pdf' ? ui.importState.pdf : undefined;
    const subject = parsed.subjects[0];
    const pdfFullMarks =
      pdf?.fullMarks && pdf.fullMarks > 0 && subject ? { [subject]: pdf.fullMarks } : {};
    const fullMarks = Object.keys(pdfFullMarks).length ? pdfFullMarks : duplicate?.fullMarks ?? {};
    const exam = {
      name,
      date,
      subjects: parsed.subjects,
      scores: parsed.scores,
      ranks: parsed.ranks,
      sourceFormat: source,
      fullMarks,
    };
    const action = duplicate ? store.replaceExam(duplicate.id, exam) : store.addExam(exam);
    void action
      .then(() => {
        closeModal();
        toast(duplicate ? `已覆盖「${name}」的成绩` : `已导入 ${parsed.matched} 位学生的成绩`);
      })
      .catch((error: Error) => {
        toast(error.message);
        if (commit) commit.disabled = false;
      });
  });
}

/** 从文件名 `(语文)` 或工作表名 `班级语文成绩简表` 里推断科目。 */
export function detectSubjectHint(fileName: string, sheetName: string): string {
  const subjects = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '技术'];
  const bracket = fileName.match(/[（(]([^）)]+)[）)]/g)?.pop() ?? '';
  const fromBracket = subjects.find((subject) => bracket.includes(subject));
  if (fromBracket) return fromBracket;
  const fromName = fileName.match(new RegExp(`(${subjects.join('|')})`))?.[1];
  if (fromName) return fromName;
  const fromSheet = sheetName.match(new RegExp(`班级(${subjects.join('|')})`))?.[1];
  return fromSheet ?? '';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return btoa(chunks.join(''));
}

function renderPdfPreview(parsed: PdfParsedExam): void {
  const rows = parsed.preview.slice(0, 60);
  setHTML(
    '#importPreview',
    `<table><thead><tr><th>姓名</th><th>学号</th><th>${esc(parsed.subjects[0])}总分</th></tr></thead><tbody>${rows
      .map((row) => `<tr><td>${esc(row.name)}</td><td>${esc(row.id)}</td><td>${row.total}</td></tr>`)
      .join('')}</tbody></table>` +
      (parsed.preview.length > rows.length
        ? `<p style="padding:8px 12px;color:var(--muted);font-size:12px">…共 ${parsed.preview.length} 位学生</p>`
        : ''),
  );
}

function applyPdfMapping(
  store: Store,
  parsed: PdfExamParse,
  subject: string,
  commit: HTMLButtonElement | null,
): void {
  const state = store.state;
  if (!state) return;
  const mapping = mapPdfRows(parsed.rows, state.students, subject);
  ui.parsedExam = mapping;
  const notice = $('#importNotice');
  const lines = [
    `已识别 ${parsed.pageCount} 页 · ${parsed.rows.length} 位学生 · 科目「${mapping.subjects[0]}」 · 确认后自动计算班次${
      parsed.fullMarks ? ` · 满分 ${parsed.fullMarks}` : ''
    }`,
    ...parsed.warnings,
    ...mapping.warnings,
  ];
  if (mapping.errors.length) {
    lines.unshift(`有 ${mapping.errors.length} 处问题，请处理后重新选择文件：`, ...mapping.errors.slice(0, 8));
  }
  if (notice) {
    notice.innerHTML = `<div class="notice ${mapping.errors.length ? 'error' : ''}">${esc(lines.join('\n'))}</div>`;
    notice.title = [...mapping.errors, ...parsed.warnings, ...mapping.warnings].join('\n');
  }
  renderPdfPreview(mapping);
  if (commit) commit.disabled = mapping.errors.length > 0 || mapping.matched === 0;
}

/** 学校「学生成绩单」PDF：后端解析文字与表格，前端按姓名匹配并走同一套预览/确认流程。 */
async function previewPdf(
  store: Store,
  file: File,
  kind: 'roster' | 'exam',
  commit: HTMLButtonElement | null,
): Promise<void> {
  if (kind !== 'exam') {
    toast('PDF 仅用于导入考试成绩');
    return;
  }
  const state = store.state;
  if (!state) return;
  try {
    const parsed: PdfExamParse = await api.parsePdfExam(file.name, arrayBufferToBase64(await file.arrayBuffer()));
    ui.importState = { kind, workbook: null, fileName: file.name, source: 'pdf', pdf: parsed };

    const nameInput = $('#examName') as HTMLInputElement | null;
    if (nameInput) nameInput.value = parsed.examName || file.name.replace(/\.[^.]+$/, '');
    const dateInput = $('#examDate') as HTMLInputElement | null;
    if (dateInput && !dateInput.value) {
      const guess = file.name.match(/20\d{6}/)?.[0] ?? '';
      if (guess) {
        dateInput.value = `${guess.slice(0, 4)}-${guess.slice(4, 6)}-${guess.slice(6, 8)}`;
      }
    }

    const subjectSelect = $('#pdfSubject') as HTMLSelectElement | null;
    const detected = parsed.subject || '成绩';
    if (subjectSelect) {
      if (![...subjectSelect.options].some((option) => option.value === detected)) {
        subjectSelect.add(new Option(detected, detected));
      }
      subjectSelect.value = detected;
    }
    $('#pdfSubjectRow')?.classList.remove('hidden');
    applyPdfMapping(store, parsed, detected, commit);
  } catch (error) {
    ui.importState = null;
    ui.parsedExam = null;
    $('#pdfSubjectRow')?.classList.add('hidden');
    setHTML('#importPreview', '');
    setHTML(
      '#importNotice',
      `<div class="notice error">${esc((error as Error).message || 'PDF 解析失败')}</div>`,
    );
    if (commit) commit.disabled = true;
    toast((error as Error).message || 'PDF 解析失败');
  }
}

function previewSheet(
  store: Store,
  workbook: Workbook,
  sheetName: string,
  kind: 'roster' | 'exam',
  commit: HTMLButtonElement | null,
): void {
  const state = store.state;
  if (!state) return;
  const rows = sheetRows(workbook, sheetName);
  const notice = $('#importNotice');
  if (kind === 'roster') {
    const parsed = parseRosterSheet(rows, state.students);
    ui.parsedRoster = parsed;
    const added = parsed.records.filter((record) => !state.students.some((student) => student.id === record.id)).length;
    if (notice) {
      notice.innerHTML = `<div class="notice ${parsed.errors.length ? 'error' : ''}">${esc(
        parsed.errors.length
          ? `发现 ${parsed.errors.length} 处问题，请修改 Excel 后重新选择文件：\n${parsed.errors.slice(0, 8).join('\n')}`
          : `可以导入 ${parsed.records.length} 位学生（新增 ${added} 人，其余更新）。`,
      )}</div>`;
    }
    if (commit) commit.disabled = parsed.errors.length > 0 || parsed.records.length === 0;
  } else {
    const subjectHint = detectSubjectHint(ui.importState?.fileName ?? '', sheetName);
  const parsed = parseExamSheet(rows, state.students, { subject: subjectHint });
    ui.parsedExam = parsed;
    const messages = [...parsed.errors, ...parsed.warnings];
    if (notice) {
      notice.innerHTML = `<div class="notice ${parsed.errors.length ? 'error' : ''}">${esc(
        parsed.errors.length
          ? `发现 ${parsed.errors.length} 处问题：\n${parsed.errors.slice(0, 8).join('\n')}`
          : `可导入 ${parsed.matched} 位学生的成绩。\n${parsed.warnings.join('\n')}`,
      )}</div>`;
      notice.title = messages.join('\n');
    }
    if (commit) commit.disabled = parsed.errors.length > 0 || parsed.matched === 0;
  }
  setHTML(
    '#importPreview',
    '<table>' +
      rows
        .slice(0, 7)
        .map(
          (row, index) =>
            '<tr>' +
            (row as unknown[]).slice(0, 13).map((cell) => (index === 0 ? `<th>${esc(cell)}</th>` : `<td>${esc(cell)}</td>`)).join('') +
            '</tr>',
        )
        .join('') +
      '</table>',
  );
}

export function defaultExamDate(): string {
  return todayISO();
}
