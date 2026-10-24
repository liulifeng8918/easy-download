from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Protocol

from .crypto import VerificationError, parse_utc, verify_document
from .storage import windows_fingerprint

CODE_PATTERN = re.compile(r"^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$")
APP_PATTERN = re.compile(r"^app_[A-Za-z0-9_-]{16,40}$")
MAX_LEASE = timedelta(days=37, minutes=1)
REVALIDATE = timedelta(days=30)
ROLLBACK_TOLERANCE = timedelta(minutes=5)


class Storage(Protocol):
    def read(self) -> str | None: ...
    def write(self, value: str) -> None: ...
    def clear(self) -> None: ...


class LicenseError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class LicenseStatus:
    active: bool
    needs_activation: bool
    needs_validation: bool
    expires_at: str | None = None
    entitlement_expires_at: str | None = None
    error_code: str | None = None
    message: str | None = None


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _default_transport(api_base: str, route: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        f"{api_base}{route}",
        data=json.dumps(payload, separators=(",", ":")).encode(),
        headers={"content-type": "application/json", "user-agent": "life-license-python/0.1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read())
            error = body.get("error", {})
        except Exception:
            error = {}
        raise LicenseError(
            str(error.get("code") or "SERVICE_UNAVAILABLE"),
            str(error.get("message") or "授权服务暂时不可用"),
            exc.code >= 500 or exc.code == 429,
        ) from exc
    except (OSError, ValueError) as exc:
        raise LicenseError("SERVICE_UNAVAILABLE", "无法连接授权服务", True) from exc


class LicenseClient:
    def __init__(
        self,
        *,
        app_id: str,
        api_base: str,
        root_public_key: str,
        storage: Storage,
        fingerprint: Callable[[], str] = windows_fingerprint,
        transport: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
        now: Callable[[], datetime] | None = None,
        sdk_version: str = "0.1.0",
    ) -> None:
        if not APP_PATTERN.fullmatch(app_id):
            raise LicenseError("CONFIG_INVALID", "appId 无效")
        api_base = api_base.rstrip("/")
        if not api_base.startswith("https://") and not re.match(r"^http://(127\.0\.0\.1|localhost)(:\d+)?$", api_base):
            raise LicenseError("CONFIG_INVALID", "正式授权服务必须使用 HTTPS")
        self.app_id = app_id
        self.api_base = api_base
        self.root_public_key = root_public_key
        self.storage = storage
        self.fingerprint = fingerprint
        self.transport = transport or (lambda route, payload: _default_transport(api_base, route, payload))
        self.now = now or (lambda: datetime.now(timezone.utc))
        self.sdk_version = sdk_version

    def _cache(self) -> dict[str, Any] | None:
        raw = self.storage.read()
        if raw is None:
            return None
        try:
            cache = json.loads(raw)
            if cache.get("version") != 1 or not CODE_PATTERN.fullmatch(cache.get("code", "")):
                raise ValueError
            return cache
        except Exception as exc:
            raise LicenseError("CACHE_INVALID", "本地授权缓存损坏") from exc

    def _verify(self, response: dict[str, Any], previous: dict[str, Any] | None = None) -> None:
        try:
            certificate = response["onlineKeyCertificate"]
            lease = response["machineLease"]
            if not (
                certificate.get("version") == 1
                and certificate.get("kind") == "online-key-certificate"
                and certificate.get("platformId") == "life-license-platform"
                and certificate.get("usage") == "license-lease"
                and 1 <= int(certificate.get("maxLeaseDays", 0)) <= 37
            ):
                raise VerificationError("在线签名证书字段无效")
            verify_document(certificate, self.root_public_key)
            if not (
                lease.get("version") == 1
                and lease.get("kind") == "machine-lease"
                and lease.get("appId") == self.app_id
                and lease.get("onlineKeyId") == certificate.get("onlineKeyId")
                and int(lease.get("deviceLimit", 0)) >= 1
            ):
                raise VerificationError("机器授权字段无效")
            verify_document(lease, certificate["publicKey"])
            server_time = parse_utc(response["serverTime"])
            issued_at = parse_utc(lease["issuedAt"])
            expires_at = parse_utc(lease["leaseExpiresAt"])
            certificate_expiry = parse_utc(certificate["validUntil"])
            if abs(server_time - issued_at) > timedelta(minutes=1) or not issued_at < expires_at <= certificate_expiry:
                raise VerificationError("机器授权时间边界无效")
            if expires_at - issued_at > MAX_LEASE:
                raise VerificationError("机器授权期限无效")
            if lease.get("entitlementExpiresAt") and expires_at > parse_utc(lease["entitlementExpiresAt"]):
                raise VerificationError("机器授权超过业务到期时间")
            if previous:
                old = previous["response"]["machineLease"]
                for field in ("licenseId", "codeDigest", "deviceDigest", "activatedAt"):
                    if lease.get(field) != old.get(field):
                        raise VerificationError("续验返回了不一致的机器授权")
        except (KeyError, TypeError, ValueError, VerificationError) as exc:
            raise LicenseError("SIGNATURE_INVALID", str(exc) or "授权签名验证失败") from exc

    def status(self) -> LicenseStatus:
        try:
            cache = self._cache()
        except LicenseError as exc:
            return LicenseStatus(False, True, False, error_code=exc.code, message=str(exc))
        if cache is None:
            return LicenseStatus(False, True, False)
        if cache.get("lockedCode"):
            return LicenseStatus(False, True, False, error_code=cache["lockedCode"], message="授权已被服务器拒绝")
        try:
            self._verify(cache["response"], cache)
            current = self.now().astimezone(timezone.utc)
            last_seen = parse_utc(cache["lastSeenLocalTime"])
            if current + ROLLBACK_TOLERANCE < last_seen:
                raise LicenseError("CLOCK_ROLLBACK", "检测到系统时间回拨，请联网验证")
            lease = cache["response"]["machineLease"]
            if current >= parse_utc(lease["leaseExpiresAt"]):
                raise LicenseError("LICENSE_EXPIRED", "离线授权已到期，请联网验证")
            validated = parse_utc(cache["lastTrustedServerTime"])
            cache["lastSeenLocalTime"] = _iso(max(current, last_seen))
            self.storage.write(json.dumps(cache, ensure_ascii=False, separators=(",", ":")))
            return LicenseStatus(
                True,
                False,
                current - validated >= REVALIDATE,
                expires_at=lease["leaseExpiresAt"],
                entitlement_expires_at=lease.get("entitlementExpiresAt"),
            )
        except (LicenseError, VerificationError, KeyError, TypeError, ValueError) as exc:
            code = exc.code if isinstance(exc, LicenseError) else "SIGNATURE_INVALID"
            return LicenseStatus(False, False, True, error_code=code, message=str(exc))

    def activate(self, code: str) -> LicenseStatus:
        normalized = code.strip().upper()
        if not CODE_PATTERN.fullmatch(normalized):
            raise LicenseError("INVALID_REQUEST", "激活码格式不正确")
        response = self.transport("/v1/activate", {
            "appId": self.app_id,
            "code": normalized,
            "deviceFingerprint": self.fingerprint(),
            "sdk": {"name": "python", "version": self.sdk_version},
        })
        self._verify(response)
        cache = {
            "version": 1,
            "code": normalized,
            "response": response,
            "lastTrustedServerTime": response["serverTime"],
            "lastSeenLocalTime": response["serverTime"],
        }
        self.storage.write(json.dumps(cache, ensure_ascii=False, separators=(",", ":")))
        return self.status()

    def validate(self) -> LicenseStatus:
        cache = self._cache()
        if cache is None:
            raise LicenseError("NOT_ACTIVATED", "尚未激活")
        try:
            response = self.transport("/v1/validate", {
                "appId": self.app_id,
                "code": cache["code"],
                "deviceFingerprint": self.fingerprint(),
                "leaseId": cache["response"]["machineLease"]["leaseId"],
                "sdk": {"name": "python", "version": self.sdk_version},
            })
            self._verify(response, cache)
            cache["response"] = response
            cache["lastTrustedServerTime"] = response["serverTime"]
            cache["lastSeenLocalTime"] = response["serverTime"]
            cache.pop("lockedCode", None)
            self.storage.write(json.dumps(cache, ensure_ascii=False, separators=(",", ":")))
            return self.status()
        except LicenseError as exc:
            if exc.code in {"LICENSE_REVOKED", "LICENSE_EXPIRED", "DEVICE_MISMATCH", "LICENSE_NOT_FOUND"}:
                cache["lockedCode"] = exc.code
                self.storage.write(json.dumps(cache, ensure_ascii=False, separators=(",", ":")))
            raise

    def require_license(self) -> LicenseStatus:
        current = self.status()
        if not current.active:
            if current.needs_validation and current.error_code in {"LICENSE_EXPIRED", "CLOCK_ROLLBACK"}:
                return self.validate()
            raise LicenseError(current.error_code or "NOT_ACTIVATED", current.message or "软件尚未激活")
        if current.needs_validation:
            try:
                return self.validate()
            except LicenseError as exc:
                after_failure = self.status()
                if after_failure.active and exc.retryable:
                    return after_failure
                raise
        return current
