import base64
import json
import tempfile
import unittest
from pathlib import Path
import sys

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from update_service import verify_manifest, version_tuple
from vendor.life_license.crypto import canonical_json


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


class UpdateServiceTests(unittest.TestCase):
    def test_version_order(self):
        self.assertGreater(version_tuple("0.2.0"), version_tuple("0.1.9"))

    def test_signed_manifest_and_tamper_rejection(self):
        private = Ed25519PrivateKey.generate()
        public = base64.urlsafe_b64encode(private.public_key().public_bytes_raw()).decode().rstrip("=")
        manifest = {"version": "0.2.0", "packageUrl": "https://example.com/easy-download.exe", "sha256": "a" * 64}
        manifest["signature"] = b64url(private.sign(canonical_json(manifest)))
        verify_manifest(manifest, public)
        manifest["sha256"] = "b" * 64
        with self.assertRaises(ValueError):
            verify_manifest(manifest, public)


if __name__ == "__main__":
    unittest.main()
