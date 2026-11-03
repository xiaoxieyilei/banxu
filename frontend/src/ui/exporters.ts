import type { AppState } from '../types.js';
import { capacityFor, parseSeatId, seatIdsFor, seatLabel } from '../lib/seats.js';
import { examSubjects } from '../lib/ranking.js';
import { downloadBlob, downloadWorkbook, workbookFromSheets } from '../lib/excel.js';
import { examDateLabel, todayISO } from '../lib/dates.js';
import { $, esc, toast } from './dom.js';

export function exportRoster(state: AppState): void {
  downloadWorkbook(
    workbookFromSheets([
      ['学生名单', [['学号', '姓名', '性别', '备注'], ...state.students.map((student) => [student.id, student.name, student.gender, student.note])]],
    ]),
    `${state.settings.className}_学生名单`,
  );
  toast('已导出学生名单');
}

export function exportExam(state: AppState, examId: string): void {
  const exam = state.exams.find((item) => item.id === examId);
  if (!exam) return;
  const subjects = examSubjects(exam);
  const rows = [
    ['学号', '姓名', ...subjects],
    ...state.students.map((student) => [
      student.id,
      student.name,
      ...subjects.map((subject) => exam.scores?.[student.id]?.[subject] ?? ''),
    ]),
  ];
  downloadWorkbook(workbookFromSheets([['考试成绩', rows]]), `${exam.name}_${exam.date || '考试'}`);
  toast('已导出考试成绩');
}

export function exportSeats(state: AppState): void {
  const rows: unknown[][] = [
    ['座位', '排', '列', '学号', '姓名'],
    ...seatIdsFor(state.settings.rows).map((seatId) => {
      const student = state.students.find((item) => item.id === state.seats[seatId]);
      const position = parseSeatId(seatId);
      const row = position ? position.row : state.settings.extraRow + (seatId === 'X2' ? 1 : 0);
      const column = position ? 9 - position.column : '中央';
      return [seatLabel(seatId, state.settings.extraRow), row, column, student?.id ?? '', student?.name ?? ''];
    }),
  ];
  downloadWorkbook(workbookFromSheets([['座位安排', rows]]), `${state.settings.className}_座位表`);
  toast(`已导出座位表（${capacityFor(state.settings.rows)} 座）`);
}

export function downloadBackup(state: AppState): void {
  downloadBlob(
    `${state.settings.className}_班序备份_${todayISO()}.json`,
    JSON.stringify(state, null, 2),
    'application/json',
  );
  toast('备份包含学生、考试、座位与违纪记录');
}

export function demoStudents(): Array<{ id: string; name: string; gender: string; note: string; dorm: string }> {
  const names = [
    '陈一诺', '林知夏', '王子轩', '李沐阳', '张语桐', '刘星辰', '周予安', '吴思齐', '赵书瑶', '徐景行',
    '孙嘉禾', '郑清越', '黄亦然', '何雨晴', '高远航', '罗可欣', '朱明轩', '梁语宁', '宋时安', '唐若溪',
    '许锦程', '韩悦宁', '冯子墨', '邓晨曦', '曹云舒', '彭奕辰', '曾书涵', '肖以恒', '田乐言', '董安然',
    '袁思源', '潘星语', '于浩然', '蒋心怡', '蔡知远', '余诗涵', '杜泽宇', '叶清扬', '程可心', '苏嘉言',
    '魏辰安', '吕芷晴', '丁亦航', '任书悦', '沈星野', '姚念慈', '卢景明', '姜思雨', '崔予墨', '钟向晚',
  ];
  return names.map((name, index) => ({
    id: String(index + 1).padStart(3, '0'),
    name,
    gender: index % 2 ? '女' : '男',
    note: '',
    dorm: '',
  }));
}

export function examTitle(state: AppState): string {
  const exam = state.exams.find((item) => item.id === state.settings.examId);
  return exam ? `${exam.name} · ${examDateLabel(exam)}` : '暂无考试';
}

export { $, esc };
