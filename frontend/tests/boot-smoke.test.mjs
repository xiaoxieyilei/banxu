import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 用 DOM 桩跑一次完整启动流程（main.js 会立即执行 boot()）：
 * 覆盖 store.load → 渲染 → 页面切换，能捕获“首次加载即抛错导致白屏”的问题。
 */
const nodes = new Map();
const makeNode = (id) => ({
  id,
  innerHTML: '',
  textContent: '',
  value: '',
  checked: true,
  disabled: false,
  hidden: false,
  open: false,
  dataset: {},
  style: {},
  classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
  addEventListener() {},
  setAttribute() {},
  getAttribute: () => null,
  focus() {},
  setSelectionRange() {},
  selectionStart: 0,
});
globalThis.document = {
  querySelector(selector) {
    if (!selector.startsWith('#')) return null;
    const id = selector.slice(1);
    if (!nodes.has(id)) nodes.set(id, makeNode(id));
    return nodes.get(id);
  },
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => makeNode('tmp'),
  body: { append() {} },
  activeElement: null,
};
globalThis.window = { addEventListener() {}, setTimeout, clearTimeout, print() {} };
globalThis.HTMLDialogElement = function HTMLDialogElement() {};
globalThis.Event = class Event {};

const state = {
  settings: {
    className: '启动测试班',
    rows: 7,
    extraRow: 5,
    showScores: true,
    examId: 'e1',
    subject: '总分',
    callRange: 'single',
    callSubject: '',
    seatRange: 'all',
  },
  students: [
    { id: '001', name: '张三', gender: '男', note: '' },
    { id: '002', name: '李四', gender: '女', note: '' },
  ],
  exams: [
    { id: 'e1', name: '周练', date: '2026-10-11', subjects: ['总分'], sourceFormat: '', scores: { '001': { 总分: 90 } }, ranks: {} },
  ],
  seats: { R1C8: '001' },
  discipline: {},
};

let fetchCount = 0;
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.includes('/api/auth/status')) {
    return { ok: true, status: 200, json: async () => ({ required: false, authenticated: true }) };
  }
  if (target.includes('/api/health')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', version: '2.1.0', features: ['seatRange', 'pdfExamImport', 'autoClassRanks'] }),
    };
  }
  fetchCount += 1;
  return { ok: true, status: 200, json: async () => state };
};

test('整页启动：拉取状态并渲染座位表，不抛异常', async () => {
  await import('../dist/main.js');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fetchCount, 1, '启动时只应请求一次 /api/state');
  const seating = nodes.get('seating')?.innerHTML ?? '';
  assert.ok(seating.includes('data-seat='), '座位表未渲染');
  assert.equal((seating.match(/data-seat=/g) ?? []).length, 58);
  assert.equal(nodes.get('className')?.value, '启动测试班');
  assert.ok(nodes.get('statSeated')?.innerHTML.includes('/ 58'));
});
