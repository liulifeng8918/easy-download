const { app, BrowserWindow, dialog, ipcMain, shell, Menu, clipboard } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const { appendFileSync, existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { DownloadController } = require('./download/controller.cjs');
const { DouyinResolver } = require('./download/douyin-resolver.cjs');
const { resolveYifan } = require('./download/yifan-resolver.cjs');
const { YifanBrowserResolver } = require('./download/yifan-browser.cjs');
const { verifyMedia, disposeMediaChecks } = require('./download/media-verifier.cjs');
const { setupPage: renderChromeSetup } = require('./download/chrome-setup.cjs');
const { sidecarArguments } = require('./download/sidecar-launch.cjs');

function diagnostic(message, error) {
  const line = `[${new Date().toISOString()}] ${message}${error ? ` ${error.stack || error}` : ''}\n`;
  try {
    appendFileSync(path.join(app.getPath('userData'), 'startup.log'), line, 'utf8');
  } catch (_) { /* logging must never prevent startup */ }
  console.error(line.trimEnd());
}

process.on('uncaughtException', (error) => diagnostic('uncaughtException', error));
process.on('unhandledRejection', (error) => diagnostic('unhandledRejection', error));

const isWindows = process.platform === 'win32';
const root = path.resolve(__dirname, '..');
const portableMode = existsSync(path.join(root, 'portable-mode.flag'));
const portableDataRoot = path.join(root, 'user-data');
if (portableMode) {
  // A portable release must not inherit the developer's %LOCALAPPDATA% license.
  // The marker is shipped only in the portable staging directory.
  app.setPath('userData', path.join(portableDataRoot, 'roaming'));
}
const sidecarScript = path.join(root, 'python', 'easy_download_sidecar.py');
const bundledSidecar = path.join(root, 'runtime', 'easy_download_sidecar.exe');
let sidecar;
let sidecarPort;
let sidecarToken;
let sidecarExit;
let mainWindow;
let downloadController;
let douyinResolver;
let yifanBrowserResolver;
let browserBridge;
let browserBridgeToken;
let browserBridgePort;
let browserConnected = false;
let browserLastSeen = 0;
const setupTickets = new Map();

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
});

function pythonCommand() {
  if (isWindows && existsSync(bundledSidecar)) return bundledSidecar;
  const bundled = path.join(root, 'runtime', 'python.exe');
  if (isWindows && existsSync(bundled)) return bundled;
  return isWindows ? 'python.exe' : 'python3';
}

