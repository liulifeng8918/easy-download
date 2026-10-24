import unittest

from python.translation_service import MyMemoryTranslator, SubtitleSegment, TranslationProviderError, detect_language, parse_subtitle, render_srt


class TranslationServiceTests(unittest.TestCase):
    def test_parse_and_render_srt(self):
        source = "1\n00:00:01,000 --> 00:00:02,000\nHello <i>world</i>!\n\n"
        segments = parse_subtitle(source)
        self.assertEqual(segments[0].text, "Hello world!")
        output = render_srt([SubtitleSegment(1, segments[0].start, segments[0].end, "你好")])
        self.assertIn("00:00:01,000 --> 00:00:02,000", output)
        self.assertIn("你好", output)

    def test_parse_vtt(self):
        segments = parse_subtitle("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n", "vtt")
        self.assertEqual(segments[0].start, "00:00:01,000")

    def test_language_detection(self):
        self.assertEqual(detect_language("你好"), "zh-CN")
        self.assertEqual(detect_language("こんにちは"), "ja")
        self.assertEqual(detect_language("Hello"), "en")

    def test_public_translation_is_cached(self):
        translator = MyMemoryTranslator(max_retries=0)
        calls = []

        def fake(text, source, target):
            calls.append((text, source, target))
            return "你好"

        translator._request = fake
        segments = [SubtitleSegment(1, "00:00:01,000", "00:00:02,000", "Hello")]
        first = translator.translate_segments(segments, source="en", target="zh-CN")
        second = translator.translate_segments(segments, source="en", target="zh-CN")
        self.assertEqual(first["segments"][0].text, "你好")
        self.assertEqual(second["requests"], 0)
        self.assertEqual(len(calls), 1)

    def test_large_subtitle_is_rejected(self):
        translator = MyMemoryTranslator()
        with self.assertRaises(TranslationProviderError) as context:
            translator.translate_segments([SubtitleSegment(1, "00:00:00,000", "00:00:01,000", "x")], source="en", target="zh-CN", max_segments=0)
        self.assertEqual(context.exception.code, "SUBTITLE_TOO_LARGE")


if __name__ == "__main__":
    unittest.main()
