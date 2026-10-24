const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidence = path.join(root, 'output', 'pro-workflow');
fs.mkdirSync(evidence, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-download-pro-'));
fs.mkdirSync(path.join(scratch, 'roaming'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'local'), { recursive: true });

(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [root, `--user-data-dir=${path.join(scratch, 'roaming')}`],
    cwd: root,
    env: { ...process.env, APPDATA: path.join(scratch, 'roaming'), LOCALAPPDATA: path.join(scratch, 'local') },
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.querySelector('#licenseStatus')?.textContent.includes('免费版'));
  await page.locator('#pro').click();
  await page.locator('#batchInput').fill('https://www.youtube.com/watch?v=demo-one\nhttps://www.bilibili.com/video/BVdemo-two');
  await page.screenshot({ path: path.join(evidence, '01-source.png'), fullPage: true });
  await page.evaluate(() => localStorage.setItem('easyDownload.proQueue', JSON.stringify([
    { id: 'demo-1', input: 'https://www.youtube.com/watch?v=demo-one', title: '旅行日记｜夏日海边的风景', quality: '1080', format: 'mp4', outputDir: 'D:\\视频\\易下载', status: 'planned' },
    { id: 'demo-2', input: 'https://www.bilibili.com/video/BVdemo-two', title: '小猫的日常生活', quality: '720', format: 'mp4', outputDir: 'D:\\视频\\易下载', status: 'failed' },
  ])));
  await page.reload();
  await page.locator('#pro').click();
  await page.locator('[data-pro-tab="queue"]').click();
  await page.screenshot({ path: path.join(evidence, '02-queue.png'), fullPage: true });
  await page.locator('[data-pro-tab="subtitle"]').click();
  await page.screenshot({ path: path.join(evidence, '03-output.png'), fullPage: true });
  console.log(JSON.stringify({ evidence }));
  await app.close();
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
