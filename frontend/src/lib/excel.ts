import type { Rank, Student } from '../types.js';

/* SheetJS 通过 index.html 中的 <script> 以 UMD 方式加载，这里只做类型声明。 */
declare const XLSX: {
  read(data: ArrayBuffer, options?: Record<string, unknown>): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: {
    sheet_to_json(sheet: unknown, options?: Record<string, unknown>): unknown[][];
    aoa_to_sheet(rows: unknown[][]): unknown;
    book_new(): unknown;
    book_append_sheet(book: unknown, sheet: unknown, name: string): void;
  };
  write(wb: unknown, options: Record<string, unknown>): ArrayBuffer;
  writeFile(wb: unknown, filename: string): void;
};

export type Workbook = { SheetNames: string[]; Sheets: Record<string, unknown> };

export const SUBJECT_TEMPLATE = [
  '语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '技术', '总分',
];

const ALIASES: Record<string, string[]> = {
  id: ['学号', '学生学号', '考号', '准考证号', '学生编号', '编号', 'id', 'studentid'],
  name: ['姓名', '学生姓名', '名字', 'name'],
  gender: ['性别', 'gender'],
  note: ['备注', '说明', 'note'],
};

const META_HEADERS = new Set([
  ...Object.values(ALIASES).flat(),
  '序号', '排名', '班级', '总排名', '班级排名', '年级排名',
]);

const normalize = (value: unknown): string => String(value ?? '').trim().replace(/\s/g, '').toLowerCase();
const text = (value: unknown): string => (value == null ? '' : String(value).trim());
const EMPTY_SYMBOLS = new Set(['缺考', '未考', '未录入', '未扫，不计排名', '—', '-', '免考']);

export interface ParsedRoster {
  records: Student[];
  errors: string[];
}

export interface ParsedExam {
  subjects: string[];
  scores: Record<string, Record<string, number | null>>;
  ranks: Record<string, Record<string, Rank>>;
  errors: string[];
  warnings: string[];
  matched: number;
  schoolFormat: boolean;
}

export function readWorkbook(buffer: ArrayBuffer): Workbook {
  return XLSX.read(buffer, { type: 'array' });
}

export function sheetRows(workbook: Workbook, sheetName: string): unknown[][] {
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true,
  });
}

export function parseRosterSheet(rows: unknown[][], existing: Student[]): ParsedRoster {
  const errors: string[] = [];
  if (!rows || rows.length < 2) {
    return { records: [], errors: ['工作表没有数据，请在表头下填写学生信息。'] };
  }
  const headers = (rows[0] ?? []).map(normalize);
  const columns: Record<string, number> = {};
  for (const [key, names] of Object.entries(ALIASES)) {
    columns[key] = headers.findIndex((header) => names.includes(header));
  }
  if (columns.id < 0 || columns.name < 0) {
    return { records: [], errors: ['名单必须包含“学号”和“姓名”列。'] };
  }
  const records: Student[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.every((cell) => text(cell) === '')) continue;
    const lineNo = index + 1;
    const id = text(row[columns.id]);
    const name = text(row[columns.name]);
    if (!id || !name) {
      errors.push(`第 ${lineNo} 行：学号和姓名不能为空。`);
      continue;
    }
    if (id.length > 64 || name.length > 100) {
      errors.push(`第 ${lineNo} 行：学号或姓名过长。`);
      continue;
    }
    if (seen.has(id)) {
      errors.push(`第 ${lineNo} 行：学号 ${id} 重复。`);
      continue;
    }
    seen.add(id);
    const previous = existing.find((student) => student.id === id);
    records.push({
      id,
      name,
      gender: columns.gender < 0 ? previous?.gender ?? '' : text(row[columns.gender]),
      note: columns.note < 0 ? previous?.note ?? '' : text(row[columns.note]),
      dorm: previous?.dorm ?? '',
    });
  }
  if (!records.length && !errors.length) errors.push('没有可导入的数据。');
  return { records, errors };
}

/** 兼容班序模板与学校网站“班级全学科成绩汇总”表（两行表头 + 得分/校次/班次）。 */
export interface ExamParseHint {
  /** 文件名或工作表名里推断出的科目（单科成绩表没有科目表头行时使用） */
  subject?: string;
}

const KNOWN_SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '技术', '总分'];
const looksLikeSingleHeader = (row: string[]): boolean =>
  row.includes('序号') &&
  (row.includes('姓名') || row.includes('准考证号')) &&
  (row.includes('得分') || row.includes('总分'));

const scoreColumnIndex = (header: string[]): number =>
  header.includes('得分') ? header.indexOf('得分') : header.indexOf('总分');

