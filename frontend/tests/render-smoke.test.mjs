import test from 'node:test';
import assert from 'node:assert/strict';

/** 极简 DOM 桩：按 #id 记录 innerHTML/textContent，用来验证渲染函数不抛错、产出关键结构。 */
const nodes = new Map();
const makeNode = (id) => {
  const classes = new Set();
  const node = {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    dataset: {},
    style: {},
    classes,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : force;
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
    addEventListener() {},
  };
  return node;
};
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

const { renderSeatPage } = await import('../dist/ui/seats.js');
const { renderRosterPage, renderExamsPage, renderDisciplinePage, renderCallPage } = await import('../dist/ui/pages.js');

const students = [
  { id: '001', name: '张三', gender: '男', note: '' },
  { id: '002', name: '李四', gender: '女', note: '' },
  { id: '003', name: '王五', gender: '男', note: '' },
];
const state = {
  settings: {
    className: '测试班',
    rows: 7,
    extraRow: 5,
    showScores: true,
    examId: 'e1',
    subject: '总分',
    callRange: 'single',
    callSubject: '',
    seatRange: 'all',
  },
  students,
  exams: [
    {
      id: 'e1',
      name: '十月周练',
      date: '2026-10-11',
      subjects: ['语文', '总分'],
      sourceFormat: 'Excel 导入',
      scores: { '001': { 语文: 90, 总分: 90 }, '002': { 语文: 70, 总分: 70 } },
      ranks: { '001': { 总分: { school: 2, class: 1 } } },
    },
  ],
  seats: { R7C8: '001', X1: '002' },
  discipline: { '001': [{ id: 'r1', date: '2026-10-12', type: '晚自习违纪', reason: '讲话' }] },
};

test('座位页渲染出 58 个座位、待安排区与成绩', () => {
  renderSeatPage(state);
  const seating = nodes.get('seating').innerHTML;
  assert.equal((seating.match(/data-seat=/g) ?? []).length, 58);
  assert.ok(seating.includes('张三'));
  assert.match(seating, /均分 <\/span>90/, '姓名下方显示多次考试平均总分');
  assert.ok(seating.includes('班次 1'), '姓名下方显示班级排名');
  assert.ok(seating.includes('gender-boy'));
  assert.ok(seating.includes('gender-girl'));
  assert.ok(seating.includes('1-7'), '第 7 排最右列角标应为 1-7');
  assert.ok(nodes.get('waitingList').innerHTML.includes('王五'));
  assert.equal(nodes.get('statSeated').innerHTML, '2<small>/ 58</small>');
});

test('座位页可按单次考试或科目平均分显示成绩与班次', () => {
  const exams = [
    {
      id: 'm1',
      name: '数学限时 1',
      date: '2026-10-01',
      subjects: ['数学'],
      sourceFormat: '',
      scores: { '001': { 数学: 80 }, '002': { 数学: 90 } },
      ranks: {},
    },
    {
      id: 'm2',
      name: '数学限时 2',
      date: '2026-10-08',
      subjects: ['数学'],
      sourceFormat: '',
      scores: { '001': { 数学: 100 }, '002': { 数学: 80 } },
      ranks: {},
    },
  ];

  renderSeatPage({
    ...state,
    exams,
    settings: { ...state.settings, seatRange: 'single', examId: 'm1', subject: '数学', showScores: true },
  });
  const single = nodes.get('seating').innerHTML;
  assert.match(single, /80 分/, '单次考试显示该场分数');
  assert.ok(single.includes('班次 2'), '单次考试按该场成绩排名');
  assert.ok(!single.includes('均分'), '单次考试不显示均分前缀');

  renderSeatPage({
    ...state,
    exams,
    settings: { ...state.settings, seatRange: 'all', subject: '数学', showScores: true },
  });
  const average = nodes.get('seating').innerHTML;
  assert.match(average, /均分 <\/span>90/, '全部考试平均按所选科目取平均');
  assert.ok(average.includes('班次 1'));
});

test('名单页渲染表格且不泄漏未转义字符', () => {
  const risky = { ...state, students: [{ id: '004', name: '<img src=x onerror=alert(1)>', gender: '男', note: '<b>注</b>' }] };
  renderRosterPage(risky);
  const html = nodes.get('rosterTable').innerHTML;
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img src=x'));
});

test('考试档案下拉选择考试，并在下方渲染预览表头与排序标记', async () => {
  const { ui } = await import('../dist/ui/state.js');
  ui.previewExamId = 'e1';
  renderExamsPage(state);
  const picker = nodes.get('examCards').innerHTML;
  assert.ok(picker.includes('examArchiveSelect'), '应渲染考试档案下拉');
  assert.ok(picker.includes('考试档案'));
  assert.ok(picker.includes('data-rename-exam'));
  assert.ok(picker.includes('selected'), '下拉应选中当前考试');
  assert.ok(!picker.includes('exam-drawer'), '预览应回到下方独立面板');

  const preview = nodes.get('examPreviewPanel').innerHTML;
  assert.ok(preview.includes('十月周练'));
  assert.ok(preview.includes('位学生'));
  assert.ok(preview.includes('data-sort="总分"'));
  assert.equal((preview.match(/<tr>/g) ?? []).length, 4, '表头 + 3 名学生');

  ui.previewExamId = 'e2';
  renderExamsPage(state);
  assert.ok(nodes.get('examPreviewPanel').innerHTML.includes('2026-10-11'));
});

