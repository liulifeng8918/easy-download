from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from html import unescape
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class TranslationProviderError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass
class SubtitleSegment:
    index: int
    start: str
    end: str
    text: str


_TIMECODE = r"(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3}"
_SRT_BLOCK = re.compile(
    rf"(?:^|\n)\s*(\d+)\s*\n\s*({_TIMECODE})\s*-->\s*({_TIMECODE})(?:[^\n]*)\n(.*?)(?=\n\s*\n|\Z)",
    re.S,
)
_VTT_BLOCK = re.compile(
    rf"(?:^|\n)\s*(?:(?:[^\n]+)\n)?\s*({_TIMECODE})\s*-->\s*({_TIMECODE})(?:[^\n]*)\n(.*?)(?=\n\s*\n|\Z)",
    re.S,
)


def _clean_text(value: str) -> str:
    value = unescape(value.replace("\r\n", "\n").replace("\r", "\n"))
    value = re.sub(r"<\/?(?:i|b|u|font|c(?:\.[^ >]+)?)(?: [^>]*)?>", "", value, flags=re.I)
    return "\n".join(line.strip() for line in value.splitlines()).strip()


def parse_subtitle(text: str, fmt: str = "srt") -> list[SubtitleSegment]:
    """Parse the small SRT/VTT subset emitted by yt-dlp/ffmpeg."""
    source = str(text or "").replace("\ufeff", "")
    matches = _VTT_BLOCK.finditer(source) if fmt.lower() == "vtt" or source.lstrip().upper().startswith("WEBVTT") else _SRT_BLOCK.finditer(source)
    segments: list[SubtitleSegment] = []
    for position, match in enumerate(matches, start=1):
        if fmt.lower() == "vtt" or source.lstrip().upper().startswith("WEBVTT"):
            start, end, body = match.group(1), match.group(2), match.group(3)
            index = position
        else:
            index = int(match.group(1))
            start, end, body = match.group(2), match.group(3), match.group(4)
        body = _clean_text(body)
        if body:
            segments.append(SubtitleSegment(index=index, start=start.replace(".", ","), end=end.replace(".", ","), text=body))
    if not segments:
        raise TranslationProviderError("SUBTITLE_FORMAT_INVALID", "没有识别到有效的 SRT/VTT 字幕片段")
    return segments


def render_srt(segments: list[SubtitleSegment]) -> str:
    blocks = []
    for index, segment in enumerate(segments, start=1):
        blocks.append(f"{index}\n{segment.start.replace('.', ',')} --> {segment.end.replace('.', ',')}\n{segment.text.strip()}\n")
    return "\n".join(blocks)


def detect_language(text: str) -> str:
    value = str(text or "")
    if re.search(r"[\u4e00-\u9fff]", value):
        return "zh-CN"
    if re.search(r"[\u3040-\u30ff]", value):
        return "ja"
    if re.search(r"[\uac00-\ud7af]", value):
        return "ko"
    if re.search(r"[\u0400-\u04ff]", value):
        return "ru"
    return "en"


def _chunks(value: str, max_bytes: int = 450) -> list[str]:
    """Split on sentence/space boundaries without exceeding UTF-8 bytes."""
    text = str(value or "").strip()
    if not text:
        return [""]
    result: list[str] = []
    current = ""
    for token in re.split(r"(\s+|[。！？.!?])", text):
        if not token:
            continue
        candidate = current + token
        if current and len(candidate.encode("utf-8")) > max_bytes:
            result.append(current.strip())
            current = token
        elif len(candidate.encode("utf-8")) > max_bytes:
            raw = token
            while raw:
                available = max_bytes - len(current.encode("utf-8"))
                take = max(1, available)
                piece = raw
                while len(piece.encode("utf-8")) > available and len(piece) > 1:
                    piece = piece[:-1]
                if current and len((current + piece).encode("utf-8")) > max_bytes:
                    result.append(current.strip())
                    current = ""
                    continue
                current += piece
                raw = raw[len(piece):]
                if raw:
                    result.append(current.strip())
                    current = ""
        else:
            current = candidate
    if current.strip():
        result.append(current.strip())
    return result or [text[:max_bytes]]


