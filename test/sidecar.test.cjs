const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = path.join(root, 'python', 'easy_download_sidecar.py');

function startSidecar() {
  const port = 24000 + Math.floor(Math.random() * 1000);
  const token = 'test-token-' + 'x'.repeat(32);
  const localAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-download-sidecar-'));
  const child = spawn(process.platform === 'win32' ? 'python.exe' : 'python3', [script, '--port', String(port), '--token', token], { cwd: root, windowsHide: true, env: { ...process.env, LOCALAPPDATA: localAppData } });
  return { child, port, token, localAppData };
}

test('sidecar rejects requests without the session token and serves state with it', async (t) => {
  const running = startSidecar();
  t.after(() => { running.child.kill(); fs.rmSync(running.localAppData, { recursive: true, force: true }); });
  let ready = false;
  for (let i = 0; i < 50 && !ready; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/health`);
      ready = response.status === 401;
    } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  assert.equal(ready, true);
  const response = await fetch(`http://127.0.0.1:${running.port}/v1/state`, { headers: { 'X-Easy-Download-Session': running.token } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.license.active, false);
});

test('cookie bridge requires pairing, domain allowlist, and encrypts at rest', async (t) => {
  const running = startSidecar();
  t.after(() => { running.child.kill(); fs.rmSync(running.localAppData, { recursive: true, force: true }); });
  let ready = false;
  for (let i = 0; i < 50 && !ready; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/health`, { headers: { 'X-Easy-Download-Session': running.token } });
      ready = response.status === 200;
    } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  assert.equal(ready, true);
  const auth = { 'X-Easy-Download-Session': running.token, 'content-type': 'application/json' };
  const pairing = await fetch(`http://127.0.0.1:${running.port}/v1/pairing`, { headers: auth }).then((response) => response.json());
  const cookieText = '# Netscape HTTP Cookie File\n# test\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret-cookie-value\n';
  const denied = await fetch(`http://127.0.0.1:${running.port}/cookies`, { method: 'POST', headers: { 'X-Easy-Download-Bridge': 'wrong-token' }, body: cookieText });
  assert.equal(denied.status, 401);
  const accepted = await fetch(`http://127.0.0.1:${running.port}/cookies`, { method: 'POST', headers: { 'X-Easy-Download-Bridge': pairing.bridgeToken, 'X-Easy-Download-Domains': 'youtube.com' }, body: cookieText });
  assert.equal(accepted.status, 200);
  const encrypted = fs.readFileSync(path.join(running.localAppData, 'EasyDownload', 'cookies.dat'));
  assert.equal(encrypted.includes('secret-cookie-value'), false);
  const rejected = await fetch(`http://127.0.0.1:${running.port}/cookies`, { method: 'POST', headers: { 'X-Easy-Download-Bridge': pairing.bridgeToken, 'X-Easy-Download-Domains': 'douyin.com' }, body: cookieText });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).code, 'COOKIE_DOMAIN_NOT_ALLOWED');
});

test('clear history endpoint accepts the new route and preserves an empty state', async (t) => {
  const running = startSidecar();
  t.after(() => { running.child.kill(); fs.rmSync(running.localAppData, { recursive: true, force: true }); });
  const auth = { 'X-Easy-Download-Session': running.token, 'content-type': 'application/json' };
  let ready = false;
  for (let i = 0; i < 50 && !ready; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${running.port}/health`, { headers: auth });
      ready = response.status === 200;
    } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  assert.equal(ready, true);
  const response = await fetch(`http://127.0.0.1:${running.port}/v1/downloads/clear-history`, { method: 'POST', headers: auth, body: '{}' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, removed: 0 });
});