test('违纪页只渲染有记录的学生', () => {
  renderDisciplinePage(state, {
    rows: [{ studentId: '001', name: '张三', count: 1, lastDate: '2026-10-12', types: { 晚自习违纪: 1 } }],
    total: 1,
    students: 1,
  });
  const table = nodes.get('discTable').innerHTML;
  assert.ok(table.includes('张三'));
  assert.ok(!table.includes('李四'));
  assert.ok(table.includes('晚自习违纪 × 1'));
});

test('点名页渲染分类、名单与平均分列', () => {
  renderCallPage(state);
  const categories = nodes.get('callCategories').innerHTML;
  assert.ok(categories.includes('优秀'));
  assert.ok(categories.includes('后进生'));
  const members = nodes.get('callMembers').innerHTML;
  assert.ok(members.includes('参与场次'));
  assert.ok(nodes.get('callPoolLabel').textContent.includes('当前范围'));
});

test('点名：分类内抽取且本轮不重复，重置后可再抽', async () => {
  const { drawStudent, resetCallRound, setCallCategory } = await import('../dist/ui/pages.js');
  const { ui } = await import('../dist/ui/state.js');
  document.querySelector('#noRepeat').checked = true;
  resetCallRound();
  setCallCategory('excellent');
  assert.equal(drawStudent(state)?.id, '001');
  assert.equal(drawStudent(state), null, '优秀类只有 1 人，抽完应为空');
  setCallCategory('support');
  assert.equal(drawStudent(state)?.id, '002');
  setCallCategory('ungraded');
  assert.equal(drawStudent(state)?.id, '003');
  ui.callCategory = 'all';
  resetCallRound();
  const picked = new Set();
  for (let index = 0; index < state.students.length; index += 1) {
    const student = drawStudent(state);
    assert.ok(student, '全班 3 人在本轮内都应可抽');
    assert.ok(!picked.has(student.id), '本轮不应重复');
    picked.add(student.id);
  }
  assert.equal(drawStudent(state), null);
  resetCallRound();
});

test('成绩页新增学科趋势表：可按学科查看每个人的变化', () => {
  const withExams = {
    ...state,
    exams: [
      { id: 'e2', name: '十月周练', date: '2026-10-11', subjects: ['语文', '总分'], sourceFormat: '', scores: { '001': { 语文: 92, 总分: 92 }, '002': { 语文: 75, 总分: 75 } }, ranks: { '001': { 语文: { school: 12, class: 3 } } } },
      { id: 'e1', name: '九月周练', date: '2026-09-20', subjects: ['语文', '总分'], sourceFormat: '', scores: { '001': { 语文: 85, 总分: 85 }, '002': { 语文: 80, 总分: 80 } }, ranks: { '001': { 语文: { school: 20, class: 5 } } } },
    ],
  };
  renderExamsPage(withExams);
  const html = nodes.get('examTrendPanel').innerHTML;
  assert.ok(html.includes('学科成绩总表'));
  assert.ok(html.includes('data-trend-subject="语文"'));
  assert.ok(html.includes('2026-09-20') && html.includes('2026-10-11'), '列头应按时间先后');
  assert.ok(html.includes('trend-cell'), '仍要展示分数');
  assert.ok(!html.includes('trend-cell up') && !html.includes('trend-cell down'), '分数不再显示涨跌');
  assert.ok(html.includes('rank-move up'), '应显示校次前进（20 → 12）');
  assert.ok(html.includes('校次 12'));
  assert.ok(html.includes('最新 92'));
});

