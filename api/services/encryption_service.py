"""AES-256-GCM encryption for BYOK API keys.

Keys are encrypted before storage and decrypted only in memory when needed
for LLM API calls. The encryption key is derived from the ENCRYPTION_KEY
env var using PBKDF2.
"""

import base64
import functools
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

from api.config import settings


@functools.lru_cache(maxsize=1)
def _derive_key() -> bytes:
    """Derive a 256-bit AES key from the configured encryption key.

    Cached: the inputs (env-derived master key + fixed salt) are process
    constants, and 100k PBKDF2 iterations are CPU-bound work that would
    otherwise run on every authenticated request — twice per chat message —
    and serialize all concurrency on the single gevent worker.
    """
    master = settings.encryption_key.encode("utf-8")
    # Use a fixed salt derived from the master key itself so the same
    # master key always produces the same AES key (deterministic).
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"nash-byok-v1",
        iterations=100_000,
    )
    return kdf.derive(master)


def encrypt_key(plaintext: str) -> str:
    """Encrypt a plaintext API key. Returns a base64-encoded string
    containing the nonce + ciphertext."""
    key = _derive_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)  # 96-bit nonce for GCM
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    # Pack nonce + ciphertext together
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt_key(encrypted: str) -> str:
    """Decrypt a base64-encoded encrypted API key back to plaintext."""
    key = _derive_key()
    raw = base64.b64decode(encrypted)
    nonce = raw[:12]
    ciphertext = raw[12:]
    aesgcm = AESGCM(key)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")
