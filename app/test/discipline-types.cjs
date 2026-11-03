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
const types = () => [...doc.querySelectorAll('#discTypes button')].map(b => b.textContent);

const students = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九'].map((name, i) => ({ id: '00' + (i + 1), name, gender: '男', note: '' }));
run(`state.students=${JSON.stringify(students)};state.seats={};state.discipline={};render()`);

test('违纪类型是 8 个按钮，默认选中晚自习违纪', () => {
  assert.equal(types().length, 8);
  assert.deepEqual(types(), ['晚自习违纪', '晚自习静校期间违纪', '早自习违纪', '迟到违纪', '眼保健操违纪', '午休违纪', '寝室违纪', '带水杯进教室']);
  run("openStudentBubbles('001')");
  const on = doc.querySelector('#discTypes button.on');
  assert.equal(on.textContent, '晚自习违纪');
});

test('点类型按钮可切换，添加记录保存类型，备注可不填', () => {
  doc.querySelectorAll('#discTypes button')[3].click(); // 迟到违纪
  assert.equal(doc.querySelector('#discTypes button.on').textContent, '迟到违纪');
  doc.querySelector('#disciplineDate').value = '2026-10-01';
  doc.querySelector('#disciplineReason').value = '';
  doc.querySelector('#addDiscipline').click();
  const rec = run("state.discipline['001'][0]");
  assert.deepEqual(rec, { date: '2026-10-01', type: '迟到违纪', reason: '' });
  assert.ok(doc.querySelector('#disciplineList').textContent.includes('迟到违纪'));
});

test('违纪情况页只列出有违纪的学生，按次数从多到少', () => {
  run("state.discipline={'001':[{date:'2026-10-01',type:'晚自习违纪',reason:''},{date:'2026-10-02',type:'晚自习违纪',reason:''}],'002':[{date:'2026-10-03',type:'迟到违纪',reason:''}]};setPage('discipline');renderDisciplinePage()");
  const rows = [...doc.querySelectorAll('#discTable tbody tr')];
  assert.equal(rows.length, 2, '只有 2 人有违纪，第三人不显示');
  assert.ok(rows[0].textContent.includes('张三'));
  assert.ok(rows[0].textContent.includes('2'));
  assert.ok(rows[1].textContent.includes('李四'));
  assert.ok(rows.every(r => !r.textContent.includes('王五')));
  assert.ok(rows[0].textContent.includes('晚自习违纪 × 2'), '应显示该生的类型明细');
});

test('页面汇总文字显示总条数与涉及人数', () => {
  assert.equal(doc.querySelector('#discSummary').textContent, '3 条违纪记录 · 2 位学生 · 全部时间');
});

test('点某一行的学生可打开该生的违纪明细气泡', () => {
  doc.querySelector('#discTable tbody tr').click();
  assert.ok(doc.querySelector('#studentBubbles').classList.contains('open'));
  assert.ok(doc.querySelector('#disciplineStudent').textContent.includes('张三'));
  assert.equal(doc.querySelectorAll('#disciplineList .bubble-item').length, 2);
  run('closeStudentBubbles()');
});

test('违纪情况页可按近 7 天 / 近 30 天筛选', () => {
  const today = new Date().toISOString().slice(0, 10);
  run(`state.discipline={'001':[{date:'2020-01-01',type:'迟到违纪',reason:''},{date:'${today}',type:'晚自习违纪',reason:''}],'002':[{date:'2020-02-02',type:'迟到违纪',reason:''}]};renderDisciplinePage()`);
  assert.equal(doc.querySelectorAll('#discTable tbody tr').length, 2);
  const sel = doc.querySelector('#discPageRange');
  sel.value = '7';
  sel.dispatchEvent(new w.Event('change'));
  const rows = [...doc.querySelectorAll('#discTable tbody tr')];
  assert.equal(rows.length, 1, '近 7 天只剩张三 1 条');
  assert.ok(rows[0].textContent.includes('张三'));
  assert.ok(rows[0].textContent.includes('1'));
  sel.value = 'all';
  sel.dispatchEvent(new w.Event('change'));
  assert.equal(doc.querySelectorAll('#discTable tbody tr').length, 2);
});

test('搜索可过滤违纪名单', () => {
  doc.querySelector('#discSearch').value = '李四';
  doc.querySelector('#discSearch').dispatchEvent(new w.Event('input'));
  const rows = [...doc.querySelectorAll('#discTable tbody tr')];
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes('李四'));
  doc.querySelector('#discSearch').value = '';
  doc.querySelector('#discSearch').dispatchEvent(new w.Event('input'));
});

