// 易下载浏览器下载 - 直接下载当前页面或发送到主程序。
// 登录态同步默认由易下载连接向导触发；手动设置仍作为备用入口保留。

const COOKIE_ENDPOINT = "http://127.0.0.1:17893/cookies";
const DOWNLOAD_ENDPOINT = "http://127.0.0.1:17894/v1/browser/submit";
const KNOWN_PLATFORM_DOMAINS = [
  "douyin.com", "youtube.com", "youtu.be", "bilibili.com", "xiaohongshu.com",
  "weibo.com", "ixigua.com", "tiktok.com", "instagram.com", "facebook.com",
  "x.com", "twitter.com"
];

async function getDomains() {
  const { domains } = await chrome.storage.local.get("domains");
  return Array.isArray(domains) ? domains : [];
}

async function getBridgeToken() {
  const { bridgeToken } = await chrome.storage.local.get("bridgeToken");
  return typeof bridgeToken === "string" ? bridgeToken.trim() : "";
}

function hostMatches(host, domain) { return host === domain || host.endsWith(`.${domain}`); }

async function supportedUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const configured = await getDomains();
    return [...new Set([...KNOWN_PLATFORM_DOMAINS, ...configured])].some(domain => hostMatches(host, domain));
  } catch (_) { return false; }
}

async function getDeclaredDomains() {
  const domains = await getDomains();
  return domains.map(d => String(d).trim().toLowerCase()).filter(Boolean);
}

async function discoverKnownDomains() {
  const { domains, ignoredDomains } = await chrome.storage.local.get(["domains", "ignoredDomains"]);
  const current = Array.isArray(domains) ? domains.map(d => String(d).trim().toLowerCase()).filter(Boolean) : [];
  const ignored = new Set(Array.isArray(ignoredDomains) ? ignoredDomains.map(d => String(d).trim().toLowerCase()).filter(Boolean) : []);
  const discovered = new Set(current);
  for (const domain of KNOWN_PLATFORM_DOMAINS) {
    if (ignored.has(domain)) continue;
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      if (cookies.length) discovered.add(domain);
    } catch (_) { /* optional host permission may not have been granted */ }
  }
  const next = [...discovered];
  if (next.length !== current.length || next.some((domain, index) => domain !== current[index])) await chrome.storage.local.set({ domains: next });
  return next;
}

function toNetscape(cookie) {
  const safe = value => String(value ?? "").replace(/[\t\r\n]/g, " ");
  const domain = cookie.domain || "";
  return [domain, domain.startsWith(".") ? "TRUE" : "FALSE", cookie.path || "/", cookie.secure ? "TRUE" : "FALSE", cookie.session || !cookie.expirationDate ? 0 : Math.floor(cookie.expirationDate), safe(cookie.name), safe(cookie.value)].join("\t");
}

