import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

/** 由 JS 动态插入的节点，静态 HTML 里当然不存在。 */
const DYNAMIC_IDS = new Set([
  'examPreviewSearch', 'discText', 'discDefaultDate', 'discImportCommit', 'discParseNotice', 'discParsePreview',
  'examName', 'examDate', 'excelFile', 'sheetSelect', 'importOptions', 'importPreview', 'importNotice',
  'commitImport', 'modalTemplate', 'pdfSubject', 'pdfSubjectRow', 'overwriteExam', 'applyUpdateBtn', 'fillSeats', 'randomSeats', 'exportSeats', 'clearSeats', 'confirmAction',
  'editId', 'editName', 'editGender', 'editNote', 'saveStudent',
  'renameExamInput', 'renameExamDate', 'saveExamName', 'discSkipDup', 'editDorm', 'dormFile', 'dormNotice', 'dormCommit', 'dormPreview', 'dormDiscDate', 'dormDiscReason', 'dormDiscSave',
  'dormEditRoom', 'dormEditCount', 'dormEditSearch', 'dormEditMembers', 'dormEditIncidents', 'dormEditAddIncident', 'dormEditSave',
]);

const staticIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

test('所有静态选择器都能在 index.html 找到对应 id', () => {
  const missing = [];
  for (const file of walk(join(root, 'src'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/['"`]#([A-Za-z][\w-]*)['"`]/g)) {
      const id = match[1];
      if (staticIds.has(id) || DYNAMIC_IDS.has(id)) continue;
      missing.push(`${file.replace(root, '')}: #${id}`);
    }
  }
  assert.deepEqual(missing, [], `以下选择器没有对应元素：\n${missing.join('\n')}`);
});

test('index.html 引用的静态资源都存在于 dist', () => {
  const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((match) => match[1]);
  assert.ok(refs.length >= 3, '应至少引用样式、SheetJS 与入口脚本');
  for (const ref of refs) {
    assert.ok(existsSync(join(dist, ref)), `缺少资源 ${ref}`);
  }
  assert.ok(refs.includes('main.js'));
  assert.ok(refs.includes('styles.css'));
  assert.ok(refs.includes('vendor/xlsx.full.min.js'));
});

test('构建产物中所有相对 import 都能解析到真实文件', () => {
  const missing = [];
  const distFiles = [];
  const collect = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) collect(full);
      else if (full.endsWith('.js')) distFiles.push(full);
    }
  };
  collect(dist);
  for (const file of distFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
      const target = resolve(dirname(file), match[1]);
      if (!existsSync(target)) missing.push(`${file.replace(dist, '')} -> ${match[1]}`);
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'));
});

test('入口脚本里没有遗留的 TypeScript 语法', () => {
  const entry = readFileSync(join(dist, 'main.js'), 'utf8');
  assert.ok(!/:\s*(string|number|boolean)\b/.test(entry), 'dist 中不应再有类型注解');
  assert.ok(entry.includes("import"), 'dist 入口应为 ES Module');
});

test('考试成绩的两个视图放在左侧菜单的可展开分组里', () => {
  assert.ok(staticIds.has('examsNavGroup') && staticIds.has('examsNavParent') && staticIds.has('examsSubMenu'));
  assert.ok(/data-page="exams" data-exam-tab="single"/.test(html), '缺少「单次考试成绩」菜单项');
  assert.ok(/data-page="exams" data-exam-tab="trend"/.test(html), '缺少「学科成绩总表」菜单项');
  assert.ok(!html.includes('class="exam-tabs"'), '页内标签页应已移除');
  assert.ok(html.includes('aria-expanded="false"'), '父级菜单应带展开状态');
});

test('违纪情况菜单为可展开分组：个人 / 寝室', () => {
  assert.ok(staticIds.has('disciplineNavGroup') && staticIds.has('disciplineNavParent') && staticIds.has('disciplineSubMenu'));
  assert.ok(/data-page="discipline" data-disc-tab="personal"/.test(html), '缺少个人违纪子项');
  assert.ok(/data-page="discipline" data-disc-tab="dorm"/.test(html), '缺少寝室违纪子项');
  assert.ok(staticIds.has('discPersonalPane') && staticIds.has('discDormPane'));
  assert.ok(staticIds.has('dormImportBtn') && staticIds.has('dormTable'));
});
