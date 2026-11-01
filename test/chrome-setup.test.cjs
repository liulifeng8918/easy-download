const test = require('node:test');
const assert = require('node:assert/strict');
const { setupPage } = require('../electron/download/chrome-setup.cjs');
test('setup explains the actual Chrome entry, developer mode and directory selection with pictures', () => {
  const html = setupPage('abc_-123', 'D:/<safe>/extension');
  for (const text of ['chrome://extensions', '开发者模式', 'Ctrl + L', '选择文件夹', 'setup-action', 'open-extensions', 'copy-path', 'extensions.png?ticket=abc_-123', 'folder.png?ticket=abc_-123']) assert.ok(html.includes(text), text);
  assert.ok(html.includes('D:/&lt;safe&gt;/extension'));
  assert.ok(!html.includes('D:/<safe>'));
  assert.ok(!setupPage('x<script>', 'folder').includes('const ticket="x<script>"'));
});