function startSidecar() {
  // Chrome MV3 bridge needs a stable local endpoint in V1; the random token
  // is the actual authorization boundary. V2 can move to Native Messaging.
  const configuredPort = Number(process.env.EASY_DOWNLOAD_PORT || 17893);
  sidecarPort = Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535 ? configuredPort : 17893;
  sidecarToken = randomBytes(32).toString('base64url');
  const command = pythonCommand();
  const args = sidecarArguments({script: command === bundledSidecar ? null : sidecarScript, port: sidecarPort, token: sidecarToken, root});
  sidecar = spawn(command, args, {
    cwd: root,
    env: portableMode ? { ...process.env, LOCALAPPDATA: path.join(portableDataRoot, 'local') } : process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  sidecarExit = null;
  sidecar.on('error', (error) => diagnostic('[sidecar] spawn failed', error));
  sidecar.stdout.on('data', (chunk) => console.log(`[sidecar] ${chunk.toString().trimEnd()}`));
  sidecar.stderr.on('data', (chunk) => diagnostic('[sidecar] ' + chunk.toString().trimEnd()));
  sidecar.on('exit', (code, signal) => {
    sidecarExit = { code, signal: signal || '' };
    diagnostic(`[sidecar] exited code=${code} signal=${signal || ''}`);
  });
}

async function sidecarRequest(route, init = {}) {
  const response = await fetch(`http://127.0.0.1:${sidecarPort}${route}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-easy-download-session': sidecarToken,
      ...(init.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body?.message || `sidecar request failed: ${response.status}`);
    error.code = body?.code || 'SIDECAR_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return body;
}

async function waitForSidecar() {
  // PyInstaller may need extra time on the first launch while Windows scans
  // and initializes the bundled executable. Do not kill a healthy sidecar
  // merely because it did not answer within the old 10-second window.
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    if (sidecarExit) {
      const detail = sidecarExit.signal ? `信号 ${sidecarExit.signal}` : `退出码 ${sidecarExit.code}`;
      throw new Error(`下载引擎进程提前退出（${detail}）。请关闭旧版易下载后重试。`);
    }
    try {
      const health = await sidecarRequest('/health');
      if (health.engineRevision !== '1.0.2-r1') throw Object.assign(new Error('打包的下载引擎与软件版本不一致，不能继续启动。请获取当前版本的完整绿色包。'), { code: 'ENGINE_BUILD_MISMATCH' });
      return health;
    } catch (error) {
      if (error.code === 'ENGINE_BUILD_MISMATCH') throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error('下载引擎在 30 秒内没有响应。请关闭旧版易下载后重试；如果仍失败，请检查 Windows 是否拦截了易下载的下载引擎。', { cause: lastError });
}

function bridgeJson(response, status, payload) {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': raw.length,
    'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type, x-easy-download-bridge',
  });
  response.end(raw);
}

function pruneSetupTickets() {
  const now = Date.now();
  for (const [ticket, entry] of setupTickets) {
    if (entry.expiresAt <= now) setupTickets.delete(ticket);
  }
}


function findChromeExecutable() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  const standard = candidates.find(candidate => existsSync(candidate));
  if (standard) return standard;
  if (isWindows) for (const hive of ['HKCU', 'HKLM']) {
    const registered = spawnSync('reg.exe', ['query', `${hive}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe`, '/ve'], { windowsHide: true, encoding: 'utf8', timeout: 2000 });
    const filename = registered.stdout?.match(/REG_SZ\s+([^\r\n]+)/)?.[1]?.trim().replace(/^"|"$/g, '');
    if (filename && /chrome\.exe$/i.test(filename) && existsSync(filename)) return filename;
  }
  return null;
}

async function openChromeConnection() {
  pruneSetupTickets();
  const ticket = randomBytes(24).toString('base64url');
  setupTickets.set(ticket, { expiresAt: Date.now() + 10 * 60 * 1000, paired: false });
  const setupUrl = `http://127.0.0.1:${browserBridgePort || 17894}/browser-setup?ticket=${encodeURIComponent(ticket)}`;
  const extensionDir = path.join(root, 'extension');
  if (!existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error('扩展文件缺失，请重新安装易下载。');
  const chrome = findChromeExecutable();
  if (!process.env.EASY_DOWNLOAD_SKIP_BROWSER_OPEN) {
    if (chrome) {
      // The wizard opens the management tab after it has loaded. This keeps
      // the actual install controls in front, even during a cold Chrome start.
      const child = spawn(chrome, ['--new-window', setupUrl], { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', error => { const entry = setupTickets.get(ticket); if (entry) entry.error = 'Chrome 未能打开，请点击打开扩展管理页重试。'; diagnostic('Chrome setup launch failed', error); });
      child.unref();
    } else {
      await shell.openExternal(setupUrl);
    }
  }
  return { ok: true, ticket, chromeFound: Boolean(chrome) };
}

function openChromeExtensions() {
  const chrome = findChromeExecutable();
  if (!chrome) throw new Error('没有找到 Chrome。请在 Chrome 地址栏输入 chrome://extensions 并回车。');
  if (!process.env.EASY_DOWNLOAD_SKIP_BROWSER_OPEN) {
    const child = spawn(chrome, ['chrome://extensions/'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', error => diagnostic('Chrome open failed', error)); child.unref();
  }
  return { ok: true, message: '已打开 Chrome 扩展管理页，请开启右上角开发者模式。' };
}

function startBrowserBridge() {
  browserBridgePort = Number(process.env.EASY_DOWNLOAD_BROWSER_PORT || 17894);
  if (!Number.isInteger(browserBridgePort) || browserBridgePort < 1024 || browserBridgePort > 65535) browserBridgePort = 17894;
  browserBridge = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-easy-download-bridge', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
      response.end();
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      bridgeJson(response, 200, { ok: true, service: 'easy-download-browser-bridge', version: app.getVersion() });
      return;
    }
    const parsedUrl = new URL(request.url, `http://127.0.0.1:${browserBridgePort}`);
    if (request.method === 'GET' && parsedUrl.pathname.startsWith('/browser-setup-assets/')) {
      pruneSetupTickets();
      const name = parsedUrl.pathname.split('/').pop();
      const files = { 'extensions.png': 'connection-02-extensions.png', 'folder.png': 'connection-03-select-folder.png' };
      if (!setupTickets.has(parsedUrl.searchParams.get('ticket')) || !Object.hasOwn(files, name)) { response.writeHead(404); response.end(); return; }
      const filename = path.join(root, 'docs', 'manual-assets', files[name]);
      if (!existsSync(filename)) { response.writeHead(404); response.end(); return; }
      const picture = readFileSync(filename); response.writeHead(200, { 'content-type': 'image/png', 'content-length': picture.length, 'cache-control': 'no-store' }); response.end(picture); return;
    }
    if (request.method === 'POST' && parsedUrl.pathname === '/v1/browser/setup-action') {
      if (request.headers.origin !== `http://127.0.0.1:${browserBridgePort}` || !String(request.headers['content-type'] || '').startsWith('application/json')) { bridgeJson(response, 403, { ok: false }); return; }
      let raw = ''; request.on('data', chunk => { raw += chunk; if (raw.length > 4096) request.destroy(); });
      request.on('end', () => {
        try {
          pruneSetupTickets(); const payload = JSON.parse(raw); const entry = setupTickets.get(String(payload.ticket || ''));
          if (!entry) { bridgeJson(response, 410, { ok: false, message: '向导已过期，请重新连接。' }); return; }
          if (payload.action === 'open-extensions') {
            if (!payload.automatic || !entry.opened) { openChromeExtensions(); entry.opened = true; }
            bridgeJson(response, 200, { ok: true, message: '扩展管理页已打开；操作后可切回这个图文向导。' });
          } else if (payload.action === 'copy-path' && !payload.automatic) {
            clipboard.writeText(path.join(root, 'extension')); bridgeJson(response, 200, { ok: true, message: '路径已复制：在选择文件夹窗口按 Ctrl + L、Ctrl + V、回车，再点击选择文件夹。' });
          } else bridgeJson(response, 400, { ok: false, message: '不支持的向导操作。' });
        } catch (error) { bridgeJson(response, 400, { ok: false, message: error.message || '请重新打开向导。' }); }
      }); return;
    }
    if (request.method === 'GET' && parsedUrl.pathname === '/browser-setup') {
      const ticket = parsedUrl.searchParams.get('ticket') || '';
      pruneSetupTickets();
      if (!setupTickets.has(ticket)) {
        response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<h1>连接已过期</h1><p>请回到易下载重新点击“连接 Chrome”。</p>');
        return;
      }
      const html = Buffer.from(renderChromeSetup(ticket, path.join(root, 'extension')), 'utf8');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length });
      response.end(html);
      return;
    }
    if (request.method === 'GET' && parsedUrl.pathname === '/v1/browser/setup-status') {
      const ticket = parsedUrl.searchParams.get('ticket') || '';
      pruneSetupTickets();
      const entry = setupTickets.get(ticket);
      bridgeJson(response, 200, { ok: true, paired: Boolean(entry?.paired), expired: !entry, error: entry?.error || '' });
      return;
    }
    if (request.method === 'POST' && parsedUrl.pathname === '/v1/browser/bootstrap') {
      let raw = '';
      let size = 0;
      request.setEncoding('utf8');
      request.on('data', chunk => {
        size += Buffer.byteLength(chunk);
        if (size > 8 * 1024) request.destroy();
        else raw += chunk;
      });
      request.on('error', () => {});
      request.on('end', () => {
        try {
          pruneSetupTickets();
          const payload = JSON.parse(raw || '{}');
          const ticket = String(payload.ticket || '');
          const entry = setupTickets.get(ticket);
          if (!entry || entry.expiresAt <= Date.now()) {
            bridgeJson(response, 410, { ok: false, code: 'SETUP_TICKET_EXPIRED', message: '连接已过期，请回到易下载重新开始连接。' });
            return;
          }
          if (payload.protocolVersion !== 2) {
            entry.error = '检测到旧版扩展，请在 Chrome 中停用旧副本，并加载本次 1.0.1 的 extension 文件夹。';
            bridgeJson(response, 426, {ok:false,code:'EXTENSION_UPDATE_REQUIRED',message:entry.error});
            return;
          }
          if (entry.used) {
            // Installing/reloading the extension can reload the wizard while
            // acknowledgement is in flight. An unexpired ticket is retryable;
            // issuing credentials still does not mark the connection paired.
            bridgeJson(response, 200, { ok: true, bridgeToken: browserBridgeToken });
            return;
          }
          entry.used = true;
          bridgeJson(response, 200, { ok: true, bridgeToken: browserBridgeToken });
        } catch (_) {
          bridgeJson(response, 400, { ok: false, code: 'SETUP_REQUEST_INVALID', message: '连接请求无效，请重新开始连接。' });
        }
      });
      return;
    }
    if (parsedUrl.pathname === '/v1/browser/status' || parsedUrl.pathname === '/v1/browser/confirm') {
      if (!browserBridgeToken || request.headers['x-easy-download-bridge'] !== browserBridgeToken) {
        bridgeJson(response, 401, { ok: false, code: 'BRIDGE_UNAUTHORIZED', message: 'Chrome 连接已失效，请在软件设置中重新连接。' });
        return;
      }
      if (request.method === 'GET' && parsedUrl.pathname.endsWith('/status')) {
        browserConnected = true;
        browserLastSeen = Date.now();
        bridgeJson(response, 200, { ok: true, connected: true, version: app.getVersion() });
        mainWindow?.webContents.send('browser-paired');
        return;
      }
      if (request.method === 'POST' && parsedUrl.pathname.endsWith('/confirm')) {
        let raw = '';
        request.on('data', chunk => { raw += chunk; if (raw.length > 8192) request.destroy(); });
        request.on('end', () => {
          try {
            const entry = setupTickets.get(String(JSON.parse(raw || '{}').ticket || ''));
            if (!entry?.used || entry.expiresAt <= Date.now()) { bridgeJson(response, 410, {ok:false,message:'连接向导已过期'}); return; }
            entry.paired = true;
            entry.error = '';
            browserConnected = true;
            browserLastSeen = Date.now();
            bridgeJson(response, 200, { ok: true });
            mainWindow?.webContents.send('browser-paired');
          } catch (_) { bridgeJson(response, 400, { ok: false, message: '连接确认无效' }); }
        });
        return;
      }
    }
    if (request.method !== 'POST' || request.url !== '/v1/browser/submit') {
      bridgeJson(response, 404, { ok: false, code: 'NOT_FOUND', message: '浏览器下载入口不存在' });
      return;
    }
    if (!browserBridgeToken || request.headers['x-easy-download-bridge'] !== browserBridgeToken) {
      bridgeJson(response, 401, { ok: false, code: 'BRIDGE_UNAUTHORIZED', message: '浏览器连接码无效，请在设置中重新复制连接码。' });
      return;
    }
    let raw = '';
    let size = 0;
    request.setEncoding('utf8');
    request.on('data', chunk => {
      size += Buffer.byteLength(chunk);
      if (size > 64 * 1024) request.destroy();
      else raw += chunk;
    });
    request.on('error', () => {});
    request.on('end', async () => {
      try {
        const body = JSON.parse(raw || '{}');
        const input = String(body.url || '').trim();
        if (!/^https?:\/\//i.test(input)) {
          bridgeJson(response, 400, { ok: false, code: 'INVALID_URL', message: '没有读取到有效的视频页面地址。' });
          return;
        }
        const mode = body.mode === 'preview' ? 'preview' : 'direct';
        if (mode === 'preview') {
          mainWindow?.show();
          mainWindow?.focus();
          mainWindow?.webContents.send('browser-link', { url: input, title: String(body.title || '') });
          bridgeJson(response, 200, { ok: true, message: '链接已发送到易下载，请确认下载参数。' });
          return;
        }
        const { settings } = await sidecarRequest('/v1/settings');
        mainWindow?.show();
        mainWindow?.focus();
        // Chromium extension fetches must not wait for a multi-minute site
        // resolution/verification. Acknowledge delivery, report outcome in app.
        bridgeJson(response, 202, { ok: true, message: '链接已交给易下载，解析进度与结果请看软件窗口。', url: input });
        void downloadController.start({
          input,
          quality: settings.quality || 'best',
          format: settings.format || 'mp4',
          premium: false,
        }).then(result => mainWindow?.webContents.send('download-progress', {url: input,stage:'submitted',message:result.message || '下载任务已创建。'}))
          .catch(error => mainWindow?.webContents.send('download-progress', {url:input,stage:'failed',message:error.message || '这个视频暂时无法下载。'}));
      } catch (error) {
        bridgeJson(response, Number(error?.status) || 400, { ok: false, code: error?.code || 'BROWSER_DOWNLOAD_FAILED', message: error?.message || '浏览器下载失败，请回到易下载查看提示。' });
      }
    });
  });
  browserBridge.on('error', error => diagnostic('browser bridge failed', error));
  browserBridge.listen(browserBridgePort, '127.0.0.1');
}

async function pairBrowserBridge() {
  const pairing = await sidecarRequest('/v1/pairing');
  browserBridgeToken = pairing.bridgeToken;
  startBrowserBridge();
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 880,
    minHeight: 620,
    title: '易下载',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.loadFile(path.join(__dirname, 'renderer', 'app.html'));
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
      douyinResolver?.dispose();
      yifanBrowserResolver?.dispose();
    }
  });
  return window;
}

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  Menu.setApplicationMenu(null);
  startSidecar();
  await waitForSidecar();
  douyinResolver = new DouyinResolver({
    BrowserWindow,
    session: require('electron').session,
    parent: () => mainWindow,
    loadCookies: async () => (await sidecarRequest('/v1/douyin/session-cookies')).cookies,
    progress: (event) => mainWindow?.webContents.send('download-progress', event),
  });
  yifanBrowserResolver = new YifanBrowserResolver({BrowserWindow, session:require('electron').session, parent:()=>mainWindow, progress:event=>mainWindow?.webContents.send('download-progress',event)});
  downloadController = new DownloadController({
    request: sidecarRequest,
    resolveDouyin: (url, settings) => douyinResolver.resolve(url, settings),
    resolveYifan: (url, settings) => resolveYifan(url, settings, {browserResolve:(source, preferences)=>yifanBrowserResolver.resolve(source, preferences)}),
    verifyMedia: (task, expected) => verifyMedia(task, expected, path.join(root, 'bin', 'ffmpeg.exe')),
    progress: (event) => mainWindow?.webContents.send('download-progress', event),
  });
  ipcMain.handle('sidecar-request', (_event, route, init = {}) => {
    if (String(route).split('?')[0] === '/v1/douyin/session-cookies') throw new Error('浏览器会话仅限主进程使用');
    return sidecarRequest(route, init);
  });
  ipcMain.handle('download-start', (_event, payload = {}) => downloadController.start(payload));
  ipcMain.handle('download-batch', (_event, payload = {}) => downloadController.startBatch(payload));
  ipcMain.handle('download-tasks', () => downloadController.listTasks());
  ipcMain.handle('download-deep-verify', (_event, id) => downloadController.deepVerify(String(id)));
  ipcMain.handle('open-chrome-extensions', () => openChromeExtensions());
  ipcMain.handle('copy-extension-path', () => { clipboard.writeText(path.join(root, 'extension')); return { ok: true }; });
  ipcMain.handle('download-clear-history', () => downloadController.clearHistory());
  ipcMain.handle('choose-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('open-update', async (_event, target) => {
    const updateRoot = path.resolve(process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'), 'EasyDownload', 'updates');
    const resolved = path.resolve(String(target || ''));
    const relative = path.relative(updateRoot, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !resolved.toLowerCase().endsWith('.exe')) {
      throw new Error('更新包路径无效');
    }
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
    return { ok: true };
  });
  ipcMain.handle('open-folder', async (_event, target) => {
    const resolved = path.resolve(String(target || ''));
    if (!resolved || !existsSync(resolved)) throw new Error('文件夹不存在');
    const error = await shell.openPath(resolved);
    if (error) throw new Error(error);
    return { ok: true };
  });
  ipcMain.handle('open-extension', async () => {
    const directory = path.join(root, 'extension');
    if (!existsSync(path.join(directory, 'manifest.json'))) throw new Error('扩展文件缺失，请重新安装易下载。');
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
  ipcMain.handle('connect-chrome', () => openChromeConnection());
  ipcMain.handle('browser-setup-status', (_event, ticket) => {
    pruneSetupTickets();
    const entry = setupTickets.get(String(ticket || ''));
    return { ok: true, paired: Boolean(entry?.paired), expired: !entry, error: entry?.error || '' };
  });
  ipcMain.handle('browser-connection-status', () => ({ connected: browserConnected, lastSeen: browserLastSeen }));
  ipcMain.handle('open-manual', async () => {
    const manual = path.join(root, 'docs', '易下载用户操作手册-1.0.2.pdf');
    if (!existsSync(manual)) throw new Error('用户手册尚未打包，请重新安装易下载。');
    const error = await shell.openPath(manual);
    if (error) throw new Error(error);
    return { ok: true };
  });
  mainWindow = createWindow();
  await pairBrowserBridge();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
}).catch((error) => {
  diagnostic('startup failed', error);
  const detail = error?.cause?.message && error.message.includes('30 秒') ? `${error.message}\n底层原因：${error.cause.message}` : error.message;
  dialog.showErrorBox('易下载启动失败', detail || '下载引擎未能启动，请关闭旧版易下载后重试。');
  app.quit();
});

app.on('before-quit', () => {
  disposeMediaChecks();
  if (browserBridge) {
    try { browserBridge.close(); } catch (_) { /* already closed */ }
    browserBridge = null;
  }
  if (sidecar && !sidecar.killed && sidecar.exitCode === null) {
    if (isWindows && sidecar.pid) spawnSync('taskkill.exe', ['/PID', String(sidecar.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
    else sidecar.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
