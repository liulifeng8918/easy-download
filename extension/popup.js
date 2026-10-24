const urlNode = document.getElementById('url');
const messageNode = document.getElementById('message');
const unsupportedNode = document.getElementById('unsupported');
let currentUrl = '';
let supported = false;

function message(text, error = false) {
  messageNode.textContent = text;
  messageNode.className = `message${error ? ' error' : ''}`;
}

chrome.runtime.sendMessage({ type: 'current-tab' }, result => {
  currentUrl = result?.url || '';
  supported = Boolean(result?.supported);
  urlNode.textContent = result?.title || currentUrl || '当前页面不是可下载视频';
  urlNode.title = currentUrl;
  unsupportedNode.hidden = supported || !currentUrl;
  document.getElementById('direct').disabled = !supported;
  document.getElementById('send').disabled = !supported;
});

async function submit(mode) {
  if (!currentUrl || !supported) { message('当前页面暂不支持下载。', true); return; }
  message(mode === 'direct' ? '正在下载当前视频…' : '正在发送到易下载…');
  const result = await chrome.runtime.sendMessage({ type: 'submit-url', url: currentUrl, title: urlNode.textContent, mode });
  if (!result?.ok) { message(result?.error || '浏览器下载失败。', true); return; }
  message(result.data?.message || (mode === 'direct' ? '已加入下载任务。' : '已发送到易下载。'));
  if (mode === 'direct') setTimeout(() => window.close(), 700);
}

document.getElementById('direct').onclick = () => submit('direct');
document.getElementById('send').onclick = () => submit('preview');
document.getElementById('options').onclick = () => chrome.runtime.openOptionsPage();
