from __future__ import annotations

import tempfile
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
