import test from 'node:test';
import assert from 'node:assert/strict';

const { mapPdfRows } = await import('../dist/lib/pdf-exam.js');

const students = [
  { id: '001', name: '张三', gender: '男', note: '' },
  { id: '002', name: '李四', gender: '女', note: '' },
  { id: '003', name: '王五', gender: '男', note: '' },
];

test('PDF 行按姓名匹配并映射为单科成绩', () => {
  const parsed = mapPdfRows(
    [
      { name: '张三', examNo: '10456', total: 98.0 },
      { name: '李四', examNo: '10460', total: 81.555 },
    ],
    students,
    '数学',
  );
  assert.equal(parsed.matched, 2);
  assert.deepEqual(parsed.subjects, ['数学']);
  assert.deepEqual(parsed.scores, { '001': { 数学: 98 }, '002': { 数学: 81.56 } });
  assert.deepEqual(parsed.ranks, {});
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.warnings.length, 1);
  assert.ok(parsed.warnings[0].includes('王五'), '未出现在 PDF 的学生应给出提示');
  assert.deepEqual(parsed.preview.map((row) => row.id), ['001', '002']);
});

test('PDF 行按学号优先匹配；科目为空时回落到「成绩」', () => {
  const parsed = mapPdfRows(
    [{ name: '张三', examNo: '001', total: 90 }],
    students,
    '',
  );
  assert.deepEqual(parsed.scores, { '001': { 成绩: 90 } });
  assert.equal(parsed.subjects[0], '成绩');
});

test('PDF 未匹配姓名、重复成绩、无效总分都会被拦截', () => {
  const parsed = mapPdfRows(
    [
      { name: '赵六', examNo: '999', total: 88 },
      { name: '张三', examNo: '001', total: 90 },
      { name: '张三', examNo: '001', total: 91 },
      { name: '李四', examNo: '002', total: -1 },
    ],
    students,
    '数学',
  );
  assert.equal(parsed.matched, 1);
  assert.equal(parsed.errors.length, 3);
  assert.ok(parsed.errors.some((message) => message.includes('赵六')));
  assert.ok(parsed.errors.some((message) => message.includes('重复')));
  assert.ok(parsed.errors.some((message) => message.includes('李四')));
});

test('名单中有重名学生时拒绝按姓名猜测', () => {
  const duplicated = [
    { id: '001', name: '张三', gender: '男', note: '' },
    { id: '002', name: '张三', gender: '女', note: '' },
  ];
  const parsed = mapPdfRows([{ name: '张三', examNo: '10456', total: 90 }], duplicated, '数学');
  assert.equal(parsed.matched, 0);
  assert.ok(parsed.errors[0].includes('重名'));
});

test('空成绩单给出错误，允许空数组', () => {
  const parsed = mapPdfRows([], students, '数学');
  assert.equal(parsed.matched, 0);
  assert.ok(parsed.errors.length >= 1);
});
