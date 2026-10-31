import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'python'))
from unittest.mock import patch
from python.cookie_store import CookieStore

class CookieScopeTests(unittest.TestCase):
    def test_browser_receives_only_explicit_douyin_cookies(self):
        body = '# Netscape HTTP Cookie File\n# test\n.douyin.com\tTRUE\t/\tTRUE\t0\tsession\ttest\n.youtube.com\tTRUE\t/\tTRUE\t0\tsession\tnot-shared\n.douyin.com.evil.test\tTRUE\t/\tTRUE\t0\tx\tbad'
        with patch.object(CookieStore, 'read', return_value=body):
            result = CookieStore().browser_session_cookies('douyin.com')
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]['domain'], '.douyin.com')
            self.assertEqual(CookieStore().browser_session_cookies('youtube.com'), [])
