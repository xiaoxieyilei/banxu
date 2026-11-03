import type { CallRange, Category, Exam, RankedStudent, Student } from '../types.js';
import { sortExams } from './dates.js';

export const SUBJECT_ORDER = [
  '语文',
  '数学',
  '英语',
  '物理',
  '化学',
  '生物',
  '政治',
  '历史',
  '地理',
  '技术',
  '总分',
];

/** 只保留真正考过的科目：至少有一名学生该科有有效数字成绩。 */
export function examSubjects(exam: Exam | undefined): string[] {
  if (!exam) return [];
  return exam.subjects.filter((subject) =>
    Object.values(exam.scores ?? {}).some((perSubject) => {
      const value = perSubject?.[subject];
      return typeof value === 'number' && Number.isFinite(value);
    }),
  );
}

function orderSubjects(subjects: Iterable<string>): string[] {
  return [...new Set(subjects)].sort((a, b) => {
    const indexA = SUBJECT_ORDER.indexOf(a);
    const indexB = SUBJECT_ORDER.indexOf(b);
    return (indexA < 0 ? 99 : indexA) - (indexB < 0 ? 99 : indexB) || a.localeCompare(b, 'zh-CN');
  });
}

/** 单次考试只列本场考过的科目；平均模式列出所有场次里考过的科目。 */
export function callSubjectOptions(exams: Exam[], range: CallRange, currentExamId: string): string[] {
  if (range === 'single') {
    return examSubjects(exams.find((exam) => exam.id === currentExamId));
  }
  return orderSubjects(exams.flatMap((exam) => examSubjects(exam)));
}

export function resolveSubject(options: string[], preferred: string, fallback: string): string {
  if (preferred && options.includes(preferred)) return preferred;
  if (fallback && options.includes(fallback)) return fallback;
  return options[0] ?? '总分';
}

/** 参与统计的考试：单次=当前考试；最近 N 次=按时间倒序取有该科的 N 场。 */
export function examPool(exams: Exam[], range: CallRange, subject: string, currentExamId: string): Exam[] {
  if (range === 'single') {
    const current = exams.find((exam) => exam.id === currentExamId);
    return current && examSubjects(current).includes(subject) ? [current] : [];
  }
  const limit = range === 'recent3' ? 3 : range === 'recent5' ? 5 : Number.POSITIVE_INFINITY;
  return sortExams(exams)
    .filter((exam) => examSubjects(exam).includes(subject))
    .slice(0, limit);
}

export const TOTAL_SUBJECT = '总分';

export interface ScoreResult {
  score: number | null;
  count: number;
  total: number;
}

/** 取平均：缺考与该场没考该科都不计入分母。 */
export function scoreFor(studentId: string, pool: Exam[], subject: string): ScoreResult {
  const values = pool
    .map((exam) => exam.scores?.[studentId]?.[subject])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (values.length === 0) return { score: null, count: 0, total: pool.length };
  const sum = values.reduce((acc, value) => acc + value, 0);
  return { score: Math.round((sum / values.length) * 100) / 100, count: values.length, total: pool.length };
}

/** 有总分成绩的考试（含至少一条有效总分），按时间倒序；单科限时练不计入平均总分。 */
export function totalExamPool(exams: Exam[]): Exam[] {
  return sortExams(exams).filter((exam) => examSubjects(exam).includes(TOTAL_SUBJECT));
}

export interface AverageTotal extends ScoreResult {
  /** 班级排名（按所选统计口径的科目成绩，同分同名次）；无成绩为 null */
  rank: number | null;
  /** 实际参与排名的人数 */
  ranked: number;
}

/**
 * 给定考试池与科目，算出每位学生的平均分（单场时等于该场分数）与班级排名。
 * normalize=true 时按每场该科满分折算成百分制（只在考试池每场都有满分时使用）。
 */
