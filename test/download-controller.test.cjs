const test = require('node:test');
const assert = require('node:assert/strict');
const { DownloadController } = require('../electron/download/controller.cjs');
function setup(overrides = {}) {
  const calls = [], events = [];
  const request = async (route, init = {}) => {
    calls.push([route, init.body ? JSON.parse(init.body) : null]);
    if (route === '/v1/license/status') return { license: { active: true } };
    if (route === '/v1/settings') return { settings: { outputDir: 'D:/downloads', proxy: '', autoProxy: true } };
    if (route === '/v1/links/check') return { check: { ready: true, message: '已识别' } };
    if (route === '/v1/downloads' && init.method === 'POST') return { task: { id: 'one', url: calls.at(-1)[1].url, quality: 'best', output_dir: 'D:/downloads', status: 'queued' } };
    if (route === '/v1/downloads') return { tasks: [{ id: 'one', url: 'https://cdn.example/video', quality: 'best', status: 'completed', output_path: 'D:/downloads/video.mp4', output_dir: 'D:/downloads' }] };
    return { ok: true };
  };
  const controller = new DownloadController({ request, resolveDouyin: async () => ({ mediaUrl: 'https://v26-weba.douyinvod.com/video.mp4?__vid=123', sourceUrl: 'https://www.douyin.com/video/123', title: '测试', duration: 57 }), verifyMedia: async () => ({ ok: true, duration: 57 }), progress: event => events.push(event), ...overrides });
  return { controller, calls, events };
}
test('normal sites use the existing protected engine and normalized input', async () => {
  const { controller, calls } = setup();
  const result = await controller.start({ input: '分享 https://www.youtube.com/watch?v=x 完毕', quality: 'best' });
  assert.equal(result.url, 'https://www.youtube.com/watch?v=x');
  assert.equal(calls.find(([route]) => route === '/v1/links/check')[1].url, result.url);
  assert.equal(calls.find(([route, body]) => route === '/v1/downloads' && body)[1].url, result.url);
});
test('browser media stays internal and task display retains original page', async () => {
  const { controller, calls } = setup();
  const result = await controller.start({ input: '看 https://v.douyin.com/abc/', quality: 'best' });
  assert.equal(result.task.url, 'https://v.douyin.com/abc/');
  assert.equal(calls.some(([route]) => route === '/v1/links/check'), false);
  assert.match(calls.find(([route, body]) => route === '/v1/downloads' && body)[1].url, /douyinvod/);
  assert.equal(calls.find(([route, body]) => route === '/v1/downloads' && body)[1].sourceUrl, 'https://v.douyin.com/abc/');
  const tasks = await controller.listTasks();
  await new Promise(resolve => setImmediate(resolve));
  const verified = await controller.listTasks();
  assert.equal(tasks.tasks[0].url, 'https://v.douyin.com/abc/');
  assert.equal(verified.tasks[0].status, 'completed');
  assert.equal(JSON.stringify(tasks).includes('douyinvod'), false);
});
test('browser media carries the proxy used during resolution', async () => {
  const calls = [];
  const request = async (route, init = {}) => {
    calls.push([route, init.body ? JSON.parse(init.body) : null]);
    if (route === '/v1/license/status') return { license: { active: true } };
    if (route === '/v1/settings') return { settings: { outputDir: 'D:/downloads', proxy: 'http://127.0.0.1:7892', autoProxy: true } };
    if (route === '/v1/downloads' && init.method === 'POST') return { task: { id: 'proxy-task', url: calls.at(-1)[1].url } };
    return { tasks: [] };
  };
  const controller = new DownloadController({
    request,
    resolveDouyin: async () => ({ mediaUrl: 'https://v26-weba.douyinvod.com/video.mp4?__vid=123', sourceUrl: 'https://www.douyin.com/video/123', referer: 'https://www.douyin.com/video/123', userAgent: 'Mozilla/5.0 EasyDownloadTest', title: '测试', videoId: '123', duration: 57, viaProxy: true }),
  });
  await controller.start({ input: 'https://v.douyin.com/abc/' });
  const body = calls.find(([route, body]) => route === '/v1/downloads' && body)[1];
  assert.equal(body.proxy, 'http://127.0.0.1:7892');
  assert.equal(body.autoProxy, false);
  assert.equal(body.referer, 'https://www.douyin.com/video/123');
  assert.equal(body.userAgent, 'Mozilla/5.0 EasyDownloadTest');
});
test('unlicensed users can download a single free link', async () => {
  let submitted;
  const { controller } = setup({ request: async (route, init = {}) => {
    if (route === '/v1/license/status') return { license: { active: false, message: '免费版' } };
    if (route === '/v1/settings') return { settings: { outputDir: 'D:/downloads', proxy: '', autoProxy: true } };
    if (route === '/v1/links/check') return { check: { ready: true, message: '已识别' } };
    if (route === '/v1/downloads' && init.method === 'POST') { submitted = JSON.parse(init.body); return { task: { id: 'free-one', url: 'https://www.youtube.com/watch?v=free', status: 'queued' } }; }
    return { tasks: [] };
  }});
  await controller.start({ input: 'https://www.youtube.com/watch?v=free' });
  assert.equal(submitted.premium, false);
});
test('unlicensed users cannot start premium downloads', async () => {
  const { controller } = setup({ request: async route => route === '/v1/license/status' ? { license: { active: false, message: '请先激活' } } : { settings: { outputDir: 'D:/downloads', proxy: '', autoProxy: true } } });
  await assert.rejects(controller.start({ input: 'https://www.youtube.com/watch?v=premium', premium: true }), /激活/);
});
test('licensed users can submit a bounded batch through the premium path', async () => {
  const submitted = [];
  const { controller } = setup({ request: async (route, init = {}) => {
    if (route === '/v1/license/status') return { license: { active: true } };
    if (route === '/v1/settings') return { settings: { outputDir: 'D:/downloads', proxy: '', autoProxy: true } };
    if (route === '/v1/links/check') return { check: { ready: true, message: '已识别' } };
    if (route === '/v1/downloads' && init.method === 'POST') {
      const body = JSON.parse(init.body); submitted.push(body);
      return { task: { id: `batch-${submitted.length}`, url: body.url, status: 'queued' } };
    }
    return { tasks: [] };
  }});
  const result = await controller.startBatch({ input: 'https://www.youtube.com/watch?v=one\nhttps://www.youtube.com/watch?v=two' });
  assert.equal(result.count, 2);
  assert.deepEqual(submitted.map(item => item.premium), [true, true]);
  await assert.rejects(controller.startBatch({ input: 'https://www.youtube.com/watch?v=only' }), /至少需要两条/);
});
test('expired periodic validation fails closed', async () => {
  const { controller } = setup({ request: async route => route.endsWith('status') ? { license: { active: true, needsValidation: true } } : { license: { active: false, message: '已到期' } } });
  await assert.rejects(controller.start({ input: 'https://v.douyin.com/abc/', premium: true }), /到期/);
});
test('unsafe resolved media is refused before invoking the backend', async () => {
  const { controller, calls } = setup({ resolveDouyin: async () => ({ mediaUrl: 'http://127.0.0.1/private' }) });
  await assert.rejects(controller.start({ input: 'https://v.douyin.com/abc/' }));
  assert.equal(calls.some(([route]) => route === '/v1/downloads'), false);
});
test('duplicate active requests reuse the same task', async () => {
  const { controller, calls } = setup();
  const results = await Promise.all([controller.start({ input: 'https://www.youtube.com/watch?v=x' }), controller.start({ input: 'https://www.youtube.com/watch?v=x' })]);
  assert.equal(results[0].task.id, results[1].task.id);
  assert.equal(calls.filter(([route, body]) => route === '/v1/downloads' && body).length, 1);
});
test('fake engine success is not displayed as completed', async () => {
  const { controller } = setup({ verifyMedia: async () => ({ ok: false, message: '输出不是有效视频' }) });
  await controller.start({ input: 'https://www.youtube.com/watch?v=x' });
  await controller.listTasks();
  await new Promise(resolve => setImmediate(resolve));
  const { tasks } = await controller.listTasks();
  assert.equal(tasks[0].status, 'failed');
  assert.match(tasks[0].error, /有效视频/);
});

test('pending media verification is visible and never blocks task polling', async () => {
  let complete;
  const { controller } = setup({ verifyMedia: () => new Promise(resolve => { complete = resolve; }) });
  await controller.start({ input: 'https://www.youtube.com/watch?v=x' });
  const first = await controller.listTasks();
  assert.equal(first.tasks[0].status, 'verifying');
  complete({ ok: true, duration: 57 });
  await new Promise(resolve => setImmediate(resolve));
  const next = await controller.listTasks();
  assert.equal(next.tasks[0].status, 'completed');
});
test('P2 unsupported cases do not send an unsafe default engine request', async () => {
  for (const url of ['https://www.kuaishou.com/short-video/x', 'https://www.viu.com/ott/hk/zh-hk/vod/1', 'https://www.netflix.com/watch/123']) {
    const { controller, calls } = setup();
    await assert.rejects(controller.start({ input: url }));
    assert.equal(calls.some(([route]) => route === '/v1/links/check'), false);
  }
});
