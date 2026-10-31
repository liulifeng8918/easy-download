from __future__ import annotations

import tempfile
import time
from pathlib import Path

from vendor.life_license.storage import DpapiStorage, StorageError


class CookieStore:
    def __init__(self) -> None:
        self.storage = DpapiStorage("EasyDownload", "cookies.dat")

    def read(self) -> str | None:
        try:
            return self.storage.read()
        except StorageError as exc:
            raise RuntimeError(str(exc)) from exc

    def write(self, value: str) -> None:
        try:
            self.storage.write(value)
        except StorageError as exc:
            raise RuntimeError(str(exc)) from exc

    def browser_session_cookies(self, domain: str) -> list[dict]:
        """Return only explicitly synced cookies for one allowed site."""
        if domain != "douyin.com":
            return []
        result = []
        for line in (self.read() or "").splitlines():
            if not line or line.startswith("#"):
                continue
            fields = line.split("\t")
            if len(fields) != 7:
                continue
            host, _, cookie_path, secure, expires, name, value = fields
            clean = host.lstrip(".").lower()
            if clean != domain and not clean.endswith("." + domain):
                continue
            try:
                expiry = int(expires)
            except ValueError:
                continue
            if expiry and expiry <= time.time():
                continue
            cookie = {"url": "https://" + clean + (cookie_path if cookie_path.startswith("/") else "/"), "domain": host, "path": cookie_path or "/", "secure": secure == "TRUE", "name": name, "value": value}
            if expiry:
                cookie["expirationDate"] = expiry
            result.append(cookie)
        return result

    def temporary_file(self) -> tuple[str | None, callable]:
        value = self.read()
        if not value:
            return None, lambda: None
        handle = tempfile.NamedTemporaryFile(prefix="easy-download-cookies-", suffix=".txt", delete=False, mode="w", encoding="utf-8", newline="")
        try:
            handle.write(value)
            handle.close()
        except Exception:
            handle.close()
            Path(handle.name).unlink(missing_ok=True)
            raise

        def cleanup() -> None:
            Path(handle.name).unlink(missing_ok=True)

        return handle.name, cleanup
