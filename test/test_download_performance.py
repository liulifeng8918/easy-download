import io
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from download_resources import DownloadBudget, resource_profile, GIB
from download_engine import DownloadManager, Task


class DownloadPerformanceTests(unittest.TestCase):
    def manager(self):
        store = type("Store", (), {"temporary_file": lambda self: (None, lambda: None)})()
        return DownloadManager(ROOT, store)

    def test_hardware_thresholds(self):
        self.assertEqual(resource_profile(2, 16 * GIB)["budget"], 1)
        self.assertEqual(resource_profile(16, GIB // 2)["budget"], 1)
        self.assertEqual(resource_profile(4, 8 * GIB)["budget"], 2)
        self.assertEqual(resource_profile(16, 2 * GIB)["budget"], 2)
        self.assertEqual(resource_profile(16, 8 * GIB)["budget"], 4)
        with patch("download_resources.available_memory", return_value=None):
            self.assertEqual(resource_profile(16)["budget"], 2)

    def test_multiple_downloads_share_budget_and_return_it_after_error(self):
        budget = DownloadBudget(lambda: {"budget": 2, "chunk_mib": 2})
        peak = [0]
        def worker():
            with budget.reserve() as profile:
                peak[0] = max(peak[0], budget.used)
                self.assertLessEqual(profile["fragments"], 2)
                time.sleep(0.01)
        threads = [threading.Thread(target=worker) for _ in range(6)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=3)
        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertLessEqual(peak[0], 2)
        with self.assertRaises(ValueError):
            with budget.reserve(): raise ValueError("simulated failure")
        self.assertEqual(budget.used, 0)

    def test_validated_http_route_uses_resource_sized_chunks_and_fallback(self):
        manager = self.manager()
        arguments = dict(url="https://www.eporner.com/video-test/title/", quality="best", output_dir="D:/downloads", proxy="", auto_proxy=True, resources={"fragments": 2, "chunk_mib": 2})
        cmd, _, direct = manager._build_command(**arguments)
        self.assertFalse(direct)
        self.assertEqual(cmd[cmd.index("--http-chunk-size") + 1], "2M")
        self.assertEqual(cmd[cmd.index("--concurrent-fragments") + 1], "2")
        fallback, _, _ = manager._build_command(**arguments, compatible=True)
        self.assertNotIn("--http-chunk-size", fallback)
        self.assertEqual(fallback[fallback.index("--concurrent-fragments") + 1], "1")
        unknown, _, _ = manager._build_command(**{**arguments, "url": "https://example.com/video.mp4"})
        self.assertNotIn("--http-chunk-size", unknown)
        domestic, _, _ = manager._build_command(**{**arguments, "url": "https://v1.douyinvod.com/video.mp4"})
        self.assertNotIn("--http-chunk-size", domestic, "same-media benchmark found no chunking benefit on Douyin")

    def test_preflight_cache_is_single_use_and_bound_to_route_quality_and_url(self):
        manager = self.manager()
        task = Task("one", "https://www.youtube.com/watch?v=test", "720", "D:/downloads")
        info = {"id": "test", "formats": [{"url": "https://cdn.test/media?private"}], "title": "sample"}
        fingerprint = (task.url, task.quality, "proxy", True)
        task.resolution_token = manager._cache_info(info, fingerprint)
        self.assertNotIn("resolution_token", task.payload())
        self.assertEqual(json.loads(manager._take_info(task, "proxy", True))["id"], "test")
        self.assertIsNone(manager._take_info(task, "proxy", True))
        task.resolution_token = manager._cache_info(info, fingerprint)
        self.assertIsNone(manager._take_info(task, "different-proxy", True))
        task.resolution_token = manager._cache_info(info, fingerprint)
        manager.invalidate_preflight()
        self.assertIsNone(manager._take_info(task, "proxy", True))
        task.resolution_token = manager._cache_info(info, fingerprint)
        with patch("download_engine.time.monotonic", return_value=time.monotonic() + 61):
            self.assertIsNone(manager._take_info(task, "proxy", True))

    def test_reused_info_goes_through_stdin_not_a_second_extraction(self):
        manager = self.manager()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory, "video.mp4")
            task = Task("one", "https://www.youtube.com/watch?v=test", "720", directory)
            task.resolution_token = manager._cache_info({"id": "test", "title": "中文音乐", "formats": [{"url": "https://cdn.test/media"}]}, (task.url, "720", "", True))
            class Input(io.StringIO):
                def close(self): self.contents = self.getvalue(); super().close()
            process = type("Process", (), {"pid": 1, "stdin": Input(), "stdout": iter([f'__ED_EXPECTED__{output}\n', '__ED_PROGRESS__{"downloaded":10,"total":20,"speed":2,"eta":5}\n']), "wait": lambda self: 0})()
            output.write_bytes(b"sample")
            with patch("download_engine.subprocess.Popen", return_value=process) as start:
                manager._run(task, "", True)
            cmd = start.call_args.args[0]
            self.assertIn("--load-info-json", cmd)
            self.assertNotIn(task.url, cmd)
            self.assertEqual(json.loads(process.stdin.contents)["id"], "test")
            self.assertTrue(process.stdin.contents.isascii())
            self.assertEqual(json.loads(process.stdin.contents)["title"], "中文音乐")
            self.assertEqual(task.speed_bytes, 2)
            self.assertEqual(task.status, "completed")

    def test_network_fragment_failure_retries_once_with_safe_settings(self):
        manager = self.manager()
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory, "fallback.mp4")
            task = Task("fallback", "https://example.com/video", "best", directory)
            first = type("Process", (), {"pid": 1, "stdout": iter(["ERROR: fragment request HTTP Error 429\n"]), "wait": lambda self: 1})()
            def finish(_): output.write_bytes(b"sample"); return 0
            second = type("Process", (), {"pid": 2, "stdout": iter([f"__ED_EXPECTED__{output}\n"]), "wait": finish})()
            with patch("download_engine.subprocess.Popen", side_effect=[first, second]) as start:
                manager._run(task, "", True)
            self.assertEqual(start.call_count, 2)
            retry = start.call_args_list[1].args[0]
            self.assertEqual(retry[retry.index("--concurrent-fragments") + 1], "1")
            self.assertNotIn("--http-chunk-size", retry)
            self.assertEqual(task.status, "completed")


if __name__ == "__main__": unittest.main()
