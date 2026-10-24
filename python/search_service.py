from __future__ import annotations

import json
import html
import os
import re
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlencode, urlparse

SUPPORTED_SITES = {
    "douyin.com": "抖音",
    "bilibili.com": "哔哩哔哩",
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "xiaohongshu.com": "小红书",
    "xhslink.com": "小红书",
    "weibo.com": "微博",
    "weibo.cn": "微博",
    "ixigua.com": "西瓜视频",
    "tiktok.com": "TikTok",
    "instagram.com": "Instagram",
    "facebook.com": "Facebook",
    "fb.watch": "Facebook",
    "x.com": "X",
    "twitter.com": "X",
}


def normalize_domain(value: str) -> str:
    domain = str(value or "").strip().lower().rstrip(".")
    for prefix in ("https://", "http://"):
        if domain.startswith(prefix):
            domain = domain[len(prefix):]
    domain = domain.split("/", 1)[0]
    if not domain or any(ch not in "abcdefghijklmnopqrstuvwxyz0123456789.-" for ch in domain):
        raise ValueError("网站域名无效")
    return domain


def domain_matches(hostname: str, domain: str) -> bool:
    return hostname == domain or hostname.endswith("." + domain)


class RegisteredSiteSearch:
    def __init__(self, project_root: Path, ytdlp: Path, runtime: dict[str, str] | None = None) -> None:
        self.project_root = project_root
        self.ytdlp = ytdlp
        self.runtime = runtime

    def search(self, *, keyword: str, domains: list[str], proxy: str = "", auto_proxy: bool = True, limit: int = 10) -> dict:
        keyword = str(keyword or "").strip()
        if not keyword:
            raise ValueError("请输入搜索关键词")
        if len(keyword) > 120:
            raise ValueError("搜索关键词不能超过 120 个字符")
        selected = sorted({normalize_domain(item) for item in domains})
        if not selected:
            raise ValueError("请先选择至少一个已登记网站")
        results: list[dict] = []
        warnings: list[str] = []
        for domain in selected:
            site = next((name for known, name in SUPPORTED_SITES.items() if domain_matches(domain, known)), None)
            if site == "YouTube":
                results.extend(self._youtube(keyword, domain, proxy=proxy, auto_proxy=auto_proxy, limit=limit))
            elif site == "哔哩哔哩":
                bilibili_results, bilibili_warning = self._bilibili(keyword, domain, proxy=proxy, auto_proxy=auto_proxy, limit=limit)
                results.extend(bilibili_results)
                if bilibili_warning:
                    warnings.append(bilibili_warning)
            else:
                index_results, index_warning = self._web_index(keyword, domain, site or domain, proxy=proxy, auto_proxy=auto_proxy, limit=limit)
                results.extend(index_results)
                if index_warning:
                    warnings.append(index_warning)
        return {"results": results[: max(1, min(limit * max(1, len(selected)), 50))], "warnings": warnings, "provider": "内置站内搜索 + 登记网站网页索引"}

    def _bilibili(self, keyword: str, domain: str, *, proxy: str, auto_proxy: bool, limit: int) -> tuple[list[dict], str | None]:
        query = urlencode({"search_type": "video", "keyword": keyword, "page_size": str(max(1, min(limit, 20)))})
        endpoint = "https://api.bilibili.com/x/web-interface/search/type?" + query
        handlers = []
        if proxy and not auto_proxy:
            handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
        opener = urllib.request.build_opener(*handlers)
        request = urllib.request.Request(endpoint, headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/"})
        try:
            with opener.open(request, timeout=20) as response:
                payload = json.loads(response.read(2_000_000).decode("utf-8", "replace"))
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
            return [], f"{domain} 的站内搜索暂时无法访问，请稍后重试。"
        if int(payload.get("code", -1)) != 0:
            return [], f"{domain} 的站内搜索返回错误，请稍后重试。"
        results = []
        for entry in (payload.get("data") or {}).get("result") or []:
            target = str(entry.get("arcurl") or "").strip()
            if not target:
                bvid = str(entry.get("bvid") or "").strip()
                target = f"https://www.bilibili.com/video/{bvid}" if bvid else ""
            parsed = urlparse(target)
            if parsed.scheme not in {"http", "https"} or not domain_matches((parsed.hostname or "").lower(), "bilibili.com"):
                continue
            title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(entry.get("title") or "")))).strip() or "哔哩哔哩视频"
            snippet = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(entry.get("description") or "")))).strip()
            results.append({"title": title, "url": target, "site": "哔哩哔哩", "domain": domain, "snippet": snippet or "来自哔哩哔哩站内搜索", "searchMode": "site-api"})
            if len(results) >= max(1, min(limit, 20)):
                break
        return results, None if results else f"{domain} 的站内搜索没有返回可下载视频。"

    def _web_index(self, keyword: str, domain: str, site: str, *, proxy: str, auto_proxy: bool, limit: int) -> tuple[list[dict], str | None]:
        """Search public indexed pages, then enforce the requested hostname.

        Most platforms do not expose a keyless public search API.  The index
        fallback is deliberately conservative: it returns only links whose
        final URL is on the registered domain, and labels them as web-index
        results so the downloader can perform a second media verification.
        """
        query = f"site:{domain} {keyword}"
        endpoint = "https://www.so.com/s?q=" + quote(query, safe="")
        handlers = []
        # 360 is normally reachable directly from mainland networks.  Respect
        # an explicitly forced proxy, but do not force an overseas proxy for the
        # index host itself when auto detection is enabled.
        use_proxy = bool(proxy) and not auto_proxy
        if use_proxy:
            handlers.append(urllib.request.ProxyHandler({"http": proxy, "https": proxy}))
        opener = urllib.request.build_opener(*handlers)
        request = urllib.request.Request(endpoint, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
        })
        try:
            with opener.open(request, timeout=20) as response:
                document = response.read(2_500_000).decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, OSError):
            return [], f"{domain} 的网页索引暂时无法访问，请稍后重试或检查网络。"

        blocks = re.findall(r'<li[^>]*class=["\'][^"\']*res-list[^"\']*["\'][^>]*>.*?</li>', document, re.IGNORECASE | re.DOTALL)
        results: list[dict] = []
        seen: set[str] = set()
        for block in blocks:
            title_match = re.search(r'<h3[^>]*class=["\'][^"\']*res-title[^"\']*["\'][^>]*>.*?<a[^>]*data-mdurl=["\']([^"\']+)["\'][^>]*>(.*?)</a>', block, re.IGNORECASE | re.DOTALL)
            if not title_match:
                continue
            target = html.unescape(title_match.group(1)).strip()
            parsed = urlparse(target)
            hostname = (parsed.hostname or "").lower().rstrip(".")
            if parsed.scheme not in {"http", "https"} or not domain_matches(hostname, domain) or target in seen:
                continue
            seen.add(target)
            title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", title_match.group(2)))).strip() or f"{site} 网页结果"
            description_match = re.search(r'<p[^>]*class=["\'][^"\']*res-desc[^"\']*["\'][^>]*>(.*?)</p>', block, re.IGNORECASE | re.DOTALL)
            snippet = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", description_match.group(1)))).strip() if description_match else ""
            results.append({"title": title, "url": target, "site": site, "domain": domain, "snippet": snippet or "来自登记网站的公开网页索引", "searchMode": "web-index"})
            if len(results) >= max(1, min(limit, 20)):
                break
        if not results:
            return [], f"{domain} 已登记，但网页索引没有返回可验证的公开页面；登录后内容可能不会出现在公共索引中。"
        return results, None

    def _youtube(self, keyword: str, domain: str, *, proxy: str, auto_proxy: bool, limit: int) -> list[dict]:
        if not self.ytdlp.is_file():
            raise RuntimeError("缺少下载引擎，暂时无法搜索 YouTube")
        host = urlparse(f"https://{domain}").hostname or domain
        overseas = host == "youtube.com" or host.endswith(".youtube.com") or host in {"youtu.be", "www.youtube.com"}
        use_proxy = bool(proxy) and (not auto_proxy or overseas)
        command = [str(self.ytdlp), "--ignore-config", "--flat-playlist", "--dump-single-json", "--playlist-end", str(max(1, min(limit, 20))), f"ytsearch{max(1, min(limit, 20))}:{keyword}"]
        environment = os.environ.copy()
        if use_proxy:
            command[1:1] = ["--proxy", proxy]
            environment["http_proxy"] = proxy
            environment["https_proxy"] = proxy
        if self.runtime:
            command[1:1] = ["--js-runtimes", self.runtime["name"]]
            environment["PATH"] = str(Path(self.runtime["path"]).parent) + os.pathsep + environment.get("PATH", "")
        result = subprocess.run(command, cwd=self.project_root, env=environment, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if result.returncode != 0:
            raise RuntimeError("YouTube 搜索暂时失败，请确认代理可用后重试")
        payload = None
        for line in reversed((result.stdout or "").splitlines()):
            try:
                candidate = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(candidate, dict):
                payload = candidate
                break
        entries = (payload or {}).get("entries") or []
        output = []
        for entry in entries:
            video_id = str(entry.get("id") or "").strip()
            if not video_id:
                continue
            url = str(entry.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}")
            parsed = urlparse(url)
            if not domain_matches((parsed.hostname or "").lower(), "youtube.com") and (parsed.hostname or "").lower() not in {"youtu.be", "www.youtube.com"}:
                continue
            output.append({"title": str(entry.get("title") or "YouTube 视频"), "url": url, "site": "YouTube", "domain": domain, "snippet": "来自已登记的 YouTube 站内搜索"})
        return output