test('学生气泡：排名折线图（不显示分数）+ 逐场全部科目明细', async () => {
  const { store } = await import('../dist/store.js');
  const { renderBubbles } = await import('../dist/ui/bubbles.js');
  const { ui } = await import('../dist/ui/state.js');
  store.state = {
    settings: { className: '测试班', rows: 7, extraRow: 5, showScores: true, examId: 'e2', subject: '语文', callRange: 'single', callSubject: '', seatRange: 'all' },
    students,
    exams: [
      { id: 'e2', name: '十月周练', date: '2026-10-11', subjects: ['语文', '数学', '总分'], sourceFormat: '', scores: { '001': { 语文: 92, 数学: 88, 总分: 180 } }, ranks: { '001': { 总分: { school: 8, class: 2 } } } },
      { id: 'e1', name: '九月周练', date: '2026-09-20', subjects: ['语文', '数学', '总分'], sourceFormat: '', scores: { '001': { 语文: 85, 数学: 70, 总分: 155 } }, ranks: { '001': { 语文: { school: 12, class: 3 }, 总分: { school: 20, class: 4 } } } },
    ],
    seats: { R1C8: '001' },
    discipline: {},
  };
  ui.bubbleStudentId = '001';
  ui.bubbleSubject = '';
  ui.bubbleRankMode = 'school';
  renderBubbles(store);
  let html = nodes.get('scoreHistory').innerHTML;

  // 图表只展示排名，且校次/班次两条线叠加
  assert.ok(html.includes('<svg'), '应有折线图');
  assert.ok(html.includes('排名走势'), '图题应说明是排名走势');
  assert.ok(html.includes('rank-line school') && html.includes('rank-line class'), '应同时有校次实线与班次虚线');
  assert.ok(html.includes('legend-line'), '应有图例');
  assert.ok(html.includes('校次第 <b>8</b> 名'), '摘要应显示最新名次而不是分数');
  assert.ok(html.includes('班次第 <b>2</b> 名'), '摘要应同时给出班次');
  const svgPart = html.slice(html.indexOf('<svg'), html.indexOf('</svg>') + 6);
  assert.ok(!svgPart.includes('92'), '折线图里应是名次，不是分数');

  // 学科与排名口径切换
  assert.ok(html.includes('data-chart-subject="语文"'));

  // 逐场全部科目
  assert.ok(html.includes('逐场成绩明细'));
  assert.ok(html.includes('exam-block'));
  assert.ok(html.includes('十月周练') && html.includes('九月周练'));
  assert.ok(html.includes('数学'), '每场应列出该场全部科目');
  assert.ok(html.includes('总分第 8 名'), '应显示该场总分排名');

  ui.bubbleSubject = '数学';
  renderBubbles(store);
  html = nodes.get('scoreHistory').innerHTML;
  assert.ok(html.includes('该科目暂无排名数据'), '无排名的科目给出提示');
});


test('考试成绩页：两个视图切换（单次明细 / 学科总表）', async () => {
  const { ui } = await import('../dist/ui/state.js');
  const withExams = {
    ...state,
    exams: [
      { id: 'e2', name: '十月周练', date: '2026-10-11', subjects: ['语文', '总分'], sourceFormat: '', scores: { '001': { 语文: 92, 总分: 92 } }, ranks: { '001': { 语文: { school: 12, class: 3 } } } },
      { id: 'e1', name: '九月周练', date: '2026-09-20', subjects: ['语文', '总分'], sourceFormat: '', scores: { '001': { 语文: 85, 总分: 85 } }, ranks: { '001': { 语文: { school: 20, class: 6 } } } },
    ],
  };
  ui.examTab = 'single';
  renderExamsPage(withExams);
  assert.equal(nodes.get('examSinglePane').classList.contains('hidden'), false, '默认显示单次考试');
  assert.equal(nodes.get('examTrendPane').classList.contains('hidden'), true);

  ui.examTab = 'trend';
  renderExamsPage(withExams);
  assert.equal(nodes.get('examSinglePane').classList.contains('hidden'), true);
  assert.equal(nodes.get('examTrendPane').classList.contains('hidden'), false);

  const trendHtml = nodes.get('examTrendPanel').innerHTML;
  assert.ok(trendHtml.includes('class-rank'), '应显示班次');
  assert.ok(trendHtml.includes('class-move'), '应显示班次变化');
  assert.ok(trendHtml.includes('rank-move'), '仍应显示校次变化');
  assert.ok(trendHtml.includes('校次 12') && trendHtml.includes('班次 3'));
  ui.examTab = 'single';
});

test('寝室违纪统计页：按寝室列出人数、次数与涉及学生', async () => {
  const { renderDormPage } = await import('../dist/ui/dorm-page.js');
  const withDorms = {
    ...state,
    students: [
      { ...students[0], dorm: 'A301' },
      { ...students[1], dorm: 'A301' },
      { ...students[2], dorm: 'A302' },
    ],
    discipline: {
      '001': [{ id: 'r1', date: '2026-10-13', type: '寝室违纪', reason: '' }],
      '001b': [],
    },
  };
  renderDormPage(withDorms);
  const html = nodes.get('dormTable').innerHTML;
  assert.ok(html.includes('A301'));
  assert.ok(html.includes('A302'));
  assert.ok(html.includes('张三'), '应列出寝室成员');
  assert.ok(html.includes('寝室违纪次数'));
  assert.ok(nodes.get('dormSummary').textContent.includes('2 个寝室'));
  assert.ok(html.includes('data-dorm-add="A301"'), '每个寝室应可主动记一次违纪');
  assert.ok(html.includes('dorm-event'), '应列出违纪事件');
  assert.ok(html.includes('撤销这次'), '事件应可整次撤销');
  assert.ok(html.includes('1 人（张三）'), '事件应显示参与成员');
  assert.ok(nodes.get('dormUnassigned').innerHTML.includes('全部学生都已登记寝室'));
});
