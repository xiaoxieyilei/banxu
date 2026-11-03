import test from 'node:test';
import assert from 'node:assert/strict';

import { dormIncidentDrafts, dormMemberChoices, dormOverview, parseDormSheet } from '../dist/lib/dorm.js';

const students = [
  { id: '001', name: '张三', gender: '男', note: '', dorm: 'A301' },
  { id: '002', name: '李四', gender: '男', note: '', dorm: 'A301' },
  { id: '003', name: '王五', gender: '男', note: '', dorm: 'A302' },
  { id: '004', name: '赵六', gender: '男', note: '', dorm: '' },
];
const discipline = {
  '001': [{ id: 'r1', date: '2026-10-13', type: '寝室违纪', reason: '' }],
  '002': [
    { id: 'r2', date: '2026-10-20', type: '寝室违纪', reason: '' },
    { id: 'r3', date: '2026-10-21', type: '晚自习违纪', reason: '' },
  ],
};
const state = {
  settings: {}, students, exams: [], seats: {}, discipline,
};

test('按寝室聚合，只统计“寝室违纪”', () => {
  const overview = dormOverview(state);
  assert.equal(overview.totalRooms, 2);
  assert.equal(overview.assigned, 3);
  assert.equal(overview.incidents, 2, '晚自习违纪不计入寝室统计');

  const a301 = overview.rooms.find((room) => room.room === 'A301');
  assert.equal(a301.incidents, 2, '10-13 与 10-20 是两次事件');
  assert.equal(a301.lastDate, '2026-10-20');
  assert.deepEqual(a301.events.map((event) => [event.date, event.members.map((member) => member.name)]), [
    ['2026-10-20', ['李四']],
    ['2026-10-13', ['张三']],
  ]);

  const a302 = overview.rooms.find((room) => room.room === 'A302');
  assert.equal(a302.incidents, 0);
  assert.equal(a302.events.length, 0);
});

test('未登记寝室的学生单独列出', () => {
  const overview = dormOverview(state);
  assert.deepEqual(overview.unassigned.map((student) => student.name), ['赵六']);
});

test('解析寝室名单：一行多人 + 学号列 + 未匹配提示', () => {
  const rows = [
    ['寝室号', '姓名', '学号'],
    ['A301', '张三、李四', ''],
    ['A302', '', '003'],
    ['A303', '陌生同学', ''],
  ];
  const parsed = parseDormSheet(rows, students);
  assert.deepEqual(parsed.records, [
    { room: 'A301', studentId: '001' },
    { room: 'A301', studentId: '002' },
    { room: 'A302', studentId: '003' },
  ]);
  assert.equal(parsed.errors.length, 1);
  assert.ok(parsed.errors[0].includes('陌生同学'));
});

test('同名或重复寝室会报错', () => {
  const rows = [
    ['寝室号', '姓名'],
    ['A301', '张三'],
    ['A302', '张三'],
  ];
  const parsed = parseDormSheet(rows, students);
  assert.ok(parsed.errors.some((message) => message.includes('同时出现在')));
  assert.equal(parsed.records.length, 1);
});

test('缺少表头时给出提示', () => {
  const parsed = parseDormSheet([['房间', '同学'], ['A301', '张三']], students);
  assert.ok(parsed.errors.some((message) => message.includes('缺少')));
});


test('同一寝室同一天同一备注合并为 1 次事件', () => {
  const sameEvent = {
    ...state,
    discipline: {
      '001': [{ id: 'x1', date: '2026-10-13', type: '寝室违纪', reason: '' }],
      '002': [{ id: 'x2', date: '2026-10-13', type: '寝室违纪', reason: '' }],
    },
  };
  const room = dormOverview(sameEvent).rooms.find((item) => item.room === 'A301');
  assert.equal(room.incidents, 1, '整间同一次只算 1 次');
  assert.deepEqual(room.events[0].members.map((member) => member.name), ['张三', '李四']);
  assert.equal(dormOverview(sameEvent).incidents, 1);
});

test('编辑寝室的成员候选：本寝室优先，未登记其次，其他寝室最后', () => {
  const choices = dormMemberChoices(state, 'A301');
  assert.deepEqual(choices.map((choice) => choice.student.name), ['李四', '张三', '赵六', '王五']);
  assert.deepEqual(choices.map((choice) => choice.roomLabel), ['本寝室', '本寝室', '未登记', '来自 A302']);
  assert.ok(choices[0].inRoom && choices[1].inRoom);
  assert.ok(!choices[2].inRoom && !choices[3].inRoom);
});

test('新增寝室时所有学生都是候选，未登记排在前面', () => {
  const choices = dormMemberChoices(state, '');
  assert.deepEqual(choices.map((choice) => choice.student.name), ['赵六', '李四', '张三', '王五']);
  assert.ok(choices.every((choice) => !choice.inRoom));
});

test('编辑寝室时违纪草稿按事件倒序给出', () => {
  const room = dormOverview(state).rooms.find((item) => item.room === 'A301');
  assert.deepEqual(dormIncidentDrafts(room), [
    { date: '2026-10-20', reason: '' },
    { date: '2026-10-13', reason: '' },
  ]);
  assert.deepEqual(dormIncidentDrafts(undefined), []);
});

test('记录上的寝室号决定归属：学生调寝后事件仍留在原寝室', () => {
  const moved = {
    ...state,
    discipline: {
      '003': [{ id: 'm1', date: '2026-10-13', type: '寝室违纪', reason: '', room: 'A301' }],
    },
  };
  const overview = dormOverview(moved);
  const a301 = overview.rooms.find((room) => room.room === 'A301');
  assert.equal(a301.incidents, 1, '事件跟着寝室，不跟着学生当前寝室');
  assert.deepEqual(a301.events[0].members.map((member) => member.name), ['王五']);
  assert.equal(overview.rooms.find((room) => room.room === 'A302').incidents, 0);
});

test('没有在册成员但仍有历史违纪的寝室也会列出', () => {
  const orphan = {
    ...state,
    students: students.map((student) => ({ ...student, dorm: '' })),
    discipline: {
      '001': [{ id: 'h1', date: '2026-10-13', type: '寝室违纪', reason: '', room: 'A301' }],
    },
  };
  const overview = dormOverview(orphan);
  const room = overview.rooms.find((item) => item.room === 'A301');
  assert.ok(room);
  assert.equal(room.members.length, 0);
  assert.equal(room.incidents, 1);
  assert.equal(overview.assigned, 0);
});
