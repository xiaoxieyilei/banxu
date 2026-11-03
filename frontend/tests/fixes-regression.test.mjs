import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDisciplineText } from '../dist/lib/discipline.js';
import { buildGroups } from '../dist/lib/ranking.js';

const students = ['张三'].map((name, index) => ({ id: `00${index + 1}`, name, gender: '男', note: '' }));

test('小数与范围不会被当成日期，备注保留', () => {
  const cases = ['张三 迟到 扣2.5分', '张三 迟到 5.5分钟', '张三 迟到 3-5分钟'];
  for (const line of cases) {
    const [row] = parseDisciplineText(line, '2026-10-01', students, 2026);
    assert.equal(row.date, '2026-10-01', `${line} 应使用默认日期`);
    assert.equal(row.status, '按默认日期');
    assert.ok(row.reason.length > 0, `${line} 备注不应被清空`);
  }
});

test('显式的月日与斜杠日期仍然可识别', () => {
  const [monthDay] = parseDisciplineText('9月20日 张三 迟到', '', students, 2026);
  assert.equal(monthDay.date, '2026-09-20');
  const [slash] = parseDisciplineText('10/11 张三 迟到', '', students, 2026);
  assert.equal(slash.date, '2026-10-11');
});

test('无成绩学生 score 为 null 而不是 0', () => {
  const groups = buildGroups(students, [], '总分');
  assert.equal(groups.ungraded.length, 1);
  assert.equal(groups.ungraded[0].score, null);
});

test('并发导入考试：两份都创建成功，最终选中第二场', async () => {
  const { store } = await import('../dist/store.js');
  const { api } = await import('../dist/api.js');
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const initial = {
    settings: { className: '并发班', rows: 7, extraRow: 5, showScores: false, examId: '', subject: '总分', callRange: 'single', callSubject: '', seatRange: 'all' },
    students: [],
    exams: [],
    seats: {},
    discipline: {},
  };
  store.state = clone(initial);
  let server = clone(initial);
  let seq = 0;
  api.createExam = async (payload) => {
    server = clone(server);
    seq += 1;
    server.exams.push({ id: `e${seq}`, name: payload.name, date: payload.date, subjects: payload.subjects, sourceFormat: '', scores: {}, ranks: {} });
    return clone(server);
  };
  api.updateSettings = async (patch) => {
    server = clone(server);
    Object.assign(server.settings, patch);
    return clone(server);
  };

  await Promise.all([
    store.addExam({ name: 'A', date: '2026-09-01', subjects: ['总分'], scores: {}, ranks: {} }),
    store.addExam({ name: 'B', date: '2026-09-08', subjects: ['总分'], scores: {}, ranks: {} }),
  ]);

  assert.deepEqual(store.state.exams.map((exam) => exam.name), ['A', 'B']);
  assert.equal(store.state.settings.examId, 'e2', '应选中第二场考试');
  assert.equal(store.state.settings.showScores, true);
});

test('带空格的数字+单位（3-5 分钟 / 2-5 个）不会被当成日期', () => {
  for (const line of ['张三 迟到 3-5 分钟', '张三 迟到 2-5 个', '张三 迟到 3-5  分钟']) {
    const [row] = parseDisciplineText(line, '2026-10-01', students, 2026);
    assert.equal(row.date, '2026-10-01', `${line} 应使用默认日期`);
    assert.equal(row.status, '按默认日期');
    assert.ok(row.reason.includes('3-5') || row.reason.includes('2-5'), `${line} 备注应保留原始数字`);
  }
});

test('斜杠日期在备注中仍可识别（10/11 张三）', () => {
  const [row] = parseDisciplineText('10/11 张三 迟到', '', students, 2026);
  assert.equal(row.date, '2026-10-11');
  assert.equal(row.ok, true);
});

test('显式非法日期（2月30日）标记为日期无效，不静默回退', () => {
  const [row] = parseDisciplineText('张三 2月30日 迟到', '2026-10-01', students, 2026);
  assert.equal(row.ok, false);
  assert.equal(row.status, '日期无效');
});

test('短横范围不会被误判为日期（3-5 号 / 3-5 排），日期仅支持“月日”与“斜杠”写法', () => {
  for (const line of ['张三 迟到 3-5 号', '张三 迟到 3-5 排', '张三 迟到 13-15 号']) {
    const [row] = parseDisciplineText(line, '2026-10-01', students, 2026);
    assert.equal(row.date, '2026-10-01', `${line} 应使用默认日期`);
    assert.equal(row.ok, true);
  }
});

test('日期后面的姓名以“周/班/时/元”开头也能识别（回归）', () => {
  const roster = ['周九', '班超', '时雨', '元宝'].map((name, index) => ({ id: `1${index}`, name, gender: '男', note: '' }));
  for (const [line, expected] of [
    ['9月20日 周九 迟到', '2026-09-20'],
    ['10/11 周九 迟到', '2026-10-11'],
    ['9月20日 班超 迟到', '2026-09-20'],
    ['9月20日 时雨 迟到', '2026-09-20'],
    ['9月20日 元宝 迟到', '2026-09-20'],
  ]) {
    const [row] = parseDisciplineText(line, '2026-10-01', roster, 2026);
    assert.equal(row.date, expected, line);
    assert.equal(row.student.name, line.split(' ')[1], line);
  }
});
