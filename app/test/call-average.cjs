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

const students = ['001', '002', '003', '004', '005', '006', '007'].map((id, i) => ({ id, name: '学生' + (i + 1), gender: '男', note: '' }));
const Y = v => ({ '语文': v, '总分': v === null ? null : v + 5 });
const exams = [
  { id: 'e1', name: '第一次周练', date: '2026-09-01', subjects: ['语文', '总分'], scores: { '001': Y(60), '002': Y(70), '003': Y(80), '004': Y(90), '005': Y(100), '006': Y(50) } },
  { id: 'e2', name: '第二次周练', date: '2026-09-08', subjects: ['语文', '总分'], scores: { '001': Y(70), '002': Y(80), '003': Y(90), '004': Y(100), '005': Y(null), '006': Y(60) } },
  { id: 'e3', name: '第三次周练', date: '2026-09-15', subjects: ['语文', '总分'], scores: { '001': Y(80), '002': Y(90), '003': Y(100), '004': Y(null), '005': Y(null), '006': Y(70) } },
  { id: 'e4', name: '第四次周练', date: '2026-10-01', subjects: ['语文', '总分'], scores: { '001': Y(null), '002': Y(null), '003': Y(null), '004': Y(null), '005': Y(110), '006': Y(80) } },
];
run(`state.students=${JSON.stringify(students)};state.exams=${JSON.stringify(exams)};state.examId='e1';state.callRange='single';state.callSubject='语文';render();setPage('call')`);

const rows = () => JSON.parse(run("JSON.stringify(rankedGroups().all.filter(x=>x.score!==null).map(x=>[x.student.id,x.score,x.count,x.total]))"));
const setRange = r => { run(`state.callRange='${r}'`); run('renderCall()'); };

test('单次考试模式取当前这场成绩', () => {
  assert.deepEqual(rows(), [
    ['005', 100, 1, 1], ['004', 90, 1, 1], ['003', 80, 1, 1],
    ['002', 70, 1, 1], ['001', 60, 1, 1], ['006', 50, 1, 1],
  ]);
});

test('最近 3 次平均：取有该科的最近三场并按有效成绩平均', () => {
  setRange('recent3');
  assert.deepEqual(rows(), [
    ['005', 110, 1, 3], ['004', 100, 1, 3], ['003', 95, 2, 3],
    ['002', 85, 2, 3], ['001', 75, 2, 3], ['006', 70, 3, 3],
  ]);
});

test('全部考试平均：四场都已考该科', () => {
  setRange('all');
  assert.deepEqual(rows(), [
    ['005', 105, 2, 4], ['004', 95, 2, 4], ['003', 90, 3, 4],
    ['002', 80, 3, 4], ['001', 70, 3, 4], ['006', 65, 4, 4],
  ]);
});

test('平均模式下仍按 30/40/30 分类，无成绩者单列', () => {
  const g = JSON.parse(run("JSON.stringify(Object.fromEntries(Object.entries(rankedGroups()).map(([k,v])=>[k,v.map(x=>x.student.id)])))"));
  assert.deepEqual(g.excellent, ['005', '004']);
  assert.deepEqual(g.middle, ['003', '002']);
  assert.deepEqual(g.support, ['001', '006']);
  assert.deepEqual(g.ungraded, ['007']);
});

test('统计方式下拉包含四种模式，平均模式隐藏单场考试选择', () => {
  const labels = JSON.parse(run("JSON.stringify([...document.querySelectorAll('#callRange option')].map(o=>o.textContent))"));
  assert.deepEqual(labels, ['单次考试', '最近 3 次平均', '最近 5 次平均', '全部考试平均']);
  assert.ok(doc.querySelector('#callExamWrap').classList.contains('hidden'), '平均模式仍显示考试下拉');
  setRange('single');
  assert.equal(doc.querySelector('#callExamWrap').classList.contains('hidden'), false);
});

test('平均模式的表头和范围说明标出平均分', () => {
  setRange('recent5');
  assert.ok(doc.querySelector('#callMembers').textContent.includes('语文（均分）'));
  assert.ok(doc.querySelector('#callPoolLabel').textContent.includes('最近 5 次平均'));
  assert.ok(doc.querySelector('#callRemaining').textContent.includes('当前范围'));
  setRange('all');
  assert.ok(doc.querySelector('#callDetail').textContent.includes('全部考试平均'));
});

test('最近 5 次不足五次时按实际场次计算', () => {
  setRange('recent5');
  const totals = new Set(rows().map(r => r[3]));
  assert.deepEqual([...totals], [4], '只有四场考试时应按四场计算');
});

test('科目下拉聚合多次考试并保持学科顺序', () => {
  const opts = JSON.parse(run("JSON.stringify([...document.querySelectorAll('#callSubject option')].map(o=>o.textContent))"));
  assert.deepEqual(opts, ['语文', '总分']);
});

test('切换统计方式会开始新一轮', () => {
  setRange('single');
  run('callCategory="all";renderCall();drawStudent()');
  assert.equal(run('callLog.length'), 1);
  setRange('recent3');
  assert.equal(run('callLog.length'), 0);
  assert.equal(run('callResult'), null);
});

test('平均模式下可以正常点名且信息包含依据', () => {
  setRange('recent3');
  run("callCategory='excellent';renderCall()");
  const id = run('drawStudent()');
  assert.ok(['005', '004'].includes(id), id);
  assert.ok(doc.querySelector('#callDetail').textContent.includes('最近 3 次平均'));
});

test('单场模式与平均模式互不影响座位表显示', () => {
  const subjectBefore = run('state.subject');
  setRange('all');
  assert.equal(run('state.subject'), subjectBefore);
});

console.log(`\n${checks} 项点名平均分测试全部通过`);
w.close();
