from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import uuid
from datetime import datetime
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from cookie_store import CookieStore


QUALITY_FORMATS = {
    "720": "bv*[height<=720]+ba/b[height<=720]/b",
    "1080": "bv*[height<=1080]+ba/b[height<=1080]/b",
    "best": "bv*+ba/b",
}
MEDIA_EXTENSIONS = frozenset({".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".mp3", ".m4a", ".aac", ".flac", ".wav", ".opus"})
TASK_URL_PATTERN = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
OVERSEAS_DOMAINS = ("youtube.com", "youtu.be", "tiktok.com", "vimeo.com", "instagram.com", "facebook.com", "twitter.com", "x.com")
PLATFORM_NAMES = (
    ("xiaohongshu.com", "小红书"), ("xhslink.com", "小红书"),
    ("weibo.com", "微博"), ("weibo.cn", "微博"),
    ("ixigua.com", "西瓜视频"), ("tiktok.com", "TikTok"),
    ("instagram.com", "Instagram"), ("facebook.com", "Facebook"),
    ("fb.watch", "Facebook"), ("x.com", "X"),
    ("twitter.com", "X"), ("t.co", "X"),
)
_UNSET = object()


def platform_name(hostname: str) -> str:
    host = (hostname or "").lower().rstrip(".")
    for domain, name in PLATFORM_NAMES:
        if host == domain or host.endswith("." + domain):
            return name
    return "这个网站"


def classify_download_error(message: str, *, hostname: str = "", proxy_configured: bool = False) -> dict[str, str]:
    """Turn engine/network errors into language a normal user can act on."""
    text = (message or "").lower()
    name = platform_name(hostname)
    if "unsupported url" in text or "no suitable extractor" in text:
        return {"code": "UNSUPPORTED_URL", "message": f"{name}当前链接类型暂未通过支持验证。请复制具体的视频播放页地址，而不是网站首页、搜索页或个人主页。"}
    if any(term in text for term in ("login", "logged-in", "sign in", "authentication", "cookies", "cookie")):
        return {"code": "LOGIN_REQUIRED", "message": f"{name}要求先登录或同步登录状态。请确认浏览器中能正常播放，再按设置中的连接浏览器提示操作。"}
    if any(term in text for term in ("proxyerror", "unable to connect", "timed out", "resolve", "network is unreachable")):
        return {"code": "PROXY_REQUIRED", "message": f"{name}当前网络无法访问。请点击设置中的“自动检测代理”；如果仍失败，请确认代理软件正在运行。"}
    if "http error 403" in text or "forbidden" in text or "captcha" in text or "bot" in text:
        return {"code": "ACCESS_RESTRICTED", "message": f"{name}拒绝了当前下载请求（常见于页面验证、短时效媒体地址或请求上下文不完整）。请重试；如果浏览器也无法播放，再登录或完成网站验证。"}
    if "requested format is not available" in text or "format is not available" in text:
        return {"code": "FORMAT_UNAVAILABLE", "message": "这个页面没有当前选择的画质。请改选“最佳画质”或较低画质后重试。"}
    if any(term in text for term in ("video is unavailable", "not found", "private video", "this video is unavailable")):
        return {"code": "VIDEO_UNAVAILABLE", "message": f"{name}视频不存在、已下架或当前账号无权查看。请确认链接仍可在浏览器中正常播放。"}
    if hostname and not proxy_configured and any(hostname == domain or hostname.endswith("." + domain) for domain in OVERSEAS_DOMAINS):
        return {"code": "PROXY_REQUIRED", "message": "这个网站通常需要代理访问。请点击设置 → 自动检测代理后再试。"}
    return {"code": "DOWNLOAD_FAILED", "message": "下载没有完成。请先确认链接能在浏览器中播放；如果页面要求登录或代理，请按设置中的提示操作。"}


@dataclass
class Task:
    id: str
    url: str
    quality: str
    output_dir: str
    status: str = "queued"
    progress: str = ""
    error: str | None = None
    pid: int | None = None
    output_path: str | None = None
    engine_url: str | None = None
    output_name: str | None = None
    referer: str | None = None
    user_agent: str | None = None
    output_format: str = "mp4"

    def payload(self) -> dict[str, Any]:
        payload = asdict(self)
        # Resolved browser media URLs are short-lived and sensitive. Keep
        # them in the worker only; callers see the original page URL in `url`.
        payload.pop("engine_url", None)
        payload.pop("output_name", None)
        payload.pop("referer", None)
        payload.pop("user_agent", None)
        return payload


def format_args(quality: str, output_format: str = "mp4") -> list[str]:
    if quality == "audio":
        return ["-x", "--audio-format", "mp3"]
    chosen = output_format if output_format in {"mp4", "mkv"} else "mp4"
    return ["-f", QUALITY_FORMATS.get(quality, QUALITY_FORMATS["best"]), "--merge-output-format", chosen]


class DownloadManager:
    def __init__(self, project_root: Path, cookie_store: CookieStore) -> None:
        self.project_root = project_root
        bundled_bin = project_root / "bin"
        legacy_bin = project_root.parent / "bin"
        self.ytdlp = (bundled_bin if (bundled_bin / "yt-dlp.exe").is_file() else legacy_bin) / "yt-dlp.exe"
        self.ffmpeg = self.ytdlp.parent
        self._tasks: dict[str, Task] = {}
        self._lock = threading.Lock()
        self.cookie_store = cookie_store
        self._engine_version: str | None = None
        self._js_runtime: dict[str, str] | None | object = _UNSET

    def engine_version(self) -> str:
        if self._engine_version is not None:
            return self._engine_version
        try:
            result = subprocess.run([str(self.ytdlp), "--version"], cwd=self.project_root, capture_output=True, text=True, timeout=5, check=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            self._engine_version = result.stdout.strip() or "未知版本"
        except (OSError, subprocess.SubprocessError):
            self._engine_version = "不可用"
        return self._engine_version

    def js_runtime(self) -> dict[str, str] | None:
        """Find the bundled Node runtime first, then a user-installed runtime."""
        cached = getattr(self, "_js_runtime", _UNSET)
        if cached is not _UNSET:
            return cached  # type: ignore[return-value]
        candidates = [self.project_root / "runtime" / "node.exe", self.project_root / "bin" / "node.exe"]
        for candidate in candidates:
            if candidate.is_file():
                self._js_runtime = {"name": "node", "path": str(candidate), "source": "bundled"}
                return self._js_runtime
        discovered = shutil.which("node")
        if discovered:
            self._js_runtime = {"name": "node", "path": discovered, "source": "system"}
            return self._js_runtime
        self._js_runtime = None
        return None

    def engine_capabilities(self) -> dict[str, Any]:
        runtime = self.js_runtime()
        return {
            "version": self.engine_version(),
            "jsRuntime": {
                "available": bool(runtime),
                "name": runtime.get("name") if runtime else None,
                "source": runtime.get("source") if runtime else None,
            },
        }

    def list_tasks(self) -> list[dict[str, Any]]:
        with self._lock:
            return [task.payload() for task in self._tasks.values()]

    def clear_history(self) -> int:
        """Remove terminal task records while preserving active downloads."""
        with self._lock:
            terminal = [key for key, task in self._tasks.items() if task.status in {"completed", "failed"}]
            for key in terminal:
                del self._tasks[key]
            return len(terminal)

    # Keep the old method name for callers from the 0.1.2 sidecar/tests.
    def clear_completed(self) -> int:
        return self.clear_history()

    @staticmethod
    def _safe_output_name(value: str, fallback: str = "视频") -> str:
        cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", str(value or "")).strip(" .")
        return (cleaned or fallback)[:120]

    def organize_outputs(self, entries: list[dict[str, Any]], *, naming: str = "date-title", category: str = "site-topic") -> list[dict[str, str]]:
        """Apply the VIP output naming/category rule to completed media files.

        Each entry supplies its own output directory so a user-selected folder
        is respected without allowing a renderer request to move arbitrary
        files outside that folder.
        """
        moved: list[dict[str, str]] = []
        for entry in entries:
            output_path = Path(str(entry.get("outputPath", ""))).expanduser().resolve()
            output_dir = Path(str(entry.get("outputDir") or output_path.parent)).expanduser().resolve()
            try:
                output_path.relative_to(output_dir)
            except ValueError:
                raise ValueError("整理文件必须位于任务的下载目录中")
            if not output_path.is_file() or output_path.suffix.lower() not in MEDIA_EXTENSIONS:
                continue
            title = self._safe_output_name(str(entry.get("title", "")) or output_path.stem)
            host = (urlparse(str(entry.get("url", ""))).hostname or "视频").lower().replace("www.", "")
            host = self._safe_output_name(host, "视频")
            today = datetime.now().strftime("%Y-%m-%d")
            if naming == "site-title":
                stem = f"{host}_{title}"
            elif naming == "title":
                stem = title
            else:
                stem = f"{today}_{title}"
            target_dir = output_dir / host if category in {"site", "site-topic"} else output_dir
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / f"{stem}{output_path.suffix.lower()}"
            if target.resolve() == output_path.resolve():
                moved.append({"source": str(output_path), "target": str(output_path)})
                continue
            counter = 2
            while target.exists():
                target = target_dir / f"{stem} ({counter}){output_path.suffix.lower()}"
                counter += 1
            shutil.move(str(output_path), str(target))
            moved.append({"source": str(output_path), "target": str(target)})
        return moved

    @staticmethod
    def _media_snapshot(directory: Path) -> dict[str, tuple[int, int]]:
        try:
            return {
                str(path): (path.stat().st_size, path.stat().st_mtime_ns)
                for path in directory.iterdir()
                if path.is_file() and path.suffix.lower() in MEDIA_EXTENSIONS
            }
        except OSError:
            return {}

    def create(self, *, url: str, quality: str, output_dir: str, output_format: str = "mp4", proxy: str = "", auto_proxy: bool = True, engine_url: str | None = None, source_title: str = "", source_id: str = "", referer: str | None = None, user_agent: str | None = None) -> Task:
        if not TASK_URL_PATTERN.fullmatch(url.strip()):
            raise ValueError("视频链接无效")
        output = Path(output_dir).expanduser().resolve()
        output.mkdir(parents=True, exist_ok=True)
        if not self.ytdlp.is_file():
            raise FileNotFoundError("缺少 yt-dlp.exe")
        output_name = None
        if engine_url and engine_url != url:
            title = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", source_title)[:100].strip(" .") or "视频"
            source_id = source_id if re.fullmatch(r"\d{1,30}", source_id) else uuid.uuid4().hex[:16]
            output_name = f"{title} [{source_id}]".replace("%", "%%") + ".%(ext)s"
        chosen_format = "mp3" if quality == "audio" else output_format if output_format in {"mp4", "mkv"} else "mp4"
        task = Task(str(uuid.uuid4()), url.strip(), quality, str(output), engine_url=(engine_url or url).strip(), output_name=output_name, referer=referer, user_agent=user_agent, output_format=chosen_format)
        with self._lock:
            self._tasks[task.id] = task
        threading.Thread(target=self._run, args=(task, proxy, auto_proxy), daemon=True).start()
        return task

    def _build_command(self, *, url: str, quality: str, output_dir: str, proxy: str, auto_proxy: bool, preflight: bool = False, output_name: str | None = None, referer: str | None = None, user_agent: str | None = None, output_format: str = "mp4") -> tuple[list[str], dict[str, str], bool]:
        hostname = (urlparse(url).hostname or "").lower()
        use_proxy = bool(proxy) and (not auto_proxy or any(hostname == domain or hostname.endswith("." + domain) for domain in OVERSEAS_DOMAINS))
        command = [
            str(self.ytdlp),
            "--ignore-config",
            "--proxy", proxy if use_proxy else "",
            "--newline",
            "--no-warnings",
            "--socket-timeout", "30",
            "--no-playlist",
            "--ffmpeg-location", str(self.ffmpeg),
        ]
        runtime = self.js_runtime()
        environment = os.environ.copy()
        if runtime:
            command.extend(["--js-runtimes", runtime["name"]])
            environment["PATH"] = str(Path(runtime["path"]).parent) + os.pathsep + environment.get("PATH", "")
        if referer:
            command.extend(["--referer", referer])
        if user_agent:
            command.extend(["--user-agent", user_agent])
        if use_proxy:
            environment["http_proxy"] = proxy
            environment["https_proxy"] = proxy
        if preflight:
            command.extend(["--skip-download", "--dump-single-json", url])
        else:
            command.extend(["--print", "after_move:__ED_OUTPUT__%(filepath)s", "-o", str(Path(output_dir) / (output_name or "%(title).150B [%(id).60B].%(ext)s")), *format_args(quality, output_format), url])
        return command, environment, use_proxy

    def extract_subtitles(self, *, url: str, output_dir: str, proxy: str = "", auto_proxy: bool = True) -> Path:
        """Download the first available subtitle track into the task directory."""
        clean_url = url.strip()
        if not TASK_URL_PATTERN.fullmatch(clean_url):
            raise ValueError("视频链接无效")
        output = Path(output_dir).expanduser().resolve()
        output.mkdir(parents=True, exist_ok=True)
        hostname = (urlparse(clean_url).hostname or "").lower()
        use_proxy = bool(proxy) and (not auto_proxy or any(hostname == domain or hostname.endswith("." + domain) for domain in OVERSEAS_DOMAINS))
        command = [
            str(self.ytdlp), "--ignore-config", "--skip-download", "--write-subs", "--write-auto-subs",
            "--sub-langs", "all", "--sub-format", "vtt/srt/best", "--convert-subs", "srt",
            "--no-playlist", "--socket-timeout", "30", "--ffmpeg-location", str(self.ffmpeg),
            "--proxy", proxy if use_proxy else "",
            "-o", str(output / "%(title).150B [%(id).60B].%(ext)s"), clean_url,
        ]
        runtime = self.js_runtime()
        environment = os.environ.copy()
        if runtime:
            command[1:1] = ["--js-runtimes", runtime["name"]]
            environment["PATH"] = str(Path(runtime["path"]).parent) + os.pathsep + environment.get("PATH", "")
        if use_proxy:
            environment["http_proxy"] = proxy
            environment["https_proxy"] = proxy
        before = {path.resolve() for path in output.glob("*.srt")} | {path.resolve() for path in output.glob("*.vtt")}
        cleanup_cookie = lambda: None
        try:
            cookie_file, cleanup_cookie = self.cookie_store.temporary_file()
            if cookie_file:
                command[1:1] = ["--cookies", cookie_file]
            result = subprocess.run(command, cwd=self.project_root, env=environment, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            candidates = [path.resolve() for path in output.glob("*.srt") if path.resolve() not in before and path.stat().st_size > 0]
            candidates += [path.resolve() for path in output.glob("*.vtt") if path.resolve() not in before and path.stat().st_size > 0]
            if result.returncode != 0 or not candidates:
                combined = (result.stdout or "") + "\n" + (result.stderr or "")
                if "subtitle" in combined.lower() or "subtitles" in combined.lower():
                    raise RuntimeError("该视频没有可提取字幕")
                raise RuntimeError("字幕提取失败，请确认视频在浏览器中可以播放")
            return sorted(candidates, key=lambda path: path.stat().st_mtime_ns, reverse=True)[0]
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("字幕提取超时，请稍后重试") from exc
        finally:
            cleanup_cookie()

    def merge_subtitle_track(self, *, video_path: str, subtitle_path: str, target_language: str) -> Path:
        """Mux a translated SRT as a selectable subtitle stream without re-encoding video/audio."""
        video = Path(video_path).expanduser().resolve()
        subtitle = Path(subtitle_path).expanduser().resolve()
        if not video.is_file() or video.suffix.lower() not in {".mp4", ".mkv", ".mov"}:
            raise ValueError("当前只支持把字幕封装到 MP4、MKV 或 MOV 视频")
        if not subtitle.is_file() or subtitle.suffix.lower() not in {".srt", ".vtt"}:
            raise ValueError("缺少可封装的 SRT/VTT 字幕文件")
        ffmpeg_name = "ffmpeg.exe" if os.name == "nt" else "ffmpeg"
        ffmpeg = self.ffmpeg / ffmpeg_name
        if not ffmpeg.is_file():
            raise FileNotFoundError("缺少 FFmpeg，暂时无法封装字幕轨道")
        language_code = {"zh-CN": "chi", "zh-TW": "zht", "en": "eng", "ja": "jpn", "ko": "kor"}.get(target_language, "und")
        suffix = video.suffix.lower()
        subtitle_codec = "mov_text" if suffix in {".mp4", ".mov"} else "srt"
        destination = video.with_name(f"{video.stem}.{target_language}.subtitled{video.suffix}")
        temporary = destination.with_name(destination.name + ".partial")
        command = [
            str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-i", str(video), "-i", str(subtitle),
            "-map", "0", "-map", "1:0", "-map_metadata", "0",
            "-c", "copy", "-c:s", subtitle_codec,
            "-metadata:s:s:0", f"language={language_code}",
            "-metadata:s:s:0", f"title=易下载翻译字幕 ({target_language})",
            "-disposition:s:0", "default", str(temporary),
        ]
        try:
            result = subprocess.run(command, cwd=self.project_root, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            if result.returncode != 0 or not temporary.is_file() or temporary.stat().st_size <= 0:
                detail = (result.stderr or result.stdout or "").strip().splitlines()[-1:]
                raise RuntimeError(f"字幕轨道封装失败{(': ' + detail[0]) if detail else ''}")
            temporary.replace(destination)
            return destination
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("字幕轨道封装超时，请稍后重试") from exc
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass

    def preflight(self, *, url: str, quality: str, proxy: str = "", auto_proxy: bool = True) -> dict[str, Any]:
        """Check a link before creating a task, without writing media files."""
        clean_url = url.strip()
        if not TASK_URL_PATTERN.fullmatch(clean_url):
            return {"ready": False, "code": "INVALID_URL", "message": "请粘贴具体的视频播放页链接。"}
        hostname = (urlparse(clean_url).hostname or "").lower()
        runtime = self.js_runtime()
        if any(hostname == domain or hostname.endswith("." + domain) for domain in ("youtube.com", "youtu.be")) and not runtime:
            return {"ready": False, "code": "COMPATIBILITY_COMPONENT_MISSING", "message": "这个网站需要浏览器兼容组件。请更新易下载到最新版本后重试。"}
        command, environment, use_proxy = self._build_command(url=clean_url, quality=quality, output_dir="", proxy=proxy, auto_proxy=auto_proxy, preflight=True)
        cleanup_cookie = lambda: None
        try:
            cookie_file, cleanup_cookie = self.cookie_store.temporary_file()
            if cookie_file:
                command[1:1] = ["--cookies", cookie_file]
            result = subprocess.run(command, cwd=self.project_root, env=environment, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=40, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            output = (result.stdout or "") + "\n" + (result.stderr or "")
            if result.returncode == 0:
                title = ""
                for line in reversed(output.splitlines()):
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(payload, dict):
                        title = str(payload.get("title") or "").strip()
                        break
                return {"ready": True, "code": "READY", "message": f"已识别到视频{('：' + title) if title else ''}，正在加入下载。"}
            guidance = classify_download_error(output, hostname=hostname, proxy_configured=use_proxy)
            return {"ready": False, **guidance}
        except subprocess.TimeoutExpired:
            guidance = classify_download_error("timed out", hostname=hostname, proxy_configured=use_proxy)
            return {"ready": False, **guidance}
        except OSError as exc:
            return {"ready": False, **classify_download_error(str(exc), hostname=hostname, proxy_configured=use_proxy)}
        finally:
            cleanup_cookie()

    def _run(self, task: Task, proxy: str, auto_proxy: bool) -> None:
        engine_url = task.engine_url or task.url
        hostname = (urlparse(engine_url).hostname or "").lower()
        command, environment, use_proxy = self._build_command(url=engine_url, quality=task.quality, output_dir=task.output_dir, proxy=proxy, auto_proxy=auto_proxy, output_name=task.output_name, referer=task.referer, user_agent=task.user_agent, output_format=task.output_format)
        cleanup_cookie = lambda: None
        before_files = self._media_snapshot(Path(task.output_dir))
        try:
            cookie_file, cleanup_cookie = self.cookie_store.temporary_file()
            if cookie_file:
                command[1:1] = ["--cookies", cookie_file]
            process = subprocess.Popen(command, cwd=self.project_root, env=environment, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
            with self._lock:
                task.status = "running"
                task.pid = process.pid
            assert process.stdout is not None
            reported_file = None
            for line in process.stdout:
                message = line.strip()
                if message.startswith("__ED_OUTPUT__"):
                    reported_file = str(Path(message[len("__ED_OUTPUT__"):]).resolve())
                    continue
                if message:
                    with self._lock:
                        task.progress = message[-500:]
            result = process.wait()
            after_files = self._media_snapshot(Path(task.output_dir))
            changed_files = [
                path for path, metadata in after_files.items()
                if metadata[0] > 0 and (path not in before_files or before_files[path] != metadata)
            ]
            with self._lock:
                own_file = None
                if reported_file:
                    # yt-dlp's after_move callback is authoritative, but only
                    # accept a real media file inside this task's output dir.
                    # Windows path normalization and Unicode output can make
                    # the callback string differ from the directory snapshot.
                    candidate = Path(reported_file).resolve()
                    output_root = Path(task.output_dir).resolve()
                    try:
                        candidate.relative_to(output_root)
                        if candidate.is_file() and candidate.stat().st_size > 0 and candidate.suffix.lower() in MEDIA_EXTENSIONS:
                            own_file = str(candidate)
                    except (OSError, ValueError):
                        own_file = None
                if not own_file and len(changed_files) == 1:
                    own_file = changed_files[0]
                if result == 0 and own_file:
                    task.status = "completed"
                    task.output_path = own_file
                elif result == 0:
                    task.status = "failed"
                    task.error = "下载没有生成新的视频文件。请确认链接是具体的视频播放页，并按设置中的登录或代理提示操作。"
                else:
                    task.status = "failed"
                    task.error = classify_download_error(task.progress, hostname=hostname, proxy_configured=use_proxy)["message"]
        except (OSError, RuntimeError) as exc:
            with self._lock:
                task.status = "failed"
                task.error = classify_download_error(str(exc), hostname=hostname, proxy_configured=use_proxy)["message"]
        finally:
            cleanup_cookie()
