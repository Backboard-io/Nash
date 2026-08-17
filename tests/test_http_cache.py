"""api/utils/http_cache: exact-match conditional JSON with no-cache semantics."""

import unittest

from flask import Flask

from api.utils import http_cache


class EtagMatchTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    def _matches(self, header: str | None, etag: str = "abc123") -> bool:
        headers = {"If-None-Match": header} if header is not None else {}
        with self.app.test_request_context(headers=headers):
            return http_cache.etag_matches(etag)

    def test_plain_and_compress_suffixed_forms_match(self):
        self.assertTrue(self._matches('"abc123"'))
        self.assertTrue(self._matches('"abc123:br"'))
        self.assertTrue(self._matches('"abc123:gzip"'))

    def test_non_matching_or_composite_headers_miss(self):
        self.assertFalse(self._matches(None))
        self.assertFalse(self._matches('"other"'))
        self.assertFalse(self._matches("*"))
        self.assertFalse(self._matches('"abc123", "other"'))  # no list parsing: safe miss
        self.assertFalse(self._matches('W/"abc123"'))
        self.assertFalse(self._matches('"abc123:zstd"'))

    def test_no_request_context_is_a_miss(self):
        self.assertFalse(http_cache.etag_matches("abc123"))


class ConditionalJsonTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)

    def test_miss_serves_body_with_etag_and_no_cache(self):
        with self.app.test_request_context():
            resp = http_cache.conditional_json(b'{"a":1}', "abc123")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_data(), b'{"a":1}')
        self.assertEqual(resp.mimetype, "application/json")
        self.assertEqual(resp.get_etag(), ("abc123", False))
        self.assertTrue(resp.cache_control.private)
        self.assertTrue(resp.cache_control.no_cache)

    def test_hit_returns_empty_304_echoing_the_clients_validator(self):
        with self.app.test_request_context(headers={"If-None-Match": '"abc123:br"'}):
            resp = http_cache.conditional_json(b'{"a":1}', "abc123")
        self.assertEqual(resp.status_code, 304)
        self.assertEqual(resp.get_data(), b"")
        self.assertEqual(resp.headers["ETag"], '"abc123:br"')
        self.assertTrue(resp.cache_control.private)
        self.assertTrue(resp.cache_control.no_cache)

    def test_max_age_mode_sets_max_age_instead_of_no_cache(self):
        with self.app.test_request_context():
            resp = http_cache.conditional_json(b"{}", "abc123", max_age=300)
        self.assertEqual(resp.cache_control.max_age, 300)
        self.assertFalse(resp.cache_control.no_cache)

    def test_no_request_context_serves_plain_response(self):
        resp = http_cache.conditional_json(b"{}", "abc123")
        self.assertEqual(resp.status_code, 200)


if __name__ == "__main__":
    unittest.main()
