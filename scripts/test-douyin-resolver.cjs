const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const { DouyinResolver } = require('../electron/download/douyin-resolver.cjs');

const url = process.argv[2] || 'https://v.douyin.com/uOCeLrzmht8/';
app.whenReady().then(async () => {
  const resolver = new DouyinResolver({
    BrowserWindow,
    session,
    parent: () => undefined,
    progress: event => console.log(JSON.stringify({ event })),
    diagnostic: event => console.log(JSON.stringify({ diagnostic: event })),
    timeoutMs: 45000,
  });
  try {
    const result = await resolver.resolve(url, { proxy: process.env.EASY_DOWNLOAD_TEST_PROXY || '', autoProxy: false });
    if (process.env.EASY_DOWNLOAD_TEST_MEDIA_FILE) require('node:fs').writeFileSync(process.env.EASY_DOWNLOAD_TEST_MEDIA_FILE, result.mediaUrl, 'utf8');
    console.log(JSON.stringify({ ok: true, result: { ...result, mediaUrl: '[redacted]' } }, null, 2));
    process.exitCode = 0;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code, message: error.message }, null, 2));
    process.exitCode = 1;
  } finally {
    resolver.dispose();
    app.quit();
  }
});
