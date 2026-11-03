import type { AppState, Exam, Rank, Student } from '../types.js';
import { toISODate } from './dates.js';
import { SUBJECT_ORDER, examSubjects } from './ranking.js';

export interface SeriesPoint {
  exam: Exam;
  score: number | null;
  rank?: Rank;
}

export type TrendDirection = 'up' | 'down' | 'flat' | 'none';

export interface SubjectRow {
  student: Student;
  points: SeriesPoint[];
  values: Array<number | null>;
  /** 每次考试的校次（无排名为 null） */
  schoolRanks: Array<number | null>;
  classRanks: Array<number | null>;
  /** 最近两次有排名考试的校次变化：正数=名次前进 */
  rankDelta: number | null;
  /** 班次变化：正数=名次前进 */
  classRankDelta: number | null;
  lastRank: number | null;
  lastClassRank: number | null;
  bestRank: number | null;
  /** 最近两次有效成绩的差；不足两次为 null */
  delta: number | null;
  best: number | null;
  worst: number | null;
  average: number | null;
  last: number | null;
  trend: TrendDirection;
}

const valid = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** 考过该科目的考试，按时间升序（同一天保持导入顺序）。 */
export function examsWithSubject(exams: Exam[], subject: string): Exam[] {
  return exams
    .filter((exam) => examSubjects(exam).includes(subject))
    .slice()
    .sort((a, b) => toISODate(a.date).localeCompare(toISODate(b.date)));
}

/** 一次考试里出现过的所有科目（含总分），按固定学科顺序。 */
export function allSubjects(exams: Exam[]): string[] {
  const set = new Set<string>();
  for (const exam of exams) for (const subject of examSubjects(exam)) set.add(subject);
  return [...set].sort((a, b) => {
    const indexA = SUBJECT_ORDER.indexOf(a);
    const indexB = SUBJECT_ORDER.indexOf(b);
    return (indexA < 0 ? 99 : indexA) - (indexB < 0 ? 99 : indexB) || a.localeCompare(b, 'zh-CN');
  });
}

function summarise(points: SeriesPoint[]): {
  values: Array<number | null>;
  delta: number | null;
  best: number | null;
  worst: number | null;
  average: number | null;
  last: number | null;
  trend: TrendDirection;
} {
  const values = points.map((point) => point.score);
  const numbers = values.filter(valid);
  if (!numbers.length) {
    return { values, delta: null, best: null, worst: null, average: null, last: null, trend: 'none' };
  }
  const delta = numbers.length >= 2 ? numbers[numbers.length - 1] - numbers[numbers.length - 2] : null;
  return {
    values,
    delta,
    best: Math.max(...numbers),
    worst: Math.min(...numbers),
    average: Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 10) / 10,
    last: numbers[numbers.length - 1],
    trend: delta === null ? 'none' : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
  };
}

/** 某科目下每位学生的横向对比（列按考试时间升序）。 */
export function subjectRows(state: AppState, subject: string): SubjectRow[] {
  const exams = examsWithSubject(state.exams, subject);
  return state.students.map((student: Student) => {
    const points: SeriesPoint[] = exams.map((exam) => ({
      exam,
      score: exam.scores?.[student.id]?.[subject] ?? null,
      rank: exam.ranks?.[student.id]?.[subject],
    }));
    const schoolRanks = points.map((point) => {
      const value = point.rank?.school;
      return typeof value === 'number' && value > 0 ? value : null;
    });
    const classRanks = points.map((point) => {
      const value = point.rank?.class;
      return typeof value === 'number' && value > 0 ? value : null;
    });
    const numbered = schoolRanks.filter((value): value is number => value !== null);
    const numberedClass = classRanks.filter((value): value is number => value !== null);
    const rankDelta =
      numbered.length >= 2 ? numbered[numbered.length - 2] - numbered[numbered.length - 1] : null;
    const classRankDelta =
      numberedClass.length >= 2
        ? numberedClass[numberedClass.length - 2] - numberedClass[numberedClass.length - 1]
        : null;
    return {
      student,
      points,
      ...summarise(points),
      schoolRanks,
      classRanks,
      rankDelta,
      classRankDelta,
      lastRank: numbered.length ? numbered[numbered.length - 1] : null,
      lastClassRank: numberedClass.length ? numberedClass[numberedClass.length - 1] : null,
      bestRank: numbered.length ? Math.min(...numbered) : null,
    };
  });
}