export function parseExamSheet(rows: unknown[][], students: Student[], hint: ExamParseHint = {}): ParsedExam {
  const errors: string[] = [];
  const warnings: string[] = [];
  const result: ParsedExam = { subjects: [], scores: {}, ranks: {}, errors, warnings, matched: 0, schoolFormat: false };
  if (!rows || rows.length < 2) {
    errors.push('工作表没有数据，请在表头下填写成绩。');
    return result;
  }
  const row1 = (rows[1] ?? []).map(text);
  const row2 = (rows[2] ?? []).map(text);
  const schoolFormat =
    row1.includes('序号') && (row1.includes('准考证号') || row1.includes('姓名')) && row2.includes('得分');

  // 学校导出的单科成绩表：第 1 行是标题，第 2 行是表头（序号/准考证号/姓名/得分/校次/班次），科目名只写在文件名里
  let singleHeaderIndex = -1;
  if (!schoolFormat) {
    for (let index = 0; index < Math.min(rows.length, 3); index += 1) {
      if (looksLikeSingleHeader((rows[index] ?? []).map(text))) {
        singleHeaderIndex = index;
        break;
      }
    }
  }

  interface SubjectColumn { name: string; score: number; school: number; klass: number }
  let subjectColumns: SubjectColumn[] = [];
  let dataStart = 1;
  let columns: Record<string, number> = {};

  if (singleHeaderIndex >= 0) {
    const header = (rows[singleHeaderIndex] ?? []).map(text);
    const subject = (hint.subject || '').trim() || KNOWN_SUBJECTS.find((name) => header.some((cell) => cell.includes(name))) || '成绩';
    const scoreIndex = scoreColumnIndex(header);
    const schoolIndex = header.findIndex((cell) => cell === '校次');
    const classIndex = header.findIndex((cell) => cell === '班次');
    subjectColumns.push({ name: subject, score: scoreIndex, school: schoolIndex, klass: classIndex });
    columns = {
      id: header.findIndex((cell) => ALIASES.id.includes(normalize(cell))),
      name: header.findIndex((cell) => ALIASES.name.includes(normalize(cell))),
    };
    dataStart = singleHeaderIndex + 1;
    result.schoolFormat = true;
    warnings.push(`已识别单科成绩表：科目按文件名/工作表推断为「${subject}」，按姓名匹配学生。`);
  } else if (schoolFormat) {
    result.schoolFormat = true;
    dataStart = 3;
    let current = '';
    for (let index = 0; index < row1.length; index += 1) {
      if (row1[index]) current = /^(总成绩|合计|total)$/i.test(row1[index]) ? '总分' : row1[index];
      if (!current || !row2[index]) continue;
      if (row2[index] === '得分') {
        subjectColumns.push({ name: current, score: index, school: -1, klass: -1 });
      } else if (row2[index] === '校次' || row2[index] === '校次进退步') {
        const last = subjectColumns[subjectColumns.length - 1];
        if (last) last.school = index;
      } else if (row2[index] === '班次' || row2[index] === '班次进退步') {
        const last = subjectColumns[subjectColumns.length - 1];
        if (last) last.klass = index;
      }
    }
    columns = {
      id: row1.findIndex((header) => ALIASES.id.includes(normalize(header))),
      name: row1.findIndex((header) => ALIASES.name.includes(normalize(header))),
    };
    warnings.push('已识别学校成绩汇总表：自动读取得分及校次、班次排名。');
  } else {
    const headers = (rows[0] ?? []).map(text);
    const normalized = headers.map(normalize);
    columns = {
      id: normalized.findIndex((header) => ALIASES.id.includes(header)),
      name: normalized.findIndex((header) => ALIASES.name.includes(header)),
    };
    headers.forEach((header, index) => {
      if (!header || META_HEADERS.has(normalize(header))) return;
      subjectColumns.push({ name: /^(总成绩|合计|total)$/i.test(header) ? '总分' : header, score: index, school: -1, klass: -1 });
    });
  }

  if (columns.id < 0 && columns.name < 0) errors.push('成绩表必须包含“学号”或“姓名”列。');
  if (!subjectColumns.length) errors.push('未找到成绩列，请使用班序模板或学校成绩汇总表。');
  const names = subjectColumns.map((column) => column.name);
  if (new Set(names).size !== names.length) errors.push('科目名称重复，请为每列设置唯一表头。');
  if (errors.length) return result;

  // 单科成绩表本身就只有一科，不需要再自动生成“总分”列
  const autoTotal = singleHeaderIndex < 0 && !names.includes('总分');
  const subjects = autoTotal ? [...names, '总分'] : [...names];
  result.subjects = subjects;

  const byId = new Map(students.map((student) => [student.id, student]));
  const byName = new Map<string, Student[]>();
  for (const student of students) {
    byName.set(student.name, [...(byName.get(student.name) ?? []), student]);
  }
  const seen = new Set<string>();

  for (let index = dataStart; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.every((cell) => text(cell) === '')) continue;
    const lineNo = index + 1;
    const rawId = columns.id >= 0 ? text(row[columns.id]) : '';
    const rawName = columns.name >= 0 ? text(row[columns.name]) : '';
    let student: Student | undefined;
    if (rawId) student = byId.get(rawId);
    if (!student && rawName) {
      const matches = byName.get(rawName) ?? [];
      if (matches.length > 1) {
        errors.push(`第 ${lineNo} 行：${rawName} 存在同名学生，请填写学号。`);
        continue;
      }
      student = matches[0];
    }
    if (!student) {
      errors.push(`第 ${lineNo} 行：${rawName || rawId || '空记录'} 未匹配到已导入学生。`);
      continue;
    }
    if (rawName && rawName !== student.name) {
      errors.push(`第 ${lineNo} 行：学号 ${rawId} 的姓名与名单不一致。`);
      continue;
    }
    if (seen.has(student.id)) {
      errors.push(`第 ${lineNo} 行：${student.name} 的成绩重复。`);
      continue;
    }
    seen.add(student.id);

    const scores: Record<string, number | null> = {};
    const ranks: Record<string, Rank> = {};
    for (const column of subjectColumns) {
      const raw = text(row[column.score]);
      if (!raw || EMPTY_SYMBOLS.has(raw)) {
        scores[column.name] = null;
      } else {
        const value = Number(raw.replace(/,/g, ''));
        if (!Number.isFinite(value) || value < 0) {
          errors.push(`第 ${lineNo} 行，${column.name}：成绩“${raw}”不是有效数字。`);
          scores[column.name] = null;
        } else {
          scores[column.name] = value;
        }
      }
      if (result.schoolFormat) {
        const school = column.school >= 0 ? Number(text(row[column.school])) : NaN;
        const klass = column.klass >= 0 ? Number(text(row[column.klass])) : NaN;
        ranks[column.name] = {
          school: Number.isFinite(school) && school > 0 ? school : null,
          class: Number.isFinite(klass) && klass > 0 ? klass : null,
        };
      }
    }
    if (autoTotal) {
      const complete = subjectColumns.every((column) => scores[column.name] !== null);
      scores['总分'] = complete
        ? Math.round(subjectColumns.reduce((sum, column) => sum + Number(scores[column.name]), 0) * 100) / 100
        : null;
    }
    result.scores[student.id] = scores;
    if (Object.keys(ranks).length) result.ranks[student.id] = ranks;
    result.matched += 1;
  }

  if (autoTotal) warnings.push('未提供总分列，已自动求和；存在缺考科目时总分留空。');
  if (result.matched < students.length) {
    warnings.push(`本表包含 ${result.matched} 位学生，其余学生在本次考试显示为未录入。`);
  }
  if (!result.matched && !errors.length) errors.push('没有可导入的成绩。');
  return result;
}