async function collectCookies() {
  const domains = await getDomains();
  const seen = new Set();
  const lines = ["# Netscape HTTP Cookie File", "# synchronized by EasyDownload browser connection"];
  for (const domain of domains) {
    try {
      const cookies = await chrome.cookies.getAll({ domain });
      for (const cookie of cookies) {
        const key = `${cookie.domain}|${cookie.path}|${cookie.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(toNetscape(cookie));
      }
    } catch (_) { /* ignore a single-domain failure */ }
  }
  return lines.join("\n");
}

async function pushCookies() {
  try {
    const bridgeToken = await getBridgeToken();
    if (!bridgeToken) { await chrome.storage.local.set({ lastStatus: "not-paired" }); return; }
    const domains = await getDeclaredDomains();
    if (!domains.length) { await chrome.storage.local.set({ lastPush: Date.now(), lastStatus: "domains-required", lastCount: 0 }); return; }
    const body = await collectCookies();
    const response = await fetch(COOKIE_ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain", "X-Easy-Download-Bridge": bridgeToken, "X-Easy-Download-Domains": domains.join(",") }, body });
    const responseBody = response.ok ? null : await response.clone().json().catch(() => ({}));
    await chrome.storage.local.set({ lastPush: Date.now(), lastStatus: response.ok ? "ok" : (responseBody?.code || `http-${response.status}`), lastCount: body.split("\n").length - 2 });
  } catch (_) { await chrome.storage.local.set({ lastPush: Date.now(), lastStatus: "tool-offline" }); }
}

async function submitUrl(url, mode = "direct", title = "") {
  if (!await supportedUrl(url)) throw new Error("暂不支持此网站，请在易下载中粘贴具体的视频播放页链接。");
  const bridgeToken = await getBridgeToken();
  if (!bridgeToken) throw new Error("请先在易下载设置中点击“连接 Chrome”。");
  try {
    const response = await fetch(DOWNLOAD_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", "X-Easy-Download-Bridge": bridgeToken }, body: JSON.stringify({ url, mode, title }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || "浏览器下载失败，请回到易下载查看提示。");
    return data;
  } catch (error) {
    if (error?.message && !/Failed to fetch/i.test(error.message)) throw error;
    throw new Error("请先打开易下载，再重试浏览器下载入口。");
  }
}

async function notify(message) {
  try { await chrome.notifications.create({ type: "basic", iconUrl: "icon48.png", title: "易下载", message }); } catch (_) {}
}

async function currentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function createMenus() {
  await chrome.contextMenus.removeAll();
  const domains = [...new Set([...KNOWN_PLATFORM_DOMAINS, ...(await getDomains())])];
  const patterns = domains.flatMap(domain => [`*://${domain}/*`, `*://*.${domain}/*`]);
  chrome.contextMenus.create({ id: "easy-download-page", title: "下载此视频", contexts: ["page"], documentUrlPatterns: patterns });
  chrome.contextMenus.create({ id: "easy-download-link", title: "下载此视频", contexts: ["link"], targetUrlPatterns: patterns });
}

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  const url = info.linkUrl || info.pageUrl || tab?.url || "";
  try { await notify((await submitUrl(url, "direct", tab?.title || "")).message || "已加入易下载下载任务。"); }
  catch (error) { await notify(error.message); }
});

async function reloadSetupTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ["http://127.0.0.1:17894/browser-setup*"] });
    await Promise.all(tabs.filter(tab => Number.isInteger(tab.id)).map(tab => chrome.tabs.reload(tab.id)));
  } catch (_) { /* Chrome may not have a setup tab */ }
}

async function bootstrapFromTicket(ticket) {
  const response = await fetch("http://127.0.0.1:17894/v1/browser/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket: String(ticket || "") }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.bridgeToken) throw new Error(data.message || "连接向导已过期，请回到易下载重新连接。");
  await chrome.storage.local.set({ bridgeToken: data.bridgeToken, lastStatus: "paired" });
  await createMenus();
  await discoverKnownDomains();
  await pushCookies();
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(() => { createMenus(); discoverKnownDomains(); reloadSetupTabs(); });
chrome.runtime.onStartup.addListener(() => { createMenus(); discoverKnownDomains(); reloadSetupTabs(); });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "setup-ticket") {
    bootstrapFromTicket(message.ticket)
      .then(data => sendResponse(data))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "submit-url") {
    submitUrl(String(message.url || ""), message.mode === "preview" ? "preview" : "direct", String(message.title || ""))
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "current-tab") {
    currentTab().then(async tab => sendResponse({ ok: true, url: tab?.url || "", title: tab?.title || "", supported: await supportedUrl(tab?.url || "") }));
    return true;
  }
  if (message?.type === "save-settings") {
    (async () => {
      const nextDomains = Array.isArray(message.domains) ? message.domains.map(d => String(d).trim().toLowerCase()).filter(Boolean) : [];
      const { domains: previousDomains, ignoredDomains } = await chrome.storage.local.get(["domains", "ignoredDomains"]);
      const previous = Array.isArray(previousDomains) ? previousDomains.map(d => String(d).trim().toLowerCase()).filter(Boolean) : [];
      const ignored = new Set(Array.isArray(ignoredDomains) ? ignoredDomains.map(d => String(d).trim().toLowerCase()).filter(Boolean) : []);
      for (const domain of KNOWN_PLATFORM_DOMAINS) {
        if (previous.includes(domain) && !nextDomains.includes(domain)) ignored.add(domain);
        if (nextDomains.includes(domain)) ignored.delete(domain);
      }
      await chrome.storage.local.set({ domains: nextDomains, ignoredDomains: [...ignored], bridgeToken: typeof message.bridgeToken === "string" ? message.bridgeToken.trim() : "" });
      await createMenus();
      sendResponse({ ok: true });
    })().catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === "discover-now") {
    discoverKnownDomains().then(domains => sendResponse({ ok: true, domains })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "push-now") {
    pushCookies().then(() => sendResponse({ ok: true })).catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
