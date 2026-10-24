const { DownloadError, parseLinkInput, sitePolicy, validatePublicUrl, domainMatches } = require('./link-input.cjs');
function safeProgress(text) { return String(text || '').replace(/https?:\/\/[^\s]+/gi, '[媒体地址]').slice(-350); }
class DownloadController {
  constructor({ request, resolveDouyin, verifyMedia, progress }) {
    Object.assign(this, { request, resolveDouyin, verifyMedia, progress });
    this.pending = new Map(); this.sources = new Map(); this.keys = new Map(); this.verifications = new Map();
  }
  async licenseGuard() {
    let { license } = await this.request('/v1/license/status');
    if (license?.needsValidation) ({ license } = await this.request('/v1/license/validate', { method: 'POST', body: '{}' }));
    if (!license?.active) throw new DownloadError(license?.errorCode || 'NOT_ACTIVATED', license?.message || '请先激活易下载。');
  }
  async start({ input, quality = 'best', format = 'mp4', premium = false } = {}) {
    const parsed = parseLinkInput(input);
    if (!['best', '1080', '720', 'audio'].includes(quality)) throw new DownloadError('INVALID_QUALITY', '请选择有效画质。');
    if (!['mp4', 'mkv', 'mp3'].includes(format)) throw new DownloadError('INVALID_FORMAT', '请选择有效输出格式。');
    if (quality === 'audio') format = 'mp3';
    if (premium) await this.licenseGuard();
    const { settings } = await this.request('/v1/settings');
    const key = JSON.stringify([parsed.url, quality, format, settings.outputDir, Boolean(premium)]);
    if (this.pending.has(key)) return this.pending.get(key);
    if (this.keys.has(key)) return { url: parsed.url, task: { id: this.keys.get(key), url: parsed.url }, message: '该视频已在下载，未重复创建任务。' };
    const pending = this._start(parsed, quality, format, settings, key, Boolean(premium));
    this.pending.set(key, pending);
    try { return await pending; } finally { this.pending.delete(key); }
  }
  async startBatch({ input, quality = 'best', format = 'mp4' } = {}) {
    await this.licenseGuard();
    const values = String(input || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (values.length < 2) throw new DownloadError('BATCH_REQUIRES_MULTIPLE', '批量下载至少需要两条链接，每行一条。');
    if (values.length > 50) throw new DownloadError('BATCH_TOO_LARGE', '一次最多添加 50 条链接。');
    const results = [];
    for (const value of values) results.push(await this.start({ input: value, quality, format, premium: true }));
    return { count: results.length, results, message: `已提交 ${results.length} 个批量下载任务。` };
  }
  async _start(parsed, quality, format, settings, key, premium = false) {
    const policy = sitePolicy(parsed.url);
    if (policy.adapter === 'unsupported') throw new DownloadError('SITE_NOT_READY', policy.name === 'Netflix' ? '这个平台的正片不在易下载支持范围内，请使用网站官方离线观看功能。' : `${policy.name}的当前路线还未完成适配验证，暂不能下载；添加域名或反复登录不会解决。`);
    this.progress?.({ url: parsed.url, stage: 'resolving', message: `${parsed.extracted ? '已识别分享链接。' : ''}正在解析${policy.name}视频…` });
    let resolved, mediaUrl = parsed.url;
    if (policy.adapter === 'douyin-browser') {
      resolved = await this.resolveDouyin(parsed.url, settings);
      mediaUrl = validatePublicUrl(resolved.mediaUrl);
      const host = new URL(mediaUrl).hostname;
      if (!domainMatches(host, 'douyinvod.com') && !(domainMatches(host, 'douyin.com') && new URL(mediaUrl).pathname === '/aweme/v1/play/')) throw new DownloadError('MEDIA_TARGET_INVALID', '解析得到的媒体来源不符合该网站策略。');
      if (['720', '1080'].includes(quality) && resolved.height > Number(quality)) throw new DownloadError('FORMAT_UNAVAILABLE', `当前取得的源画质为 ${resolved.height}p，未取得你选择范围内的画质，请改选最佳画质。`);
    } else {
      const { check } = await this.request('/v1/links/check', { method: 'POST', body: JSON.stringify({ url: parsed.url, quality, format, premium }) });
      if (!check?.ready) {
        const message = check?.code === 'LOGIN_REQUIRED'
          ? `${policy.name}要求先登录或同步登录状态。请确认浏览器中能正常播放，再按设置中的连接浏览器提示操作。`
          : check?.code === 'PROXY_REQUIRED'
            ? `${policy.name}当前网络不可达。请点击设置中的“自动检测代理”后重试。`
            : check?.code === 'UNSUPPORTED_URL'
              ? `${policy.name}当前链接类型暂未通过支持验证，请复制具体视频播放页链接。`
              : check?.message || '这个视频暂时无法解析。';
        throw new DownloadError(check?.code || 'RESOLVE_FAILED', message);
      }
    }
    // The existing backend re-checks the real license before creating any task.
    const browserProxy = resolved?.viaProxy && settings.proxy
      ? { proxy: settings.proxy, autoProxy: false }
      : { proxy: '', autoProxy: true };
    const result = await this.request('/v1/downloads', { method: 'POST', body: JSON.stringify({ url: mediaUrl, sourceUrl: parsed.url, sourceTitle: resolved?.title, sourceId: resolved?.videoId, referer: resolved?.referer, userAgent: resolved?.userAgent, quality, format, premium, ...browserProxy }) });
    if (!result.task?.id) throw new DownloadError('TASK_CREATE_FAILED', '下载任务未创建，请重试。');
    this.sources.set(result.task.id, { url: parsed.url, resolved, key });
    this.keys.set(key, result.task.id);
    return { url: parsed.url, task: { ...result.task, url: parsed.url }, message: resolved ? `已取得目标视频，正在下载${resolved.height ? `（当前可用 ${resolved.height}p）` : ''}。` : '已加入下载任务。' };
  }
  async listTasks() {
    const response = await this.request('/v1/downloads');
    const tasks = await Promise.all((response.tasks || []).map(async original => {
      const source = this.sources.get(original.id);
      const browserProgress = source?.resolved ? (String(original.progress || '').match(/\[download\]\s+\d+(?:\.\d+)?%[^\r\n]*/)?.[0] || (original.status === 'running' ? '正在下载目标视频…' : '')) : original.progress;
      const task = { ...original, url: source?.url || original.url, progress: safeProgress(browserProgress), error: safeProgress(original.error) || null };
      if (original.status === 'completed') {
        if (!this.verifications.has(original.id)) {
          const job = { result: null };
          this.verifications.set(original.id, job);
          Promise.resolve().then(() => this.verifyMedia(original, source?.resolved || {}))
            .catch(() => ({ ok: false, message: '媒体核验失败，未标记为下载完成。' }))
            .then(result => { job.result = result; });
        }
        const verification = this.verifications.get(original.id).result;
        if (!verification) { task.status = 'verifying'; task.progress = '文件已下载，正在检查完整视频与音频…'; }
        else if (!verification.ok) { task.status = 'failed'; task.error = verification.message; }
        else task.media = { duration: verification.duration };
      }
      if (['completed', 'failed'].includes(task.status) && source) this.keys.delete(source.key);
      return task;
    }));
    return { ...response, tasks };
  }
  async clearHistory() {
    const response = await this.request('/v1/downloads/clear-history', { method: 'POST', body: '{}' });
    const { tasks } = await this.request('/v1/downloads');
    const liveIds = new Set(tasks.map(task => task.id));
    for (const [id, source] of this.sources) if (!liveIds.has(id)) { this.keys.delete(source.key); this.sources.delete(id); this.verifications.delete(id); }
    return response;
  }
}
module.exports = { DownloadController, safeProgress };
