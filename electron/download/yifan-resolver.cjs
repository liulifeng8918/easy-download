const { DownloadError, domainMatches, validatePublicUrl } = require('./link-input.cjs');

const YIFAN_DOMAINS = Object.freeze(['yifan.tv', 'iyf.tv']);
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36';

function isYifanNavigation(raw) {
  try {
    const url = new URL(validatePublicUrl(raw));
    const host = url.hostname.toLowerCase();
    return YIFAN_DOMAINS.some(domain => domainMatches(host, domain))
      && (url.pathname === '/watch' || url.pathname === '/watch/');
  } catch { return false; }
}

function yifanVideoId(raw) {
  try {
    const url = new URL(validatePublicUrl(raw));
    const value = url.searchParams.get('v') || '';
    return /^[A-Za-z0-9_-]{6,160}$/.test(value) ? value : null;
  } catch { return null; }
}

function yifanUploadHost(raw) {
  const host = new URL(validatePublicUrl(raw)).hostname.toLowerCase();
  return domainMatches(host, 'iyf.tv') ? 'upload.iyf.tv' : 'upload.yifan.tv';
}

function parseMasterPlaylist(body, baseUrl) {
  if (typeof body !== 'string' || !body.trimStart().startsWith('#EXTM3U')) {
    throw new DownloadError('YIFAN_PLAYLIST_INVALID', '网站没有返回可下载的视频播放列表。');
  }
  const candidates = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let url;
    try { url = new URL(line, baseUrl); } catch { continue; }
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) continue;
    candidates.push(url.href);
  }
  if (!candidates.length) throw new DownloadError('YIFAN_PLAYLIST_EMPTY', '这个视频当前没有可用的播放流。');
  return candidates[0];
}

async function fetchText(url, { referer, timeoutMs = 20000, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new DownloadError('YIFAN_NETWORK_FAILED', '当前环境不支持访问爱壹帆解析接口。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain;q=0.8, */*;q=0.5',
        Referer: referer,
        Origin: new URL(referer).origin,
        'User-Agent': DEFAULT_USER_AGENT,
      },
    });
    if (!response.ok) throw new DownloadError('YIFAN_HTTP_ERROR', `爱壹帆解析接口返回 HTTP ${response.status}。`);
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024) throw new DownloadError('YIFAN_RESPONSE_TOO_LARGE', '爱壹帆解析响应异常，已停止处理。');
    return body;
  } catch (error) {
    if (error instanceof DownloadError) throw error;
    if (error?.name === 'AbortError') throw new DownloadError('YIFAN_NETWORK_FAILED', '爱壹帆解析超时，请检查网络后重试。');
    throw new DownloadError('YIFAN_NETWORK_FAILED', '爱壹帆解析接口暂时无法连接，请检查网络或代理后重试。');
  } finally {
    clearTimeout(timer);
  }
}

async function resolveYifan(raw, _settings = {}, options = {}) {
  const sourceUrl = validatePublicUrl(raw);
  if (!isYifanNavigation(sourceUrl)) throw new DownloadError('INVALID_URL', '请复制爱壹帆具体的视频播放页地址。');
  const videoId = yifanVideoId(sourceUrl);
  if (!videoId) throw new DownloadError('INVALID_URL', '没有识别到爱壹帆视频编号，请重新复制播放页地址。');
  const apiUrl = `https://${yifanUploadHost(sourceUrl)}/api/video/MasterPlayList?id=${encodeURIComponent(videoId)}`;
  const playlist = await fetchText(apiUrl, { referer: sourceUrl, fetchImpl: options.fetchImpl });
  const mediaUrl = parseMasterPlaylist(playlist, apiUrl);
  // validatePublicUrl also rejects local/private targets before the media URL
  // reaches the Python sidecar. The media URL is intentionally not persisted.
  validatePublicUrl(mediaUrl);
  return {
    mediaUrl,
    sourceUrl,
    videoId,
    title: '爱壹帆视频',
    referer: sourceUrl,
    userAgent: DEFAULT_USER_AGENT,
  };
}

module.exports = { YIFAN_DOMAINS, isYifanNavigation, yifanVideoId, parseMasterPlaylist, resolveYifan };
