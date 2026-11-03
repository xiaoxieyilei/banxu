import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDisciplineText, DISCIPLINE_TYPES } from '../dist/lib/discipline.js';
import { parseRosterSheet, parseExamSheet } from '../dist/lib/excel.js';

const students = ['张三', '李四', '王五', '赵六', '钱七', '孙八', '周九'].map((name, index) => ({
  id: `00${index + 1}`,
  name,
  gender: '男',
  note: '',
}));

test('违纪类型共 8 个且默认第一个是晚自习违纪', () => {
  assert.equal(DISCIPLINE_TYPES.length, 8);
  assert.equal(DISCIPLINE_TYPES[0], '晚自习违纪');
});

test('解析日期、姓名、类型与默认日期', () => {
  const rows = parseDisciplineText('9月20日 张三 晚自习违纪\n2026-10-11 李四 迟到\n王五 迟到', '2026-10-01', students, 2026);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].date, '2026-09-20');
  assert.equal(rows[0].type, '晚自习违纪');
  assert.equal(rows[1].date, '2026-10-11');
  assert.equal(rows[1].type, '迟到违纪');
  assert.equal(rows[2].status, '按默认日期');
  assert.equal(rows[2].date, '2026-10-01');
});

test('“静校”不会被误判成“晚自习违纪”', () => {
  const [row] = parseDisciplineText('9月21日 王五 静校', '', students, 2026);
  assert.equal(row.type, '晚自习静校期间违纪');
});

test('简称识别：眼操 / 水杯 / 宿舍 / 早读', () => {
  const rows = parseDisciplineText('9月22日 孙八 眼操\n9月22日 周九 水杯\n9月22日 孙八 宿舍\n9月22日 周九 早读', '', students, 2026);
  assert.deepEqual(rows.map((row) => row.type), ['眼保健操违纪', '带水杯进教室', '寝室违纪', '早自习违纪']);
});

test('一行多个学生拆成多条，余下文字作为备注', () => {
  const rows = parseDisciplineText('9月23日 张三、李四 迟到 迟到5分钟', '', students, 2026);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.student.name), ['张三', '李四']);
  assert.equal(rows[0].reason, '迟到5分钟');
});

test('未匹配、缺类型、缺日期会标记为不可导入', () => {
  const rows = parseDisciplineText('9月24日 无名氏 迟到\n9月24日 张三\n李四 迟到', '', students, 2026);
  assert.equal(rows[0].ok, false);
  assert.equal(rows[0].status, '未找到学生');
  assert.equal(rows[1].ok, false);
  assert.equal(rows[1].status, '缺少违纪类型');
  assert.equal(rows[2].ok, false);
  assert.equal(rows[2].status, '缺少日期');
});

test('名单解析：学号姓名必填、重复学号报错', () => {
  const ok = parseRosterSheet([['学号', '姓名', '性别'], ['001', '张三', '男'], ['', '', ''], ['002', '李四', '女']], []);
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.records.length, 2);
  const bad = parseRosterSheet([['学号', '姓名'], ['001', '张三'], ['001', '李四']], []);
  assert.equal(bad.records.length, 1);
  assert.equal(bad.errors.length, 1);
});

test('成绩解析：普通模板自动求和，缺考使总分为空', () => {
  const rows = [
    ['学号', '姓名', '语文', '数学'],
    ['001', '张三', '90', '80'],
    ['002', '李四', '缺考', '70'],
  ];
  const parsed = parseExamSheet(rows, students);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.scores['001']['总分'], 170);
  assert.equal(parsed.scores['002']['总分'], null);
  assert.equal(parsed.subjects.at(-1), '总分');
});

test('成绩解析：识别学校成绩汇总表的两行表头与排名', () => {
  const rows = [
    ['', '', '', '瑞安中学 2026 级周练', '', ''],
    ['序号', '准考证号', '姓名', '语文', '语文', '语文'],
    ['', '', '', '得分', '校次', '班次'],
    ['1', '2601001', '张三', '90', '12', '3'],
  ];
  const parsed = parseExamSheet(rows, students);
  assert.equal(parsed.schoolFormat, true);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.scores['001']['语文'], 90);
  assert.deepEqual(parsed.ranks['001']['语文'], { school: 12, class: 3 });
});

test('成绩解析：未知学号报错且不写入', () => {
  const rows = [['学号', '语文'], ['999', '90']];
  const parsed = parseExamSheet(rows, students);
  assert.equal(parsed.matched, 0);
  assert.equal(parsed.errors.length, 1);
});

test('单科成绩表（标题行 + 单行表头）按姓名匹配并读取校次/班次', () => {
  const rows = [
    ['高一年级20班-语文成绩', '', '', '', '', ''],
    ['序号', '准考证号', '姓名', '得分', '校次', '班次'],
    ['1.0', '11707746', '张三', '97.0', '27.0', '1.0'],
    ['2.0', '11707757', '李四', '未扫，不计排名', '-', '-'],
  ];
  const parsed = parseExamSheet(rows, students, { subject: '语文' });
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.subjects, ['语文']);
  assert.equal(parsed.scores['001']['语文'], 97);
  assert.deepEqual(parsed.ranks['001']['语文'], { school: 27, class: 1 });
  assert.equal(parsed.scores['002']['语文'], null);
  assert.equal(parsed.matched, 2);
  assert.equal(parsed.schoolFormat, true);
});

test('单科成绩表没有科目提示时仍可用工作表名/表头兜底', () => {
  const rows = [
    ['高一年级20班-英语成绩', '', '', ''],
    ['序号', '姓名', '得分', '校次'],
    ['1.0', '张三', '131.0', '34.0'],
  ];
  const parsed = parseExamSheet(rows, students, { subject: '' });
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.subjects.length, 1);
  assert.equal(parsed.scores['001'][parsed.subjects[0]], 131);
});
