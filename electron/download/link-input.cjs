const net = require('node:net');

class DownloadError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function validatePublicUrl(raw) {
  if (typeof raw !== 'string' || /[\\\s\u0000-\u001f]/u.test(raw) || /%(?![\da-f]{2})/i.test(raw)) throw new DownloadError('INVALID_URL', '视频链接格式不完整，请重新复制分享链接。');
  let url;
  try { url = new URL(raw); } catch { throw new DownloadError('INVALID_URL', '请粘贴包含完整 http 或 https 地址的视频分享内容。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new DownloadError('INVALID_URL', '只接受不含账号密码的 http 或 https 视频地址。');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('[') || /(?:^|\.)(?:localhost|local|internal|lan)$/i.test(host) || (url.port && !['80', '443'].includes(url.port))) throw new DownloadError('PRIVATE_URL', '不支持本机、内网地址或非标准端口的视频链接。');
  if (net.isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19].includes(b))) throw new DownloadError('PRIVATE_URL', '不支持本机或内网地址。');
  }
  return url.href;
}
function trimUnmatchedBrackets(raw) {
  let value = raw;
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (value.endsWith(close) && value.split(close).length > value.split(open).length) value = value.slice(0, -1);
  }
  return value;
}
function parseLinkInput(input) {
  if (typeof input !== 'string' || input.length > 20000) throw new DownloadError('INPUT_TOO_LARGE', '分享内容过长，请只粘贴一条视频的分享文案。');
  const text = input.trim().replace(/^[\u200b-\u200d\ufeff]+|[\u200b-\u200d\ufeff]+$/gu, '');
  const candidates = text.match(/https?:\/\/[^\s<>"'“”‘’\u200b-\u200d\ufeff，。；！？、（）【】《》]+/giu) || [];
  if (!candidates.length) throw new DownloadError('NO_LINK', '没有找到视频地址。请粘贴视频链接或包含链接的完整分享文案。');
  const urls = [...new Set(candidates.map(candidate => validatePublicUrl(trimUnmatchedBrackets(candidate))))];
  if (urls.length !== 1) throw new DownloadError('MULTIPLE_LINKS', '检测到多个链接，请每次下载一个。');
  return { url: urls[0], extracted: text !== urls[0] };
}
function domainMatches(host, domain) { return host === domain || host.endsWith(`.${domain}`); }
const SITE_POLICIES = [
  ['抖音', ['douyin.com'], 'douyin-browser', 'P0', 'domestic'],
  ['YouTube', ['youtube.com', 'youtu.be'], 'engine', 'P0', 'overseas'],
  ['B站', ['bilibili.com', 'b23.tv'], 'engine', 'P0', 'domestic'],
  ['小红书', ['xiaohongshu.com', 'xhslink.com'], 'engine', 'P1', 'domestic'],
  ['微博', ['weibo.com', 'weibo.cn'], 'engine', 'P1', 'domestic'],
  ['西瓜视频', ['ixigua.com'], 'engine', 'P1', 'domestic'],
  ['AcFun', ['acfun.cn'], 'engine', 'P1', 'domestic'],
  ['TikTok', ['tiktok.com'], 'engine', 'P1', 'overseas'],
  ['Vimeo', ['vimeo.com'], 'engine', 'P1', 'overseas'],
  ['Instagram', ['instagram.com'], 'engine', 'P1', 'overseas'],
  ['Facebook', ['facebook.com', 'fb.watch'], 'engine', 'P1', 'overseas'],
  ['X', ['x.com', 'twitter.com', 't.co'], 'engine', 'P1', 'overseas'],
  ['Dailymotion', ['dailymotion.com', 'dai.ly'], 'engine', 'P1', 'overseas'],
  ['Twitch', ['twitch.tv'], 'engine', 'P1', 'overseas'],
  ['快手', ['kuaishou.com', 'gifshow.com'], 'unsupported', 'P2', 'domestic'],
  ['好看视频', ['haokan.baidu.com'], 'unsupported', 'P2', 'domestic'],
  ['腾讯视频', ['v.qq.com'], 'engine', 'P2', 'domestic'],
  ['爱奇艺', ['iqiyi.com', 'iq.com'], 'engine', 'P2', 'domestic'],
  ['优酷', ['youku.com'], 'engine', 'P2', 'domestic'],
  ['芒果TV', ['mgtv.com'], 'engine', 'P2', 'domestic'],
  ['搜狐视频', ['tv.sohu.com'], 'engine', 'P2', 'domestic'],
  ['Viu', ['viu.com'], 'unsupported', 'P2', 'overseas'],
  ['Netflix', ['netflix.com'], 'unsupported', 'R', 'overseas'],
].map(([name, domains, adapter, priority, network]) => Object.freeze({ name, domains, adapter, priority, network, verification: 'pending' }));
function sitePolicy(raw) {
  const host = new URL(validatePublicUrl(raw)).hostname.toLowerCase();
  return SITE_POLICIES.find(site => site.domains.some(domain => domainMatches(host, domain))) || { name: '该网站', adapter: 'engine', priority: 'generic', network: 'unknown', verification: 'pending' };
}
module.exports = { DownloadError, parseLinkInput, validatePublicUrl, domainMatches, sitePolicy, SITE_POLICIES };
