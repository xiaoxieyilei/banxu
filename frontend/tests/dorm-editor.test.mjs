import test from 'node:test';
import assert from 'node:assert/strict';

/** 极简 DOM 桩：记录 innerHTML、事件处理器与查询结果，用来验证寝室编辑器的渲染与保存载荷。 */
const nodes = new Map();
const makeNode = (id) => {
  const node = {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    open: false,
    dataset: {},
    handlers: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, handler) {
      (this.handlers[type] ??= []).push(handler);
    },
    showModal() {
      this.open = true;
    },
    close() {
      this.open = false;
    },
    querySelector() {
      return null;
    },
  };
  return node;
};

let memberInputs = [];
let memberOptions = [];
let incidentRows = [];

globalThis.document = {
  querySelector(selector) {
    if (!selector.startsWith('#')) return null;
    const id = selector.slice(1);
    if (!nodes.has(id)) nodes.set(id, makeNode(id));
    return nodes.get(id);
  },
  querySelectorAll(selector) {
    if (selector === '#dormEditMembers input[type="checkbox"]') return memberInputs;
    if (selector === '#dormEditMembers .dorm-member-option') return memberOptions;
    if (selector === '#dormEditIncidents .dorm-incident-row') return incidentRows;
    return [];
  },
  addEventListener() {},
  createElement: () => makeNode('tmp'),
  body: { append() {} },
  activeElement: null,
};
globalThis.window = { addEventListener() {}, setTimeout: () => 0, clearTimeout() {} };

const { openDormEditor } = await import('../dist/ui/dorm-page.js');

const node = (id) => document.querySelector('#' + id);

const students = [
  { id: '001', name: '张三', gender: '男', note: '', dorm: 'A301' },
  { id: '002', name: '李四', gender: '男', note: '', dorm: 'A301' },
  { id: '003', name: '王五', gender: '男', note: '', dorm: '' },
];
const state = {
  settings: {},
  students,
  exams: [],
  seats: {},
  discipline: {
    '001': [{ id: 'r1', date: '2026-10-13', type: '寝室违纪', reason: '熄灯后讲话' }],
    '002': [{ id: 'r2', date: '2026-10-13', type: '寝室违纪', reason: '熄灯后讲话' }],
  },
};

const fire = (node, type, event = {}) => {
  for (const handler of node.handlers[type] ?? []) handler(event);
};

const incidentRow = (date, reason) => ({
  querySelector(selector) {
    const input = makeNode(selector);
    input.value = selector === '.dorm-incident-date' ? date : reason;
    return input;
  },
});

test('编辑寝室：渲染现有成员与违纪，保存时提交改名、成员和违纪', async () => {
  memberInputs = [
    { value: '001', checked: true },
    { value: '002', checked: false },
    { value: '003', checked: true },
  ];
  incidentRows = [incidentRow('2026-10-13', '熄灯后讲话'), incidentRow('2026-10-20', '新备注')];

  let saved = null;
  const store = {
    state,
    saveDorm(payload) {
      saved = payload;
      return Promise.resolve(state);
    },
  };

  openDormEditor(store, 'A301');
  assert.equal(node('modalTitle').textContent, '编辑寝室 · A301');
  assert.ok(node('modalBody').innerHTML.includes('dormEditRoom'));
  assert.ok(node('modalBody').innerHTML.includes('value="A301"'));
  assert.ok(node('modalBody').innerHTML.includes('dorm-member-option current'));
  assert.ok(node('modalBody').innerHTML.includes('2026-10-13'));
  assert.equal(node('dormEditCount').textContent, '已选 2 人');

  node('dormEditRoom').value = 'B205';
  fire(node('dormEditSave'), 'click');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(saved, {
    originalRoom: 'A301',
    room: 'B205',
    studentIds: ['001', '003'],
    incidents: [
      { date: '2026-10-13', reason: '熄灯后讲话' },
      { date: '2026-10-20', reason: '新备注' },
    ],
  });
  assert.equal(node('modal').open, false);
  assert.ok(node('toast').textContent.includes('已保存寝室修改'));
});

test('添加寝室：原寝室号为空，未填成员时阻止保存', async () => {
  memberInputs = [
    { value: '001', checked: false },
    { value: '002', checked: false },
  ];
  incidentRows = [];
  let saved = null;
  const store = {
    state,
    saveDorm(payload) {
      saved = payload;
      return Promise.resolve(state);
    },
  };

  openDormEditor(store, null);
  assert.equal(node('modalTitle').textContent, '添加寝室');
  assert.ok(!node('modalBody').innerHTML.includes('value="A301"'));
  assert.equal(node('dormEditCount').textContent, '已选 0 人');

  node('dormEditRoom').value = 'A305';
  fire(node('dormEditSave'), 'click');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved, null, '没有成员时不应发起保存');
  assert.ok(node('toast').textContent.includes('至少勾选一名'));
});

test('只剩历史违纪的寝室：删除全部违纪后可清空', async () => {
  const orphanState = {
    ...state,
    students: students.map((student) => ({ ...student, dorm: '' })),
    discipline: {
      '001': [{ id: 'h1', date: '2026-10-13', type: '寝室违纪', reason: '', room: 'A301' }],
    },
  };
  memberInputs = [
    { value: '001', checked: false },
    { value: '002', checked: false },
    { value: '003', checked: false },
  ];
  incidentRows = [];
  let saved = null;
  const store = {
    state: orphanState,
    saveDorm(payload) {
      saved = payload;
      return Promise.resolve(orphanState);
    },
  };

  openDormEditor(store, 'A301');
  assert.ok(node('modalBody').innerHTML.includes('仅保留历史违纪记录'));
  node('dormEditRoom').value = 'A301';
  fire(node('dormEditSave'), 'click');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(saved, { originalRoom: 'A301', room: 'A301', studentIds: [], incidents: [] });
});
