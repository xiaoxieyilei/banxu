export type CallRange = 'single' | 'recent3' | 'recent5' | 'all';

export interface Student {
  id: string;
  name: string;
  gender: string;
  note: string;
  /** 寝室号，未分配为空串 */
  dorm: string;
}

export interface ClassSettings {
  className: string;
  rows: number;
  extraRow: number;
  showScores: boolean;
  examId: string;
  subject: string;
  callRange: CallRange;
  callSubject: string;
  /** 座位表成绩统计方式：单次考试 / 最近 3、5 次平均 / 全部考试平均 */
  seatRange: CallRange;
}

export interface Rank {
  school: number | null;
  class: number | null;
}

export interface Exam {
  id: string;
  name: string;
  date: string;
  subjects: string[];
  sourceFormat: string;
  scores: Record<string, Record<string, number | null>>;
  ranks: Record<string, Record<string, Rank>>;
}

export interface DisciplineRecord {
  id: string;
  date: string;
  type: string;
  reason: string;
  /** 寝室违纪归属的寝室号；个人违纪为空串 */
  room: string;
}

export interface AppState {
  settings: ClassSettings;
  students: Student[];
  exams: Exam[];
  seats: Record<string, string>;
  discipline: Record<string, DisciplineRecord[]>;
}

/** 学校「学生成绩单」PDF 解析结果：每行的姓名/考号/总分。 */
export interface PdfScoreRow {
  name: string;
  examNo: string;
  total: number;
}

export interface PdfExamParse {
  examName: string;
  subject: string;
  fullMarks: number | null;
  pageCount: number;
  rows: PdfScoreRow[];
  warnings: string[];
}

export interface DisciplineSummaryRow {
  studentId: string;
  name: string;
  count: number;
  lastDate: string;
  types: Record<string, number>;
}

export interface DisciplineSummary {
  rows: DisciplineSummaryRow[];
  total: number;
  students: number;
}

export interface NewExam {
  name: string;
  date: string;
  subjects: string[];
  scores: Record<string, Record<string, number | null>>;
  ranks: Record<string, Record<string, Rank>>;
  sourceFormat?: string;
}

export type Category = 'all' | 'excellent' | 'middle' | 'support' | 'ungraded';

export interface RankedStudent {
  student: Student;
  /** 缺考/未录入为 null，绝不显示成 0 分 */
  score: number | null;
  count: number;
  total: number;
  rank?: number;
  category?: Category;
}

export const CATEGORY_LABELS: Record<Category, string> = {
  all: '全班学生',
  excellent: '优秀',
  middle: '中等',
  support: '后进生',
  ungraded: '暂无成绩',
};

export const RANGE_LABELS: Record<CallRange, string> = {
  single: '单次考试',
  recent3: '最近 3 次平均',
  recent5: '最近 5 次平均',
  all: '全部考试平均',
};
