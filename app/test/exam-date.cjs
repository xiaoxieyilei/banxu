const {JSDOM} = require('jsdom');
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
const run = s => w.eval(s);
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('PASS ' + name); }

// ---------- 日期解析 ----------
test('日期解析兼容多种写法并拒绝非法日期', () => {
  assert.equal(run("toISODate('2026-10-11')"), '2026-10-11');
  assert.equal(run("toISODate('2026/9/5')"), '2026-09-05');
  assert.equal(run("toISODate('2026.9.5')"), '2026-09-05');
  assert.equal(run("toISODate('2026年9月5日')"), '2026-09-05');
  assert.equal(run("toISODate('20261011')"), '2026-10-11');
  assert.equal(run("toISODate('')"), '');
  assert.equal(run("toISODate('示例数据')"), '');
  assert.equal(run("toISODate('2026-13-01')"), '');
  assert.equal(run("toISODate('2026-00-10')"), '');
});

// ---------- 导入必填考试时间 ----------
run('demo()');
const baseline = run('state.exams.length');
test('示例班级有两场带日期的考试', () => {
  assert.equal(baseline, 2);
  assert.equal(run("state.exams.map(e=>e.date).join(',')"), '2026-09-26,2026-09-05');
});

test('导入时缺少考试时间会被拒绝且不写入数据', () => {
  run("openImport('exam');staged=parseSheet([['学号','数学'],['001','100']],'exam')");
  assert.ok(run("!!document.querySelector('#examDate')"), '缺少考试时间输入框');
  assert.equal(run("document.querySelector('#examDate').required"), true);
  run("document.querySelector('#examName').value='第三次月考';document.querySelector('#examDate').value='';commitImport()");
  assert.equal(run('state.exams.length'), baseline);
});

test('填写考试时间后正常导入并按时间倒序插入', () => {
  run("document.querySelector('#examName').value='第三次月考';document.querySelector('#examDate').value='2026-11-02';commitImport()");
  assert.equal(run('state.exams.length'), baseline + 1);
  assert.equal(run("state.exams.find(e=>e.name==='第三次月考').date"), '2026-11-02');
  assert.equal(run("state.exams[0].date"), '2026-11-02');
  assert.equal(run("getExam().name"), '第三次月考');
});

test('补录更早的考试会插入到正确位置', () => {
  run("openImport('exam');document.querySelector('#examName').value='补录月考';document.querySelector('#examDate').value='2026-08-01';staged=parseSheet([['学号','数学'],['002','80']],'exam');commitImport()");
  assert.equal(run("state.exams.map(e=>e.date).join(',')"), '2026-11-02,2026-09-26,2026-09-05,2026-08-01');
});

// ---------- 各页面按日期排序 ----------
test('座位表与点名页的考试下拉按时间倒序并显示日期', () => {
  const opts = run("[...document.querySelectorAll('#examSelect option')].map(o=>o.textContent)");
  assert.deepEqual(JSON.parse(run('JSON.stringify([...document.querySelectorAll("#examSelect option")].map(o=>o.textContent))')), [
    '第三次月考（2026-11-02）', '第一次月考（示例）（2026-09-26）', '开学摸底考（示例）（2026-09-05）', '补录月考（2026-08-01）',
  ]);
  assert.ok(opts.length === 4);
  assert.deepEqual(JSON.parse(run('JSON.stringify([...document.querySelectorAll("#callExam option")].map(o=>o.textContent))')), JSON.parse(run('JSON.stringify([...document.querySelectorAll("#examSelect option")].map(o=>o.textContent))')));
});

