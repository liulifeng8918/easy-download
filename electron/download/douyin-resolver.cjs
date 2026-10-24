const { DownloadError, domainMatches, validatePublicUrl } = require('./link-input.cjs');

function isDouyinNavigation(raw) {
  try {
    const url = new URL(validatePublicUrl(raw));
    return domainMatches(url.hostname, 'douyin.com') || (url.hostname === 'www.iesdouyin.com' && /^\/share\/video\/\d+\//.test(url.pathname));
  } catch { return false; }
}
function pageVideoId(raw) {
  try { const url = new URL(raw); return url.pathname.match(/^\/video\/(\d+)/)?.[1] || url.searchParams.get('modal_id'); } catch { return null; }
}
function selectDouyinMedia(state, expectedId) {
  if (!state || !isDouyinNavigation(state.pageUrl)) return null;
  const pageId = pageVideoId(state.pageUrl);
  if (!pageId || (expectedId && pageId !== expectedId)) return null;
  for (const video of state.videos || []) {
    if (!video.active || !(video.duration > 0) || !Number.isFinite(video.duration)) continue;
    let url;
    try { url = new URL(validatePublicUrl(video.src)); } catch { continue; }
    if (!domainMatches(url.hostname, 'douyinvod.com') && !(domainMatches(url.hostname, 'douyin.com') && url.pathname === '/aweme/v1/play/')) continue;
    // Prefer proof carried by the actual media URL; never accept a recommendation.
    const mediaId = url.searchParams.get('__vid');
    if (mediaId && mediaId !== pageId) continue;
    if (!mediaId && (state.videos || []).filter(v => v.active && v.src).length !== 1) continue;
    return { mediaUrl: url.href, sourceUrl: state.pageUrl, videoId: pageId, title: String(state.title || '抖音视频').slice(0, 180), duration: video.duration, width: video.width || 0, height: video.height || 0 };
  }
  return null;
}
function collectObservation() {
  const body = (document.body?.innerText || '').slice(0, 10000);
  return {
    pageUrl: location.href,
    title: document.title,
    challenge: /请完成.{0,8}验证|安全验证|拖动.{0,8}滑块|点击.{0,8}验证/.test(body),
    loginRequired: /请先登录.{0,12}(?:观看|查看)|登录后(?:才能|可)(?:观看|查看)/.test(body),
    unavailable: /视频已删除|视频不存在|作品不存在|该视频暂时无法播放/.test(body),
    encrypted: [...document.querySelectorAll('video')].some(video => Boolean(video.mediaKeys)),
    videos: [...document.querySelectorAll('video')].map(video => {
      const rect = video.getBoundingClientRect();
      const style = getComputedStyle(video);
      return { src: video.currentSrc || video.src, duration: video.duration, width: video.videoWidth, height: video.videoHeight, active: rect.width > 60 && rect.height > 60 && rect.bottom > 0 && rect.top < innerHeight && style.display !== 'none' && style.visibility !== 'hidden' };
    }),
  };
}
class DouyinResolver {
  constructor({ BrowserWindow, session, parent, progress, diagnostic, timeoutMs = 45000 }) {
    Object.assign(this, { BrowserWindow, session, parent, progress, diagnostic, timeoutMs });
    this.windows = new Set();
    this.tail = Promise.resolve();
    this.disposed = false;
  }
  resolve(url, settings = {}) {
    const next = this.tail.then(async () => {
      try {
        const result = await this._resolve(url, settings);
        return { ...result, viaProxy: Boolean(settings.proxy && !settings.autoProxy) };
      } catch (error) {
        // Automatic proxy mode first tries the normal path. If the embedded
        // page cannot connect and a detected proxy exists, retry once through
        // that proxy. An explicit direct-connection choice never retries.
        if (error?.code === 'NETWORK_FAILED' && settings.autoProxy && settings.proxy) {
          this.progress?.({ stage: 'proxy-retry', message: '页面直连失败，正在使用已检测到的代理重试…' });
          const result = await this._resolve(url, { ...settings, autoProxy: false });
          return { ...result, viaProxy: true };
        }
        throw error;
      }
    });
    this.tail = next.catch(() => {});
    return next;
  }
  async _resolve(url, settings) {
    if (this.disposed) throw new DownloadError('CANCELLED', '本次解析已取消。');
    if (!isDouyinNavigation(url)) throw new DownloadError('INVALID_URL', '这不是抖音视频链接。');
    const browserSession = this.session.fromPartition('persist:easy-download-douyin-v1');
    // Do not import the user's Chrome session; only this app's site session is used.
    browserSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      try { validatePublicUrl(details.url); callback({ cancel: false }); } catch { callback({ cancel: true }); }
    });
    await browserSession.setProxy(settings.proxy && !settings.autoProxy ? { mode: 'fixed_servers', proxyRules: settings.proxy } : { mode: 'direct' });
    const window = new this.BrowserWindow({
      width: 1120, height: 820, show: false, parent: this.parent?.() || undefined,
      title: '易下载 · 网站验证', autoHideMenuBar: true,
      webPreferences: { session: browserSession, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
    });
    this.windows.add(window);
    window.setMenu(null);
    window.webContents.setAudioMuted(true);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const eventName of ['will-navigate', 'will-redirect']) window.webContents.on(eventName, (event, target) => {
      const allowed = isDouyinNavigation(target);
      this.diagnostic?.({ kind: eventName, allowed, host: (() => { try { return new URL(target).hostname; } catch { return ''; } })() });
      if (!allowed) event.preventDefault();
    });
    let cancelled = false, verificationShown = false, loadError;
    let deadline = Date.now() + this.timeoutMs;
    window.on('closed', () => { cancelled = true; this.windows.delete(window); });
    window.loadURL(url).catch(error => { loadError = error; this.diagnostic?.({ kind: 'load-failed', code: error.code, errno: error.errno }); });
    try {
      let expectedId = pageVideoId(url);
      while (Date.now() < deadline && !cancelled && !this.disposed) {
        if (window.webContents.isLoadingMainFrame()) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        let state;
        try {
          state = await Promise.race([
            window.webContents.executeJavaScript(`(${collectObservation.toString()})()`),
            new Promise(resolve => { const timer = setTimeout(() => resolve(null), 1500); timer.unref?.(); }),
          ]);
        } catch { /* a redirect may replace the document */ }
        if (state) {
          expectedId ||= pageVideoId(state.pageUrl);
          if (state.encrypted) throw new DownloadError('DRM_PROTECTED', '这个视频使用加密保护，易下载不提供下载。');
          if (state.unavailable) throw new DownloadError('VIDEO_UNAVAILABLE', '这个视频已删除、不可见或当前无法播放。');
          const media = selectDouyinMedia(state, expectedId);
          if (media) {
            // Douyin checks the request context for short-lived media URLs.
            // Preserve the page URL and browser UA for the download worker.
            return {
              ...media,
              referer: state.pageUrl,
              userAgent: window.webContents.getUserAgent(),
            };
          }
          if ((state.challenge || state.loginRequired) && !verificationShown) {
            verificationShown = true;
            deadline = Date.now() + 300000;
            this.progress?.({ stage: 'verification', message: '请在网站窗口完成正常验证，完成后会自动继续。' });
            window.show();
            window.focus();
          }
        }
        if (loadError && !state) throw new DownloadError('NETWORK_FAILED', '抖音页面无法连接，请检查网络后重试。');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (cancelled || this.disposed) throw new DownloadError('CANCELLED', '你已取消本次网站验证或解析。');
      throw new DownloadError('RESOLVE_TIMEOUT', verificationShown ? '网站验证未完成，本次任务已停止。' : '未取得这个视频的可用媒体。网站可能限制访问或当前页面尚未适配；这不代表你没有登录。');
    } finally {
      this.windows.delete(window);
      if (!window.isDestroyed()) window.destroy();
    }
  }
  dispose() { this.disposed = true; for (const window of this.windows) if (!window.isDestroyed()) window.destroy(); this.windows.clear(); }
}
module.exports = { DouyinResolver, selectDouyinMedia, isDouyinNavigation, pageVideoId };
