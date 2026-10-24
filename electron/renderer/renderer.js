const $ = (id) => document.getElementById(id);

async function loadState() {
  try {
    const state = await window.easyDownload.request('/v1/state');
    $('outputDir').value = state.settings.outputDir;
    $('proxy').value = state.settings.proxy;
    $('autoProxy').checked = state.settings.autoProxy;
    $('engineStatus').textContent = state.engine.version;
    $('cookieStatus').textContent = state.cookieBridge.paired ? '已连接' : '未连接';
    if (state.license.active) {
      $('licenseStatus').textContent = '已授权';
      $('licenseStatus').className = 'status status-ok';
    } else {
      $('licenseStatus').textContent = '未激活';
      $('licenseStatus').className = 'status status-warn';
    }
    await refreshWebsites();
  } catch (error) {
    $('message').textContent = `本机引擎连接失败：${error.message}`;
    $('licenseStatus').textContent = '引擎未连接';
    $('licenseStatus').className = 'status status-error';
  }
}

$('download').addEventListener('click', async () => {
  const url = $('url').value.trim();
  if (!url) { $('message').textContent = '请先粘贴视频链接。'; return; }
  try {
    await window.easyDownload.request('/v1/settings', { method: 'PUT', body: JSON.stringify({ outputDir: $('outputDir').value, proxy: $('proxy').value.trim(), autoProxy: $('autoProxy').checked }) });
    await window.easyDownload.request('/v1/downloads', {
      method: 'POST',
      body: JSON.stringify({ url, quality: $('quality').value, outputDir: $('outputDir').value, proxy: $('proxy').value.trim(), autoProxy: $('autoProxy').checked }),
    });
    $('message').textContent = '下载任务已提交。';
    await refreshTasks();
  } catch (error) {
    $('message').textContent = error.message;
  }
});

$('activate').addEventListener('click', async () => {
  const code = window.prompt('请输入易下载激活码');
  if (!code) return;
  try {
    await window.easyDownload.request('/v1/license/activate', { method: 'POST', body: JSON.stringify({ code }) });
    $('message').textContent = '激活成功。';
    await loadState();
  } catch (error) {
    $('message').textContent = `激活失败：${error.message}`;
  }
});
$('settings').addEventListener('click', () => { $('message').textContent = '网站管理和设置将在下一阶段接入。'; });
$('checkUpdate').addEventListener('click', async () => {
  $('message').textContent = '正在检查更新…';
  try {
    const result = await window.easyDownload.request('/v1/update/check');
    const update = result.update;
    if (!update.available) {
      $('message').textContent = update.configured ? '当前已是最新版本。' : '更新源尚未配置。';
      return;
    }
    $('message').textContent = `发现新版本 ${update.manifest.version}，正在下载并校验…`;
    const downloaded = await window.easyDownload.request('/v1/update/download', { method: 'POST', body: '{}' });
    $('openUpdate').dataset.path = downloaded.package.path;
    $('openUpdate').hidden = false;
    $('message').textContent = `更新包已校验完成（${downloaded.package.sha256.slice(0, 12)}…），点击“运行已校验安装包”完成更新。`;
  } catch (error) { $('message').textContent = error.message; }
});
$('openUpdate').addEventListener('click', async () => {
  try {
    await window.easyDownload.openUpdate($('openUpdate').dataset.path);
    $('message').textContent = '安装程序已启动，请按向导完成更新。';
  } catch (error) { $('message').textContent = error.message; }
});
$('copyPairing').addEventListener('click', async () => {
  try {
    const pairing = await window.easyDownload.request('/v1/pairing');
    await navigator.clipboard.writeText(pairing.bridgeToken);
    $('pairingMessage').textContent = '连接码已复制，请粘贴到 Chrome 扩展设置页。';
  } catch (error) { $('pairingMessage').textContent = error.message; }
});
$('chooseDir').addEventListener('click', async () => {
  const selected = await window.easyDownload.chooseDirectory();
  if (!selected) return;
  $('outputDir').value = selected;
  await window.easyDownload.request('/v1/settings', { method: 'PUT', body: JSON.stringify({ outputDir: selected, proxy: $('proxy').value.trim(), autoProxy: $('autoProxy').checked }) });
  $('message').textContent = '下载目录已保存。';
});
$('clearTasks').addEventListener('click', () => { $('tasks').textContent = '已清空已完成任务。'; });

async function refreshWebsites() {
  const data = await window.easyDownload.request('/v1/websites');
  $('websites').innerHTML = data.domains.length ? data.domains.map((domain) => `<span class="website-tag">${domain}<button data-domain="${domain}" aria-label="删除 ${domain}">×</button></span>`).join('') : '<span class="hint">尚未添加网站</span>';
  $('websites').querySelectorAll('button').forEach((button) => button.addEventListener('click', async () => {
    const remaining = data.domains.filter((domain) => domain !== button.dataset.domain);
    await window.easyDownload.request('/v1/websites', { method: 'PUT', body: JSON.stringify({ domains: remaining }) });
    await refreshWebsites();
  }));
}

$('addWebsite').addEventListener('click', async () => {
  try {
    const current = await window.easyDownload.request('/v1/websites');
    const value = $('website').value.trim();
    if (!value) return;
    await window.easyDownload.request('/v1/websites', { method: 'PUT', body: JSON.stringify({ domains: [...current.domains, value] }) });
    $('website').value = '';
    await refreshWebsites();
    $('message').textContent = '网站已加入登录状态同步列表。';
  } catch (error) { $('message').textContent = error.message; }
});

async function refreshTasks() {
  try {
    const data = await window.easyDownload.request('/v1/downloads');
    $('taskStatus').textContent = `${data.tasks.filter((task) => task.status === 'running' || task.status === 'queued').length} 个运行中`;
    if (data.tasks.length) {
      $('tasks').innerHTML = data.tasks.slice().reverse().map((task) => `<div class="task"><strong>${task.status}</strong><span>${task.url}</span><small>${task.progress || task.error || ''}</small></div>`).join('');
    }
  } catch { /* 状态区保留上次结果 */ }
}

loadState();
setInterval(refreshTasks, 1000);
