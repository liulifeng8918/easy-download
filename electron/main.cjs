const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:http');
const { appendFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const { DownloadController } = require('./download/controller.cjs');
const { DouyinResolver } = require('./download/douyin-resolver.cjs');
const { verifyMedia } = require('./download/media-verifier.cjs');

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
let mainWindow;
let downloadController;
let douyinResolver;
let browserBridge;
let browserBridgeToken;
let browserBridgePort;
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
  const args = command.toLowerCase().endsWith('.exe') && command === bundledSidecar
    ? ['--port', String(sidecarPort), '--token', sidecarToken, '--project-root', root]
    : [sidecarScript, '--port', String(sidecarPort), '--token', sidecarToken, '--project-root', root];
  sidecar = spawn(command, args, {
    cwd: root,
    env: portableMode ? { ...process.env, LOCALAPPDATA: path.join(portableDataRoot, 'local') } : process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  sidecar.stdout.on('data', (chunk) => console.log(`[sidecar] ${chunk.toString().trimEnd()}`));
  sidecar.stderr.on('data', (chunk) => diagnostic('[sidecar] ' + chunk.toString().trimEnd()));
  sidecar.on('exit', (code, signal) => diagnostic(`[sidecar] exited code=${code} signal=${signal || ''}`));
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
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await sidecarRequest('/health');
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error('Python sidecar did not start');
}

function bridgeJson(response, status, payload) {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': raw.length,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
  });
  response.end(raw);
}

function pruneSetupTickets() {
  const now = Date.now();
  for (const [ticket, entry] of setupTickets) {
    if (entry.expiresAt <= now) setupTickets.delete(ticket);
  }
}

function setupPage(ticket) {
  const safeTicket = String(ticket).replace(/[^a-zA-Z0-9_-]/g, '');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>易下载连接 Chrome</title><style>body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;background:#f6f9fc;color:#14233b;margin:0;padding:34px}main{max-width:700px;margin:auto;background:#fff;border:1px solid #d9e3ef;border-radius:18px;padding:28px;box-shadow:0 12px 36px rgba(25,67,110,.08)}h1{margin:0 0 8px;font-size:24px}p{line-height:1.7;color:#65748b}.step{display:flex;gap:14px;align-items:flex-start;border:1px solid #d7e7f5;background:#f7fbff;border-radius:12px;padding:15px;margin:12px 0}.num{display:grid;place-items:center;flex:0 0 26px;height:26px;border-radius:50%;background:#1976f3;color:#fff;font-weight:700}.status{margin-top:18px;padding:12px;border-radius:10px;background:#eaf3ff;color:#2670c7}.ok{background:#e9f8f1;color:#18764d}</style></head><body><main><h1>易下载连接 Chrome</h1><p>只需在 Chrome 中加载一次扩展，易下载会自动完成连接。你不需要复制连接码，也不需要填写网站列表。</p><div class="step"><span class="num">1</span><div><b>在 Chrome 扩展页点击“加载已解压的扩展程序”</b><p>选择易下载刚刚打开的 extension 文件夹。</p></div></div><div class="step"><span class="num">2</span><div><b>等待自动连接</b><p>扩展加载后会自动完成配对并同步已登记平台的登录状态。</p></div></div><div id="status" class="status">正在等待扩展加载……</div></main><script>const ticket=${JSON.stringify(safeTicket)};async function check(){try{const r=await fetch('/v1/browser/setup-status?ticket='+encodeURIComponent(ticket));const d=await r.json();const el=document.getElementById('status');if(d.paired){el.className='status ok';el.textContent='已连接，可以关闭此页面并回到易下载。';return}if(d.expired){el.textContent='连接已过期，请回到易下载重新点击“连接 Chrome”。';return}el.textContent='正在等待扩展加载……';}catch(_){document.getElementById('status').textContent='易下载未运行，请回到程序重新开始连接。';}setTimeout(check,1000)}check();</script></body></html>`;
}

function findChromeExecutable() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.find(candidate => existsSync(candidate)) || null;
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
      const child = spawn(chrome, ['--new-window', 'chrome://extensions/', setupUrl], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } else {
      await shell.openExternal(setupUrl);
    }
    await shell.openPath(extensionDir);
  }
  return { ok: true, ticket, chromeFound: Boolean(chrome) };
}

