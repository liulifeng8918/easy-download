const $ = id => document.getElementById(id);
let licenseActive = false;
let activationPending = false;
let updatePackagePath;
let currentTasks = [];
let registeredDomains = [];
let currentSearchResults = [];
let chromeSetupTicket = '';
let chromeConnected = false;

const request = (route, body) => window.easyDownload.request(route, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
const pageNames = { home: '首页', tasks: '下载任务', pro: '专业版', settings: '设置' };
const taskLabels = { queued: '等待中', running: '正在下载', verifying: '检查文件', completed: '已完成', failed: '失败' };

function feedback(id, message, type = '') {
  const node = $(id);
  if (!node) return;
  node.textContent = message;
  node.className = `feedback ${type}`;
}
function errorText(error) { return String(error.message || error).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
async function action(id, output, run) {
  const node = $(id);
  if (node) node.disabled = true;
  try { return await run(); } catch (error) { feedback(output, errorText(error), 'error'); return null; } finally { if (node) node.disabled = false; }
}

function showPage(page) {
  document.querySelectorAll('.page').forEach(node => { node.hidden = node.id !== `page-${page}`; });
  document.querySelectorAll('.nav-item').forEach(node => node.classList.toggle('active', node.dataset.page === page));
  $('pageTitle').textContent = pageNames[page] || page;
  if (page === 'pro') switchProTab(document.querySelector('.pro-tab.active')?.dataset.proTab || 'batch');
}
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => showPage(button.dataset.page)));
$('viewAllTasks').onclick = () => showPage('tasks');
$('openProBanner').onclick = () => { showPage('pro'); switchProTab('batch'); };

function showActivation() {
  if (activationPending) return;
  feedback('activationMessage', '');
  if (!$('activationDialog').open) $('activationDialog').showModal();
  $('activationCode').focus();
}
$('activate').onclick = showActivation;
$('settingsActivate').onclick = showActivation;
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => {
  if (button.dataset.close === 'activationDialog' && activationPending) return;
  $(button.dataset.close).close();
});
$('activationDialog').addEventListener('cancel', event => { if (activationPending) event.preventDefault(); });

function applyLicense(license) {
  licenseActive = Boolean(license?.active);
  $('licenseStatus').textContent = licenseActive ? '专业版已激活' : '免费版 · 查看专业版';
  $('activate').classList.toggle('active', licenseActive);
  $('sideLicenseStatus').textContent = licenseActive ? '专业版已激活' : '免费版';
  $('settingsLicenseStatus').textContent = licenseActive ? '已激活' : '未激活';
  $('settingsLicenseStatus').classList.toggle('active', licenseActive);
  const expiry = license?.entitlementExpiresAt || license?.expiresAt;
  $('settingsLicenseExpiry').textContent = expiry ? new Date(expiry).toLocaleDateString('zh-CN') : '—';
  $('proLicenseBadge').textContent = licenseActive ? 'VIP 已激活' : 'VIP 未激活';
  $('proLicenseBadge').classList.toggle('active', licenseActive);
  $('licenseDetails').textContent = licenseActive ? `当前已激活${expiry ? `，有效期至 ${new Date(expiry).toLocaleDateString('zh-CN')}` : ''}` : '';
}

$('activationForm').onsubmit = async event => {
  event.preventDefault();
  if (activationPending) return;
  const code = $('activationCode').value.trim().toUpperCase().replace(/[\s\u200b]/g, '').replace(/[–—－]/g, '-');
  if (!/^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/.test(code)) {
    feedback('activationMessage', '请完整输入 5 组、每组 5 位的激活码。', 'error');
    $('activationCode').focus();
    return;
  }
  activationPending = true;
  $('submitActivation').textContent = '正在激活…';
  $('activationCode').readOnly = true;
  await action('submitActivation', 'activationMessage', async () => {
    feedback('activationMessage', '正在连接授权服务，请稍候…');
    const result = await request('/v1/license/activate', { code });
    if (!result.license.active) throw new Error(result.license.message || '激活未完成，请稍后重试。');
    applyLicense(result.license);
    $('activationCode').value = '';
    $('activationDialog').close();
    feedback('message', '激活成功，专业版功能已解锁。', 'success');
  });
  activationPending = false;
  $('submitActivation').textContent = '确认激活';
  $('activationCode').readOnly = false;
};

