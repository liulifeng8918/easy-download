import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from python.cookie_store import CookieStore
from python.download_engine import DownloadManager


class SubtitleMuxTests(unittest.TestCase):
    def test_muxes_translated_srt_as_mp4_subtitle_track(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bin").mkdir()
            (root / "bin" / "yt-dlp.exe").write_bytes(b"yt-dlp")
            (root / "bin" / "ffmpeg.exe").write_bytes(b"ffmpeg")
            video = root / "source.mp4"
            subtitle = root / "source.zh-CN.srt"
            video.write_bytes(b"video")
            subtitle.write_text("1\n00:00:00,000 --> 00:00:01,000\n你好\n", encoding="utf-8")
            manager = DownloadManager(root, CookieStore())

            def fake_run(command, **kwargs):
                Path(command[-1]).write_bytes(b"muxed")
                return type("Completed", (), {"returncode": 0, "stdout": "", "stderr": ""})()

            with patch("python.download_engine.subprocess.run", side_effect=fake_run) as run:
                output = manager.merge_subtitle_track(video_path=str(video), subtitle_path=str(subtitle), target_language="zh-CN")

            self.assertTrue(output.is_file())
            command = run.call_args.args[0]
            self.assertIn("-map", command)
            self.assertIn("1:0", command)
            self.assertIn("mov_text", command)


if __name__ == "__main__":
    unittest.main()
