const { JSDOM } = require('jsdom');
const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync(__dirname + '/../../dist/班序-班级管理.html', 'utf8');
function makeDom(storage) {
  return new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    beforeParse(w) {
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; };
      if (storage) w.localStorage.setItem('banxu.classroom.v1', storage);
    },
  });
}
const dom = makeDom();
const w = dom.window;
const doc = w.document;
const run = s => w.eval(s);
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }
const seatCount = () => doc.querySelectorAll('[data-seat]').length;

run('demo()');

test('默认 7 排共 58 座，7 排座位可渲染', () => {
  assert.equal(run('state.rows'), 7);
  assert.equal(seatCount(), 58);
  assert.equal(doc.querySelectorAll('[data-seat^="R7C"]').length, 8);
  assert.ok(doc.querySelector('#statSeated').textContent.includes('/ 58'));
  assert.equal(doc.querySelector('#legendRegular').textContent, '常规座位 56');
  assert.equal(doc.querySelector('#legendCapacity').textContent, '4 组 × 2 列 × 7 排 · 共 58 座');
});

test('可以把学生安排到第 7 排（空座）', () => {
  run("state.seats={};render()");
  run("moveStudent('001','R7C5')");
  assert.equal(run("state.seats.R7C5"), '001');
  const seat = doc.querySelector('[data-seat="R7C5"]');
  assert.ok(seat.classList.contains('occupied'));
  assert.equal(seat.querySelector('.seat-name').textContent, '陈一诺');
  assert.equal(seat.querySelector('.seat-code').textContent, '4-7', '第 7 排坐标应为 列-7');
});

test('第 7 排学生与其他排可互换', () => {
  run("moveStudent('001','R1C1')");
  assert.equal(run("state.seats.R1C1"), '001');
  assert.equal(run("state.seats.R7C5"), undefined);
});

test('大组轮换包含第 7 排，中央加座不动', () => {
  run("state.seats={R7C5:'001',X1:'002',R7C1:'003'};render();rotateGroups()");
  assert.equal(run("state.seats.R7C3"), '001', '第 7 排也要换组');
  assert.equal(run("state.seats.R7C7"), '003');
  assert.equal(run("state.seats.X1"), '002');
});

test('中央加座可在第 6–7 排之间选择', () => {
  const labels = JSON.parse(run("JSON.stringify([...document.querySelectorAll('#extraRow option')].map(o=>o.textContent))"));
  assert.deepEqual(labels, ['第 1–2 排', '第 2–3 排', '第 3–4 排', '第 4–5 排', '第 5–6 排', '第 6–7 排']);
  run("document.querySelector('#extraRow').value='6';state.extraRow=6;render()");
  const x2 = doc.querySelector('[data-seat="X2"]');
  assert.equal(x2.style.gridRow, '8', '第 6–7 排时 X2 应在第 8 行网格（即第 7 排）');
  assert.ok(x2.querySelector('.seat-code').textContent.includes('中-7'));
});

test('减少到 6 排时，第 7 排学生先提示再回到待安排区', () => {
  run("state.seats={R7C1:'001',R1C1:'002'};render()");
  const sel = doc.querySelector('#rowsSelect');
  sel.value = '6';
  sel.dispatchEvent(new w.Event('change'));
  assert.ok(run("document.querySelector('#modal').open"), '应弹出确认');
  assert.ok(doc.querySelector('#modalBody').textContent.includes('第 7 排还有 1 名学生'));
  assert.equal(run('state.rows'), 7, '确认前不改数据');
  doc.querySelector('#confirmAction').click();
  assert.equal(run('state.rows'), 6);
  assert.equal(run("state.seats.R7C1"), undefined);
  assert.equal(run("state.seats.R1C1"), '002');
  assert.equal(seatCount(), 50);
  assert.equal(run("studentSeat('001')"), undefined, '第 7 排学生应回到待安排区');
});

test('取消确认时保持 7 排不变', () => {
  run("state.rows=7;state.seats={R7C2:'003'};render()");
  const sel = doc.querySelector('#rowsSelect');
  sel.value = '6';
  sel.dispatchEvent(new w.Event('change'));
  doc.querySelector('#modal [data-close]').click();
  assert.equal(run('state.rows'), 7);
  assert.equal(run("state.seats.R7C2"), '003');
  assert.equal(doc.querySelector('#rowsSelect').value, '7');
});

test('切回 6 排后仍可再切回 7 排，其余座位不丢', () => {
  run("state.rows=6;state.seats={R1C1:'004',X1:'005'};render()");
  assert.equal(seatCount(), 50);
  run("state.rows=7;render()");
  assert.equal(seatCount(), 58);
  assert.equal(run("state.seats.R1C1"), '004');
  assert.equal(run("state.seats.X1"), '005');
});

test('旧备份没有 rows 字段时按 7 排载入', () => {
  const old = JSON.parse(run('JSON.stringify(state)'));
  delete old.rows;
  const d2 = makeDom(JSON.stringify(old));
  assert.equal(d2.window.eval('state.rows'), 7);
  assert.equal(d2.window.document.querySelectorAll('[data-seat]').length, 58);
  d2.window.close();
});

test('校验规则随排数放宽（6 排不能有第 7 排中央加座）', () => {
  assert.ok(run("validState(Object.assign(JSON.parse(JSON.stringify(state)),{rows:7,extraRow:6}))"));
  assert.equal(run("validState(Object.assign(JSON.parse(JSON.stringify(state)),{rows:7,extraRow:7}))"), false);
  assert.equal(run("validState(Object.assign(JSON.parse(JSON.stringify(state)),{rows:6,extraRow:6}))"), false);
  assert.equal(run("validState(Object.assign(JSON.parse(JSON.stringify(state)),{rows:5}))"), false);
});

test('排座操作能填满 7 排（58 座）', () => {
  run("state.rows=7;state.seats={};arrange('order')");
  assert.equal(run('Object.keys(state.seats).length'), 50);
  assert.equal(run("Object.keys(state.seats).filter(k=>k.startsWith('R7')).length"), 0, '50 人只需前 6 排 + 加座');
});

console.log(`\n${checks} 项第七排测试全部通过`);
w.close();
