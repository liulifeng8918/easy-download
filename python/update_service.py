from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

from vendor.life_license.crypto import b64url_decode, canonical_json, VerificationError


VERSION_PATTERN = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
MAX_UPDATE_BYTES = 500 * 1024 * 1024


def version_tuple(value: str) -> tuple[int, int, int]:
    match = VERSION_PATTERN.fullmatch(value.strip())
    if not match:
        raise ValueError("版本号无效")
    return tuple(int(part) for part in match.groups())


def verify_manifest(document: dict[str, Any], public_key: str) -> None:
    try:
        version_tuple(str(document["version"]))
        url = str(document["packageUrl"])
        digest = str(document["sha256"]).lower()
        if not url.startswith("https://") or not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("更新清单字段无效")
        key = Ed25519PublicKey.from_public_bytes(b64url_decode(public_key))
        key.verify(b64url_decode(str(document["signature"])), canonical_json({key: value for key, value in document.items() if key != "signature"}))
    except (KeyError, TypeError, ValueError, VerificationError, InvalidSignature) as exc:
        raise ValueError("更新清单签名或字段无效") from exc


class UpdateService:
    def __init__(self, config_path: Path, current_version: str = "0.1.0") -> None:
        self.config_path = config_path
        self.current_version = current_version

    def check(self) -> dict[str, Any]:
        try:
            config = json.loads(self.config_path.read_text(encoding="utf-8"))
            feed_url = str(config["feedUrl"])
            public_key = str(config["publicKey"])
            if not feed_url.startswith("https://") or feed_url.startswith("https://REPLACE_") or public_key.startswith("REPLACE_"):
                raise ValueError("更新源尚未配置")
            request = urllib.request.Request(feed_url, headers={"user-agent": "easy-download-updater/0.1"})
            with urllib.request.urlopen(request, timeout=10) as response:
                manifest = json.loads(response.read().decode("utf-8"))
            verify_manifest(manifest, public_key)
            available = version_tuple(str(manifest["version"])) > version_tuple(self.current_version)
            return {"configured": True, "available": available, "currentVersion": self.current_version, "manifest": manifest if available else None}
        except (OSError, urllib.error.URLError, ValueError, KeyError, json.JSONDecodeError) as exc:
            return {"configured": False, "available": False, "currentVersion": self.current_version, "errorCode": "UPDATE_UNAVAILABLE", "message": str(exc)}

    def download_latest(self, destination: Path) -> dict[str, Any]:
        """重新获取并验证清单，再把已签名、已校验哈希的安装包原子写入本机。"""
        result = self.check()
        if not result.get("configured"):
            raise ValueError(result.get("message") or "更新源尚未配置")
        if not result.get("available") or not isinstance(result.get("manifest"), dict):
            raise ValueError("当前没有可用更新")
        manifest = result["manifest"]
        destination.mkdir(parents=True, exist_ok=True)
        version = str(manifest["version"])
        target = destination / f"EasyDownload-{version}.exe"
        expected = str(manifest["sha256"]).lower()
        if target.is_file() and sha256_file(target) == expected:
            return {"version": version, "path": str(target), "sha256": expected, "cached": True}
        request = urllib.request.Request(str(manifest["packageUrl"]), headers={"user-agent": "easy-download-updater/0.1"})
        temporary_path: Path | None = None
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                content_length = response.headers.get("Content-Length")
                if content_length and int(content_length) > MAX_UPDATE_BYTES:
                    raise ValueError("更新包超过大小限制")
                with tempfile.NamedTemporaryFile(prefix="easy-download-", suffix=".part", dir=destination, delete=False) as handle:
                    temporary_path = Path(handle.name)
                    total = 0
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > MAX_UPDATE_BYTES:
                            raise ValueError("更新包超过大小限制")
                        handle.write(chunk)
            if sha256_file(temporary_path) != expected:
                raise ValueError("更新包 SHA-256 校验失败")
            os.replace(temporary_path, target)
            temporary_path = None
            return {"version": version, "path": str(target), "sha256": expected, "cached": False}
        finally:
            if temporary_path and temporary_path.exists():
                temporary_path.unlink(missing_ok=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
