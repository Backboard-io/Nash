"""Static-asset cache policy: immutable ONLY for content-hashed bundles.

The build declares verbatim-copied (stable-URL) files in asset-manifest.json;
fonts are structurally excluded (vite emits them unhashed to assets/fonts/).
"""

import json
import os
import tempfile
import unittest
from unittest import mock

from flask import Flask
from moto import mock_aws

import api.app as app_module


IMMUTABLE = "public, max-age=31536000, immutable"


class ServeClientFileCacheTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        static = self.tmp.name
        os.makedirs(os.path.join(static, "assets", "fonts"))
        self._write("assets/vendor.Cm6uF5pE.js", "hashed bundle")
        self._write("assets/logo.svg", "<svg/>")
        self._write("assets/fonts/Inter-Bold.woff2", "font-bytes")
        self._write("index.html", "<html/>")
        self._write("asset-manifest.json", json.dumps(["assets/logo.svg"]))

        self.static_patch = mock.patch.object(app_module, "STATIC_DIR", static)
        self.static_patch.start()
        self.addCleanup(self.static_patch.stop)
        app_module._copied_assets = None  # drop the module-level memo
        self.addCleanup(setattr, app_module, "_copied_assets", None)
        self.app = Flask(__name__)

    def _write(self, rel: str, content: str) -> None:
        with open(os.path.join(self.tmp.name, rel), "w", encoding="utf-8") as f:
            f.write(content)

    def _serve(self, path: str):
        with self.app.test_request_context(f"/{path}"):
            return app_module._serve_client_file(path)

    def test_hashed_bundle_is_immutable(self):
        resp = self._serve("assets/vendor.Cm6uF5pE.js")
        self.assertEqual(resp.headers.get("Cache-Control"), IMMUTABLE)

    def test_manifest_listed_copied_asset_is_not_immutable(self):
        resp = self._serve("assets/logo.svg")
        self.assertNotEqual(resp.headers.get("Cache-Control"), IMMUTABLE)

    def test_fonts_are_never_immutable(self):
        resp = self._serve("assets/fonts/Inter-Bold.woff2")
        self.assertNotEqual(resp.headers.get("Cache-Control"), IMMUTABLE)

    def test_missing_manifest_degrades_to_fonts_only_exclusion(self):
        os.remove(os.path.join(self.tmp.name, "asset-manifest.json"))
        app_module._copied_assets = None
        self.assertEqual(
            self._serve("assets/logo.svg").headers.get("Cache-Control"), IMMUTABLE
        )
        self.assertNotEqual(
            self._serve("assets/fonts/Inter-Bold.woff2").headers.get("Cache-Control"),
            IMMUTABLE,
        )

    def test_non_asset_file_keeps_default_cache(self):
        resp = self._serve("index.html")
        self.assertNotEqual(resp.headers.get("Cache-Control"), IMMUTABLE)


class CompressConfigTests(unittest.TestCase):
    def test_serve_spa_is_conditional_streaming_endpoint(self):
        with mock_aws():
            app = app_module.create_app()
        self.assertIn("serve_spa", app.config["COMPRESS_STREAMING_ENDPOINT_CONDITIONAL"])
        self.assertIn("static", app.config["COMPRESS_STREAMING_ENDPOINT_CONDITIONAL"])


if __name__ == "__main__":
    unittest.main()
