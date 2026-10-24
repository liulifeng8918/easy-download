import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))
from license_service import LicenseService


class LicenseServiceTests(unittest.TestCase):
    def test_missing_production_config_is_safe_and_inactive(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "license.public.json"
            service = LicenseService(config)
            status = service.status()
            self.assertFalse(status["active"])
            self.assertEqual(status["errorCode"], "CONFIG_MISSING")

    def test_placeholder_config_is_not_treated_as_production(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "license.public.json"
            config.write_text(json.dumps({"appId": "REPLACE_ME", "apiBase": "https://example.invalid", "rootPublicKey": "REPLACE_ME"}), encoding="utf-8")
            status = LicenseService(config).status()
            self.assertFalse(status["active"])
            self.assertEqual(status["errorCode"], "CONFIG_MISSING")


if __name__ == "__main__":
    unittest.main()
