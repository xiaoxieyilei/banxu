import type { Exam } from '../types.js';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 把 2026-10-11 / 2026/9/5 / 2026年9月5日 / 20261011 统一成 YYYY-MM-DD；无法解析返回空串。 */
export function toISODate(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  let match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (match) {
    return normalise(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) {
    return normalise(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  return '';
}

function normalise(year: number, month: number, day: number): string {
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidISODate(candidate) ? candidate : '';
}

export function todayISO(): string {
  // 用本地时区取“今天”，避免 UTC 时区导致北京时间 0–8 点拿到昨天
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

/** 考试按时间倒序：同一天按导入顺序（后端已排好）保持稳定。 */
export function sortExams(exams: Exam[]): Exam[] {
  return [...exams].sort((a, b) => toISODate(b.date).localeCompare(toISODate(a.date)));
}

export function examDateLabel(exam: Exam | undefined): string {
  return exam ? toISODate(exam.date) || '未设置时间' : '未设置时间';
}

export function isValidISODate(value: string): boolean {
  const match = value.match(ISO_RE);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
