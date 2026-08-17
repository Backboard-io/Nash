"""Image-generation model resolution against the live Backboard catalog."""

from unittest.mock import patch

from api.routes import chat


# A catalog like Backboard's /models/image/all would return for the user's key.
_CATALOG = {
    "openrouter/google/gemini-3.1-flash-image-preview": True,
    "openai/gpt-image-1": True,
}


def test_resolve_image_config_accepts_model_in_catalog():
    with patch.object(chat, "_fetch_image_models", return_value=_CATALOG):
        assert chat._resolve_image_config(
            "openrouter/google/gemini-3.1-flash-image-preview", api_key="k"
        ) == ("openrouter", "google/gemini-3.1-flash-image-preview")


def test_resolve_image_config_falls_back_for_models_not_in_catalog():
    original_provider = chat.settings.image_model_provider
    original_name = chat.settings.image_model_name
    chat.settings.image_model_provider = "openrouter"
    chat.settings.image_model_name = "google/gemini-3.1-flash-image-preview"
    try:
        with patch.object(chat, "_fetch_image_models", return_value=_CATALOG):
            # A model not in the catalog falls back to the deploy default
            # (which IS in the catalog).
            assert chat._resolve_image_config(
                "openrouter/google/gemini-2.5-flash-image-preview", api_key="k"
            ) == ("openrouter", "google/gemini-3.1-flash-image-preview")
    finally:
        chat.settings.image_model_provider = original_provider
        chat.settings.image_model_name = original_name


def test_resolve_image_config_uses_first_catalog_model_when_default_missing():
    original_provider = chat.settings.image_model_provider
    original_name = chat.settings.image_model_name
    # Deploy default is not in the catalog.
    chat.settings.image_model_provider = "openrouter"
    chat.settings.image_model_name = "removed/model"
    try:
        with patch.object(chat, "_fetch_image_models", return_value=_CATALOG):
            provider, name = chat._resolve_image_config("bad/spec", api_key="k")
            assert f"{provider}/{name}" in _CATALOG
    finally:
        chat.settings.image_model_provider = original_provider
        chat.settings.image_model_name = original_name


def test_resolve_image_config_accepts_request_spec_without_catalog():
    # No API key → no catalog → trust the requested spec (can't validate).
    with patch.object(chat, "_fetch_image_models", return_value={}):
        assert chat._resolve_image_config(
            "openrouter/google/gemini-3.1-flash-image-preview", api_key=""
        ) == ("openrouter", "google/gemini-3.1-flash-image-preview")
