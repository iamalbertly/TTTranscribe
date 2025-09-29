from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path
from typing import Tuple, Optional

import ffmpeg  # type: ignore
import hashlib as _hashlib
import urllib.parse

from app.core.config import get_settings
from app.core.logging import get_logger


logger = get_logger(__name__)


class NormalizeError(Exception):
    pass


def _hash_file(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha.update(chunk)
    return sha.hexdigest()


def normalize_tiktok(url: str) -> str:
    """Normalize TikTok URLs: expand path, drop volatile params like _t/_r, keep stable bits."""
    parsed = urllib.parse.urlsplit(url)
    if "tiktok.com" not in parsed.netloc:
        raise ValueError("not_tiktok")
    # remove volatile params
    query = urllib.parse.parse_qs(parsed.query)
    for k in ["_t", "_r"]:
        query.pop(k, None)
    norm_q = urllib.parse.urlencode(sorted((k, v[0]) for k, v in query.items()))
    norm = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), norm_q, ""))
    return norm


def cache_key_for_url(url: str) -> str:
    try:
        norm = normalize_tiktok(url)
    except Exception:
        norm = url
    return _hashlib.sha256(norm.encode("utf-8")).hexdigest()


def _probe_duration_seconds(path: Path) -> float:
    probe = ffmpeg.probe(str(path))
    for stream in probe.get("streams", []):
        if stream.get("codec_type") == "audio":
            return float(stream.get("duration", 0))
    return float(probe.get("format", {}).get("duration", 0) or 0)


async def normalize_and_hash_stage(job_id: str, db, storage, settings, fetched_bytes: Optional[bytes] = None, fetched_path: Optional[Path] = None) -> Tuple[Path, str, float]:
    """
    Convert fetched media to mono 16kHz WAV, compute SHA256, measure duration.
    If duration exceeds limit, mark FAILED with media_too_long.
    If an asset exists for content_hash, mark COMPLETE and set cache_hit=true.
    Otherwise upload normalized audio, set audio_storage_key, advance MEDIA_READY then TRANSCRIBING.

    Returns (normalized_wav_path, content_hash, duration_seconds).
    """
    # Create temp workspace
    with tempfile.TemporaryDirectory(prefix="norm_") as tmpdir:
        tmp_dir = Path(tmpdir)
        if fetched_path is not None:
            input_path = Path(fetched_path)
        else:
            # Give ffmpeg a hint by using a common audio/container extension
            input_path = tmp_dir / "input.m4a"
            if fetched_bytes is None:
                # If no input provided, fail explicitly
                raise NormalizeError("missing_input")
            input_path.write_bytes(fetched_bytes)
        out_path = tmp_dir / "audio.wav"
        # Perform normalization within this TemporaryDirectory
        out_path = tmp_dir / "audio.wav"
        try:
            (
                ffmpeg
                .input(str(input_path))
                .output(str(out_path), ac=1, ar=16000, format="wav", audio_bitrate="64k")
                .overwrite_output()
                .run(quiet=True)
            )
        except ffmpeg.Error as e:
            stderr_text = getattr(e, 'stderr', b'').decode('utf-8', 'ignore')
            logger.error("ffmpeg normalize failed", extra={"component": "normalize", "job_id": job_id, "stderr": stderr_text})
            # Provide more specific error messages based on common ffmpeg errors
            if "Invalid data found when processing input" in stderr_text:
                error_msg = "corrupted_audio_file"
            elif "moov atom not found" in stderr_text:
                error_msg = "incomplete_audio_file"
            elif "No such file or directory" in stderr_text:
                error_msg = "input_file_missing"
            else:
                error_msg = f"ffmpeg_error: {stderr_text[:200]}"
            await db.update_status(job_id, "FAILED", error_message=error_msg)
            raise NormalizeError(error_msg)

        duration = _probe_duration_seconds(out_path)
        content_hash = _hash_file(out_path)
        if duration > settings.max_audio_seconds:
            await db.update_status(job_id, "FAILED", error_message="media_too_long")
            raise NormalizeError("media_too_long")

        await db.set_content_hash(job_id, content_hash)
        # Idempotency: if asset exists with transcript, complete immediately
        existing = await db.get_asset(content_hash)
        if existing and existing.get("transcription_storage_key"):
            await db.set_storage_keys(job_id, existing.get("audio_storage_key"), existing.get("transcription_storage_key"))
            await db.set_cache_hit(job_id, True)
            await db.update_status(job_id, "COMPLETE")
            return out_path, content_hash, duration

        # Upload normalized audio
        audio_key = f"audio/{content_hash}.wav"
        uploaded_audio_key = await storage.put(out_path, audio_key)
        await db.set_storage_keys(job_id, uploaded_audio_key, None)
        await db.update_status(job_id, "MEDIA_READY")
        await db.update_status(job_id, "TRANSCRIBING")
        logger.info("normalized audio", extra={"component": "normalize", "job_id": job_id, "duration": duration, "hash": content_hash})
        return out_path, content_hash, duration


def normalize_audio(input_path: Path, job_id: str) -> Tuple[Path, str, float]:
    """Synchronous version of normalize_audio for backward compatibility."""
    settings = get_settings()
    tmp_dir = Path(tempfile.mkdtemp(prefix="norm_"))
    out_path = tmp_dir / "audio.wav"

    try:
        (
            ffmpeg
            .input(str(input_path))
            .output(str(out_path), ac=1, ar=16000, format="wav", audio_bitrate="64k")
            .overwrite_output()
            .run(quiet=True)
        )
    except ffmpeg.Error as e:
        logger.error("ffmpeg normalize failed", extra={"component": "normalize", "job_id": job_id, "stderr": getattr(e, 'stderr', b'').decode('utf-8', 'ignore')})
        raise NormalizeError("unexpected_error")

    duration = _probe_duration_seconds(out_path)
    if duration > settings.max_audio_seconds:
        raise NormalizeError("media_too_long")

    content_hash = _hash_file(out_path)
    logger.info("normalized audio", extra={"component": "normalize", "job_id": job_id, "duration": duration, "hash": content_hash})
    return out_path, content_hash, duration