function applySettings(settings) {
  const dir = settings.outputDir || '';
  $('outputDir').value = dir;
  $('batchOutputDir').value = dir;
  $('ruleDir').value = dir;
  $('settingsOutputDir').value = dir;
  if ($('quality')) $('quality').value = settings.quality || 'best';
  if ($('format')) $('format').value = settings.format || ($('quality')?.value === 'audio' ? 'mp3' : 'mp4');
  if ($('batchQuality')) $('batchQuality').value = settings.quality || 'best';
  if ($('batchFormat')) $('batchFormat').value = settings.format || 'mp4';
  if ($('settingsQuality')) $('settingsQuality').value = settings.quality || 'best';
  if ($('settingsFormat')) $('settingsFormat').value = settings.format || 'mp4';
  $('proxy').value = settings.proxy || '';
  $('autoProxy').checked = Boolean(settings.autoProxy);
  if ($('proxyMode')) $('proxyMode').value = settings.autoProxy ? 'auto' : settings.proxy ? 'saved' : 'direct';
  registeredDomains = Array.isArray(settings.domains) ? settings.domains : [];
  renderSearchDomains(registeredDomains);
  renderPairedDomains(registeredDomains);
  showProxySummary(settings);
}
function renderPairedDomains(domains) {
  const container = $('pairedDomains');
  if (!container) return;
  container.replaceChildren();
  if (!domains.length) {
    const empty = document.createElement('span');
    empty.className = 'muted small';
    empty.textContent = '连接后自动发现';
    container.append(empty);
    return;
  }
  domains.forEach(domain => {
    const chip = document.createElement('span');
    chip.className = 'domain-chip';
    chip.append(document.createTextNode(domain));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `删除 ${domain}`;
    remove.onclick = () => action('pairedDomains', 'pairingMessage', async () => {
      const next = registeredDomains.filter(item => item !== domain);
      const data = await request('/v1/settings', { domains: next });
      applySettings(data.settings);
      feedback('pairingMessage', `已删除 ${domain}，下次同步时不会再加入。`, 'success');
    });
    chip.append(remove);
    container.append(chip);
  });
}
async function loadState() {
  try {
    const state = await request('/v1/state');
    applySettings(state.settings);
    const runtime = state.engine?.jsRuntime?.available ? '兼容组件已就绪' : '兼容组件待更新';
    $('engineStatus').textContent = `${state.engine?.version || '下载引擎'} · ${runtime}`;
    if (state.cookieBridge?.paired) {
      chromeConnected = true;
      setChromeConnectionVisual('已同步', 'Chrome 登录状态已同步', '已发现的网站会自动加入同步范围。');
    } else if (!chromeConnected) {
      setChromeConnectionVisual('尚未连接', '需要登录时，点击下面按钮', '易下载会打开 Chrome、扩展文件夹和连接向导，扩展加载后自动完成连接。');
    }
    applyLicense(state.license);
    const translation = await request('/v1/translation/settings');
    applyTranslationSettings(translation.translation);
  } catch (error) { feedback('globalSettingsMessage', `连接失败：${errorText(error)}`, 'error'); }
}
function showProxySummary(settings) {
  if (settings.autoProxy && settings.proxy) feedback('proxyStatus', `已设置自动代理：海外网站会尝试使用 ${settings.proxy}`, 'success');
  else if (!settings.proxy) feedback('proxyStatus', '当前为直接连接。需要代理时再打开高级设置填写地址。');
  else feedback('proxyStatus', `当前使用自定义代理：${settings.proxy}`);
}
function applyTranslationSettings(settings) {
  if (!settings) return;
  $('settingsSubtitleProvider').value = settings.configured ? 'custom' : 'public';
  $('subtitleProvider').value = settings.configured ? 'custom' : 'public';
  if (settings.baseUrl) $('translationBaseUrl').value = settings.baseUrl;
  if (settings.model) $('translationModel').value = settings.model;
}

async function chooseDirectory(targets) {
  const selected = await window.easyDownload.chooseDirectory();
  if (!selected) return;
  const data = await request('/v1/settings', { outputDir: selected });
  applySettings(data.settings);
  targets?.forEach(id => { if ($(id)) $(id).value = data.settings.outputDir; });
  feedback('message', '下载目录已保存。', 'success');
}
$('chooseDir').onclick = () => action('chooseDir', 'message', () => chooseDirectory(['outputDir', 'batchOutputDir', 'ruleDir', 'settingsOutputDir']));
$('settingsChooseDir').onclick = () => action('settingsChooseDir', 'globalSettingsMessage', () => chooseDirectory(['outputDir', 'batchOutputDir', 'ruleDir', 'settingsOutputDir']));

async function saveDownloadDefaults(values = {}) {
  const settings = {
    outputDir: $('outputDir').value,
    quality: $('quality').value,
    format: $('format').value,
    ...values,
  };
  const data = await request('/v1/settings', settings);
  applySettings(data.settings);
  return data.settings;
}

if ($('quality')) $('quality').onchange = () => action('quality', 'message', async () => {
  const quality = $('quality').value;
  if (quality === 'audio') $('format').value = 'mp3';
  await saveDownloadDefaults({ quality, format: $('format').value });
});
if ($('format')) $('format').onchange = () => action('format', 'message', () => saveDownloadDefaults({ format: $('format').value }));
if ($('settingsQuality')) $('settingsQuality').onchange = () => action('settingsQuality', 'globalSettingsMessage', () => saveDownloadDefaults({ quality: $('settingsQuality').value, format: $('settingsFormat').value }));
if ($('settingsFormat')) $('settingsFormat').onchange = () => action('settingsFormat', 'globalSettingsMessage', () => saveDownloadDefaults({ quality: $('settingsQuality').value, format: $('settingsFormat').value }));
if ($('proxyMode')) $('proxyMode').onchange = () => action('proxyMode', 'message', async () => {
  const mode = $('proxyMode').value;
  if (mode === 'direct') {
    const data = await request('/v1/settings', { proxy: '', autoProxy: false });
    applySettings(data.settings);
    feedback('message', '已切换为直接连接。', 'success');
    return;
  }
  if (mode === 'auto') {
    feedback('message', '正在检测常见代理端口…');
    const detected = await request('/v1/proxy/detect');
    const data = await request('/v1/settings', { proxy: detected.proxy || $('proxy').value.trim(), autoProxy: true });
    applySettings(data.settings);
    feedback('message', detected.proxy ? `已启用自动代理：${detected.proxy}` : '已启用自动检测代理；当前未检测到可用端口。', detected.proxy ? 'success' : '');
    return;
  }
  if (!$('proxy').value.trim()) {
    showPage('settings');
    document.querySelector('.advanced-settings')?.setAttribute('open', '');
    feedback('message', '请在设置的高级代理中填写代理地址后再使用。', 'error');
    return;
  }
  const data = await request('/v1/settings', { proxy: $('proxy').value.trim(), autoProxy: false });
  applySettings(data.settings);
  feedback('message', '已使用保存的代理。', 'success');
});

