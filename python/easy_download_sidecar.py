from __future__ import annotations

import argparse
import json
import os
import secrets
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from download_engine import DownloadManager
from cookie_store import CookieStore
from license_service import LicenseService
from search_service import RegisteredSiteSearch
from translation_service import MyMemoryTranslator, OpenAICompatibleTranslator, TranslationProviderError, parse_subtitle, render_srt
from update_service import UpdateService
from vendor.life_license.client import LicenseError
from vendor.life_license.storage import DpapiStorage, StorageError


MAX_BODY_BYTES = 512 * 1024
DEFAULT_PROXY = "http://127.0.0.1:7892"
PROXY_SCHEMES = frozenset({"http", "https", "socks4", "socks5", "socks5h"})
COMMON_PROXY_PORTS = (7890, 7891, 7892, 1080, 10808, 10809, 8080)
QUALITY_VALUES = frozenset({"best", "2160", "1080", "720", "audio"})
FORMAT_VALUES = frozenset({"mp4", "mkv", "mp3"})


def normalize_proxy(value: Any, *, allow_empty: bool = True) -> str:
    """Normalize saved proxy input before it reaches yt-dlp.

    Older UI code could serialize an absent input as the literal string
    ``undefined``. Treat that legacy value as the documented local default;
    reject all other malformed non-empty values instead of letting yt-dlp
    resolve them as a hostname such as ``undefined:80``.
    """
    raw = str(value or "").strip()
    if raw.lower() in {"undefined", "null"}:
        return DEFAULT_PROXY
    if not raw:
        return "" if allow_empty else DEFAULT_PROXY
    try:
        parsed = urlparse(raw)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as exc:
        raise ValueError("代理地址无效，请填写 http://127.0.0.1:7892 这类地址，或留空直连") from exc
    if parsed.scheme.lower() not in PROXY_SCHEMES or not hostname or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise ValueError("代理地址无效，请填写 http://127.0.0.1:7892 这类地址，或留空直连")
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("代理端口无效")
    return raw


def normalize_domain(value: str) -> str:
    domain = value.strip().lower().rstrip(".")
    if domain.startswith("https://"):
        domain = domain[8:]
    elif domain.startswith("http://"):
        domain = domain[7:]
    domain = domain.split("/", 1)[0]
    if not domain or any(ch not in "abcdefghijklmnopqrstuvwxyz0123456789.-" for ch in domain):
        raise ValueError("invalid domain")
    if domain.startswith(".") or domain.endswith(".") or ".." in domain:
        raise ValueError("invalid domain")
    return domain


def valid_netscape_cookie_text(body: str) -> bool:
    lines = body.splitlines()
    if len(body.encode("utf-8")) > MAX_BODY_BYTES or not lines or not lines[0].startswith("# Netscape HTTP Cookie File"):
        return False
    return all(len(line.split("\t")) == 7 for line in lines[2:] if line.strip() and not line.startswith("#"))


def cookie_domains(body: str) -> set[str]:
    return {line.split("\t", 1)[0].lstrip(".").lower() for line in body.splitlines()[2:] if line.strip() and not line.startswith("#") and "\t" in line}


def domain_allowed(domain: str, allowed: list[str]) -> bool:
    return any(domain == item or domain.endswith("." + item) for item in allowed)


def declared_cookie_domains(raw: str) -> list[str]:
    """Normalize the explicit domain list sent by the browser bridge."""
    values = [item.strip() for item in raw.split(",") if item.strip()]
    if not values or len(values) > 50:
        raise ValueError("请先在“连接浏览器”中保存需要同步的网站")
    return sorted(set(normalize_domain(item) for item in values))


def detect_local_proxies() -> list[str]:
    found: list[str] = []
    for port in COMMON_PROXY_PORTS:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.15):
                found.append(f"http://127.0.0.1:{port}")
        except OSError:
            continue
    return found