test('考试成绩页的考试档案按时间倒序并显示考试时间', () => {
  run("setPage('exams')");
  const cards = run("JSON.stringify([...document.querySelectorAll('#examCards .exam-card')].map(c=>c.querySelector('h3').textContent))");
  assert.deepEqual(JSON.parse(cards), ['第三次月考', '第一次月考（示例）', '开学摸底考（示例）', '补录月考']);
  assert.ok(run("document.querySelector('#examCards').textContent.includes('考试时间 2026-11-02')"));
  // 刚导入的考试自动成为预览对象（即便它排在中后段）
  assert.ok(run("document.querySelector('#examPreviewPanel').textContent.includes('补录月考')"));
  assert.ok(run("document.querySelector('#examPreviewPanel').textContent.includes('考试时间 2026-08-01')"));
});

// ---------- 修改考试信息 ----------
test('修改考试信息可同时改日期并重新排序', () => {
  run("renameExam(state.exams.find(e=>e.name==='补录月考').id)");
  run("document.querySelector('#renameExamInput').value='补录月考';document.querySelector('#renameExamDate').value='2026-12-01';document.querySelector('#saveExamName').click()");
  assert.equal(run("state.exams[0].name"), '补录月考');
  assert.equal(run("state.exams[0].date"), '2026-12-01');
});

test('修改考试信息时留空日期会被拒绝', () => {
  run("renameExam(state.exams[0].id)");
  run("document.querySelector('#renameExamInput').value='补录月考';document.querySelector('#renameExamDate').value='';document.querySelector('#saveExamName').click()");
  assert.equal(run("state.exams[0].date"), '2026-12-01');
});

// ---------- 学生成绩气泡按时间先后 ----------
test('成绩变化气泡按考试时间从早到晚展示并带日期', () => {
  run("closeStudentBubbles();openStudentBubbles('002')");
  const names = JSON.parse(run("JSON.stringify([...document.querySelectorAll('#scoreHistory .bubble-item > b')].map(b=>b.textContent))"));
  assert.deepEqual(names, ['开学摸底考（示例）', '第一次月考（示例）', '补录月考']);
  assert.ok(run("document.querySelector('#scoreHistory').textContent.includes('2026-12-01')"));
  const dates = JSON.parse(run("JSON.stringify([...document.querySelectorAll('#scoreHistory .bubble-item')].map(i=>toISODate(i.querySelector('span').textContent)))"));
  assert.deepEqual(dates, ['2026-09-05', '2026-09-26', '2026-12-01']);
});

// ---------- 旧数据兼容 ----------
test('旧备份里的非标准日期载入后被规范化，无法解析的排在最后', () => {
  const legacy = JSON.parse(run('JSON.stringify(state)'));
  legacy.exams = [
    {id: 'a', name: '旧考试A', date: '2026/10/21', subjects: ['数学', '总分'], scores: {}},
    {id: 'b', name: '示例', date: '示例数据', subjects: ['数学', '总分'], scores: {}},
    {id: 'c', name: '旧考试C', date: '2026-10-11', subjects: ['数学', '总分'], scores: {}},
  ];
  legacy.examId = '';
  const d2 = makeDom(JSON.stringify(legacy));
  const r2 = s => d2.window.eval(s);
  assert.equal(r2("state.exams.find(e=>e.id==='a').date"), '2026-10-21');
  assert.equal(r2("state.exams.find(e=>e.id==='b').date"), '示例数据');
  assert.equal(r2("sortedExams().map(e=>e.name).join(',')"), '旧考试A,旧考试C,示例');
  assert.equal(r2("document.querySelector('#examSelect').options[0].textContent"), '旧考试A（2026-10-21）');
  d2.window.close();
});

// ---------- 回归 ----------
test('回归：58 座、大组轮换四次复位、导入与点名正常', () => {
  assert.equal(run("document.querySelectorAll('[data-seat]').length"), 58);
  const before = run('JSON.stringify(state.seats)');
  run('rotateGroups();rotateGroups();rotateGroups();rotateGroups()');
  assert.equal(run('JSON.stringify(state.seats)'), before);
  run("setPage('call');callCategory='all';renderCall()");
  assert.ok(run('!!drawStudent()'));
});

console.log(`\n${checks} 项考试时间相关测试全部通过`);
w.close();