$('openExtensionFromHome').onclick = () => action('openExtensionFromHome', 'message', async () => {
  showPage('settings');
  feedback('pairingMessage', '已打开连接设置，请点击“连接 Chrome”。', 'success');
});

$('downloadForm').onsubmit = async event => {
  event.preventDefault();
  const input = $('url').value;
  if (!input.trim()) { feedback('message', '请粘贴视频链接或完整分享文案。', 'error'); $('url').focus(); return; }
  await action('download', 'message', async () => {
    feedback('message', '正在识别链接并选择网站处理方式，请稍候…');
    await saveDownloadDefaults({ quality: $('quality').value, format: $('format').value });
    const result = await window.easyDownload.downloadStart({ input, quality: $('quality').value, format: $('quality').value === 'audio' ? 'mp3' : $('format').value, premium: false });
    if (result.url && result.url !== input.trim()) $('url').value = result.url;
    feedback('message', result.message || '已加入下载任务。', 'success');
    await refreshTasks();
  });
};

let proQueue = (() => {
  try { const raw = JSON.parse(localStorage.getItem('easyDownload.proQueue') || '[]'); return Array.isArray(raw) ? raw : []; } catch { return []; }
})();
function saveProQueue() { try { localStorage.setItem('easyDownload.proQueue', JSON.stringify(proQueue.slice(-100))); } catch { /* optional persistence */ } }
function requireVip() { if (!licenseActive) { showActivation(); return false; } return true; }
function switchProTab(tab) {
  const normalized = tab === 'search' ? 'batch' : tab === 'rules' ? 'subtitle' : tab;
  document.querySelectorAll('.pro-tab').forEach(button => button.classList.toggle('active', button.dataset.proTab === normalized));
  document.querySelectorAll('.pro-panel').forEach(panel => { panel.hidden = panel.id !== `pro-panel-${normalized}`; });
  if (normalized === 'batch') renderProQueuePreview();
  if (normalized === 'queue') renderProQueue();
  if (normalized === 'subtitle') renderOutputTasks();
}
document.querySelectorAll('.pro-tab').forEach(button => button.onclick = () => switchProTab(button.dataset.proTab));
$('proViewQueue').onclick = () => switchProTab('queue');
$('proQueueToOutput').onclick = () => switchProTab('subtitle');
$('openSearchPanel').onclick = () => { $('proSearchPanel').hidden = !$('proSearchPanel').hidden; if (!$('proSearchPanel').hidden) $('searchKeyword').focus(); };
$('batchInput').addEventListener('input', () => {
  const count = $('batchInput').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean).length;
  $('batchCount').textContent = count ? `已识别 ${count} 条链接` : '等待输入链接';
});
function queueSource(input, title = '') {
  const values = String(input || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const quality = $('batchQuality').value;
  const outputDir = $('batchOutputDir').value || $('outputDir').value;
  const dedupe = $('batchDedupe').checked;
  let added = 0;
  for (const value of values) {
    if (dedupe && proQueue.some(item => item.input === value)) continue;
    proQueue.push({ id: `p-${Date.now()}-${Math.random().toString(16).slice(2)}`, input: value, title: title || value, quality, format: $('batchFormat').value, outputDir, status: 'planned', addedAt: Date.now() });
    added += 1;
  }
  saveProQueue(); renderProQueuePreview(); renderProQueue();
  return added;
}
$('batchForm').onsubmit = async event => {
  event.preventDefault();
  if (!requireVip()) return;
  await action('submitBatch', 'batchMessage', async () => {
    const added = queueSource($('batchInput').value);
    if (!added) { feedback('batchMessage', '没有新增任务：可能是输入为空或链接已经在队列中。', 'error'); return; }
    $('batchInput').value = ''; $('batchCount').textContent = '等待输入链接';
    feedback('batchMessage', `已加入 ${added} 个任务。请到“队列”确认画质后开始下载。`, 'success');
  });
};
$('batchChooseDir').onclick = () => action('batchChooseDir', 'batchMessage', () => chooseDirectory(['outputDir', 'batchOutputDir', 'ruleDir', 'settingsOutputDir']));
$('batchSaveRule').onclick = () => { localStorage.setItem('easyDownload.outputRule', JSON.stringify({ quality: $('batchQuality').value, format: $('batchFormat').value, outputDir: $('batchOutputDir').value })); feedback('batchMessage', '本次下载设置已保存为默认规则。', 'success'); };
$('importBatch').onclick = () => feedback('batchMessage', '可直接把 TXT 内容粘贴到上方输入框，每行一个链接。');
$('playlistBatch').onclick = () => feedback('batchMessage', '请复制播放列表中的视频链接后粘贴到上方输入框。');
function queueStatusText(item) { return item.status === 'planned' ? '等待中' : item.status === 'submitted' ? '已提交' : item.status === 'running' ? '下载中' : item.status === 'completed' ? '已完成' : item.status === 'failed' ? '失败 · 可重试' : '等待中'; }
function renderProQueuePreview() {
  const list = $('proQueuePreview'); if (!list) return;
  $('proQueuePreviewCount').textContent = `共 ${proQueue.length} 个任务`;
  list.replaceChildren();
  if (!proQueue.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.innerHTML = '<p>队列还是空的</p><small>加入链接后会显示在这里</small>'; list.append(empty); return; }
  proQueue.slice().reverse().slice(0, 4).forEach(item => { const row = document.createElement('div'); row.className = 'queue-preview-row'; const thumb = document.createElement('div'); thumb.className = 'queue-preview-thumb'; thumb.textContent = '▶'; const body = document.createElement('div'); body.className = 'queue-preview-body'; const title = document.createElement('strong'); title.textContent = item.title || item.input; const meta = document.createElement('small'); meta.textContent = `${taskDomain(item.input)} · ${queueStatusText(item)}`; body.append(title, meta); const quality = document.createElement('span'); quality.className = 'queue-quality'; quality.textContent = item.quality === 'best' ? '最佳' : item.quality === 'audio' ? 'MP3' : `${item.quality}p`; row.append(thumb, body, quality); list.append(row); });
}
function renderProQueue() {
  const list = $('proQueueList'); if (!list) return;
  $('queuePlanCount').textContent = `${proQueue.length} 个任务`; list.replaceChildren();
  if (!proQueue.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.innerHTML = '<p>队列还是空的</p><small>返回来源步骤添加链接。</small>'; list.append(empty); return; }
  proQueue.forEach(item => {
    const row = document.createElement('div'); row.className = `pro-queue-row ${item.status === 'running' ? 'selected' : ''}`;
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = Boolean(item.selected); check.onchange = () => { item.selected = check.checked; saveProQueue(); };
    const title = document.createElement('div'); title.className = 'pro-queue-title'; const thumb = document.createElement('div'); thumb.className = 'pro-queue-thumb'; thumb.textContent = '▶'; const body = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = item.title || item.input; strong.title = item.input; const small = document.createElement('small'); small.textContent = taskDomain(item.input); body.append(strong, small); title.append(thumb, body);
    const quality = document.createElement('select'); [['best','最佳画质'],['2160','4K'],['1080','1080p'],['720','720p'],['audio','MP3']].forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = item.quality === value; quality.append(option); }); quality.disabled = !['planned','failed'].includes(item.status); quality.onchange = () => { item.quality = quality.value; saveProQueue(); };
    const format = document.createElement('select'); [['mp4','MP4'],['mkv','MKV'],['mp3','MP3']].forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; option.selected = item.format === value; format.append(option); }); format.disabled = !['planned','failed'].includes(item.status); format.onchange = () => { item.format = format.value; saveProQueue(); };
    const path = document.createElement('span'); path.className = 'queue-path'; path.textContent = item.outputDir || $('outputDir').value || '默认下载目录'; path.title = path.textContent;
    const status = document.createElement('span'); status.className = `queue-status ${item.status === 'completed' ? 'done' : item.status === 'failed' ? 'failed' : item.status === 'running' ? 'running' : ''}`; status.textContent = queueStatusText(item);
    const operation = document.createElement('button'); operation.type = 'button'; operation.textContent = item.status === 'completed' ? '移除' : '删除'; operation.onclick = () => { proQueue = proQueue.filter(entry => entry.id !== item.id); saveProQueue(); renderProQueue(); renderProQueuePreview(); };
    row.append(check, title, quality, format, path, status, operation); list.append(row);
  });
}
async function submitProQueue(items) {
  if (!items.length) { feedback('queueMessage', '请先加入至少一个任务。', 'error'); return; }
  const pending = items.filter(item => ['planned','failed'].includes(item.status));
  const concurrency = Math.max(1, Math.min(5, Number($('batchConcurrency').value) || 2));
  const retries = Math.max(0, Math.min(3, Number($('batchRetry').value) || 0));
  let submitted = 0;
  async function runOne(item) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      item.status = 'running'; item.attempt = attempt + 1; renderProQueue(); saveProQueue();
      try { const result = await window.easyDownload.downloadStart({ input: item.input, quality: item.quality, format: item.quality === 'audio' ? 'mp3' : item.format, premium: true }); item.status = 'submitted'; item.taskId = result.task?.id || ''; item.error = ''; submitted += 1; return; }
      catch (error) { item.error = errorText(error); if (attempt >= retries) { item.status = 'failed'; return; } }
    }
  }
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => { while (cursor < pending.length) { const item = pending[cursor++]; await runOne(item); saveProQueue(); renderProQueue(); } });
  await Promise.all(workers);
  await refreshTasks(); renderProQueuePreview();
  feedback('queueMessage', submitted ? `已提交 ${submitted} 个任务（并发 ${concurrency}，失败最多重试 ${retries} 次），下载进度可在“下载任务”查看。` : '没有可提交的任务。', submitted ? 'success' : 'error');
}
$('proQueueStart').onclick = () => action('proQueueStart', 'queueMessage', () => { if (!requireVip()) return; return submitProQueue(proQueue); });
$('proQueueRetryFailed').onclick = () => action('proQueueRetryFailed', 'queueMessage', () => { if (!requireVip()) return; return submitProQueue(proQueue.filter(item => item.status === 'failed')); });
$('proQueueRemoveCompleted').onclick = () => { proQueue = proQueue.filter(item => item.status !== 'completed'); saveProQueue(); renderProQueue(); renderProQueuePreview(); feedback('queueMessage', '已移除已完成的规划任务。', 'success'); };
function renderSearchDomains(domains) {
  const node = $('searchDomains');
  if (!node) return;
  node.replaceChildren();
  if (!domains.length) {
    const empty = document.createElement('span');
    empty.className = 'muted small';
    empty.textContent = '还没有登记网站，请先在设置中连接浏览器并同步网站。';
    node.append(empty);
    return;
  }
  domains.forEach(domain => {
    const label = document.createElement('label');
    label.className = 'search-domain';
    const input = document.createElement('input');
    input.type = 'checkbox'; input.value = domain; input.checked = true;
    const text = document.createElement('span'); text.textContent = domain;
    label.append(input, text); node.append(label);
  });
}
function selectedSearchDomains() { return [...document.querySelectorAll('#searchDomains input[type="checkbox"]:checked')].map(node => node.value); }
function renderSearchResults(results, warnings = []) {
  const node = $('searchResults'); node.replaceChildren();
  currentSearchResults = results || [];
  if (warnings.length) {
    const note = document.createElement('div'); note.className = 'search-warning'; note.textContent = warnings.join('；'); node.append(note);
  }
  if (!currentSearchResults.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.innerHTML = '<p>没有找到可下载结果</p><small>请换关键词，或确认登记网站的公开内容可以被搜索引擎收录。</small>'; node.append(empty); return;
  }
  currentSearchResults.forEach((result, index) => {
    const row = document.createElement('label'); row.className = 'search-result';
    const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.resultIndex = String(index);
    const body = document.createElement('span'); body.className = 'search-result-body';
    const title = document.createElement('strong'); title.textContent = result.title || '未命名视频';
    const mode = result.searchMode === 'site-api' ? '站内搜索' : result.searchMode === 'web-index' ? '网页索引' : '搜索结果';
    const meta = document.createElement('small'); meta.textContent = `${result.site || result.domain || '已登记网站'} · ${mode} · ${result.url || ''}`;
    const snippet = document.createElement('em'); snippet.textContent = result.snippet || '';
    body.append(title, meta, snippet); row.append(check, body); node.append(row);
  });
}
$('searchSubmit').onclick = () => action('searchSubmit', 'searchMessage', async () => {
  if (!requireVip()) return;
  const keyword = $('searchKeyword').value.trim();
  const domains = selectedSearchDomains();
  if (!keyword) { feedback('searchMessage', '请输入搜索关键词。', 'error'); return; }
  if (!domains.length) { feedback('searchMessage', '请至少选择一个已登记网站。', 'error'); return; }
  feedback('searchMessage', '正在搜索已登记网站…');
  const result = await request('/v1/search', { keyword, domains });
  renderSearchResults(result.results, result.warnings || []);
  feedback('searchMessage', `已返回 ${result.results?.length || 0} 条结果。`, 'success');
});
$('searchSelectAll').onclick = () => document.querySelectorAll('#searchResults input[data-result-index]').forEach(input => { input.checked = true; });
$('searchClearSelection').onclick = () => document.querySelectorAll('#searchResults input[data-result-index]').forEach(input => { input.checked = false; });
$('searchDownloadSelected').onclick = () => action('searchDownloadSelected', 'searchMessage', async () => {
  if (!requireVip()) return;
  const selected = [...document.querySelectorAll('#searchResults input[data-result-index]:checked')].map(input => currentSearchResults[Number(input.dataset.resultIndex)]).filter(Boolean);
  if (!selected.length) { feedback('searchMessage', '请先勾选要下载的结果。', 'error'); return; }
  let added = 0; for (const result of selected) added += queueSource(result.url, result.title || '搜索结果');
  feedback('searchMessage', `已将 ${added} 个结果加入下载队列，请切换到“队列”确认。`, 'success');
  switchProTab('queue');
});
$('subtitleStart').onclick = () => action('subtitleStart', 'subtitleMessage', async () => {
  if (!requireVip()) return;
  const selected = [...document.querySelectorAll('#outputTaskList input[data-task-id]:checked')].map(input => currentTasks.find(task => task.id === input.dataset.taskId)).filter(Boolean);
  if (!selected.length) { feedback('subtitleMessage', '请先勾选要整理的已完成视频。', 'error'); return; }
  const translate = $('outputTranslate').checked; const merge = document.querySelector('input[name="outputTrack"]:checked')?.value === 'merge';
  const organizeTasks = () => selected.map(task => ({ outputPath: task.output_path, outputDir: task.output_dir || $('outputDir').value, title: taskTitle(task), url: task.url }));
  if (!translate) {
    const result = await request('/v1/output/organize', { tasks: organizeTasks(), naming: $('outputNaming').value, category: $('outputCategory').value });
    localStorage.setItem('easyDownload.outputRule', JSON.stringify({ naming: $('outputNaming').value, category: $('outputCategory').value, translate: false, merge }));
    feedback('subtitleMessage', `${result.message || `已整理 ${selected.length} 个文件`}。字幕翻译未开启。`, 'success');
    await refreshTasks(); renderOutputTasks(); return;
  }
  feedback('subtitleMessage', '正在提取、翻译字幕并整理文件，请稍候…');
  let done = 0; const errors = [];
  for (const task of selected) { try { await request('/v1/subtitles/process', { task: { url: task.url, output_path: task.output_path, output_dir: task.output_dir }, targetLanguage: $('outputLanguage').value, provider: 'public', merge }); done += 1; } catch (error) { errors.push(`${taskTitle(task)}：${errorText(error)}`); } }
  let organized = 0;
  if (!errors.length) { try { const result = await request('/v1/output/organize', { tasks: organizeTasks(), naming: $('outputNaming').value, category: $('outputCategory').value }); organized = result.moved?.length || 0; } catch (error) { errors.push(`文件整理：${errorText(error)}`); } }
  feedback('subtitleMessage', errors.length ? `已处理 ${done} 个，整理 ${organized} 个，${errors.length} 个失败：${errors[0]}` : `已处理 ${done} 个文件，整理 ${organized} 个，字幕已保存${merge ? '并封装为独立字幕轨道' : ''}。`, errors.length ? 'error' : 'success');
  await refreshTasks(); renderOutputTasks();
});
$('outputSaveRule').onclick = () => { localStorage.setItem('easyDownload.outputRule', JSON.stringify({ naming: $('outputNaming').value, category: $('outputCategory').value, translate: $('outputTranslate').checked, language: $('outputLanguage').value, merge: document.querySelector('input[name="outputTrack"]:checked')?.value === 'merge' })); feedback('subtitleMessage', '整理输出规则已保存为默认规则。', 'success'); };
$('outputOpenFolder').onclick = () => action('outputOpenFolder', 'subtitleMessage', async () => { const folder = $('outputDir').value || $('batchOutputDir').value; if (!folder) { feedback('subtitleMessage', '请先设置下载目录。', 'error'); return; } await window.easyDownload.openFolder(folder); feedback('subtitleMessage', '已打开下载目录。', 'success'); });
$('saveRule').onclick = () => { if (!requireVip()) return; feedback('ruleMessage', '项目规则已合并到整理输出页面，请在那里保存默认规则。', 'success'); };