class SidecarState:
    def __init__(self, token: str, project_root: Path) -> None:
        self.token = token
        default_dir = Path(os.environ.get("USERPROFILE") or Path.home()) / "Videos" / "EasyDownload"
        self.settings_path = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "EasyDownload" / "settings.json"
        self.settings = self._load_settings(default_dir)
        self.output_dir = str(self.settings["outputDir"])
        self.license = LicenseService(project_root / "config" / "license.public.json")
        self.version = json.loads((project_root / "package.json").read_text(encoding="utf-8"))["version"]
        self.updates = UpdateService(project_root / "config" / "update.public.json", current_version=self.version)
        self.cookie_store = CookieStore()
        self.bridge_token = self._load_bridge_token()
        self.cookie_paired = False
        self.downloads = DownloadManager(project_root, self.cookie_store)
        self.translation = MyMemoryTranslator()
        self.search = RegisteredSiteSearch(project_root, self.downloads.ytdlp, self.downloads.js_runtime())
        self.translation_storage = DpapiStorage("EasyDownload", "translation-provider.dat")

    def translation_config(self) -> dict[str, str | bool]:
        try:
            raw = self.translation_storage.read()
            values = json.loads(raw) if raw else {}
            if not isinstance(values, dict):
                values = {}
        except (StorageError, json.JSONDecodeError):
            values = {}
        return {
            "configured": bool(values.get("baseUrl") and values.get("model") and values.get("apiKey")),
            "baseUrl": str(values.get("baseUrl", "")),
            "model": str(values.get("model", "")),
        }

    def save_translation_config(self, values: dict[str, Any]) -> dict[str, str | bool]:
        if bool(values.get("clear")):
            self.translation_storage.clear()
            return self.translation_config()
        base_url = str(values.get("baseUrl", "")).strip().rstrip("/")
        model = str(values.get("model", "")).strip()
        api_key = str(values.get("apiKey", "")).strip()
        if not base_url and not model and not api_key:
            self.translation_storage.clear()
            return self.translation_config()
        if not api_key:
            try:
                existing = json.loads(self.translation_storage.read() or "{}")
                if isinstance(existing, dict):
                    api_key = str(existing.get("apiKey", ""))
            except (StorageError, json.JSONDecodeError):
                pass
        parsed = urlparse(base_url)
        if parsed.scheme != "https" or not parsed.netloc or len(model) > 120 or len(api_key) > 512:
            raise ValueError("自定义翻译服务配置无效，请填写 HTTPS 地址、模型名和 API Key")
        self.translation_storage.write(json.dumps({"baseUrl": base_url, "model": model, "apiKey": api_key}, ensure_ascii=False))
        return self.translation_config()

    def _load_bridge_token(self) -> str:
        token_storage = DpapiStorage("EasyDownload", "bridge-token.dat")
        try:
            existing = token_storage.read()
            if existing and len(existing) >= 32:
                return existing
        except StorageError:
            pass
        token = secrets.token_urlsafe(32)
        token_storage.write(token)
        return token

    def _load_settings(self, default_dir: Path) -> dict[str, Any]:
        try:
            loaded = json.loads(self.settings_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and isinstance(loaded.get("outputDir"), str):
                domains = loaded.get("domains", [])
                try:
                    proxy = normalize_proxy(loaded.get("proxy", DEFAULT_PROXY), allow_empty=True)
                except ValueError:
                    proxy = DEFAULT_PROXY
                quality = str(loaded.get("quality", "best"))
                output_format = str(loaded.get("format", "mp4"))
                return {
                    "outputDir": loaded["outputDir"],
                    "proxy": proxy,
                    "autoProxy": bool(loaded.get("autoProxy", True)),
                    "domains": domains if isinstance(domains, list) else [],
                    "quality": quality if quality in QUALITY_VALUES else "best",
                    "format": output_format if output_format in FORMAT_VALUES else "mp4",
                }
        except (OSError, ValueError, json.JSONDecodeError):
            pass
        return {"outputDir": str(default_dir), "proxy": DEFAULT_PROXY, "autoProxy": True, "domains": [], "quality": "best", "format": "mp4"}

    def save_settings(self, values: dict[str, Any]) -> None:
        self.settings = {
            "outputDir": str(Path(str(values.get("outputDir", self.output_dir))).expanduser().resolve()),
            "proxy": normalize_proxy(values.get("proxy", self.settings.get("proxy", "")), allow_empty=True),
            "autoProxy": bool(values.get("autoProxy", self.settings.get("autoProxy", True))),
            "domains": list(values.get("domains", self.settings.get("domains", []))),
            "quality": str(values.get("quality", self.settings.get("quality", "best"))) if str(values.get("quality", self.settings.get("quality", "best"))) in QUALITY_VALUES else "best",
            "format": str(values.get("format", self.settings.get("format", "mp4"))) if str(values.get("format", self.settings.get("format", "mp4"))) in FORMAT_VALUES else "mp4",
        }
        self.output_dir = self.settings["outputDir"]
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.settings_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.settings, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, self.settings_path)


