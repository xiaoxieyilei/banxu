import test from 'node:test';
import assert from 'node:assert/strict';

import {
  examsWithSubject,
  subjectRows,
  studentSubjects,
  studentSeries,
  trendSvg,
  trendArrow,
  allSubjects,
} from '../dist/lib/trend.js';

const students = [
  { id: '001', name: '张三', gender: '男', note: '' },
  { id: '002', name: '李四', gender: '女', note: '' },
];
const exam = (id, date, scores, subjects) => ({
  id, name: id, date, subjects: subjects ?? Object.keys(Object.values(scores)[0] ?? {}),
  sourceFormat: '', scores, ranks: {},
});
const e1 = exam('e1', '2026-09-01', { '001': { 语文: 80, 数学: 90 }, '002': { 语文: 70, 数学: 60 } });
const e2 = exam('e2', '2026-09-15', { '001': { 语文: 90, 数学: 85 }, '002': { 语文: null, 数学: 70 } });
const e3 = exam('e3', '2026-10-01', { '001': { 语文: 85 }, '002': { 语文: 75 } });
const state = { students, exams: [e3, e1, e2], seats: {}, discipline: {}, settings: {} };

test('考过该科目的考试按时间升序', () => {
  assert.deepEqual(examsWithSubject(state.exams, '语文').map((item) => item.id), ['e1', 'e2', 'e3']);
  assert.deepEqual(examsWithSubject(state.exams, '数学').map((item) => item.id), ['e1', 'e2']);
});

test('全班横向：分数、均分、最高最低与最近差值', () => {
  const rows = subjectRows(state, '语文');
  const first = rows.find((row) => row.student.id === '001');
  assert.deepEqual(first.values, [80, 90, 85]);
  assert.equal(first.last, 85);
  assert.equal(first.delta, -5);
  assert.equal(first.average, 85);
  assert.equal(first.best, 90);
  assert.equal(first.worst, 80);
  assert.equal(first.trend, 'down');

  const second = rows.find((row) => row.student.id === '002');
  assert.deepEqual(second.values, [70, null, 75]);
  assert.equal(second.last, 75);
  assert.equal(second.delta, 5, '缺考应跳过，与上一次有效成绩比较');
  assert.equal(second.average, 72.5);
});

test('没有该科成绩的学生全为空且趋势为 none', () => {
  const single = { ...state, students: [...students, { id: '003', name: '王五', gender: '男', note: '' }] };
  const row = subjectRows(single, '语文').find((item) => item.student.id === '003');
  assert.deepEqual(row.values, [null, null, null]);
  assert.equal(row.average, null);
  assert.equal(row.trend, 'none');
});

test('个人科目列表与序列', () => {
  assert.deepEqual(studentSubjects(state, '001'), ['语文', '数学']);
  const series = studentSeries(state, '001', '数学');
  assert.deepEqual(series.map((point) => point.score), [90, 85]);
  assert.deepEqual(studentSeries(state, '001', '不存在的科目'), []);
});

test('科目总览按学科顺序去重', () => {
  assert.deepEqual(allSubjects(state.exams), ['语文', '数学']);
});

test('SVG：正常生成折线、点与首末标签', () => {
  const svg = trendSvg(studentSeries(state, '001', '语文'));
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('trend-line'));
  assert.equal((svg.match(/trend-dot/g) ?? []).length, 3);
  assert.ok(svg.includes('aria-label'));
});

test('SVG：缺考断开折线，只有一个有效点时也能渲染', () => {
  const broken = trendSvg(studentSeries(state, '002', '语文'));
  assert.equal((broken.match(/trend-dot/g) ?? []).length, 2);
  const only = exam('e9', '2026-10-10', { '002': { 语文: 66 } });
  const single = trendSvg([{ exam: only, score: 66 }]);
  assert.ok(single.includes('trend-dot'));
});

test('SVG：无成绩返回空状态文案', () => {
  const empty = trendSvg(studentSeries(state, '002', '不存在的科目'));
  assert.ok(empty.includes('暂无趋势图'));
});

test('趋势箭头', () => {
  assert.equal(trendArrow('up'), '↑');
  assert.equal(trendArrow('down'), '↓');
  assert.equal(trendArrow('flat'), '→');
  assert.equal(trendArrow('none'), '');
});