/** 生成导入模板：名单、十科成绩（自动带当前班级学号姓名）、填写说明。 */
export function buildTemplateWorkbook(students: Student[]): unknown {
  const book = XLSX.utils.book_new();
  const roster = [['学号', '姓名', '性别', '备注']];
  const scores: unknown[][] = [['学号', '姓名', ...SUBJECT_TEMPLATE]];
  for (const student of students) scores.push([student.id, student.name, ...Array(SUBJECT_TEMPLATE.length).fill('')]);
  const guide: unknown[][] = [
    ['项目', '说明'],
    ['填写顺序', '先导入学生名单，再导入考试成绩。'],
    ['学号', '每名学生唯一学号，建议设置为文本以保留前导 0。'],
    ['考试时间', '导入成绩时必填，用于按时间排序与管理历次考试。'],
    ['科目', '默认十科；可自行增删科目列，未考科目留空或写“缺考”。'],
    ['总分', '保留总分列时按填写的总分；删除后自动求和，缺考科目使总分留空。'],
    ['学校成绩表', '也可以直接上传学校网站下载的成绩汇总表，软件会自动识别得分与排名。'],
    ['违纪记录', '在“违纪情况”页用“快速导入”粘贴备忘录文字，逐行识别日期、姓名与类型。'],
  ];
  for (const [name, rows] of [['学生名单', roster], ['考试成绩', scores], ['填写说明', guide]] as const) {
    const sheet = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  return book;
}

export function downloadBlob(filename: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadWorkbook(book: unknown, filename: string): void {
  const buffer = XLSX.write(book, { bookType: 'xlsx', type: 'array' });
  downloadBlob(`${filename}.xlsx`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

export function workbookFromSheets(sheets: Array<[string, unknown[][]]>): unknown {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return book;
}