export function scoreRanking(
  students: Student[],
  pool: Exam[],
  subject: string,
  normalize = false,
): Map<string, AverageTotal> {
  const rows = students.map((student) => {
    if (!normalize) return { id: student.id, ...scoreFor(student.id, pool, subject) };
    const values = pool
      .map((exam) => {
        const score = exam.scores?.[student.id]?.[subject];
        const full = exam.fullMarks?.[subject];
        if (typeof score !== 'number' || !Number.isFinite(score)) return null;
        if (typeof full !== 'number' || !Number.isFinite(full) || full <= 0) return null;
        return (score / full) * 100;
      })
      .filter((value): value is number => value !== null);
    if (!values.length) return { id: student.id, score: null, count: 0, total: pool.length };
    const sum = values.reduce((acc, value) => acc + value, 0);
    return {
      id: student.id,
      score: Math.round((sum / values.length) * 100) / 100,
      count: values.length,
      total: pool.length,
    };
  });
  const ordered = rows
    .filter((row) => row.score !== null)
    .sort((a, b) => Number(b.score) - Number(a.score) || a.id.localeCompare(b.id, 'zh-CN', { numeric: true }));
  const rankOf = new Map<string, number>();
  let index = 0;
  while (index < ordered.length) {
    let end = index + 1;
    while (end < ordered.length && ordered[end].score === ordered[index].score) end += 1;
    for (let cursor = index; cursor < end; cursor += 1) rankOf.set(ordered[cursor].id, index + 1);
    index = end;
  }
  const result = new Map<string, AverageTotal>();
  for (const row of rows) {
    result.set(row.id, { ...row, rank: rankOf.get(row.id) ?? null, ranked: ordered.length });
  }
  return result;
}

/** 多次考试的总分平均分与班级排名；缺考与该场没有总分都不计入分母。 */
export function averageTotals(students: Student[], exams: Exam[]): Map<string, AverageTotal> {
  return scoreRanking(students, totalExamPool(exams), TOTAL_SUBJECT);
}

export type Groups = Record<Category, RankedStudent[]>;

/**
 * 按成绩分档：优秀前 30%、中等中间 40%、后进生后 30%。
 * 同分使用平均名次定位，保证并列学生落在同一档。
 */
export function buildGroups(students: Student[], pool: Exam[], subject: string): Groups {
  const groups: Groups = { all: [], excellent: [], middle: [], support: [], ungraded: [] };
  const ranked: Array<RankedStudent & { score: number }> = [];
  for (const student of students) {
    const result = scoreFor(student.id, pool, subject);
    if (result.score === null) {
      groups.ungraded.push({ ...result, student, category: 'ungraded' });
    } else {
      ranked.push({ student, score: result.score, count: result.count, total: result.total });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.student.id.localeCompare(b.student.id, 'zh-CN', { numeric: true }));
  let index = 0;
  while (index < ranked.length) {
    let end = index + 1;
    while (end < ranked.length && ranked[end].score === ranked[index].score) end += 1;
    const averageRank = (index + 1 + end) / 2;
    const percentile = (averageRank - 0.5) / ranked.length;
    const category: Category = percentile <= 0.3 ? 'excellent' : percentile >= 0.7 ? 'support' : 'middle';
    for (let cursor = index; cursor < end; cursor += 1) {
      ranked[cursor].rank = index + 1;
      ranked[cursor].category = category;
      groups[category].push(ranked[cursor]);
    }
    index = end;
  }
  groups.all = [...ranked, ...groups.ungraded];
  return groups;
}

export type PreviewSortKey = 'id' | 'name' | string;

/** 成绩预览表排序：缺考恒排在最后；学号/姓名按文本，其余按数值。 */
export function sortPreview(
  students: Student[],
  exam: Exam,
  key: PreviewSortKey,
  direction: 1 | -1,
): Student[] {
  const valueOf = (student: Student): string | number | null => {
    if (key === 'id') return student.id;
    if (key === 'name') return student.name;
    const value = exam.scores?.[student.id]?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  return [...students].sort((a, b) => {
    const left = valueOf(a);
    const right = valueOf(b);
    if (key === 'id' || key === 'name') {
      const compare = key === 'name'
        ? String(left).localeCompare(String(right), 'zh-CN')
        : String(left).localeCompare(String(right), 'zh-CN', { numeric: true });
      return compare * direction || String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true });
    }
    if (left === null && right === null) {
      return String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true });
    }
    if (left === null) return 1;
    if (right === null) return -1;
    const diff = (Number(left) - Number(right)) * direction;
    return diff || String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true });
  });
}
