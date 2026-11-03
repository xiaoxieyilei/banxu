import type { Student } from '../types.js';
import { isValidISODate, toISODate } from './dates.js';

/** 违纪类型：默认第一条“晚自习违纪”最常用。 */
export const DISCIPLINE_TYPES = [
  '晚自习违纪',
  '晚自习静校期间违纪',
  '早自习违纪',
  '迟到违纪',
  '眼保健操违纪',
  '午休违纪',
  '寝室违纪',
  '带水杯进教室',
] as const;

export type DisciplineType = (typeof DISCIPLINE_TYPES)[number];

export const DEFAULT_DISCIPLINE_TYPE: DisciplineType = '晚自习违纪';

const ALIASES: Record<DisciplineType, string[]> = {
  晚自习违纪: ['晚自习违纪', '晚自习', '晚修违纪', '晚修'],
  晚自习静校期间违纪: ['晚自习静校期间违纪', '晚自习静校期间', '晚自习静校', '静校期间违纪', '静校违纪', '静校'],
  早自习违纪: ['早自习违纪', '早自习', '早读违纪', '早读'],
  迟到违纪: ['迟到违纪', '迟到'],
  眼保健操违纪: ['眼保健操违纪', '眼保健操', '眼操违纪', '眼操'],
  午休违纪: ['午休违纪', '午休'],
  寝室违纪: ['寝室违纪', '寝室', '宿舍违纪', '宿舍'],
  带水杯进教室: ['带水杯进教室', '带水杯', '水杯'],
};

const SORTED_ALIASES: Array<[string, DisciplineType]> = Object.entries(ALIASES)
  .flatMap(([type, aliases]) => aliases.map((alias) => [alias, type as DisciplineType] as [string, DisciplineType]))
  .sort((a, b) => b[0].length - a[0].length);

export type ParsedStatus = '可导入' | '按默认日期' | '未找到学生' | '缺少违纪类型' | '缺少日期' | '日期无效';

export interface ParsedDisciplineRow {
  raw: string;
  date: string;
  type: DisciplineType | '';
  reason: string;
  student?: Student;
  students?: Student[];
  name?: string;
  status: ParsedStatus;
  ok: boolean;
}

/** 只接受“M月D日 / M/D / M-D”，且后面不能紧跟小数、单位或数字（避免把“5.5分钟”“3-5分钟”当日期）。 */
/**
 * 只认两种无歧义的日期写法：`9月20日`（或 `9月20`）与 `10/11`。
 * 刻意不支持 `3-5` 这类短横写法——它与“3-5 分钟”“3-5 号”“13-15 号”等范围无法可靠区分；
 * 由于这两种模式本身不会匹配数字范围，不需要再对“单位”做额外判断（否则会误伤“周九/班超/时雨”等姓名）。
 */
const SHORT_DATE_PATTERNS = [/(\d{1,2})月(\d{1,2})[日号]?/, /(?<![\d.])(\d{1,2})\/(\d{1,2})(?![\d.])/];

/**
 * 解析备忘录文字：每行一条，识别日期（`2026-10-11` / `9月20日` / `10/11`）、
 * 姓名（可多个）、违纪类型，余下文字作为备注。
 * 类型别名按长度倒序匹配，避免“静校”被误判成“晚自习”。
 */
export function parseDisciplineText(
  text: string,
  defaultDate: string,
  students: Student[],
  currentYear = new Date().getFullYear(),
): ParsedDisciplineRow[] {
  const rows: ParsedDisciplineRow[] = [];
  const namePool = [...students].sort((a, b) => b.name.length - a.name.length);
  for (const raw of String(text ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    let line = raw;
    let date = '';
    let status: ParsedStatus = '可导入';
    let invalidDateText = '';

    const full = line.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (full) {
      date = toISODate(full[0]);
      line = line.replace(full[0], ' ');
    } else {
      for (const pattern of SHORT_DATE_PATTERNS) {
        const short = line.match(pattern);
        if (!short) continue;
        const iso = toISODate(`${currentYear}-${short[1]}-${short[2]}`);
        if (!iso) {
          invalidDateText = short[0];
          break;
        }
        date = iso;
        line = line.replace(short[0], ' ');
        break;
      }
    }

    let type: DisciplineType | '' = '';
    for (const [alias, aliasType] of SORTED_ALIASES) {
      if (line.includes(alias)) {
        type = aliasType;
        line = line.replace(alias, ' ');
        break;
      }
    }

    const found: Student[] = [];
    for (const student of namePool) {
      if (student.name && line.includes(student.name)) {
        if (!found.some((item) => item.id === student.id)) found.push(student);
        line = line.split(student.name).join(' ');
      }
    }
    const reason = line.replace(/[、,，。;；:：\s]+/g, ' ').trim().slice(0, 200);

    if (!date && invalidDateText) {
      rows.push({ raw, date: '', type, reason, students: found, name: found.map((s) => s.name).join('、'), status: '日期无效', ok: false });
      continue;
    }
    if (!found.length) {
      rows.push({ raw, date, type, reason, status: '未找到学生', ok: false });
      continue;
    }
    if (!type) {
      rows.push({ raw, date, type, reason, students: found, name: found.map((s) => s.name).join('、'), status: '缺少违纪类型', ok: false });
      continue;
    }
    if (!date) {
      const fallback = toISODate(defaultDate);
      if (!fallback || !isValidISODate(fallback)) {
        rows.push({ raw, date: '', type, reason, students: found, name: found.map((s) => s.name).join('、'), status: '缺少日期', ok: false });
        continue;
      }
      date = fallback;
      status = '按默认日期';
    }
    for (const student of found) {
      rows.push({ raw, date, type, reason, student, status, ok: true });
    }
  }
  return rows;
}

export function summariseDiscipline(rows: ParsedDisciplineRow[]): { total: number; ok: number; invalid: number } {
  const ok = rows.filter((row) => row.ok).length;
  return { total: rows.length, ok, invalid: rows.length - ok };
}
