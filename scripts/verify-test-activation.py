"""Verify one remote test code through the vendored Python SDK without saving it locally."""
from __future__ import annotations

import json
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from vendor.life_license.client import LicenseClient, LicenseError


class MemoryStorage:
    def __init__(self) -> None:
        self.value: str | None = None

    def read(self) -> str | None:
        return self.value

    def write(self, value: str) -> None:
        self.value = value

    def clear(self) -> None:
        self.value = None


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    config = json.loads((root / "config" / "license.public.json").read_text(encoding="utf-8"))
    code = next(line.split(". ", 1)[1].strip() for line in Path(r"D:\xiazai\MyDrivers\backup\easy-download-test-activation-codes.txt").read_text(encoding="utf-8").splitlines() if ". " in line)
    storage = MemoryStorage()
    client = LicenseClient(
        app_id=config["appId"],
        api_base=config["apiBase"],
        root_public_key=config["rootPublicKey"],
        storage=storage,
        fingerprint=lambda: "1" * 64,
        sdk_version="0.1.0-test",
    )
    status = client.activate(code)
    if not status.active:
        raise RuntimeError("valid test code did not activate")
    validated = client.validate()
    if not validated.active:
        raise RuntimeError("valid test code did not validate")
    tampered = json.loads(storage.value or "{}")
    tampered["response"]["machineLease"]["deviceLimit"] = 9
    storage.value = json.dumps(tampered, ensure_ascii=False, separators=(",", ":"))
    tampered_status = client.status()
    if tampered_status.active or tampered_status.error_code != "SIGNATURE_INVALID":
        raise RuntimeError("tampered local lease was accepted")

    payload = json.dumps({
        "appId": config["appId"],
        "code": code,
        "deviceFingerprint": "2" * 64,
        "sdk": {"name": "python", "version": "0.1.0-test"},
    }).encode("utf-8")
    request = Request(f"{config['apiBase']}/v1/activate", data=payload, headers={"content-type": "application/json", "user-agent": "easy-download-test/0.1"}, method="POST")
    try:
        urlopen(request, timeout=20)
    except HTTPError as error:
        if error.code != 409:
            raise RuntimeError(f"second machine expected 409, got {error.code}") from error
    else:
        raise RuntimeError("second machine unexpectedly activated")
    print("OK: test code activation, online validation, cache tamper rejection and second-machine rejection passed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (LicenseError, OSError, ValueError, KeyError) as error:
        print(f"ERROR: {error}")
        raise SystemExit(1)