function startBrowserBridge() {
  browserBridgePort = Number(process.env.EASY_DOWNLOAD_BROWSER_PORT || 17894);
  if (!Number.isInteger(browserBridgePort) || browserBridgePort < 1024 || browserBridgePort > 65535) browserBridgePort = 17894;
  browserBridge = createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' });
      response.end();
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      bridgeJson(response, 200, { ok: true, service: 'easy-download-browser-bridge', version: '1.0.0' });
      return;
    }
    const parsedUrl = new URL(request.url, `http://127.0.0.1:${browserBridgePort}`);
    if (request.method === 'GET' && parsedUrl.pathname === '/browser-setup') {
      const ticket = parsedUrl.searchParams.get('ticket') || '';
      pruneSetupTickets();
      if (!setupTickets.has(ticket)) {
        response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        response.end('<h1>连接已过期</h1><p>请回到易下载重新点击“连接 Chrome”。</p>');
        return;
      }
      const html = Buffer.from(setupPage(ticket), 'utf8');
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': html.length });
      response.end(html);
      return;
    }
    if (request.method === 'GET' && parsedUrl.pathname === '/v1/browser/setup-status') {
      const ticket = parsedUrl.searchParams.get('ticket') || '';
      pruneSetupTickets();
      const entry = setupTickets.get(ticket);
      bridgeJson(response, 200, { ok: true, paired: Boolean(entry?.paired), expired: !entry });
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
          const ticket = String(JSON.parse(raw || '{}').ticket || '');
          const entry = setupTickets.get(ticket);
          if (!entry || entry.expiresAt <= Date.now()) {
            bridgeJson(response, 410, { ok: false, code: 'SETUP_TICKET_EXPIRED', message: '连接已过期，请回到易下载重新开始连接。' });
            return;
          }
          if (entry.used) {
            bridgeJson(response, 409, { ok: false, code: 'SETUP_TICKET_USED', message: '连接已经完成，请回到易下载查看状态。' });
            return;
          }
          entry.used = true;
          entry.paired = true;
          bridgeJson(response, 200, { ok: true, bridgeToken: browserBridgeToken });
          mainWindow?.webContents.send('browser-paired');
        } catch (_) {
          bridgeJson(response, 400, { ok: false, code: 'SETUP_REQUEST_INVALID', message: '连接请求无效，请重新开始连接。' });
        }
      });
      return;
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
        const result = await downloadController.start({
          input,
          quality: settings.quality || 'best',
          format: settings.format || 'mp4',
          premium: false,
        });
        mainWindow?.show();
        mainWindow?.focus();
        bridgeJson(response, 202, { ok: true, message: result.message || '已加入下载任务。', task: result.task, url: result.url });
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
    progress: (event) => mainWindow?.webContents.send('download-progress', event),
  });
  downloadController = new DownloadController({
    request: sidecarRequest,
    resolveDouyin: (url, settings) => douyinResolver.resolve(url, settings),
    verifyMedia: (task, expected) => verifyMedia(task, expected, path.join(root, 'bin', 'ffmpeg.exe')),
    progress: (event) => mainWindow?.webContents.send('download-progress', event),
  });
  ipcMain.handle('sidecar-request', (_event, route, init = {}) => sidecarRequest(route, init));
  ipcMain.handle('download-start', (_event, payload = {}) => downloadController.start(payload));
  ipcMain.handle('download-batch', (_event, payload = {}) => downloadController.startBatch(payload));
  ipcMain.handle('download-tasks', () => downloadController.listTasks());
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
    return { ok: true, paired: Boolean(entry?.paired), expired: !entry };
  });
  ipcMain.handle('open-manual', async () => {
    const manual = path.join(root, 'docs', '易下载用户操作手册.pdf');
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
  dialog.showErrorBox('易下载启动失败', '下载引擎未能启动，请关闭旧版易下载后重试。\n' + error.message);
  app.quit();
});

app.on('before-quit', () => {
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
