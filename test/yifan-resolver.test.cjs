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

test('accepts iyf play pages, keeps the selected episode and rejects lookalike paths', () => {
  for (const host of ['www.iyf.tv', 'iyf.tv', 'www.yifan.tv']) {
    assert.equal(isYifanNavigation(`https://${host}/play/kNyFnqHa7LB`), true);
    assert.equal(yifanVideoId(`https://${host}/play/kNyFnqHa7LB/`), 'kNyFnqHa7LB');
    assert.equal(yifanVideoId(`https://${host}/play/series123?id=episode456`), 'episode456');
  }
  for (const url of ['https://www.iyf.tv/play/', 'https://www.iyf.tv/play/abc/extra', 'https://iyf.tv.evil.example/play/kNyFnqHa7LB']) assert.equal(isYifanNavigation(url), false);
});

test('play-page IDs use the normal website player, not the legacy preview endpoint', async () => {
  let seen;
  const url = 'https://www.iyf.tv/play/kNyFnqHa7LB';
  const result = await resolveYifan(url, {proxy:'http://127.0.0.1:7892',autoProxy:true}, {
    browserResolve: async (source, settings) => { seen={source,settings};return {mediaUrl:'https://sss111-e1.pipecdn.vip/main.m3u8',sourceUrl:source,videoId:'kNyFnqHa7LB',duration:7380,requireAudio:true}; },
    fetchImpl: async () => { throw new Error('must not treat play ID as old watch ID'); },
  });
  assert.equal(seen.source,url);assert.equal(seen.settings.autoProxy,true);assert.equal(result.videoId,'kNyFnqHa7LB');
});

test('parses a master playlist without persisting signed media urls', () => {
  const playlist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://cdn.example.test/stream/chunklist.m3u8?sig=short';
  assert.equal(parseMasterPlaylist(playlist, 'https://upload.yifan.tv/api/video/MasterPlayList?id=x'), 'https://cdn.example.test/stream/chunklist.m3u8?sig=short');
  assert.throws(() => parseMasterPlaylist('#EXTM3U\n#EXT-X-ENDLIST', 'https://upload.yifan.tv/api/video/MasterPlayList?id=x'), /播放流/);
  assert.throws(() => parseMasterPlaylist('#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.apple.streamingkeydelivery"\nhttps://cdn.example.test/stream.m3u8', 'https://upload.yifan.tv/api/video/MasterPlayList?id=x'), /加密保护/);
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
