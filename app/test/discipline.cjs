const { JSDOM } = require('jsdom');
const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync(__dirname + '/../../dist/班序-班级管理.html', 'utf8');
const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  beforeParse(w) {
    w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  },
});
const w = dom.window;
const doc = w.document;
const run = s => w.eval(s);
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }

const click = sel => doc.querySelector(sel).click();
function addDiscipline(date, reason) {
  doc.querySelector('#disciplineDate').value = date;
  doc.querySelector('#disciplineReason').value = reason;
  click('#addDiscipline');
}
const badge = () => doc.querySelector('#disciplineStudent').textContent;
const items = () => [...doc.querySelectorAll('#disciplineList .bubble-item')].map(i => i.textContent);
const restoreHidden = () => doc.querySelector('#restoreDiscipline').hidden;

run('demo()');
run("openStudentBubbles('001')");

test('添加违纪记录后显示条数与列表', () => {
  addDiscipline('2026-10-01', '迟到');
  addDiscipline('2026-10-08', '未交作业');
  assert.equal(run("state.discipline['001'].length"), 2);
  assert.equal(items().length, 2);
  assert.ok(badge().includes('违纪 2 条'), badge());
});

test('列表按时间倒序，最新一条在最上面', () => {
  assert.ok(items()[0].includes('未交作业'), items()[0]);
  assert.ok(items()[0].includes('2026-10-08'), items()[0]);
});

test('可以删除指定的某一条（不是只能删最后一条）', () => {
  click('#disciplineList [data-del-disc="1"]'); // 删掉“未交作业”
  assert.equal(run("state.discipline['001'].length"), 1);
  assert.equal(run("state.discipline['001'][0].reason"), '迟到');
  assert.ok(badge().includes('违纪 1 条'), badge());
  assert.equal(restoreHidden(), false, '删除后应出现“恢复刚删除”');
});

test('删除后可以点“恢复刚删除”放回原位置', () => {
  click('#restoreDiscipline');
  assert.equal(run("state.discipline['001'].length"), 2);
  assert.equal(run("state.discipline['001'][1].reason"), '未交作业');
  assert.equal(restoreHidden(), true);
});

test('撤销上一条只删最近添加的记录', () => {
  click('#undoDiscipline');
  assert.equal(run("state.discipline['001'].length"), 1);
  assert.equal(run("state.discipline['001'][0].reason"), '迟到');
  assert.equal(restoreHidden(), false);
});

test('撤销后仍可恢复', () => {
  click('#restoreDiscipline');
  assert.equal(run("state.discipline['001'].length"), 2);
});

test('违纪记录写入本地存储', () => {
  const saved = JSON.parse(w.localStorage.getItem('banxu.classroom.v1'));
  assert.equal(saved.discipline['001'].length, 2);
  assert.equal(saved.discipline['001'][1].reason, '未交作业');
});

test('全局撤销后，打开的气泡内容同步刷新', () => {
  click('#undoBtn'); // 撤销刚才的“恢复”操作
  assert.equal(run("state.discipline['001'].length"), 1);
  assert.equal(items().length, 1, '气泡列表没有跟着刷新');
  assert.equal(run("state.discipline['001'][0].reason"), '迟到');
});

test('切换到另一名学生时清空“恢复刚删除”状态', () => {
  run("openStudentBubbles('002')");
  assert.equal(restoreHidden(), true);
  click('#undoDiscipline'); // 另一名学生没有记录，应安全提示不报错
  assert.equal(run("state.discipline['002']"), undefined);
});

test('删光某学生的记录后回到空状态', () => {
  run("openStudentBubbles('003')");
  addDiscipline('2026-10-09', '上课说话');
  click('#disciplineList [data-del-disc="0"]');
  assert.equal(run("state.discipline['003']"), undefined);
  assert.ok(doc.querySelector('#disciplineList').textContent.includes('暂时没有违纪记录'));
});

test('删除学生时一并清除其违纪记录', () => {
  run("closeStudentBubbles();setPage('roster');openStudentBubbles('004');");
  run("closeStudentBubbles()");
  run("state.discipline['004']=[{date:'2026-10-02',reason:'临时记录'}];save();render()");
  click('[data-delete="004"]');
  click('#confirmAction');
  assert.equal(run("state.discipline['004']"), undefined);
  assert.equal(run("state.students.some(p=>p.id==='004')"), false);
});

test('备份能带上违纪记录（validState 通过）', () => {
  addDiscipline('2026-10-10', '备份测试');
  assert.ok(run('validState(JSON.parse(JSON.stringify(state)))'));
});

console.log(`\n${checks} 项违纪记录删除/撤销测试全部通过`);
w.close();