function renderOutputTasks() {
  const list = $('outputTaskList'); if (!list) return;
  const completed = currentTasks.filter(task => task.status === 'completed' && task.output_path);
  $('outputCompletedCount').textContent = `已完成 ${completed.length} 个任务`;
  list.replaceChildren();
  if (!completed.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.innerHTML = '<p>还没有完成的视频</p><small>完成下载后可在这里统一处理。</small>'; list.append(empty); return; }
  completed.slice().reverse().forEach(task => { const row = document.createElement('label'); row.className = 'output-task-row'; const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.taskId = task.id; check.checked = true; const thumb = document.createElement('span'); thumb.className = 'output-task-thumb'; thumb.textContent = '▶'; const info = document.createElement('span'); info.className = 'output-task-info'; const title = document.createElement('strong'); title.textContent = taskTitle(task); const meta = document.createElement('small'); meta.textContent = `${taskDomain(task.url)} · ${String(task.output_path).split(/[\\/]/).pop()}`; info.append(title, meta); const status = document.createElement('span'); status.className = 'badge'; status.textContent = '已完成'; row.append(check, thumb, info, status); list.append(row); });
}

function taskTitle(task) { return task.source_title || task.title || task.url || '未命名视频'; }
function taskDomain(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return '—'; } }
function taskProgress(task) {
  const match = String(task.progress || '').match(/(\d+(?:\.\d+)?)%/);
  if (match) return Math.max(0, Math.min(100, Number(match[1])));
  return task.status === 'completed' ? 100 : 0;
}
function taskDetail(task) {
  if (task.error) return task.error;
  if (task.status === 'completed') { const filename = String(task.output_path || '').split(/[\\/]/).pop(); return filename ? `已保存：${filename}` : '下载完成，文件已保存。'; }
  if (task.status === 'verifying') return task.progress || '正在检查完整视频与音频…';
  if (task.status === 'queued') return '已加入队列，准备下载…';
  return task.progress || '正在处理…';
}
function renderCompactTasks(tasks) {
  const container = $('homeTasks');
  container.replaceChildren();
  if (!tasks.length) { const empty = document.createElement('div'); empty.className = 'empty'; empty.innerHTML = '<p>还没有下载任务</p><small>从上方粘贴一个链接开始</small>'; container.append(empty); return; }
  tasks.slice().reverse().slice(0, 4).forEach(task => {
    const row = document.createElement('div'); row.className = `compact-task ${task.status === 'failed' ? 'failed' : ''}`;
    const status = document.createElement('strong'); status.textContent = taskLabels[task.status] || '处理中';
    const title = document.createElement('span'); title.textContent = taskTitle(task);
    const detail = document.createElement('small'); detail.textContent = taskDetail(task);
    const operation = document.createElement('span'); operation.className = 'compact-task-action';
    if (task.status === 'completed' && task.output_dir) {
      const open = document.createElement('button'); open.type = 'button'; open.textContent = '打开文件夹'; open.onclick = () => window.easyDownload.openFolder(task.output_dir).catch(error => feedback('message', errorText(error), 'error')); operation.append(open);
    }
    row.append(status, title, detail, operation); container.append(row);
  });
}
function renderTaskTable(tasks) {
  const table = $('taskTable');
  table.replaceChildren();
  $('taskEmpty').hidden = tasks.length > 0;
  tasks.slice().reverse().forEach(task => {
    const row = document.createElement('div');
    row.className = `task-row ${task.status === 'failed' ? 'failed' : ''}`;
    const title = document.createElement('span'); title.className = 'title'; title.textContent = taskTitle(task); title.title = task.url;
    const domain = document.createElement('span'); domain.textContent = taskDomain(task.url);
    const status = document.createElement('span'); status.className = 'status'; status.textContent = task.status === 'failed' ? '可重试' : (taskLabels[task.status] || '处理中');
    const progress = document.createElement('div'); progress.className = 'progress-wrap'; const bar = document.createElement('span'); bar.className = 'progress-bar'; const fill = document.createElement('i'); fill.style.width = `${taskProgress(task)}%`; bar.append(fill); const percent = document.createElement('small'); percent.textContent = `${taskProgress(task)}%`; progress.append(bar, percent);
    const operation = document.createElement('div');
    if (task.status === 'failed') { const retry = document.createElement('button'); retry.textContent = '重试'; retry.onclick = () => retryTask(task); operation.append(retry); }
    else if (task.status === 'completed') { const open = document.createElement('button'); open.textContent = '打开文件夹'; open.onclick = () => window.easyDownload.openFolder(task.output_dir || $('outputDir').value).catch(error => feedback('globalSettingsMessage', errorText(error), 'error')); operation.append(open); }
    else { const pause = document.createElement('button'); pause.textContent = '暂停'; pause.disabled = true; operation.append(pause); }
    row.append(title, domain, status, progress, operation);
    const detail = document.createElement('small'); detail.className = 'detail'; detail.textContent = taskDetail(task); row.append(detail);
    table.append(row);
  });
}
function renderSubtitleFiles(tasks) {
  const node = $('subtitleFile'); if (!node) return;
  const previous = node.value;
  node.replaceChildren();
  const completed = tasks.filter(task => task.status === 'completed' && task.output_path);
  if (!completed.length) { const option = document.createElement('option'); option.value = ''; option.textContent = '请先完成一个视频下载'; node.append(option); return; }
  completed.slice().reverse().forEach(task => { const option = document.createElement('option'); option.value = task.id; option.textContent = taskTitle(task); node.append(option); });
  if (completed.some(task => task.id === previous)) node.value = previous;
}
async function retryTask(task) {
  await action(`retry-${task.id}`, 'globalSettingsMessage', async () => {
    feedback('globalSettingsMessage', '正在重新提交任务…');
    await window.easyDownload.downloadStart({ input: task.url, quality: task.quality || 'best', format: task.output_format || 'mp4', premium: Boolean(task.premium) });
    await refreshTasks();
  });
}
async function refreshTasks() {
  try {
    const { tasks } = await window.easyDownload.downloadTasks();
    currentTasks = tasks || [];
    proQueue.forEach(item => {
      const task = currentTasks.find(entry => entry.id === item.taskId || entry.url === item.input || entry.source_url === item.input);
      if (!task) return;
      item.status = task.status === 'failed' ? 'failed' : task.status === 'completed' ? 'completed' : task.status === 'running' || task.status === 'verifying' ? 'running' : 'submitted';
      item.error = task.error || '';
    });
    saveProQueue();
    const active = currentTasks.filter(task => ['queued', 'running', 'verifying'].includes(task.status)).length;
    $('homeTaskStatus').textContent = `${active} 个运行中`;
    $('statRunning').textContent = currentTasks.filter(task => ['running', 'verifying'].includes(task.status)).length;
    $('statQueued').textContent = currentTasks.filter(task => task.status === 'queued').length;
    $('statCompleted').textContent = currentTasks.filter(task => task.status === 'completed').length;
    $('statFailed').textContent = currentTasks.filter(task => task.status === 'failed').length;
    renderCompactTasks(currentTasks);
    renderTaskTable(currentTasks);
    renderSubtitleFiles(currentTasks);
    renderProQueuePreview();
    renderProQueue();
    renderOutputTasks();
  } catch { $('homeTaskStatus').textContent = '连接中断'; }
}
$('clearTasks').onclick = () => action('clearTasks', 'globalSettingsMessage', async () => { const result = await window.easyDownload.clearDownloadHistory(); feedback('globalSettingsMessage', result.removed ? `已清空 ${result.removed} 条下载记录，下载文件仍保留。` : '没有可清空的下载记录。'); await refreshTasks(); });
$('pauseAll').onclick = () => feedback('globalSettingsMessage', '暂停全部将在任务队列接口接入后启用。');
$('resumeAll').onclick = () => feedback('globalSettingsMessage', '继续全部将在任务队列接口接入后启用。');

