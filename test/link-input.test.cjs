const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLinkInput, sitePolicy, validatePublicUrl } = require('../electron/download/link-input.cjs');

test('extracts the user Douyin share without discarding the path', () => {
  const share = '9.79 07/31 :3pm jcn:/ w@S.LJ 从王二到闯王，明末农民起义拉开帷幕！ # 明朝 # 明末 # 崇祯  https://v.douyin.com/uOCeLrzmht8/ 复制此链接，打开Dou音搜索，直接观看视频！';
  assert.deepEqual(parseLinkInput(share), { url: 'https://v.douyin.com/uOCeLrzmht8/', extracted: true });
});
test('preserves signing parameters, case, encoded titles and current Bilibili part', () => {
  const url = 'https://www.xiaohongshu.com/explore/ABcd?xsec_token=AbC%2FDEF%3D&xsec_source=pc';
  assert.equal(parseLinkInput(`视频：“${url}”。`).url, url);
  assert.equal(parseLinkInput('https://www.bilibili.com/video/BV1A?p=2').url, 'https://www.bilibili.com/video/BV1A?p=2');
  assert.equal(parseLinkInput('https://example.com/v/%E4%B8%AD%E6%96%87?q=A%2BB').url, 'https://example.com/v/%E4%B8%AD%E6%96%87?q=A%2BB');
});
test('handles wrappers, zero width edges, repeats and balanced URL parentheses', () => {
  assert.equal(parseLinkInput('看这里（https://v.douyin.com/abc/）！').url, 'https://v.douyin.com/abc/');
  assert.equal(parseLinkInput('\u200bhttps://www.youtube.com/watch?v=AbC\u200b').url, 'https://www.youtube.com/watch?v=AbC');
  assert.equal(parseLinkInput('https://example.com/v https://example.com/v').url, 'https://example.com/v');
  assert.equal(parseLinkInput('(https://example.com/video_(one))').url, 'https://example.com/video_(one)');
});
test('rejects ambiguity, credentials, non-public targets and invalid input', () => {
  for (const raw of ['', '9.79 07/31 没有链接', 'file:///C:/private', 'https://a.com/1 https://b.com/2', 'https://user:pass@example.com/v', 'http://127.0.0.1/v', 'http://[::1]/v', 'http://192.168.1.1/v', 'http://2130706433/v', 'http://localhost/v', 'http://host.local/v', 'https://example.com:17893/v', 'a'.repeat(20001)]) {
    assert.throws(() => parseLinkInput(raw), raw.slice(0, 100));
  }
  assert.throws(() => validatePublicUrl('https://example.com/%ZZ'));
});
test('site registry uses exact domains rather than substring matching', () => {
  assert.equal(sitePolicy('https://v.douyin.com/abc/').adapter, 'douyin-browser');
  assert.equal(sitePolicy('https://www.douyin.com/video/123').name, '抖音');
  assert.equal(sitePolicy('https://www.youtube.com/watch?v=x').name, 'YouTube');
  assert.equal(sitePolicy('https://b23.tv/abc').name, 'B站');
  assert.equal(sitePolicy('https://douyin.com.evil.example/video/123').adapter, 'engine');
  assert.equal(sitePolicy('https://www.kuaishou.com/short-video/x').verification, 'pending');
});

test('P1 seven-platform registry uses the engine route and pending verification', () => {
  const cases = [
    ['https://www.xiaohongshu.com/explore/abc', '小红书', 'domestic'],
    ['https://weibo.com/tv/show/abc', '微博', 'domestic'],
    ['https://www.ixigua.com/abc', '西瓜视频', 'domestic'],
    ['https://www.tiktok.com/@demo/video/1', 'TikTok', 'overseas'],
    ['https://www.instagram.com/reel/abc/', 'Instagram', 'overseas'],
    ['https://www.facebook.com/watch/?v=1', 'Facebook', 'overseas'],
    ['https://x.com/demo/status/1', 'X', 'overseas'],
  ];
  for (const [url, name, network] of cases) {
    const policy = sitePolicy(url);
    assert.equal(policy.name, name);
    assert.equal(policy.adapter, 'engine');
    assert.equal(policy.priority, 'P1');
    assert.equal(policy.network, network);
    assert.equal(policy.verification, 'pending');
  }
});
