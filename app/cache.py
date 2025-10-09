import os
import json
import time
import hashlib
from typing import Optional, Dict, Any


# Filesystem cache configuration
CACHE_DIR = os.environ.get("TRANSCRIPT_CACHE_DIR", "/tmp/transcripts_cache")
CACHE_TTL_SEC = int(os.environ.get("TRANSCRIPT_CACHE_TTL_SEC", "86400"))  # 24h default


def _safe_mkdir(path: str) -> None:
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        # Fallback to /tmp if configured directory is not writable
        fallback = "/tmp/transcripts_cache"
        if path != fallback:
            try:
                os.makedirs(fallback, exist_ok=True)
                global CACHE_DIR
                CACHE_DIR = fallback
            except Exception:
                pass


def cache_key_for_url(expanded_url: str) -> str:
    """Prefer TikTok video_id when present; fallback to sha256 of canonical url."""
    vid = "unknown"
    if "tiktok.com" in expanded_url and "/video/" in expanded_url:
        try:
            vid = expanded_url.split("/video/")[1].split("?")[0]
        except Exception:
            vid = "unknown"
    if vid and vid != "unknown":
        return f"video_{vid}.json"
    return hashlib.sha256(expanded_url.encode("utf-8")).hexdigest() + ".json"


def read_cache(expanded_url: str, logger) -> Optional[Dict[str, Any]]:
    _safe_mkdir(CACHE_DIR)
    key = cache_key_for_url(expanded_url)
    fp = os.path.join(CACHE_DIR, key)
    try:
        if os.path.exists(fp):
            age = time.time() - os.path.getmtime(fp)
            if age <= CACHE_TTL_SEC:
                with open(fp, "r", encoding="utf-8") as f:
                    data = json.load(f)
                logger.log("info", "cache_hit", cache_key=key, age_sec=int(age))
                return data
            else:
                logger.log("info", "cache_stale", cache_key=key, age_sec=int(age))
        return None
    except Exception as e:
        logger.log("warning", "cache_read_failed", error=str(e))
        return None


def write_cache(expanded_url: str, payload: Dict[str, Any], logger) -> None:
    _safe_mkdir(CACHE_DIR)
    key = cache_key_for_url(expanded_url)
    fp = os.path.join(CACHE_DIR, key)
    try:
        with open(fp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        logger.log("info", "cache_write_ok", cache_key=key, size=len(json.dumps(payload)))
    except Exception as e:
        logger.log("warning", "cache_write_failed", error=str(e))


