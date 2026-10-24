const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const executable = path.resolve(process.argv[2] || 'release-p0-20261009-v2/win-unpacked/易下载.exe');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-download-douyin-ui-'));
const roaming = path.join(scratch, 'roaming');
const local = path.join(scratch, 'local');
const outputDir = path.join(scratch, 'downloads');
fs.mkdirSync(roaming, { recursive: true }); fs.mkdirSync(local, { recursive: true }); fs.mkdirSync(outputDir, { recursive: true });
const env = { ...process.env, APPDATA: roaming, LOCALAPPDATA: local };
delete env.ELECTRON_RUN_AS_NODE;
const codeFile = 'D:\\xiazai\\MyDrivers\\backup\\easy-download-test-activation-codes.txt';
const code = fs.readFileSync(codeFile, 'utf8').split(/\r?\n/).find(line => /^10\. /.test(line)).slice(4).trim();
const share = '9.79 07/31 :3pm jcn:/ w@S.LJ 从王二到闯王，明末农民起义拉开帷幕！ #明朝 #明末 #崇祯 https://v.douyin.com/uOCeLrzmht8/ 复制此链接，打开Dou音搜索，直接观看视频！';
const port = Number(process.env.EASY_DOWNLOAD_PORT || 24131);
let app;
function waitText(page, selector, text, timeout = 180000) { return page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text }, { timeout }); }
(async () => {
  app = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${roaming}`], cwd: root, env, timeout: 60000 });
  app.process().stdout.on('data', chunk => process.stdout.write(chunk));
  app.process().stderr.on('data', chunk => process.stderr.write(chunk));
  const page = await app.firstWindow();
  await waitText(page, '#licenseStatus', '未激活', 30000);
  await page.locator('#activate').click();
  await page.locator('#activationCode').fill(code);
  await page.locator('#submitActivation').click();
  await waitText(page, '#licenseStatus', '已激活', 30000);
  await page.evaluate(({ outputDir, proxy }) => window.easyDownload.request('/v1/settings', { method: 'POST', body: JSON.stringify({ outputDir, proxy, autoProxy: true }) }), { outputDir, proxy: 'http://127.0.0.1:7892' });
  await page.locator('#url').fill(share);
  await page.locator('#download').click();
  await waitText(page, '#tasks', '已完成', 180000);
  const files = fs.readdirSync(outputDir).filter(name => /\.(mp4|mkv|webm|mov)$/i.test(name));
  assert.ok(files.length > 0, '没有生成视频文件');
  const bytes = files.reduce((sum, name) => sum + fs.statSync(path.join(outputDir, name)).size, 0);
  assert.ok(bytes > 1000000, '视频文件过小');
  console.log(JSON.stringify({ ok: true, source: 'Douyin share text', files, bytes, scratch, port }, null, 2));
  await app.close();
})().catch(async error => {
  console.error(error.stack || error.message);
  if (app) {
    try {
      const page = await app.firstWindow();
      console.error(JSON.stringify({ message: await page.locator('#message').innerText(), tasks: await page.locator('#tasks').innerText(), output: fs.readdirSync(outputDir) }, null, 2));
      await page.screenshot({ path: path.join(scratch, 'failure.png') });
    } catch {}
    await app.close().catch(() => {});
  }
  process.exitCode = 1;
});
