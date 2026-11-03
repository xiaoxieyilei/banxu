import test from 'node:test';
import assert from 'node:assert/strict';

import {
  examSubjects,
  examPool,
  scoreFor,
  buildGroups,
  sortPreview,
  callSubjectOptions,
  averageTotals,
  totalExamPool,
} from '../dist/lib/ranking.js';

const students = ['001', '002', '003', '004', '005', '006'].map((id, index) => ({
  id,
  name: `学生${index + 1}`,
  gender: '男',
  note: '',
}));

const exam = (id, date, scores) => ({ id, name: id, date, subjects: ['语文', '总分'], sourceFormat: '', scores, ranks: {} });

const e1 = exam('e1', '2026-09-01', {
  '001': { 语文: 60 }, '002': { 语文: 70 }, '003': { 语文: 80 },
  '004': { 语文: 90 }, '005': { 语文: 100 }, '006': { 语文: 50 },
});
const e2 = exam('e2', '2026-09-08', {
  '001': { 语文: 70 }, '002': { 语文: 80 }, '003': { 语文: 90 },
  '004': { 语文: 100 }, '005': { 语文: null }, '006': { 语文: 60 },
});
const e3 = exam('e3', '2026-09-15', {
  '001': { 语文: 80 }, '002': { 语文: 90 }, '003': { 语文: 100 },
  '004': { 语文: null }, '005': { 语文: null }, '006': { 语文: 70 },
});
const e4 = exam('e4', '2026-10-01', {
  '001': { 语文: null }, '002': { 语文: null }, '003': { 语文: null },
  '004': { 语文: null }, '005': { 语文: 110 }, '006': { 语文: 80 },
});
const exams = [e1, e2, e3, e4];

test('只统计真正考过的科目', () => {
  const partial = exam('x', '2026-09-01', { '001': { 语文: 90, 数学: null } });
  partial.subjects = ['语文', '数学', '总分'];
  assert.deepEqual(examSubjects(partial), ['语文']);
});

test('单次模式只取当前考试', () => {
  const pool = examPool(exams, 'single', '语文', 'e1');
  assert.deepEqual(pool.map((item) => item.id), ['e1']);
  assert.equal(examPool(exams, 'single', '语文', 'nope').length, 0);
});

test('近 3 次取最近三场且缺考不计分母', () => {
  const pool = examPool(exams, 'recent3', '语文', 'e1');
  assert.deepEqual(pool.map((item) => item.id), ['e4', 'e3', 'e2']);
  assert.deepEqual(scoreFor('001', pool, '语文'), { score: 75, count: 2, total: 3 });
  assert.deepEqual(scoreFor('005', pool, '语文'), { score: 110, count: 1, total: 3 });
});

test('最近 5 次不足则按实际场次，全部模式取所有', () => {
  assert.equal(examPool(exams, 'recent5', '语文', 'e1').length, 4);
  assert.equal(examPool(exams, 'all', '语文', 'e1').length, 4);
  assert.deepEqual(scoreFor('006', exams, '语文'), { score: 65, count: 4, total: 4 });
});

test('按 30/40/30 分类，同分归入同一档', () => {
  const groups = buildGroups(students, exams, '语文');
  const ids = (list) => list.map((entry) => entry.student.id);
  assert.deepEqual(ids(groups.excellent), ['005', '004']);
  assert.deepEqual(ids(groups.middle), ['003', '002']);
  assert.deepEqual(ids(groups.support), ['001', '006']);
  assert.equal(groups.all.length, 6);

  const tied = students.slice(0, 4).map((student) => ({ ...student }));
  const tieExam = exam('tie', '2026-09-01', { '001': { 语文: 80 }, '002': { 语文: 80 }, '003': { 语文: 80 }, '004': { 语文: 80 } });
  const tieGroups = buildGroups(tied, [tieExam], '语文');
  assert.equal(tieGroups.middle.length, 4);
});

test('无成绩的学生单列，不参与排名', () => {
  const groups = buildGroups(students, [], '语文');
  assert.equal(groups.ungraded.length, 6);
  assert.equal(groups.all.length, 6);
});

test('预览排序：缺考恒排最后', () => {
  const asc = sortPreview(students, e2, '语文', 1).map((student) => student.id);
  assert.deepEqual(asc, ['006', '001', '002', '003', '004', '005']);
  const desc = sortPreview(students, e2, '语文', -1).map((student) => student.id);
  assert.deepEqual(desc, ['004', '003', '002', '001', '006', '005']);
});

test('平均模式的科目列表按学科顺序合并', () => {
  const a = exam('a', '2026-09-01', { '001': { 语文: 1, 总分: 1 } });
  const b = exam('b', '2026-09-02', { '001': { 数学: 1, 总分: 1 } });
  b.subjects = ['数学', '总分'];
  assert.deepEqual(callSubjectOptions([a, b], 'all', 'a'), ['语文', '数学', '总分']);
  assert.deepEqual(callSubjectOptions([a, b], 'single', 'a'), ['语文', '总分']);
});

test('平均总分：跨多次考试取平均、缺考不计分母，并按平均分给出班次', () => {
  const a = exam('a', '2026-09-01', { '001': { 总分: 80 }, '002': { 总分: 90 }, '003': { 总分: 70 } });
  const b = exam('b', '2026-09-08', { '001': { 总分: 100 }, '002': { 总分: 90 }, '003': { 总分: null } });
  const c = exam('c', '2026-09-15', { '001': { 总分: 60 }, '002': { 总分: 90 }, '003': { 总分: 80 } });
  const singleSubject = {
    id: 'd', name: 'd', date: '2026-09-20', subjects: ['英语'], sourceFormat: '',
    scores: { '001': { 英语: 99 } }, ranks: {},
  };
  const pool = totalExamPool([singleSubject, a, b, c]);
  assert.deepEqual(pool.map((item) => item.id), ['c', 'b', 'a'], '单科限时练不计入平均总分');

  const map = averageTotals(students.slice(0, 3), [singleSubject, a, b, c]);
  assert.deepEqual(
    { score: map.get('001').score, count: map.get('001').count, total: map.get('001').total, rank: map.get('001').rank },
    { score: 80, count: 3, total: 3, rank: 2 },
  );
  assert.equal(map.get('002').score, 90);
  assert.equal(map.get('002').rank, 1);
  assert.deepEqual(
    { score: map.get('003').score, count: map.get('003').count, total: map.get('003').total, rank: map.get('003').rank },
    { score: 75, count: 2, total: 3, rank: 3 },
  );
});

test('平均总分：无总分的考试不参与，/无数据学生排名为 null', () => {
  const onlySingle = {
    id: 'x', name: 'x', date: '2026-09-01', subjects: ['英语'], sourceFormat: '',
    scores: { '001': { 英语: 99 } }, ranks: {},
  };
  const map = averageTotals(students.slice(0, 2), [onlySingle]);
  assert.equal(map.get('001').score, null);
  assert.equal(map.get('001').rank, null);
  assert.equal(map.get('001').ranked, 0);
  assert.equal(totalExamPool([onlySingle]).length, 0);
});