// ---------- 文字快速导入 ----------
test('文本解析：日期、姓名、类型、默认日期', () => {
  const rows = JSON.parse(run("JSON.stringify(parseDiscText('9月20日 张三 晚自习违纪\\n2026-10-11 李四 迟到\\n王五 迟到','2026-10-01'))"));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, `${new Date().getFullYear()}-09-20`);
  assert.equal(rows[0].type, '晚自习违纪');
  assert.equal(rows[0].student.name, '张三');
  assert.equal(rows[1].type, '迟到违纪');
  assert.equal(rows[2].status, '按默认日期');
  assert.equal(rows[2].date, '2026-10-01');
});

test('“静校”不会被误判成“晚自习违纪”', () => {
  const rows = JSON.parse(run("JSON.stringify(parseDiscText('9月21日 王五 静校',  '2026-10-01'))"));
  assert.equal(rows[0].type, '晚自习静校期间违纪');
});

test('简称能识别：眼操 / 水杯 / 宿舍 / 早读', () => {
  const rows = JSON.parse(run("JSON.stringify(parseDiscText('9月22日 孙八 眼操\\n9月22日 周九 水杯\\n9月22日 孙八 宿舍\\n9月22日 周九 早读',''))"));
  assert.deepEqual(rows.map(r => r.type), ['眼保健操违纪', '带水杯进教室', '寝室违纪', '早自习违纪']);
});

test('一行多个学生拆成多条记录', () => {
  const rows = JSON.parse(run("JSON.stringify(parseDiscText('9月23日 张三、李四、王五 迟到违纪',''))"));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.student.name), ['张三', '李四', '王五']);
});

test('未匹配学生、缺类型、缺日期会标出问题且不可导入', () => {
  const rows = JSON.parse(run("JSON.stringify(parseDiscText('9月24日 无名氏 迟到\\n9月24日 张三\\n李四 迟到',''))"));
  assert.equal(rows[0].ok, false);
  assert.ok(rows[0].status.includes('未找到学生'));
  assert.equal(rows[1].ok, false);
  assert.ok(rows[1].status.includes('缺少违纪类型'));
  assert.equal(rows[2].ok, false);
  assert.ok(rows[2].status.includes('缺少日期'));
});

test('备注文字保留在 reason 里', () => {
  const rows = JSON.parse(run("JSON.stringify(parseDiscText('9月25日 张三 迟到 迟到5分钟',''))"));
  assert.equal(rows[0].reason, '迟到5分钟');
});

test('快速导入弹窗可以预览并真正写入', () => {
  run("state.discipline={};render()");
  run("setPage('discipline')");doc.querySelector('#discPageImport').click();
  const ta = doc.querySelector('#discText');
  ta.value = '9月20日 张三 晚自习违纪\n2026-09-21 李四、王五 迟到\n9月22日 无名氏 迟到';
  ta.dispatchEvent(new w.Event('input'));
  assert.ok(doc.querySelector('#discParseNotice').textContent.includes('可导入 3 条'));
  assert.ok(doc.querySelector('#discParsePreview').textContent.includes('未找到学生'));
  doc.querySelector('#discImportCommit').click();
  assert.equal(run("state.discipline['001'].length"), 1);
  assert.equal(run("state.discipline['002'].length"), 1);
  assert.equal(run("state.discipline['003'].length"), 1);
  assert.equal(run("state.discipline['003'][0].type"), '迟到违纪');
});

test('重复导入会跳过重复条目并可撤销', () => {
  run("state.discipline={};openDiscImport();document.querySelector('#discText').value='9月20日 张三 晚自习违纪';document.querySelector('#discText').dispatchEvent(new Event('input'));document.querySelector('#discImportCommit').click();");
  assert.equal(run("state.discipline['001'].length"), 1);
  run("openDiscImport();document.querySelector('#discText').value='9月20日 张三 晚自习违纪';document.querySelector('#discText').dispatchEvent(new Event('input'));document.querySelector('#discImportCommit').click();");
  assert.equal(run("state.discipline['001'].length"), 1, '重复条目不应重复写入');
  run("openDiscImport();document.querySelector('#discText').value='9月26日 张三 午休违纪';document.querySelector('#discText').dispatchEvent(new Event('input'));document.querySelector('#discImportCommit').click();");
  assert.equal(run("state.discipline['001'].length"), 2);
  doc.querySelector('#undoBtn').click();
  assert.equal(run("state.discipline['001'].length"), 1, '撤销应恢复导入前状态');
});

test('导入后汇总与名单同步更新', () => {
  assert.ok(doc.querySelector('#discSummary').textContent.includes('条违纪记录'));
  assert.ok(doc.querySelectorAll('#discTable tbody tr').length >= 1);
});

console.log(`\n${checks} 项违纪类型与快速导入测试全部通过`);
w.close();
