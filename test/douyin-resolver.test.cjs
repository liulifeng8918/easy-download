const test = require('node:test');
const assert = require('node:assert/strict');
const { selectDouyinMedia, isDouyinNavigation } = require('../electron/download/douyin-resolver.cjs');

test('permits the real short-link redirect but not unrelated share hosts', () => {
  assert.equal(isDouyinNavigation('https://www.iesdouyin.com/share/video/123/?region=CN'), true);
  assert.equal(isDouyinNavigation('https://www.iesdouyin.com/not-a-video'), false);
  assert.equal(isDouyinNavigation('https://www.iesdouyin.com.evil.example/share/video/123/'), false);
});
test('selects only the target Douyin media, never a recommendation', () => {
  const source = 'https://www.douyin.com/video/123';
  const state = { pageUrl: source, title: '目标视频', videos: [{ src: 'https://v26-weba.douyinvod.com/v.mp4?__vid=999', duration: 10, active: true }, { src: 'https://v26-weba.douyinvod.com/v.mp4?__vid=123', duration: 57, active: true, width: 768, height: 576 }] };
  assert.equal(selectDouyinMedia(state, '123').duration, 57);
  assert.equal(selectDouyinMedia(state, '456'), null);
});
test('refuses blob, foreign CDN, private source and identity change', () => {
  for (const src of ['blob:https://www.douyin.com/x', 'https://evil.example/v.mp4', 'http://127.0.0.1/v', 'https://v26-weba.douyinvod.com/v?__vid=999']) {
    assert.equal(selectDouyinMedia({ pageUrl: 'https://www.douyin.com/video/123', videos: [{ src, duration: 10, active: true }] }, '123'), null);
  }
  assert.equal(selectDouyinMedia({ pageUrl: 'https://www.douyin.com/video/999', videos: [{ src: 'https://v26-weba.douyinvod.com/v?__vid=123', duration: 10, active: true }] }, '123'), null);
  assert.equal(isDouyinNavigation('https://douyin.com.evil.example/video/123'), false);
});

test('does not mistake a player blob UUID for a downloadable media URL', () => {
  const source = 'https://www.douyin.com/video/123';
  for (const src of ['blob:https://www.douyin.com/4ac3c5bd-f6e6-4cc0-a5c2-9d7c8b2fd6f0', 'https://www.douyin.com/4ac3c5bd-f6e6-4cc0-a5c2-9d7c8b2fd6f0']) {
    assert.equal(selectDouyinMedia({ pageUrl: source, videos: [{ src, duration: 1, active: true }] }, '123'), null);
  }
});
