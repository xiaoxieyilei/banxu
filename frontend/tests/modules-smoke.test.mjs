import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * 用最小 DOM 桩导入所有前端模块，确保没有“顶层就访问 DOM/浏览器 API”的代码，
 * 这类错误在 Node 测试与真实浏览器里都会让整页白屏。
 */
const stub = () => ({
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => undefined,
  createElement: () => ({ style: {}, classList: { add: () => undefined, remove: () => undefined }, append: () => undefined }),
  body: { append: () => undefined },
  activeElement: null,
  documentElement: {},
});

test('所有前端模块可在无浏览器环境下安全导入', async () => {
  globalThis.document = stub();
  globalThis.window = { addEventListener: () => undefined, setTimeout, clearTimeout, print: () => undefined };
  globalThis.location = { href: 'http://localhost/' };

  const modules = [
    '../dist/types.js',
    '../dist/api.js',
    '../dist/store.js',
    '../dist/lib/dates.js',
    '../dist/lib/seats.js',
    '../dist/lib/ranking.js',
    '../dist/lib/discipline.js',
    '../dist/lib/excel.js',
    '../dist/ui/dom.js',
    '../dist/ui/state.js',
    '../dist/ui/seats.js',
    '../dist/ui/pages.js',
    '../dist/ui/bubbles.js',
    '../dist/ui/import-modal.js',
    '../dist/ui/exporters.js',
  ];
  for (const path of modules) {
    const module = await import(path);
    assert.ok(module && typeof module === 'object', `${path} 未正常导出`);
  }
});