/** 该生考过的科目（有成绩的），按固定学科顺序。 */
export function studentSubjects(state: AppState, studentId: string): string[] {
  const set = new Set<string>();
  for (const exam of state.exams) {
    for (const [subject, score] of Object.entries(exam.scores?.[studentId] ?? {})) {
      if (valid(score)) set.add(subject);
    }
  }
  return [...set].sort((a, b) => {
    const indexA = SUBJECT_ORDER.indexOf(a);
    const indexB = SUBJECT_ORDER.indexOf(b);
    return (indexA < 0 ? 99 : indexA) - (indexB < 0 ? 99 : indexB) || a.localeCompare(b, 'zh-CN');
  });
}

/** 某位学生在某科目上的时间序列（仅含有该科成绩的考试）。 */
export function studentSeries(state: AppState, studentId: string, subject: string): SeriesPoint[] {
  return examsWithSubject(state.exams, subject).map((exam) => ({
    exam,
    score: exam.scores?.[studentId]?.[subject] ?? null,
    rank: exam.ranks?.[studentId]?.[subject],
  }));
}

/**
 * 生成内联 SVG 折线图：缺考处断线，按时间顺序连接有效点。
 * 全部缺考时返回空状态提示。
 */
export interface ChartOptions {
  width?: number;
  height?: number;
  /** 排名图：数值越小越好，纵轴反转 */
  inverted?: boolean;
  /** 纵轴与标注文案，默认分数 */
  unit?: string;
}

export function trendSvg(points: SeriesPoint[], options: ChartOptions = {}): string {
  const width = options.width ?? 320;
  const height = options.height ?? 150;
  const pad = { top: 16, right: 12, bottom: 22, left: 30 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const numbers = points.map((point) => point.score).filter(valid);
  if (!numbers.length) {
    return `<div class="trend-empty">该科目暂无成绩，暂无趋势图</div>`;
  }
  const max = Math.max(...numbers);
  const min = Math.min(...numbers);
  const span = max - min || Math.max(1, max * 0.1);
  const low = Math.max(0, min - span * 0.2);
  const high = max + span * 0.2;
  const inverted = options.inverted === true;
  const unit = options.unit ?? '分';
  const x = (index: number): number =>
    points.length === 1 ? pad.left + innerW / 2 : pad.left + (innerW * index) / (points.length - 1);
  const y = (value: number): number => {
    const ratio = (value - low) / (high - low);
    return pad.top + innerH - (inverted ? ratio : 1 - ratio) * innerH;
  };

  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (valid(point.score)) {
      current.push(`${x(index).toFixed(1)},${y(point.score).toFixed(1)}`);
    } else if (current.length) {
      segments.push(current.join(' '));
      current = [];
    }
  });
  if (current.length) segments.push(current.join(' '));

  const dots = points
    .map((point, index) =>
      valid(point.score)
        ? `<circle class="trend-dot" cx="${x(index).toFixed(1)}" cy="${y(point.score).toFixed(1)}" r="3">` +
          `<title>${point.exam.name} ${point.exam.date}：${point.score}${unit === '分' ? ' 分' : ' 名'}</title></circle>`
        : '',
    )
    .join('');

  const firstIndex = points.findIndex((point) => valid(point.score));
  const lastIndex = points.length - 1 - [...points].reverse().findIndex((point) => valid(point.score));
  const label = (index: number, dy: number): string => {
    const point = points[index];
    return valid(point.score)
      ? `<text class="trend-label" x="${x(index).toFixed(1)}" y="${(y(point.score) + dy).toFixed(1)}">${point.score}</text>`
      : '';
  };

  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const lineY = pad.top + innerH * ratio;
      const raw = inverted ? low + (high - low) * ratio : high - (high - low) * ratio;
      const value = Math.round(raw);
      return (
        `<line class="trend-grid" x1="${pad.left}" y1="${lineY}" x2="${width - pad.right}" y2="${lineY}"></line>` +
        `<text class="trend-axis" x="${pad.left - 4}" y="${lineY + 3}" text-anchor="end">${value}</text>`
      );
    })
    .join('');

  const summary =
    unit === '分'
      ? `共 ${points.length} 次考试，最新 ${numbers[numbers.length - 1]} 分，最高 ${max}，最低 ${min}`
      : `共 ${numbers.length} 次有排名的考试，最新第 ${numbers[numbers.length - 1]} 名，最好第 ${min} 名，最差第 ${max} 名`;
  return (
    `<svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${summary}">` +
    grid +
    segments
      .filter((segment) => segment.includes(' '))
      .map((segment) => `<polyline class="trend-line" points="${segment}"></polyline>`)
      .join('') +
    dots +
    label(firstIndex, -7) +
    (lastIndex !== firstIndex ? label(lastIndex, -7) : '') +
    `<line class="trend-axis-line" x1="${pad.left}" y1="${pad.top + innerH}" x2="${width - pad.right}" y2="${pad.top + innerH}"></line>` +
    `</svg>`
  );
}

export type RankMode = 'school' | 'class';