def make_handler(state: SidecarState):
    class Handler(BaseHTTPRequestHandler):
        server_version = "EasyDownloadSidecar/0.1"

        def log_message(self, fmt: str, *args: object) -> None:
            print(fmt % args, flush=True)

        def send_json(self, status: int, payload: dict) -> None:
            raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def authorized(self) -> bool:
            return secrets.compare_digest(self.headers.get("X-Easy-Download-Session", ""), state.token)

        def do_GET(self) -> None:
            if not self.authorized():
                self.send_json(401, {"ok": False, "code": "UNAUTHORIZED", "message": "本机引擎令牌无效"})
                return
            route = urlparse(self.path).path
            if route == "/health":
                self.send_json(200, {"ok": True, "service": "easy-download-sidecar", "version": state.version})
            elif route == "/v1/state":
                self.send_json(200, {
                    "ok": True,
                    "license": state.license.status(),
                    "engine": state.downloads.engine_capabilities(),
                    "cookieBridge": {"paired": state.cookie_paired},
                    "settings": state.settings,
                })
            elif route == "/v1/license/status":
                self.send_json(200, {"ok": True, "license": state.license.status()})
            elif route == "/v1/update/check":
                self.send_json(200, {"ok": True, "update": state.updates.check()})
            elif route == "/v1/settings":
                self.send_json(200, {"ok": True, "settings": state.settings})
            elif route == "/v1/proxy/detect":
                candidates = detect_local_proxies()
                self.send_json(200, {"ok": True, "candidates": candidates, "proxy": candidates[0] if candidates else ""})
            elif route == "/v1/pairing":
                self.send_json(200, {"ok": True, "bridgeToken": state.bridge_token, "paired": state.cookie_paired})
            elif route == "/v1/translation/settings":
                self.send_json(200, {"ok": True, "translation": state.translation_config()})
            elif route == "/v1/websites":
                self.send_json(200, {"ok": True, "domains": state.settings.get("domains", [])})
            elif route == "/v1/downloads":
                self.send_json(200, {"ok": True, "tasks": state.downloads.list_tasks()})
            else:
                self.send_json(404, {"ok": False, "code": "NOT_FOUND", "message": "接口不存在"})

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        if route == "/cookies":
            if not secrets.compare_digest(self.headers.get("X-Easy-Download-Bridge", ""), state.bridge_token):
                self.send_json(401, {"ok": False, "code": "BRIDGE_UNAUTHORIZED", "message": "浏览器桥接令牌无效"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self.send_json(400, {"ok": False, "code": "INVALID_CONTENT_LENGTH", "message": "请求长度无效"})
                return
            if length <= 0 or length > MAX_BODY_BYTES:
                self.send_json(413, {"ok": False, "code": "COOKIE_BODY_TOO_LARGE", "message": "Cookie 内容过大"})
                return
            try:
                body = self.rfile.read(length).decode("utf-8", errors="strict")
            except UnicodeDecodeError:
                self.send_json(400, {"ok": False, "code": "COOKIE_ENCODING_INVALID", "message": "Cookie 内容编码无效"})
                return
            if not valid_netscape_cookie_text(body):
                self.send_json(400, {"ok": False, "code": "COOKIE_FORMAT_INVALID", "message": "Cookie 文件格式无效"})
                return
            raw_declared_domains = self.headers.get("X-Easy-Download-Domains", "").strip()
            if not raw_declared_domains:
                self.send_json(400, {"ok": False, "code": "LEGACY_BRIDGE_UPDATE_REQUIRED", "message": "浏览器连接版本过旧，请重新加载当前版本扩展"})
                return
            try:
                allowed = declared_cookie_domains(raw_declared_domains)
            except ValueError as exc:
                self.send_json(400, {"ok": False, "code": "COOKIE_DOMAINS_REQUIRED", "message": str(exc)})
                return
            # Keep the app's registered-site pool in sync with the domains the
            # extension actually discovered. Cookie values remain encrypted
            # locally; only normalized domain names are persisted here.
            merged_domains = sorted(set(state.settings.get("domains", [])) | set(allowed))
            if merged_domains != state.settings.get("domains", []):
                state.save_settings({**state.settings, "domains": merged_domains})
            rejected = sorted(domain for domain in cookie_domains(body) if not domain_allowed(domain, allowed))
            if rejected:
                self.send_json(403, {"ok": False, "code": "COOKIE_DOMAIN_NOT_ALLOWED", "message": "Cookie 中包含未授权网站，请只保留扩展设置中已授权的域名", "rejectedDomains": rejected})
                return
            try:
                state.cookie_store.write(body)
            except RuntimeError as exc:
                self.send_json(500, {"ok": False, "code": "COOKIE_STORE_FAILED", "message": str(exc)})
                return
            state.cookie_paired = True
            self.send_json(200, {"ok": True})
            return
        if not self.authorized():
            self.send_json(401, {"ok": False, "code": "UNAUTHORIZED", "message": "本机引擎令牌无效"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"ok": False, "code": "INVALID_CONTENT_LENGTH", "message": "请求长度无效"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(413, {"ok": False, "code": "BODY_TOO_LARGE", "message": "请求内容过大"})
            return
        raw = self.rfile.read(length)
        try:
            body = json.loads(raw.decode("utf-8"))
            if not isinstance(body, dict):
                raise ValueError("请求必须为对象")
        except (UnicodeDecodeError, ValueError):
            self.send_json(400, {"ok": False, "code": "INVALID_JSON", "message": "请求格式无效"})
            return
        if route == "/v1/license/activate":
            try:
                license_status = state.license.activate(str(body.get("code", "")))
            except (LicenseError, StorageError) as exc:
                self.send_json(400, {"ok": False, "code": getattr(exc, "code", "STORAGE_ERROR"), "message": str(exc)})
                return
            self.send_json(200, {"ok": True, "license": license_status})
            return
        if route == "/v1/license/validate":
            try:
                license_status = state.license.validate()
            except LicenseError as exc:
                self.send_json(400, {"ok": False, "code": exc.code, "message": str(exc)})
                return
            self.send_json(200, {"ok": True, "license": license_status})
            return
        if route == "/v1/settings":
            try:
                state.save_settings(body)
            except (OSError, ValueError) as exc:
                self.send_json(400, {"ok": False, "code": "SETTINGS_INVALID", "message": str(exc)})
                return
            self.send_json(200, {"ok": True, "settings": state.settings})
            return
        if route == "/v1/translation/settings":
            try:
                settings = state.save_translation_config(body)
            except (OSError, ValueError, StorageError) as exc:
                self.send_json(400, {"ok": False, "code": "TRANSLATION_SETTINGS_INVALID", "message": str(exc)})
                return
            self.send_json(200, {"ok": True, "translation": settings})
            return
        if route == "/v1/websites":
            try:
                domains = [normalize_domain(str(item)) for item in body.get("domains", [])]
                if len(domains) > 50:
                    raise ValueError("网站数量过多")
                state.settings["domains"] = sorted(set(domains))
                state.save_settings(state.settings)
            except (OSError, ValueError) as exc:
                self.send_json(400, {"ok": False, "code": "WEBSITE_INVALID", "message": str(exc)})
                return
            self.send_json(200, {"ok": True, "domains": state.settings["domains"]})
            return
        if route == "/v1/update/download":
            destination = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "EasyDownload" / "updates"
            try:
                package = state.updates.download_latest(destination)
            except (OSError, ValueError) as exc:
                self.send_json(400, {"ok": False, "code": "UPDATE_DOWNLOAD_FAILED", "message": str(exc)})
                return
            self.send_json(200, {"ok": True, "package": package})
            return
        if route == "/v1/search":
            try:
                license_status = state.license.require()
            except LicenseError as exc:
                self.send_json(403, {"ok": False, "code": exc.code, "message": str(exc)})
                return
            if not license_status.get("active"):
                self.send_json(403, {"ok": False, "code": "NOT_ACTIVATED", "message": "关键词搜索需要易下载专业版，请先输入激活码"})
                return
            try:
                domains = body.get("domains") or state.settings.get("domains", [])
                result = state.search.search(keyword=str(body.get("keyword", "")), domains=domains, proxy=str(body.get("proxy", state.settings.get("proxy", ""))), auto_proxy=bool(body.get("autoProxy", state.settings.get("autoProxy", True))))
            except (OSError, ValueError, RuntimeError) as exc:
                self.send_json(400, {"ok": False, "code": "SEARCH_FAILED", "message": str(exc)})
                return
            self.send_json(200, {"ok": True, **result})
            return
        if route == "/v1/subtitles/process":
            try:
                license_status = state.license.require()
            except LicenseError as exc:
                self.send_json(403, {"ok": False, "code": exc.code, "message": str(exc)})
                return
            if not license_status.get("active"):
                self.send_json(403, {"ok": False, "code": "NOT_ACTIVATED", "message": "字幕翻译需要易下载专业版，请先输入激活码"})
                return
            provider = str(body.get("provider", "public"))
            translator = state.translation
            if provider in {"custom", "openai"}:
                try:
                    raw = state.translation_storage.read()
                    values = json.loads(raw) if raw else {}
                    translator = OpenAICompatibleTranslator(base_url=str(values.get("baseUrl", "")), model=str(values.get("model", "")), api_key=str(values.get("apiKey", "")))
                except (StorageError, json.JSONDecodeError, TypeError, ValueError) as exc:
                    self.send_json(400, {"ok": False, "code": "CUSTOM_PROVIDER_NOT_CONFIGURED", "message": "请先在设置中填写自定义翻译 API"})
                    return
            elif provider not in {"public", "mymemory"}:
                self.send_json(400, {"ok": False, "code": "TRANSLATION_PROVIDER_INVALID", "message": "翻译服务选择无效"})
                return
            task = body.get("task") if isinstance(body.get("task"), dict) else {}
            source_url = str(task.get("url", "")).strip()
            output_path = str(task.get("output_path", "")).strip()
            output_dir = str(task.get("output_dir") or state.output_dir).strip()
            target = str(body.get("targetLanguage", "zh-CN")).strip() or "zh-CN"
            if target not in {"zh-CN", "zh-TW", "en", "ja", "ko"}:
                self.send_json(400, {"ok": False, "code": "TARGET_LANGUAGE_INVALID", "message": "目标语言暂不支持"})
                return
            try:
                root = Path(state.output_dir).expanduser().resolve()
                subtitle_path = Path(output_path).expanduser().resolve() if output_path else Path()
                if subtitle_path and subtitle_path.exists() and subtitle_path.suffix.lower() in {".srt", ".vtt"}:
                    subtitle_path.relative_to(root)
                else:
                    if not source_url.startswith(("http://", "https://")):
                        raise ValueError("缺少原始视频链接，无法提取字幕")
                    subtitle_path = state.downloads.extract_subtitles(url=source_url, output_dir=output_dir, proxy=str(state.settings.get("proxy", "")), auto_proxy=bool(state.settings.get("autoProxy", True)))
                    subtitle_path = subtitle_path.resolve()
                    subtitle_path.relative_to(root)
                if subtitle_path.stat().st_size > 2 * 1024 * 1024:
                    raise ValueError("字幕文件过大，暂不支持处理")
                raw = subtitle_path.read_text(encoding="utf-8", errors="replace")
                segments = parse_subtitle(raw, "vtt" if subtitle_path.suffix.lower() == ".vtt" else "srt")
                translated = translator.translate_segments(segments, source=str(body.get("sourceLanguage") or "") or None, target=target)
                destination = subtitle_path.with_name(f"{subtitle_path.stem}.{target}.srt")
                destination.write_text(render_srt(translated["segments"]), encoding="utf-8")
                merged_path = None
                if bool(body.get("merge") or body.get("mergeSubtitles")):
                    if not output_path:
                        raise ValueError("要封装独立字幕轨道，请选择一个已下载的视频文件")
                    video_path = Path(output_path).expanduser().resolve()
                    video_path.relative_to(root)
                    merged_path = state.downloads.merge_subtitle_track(video_path=str(video_path), subtitle_path=str(destination), target_language=target)
            except TranslationProviderError as exc:
                self.send_json(400, {"ok": False, "code": exc.code, "message": str(exc)})
                return
            except (OSError, ValueError, RuntimeError) as exc:
                self.send_json(400, {"ok": False, "code": "SUBTITLE_PROCESS_FAILED", "message": str(exc)})
                return
            self.send_json(200, {"ok": True, "subtitle": {"source": str(subtitle_path), "translated": str(destination), "merged": str(merged_path) if merged_path else None, "mergeMode": "embedded-track" if merged_path else None, "provider": translated["provider"], "warnings": translated["warnings"], "requests": translated["requests"]}})
            return
        if route == "/v1/output/organize":
            try:
                license_status = state.license.require()
            except LicenseError as exc:
                self.send_json(403, {"ok": False, "code": exc.code, "message": str(exc)})
                return
            if not license_status.get("active"):
                self.send_json(403, {"ok": False, "code": "NOT_ACTIVATED", "message": "整理输出需要易下载专业版，请先输入激活码"})
                return
            entries = body.get("tasks") if isinstance(body.get("tasks"), list) else []
            if not entries or len(entries) > 100:
                self.send_json(400, {"ok": False, "code": "OUTPUT_TASKS_INVALID", "message": "请选择需要整理的已完成文件"})
                return
            try:
                moved = state.downloads.organize_outputs(entries, naming=str(body.get("naming", "date-title")), category=str(body.get("category", "site-topic")))
            except (OSError, ValueError, RuntimeError) as exc:
                self.send_json(400, {"ok": False, "code": "OUTPUT_ORGANIZE_FAILED", "message": str(exc)})
                return
            self.send_json(200, {"ok": True, "moved": moved, "message": f"已整理 {len(moved)} 个文件"})
            return
        if route in {"/v1/downloads/clear-history", "/v1/downloads/clear-completed"}:
            self.send_json(200, {"ok": True, "removed": state.downloads.clear_history()})
            return
        if route == "/v1/downloads":
            url = str(body.get("url", "")).strip()
            if not url.startswith(("http://", "https://")):
                self.send_json(400, {"ok": False, "code": "INVALID_URL", "message": "视频链接无效"})
                return
            source_url = str(body.get("sourceUrl", url)).strip()
            if not source_url.startswith(("http://", "https://")):
                self.send_json(400, {"ok": False, "code": "INVALID_SOURCE_URL", "message": "原始视频链接无效"})
                return
            premium = body.get("premium") is True
            if premium:
                try:
                    license_status = state.license.require()
                except LicenseError as exc:
                    self.send_json(403, {"ok": False, "code": exc.code, "message": str(exc)})
                    return
                if not license_status.get("active"):
                    self.send_json(403, {"ok": False, "code": "NOT_ACTIVATED", "message": "该功能需要易下载专业版，请先输入激活码"})
                    return
            try:
                task = state.downloads.create(url=source_url, engine_url=url, source_title=str(body.get("sourceTitle", "")), source_id=str(body.get("sourceId", "")), referer=str(body.get("referer") or "") or None, user_agent=str(body.get("userAgent") or "") or None, quality=str(body.get("quality", "best")), output_format=str(body.get("format", "mp4")), output_dir=str(body.get("outputDir") or state.output_dir), proxy=str(body.get("proxy", state.settings.get("proxy", ""))), auto_proxy=bool(body.get("autoProxy", state.settings.get("autoProxy", True))))
            except (OSError, ValueError) as exc:
                self.send_json(400, {"ok": False, "code": "DOWNLOAD_INVALID", "message": str(exc)})
                return
            self.send_json(202, {"ok": True, "task": task.payload(), "message": "下载任务已接收"})
            return
        if route == "/v1/links/check":
            if body.get("premium") is True:
                try:
                    license_status = state.license.require()
                except LicenseError as exc:
                    self.send_json(403, {"ok": False, "code": exc.code, "message": str(exc)})
                    return
                if not license_status.get("active"):
                    self.send_json(403, {"ok": False, "code": "NOT_ACTIVATED", "message": "该功能需要易下载专业版，请先输入激活码"})
                    return
            check = state.downloads.preflight(
                url=str(body.get("url", "")),
                quality=str(body.get("quality", "best")),
                proxy=str(body.get("proxy", state.settings.get("proxy", ""))),
                auto_proxy=bool(body.get("autoProxy", state.settings.get("autoProxy", True))),
            )
            self.send_json(200, {"ok": True, "check": check})
            return
        self.send_json(404, {"ok": False, "code": "NOT_FOUND", "message": "接口不存在"})

    def do_PUT(self) -> None:
        self.do_POST()

    # Keep the large POST handler in the factory scope so it can close over
    # the per-process state, then bind it as a normal request-handler method.
    Handler.do_POST = do_POST
    Handler.do_PUT = do_PUT
    return Handler


def main() -> int:
    parser = argparse.ArgumentParser(description="易下载 Python 本机引擎")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--token", required=True)
    parser.add_argument("--project-root", help="配置、扩展和下载引擎所在的产品目录")
    args = parser.parse_args()
    if not args.token or len(args.token) < 32:
        raise SystemExit("sidecar token is too short")
    project_root = Path(args.project_root).resolve() if args.project_root else Path(__file__).resolve().parents[1]
    state = SidecarState(args.token, project_root)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(state))
    print(json.dumps({"ok": True, "port": args.port}, ensure_ascii=False), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
