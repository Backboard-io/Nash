import logging
import os
from pydantic import model_validator
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


# Placeholder ENCRYPTION_KEY values shipped in source (config default + the
# value in .env.example). Booting a real deployment with any of these would
# wrap every user's BYOK secret under a key that is public in the repo, so we
# refuse to start outside local development when one is in effect.
_INSECURE_ENCRYPTION_KEYS = {
    "change-me-in-production-32chars!",
    "change_me_generate_with_openssl_rand_hex_16",
}


def _is_insecure_encryption_key(key: str) -> bool:
    k = (key or "").strip()
    return k in _INSECURE_ENCRYPTION_KEYS or "change_me" in k.lower() or "change-me" in k.lower()


def _is_local_dev(dynamo_endpoint: str) -> bool:
    """Whether we're clearly running against local infrastructure, where the
    placeholder encryption key is acceptable (no real secrets at risk)."""
    if os.environ.get("NASH_ENV", "").strip().lower() in {"dev", "development", "test", "local"}:
        return True
    endpoint = (dynamo_endpoint or "").lower()
    return "localhost" in endpoint or "127.0.0.1" in endpoint


class Settings(BaseSettings):
    host: str = "localhost"
    port: int = 3080

    backboard_api_url: str = "https://app.backboard.io/api"

    # Flask app.secret_key. Auto-generated on boot if blank — single-replica
    # deploys are fine; multi-replica deploys must set this explicitly.
    flask_secret_key: str = ""

    # OPTIONAL: Google OAuth client for the Google Workspace MCP catalog
    # (Gmail/Calendar/Drive MCP servers). Not used for sign-in — Nash has no
    # Google SSO. Leave blank to hide the Workspace catalog. The secret NEVER
    # leaves the server.
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""


    app_title: str = "Nash"
    domain_client: str = "http://localhost:3090"
    domain_server: str = "http://localhost:3080"
    help_and_faq_url: str = "/docs"
    status_page_url: str = ""
    support_url: str = ""
    allow_shared_links: bool = True

    model_config = {
        # Load .env, then .env.local on top. Values in .env.local override .env
        # (used for local dev pointing at a local Backboard). A missing .env.local
        # is silently ignored, so production (which has none) is unaffected. Real
        # OS environment variables still take precedence over both files.
        "env_file": (
            os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"),
            os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env.local"),
        ),
        "extra": "ignore",
    }
    long_message_char_threshold: int = 30_000

    # SSE text-event throttling. Every emitted chat event carries the FULL
    # accumulated answer (cumulative-snapshot contract), so per-chunk emission
    # is O(n^2) in wire bytes + sanitizer CPU. A snapshot is emitted at most
    # every throttle_ms (0 = emit every chunk, the pre-throttle behavior and
    # the rollback switch) or whenever flush_bytes of new text is pending.
    chat_sse_text_throttle_ms: int = 75
    chat_sse_text_flush_bytes: int = 8192

    # Backboard model-catalog snapshot (api/services/model_catalog_service.py).
    # The catalog is global (identical for every API key), so one process-wide
    # snapshot serves everyone. ttl is refresh-after (stale entries keep being
    # served while a background refresh runs); fail_ttl negative-caches a
    # failed refresh so an upstream outage costs one probe per window.
    model_catalog_ttl_sec: int = 3600
    model_catalog_fail_ttl_sec: int = 60
    model_catalog_fetch_timeout_sec: float = 5.0

    # DynamoDB (OSS user/key storage)
    dynamo_endpoint: str = ""  # e.g. http://localhost:8000 for local, empty for prod AWS
    dynamo_table: str = "nash"
    dynamo_state_table: str = "nash_state"
    dynamo_region: str = "us-east-1"

    # Avatar storage (dedicated S3 bucket). Empty bucket -> local-disk
    # fallback under uploads/ (dev without AWS). avatar_s3_endpoint overrides
    # the S3 endpoint for local moto (mirrors dynamo_endpoint).
    avatar_bucket: str = ""
    avatar_s3_endpoint: str = ""
    avatar_s3_region: str = "us-east-1"
    # Public base URL for stored avatars (e.g. a CloudFront domain). Empty ->
    # the bucket's virtual-hosted S3 URL.
    avatar_public_base_url: str = ""

    # Per-account file storage allowance surfaced by GET /api/files/usage and
    # rendered by the Library's storage meter. Nash does not bill on storage;
    # this is the display ceiling, overridable per deploy.
    storage_limit_bytes: int = 100 * 1024 * 1024

    # BYOK encryption
    encryption_key: str = "change-me-in-production-32chars!"

    # Session TTL — sliding window. Bumped on each request (throttled to once
    # per session_touch_min_interval_seconds) up to this maximum idle window.
    session_ttl_days: int = 30
    session_touch_min_interval_seconds: int = 300

    # Image generation (Backboard Image Tool). Per-message toggle on the
    # frontend; these are the defaults Nash sends when image generation is
    # requested. Override per-deploy via IMAGE_MODEL_PROVIDER / IMAGE_MODEL_NAME.
    image_model_provider: str = "openrouter"
    image_model_name: str = "google/gemini-3.1-flash-image-preview"

    # Voice (Backboard Voice — STT + TTS). Phase 1 ships STT-only dictation;
    # later phases add TTS playback. Defaults pick OpenAI's smaller transcribe
    # model because it streams deltas. This is the deploy default; clients may
    # override per request (validated allow-list in routes/voice.py):
    #   - openai:     gpt-4o-mini-transcribe | gpt-4o-transcribe |
    #                 gpt-4o-transcribe-diarize | whisper-1
    #   - elevenlabs: scribe_v1 | scribe_v2  (annotates coughing/music/noise)
    # Language is the BCP-47 / ISO-639-1 code.
    voice_stt_provider: str = "openai"
    voice_stt_model: str = "gpt-4o-mini-transcribe"
    voice_tts_provider: str = "openai"
    # tts-1 + alloy are OpenAI's most broadly-available TTS combo. Override
    # via env to gpt-4o-mini-tts / coral once your account has access.
    voice_tts_model: str = "tts-1"
    # `nova` is the most ChatGPT-Voice-like preset on OpenAI tts-1 (bright,
    # friendly female). Override per-deploy via VOICE_TTS_VOICE env. The
    # full list: alloy, echo, fable, onyx, nova, shimmer.
    voice_tts_voice: str = "nova"
    # ElevenLabs-only (sent when voice_tts_provider == "elevenlabs"). Must be a
    # format Backboard's allow-list accepts for ElevenLabs — plain "mp3" is
    # rejected (it's codec_samplerate_bitrate there, e.g. mp3_44100_128).
    voice_tts_output_format: str = "mp3_44100_128"
    voice_default_language: str = "en"

    # Narration ("Read aloud" per-message button). Independent of Voice Mode's
    # live TTS so each can target a different provider/model. Defaults to
    # OpenAI tts-1 — the ElevenLabs default was returning 401 Unauthorized from
    # Backboard (no/invalid ElevenLabs key on the account), which made the
    # speaker button silently do nothing. To use ElevenLabs, override all four
    # via VOICE_NARRATE_PROVIDER / _MODEL / _OUTPUT_FORMAT / _VOICE (e.g.
    # elevenlabs / eleven_flash_v2_5 / mp3_44100_128 / 21m00Tcm4TlvDq8ikWAM);
    # ElevenLabs streaming forbids WAV: use mp3/pcm/opus. `output_format` is
    # only sent for ElevenLabs — Backboard rejects it for OpenAI TTS.
    voice_narrate_provider: str = "openai"
    voice_narrate_model: str = "tts-1"
    voice_narrate_output_format: str = "mp3_44100_128"
    voice_narrate_voice: str = "nova"

    @model_validator(mode="after")
    def _reject_insecure_encryption_key(self):
        """Fail closed when the BYOK encryption key is still a known placeholder.

        Local development (NASH_ENV=dev/test or a localhost DYNAMO_ENDPOINT) is
        allowed to keep the placeholder so the app runs out of the box. Any
        other context refuses to boot with an actionable error rather than
        silently encrypting real user keys under a public default.
        """
        if _is_insecure_encryption_key(self.encryption_key) and not _is_local_dev(self.dynamo_endpoint):
            raise ValueError(
                "ENCRYPTION_KEY is set to an insecure built-in placeholder. "
                "Generate a unique key (e.g. `openssl rand -hex 16`) and set "
                "ENCRYPTION_KEY before running outside local development. "
                "For local dev, set NASH_ENV=development or point "
                "DYNAMO_ENDPOINT at localhost."
            )
        return self


settings = Settings()
