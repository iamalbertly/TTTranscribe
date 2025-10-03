import os, json, time, hashlib, hmac
from typing import Dict


# Environment-driven configuration
API_SECRET = os.getenv("API_SECRET", "")
_keys_raw = os.getenv("API_KEYS_JSON", "{}")
try:
    API_KEYS_OWNER_MAP: Dict[str, str] = json.loads(_keys_raw)
except Exception:
    API_KEYS_OWNER_MAP = {}

ALLOWED_API_KEYS = set(API_KEYS_OWNER_MAP.keys())


def verify_signature_shared(secret: str, timestamp: int, signature: str, method: str, path: str, body_raw_str: str) -> bool:
    if not secret:
        return False
    string_to_sign = f"{method}\n{path}\n{body_raw_str}\n{timestamp}"
    expected_signature = hmac.new(
        secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected_signature)


def verify_timestamp(timestamp: int) -> bool:
    current_time = int(time.time() * 1000)
    return abs(current_time - timestamp) <= 300000


