"""Shared pytest configuration for the Nash backend test suite.

Test modules import `api.app`, which loads `api.config.settings` at import
time. To keep tests reproducible — and to avoid accidentally hitting real
infrastructure — we set safe defaults here BEFORE any `api.*` import happens.

If a test needs different values it should patch them or set env vars in its
own setUp, not rely on whatever happens to be in the developer's `.env`.
"""

from __future__ import annotations

import os

_DEFAULT_TEST_ENV = {
    # Encryption key — strong enough to satisfy length checks.
    "ENCRYPTION_KEY": "test-encryption-key-32-chars!!!!",
    "FLASK_SECRET_KEY": "test-flask-secret-32-chars-long!",
    # Don't talk to a real DynamoDB. Tests that need it will use moto.
    "DYNAMO_ENDPOINT": "",
    "DYNAMO_TABLE": "nash_tests",
    "DYNAMO_STATE_TABLE": "nash_state_tests",
    "DYNAMO_REGION": "us-east-1",
    # moto needs creds to be present; values don't matter.
    "AWS_ACCESS_KEY_ID": "testing",
    "AWS_SECRET_ACCESS_KEY": "testing",
    "AWS_SESSION_TOKEN": "testing",
    # Backboard placeholder so settings validation passes.
    "BACKBOARD_API_KEY": "test",
    # Point the Backboard API at a dead port so any unmocked catalog fetch
    # (model_catalog_service cold fill) fails instantly with connection
    # refused and falls back to the yaml provisional config, instead of
    # hitting a real Backboard or hanging on a timeout.
    "BACKBOARD_API_URL": "http://127.0.0.1:9",
}

for _key, _value in _DEFAULT_TEST_ENV.items():
    os.environ.setdefault(_key, _value)