test('双轴排名图：校次实线与班次虚线都渲染，缺数据时给空状态', async () => {
  const { dualRankSvg } = await import('../dist/lib/trend.js');
  const school = [
    { exam: e1, score: 120 }, { exam: e2, score: 90 }, { exam: e3, score: 140 },
  ];
  const klass = [
    { exam: e1, score: 12 }, { exam: e2, score: 8 }, { exam: e3, score: null },
  ];
  const svg = dualRankSvg(school, klass);
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('rank-line school'));
  assert.ok(svg.includes('rank-line class'));
  assert.equal((svg.match(/rank-dot school/g) ?? []).length, 3);
  assert.equal((svg.match(/rank-dot class/g) ?? []).length, 2, '缺值不画点');
  assert.ok(svg.includes('aria-label'));
  assert.equal((svg.match(/rank-hit/g) ?? []).length, 3, '每次有排名的考试都有悬停热区');
  assert.ok(svg.includes('data-exam="e1"'));
  assert.ok(svg.includes('data-school="120"'));
  assert.ok(svg.includes('data-class="12"'));

  const empty = dualRankSvg([{ exam: e1, score: null }], [{ exam: e1, score: null }]);
  assert.ok(empty.includes('暂无排名数据'));
});

test('学科总表：给出校次序列与排名变化（正数=进步）', async () => {
  const withRanks = {
    ...state,
    exams: [
      { ...e1, ranks: { '001': { 语文: { school: 40, class: 9 } } } },
      { ...e2, ranks: { '001': { 语文: { school: 28, class: 6 } } } },
      { ...e3, ranks: { '001': { 语文: { school: 35, class: 7 } } } },
    ],
  };
  const row = subjectRows(withRanks, '语文').find((item) => item.student.id === '001');
  assert.deepEqual(row.schoolRanks, [40, 28, 35]);
  assert.equal(row.lastRank, 35);
  assert.equal(row.bestRank, 28);
  assert.equal(row.rankDelta, 28 - 35, '最近两次：28 → 35，退步 7 名');
  assert.equal('rankDelta' in row, true);
});

test('学科总表：班次序列与班次变化', async () => {
  const { subjectRows } = await import('../dist/lib/trend.js');
  const withRanks = {
    ...state,
    exams: [
      { ...e1, ranks: { '001': { 语文: { school: 40, class: 10 } } } },
      { ...e2, ranks: { '001': { 语文: { school: 28, class: 7 } } } },
      { ...e3, ranks: { '001': { 语文: { school: 35, class: 9 } } } },
    ],
  };
  const row = subjectRows(withRanks, '语文').find((item) => item.student.id === '001');
  assert.deepEqual(row.classRanks, [10, 7, 9]);
  assert.equal(row.lastClassRank, 9);
  assert.equal(row.classRankDelta, 7 - 9, '班次 7 → 9 为退步 2 名');
  assert.equal(row.rankDelta, 28 - 35);
});

test('加权均分按每次满分折算百分制；缺满分项单独计数', async () => {
  const { weightedScoreFor, weightedOverallForStudent } = await import('../dist/lib/ranking.js');
  const a = {
    id: 'w1', name: 'w1', date: '2026-09-01', subjects: ['生物'], sourceFormat: '',
    scores: { '001': { 生物: 80 } }, ranks: {}, fullMarks: { 生物: 100 },
  };
  const b = {
    id: 'w2', name: 'w2', date: '2026-09-02', subjects: ['生物'], sourceFormat: '',
    scores: { '001': { 生物: 30 } }, ranks: {}, fullMarks: { 生物: 60 },
  };
  const c = {
    id: 'w3', name: 'w3', date: '2026-09-03', subjects: ['生物'], sourceFormat: '',
    scores: { '001': { 生物: 40 } }, ranks: {}, fullMarks: {},
  };
  assert.deepEqual(weightedScoreFor('001', [a, b], '生物'), {
    score: 65, count: 2, total: 2, missingFullMarks: 0,
  });
  assert.deepEqual(weightedScoreFor('001', [a, b, c], '生物'), {
    score: 65, count: 2, total: 3, missingFullMarks: 1,
  });
  const weightedState = { students: [{ id: '001', name: '张三', gender: '男', note: '' }], exams: [a, b, c], seats: {}, discipline: {}, settings: {} };
  assert.deepEqual(weightedOverallForStudent(weightedState, '001'), {
    score: 65, count: 2, total: 3, missingFullMarks: 1,
  });
});
