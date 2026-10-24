// Exercises the real Electron renderer + frozen backend, with isolated user data.
// Pass --live-license to consume/reuse test code #10 from the explicit test batch.
const { _electron: electron } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'output', 'playwright');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-download-ui-'));
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(scratch, 'roaming'), { recursive: true });
fs.mkdirSync(path.join(scratch, 'local'), { recursive: true });
const executableIndex = process.argv.indexOf('--executable');
const executablePath = executableIndex >= 0 ? path.resolve(process.argv[executableIndex + 1]) : require('electron');
const env = { ...process.env, APPDATA: path.join(scratch, 'roaming'), LOCALAPPDATA: path.join(scratch, 'local'), EASY_DOWNLOAD_SKIP_BROWSER_OPEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const checks = [];
let app, server;
const expectedPort = Number(process.env.EASY_DOWNLOAD_PORT || 17893);
const launchOptions = { executablePath, args: [...(executableIndex >= 0 ? [] : [root]), `--user-data-dir=${path.join(scratch, 'roaming')}`], cwd: root, env, timeout: 45000 };
function enginePortOpen() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port: expectedPort });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
  });
}
async function textContains(page, selector, value, timeout = 20000) {
  await page.waitForFunction(({ selector, value }) => document.querySelector(selector)?.textContent.includes(value), { selector, value }, { timeout });
}
(async () => {
  app = await electron.launch(launchOptions);
  app.process().stdout.on('data', chunk => process.stdout.write(chunk));
  app.process().stderr.on('data', chunk => process.stderr.write(chunk));
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await textContains(page, '#licenseStatus', '免费版');
  assert.equal(await page.locator('.slogan').innerText(), '你浏览器能播放的，我们就能下载');
  assert.equal(await page.locator('.notice').count(), 0);
  assert.equal(await page.locator('.nav-item').count(), 4);
  assert.deepEqual(await page.locator('.nav-item').allTextContents(), ['⌂首页', '≡下载任务', '◆专业版', '⚙设置']);
  assert.equal(await page.locator('#outputDir').count(), 1);
  assert.equal(await page.locator('#homeTasks').count(), 1);
  checks.push('promotional slogan, compact VIP banner, home directory, home task summary, and unified four-item sidebar are present');
  assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()), null);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMenuBarVisible()), false);
  checks.push('application and window menus removed');
  await page.locator('#activate').click();
  assert.equal(await page.locator('#activationDialog').isVisible(), true);
  await page.locator('#submitActivation').click();
  await textContains(page, '#activationMessage', '5 组');
  await page.locator('#activationCode').fill('broken');
  await page.locator('#activationCode').press('Enter');
  await textContains(page, '#activationMessage', '5 组');
  await page.locator('[aria-label="关闭激活窗口"]').click();
  await page.locator('#pro').click();
  await page.locator('#submitBatch').click();
  assert.equal(await page.locator('#activationDialog').isVisible(), true);
  assert.equal(await page.locator('#page-pro').isVisible(), true);
  await page.keyboard.press('Escape');
  checks.push('unlicensed batch entry opens the professional activation prompt while free single-download UI remains available');
  await page.locator('#activate').click();
  await page.locator('#activationCode').fill('');
  await page.screenshot({ path: path.join(output, 'activation.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#activationDialog').isVisible(), false);
  checks.push('activation opens, accepts typing, validates empty/short input, cancels and reopens');
  await page.locator('#settings').click();
  await page.locator('#page-settings .settings-section').filter({ hasText: '连接设置' }).locator('summary').click();
  await page.locator('#proxy').fill('http://127.0.0.1:7892');
  await page.locator('#autoProxy').uncheck();
  await page.locator('#saveSettings').click(); await textContains(page, '#settingsMessage', '已保存');
  assert.equal(await page.locator('#proxy').inputValue(), 'http://127.0.0.1:7892');
  assert.equal(await page.locator('#autoProxy').isChecked(), false);
  await page.locator('#proxy').fill(''); await page.locator('#saveSettings').click();
  await textContains(page, '#settingsMessage', '已保存');
  await textContains(page, '#page-settings', '连接 Chrome 和网站登录状态');
  assert.equal(await page.locator('#resyncChrome').count(), 1);
  await page.screenshot({ path: path.join(output, 'settings.png'), fullPage: true });
  await page.locator('#checkUpdate').click(); await textContains(page, '#updateMessage', '更新服务暂未就绪');
  checks.push('settings persistence, single-source browser authorization guidance, and update unavailable feedback');
  const chromeSetup = await page.evaluate(() => window.easyDownload.connectChrome());
  assert.ok(chromeSetup.ticket);
  const setupPending = await fetch(`http://127.0.0.1:17894/v1/browser/setup-status?ticket=${encodeURIComponent(chromeSetup.ticket)}`).then(response => response.json());
  assert.equal(setupPending.paired, false);
  const bootstrap = await fetch('http://127.0.0.1:17894/v1/browser/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: chromeSetup.ticket }) });
  assert.equal(bootstrap.status, 200);
  const setupDone = await fetch(`http://127.0.0.1:17894/v1/browser/setup-status?ticket=${encodeURIComponent(chromeSetup.ticket)}`).then(response => response.json());
  assert.equal(setupDone.paired, true);
  checks.push('two-step Chrome connection wizard issues a one-time ticket and completes automatic local bootstrap');
  const selectedDirectory = path.join(scratch, 'downloads'); fs.mkdirSync(selectedDirectory);
  // Replace only the native picker in the test process; click goes through the real IPC/save path.
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, selectedDirectory);
  await page.locator('#home').click();
  await page.locator('#chooseDir').click(); await textContains(page, '#message', '下载目录已保存');
  assert.equal(fs.realpathSync.native(await page.locator('#outputDir').inputValue()).toLowerCase(), fs.realpathSync.native(selectedDirectory).toLowerCase());
  checks.push('directory selection IPC persists the chosen directory (native picker stubbed)');
  const pairing = await page.evaluate(() => window.easyDownload.request('/v1/pairing'));
  const browserEntry = await fetch('http://127.0.0.1:17894/v1/browser/submit', { method: 'POST', headers: { 'content-type': 'application/json', 'x-easy-download-bridge': pairing.bridgeToken }, body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=browser-entry-test', mode: 'preview', title: '浏览器入口回归测试' }) });
  assert.equal(browserEntry.status, 200);
  assert.equal((await browserEntry.json()).ok, true);
  assert.equal(await page.locator('#url').inputValue(), 'https://www.youtube.com/watch?v=browser-entry-test');
  checks.push('browser preview entry sends a link into the home download form through the authenticated local bridge');
  // Show a neutral example path in the screenshot only; backend setting remains the isolated directory.
  await page.locator('#outputDir').evaluate(el => { el.value = 'D:\\视频下载'; });
  await page.screenshot({ path: path.join(output, 'home.png') });
  await page.locator('#openExtensionFromHome').click();
  assert.equal(await page.locator('#page-settings').isVisible(), true);
  checks.push('home browser entry opens the in-app Chrome connection settings instead of a folder');
  await page.locator('#tasksNav').click();
  assert.equal(await page.locator('#page-tasks').isVisible(), true);
  await page.locator('#pro').click();
  await page.locator('[data-pro-tab="subtitle"]').click();
  await textContains(page, '#pro-panel-subtitle', '独立字幕轨道不会重新压制画面');
  checks.push('task page and professional subtitle flow are visible without making project rules mandatory');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 620));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#activate').click();
  assert.equal(await page.locator('#submitActivation').isVisible(), true);
  await page.keyboard.press('Escape');
  checks.push('880x620 layout has no horizontal overflow and activation remains usable');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 800));
  if (process.argv.includes('--live-license')) {
    const codeFile = 'D:\\xiazai\\MyDrivers\\backup\\easy-download-test-activation-codes.txt';
    const row = fs.readFileSync(codeFile, 'utf8').split(/\r?\n/).find(line => /^10\. /.test(line));
    assert.ok(row, 'test batch must contain code #10');
    await page.locator('#activate').click();
    await page.locator('#activationCode').fill(row.slice(4).trim());
    await page.locator('#submitActivation').click();
    try { await textContains(page, '#licenseStatus', '已激活', 30000); }
    catch { throw new Error('Live activation failed: ' + await page.locator('#activationMessage').innerText()); }
    checks.push('real production activation through UI with reserved test code #10');
    const media = path.join(scratch, 'sample.mp4');
    const generated = spawnSync(path.join(root, 'bin', 'ffmpeg.exe'), ['-y', '-f', 'lavfi', '-i', 'color=c=teal:s=160x90:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', media], { windowsHide: true });
    assert.equal(generated.status, 0, 'create a synthetic download fixture');
    const bytes = fs.readFileSync(media);
    server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length }); res.end(bytes); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const mediaUrl = `http://127.0.0.1:${server.address().port}/sample.mp4`;
    // The synthetic loopback server is deliberately rejected by the public
    // URL parser. Submit it through the authenticated sidecar endpoint here
    // so this regression still checks the real yt-dlp/FFmpeg queue without
    // weakening production SSRF protections; parser/controller cases are unit
    // tested separately.
    const submitRaw = (quality) => page.evaluate(({ url, quality, outputDir }) => window.easyDownload.request('/v1/downloads', { method: 'POST', body: JSON.stringify({ url, sourceUrl: url, quality, outputDir }) }), { url: mediaUrl, quality, outputDir: selectedDirectory });
    await submitRaw('best');
    await textContains(page, '#taskTable', '已完成', 60000);
    assert.ok(fs.readdirSync(selectedDirectory).some(file => file.endsWith('.mp4')));
    await page.locator('#clearTasks').click(); await textContains(page, '#globalSettingsMessage', '已清空 1 条');
    await submitRaw('audio');
    await textContains(page, '#taskTable', '已完成', 60000);
    assert.ok(fs.readdirSync(selectedDirectory).some(file => file.endsWith('.mp3')));
    await page.reload(); await textContains(page, '#licenseStatus', '已激活');
    checks.push('real yt-dlp video download, ffmpeg MP3 conversion, completed-record clearing, persisted authorization');
  }
  assert.deepEqual(errors, [], 'no renderer runtime errors');
  await app.close(); app = null;
  for (let attempt = 0; attempt < 30 && await enginePortOpen(); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await enginePortOpen(), false, 'closing the app must release the backend port');
  app = await electron.launch(launchOptions);
  const restartedPage = await app.firstWindow();
  await textContains(restartedPage, '#licenseStatus', process.argv.includes('--live-license') ? '已激活' : '免费版');
  checks.push('full app exit releases backend port; restart succeeds and retains authorization');
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ checks, executablePath, scratch, rendererErrors: errors, verifiedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ passed: checks, evidence: output }, null, 2));
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => { if (server) server.close(); if (app) await app.close(); });
