// Only inspect the active public player. Never read cookies or page accounts.
function currentPageVideo(doc = document, address = location.href) {
  const url = new URL(address);
  if (!(url.hostname === 'douyin.com' || url.hostname.endsWith('.douyin.com'))) return { url: address };
  if (/^\/video\/\d+/.test(url.pathname) || /^\d+$/.test(url.searchParams.get('modal_id') || '')) return { url: address };
  const active = doc.querySelector('[data-e2e="feed-active-video"]');
  if (!active) return { error: '请先打开具体抖音视频，再点击下载。直播暂不支持。' };
  const id = String(active.className || '').match(/(?:^|\s)video_(\d+)(?:\s|$)/)?.[1];
  if (!id || !active.querySelector('video')) return { error: '未识别到当前视频，请复制该视频的分享链接。' };
  return { url: `https://www.douyin.com/video/${id}` };
}
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'page-video') respond(currentPageVideo());
  });
}
if (typeof module !== 'undefined') module.exports = { currentPageVideo };
