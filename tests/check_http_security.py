"""Security header contract checks for API JSON responses and static assets."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKER = (ROOT / "cloudflare" / "worker.js").read_text(encoding="utf-8")


class HttpSecurityHeaderTests(unittest.TestCase):
    def test_api_json_responses_have_browser_security_headers(self):
        block = WORKER[WORKER.index("const JSON_HEADERS = {"):WORKER.index("};", WORKER.index("const JSON_HEADERS = {"))]
        for header in (
            '"Cache-Control": "no-store"',
            '"X-Content-Type-Options": "nosniff"',
            '"X-Frame-Options": "DENY"',
            '"Referrer-Policy": "same-origin"',
            '"Permissions-Policy": "camera=(), microphone=(), geolocation=()"',
            '"Cross-Origin-Resource-Policy": "same-origin"',
        ):
            self.assertIn(header, block)

    def test_static_assets_keep_a_restrictive_content_security_policy(self):
        self.assertIn('headers.set("X-Frame-Options", "DENY")', WORKER)
        self.assertIn('headers.set("Content-Security-Policy", "default-src \'self\'; script-src \'self\';', WORKER)
        self.assertIn("object-src 'none'; base-uri 'self'; frame-ancestors 'none'", WORKER)


if __name__ == "__main__":
    unittest.main(verbosity=2)
