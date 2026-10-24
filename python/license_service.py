from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from vendor.life_license.client import LicenseClient, LicenseError, LicenseStatus
from vendor.life_license.storage import DpapiStorage, StorageError


class LicenseService:
    def __init__(self, config_path: Path) -> None:
        self.config_path = config_path
        self._client: LicenseClient | None = None
        self._config_error: str | None = None
        self._load()

    def _load(self) -> None:
        try:
            config = json.loads(self.config_path.read_text(encoding="utf-8"))
            values = (str(config["appId"]), str(config["apiBase"]), str(config["rootPublicKey"]))
            if any(value.startswith("REPLACE_") for value in values):
                raise ValueError("生产授权配置尚未写入")
            self._client = LicenseClient(
                app_id=values[0],
                api_base=values[1],
                root_public_key=values[2],
                storage=DpapiStorage("EasyDownload", "license.dat"),
                sdk_version="0.1.0",
            )
        except (OSError, ValueError, KeyError, json.JSONDecodeError, StorageError, LicenseError) as exc:
            self._config_error = str(exc) or "授权配置无效"

    @staticmethod
    def _status_payload(status: LicenseStatus) -> dict[str, Any]:
        return {
            "active": status.active,
            "needsActivation": status.needs_activation,
            "needsValidation": status.needs_validation,
            "expiresAt": status.expires_at,
            "entitlementExpiresAt": status.entitlement_expires_at,
            "errorCode": status.error_code,
            "message": status.message,
        }

    def status(self) -> dict[str, Any]:
        if self._client is None:
            return self._status_payload(LicenseStatus(False, True, False, error_code="CONFIG_MISSING", message=self._config_error or "授权配置不存在"))
        try:
            return self._status_payload(self._client.status())
        except (LicenseError, StorageError) as exc:
            return self._status_payload(LicenseStatus(False, True, False, error_code=getattr(exc, "code", "LICENSE_ERROR"), message=str(exc)))

    def activate(self, code: str) -> dict[str, Any]:
        if self._client is None:
            raise LicenseError("CONFIG_MISSING", self._config_error or "授权配置不存在")
        return self._status_payload(self._client.activate(code))

    def validate(self) -> dict[str, Any]:
        if self._client is None:
            raise LicenseError("CONFIG_MISSING", self._config_error or "授权配置不存在")
        return self._status_payload(self._client.validate())

    def require(self) -> dict[str, Any]:
        """在真正执行受保护功能前，执行 SDK 的周期性在线续验策略。"""
        if self._client is None:
            raise LicenseError("CONFIG_MISSING", self._config_error or "授权配置不存在")
        return self._status_payload(self._client.require_license())
