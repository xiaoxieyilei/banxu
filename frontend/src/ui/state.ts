import type { Category, DisciplineRecord, PdfExamParse } from '../types.js';
import type { Workbook } from '../lib/excel.js';
import { DEFAULT_DISCIPLINE_TYPE } from '../lib/discipline.js';
import type { PreviewSortKey } from '../lib/ranking.js';

export type Page = 'seat' | 'roster' | 'exams' | 'discipline' | 'call';
export type DisciplineRange = 'all' | '30' | '7';

export interface ImportState {
  kind: 'roster' | 'exam';
  workbook: Workbook | null;
  fileName?: string;
  /** 成绩来源：Excel 或学校成绩单 PDF */
  source?: 'excel' | 'pdf';
  /** PDF 原始解析结果，用于切换科目时重新映射 */
  pdf?: PdfExamParse;
}

/** 纯前端 UI 状态：不属于业务数据，刷新即重置。 */
export const ui = {
  page: 'seat' as Page,
  callCategory: 'all' as Category,
  selected: null as string | null,
  bubbleStudentId: null as string | null,
  discType: DEFAULT_DISCIPLINE_TYPE as string,
  discRange: 'all' as DisciplineRange,
  previewExamId: '' as string,
  previewSort: { key: 'id' as PreviewSortKey, dir: 1 as 1 | -1 },
  trendSubject: '' as string,
  examTab: 'single' as 'single' | 'trend',
  discTab: 'personal' as 'personal' | 'dorm',
  bubbleSubject: '' as string,
  bubbleRankMode: 'school' as 'school' | 'class',
  importState: null as ImportState | null,
  parsedRoster: null as { records: unknown[]; errors: string[] } | null,
  parsedExam: null as { matched: number; errors: string[] } | null,
  lastDeletedDiscipline: null as { studentId: string; index: number; record: DisciplineRecord } | null,
};

export function rangeToDays(range: DisciplineRange): number | null {
  return range === 'all' ? null : Number(range);
}

export const pageTitles: Record<Page, [string, string, string]> = {
  seat: ['CLASSROOM / 座位安排', '为每一位同学，找到合适的位置', '拖动安排座位，结合成绩，让班级布局一目了然。'],
  roster: ['STUDENTS / 学生名单', '每一位同学，都在这里', '用学号关联名单与考试成绩，支持同名学生。'],
  exams: ['EXAMS / 考试成绩', '记录成长，让安排有据可依', '保留多次考试记录，自由切换总分与单科成绩。'],
  discipline: ['DISCIPLINE / 违纪情况', '每位同学的违纪记录，一目了然', '只列出有违纪记录的学生，点进去可查看明细、补充或删除。'],
  call: ['ROLL CALL / 随机点名', '让每位同学，都有参与的机会', '按考试成绩分类抽取，支持一轮内不重复点名。'],
};