class MyMemoryTranslator:
    endpoint = "https://api.mymemory.translated.net/get"

    def __init__(self, *, timeout: float = 20.0, max_retries: int = 2) -> None:
        self.timeout = timeout
        self.max_retries = max_retries
        self._cache: dict[tuple[str, str, str], str] = {}

    def _request(self, text: str, source: str, target: str) -> str:
        query = urlencode({"q": text, "langpair": f"{source}|{target}", "mt": "1"})
        request = Request(self.endpoint + "?" + query, headers={"User-Agent": "EasyDownload/0.1"})
        for attempt in range(self.max_retries + 1):
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8", errors="replace"))
                status = str(payload.get("responseStatus", ""))
                translated = str((payload.get("responseData") or {}).get("translatedText") or "").strip()
                if status not in {"", "200"} or not translated:
                    message = str((payload.get("responseData") or {}).get("detectedLanguage") or payload.get("responseDetails") or "公共翻译服务未返回结果")
                    raise TranslationProviderError("TRANSLATION_PROVIDER_REJECTED", message, retryable=status in {"429", "500", "502", "503"})
                return translated
            except HTTPError as exc:
                retryable = exc.code in {408, 429, 500, 502, 503, 504}
                if not retryable or attempt >= self.max_retries:
                    raise TranslationProviderError("TRANSLATION_HTTP_ERROR", f"公共翻译服务返回 HTTP {exc.code}", retryable=retryable) from exc
            except (URLError, TimeoutError) as exc:
                if attempt >= self.max_retries:
                    raise TranslationProviderError("TRANSLATION_NETWORK_ERROR", "公共翻译服务暂时无法连接", retryable=True) from exc
            if attempt < self.max_retries:
                time.sleep(0.4 * (2**attempt))
        raise TranslationProviderError("TRANSLATION_FAILED", "公共翻译服务未完成请求")

    def translate(self, text: str, *, source: str | None = None, target: str = "zh-CN") -> tuple[str, int]:
        source_code = source or detect_language(text)
        if source_code.lower() in {target.lower(), target.split("-")[0].lower()}:
            return text, 0
        translated_parts: list[str] = []
        requests = 0
        for chunk in _chunks(text):
            key = (chunk, source_code, target)
            translated = self._cache.get(key)
            if translated is None:
                translated = self._request(chunk, source_code, target)
                if len(self._cache) >= 512:
                    self._cache.pop(next(iter(self._cache)))
                self._cache[key] = translated
                requests += 1
            translated_parts.append(translated)
        return " ".join(part.strip() for part in translated_parts if part.strip()), requests

    def translate_segments(self, segments: list[SubtitleSegment], *, source: str | None, target: str, max_segments: int = 800) -> dict:
        if len(segments) > max_segments:
            raise TranslationProviderError("SUBTITLE_TOO_LARGE", f"单个字幕文件最多翻译 {max_segments} 条字幕")
        total_chars = sum(len(segment.text) for segment in segments)
        if total_chars > 120_000:
            raise TranslationProviderError("SUBTITLE_TOO_LARGE", "字幕文本超过本地免费翻译上限，请拆分后再试")
        output: list[SubtitleSegment] = []
        requests = 0
        for segment in segments:
            translated, count = self.translate(segment.text, source=source, target=target)
            output.append(SubtitleSegment(segment.index, segment.start, segment.end, translated))
            requests += count
        return {"segments": output, "provider": "MyMemory 公共翻译", "requests": requests, "characters": total_chars, "warnings": ["机器翻译结果仅供参考，建议人工校对"]}


class OpenAICompatibleTranslator(MyMemoryTranslator):
    """Optional user-configured translator; credentials never live in the UI."""

    def __init__(self, *, base_url: str, model: str, api_key: str, timeout: float = 30.0) -> None:
        super().__init__(timeout=timeout, max_retries=1)
        self.base_url = base_url.rstrip("/")
        self.model = model.strip()
        self.api_key = api_key

    def _request(self, text: str, source: str, target: str) -> str:
        if not self.api_key or not self.model or not self.base_url:
            raise TranslationProviderError("CUSTOM_PROVIDER_NOT_CONFIGURED", "自定义翻译服务尚未完整配置")
        endpoint = self.base_url if self.base_url.endswith("/chat/completions") else self.base_url + "/chat/completions"
        prompt = f"Translate the following subtitle from {source} to {target}. Preserve meaning and return only the translation:\n{text}"
        body = json.dumps({"model": self.model, "temperature": 0, "messages": [{"role": "user", "content": prompt}]}, ensure_ascii=False).encode("utf-8")
        request = Request(endpoint, data=body, method="POST", headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}", "User-Agent": "EasyDownload/0.1"})
        try:
            with urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8", errors="replace"))
        except HTTPError as exc:
            raise TranslationProviderError("CUSTOM_PROVIDER_HTTP_ERROR", f"自定义翻译服务返回 HTTP {exc.code}", retryable=exc.code in {408, 429, 500, 502, 503, 504}) from exc
        except (URLError, TimeoutError) as exc:
            raise TranslationProviderError("CUSTOM_PROVIDER_NETWORK_ERROR", "自定义翻译服务暂时无法连接", retryable=True) from exc
        try:
            translated = str(payload["choices"][0]["message"]["content"]).strip()
        except (KeyError, IndexError, TypeError) as exc:
            raise TranslationProviderError("CUSTOM_PROVIDER_RESPONSE_INVALID", "自定义翻译服务返回格式无效") from exc
        if not translated:
            raise TranslationProviderError("CUSTOM_PROVIDER_EMPTY", "自定义翻译服务未返回译文")
        return translated

    def translate_segments(self, segments: list[SubtitleSegment], *, source: str | None, target: str, max_segments: int = 800) -> dict:
        result = super().translate_segments(segments, source=source, target=target, max_segments=max_segments)
        result["provider"] = "自定义 OpenAI 兼容翻译"
        result["warnings"] = ["自定义 AI 翻译结果仅供参考，API 用量由用户自行承担"]
        return result
