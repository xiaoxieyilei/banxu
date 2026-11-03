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

run(`state.students=[
  {id:'001',name:'丙三',gender:'男',note:''},
  {id:'002',name:'甲一',gender:'女',note:''},
  {id:'003',name:'乙二',gender:'男',note:''}];
state.exams=[{id:'e1',name:'十月周练',date:'2026-10-11',subjects:['语文','数学','总分'],scores:{
  '001':{'语文':80,'数学':90,'总分':170},
  '002':{'语文':95,'数学':60,'总分':155},
  '003':{'语文':70,'数学':null,'总分':null}}}];
state.examId='e1';examPreviewId='e1';render();setPage('exams')`);

const col = n => JSON.parse(run(`JSON.stringify([...document.querySelectorAll('#examPreviewPanel tbody tr')].map(r=>r.children[${n}].textContent.trim()))`));
const head = label => {
  const index = JSON.parse(run("JSON.stringify([...document.querySelectorAll('#examPreviewPanel thead th')].map(t=>t.textContent))")).findIndex(t => t.startsWith(label));
  doc.querySelectorAll('#examPreviewPanel thead .sort-btn')[index].click();
};

test('预览默认按学号升序', () => {
  assert.deepEqual(col(0), ['001', '002', '003']);
});

test('点科目表头先按成绩从高到低，再点反向', () => {
  head('语文');
  assert.deepEqual(col(1), ['甲一', '丙三', '乙二']);
  head('语文');
  assert.deepEqual(col(1), ['乙二', '丙三', '甲一']);
});

test('缺考学生在升序与降序里都排在最后', () => {
  head('数学'); // 降序
  assert.deepEqual(col(1), ['丙三', '甲一', '乙二']);
  head('数学'); // 升序
  assert.deepEqual(col(1), ['甲一', '丙三', '乙二']);
});

test('排序状态在表头有 ▲ / ▼ 标记', () => {
  assert.ok(run("document.querySelector('#examPreviewPanel thead').textContent.includes('▲')"), '缺少升序标记');
  head('语文');
  assert.ok(run("document.querySelector('#examPreviewPanel thead').textContent.includes('▼')"), '缺少降序标记');
});

test('姓名列可排序，再点一次为反向', () => {
  head('姓名');
  const asc = col(1);
  head('姓名');
  assert.deepEqual(col(1), [...asc].reverse());
});

test('搜索与排序可叠加', () => {
  doc.querySelector('#examPreviewSearch').value = '甲';
  doc.querySelector('#examPreviewSearch').dispatchEvent(new w.Event('input'));
  assert.deepEqual(col(1), ['甲一']);
  doc.querySelector('#examPreviewSearch').value = '';
  doc.querySelector('#examPreviewSearch').dispatchEvent(new w.Event('input'));
  assert.equal(col(1).length, 3);
});

test('学号列恢复升序', () => {
  doc.querySelectorAll('#examPreviewPanel thead .sort-btn')[0].click();
  assert.deepEqual(col(0), ['001', '002', '003']);
  doc.querySelectorAll('#examPreviewPanel thead .sort-btn')[0].click();
  assert.deepEqual(col(0), ['003', '002', '001']);
});

console.log(`\n${checks} 项成绩预览排序测试全部通过`);
w.close();
