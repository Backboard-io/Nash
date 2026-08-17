"""Tests verifying Stripe billing has been fully removed.

Marked as ``extended``; run with ``pytest -m extended tests/``.
"""

import unittest

import pytest
from moto import mock_aws

from api.app import create_app

pytestmark = pytest.mark.extended


class StripeRemovalTests(unittest.TestCase):
    """Verify billing endpoints are gone and the app still works."""

    def setUp(self):
        self._mock = mock_aws()
        self._mock.start()
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def tearDown(self):
        self._mock.stop()

    def test_billing_routes_absent_from_url_map(self):
        """No /api/billing, /api/plans, or /api/stripe rules exist.

        Checked against the url_map rather than via requests — with a built
        client/dist the SPA catch-all answers unknown paths with index.html.
        """
        rules = [str(r) for r in self.app.url_map.iter_rules()]
        for prefix in ("/api/billing", "/api/plans", "/api/stripe"):
            self.assertFalse(
                any(r.startswith(prefix) for r in rules),
                f"{prefix} routes should be gone",
            )

    def test_health_still_works(self):
        resp = self.client.get("/api/health")
        self.assertEqual(resp.status_code, 200)

    def test_no_stripe_import(self):
        """Stripe should not be importable from any api module."""
        import sys
        api_modules = [k for k in sys.modules if k.startswith("api.")]
        for mod_name in api_modules:
            mod = sys.modules[mod_name]
            if mod and hasattr(mod, "__file__") and mod.__file__:
                self.assertNotIn(
                    "stripe",
                    getattr(mod, "__dict__", {}),
                    f"{mod_name} should not import stripe",
                )


class TokenServiceSimplifiedTests(unittest.TestCase):
    """Verify token service works without billing logic."""

    def setUp(self):
        self._mock = mock_aws()
        self._mock.start()
        from api.services import state_service

        state_service.ensure_state_table()

    def tearDown(self):
        self._mock.stop()

    def test_get_token_usage_returns_dict(self):
        from api.services.token_service import get_token_usage
        result = get_token_usage("nonexistent-user")
        self.assertIsInstance(result, dict)
        self.assertIn("usageTokens", result)
        self.assertEqual(result["usageTokens"], 0)
        self.assertEqual(result["overageEnabled"], False)

    def test_record_token_usage_no_crash_on_missing_user(self):
        from api.services.token_service import record_token_usage
        # Should not raise
        record_token_usage("nonexistent-user", 100)

    def test_check_token_limit_removed(self):
        """check_token_limit should no longer exist."""
        from api.services import token_service
        self.assertFalse(hasattr(token_service, "check_token_limit"))


if __name__ == "__main__":
    unittest.main()
