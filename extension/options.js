async function render() {
  const data = await chrome.storage.local.get(["domains", "bridgeToken", "lastPush", "lastStatus", "lastCount"]);
  const domains = Array.isArray(data.domains) ? data.domains : [];
  document.getElementById("domains").value = domains.join("\n");
  document.getElementById("bridgeToken").value = data.bridgeToken || "";
  const el = document.getElementById("status");
  if (!data.lastPush) {
    el.textContent = "尚未同步过。";
  } else {
    const ago = Math.round((Date.now() - data.lastPush) / 1000);
    const map = {
      ok: "同步成功",
      "tool-offline": "易下载工具未运行（打开工具后会自动恢复）",
      "domains-required": "请先保留至少一个需要同步登录状态的网站",
      "COOKIE_DOMAINS_REQUIRED": "请填写需要同步登录状态的网站后再保存",
      "COOKIE_DOMAIN_NOT_ALLOWED": "发现的网站不在同步列表中，请检查网站列表",
      "LEGACY_BRIDGE_UPDATE_REQUIRED": "浏览器连接版本过旧，请重新加载当前版本扩展"
    };
    const s = map[data.lastStatus] || data.lastStatus;
    el.textContent = `上次同步：${ago} 秒前 | 状态：${s}`;
  }
  const summary = document.getElementById("connectionSummary");
  if (summary) {
    summary.textContent = data.bridgeToken
      ? "已连接易下载。需要同步时，扩展会自动发现已登记平台并推送登录状态。"
      : "请回到易下载设置，点击“连接 Chrome”。扩展加载后会自动完成连接，不需要复制连接码。";
  }
}

const KNOWN_PLATFORM_DOMAINS = [
  "douyin.com", "youtube.com", "bilibili.com", "xiaohongshu.com",
  "weibo.com", "ixigua.com", "tiktok.com", "instagram.com",
  "facebook.com", "x.com", "twitter.com"
];

function platformOrigins(domains) {
  return [...new Set(domains.map((domain) => String(domain).trim().toLowerCase()).filter(Boolean))]
    .flatMap((domain) => [`*://${domain}/*`, `*://*.${domain}/*`]);
}

document.getElementById("save").addEventListener("click", async () => {
  const lines = document.getElementById("domains").value
    .split("\n").map(s => s.trim()).filter(Boolean);
  const bridgeToken = document.getElementById("bridgeToken").value.trim();
  // The first explicit save is also the discovery action. Request only the
  // registered platform hosts; never request all-site access.
  const origins = platformOrigins([...KNOWN_PLATFORM_DOMAINS, ...lines]);
  if (origins.length) {
    const granted = await chrome.permissions.request({ origins });
    if (!granted) {
      document.getElementById("msg").textContent = "未获得平台网站权限，未保存；如需同步，请允许已登记平台的访问权限。";
      return;
    }
  }
  const saved = await chrome.runtime.sendMessage({ type: "save-settings", domains: lines, bridgeToken });
  if (!saved?.ok) {
    document.getElementById("msg").textContent = "保存失败，请重新加载扩展后再试。";
    return;
  }
  document.getElementById("msg").textContent = "正在发现已登录平台...";
  // Discover after permissions are granted, then trigger the immediate sync.
  chrome.runtime.sendMessage({ type: "discover-now" }, () => {
    chrome.runtime.sendMessage({ type: "push-now" }, () => {
      document.getElementById("msg").textContent = "已发现并保存平台列表，正在同步登录状态。";
      render();
    });
  });
  setTimeout(render, 1500);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.domains) render();
});

chrome.runtime.sendMessage({ type: "discover-now" }, () => render());
