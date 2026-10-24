import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from easy_download_sidecar import DEFAULT_PROXY, SidecarState, normalize_proxy


class ProxySettingsTests(unittest.TestCase):
    def test_legacy_undefined_uses_local_default(self):
        self.assertEqual(normalize_proxy("undefined"), DEFAULT_PROXY)
        self.assertEqual(normalize_proxy("null"), DEFAULT_PROXY)

    def test_empty_proxy_means_direct_connection(self):
        self.assertEqual(normalize_proxy(""), "")

    def test_malformed_proxy_is_rejected(self):
        with self.assertRaises(ValueError):
            normalize_proxy("undefined:80")
        with self.assertRaises(ValueError):
            normalize_proxy("file:///tmp/proxy")

    def test_existing_legacy_settings_are_loaded_safely(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("LOCALAPPDATA")
            os.environ["LOCALAPPDATA"] = directory
            try:
                settings = Path(directory) / "EasyDownload" / "settings.json"
                settings.parent.mkdir(parents=True)
                settings.write_text(json.dumps({"outputDir": directory, "proxy": "undefined", "autoProxy": True, "domains": []}), encoding="utf-8")
                state = SidecarState.__new__(SidecarState)
                state.settings_path = settings
                loaded = state._load_settings(Path(directory) / "Videos")
                self.assertEqual(loaded["proxy"], DEFAULT_PROXY)
                self.assertEqual(loaded["quality"], "best")
                self.assertEqual(loaded["format"], "mp4")
            finally:
                if previous is None:
                    os.environ.pop("LOCALAPPDATA", None)
                else:
                    os.environ["LOCALAPPDATA"] = previous

    def test_new_download_preferences_are_migrated_and_invalid_values_fall_back(self):
        with tempfile.TemporaryDirectory() as directory:
            settings = Path(directory) / "EasyDownload" / "settings.json"
            settings.parent.mkdir(parents=True)
            settings.write_text(json.dumps({"outputDir": directory, "quality": "not-a-quality", "format": "avi"}), encoding="utf-8")
            state = SidecarState.__new__(SidecarState)
            state.settings_path = settings
            loaded = state._load_settings(Path(directory) / "Videos")
            self.assertEqual(loaded["quality"], "best")
            self.assertEqual(loaded["format"], "mp4")


if __name__ == "__main__":
    unittest.main()
