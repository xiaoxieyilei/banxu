/**
 * 浏览器端冒烟测试：真实 Chrome + 真实后端（临时数据库），不接触用户数据。
 * 运行：cd frontend && npm run test:e2e
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright-core';

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = resolve(frontend, '..');
const backendPython = join(project, 'backend', '.venv', 'bin', 'python');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

async function health(url) {
  try {
    const response = await fetch(`${url}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const temp = mkdtempSync(join(tmpdir(), 'banxu-e2e-'));
const env = {
  ...process.env,
  BANXU_DB: join(temp, 'e2e.sqlite3'),
  BANXU_PASSWORD: 'e2e-pass',
  BANXU_BACKUP_DIR: join(temp, 'backups'),
  BANXU_BACKUP_ON_START: '0',
  BANXU_BACKUP_ON_IMPORT: '0',
};

const server = spawn(
  backendPython,
  ['-m', 'uvicorn', 'app.main:app', '--app-dir', 'backend', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: project, env, stdio: 'ignore' },
);

const api = async (path, options = {}) => {
  const response = await fetch(base + path, {
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer e2e-pass' },
    ...options,
  });
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${await response.text()}`);
  return response.json();
};

let browser;
try {
  let ready = false;
  for (let index = 0; index < 60; index += 1) {
    if (await health(base)) {
      ready = true;
      break;
    }
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 250));
  }
  assert.ok(ready, '临时后端未启动');

  await api('/api/roster/import', {
    method: 'POST',
    body: JSON.stringify({
      records: [
        { id: '001', name: '张三', gender: '男' },
        { id: '002', name: '李四', gender: '女' },
        { id: '003', name: '王五', gender: '男' },
      ],
    }),
  });
  const seedExam = (name, date, scores) =>
    api('/api/exams', {
      method: 'POST',
      body: JSON.stringify({
        name,
        date,
        subjects: ['数学'],
        scores,
        ranks: {},
        fullMarks: { 数学: 120 },
        sourceFormat: 'E2E',
      }),
    });
  await seedExam('数学限时 A', '2026-11-01', { '001': { 数学: 96 }, '002': { 数学: 60 } });
  await seedExam('数学限时 B', '2026-10-25', { '001': { 数学: 72 }, '002': { 数学: 120 } });
  await api('/api/seats/move', { method: 'POST', body: JSON.stringify({ studentId: '001', target: 'R1C1' }) });
  await api('/api/seats/move', { method: 'POST', body: JSON.stringify({ studentId: '002', target: 'R1C2' }) });

  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.route('**/api/update/check**', (route) =>
    route.fulfill({
      json: {
        configured: true,
        current: '2.1.3',
        available: true,
        latest: 'v9.9.9',
        notes: 'E2E 测试版本',
        publishedAt: '2026-11-03T00:00:00Z',
      },
    }),
  );

  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForSelector('#loginOverlay:not(.hidden)');
  await page.fill('#loginPassword', 'e2e-pass');
  await page.click('#loginSubmit');
  await page.waitForSelector('#loginOverlay.hidden', { state: 'attached' });
  await page.waitForFunction(() => document.querySelectorAll('#seating .seat').length === 58);

  const warningHidden = await page.locator('#versionWarning').evaluate((node) => node.classList.contains('hidden'));
  assert.equal(warningHidden, true, '当前后端不应显示旧版本提示');

  await page.waitForFunction(() => document.querySelector('#updateBtn')?.textContent?.includes('v9.9.9'));
  await page.click('#updateBtn');
  await page.waitForSelector('#applyUpdateBtn');
  assert.ok((await page.locator('#modal').innerText()).includes('E2E 测试版本'), '更新弹窗应显示版本说明');
  await page.click('#modal [data-close]');

  await page.check('#showScores');
  await page.selectOption('#subjectSelect', '数学');
  await page.waitForFunction(() => document.querySelector('#seating')?.textContent?.includes('70%'));
  const normalizedText = await page.locator('#seating').innerText();
  assert.ok(normalizedText.includes('70%'), '全部考试平均应按满分折算为百分制');
  assert.ok(normalizedText.includes('75%'), '002 的百分制均分应为 75%');

  await page.selectOption('#seatRange', 'single');
  await page.waitForSelector('#examSelect:not(.hidden)');
  const singleText = await page.locator('#seating').innerText();
  assert.ok(singleText.includes('96 分'), '单场考试应显示原始分数');
  assert.ok(!singleText.includes('均分 '), '单场考试不应显示均分前缀');

  await page.evaluate(() => document.querySelector('[data-page="exams"]')?.click());
  await page.waitForSelector('#examArchiveSelect');
  const options = await page.locator('#examArchiveSelect option').count();
  assert.equal(options, 2, '考试档案下拉应包含两场考试');
  await page.selectOption('#examArchiveSelect', { index: 1 });
  await page.waitForFunction(() => document.querySelector('#examPreviewPanel')?.textContent?.includes('数学限时 B'));

  assert.deepEqual(pageErrors, [], '页面不应有运行时错误');
  console.log('E2E 通过：登录、座位百分制平均、单场考试、考试档案下拉');
} finally {
  await browser?.close().catch(() => {});
  server.kill('SIGTERM');
  await new Promise((resolveTimer) => setTimeout(resolveTimer, 300));
  rmSync(temp, { recursive: true, force: true });
}
