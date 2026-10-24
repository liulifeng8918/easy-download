import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
from download_engine import DownloadManager, Task, classify_download_error


class DownloadHistoryTests(unittest.TestCase):
    def test_browser_media_filename_is_safe_and_hidden_from_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_manager(directory)
            with patch("download_engine.threading.Thread"):
                task = manager.create(url="https://v.douyin.com/abc/", engine_url="https://cdn.example/media?signature=private", source_title='100% 视频/测试:*', source_id="123", quality="best", output_dir=directory)
            self.assertEqual(task.output_name, "100%% 视频_测试__ [123].%(ext)s")
            self.assertNotIn("engine_url", task.payload())
            self.assertNotIn("output_name", task.payload())
            command, _, _ = manager._build_command(url=task.engine_url, quality="best", output_dir=directory, proxy="", auto_proxy=True, output_name=task.output_name)
            self.assertIn("after_move:__ED_OUTPUT__%(filepath)s", command)
            self.assertNotIn("signature", command[command.index("-o") + 1])

    def test_user_facing_error_categories(self):
        self.assertEqual(classify_download_error("ERROR: Unsupported URL")["code"], "UNSUPPORTED_URL")
        self.assertEqual(classify_download_error("The web client only works when logged-in")["code"], "LOGIN_REQUIRED")
        self.assertEqual(classify_download_error("HTTP Error 403: Forbidden")["code"], "ACCESS_RESTRICTED")
        self.assertEqual(classify_download_error("Requested format is not available")["code"], "FORMAT_UNAVAILABLE")

    def test_platform_name_is_present_in_actionable_errors(self):
        login = classify_download_error("login required", hostname="www.instagram.com")
        proxy = classify_download_error("Unable to connect", hostname="www.tiktok.com")
        unsupported = classify_download_error("No suitable extractor", hostname="www.xiaohongshu.com")
        self.assertEqual(login["code"], "LOGIN_REQUIRED")
        self.assertIn("Instagram", login["message"])
        self.assertIn("TikTok", proxy["message"])
        self.assertIn("小红书", unsupported["message"])

    def test_bundled_js_runtime_is_added_to_engine_command(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_manager(directory)
            manager._js_runtime = {"name": "node", "path": "C:/EasyDownload/runtime/node.exe", "source": "bundled"}
            command, environment, use_proxy = manager._build_command(url="https://www.youtube.com/watch?v=test", quality="best", output_dir=directory, proxy="", auto_proxy=True)
            self.assertIn("--js-runtimes", command)
            self.assertIn("node", command)
            self.assertFalse(use_proxy)
            first_path = environment["PATH"].split(__import__("os").pathsep, 1)[0].lower().replace("\\", "/")
            self.assertTrue(first_path.endswith("easydownload/runtime"))

    def test_browser_media_request_carries_page_context(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_manager(directory)
            command, _, _ = manager._build_command(
                url="https://v26-weba.douyinvod.com/video.mp4?signature=short-lived",
                quality="best",
                output_dir=directory,
                proxy="",
                auto_proxy=True,
                referer="https://www.douyin.com/video/123",
                user_agent="Mozilla/5.0 EasyDownloadTest",
            )
            self.assertEqual(command[command.index("--referer") + 1], "https://www.douyin.com/video/123")
            self.assertEqual(command[command.index("--user-agent") + 1], "Mozilla/5.0 EasyDownloadTest")

    def test_clear_history_removes_completed_and_failed_but_keeps_active(self):
        manager = DownloadManager.__new__(DownloadManager)
        manager._lock = __import__("threading").Lock()
        manager._tasks = {
            "completed": Task("completed", "https://example.com/a", "best", "C:/downloads", status="completed"),
            "failed": Task("failed", "https://example.com/b", "best", "C:/downloads", status="failed"),
            "running": Task("running", "https://example.com/c", "best", "C:/downloads", status="running"),
            "queued": Task("queued", "https://example.com/d", "best", "C:/downloads", status="queued"),
        }

        self.assertEqual(manager.clear_history(), 2)
        self.assertEqual(set(manager._tasks), {"running", "queued"})
        self.assertEqual(manager.clear_completed(), 0)

    def test_organize_outputs_moves_media_into_site_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory, "raw.mp4")
            source.write_bytes(b"video")
            manager = self.make_manager(directory)
            moved = manager.organize_outputs([
                {"outputPath": str(source), "outputDir": directory, "title": "旅行/日记", "url": "https://www.youtube.com/watch?v=1"},
            ], naming="date-title", category="site")
            self.assertEqual(len(moved), 1)
            target = Path(moved[0]["target"])
            self.assertTrue(target.is_file())
            self.assertEqual(target.parent.name, "youtube.com")
            self.assertIn("旅行_日记", target.name)

    def make_manager(self, directory):
        manager = DownloadManager.__new__(DownloadManager)
        manager.project_root = ROOT
        manager.ytdlp = ROOT / "bin" / "yt-dlp.exe"
        manager.ffmpeg = manager.ytdlp.parent
        manager._lock = threading.Lock()
        manager._engine_version = None
        manager.cookie_store = type("CookieStoreStub", (), {"temporary_file": lambda self: (None, lambda: None)})()
        manager._tasks = {}
        return manager

    def test_zero_exit_without_output_is_failed(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_manager(directory)
            task = Task("empty", "https://example.com/video", "best", directory)
            process = type("ProcessStub", (), {"pid": 1, "stdout": iter(["[download] 100%\n"]), "wait": lambda self: 0})()
            with patch("download_engine.subprocess.Popen", return_value=process):
                manager._run(task, "", False)
            self.assertEqual(task.status, "failed")
            self.assertIn("没有生成新的视频文件", task.error)

    def test_zero_exit_with_new_media_file_is_completed(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_manager(directory)
            task = Task("media", "https://example.com/video", "best", directory)

            def finish(_process):
                Path(directory, "video.mp4").write_bytes(b"video")
                return 0

            process = type("ProcessStub", (), {"pid": 1, "stdout": iter(["[download] 100%\n"]), "wait": finish})()
            with patch("download_engine.subprocess.Popen", return_value=process):
                manager._run(task, "", False)
            self.assertEqual(task.status, "completed")
            self.assertEqual(Path(task.output_path).name, "video.mp4")

    def test_reported_unicode_output_path_is_completed(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_manager(directory)
            task = Task("reported", "https://example.com/video", "best", directory)
            output = Path(directory, "中文视频 [123].mp4")

            def finish(_process):
                output.write_bytes(b"video")
                return 0

            process = type("ProcessStub", (), {"pid": 1, "stdout": iter([f"__ED_OUTPUT__{output}\n"]), "wait": finish})()
            with patch("download_engine.subprocess.Popen", return_value=process):
                manager._run(task, "", False)
            self.assertEqual(task.status, "completed")
            self.assertEqual(Path(task.output_path).name, output.name)

    def test_reported_path_mismatch_uses_single_changed_media_file(self):
        with tempfile.TemporaryDirectory() as directory:
            manager = self.make_manager(directory)
            task = Task("mismatch", "https://example.com/video", "best", directory)
            output = Path(directory, "actual.mp4")

            def finish(_process):
                output.write_bytes(b"video")
                return 0

            process = type("ProcessStub", (), {"pid": 1, "stdout": iter(["__ED_OUTPUT__C:/different/representation.mp4\n"]), "wait": finish})()
            with patch("download_engine.subprocess.Popen", return_value=process):
                manager._run(task, "", False)
            self.assertEqual(task.status, "completed")
            self.assertEqual(Path(task.output_path).name, output.name)


if __name__ == "__main__":
    unittest.main()
