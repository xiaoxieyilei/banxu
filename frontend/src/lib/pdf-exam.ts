import type { PdfScoreRow, Student } from '../types.js';
import type { ParsedExam } from './excel.js';

export interface PdfPreviewRow {
  name: string;
  id: string;
  total: number;
}

export interface PdfParsedExam extends ParsedExam {
  /** 预览表用：已匹配到名单的成绩行 */
  preview: PdfPreviewRow[];
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * 把 PDF 里的「姓名 / 学号 / 总分」行映射成软件的学生成绩。
 * PDF 的学号通常是学校考号，优先按学号匹配，失败再按唯一姓名匹配。
 */
export function mapPdfRows(rows: PdfScoreRow[], students: Student[], subject = ''): PdfParsedExam {
  const subjectName = subject.trim() || '成绩';
  const errors: string[] = [];
  const warnings: string[] = [];
  const scores: Record<string, Record<string, number | null>> = {};
  const preview: PdfPreviewRow[] = [];
  const byId = new Map(students.map((student) => [student.id, student]));
  const byName = new Map<string, Student[]>();
  for (const student of students) {
    byName.set(student.name, [...(byName.get(student.name) ?? []), student]);
  }
  const seen = new Set<string>();

  for (const row of rows) {
    const rawName = String(row.name ?? '').trim();
    let student = row.examNo ? byId.get(String(row.examNo).trim()) : undefined;
    if (!student) {
      const matches = byName.get(rawName) ?? [];
      if (matches.length > 1) {
        errors.push(`「${rawName}」在名单中有重名学生，无法对应这份成绩单。`);
        continue;
      }
      student = matches[0];
    }
    if (!student) {
      errors.push(`「${rawName}」未匹配到班级学生。`);
      continue;
    }
    if (rawName && rawName !== student.name) {
      errors.push(`「${rawName}」与名单中的「${student.name}」姓名不一致。`);
      continue;
    }
    if (seen.has(student.id)) {
      errors.push(`「${student.name}」的成绩重复出现。`);
      continue;
    }
    const total = Number(row.total);
    if (!Number.isFinite(total) || total < 0) {
      errors.push(`「${rawName}」的总分「${row.total}」不是有效数字。`);
      continue;
    }
    seen.add(student.id);
    scores[student.id] = { [subjectName]: round2(total) };
    preview.push({ name: student.name, id: student.id, total: round2(total) });
  }

  if (!rows.length) errors.push('成绩单没有可导入的学生。');
  const missing = students.filter((student) => !seen.has(student.id));
  if (missing.length) {
    warnings.push(
      `成绩单包含 ${preview.length} 位学生，其余 ${missing.length} 位本次记为未录入：${missing
        .slice(0, 6)
        .map((student) => student.name)
        .join('、')}${missing.length > 6 ? ' 等' : ''}。`,
    );
  }

  return {
    subjects: [subjectName],
    scores,
    ranks: {},
    errors,
    warnings,
    matched: preview.length,
    schoolFormat: false,
    preview,
  };
}
