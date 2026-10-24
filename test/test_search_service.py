import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from python.search_service import RegisteredSiteSearch, domain_matches, normalize_domain


class SearchServiceTests(unittest.TestCase):
    def test_domain_normalization_and_allowlist(self):
        self.assertEqual(normalize_domain("https://www.youtube.com/watch?v=x"), "www.youtube.com")
        self.assertTrue(domain_matches("m.youtube.com", "youtube.com"))
        self.assertFalse(domain_matches("example.com", "youtube.com"))

    def test_youtube_results_are_host_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            ytdlp = Path(directory) / "yt-dlp.exe"
            ytdlp.write_bytes(b"test")
            service = RegisteredSiteSearch(Path(directory), ytdlp)
            payload = {"entries": [
                {"id": "good", "title": "Good", "webpage_url": "https://www.youtube.com/watch?v=good"},
                {"id": "bad", "title": "Bad", "webpage_url": "https://example.com/watch?v=bad"},
            ]}
            completed = type("Completed", (), {"returncode": 0, "stdout": json.dumps(payload), "stderr": ""})()
            with patch("python.search_service.subprocess.run", return_value=completed):
                result = service.search(keyword="test", domains=["youtube.com"])
            self.assertEqual([item["title"] for item in result["results"]], ["Good"])

    def test_registered_domain_uses_strict_web_index_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            ytdlp = Path(directory) / "yt-dlp.exe"
            ytdlp.write_bytes(b"test")
            service = RegisteredSiteSearch(Path(directory), ytdlp)
            html = '''<ul><li class="res-list"><h3 class="res-title"><a data-mdurl="https://www.douyin.com/video/123">测试视频</a></h3><p class="res-desc">公开结果</p></li><li class="res-list"><h3 class="res-title"><a data-mdurl="https://example.com/video/456">不应返回</a></h3></li></ul>'''.encode()
            class Response:
                def __enter__(self): return self
                def __exit__(self, *args): return False
                def read(self, limit): return html
            class Opener:
                def open(self, request, timeout): return Response()
            with patch("python.search_service.urllib.request.build_opener", return_value=Opener()):
                result = service.search(keyword="test", domains=["douyin.com"])
            self.assertEqual([item["url"] for item in result["results"]], ["https://www.douyin.com/video/123"])
            self.assertEqual(result["results"][0]["searchMode"], "web-index")
            self.assertEqual(result["warnings"], [])

    def test_bilibili_uses_public_site_api(self):
        with tempfile.TemporaryDirectory() as directory:
            ytdlp = Path(directory) / "yt-dlp.exe"
            ytdlp.write_bytes(b"test")
            service = RegisteredSiteSearch(Path(directory), ytdlp)
            payload = b'{"code":0,"data":{"result":[{"bvid":"BV123","title":"<em class=\\"keyword\\">\\u6d4b\\u8bd5</em>\\u89c6\\u9891","arcurl":"https://www.bilibili.com/video/BV123","description":"\\u516c\\u5f00\\u89c6\\u9891"}]}}'
            class Response:
                def __enter__(self): return self
                def __exit__(self, *args): return False
                def read(self, limit): return payload
            class Opener:
                def open(self, request, timeout): return Response()
            with patch("python.search_service.urllib.request.build_opener", return_value=Opener()):
                result = service.search(keyword="测试", domains=["bilibili.com"])
            self.assertEqual(result["results"][0]["url"], "https://www.bilibili.com/video/BV123")
            self.assertEqual(result["results"][0]["searchMode"], "site-api")


if __name__ == "__main__":
    unittest.main()
