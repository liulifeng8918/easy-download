const { validatePublicUrl, domainMatches } = require('./link-input.cjs');
function logDouyinDiagnostic(event) {
  try {
    const {app}=require('electron');if(!app?.isReady())return;
    const fs=require('node:fs'),path=require('node:path');
    const file=path.join(app.getPath('userData'),'douyin-diagnostic.log');
    if(fs.existsSync(file)&&fs.statSync(file).size>1024*1024)return;
    fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...event})+'\n');
  }catch{}
}

function extractDouyinMetadata(payload) {
  const item = payload?.aweme_detail;
  const videoId = String(item?.aweme_id || '');
  const video = item?.video;
  if (payload?.status_code !== 0 || !/^\d+$/.test(videoId) || !video || video.is_drm || video.isDrm || video.drm_type) return null;
  const formats = [];
  const seen = new Set();
  let incompatible = false;
  function add(address, bitrate = 0) {
    if (!address || !Array.isArray(address.url_list)) return;
    if (/bytevc[123]|bvc[123]|h265|hevc|h266|av1/i.test(String(address.url_key || ''))) { incompatible = true; return; }
    for (const raw of address.url_list.slice(0, 4)) {
      try {
        const mediaUrl = validatePublicUrl(String(raw).startsWith('//') ? 'https:' + raw : raw);
        const url = new URL(mediaUrl);
        if (!domainMatches(url.hostname, 'douyinvod.com') || /media-(?:video|audio)-|\.mpd(?:$|\/)/i.test(url.pathname)) continue;
        if (url.searchParams.has('__vid') && url.searchParams.get('__vid') !== videoId) continue;
        if (seen.has(mediaUrl)) continue;
        seen.add(mediaUrl);
        formats.push({ mediaUrl, width: Number(address.width) || 0, height: Number(address.height) || 0, bitrate: Number(bitrate) || 0, codec:'h264' });
      } catch { /* malformed, non-public or unrelated media is not a candidate */ }
    }
  }
  // The observed public detail response offers complete MP4 alternatives even
  // when the active player uses split DASH audio/video and a blob URL.
  for (const rate of (video.bit_rate || []).slice(0, 40)) {
    if(rate?.format!=='mp4')continue;
    if([rate.is_h265,rate.is_bytevc1,rate.is_bytevc2].some(v=>Number(v||0)!==0)){incompatible=true;continue;}
    if(/h264|avc/i.test(String(rate.play_addr?.url_key||'')) || rate.is_h265===0 || rate.is_bytevc1===0) add(rate.play_addr,rate.bit_rate);
  }
  add(video.play_addr_h264);
  if(/h264|avc/i.test(String(video.play_addr?.url_key||'')) || video.is_h265===0) add(video.play_addr);
  if (!formats.length && !incompatible) return null;
  return { videoId, title: String(item.desc || '抖音视频').slice(0, 180), duration: Number(video.duration) / 1000, requireAudio: video.format === 'dash', incompatible:!formats.length, formats };
}

async function observeDouyinMetadata(webContents, onMetadata, diagnostic) {
  const debuggerApi = webContents.debugger;
  if (!debuggerApi) return () => {};
  const pending = new Set();
  let attached = false;
  async function onMessage(_event, method, params) {
    try {
      if (method === 'Network.responseReceived') {
        const url = new URL(params.response.url);
        if (domainMatches(url.hostname, 'douyin.com') && url.pathname === '/aweme/v1/web/aweme/detail/' && pending.size < 10) {
          diagnostic?.({kind:'detail-response',status:params.response.status,cached:Boolean(params.response.fromDiskCache||params.response.fromServiceWorker)});
          if(params.response.status===200)pending.add(params.requestId);
        }
      } else if (method === 'Network.loadingFailed') pending.delete(params.requestId);
      else if (method === 'Network.loadingFinished' && pending.delete(params.requestId)) {
        if (params.encodedDataLength > 2 * 1024 * 1024) return;
        const result = await debuggerApi.sendCommand('Network.getResponseBody', { requestId: params.requestId });
        const body = result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
        if (body.length > 2 * 1024 * 1024) return;
        const metadata = extractDouyinMetadata(JSON.parse(body));
        if (metadata) { onMetadata(metadata);diagnostic?.({kind:'metadata-ready',videoId:metadata.videoId,formats:metadata.formats.length}); }
      }
    } catch { diagnostic?.({kind:'metadata-unavailable'}); }
  }
  try {
    debuggerApi.attach('1.3'); attached = true;
    diagnostic?.({kind:'metadata-observer-attached'});
    debuggerApi.on('message', onMessage);
    // Never gate navigation on a renderer command: automation/devtools may
    // pause a freshly created target until its first navigation is scheduled.
    void debuggerApi.sendCommand('Network.enable', {maxResourceBufferSize: 2 * 1024 * 1024, maxTotalBufferSize: 4 * 1024 * 1024})
      .then(()=>debuggerApi.sendCommand('Network.setCacheDisabled',{cacheDisabled:true}))
      .catch(() => diagnostic?.({kind:'metadata-observer-unavailable'}));
  } catch {
    diagnostic?.({kind:'metadata-observer-unavailable'});
  }
  return () => {
    pending.clear();
    if (attached) { debuggerApi.removeListener('message', onMessage); try { debuggerApi.detach(); } catch {} }
  };
}

module.exports = { extractDouyinMetadata, observeDouyinMetadata, logDouyinDiagnostic };
