from __future__ import annotations

import base64
import json
from datetime import datetime, timezone
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey


class VerificationError(ValueError):
    pass


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def b64url_decode(value: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except Exception as exc:
        raise VerificationError("授权签名编码无效") from exc


def unsigned(document: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in document.items() if key != "signature"}


def verify_document(document: dict[str, Any], public_key_b64: str) -> None:
    try:
        public_key = Ed25519PublicKey.from_public_bytes(b64url_decode(public_key_b64))
        public_key.verify(b64url_decode(str(document.get("signature", ""))), canonical_json(unsigned(document)))
    except Exception as exc:
        raise VerificationError("授权签名验证失败") from exc


def parse_utc(value: str) -> datetime:
    try:
        if len(value) != 20 or not value.endswith("Z"):
            raise ValueError
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        return parsed
    except Exception as exc:
        raise VerificationError("授权时间字段无效") from exc

