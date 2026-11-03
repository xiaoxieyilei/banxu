import test from 'node:test';
import assert from 'node:assert/strict';

import { toISODate, sortExams, examDateLabel, isValidISODate } from '../dist/lib/dates.js';
import { seatIdsFor, fillOrderFor, rotateSeatId, seatCode, seatLabel, capacityFor } from '../dist/lib/seats.js';

test('日期解析兼容多种写法', () => {
  assert.equal(toISODate('2026-10-11'), '2026-10-11');
  assert.equal(toISODate('2026/9/5'), '2026-09-05');
  assert.equal(toISODate('2026年9月5日'), '2026-09-05');
  assert.equal(toISODate('20261011'), '2026-10-11');
  assert.equal(toISODate('示例数据'), '');
  assert.equal(toISODate('2026-13-01'), '');
  assert.equal(isValidISODate('2026-02-30'), false);
  assert.equal(isValidISODate('2026-02-28'), true);
});

test('考试按时间倒序，未设置时间排最后', () => {
  const exams = [
    { id: 'a', name: 'A', date: '2026-09-01', subjects: [], scores: {}, ranks: {} },
    { id: 'b', name: 'B', date: '2026-10-11', subjects: [], scores: {}, ranks: {} },
    { id: 'c', name: 'C', date: '示例', subjects: [], scores: {}, ranks: {} },
  ];
  assert.deepEqual(sortExams(exams).map((exam) => exam.id), ['b', 'a', 'c']);
  assert.equal(examDateLabel(exams[2]), '未设置时间');
});

test('7 排共 58 座，第 7 排可入座', () => {
  const ids = seatIdsFor(7);
  assert.equal(ids.length, 58);
  assert.ok(ids.includes('R7C8'));
  assert.equal(capacityFor(6), 50);
});

test('自动填充先填常规座与中央加座，再进第 7 排', () => {
  const order = fillOrderFor(7, 5);
  const indexOfX1 = order.indexOf('X1');
  const indexOfX2 = order.indexOf('X2');
  const indexOfRow7 = order.indexOf('R7C1');
  assert.ok(indexOfX1 > order.indexOf('R5C8'));
  assert.ok(indexOfX2 > order.indexOf('R6C8'));
  assert.ok(indexOfRow7 > indexOfX2);
});

test('大组轮换：1→2→3→4→1，四次回原位', () => {
  let seat = 'R3C5';
  const seen = [];
  for (let index = 0; index < 4; index += 1) {
    seat = rotateSeatId(seat);
    seen.push(seat);
  }
  assert.deepEqual(seen, ['R3C3', 'R3C1', 'R3C7', 'R3C5']);
});

test('座位角标从右往左列、从前往后排', () => {
  assert.equal(seatCode('R1C8', 5), '1-1');
  assert.equal(seatCode('R6C1', 5), '8-6');
  assert.equal(seatCode('X2', 5), '中-6');
  assert.equal(seatLabel('R7C3', 5), '7 排 6 列');
});

test('不存在的日期被视为无效', () => {
  assert.equal(toISODate('2026-02-30'), '');
  assert.equal(toISODate('2026-04-31'), '');
  assert.equal(toISODate('2026-02-28'), '2026-02-28');
});

test('todayISO 使用本地日期', async () => {
  const { todayISO } = await import('../dist/lib/dates.js');
  const now = new Date();
  const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(todayISO(), expected);
});