/** 某生在某科目（或总分）上的排名序列；缺排名处为 null。 */
export function rankSeries(state: AppState, studentId: string, subject: string, mode: RankMode): SeriesPoint[] {
  return examsWithSubject(state.exams, subject).map((exam) => {
    const rank = exam.ranks?.[studentId]?.[subject];
    const value = mode === 'school' ? rank?.school ?? null : rank?.class ?? null;
    return { exam, score: typeof value === 'number' && value > 0 ? value : null };
  });
}

export function trendArrow(direction: TrendDirection): string {
  return direction === 'up' ? '↑' : direction === 'down' ? '↓' : direction === 'flat' ? '→' : '';
}

/**
 * 校次 + 班次叠加图：左轴=校次（实线），右轴=班次（虚线），名次越小越靠上。
 * 两个序列必须来自同一组考试（长度一致）；缺值处断线。
 */
export function dualRankSvg(
  school: SeriesPoint[],
  klass: SeriesPoint[],
  options: { width?: number; height?: number } = {},
): string {
  const width = options.width ?? 330;
  const height = options.height ?? 168;
  const pad = { top: 14, right: 34, bottom: 20, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const schoolValues = school.map((point) => point.score).filter(valid);
  const classValues = klass.map((point) => point.score).filter(valid);
  if (!schoolValues.length && !classValues.length) {
    return '<div class="trend-empty">暂无排名数据</div>';
  }

  const scale = (values: number[]): { low: number; high: number } => {
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || Math.max(1, max * 0.1);
    return { low: Math.max(0, min - span * 0.15), high: max + span * 0.15 };
  };
  const x = (index: number): number =>
    school.length <= 1 ? pad.left + innerW / 2 : pad.left + (innerW * index) / (school.length - 1);
  const yFor = (value: number, range: { low: number; high: number }): number =>
    pad.top + ((value - range.low) / (range.high - range.low || 1)) * innerH;

  const schoolRange = schoolValues.length ? scale(schoolValues) : null;
  const classRange = classValues.length ? scale(classValues) : null;

  const segmentsFor = (points: SeriesPoint[], range: { low: number; high: number } | null): string[][] => {
    if (!range) return [];
    const segments: string[][] = [];
    let current: string[] = [];
    points.forEach((point, index) => {
      if (valid(point.score)) current.push(`${x(index).toFixed(1)},${yFor(point.score, range).toFixed(1)}`);
      else if (current.length) {
        segments.push(current);
        current = [];
      }
    });
    if (current.length) segments.push(current);
    return segments;
  };

  const dotsFor = (points: SeriesPoint[], range: { low: number; high: number } | null, kind: string): string =>
    !range
      ? ''
      : points
          .map((point, index) =>
            valid(point.score)
              ? `<circle class="rank-dot ${kind}" cx="${x(index).toFixed(1)}" cy="${yFor(point.score, range).toFixed(1)}" r="2.6">` +
                `<title>${point.exam.name} ${point.exam.date}：第 ${point.score} 名</title></circle>`
              : '',
          )
          .join('');

  const axisTicks = (range: { low: number; high: number } | null, side: 'left' | 'right'): string =>
    !range
      ? ''
      : [0, 0.5, 1]
          .map((ratio) => {
            const lineY = pad.top + innerH * ratio;
            const value = Math.round(range.low + (range.high - range.low) * ratio);
            return (
              `<line class="trend-grid" x1="${pad.left}" y1="${lineY}" x2="${width - pad.right}" y2="${lineY}"></line>` +
              `<text class="trend-axis" x="${side === 'left' ? pad.left - 4 : width - pad.right + 4}" y="${lineY + 3}" text-anchor="${
                side === 'left' ? 'end' : 'start'
              }">${value}</text>`
            );
          })
          .join('');

  const polylines = (segments: string[][], kind: string): string =>
    segments
      .filter((segment) => segment.length > 1)
      .map((segment) => `<polyline class="rank-line ${kind}" points="${segment.join(' ')}"></polyline>`)
      .join('');

  const schoolSegments = segmentsFor(school, schoolRange);
  const classSegments = segmentsFor(klass, classRange);

  return (
    `<svg class="trend-chart dual" viewBox="0 0 ${width} ${height}" role="img" aria-label="校次与班次走势，名次越小越靠上">` +
    axisTicks(schoolRange, 'left') +
    axisTicks(classRange, 'right') +
    polylines(schoolSegments, 'school') +
    polylines(classSegments, 'class') +
    dotsFor(school, schoolRange, 'school') +
    dotsFor(klass, classRange, 'class') +
    `<line class="trend-axis-line" x1="${pad.left}" y1="${pad.top + innerH}" x2="${width - pad.right}" y2="${pad.top + innerH}"></line>` +
    '</svg>'
  );
}