$('detectProxy').onclick = () => action('detectProxy', 'proxyStatus', async () => { feedback('proxyStatus', '正在检查本机常用代理端口…'); const data = await request('/v1/proxy/detect'); if (!data.proxy) { feedback('proxyStatus', '没有检测到常见本机代理，可以先使用直接连接。', 'error'); return; } const saved = await request('/v1/settings', { proxy: data.proxy, autoProxy: true }); applySettings(saved.settings); feedback('proxyStatus', `已检测到代理 ${data.proxy}，设置已保存。`, 'success'); });
$('directProxy').onclick = () => action('directProxy', 'proxyStatus', async () => { const saved = await request('/v1/settings', { proxy: '', autoProxy: false }); applySettings(saved.settings); feedback('proxyStatus', '已切换为直接连接，设置已保存。', 'success'); });
$('saveSettings').onclick = () => action('saveSettings', 'settingsMessage', async () => { const data = await request('/v1/settings', { proxy: $('proxy').value.trim(), autoProxy: $('autoProxy').checked }); applySettings(data.settings); showProxySummary(data.settings); feedback('settingsMessage', '网络设置已保存。', 'success'); });
$('saveTranslationSettings').onclick = () => action('saveTranslationSettings', 'translationSettingsMessage', async () => { const data = await request('/v1/translation/settings', { baseUrl: $('translationBaseUrl').value.trim(), model: $('translationModel').value.trim(), apiKey: $('translationApiKey').value.trim() }); applyTranslationSettings(data.translation); $('translationApiKey').value = ''; feedback('translationSettingsMessage', data.translation.configured ? '自定义翻译服务已保存。' : '已恢复使用免费公共翻译。', 'success'); });
$('clearTranslationSettings').onclick = () => action('clearTranslationSettings', 'translationSettingsMessage', async () => { const data = await request('/v1/translation/settings', { clear: true }); applyTranslationSettings(data.translation); $('translationBaseUrl').value = ''; $('translationModel').value = ''; $('translationApiKey').value = ''; feedback('translationSettingsMessage', '已清除自定义服务，恢复使用免费公共翻译。', 'success'); });
function setChromeConnectionVisual(badge, title, hint) {
  if ($('cookieStatus')) $('cookieStatus').textContent = badge;
  if ($('connectionStatusText')) $('connectionStatusText').textContent = title;
  if ($('connectionStatusHint')) $('connectionStatusHint').textContent = hint;
}
async function monitorChromePairing(ticket) {
  for (let attempt = 0; attempt < 600 && chromeSetupTicket === ticket; attempt += 1) {
    try {
      const status = await window.easyDownload.browserSetupStatus(ticket);
      if (status.paired) {
        chromeConnected = true;
        setChromeConnectionVisual('已连接', 'Chrome 已连接，正在同步登录状态', '已完成自动配对；请回到下载任务重试刚才的视频。');
        feedback('pairingMessage', 'Chrome 已连接，不需要复制连接码。', 'success');
        await loadState();
        return;
      }
      if (status.expired) {
        setChromeConnectionVisual('已过期', '连接向导已过期', '请重新点击“连接 Chrome”开始一次新的连接。');
        feedback('pairingMessage', '连接已过期，请重新点击“连接 Chrome”。', 'error');
        return;
      }
    } catch (_) { /* the main process may still be starting the bridge */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
async function startChromeConnection(actionId = 'connectChrome') {
  return action(actionId, 'pairingMessage', async () => {
  const result = await window.easyDownload.connectChrome();
  chromeSetupTicket = result.ticket;
  chromeConnected = false;
  setChromeConnectionVisual('等待连接', '请在 Chrome 中加载已解压扩展', '易下载已打开扩展页、连接向导和扩展文件夹；加载完成后会自动连接。');
  feedback('pairingMessage', result.chromeFound ? '已打开 Chrome 和扩展文件夹，请按连接向导操作。' : '没有找到 Chrome，已打开连接向导，请手动打开 Chrome 后继续。');
  void monitorChromePairing(result.ticket);
  });
}
$('connectChrome').onclick = () => startChromeConnection();
if ($('connectChrome')) {
  document.querySelector('.chrome-guide')?.setAttribute('hidden', 'hidden');
  const manualButton = $('openManualPdf');
  const advancedConnection = document.querySelector('.browser-connect-section .advanced-settings');
  if (manualButton && advancedConnection) advancedConnection.append(manualButton);
  const resync = document.createElement('button');
  resync.id = 'resyncChrome';
  resync.type = 'button';
  resync.className = 'text';
  resync.textContent = '重新同步';
  resync.title = '重新打开连接向导并同步浏览器登录状态';
  $('connectChrome').parentElement?.append(resync);
  resync.onclick = () => startChromeConnection('resyncChrome');
}
$('copyPairing').onclick = () => action('copyPairing', 'pairingMessage', async () => { const data = await request('/v1/pairing'); await navigator.clipboard.writeText(data.bridgeToken); feedback('pairingMessage', '连接码已复制，请粘贴到浏览器扩展设置页。', 'success'); });
$('openExtension').onclick = () => action('openExtension', 'pairingMessage', async () => { await window.easyDownload.openExtension(); feedback('pairingMessage', '扩展文件夹已打开，请在 Chrome 中选择“加载已解压的扩展程序”。'); });
$('openManualPdf').onclick = () => action('openManualPdf', 'pairingMessage', async () => { await window.easyDownload.openManual(); feedback('pairingMessage', '已打开 PDF 用户手册。', 'success'); });
$('checkUpdate').onclick = () => action('checkUpdate', 'updateMessage', async () => { feedback('updateMessage', '正在检查更新…'); const { update } = await request('/v1/update/check'); if (!update.available) { feedback('updateMessage', update.configured ? '当前已是最新版本。' : '更新服务暂未就绪，请联系发行方获取新版本。'); return; } feedback('updateMessage', `发现 ${update.manifest.version}，正在下载并校验…`); const result = await request('/v1/update/download', {}); updatePackagePath = result.package.path; $('openUpdate').hidden = false; feedback('updateMessage', '更新包校验完成，可以运行安装。', 'success'); });
$('openUpdate').onclick = () => action('openUpdate', 'updateMessage', async () => { await window.easyDownload.openUpdate(updatePackagePath); });

window.easyDownload.onDownloadProgress(event => { if (event.message) feedback('message', event.message); refreshTasks(); });
window.easyDownload.onBrowserLink(event => {
  const url = String(event?.url || '').trim();
  if (!url) return;
  showPage('home');
  $('url').value = url;
  feedback('message', '已从浏览器收到视频链接，请确认画质和格式后点击“开始下载”。', 'success');
  $('url').focus();
});
window.easyDownload.onBrowserPaired(() => {
  if (chromeSetupTicket) {
    chromeConnected = true;
    setChromeConnectionVisual('已连接', 'Chrome 已连接，正在同步登录状态', '已完成自动配对；请回到下载任务重试刚才的视频。');
    feedback('pairingMessage', 'Chrome 已连接，不需要复制连接码。', 'success');
  }
});
loadState();
refreshTasks();
setInterval(refreshTasks, 2500);
