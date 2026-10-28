const test = require('node:test');
const assert = require('node:assert/strict');
const { isYifanNavigation, yifanVideoId, parseMasterPlaylist, resolveYifan } = require('../electron/download/yifan-resolver.cjs');

const source = 'https://www.yifan.tv/watch?v=HIVJn4VQvwrHXVmL0LMq51';

test('recognizes public yifan watch pages and extracts video id', () => {
  assert.equal(isYifanNavigation(source), true);
  assert.equal(isYifanNavigation('https://www.yifan.tv/search?q=test'), false);
  assert.equal(isYifanNavigation('https://yifan.tv.evil.example/watch?v=HIVJn4VQvwrHXVmL0LMq51'), false);
  assert.equal(yifanVideoId(source), 'HIVJn4VQvwrHXVmL0LMq51');
  assert.equal(yifanVideoId('https://www.yifan.tv/watch?v=bad'), null);
});

test('parses a master playlist without persisting signed media urls', () => {
  const playlist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://cdn.example.test/stream/chunklist.m3u8?sig=short';
  assert.equal(parseMasterPlaylist(playlist, 'https://upload.yifan.tv/api/video/MasterPlayList?id=x'), 'https://cdn.example.test/stream/chunklist.m3u8?sig=short');
  assert.throws(() => parseMasterPlaylist('#EXTM3U\n#EXT-X-ENDLIST', 'https://upload.yifan.tv/api/video/MasterPlayList?id=x'), /播放流/);
});

test('resolves yifan through the public playlist endpoint', async () => {
  const calls = [];
  const result = await resolveYifan(source, {}, {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://cdn.example.test/stream.m3u8?sig=short' };
    },
  });
  assert.match(calls[0].url, /upload\.yifan\.tv\/api\/video\/MasterPlayList\?id=HIVJn4VQvwrHXVmL0LMq51/);
  assert.equal(calls[0].init.headers.Referer, source);
  assert.equal(result.sourceUrl, source);
  assert.equal(result.videoId, 'HIVJn4VQvwrHXVmL0LMq51');
  assert.match(result.mediaUrl, /^https:\/\/cdn\.example\.test/);
});
