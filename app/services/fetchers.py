from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from typing import Dict, Tuple
import httpx

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.audio_validation import validate_audio_file
from app.services.download_utils import try_download, hls_fallback_fetch


logger = get_logger(__name__)


class FetchError(Exception):
    pass


async def expand_tiktok_url(url: str) -> str:
    """Expand vm.tiktok.com shortlinks to canonical URLs."""
    if "vm.tiktok.com" not in url:
        return url
    
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=10.0) as client:
            response = await client.head(url)
            if response.status_code in (301, 302, 303, 307, 308):
                expanded_url = response.headers.get("location", url)
                logger.info("expanded tiktok url", extra={"original": url, "expanded": expanded_url})
                return expanded_url
    except Exception as e:
        logger.warning("failed to expand tiktok url", extra={"url": url, "error": str(e)})
    
    return url




async def fetch_media_stage(job_id: str, url: str, db, storage, settings) -> Tuple[bytes, Dict]:
    if not settings.allow_tiktok_adapter:
        await db.update_status(job_id, "FAILED", error_message="adapter_disabled")
        raise FetchError("adapter disabled")

    await db.update_status(job_id, "FETCHING_MEDIA")
    
    # Expand TikTok shortlinks
    expanded_url = await expand_tiktok_url(url)
    
    # Use TemporaryDirectory to ensure cleanup
    with tempfile.TemporaryDirectory(prefix="tiktok_") as tmpdir:
        tmp_dir = Path(tmpdir)
        template = str(tmp_dir / "%(id)s.%(ext)s")
        import sys

        USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
        AUDIO_FORMAT_PRIMARY = "m4a/bestaudio[ext=m4a]/bestaudio/best"

        # Primary attempt: prefer audio-only (m4a / aac) for speed and reliability
        cmd_primary = [
            sys.executable, "-m", "yt_dlp",
            "--user-agent", USER_AGENT,
            "--add-header", "Referer:https://www.tiktok.com/",
            "--no-check-certificates",
            "--socket-timeout", "30",
            "--retries", "5",
            "--fragment-retries", "5",
            "--no-playlist", "--no-warnings", "--no-part", "--no-cache-dir",
            "-f", AUDIO_FORMAT_PRIMARY,
            "-o", template,
            expanded_url,
            "--print-json",
        ]

        selected_selector = "primary_audio_pref"
        logger.info("fetching with yt-dlp (primary)", extra={"component": "fetch", "job_id": job_id, "cmd": cmd_primary})

        # Try primary method
        success, out_file, metadata = await try_download(job_id, cmd_primary, tmp_dir, db)

        if not success:
            # Fallback 1: bestaudio/best
            logger.info("primary download failed, trying bestaudio/best", extra={"component": "fetch", "job_id": job_id})
            cmd_best = [
                sys.executable, "-m", "yt_dlp",
                "--user-agent", USER_AGENT,
                "--add-header", "Referer:https://www.tiktok.com/",
                "--socket-timeout", "30",
                "--retries", "5",
                "--fragment-retries", "5",
                "--no-playlist", "--no-warnings", "--no-part", "--no-cache-dir",
                "-f", "bestaudio/best",
                "-o", template,
                expanded_url,
                "--print-json",
            ]
            success, out_file, metadata = await try_download(job_id, cmd_best, tmp_dir, db)
            if success:
                selected_selector = "fallback_best"

            if not success:
                # Final fallback: try HLS direct streaming
                logger.info("all selectors failed, trying HLS fallback", extra={"component": "fetch", "job_id": job_id})
                wav_output = tmp_dir / "audio.wav"
                hls_success = await hls_fallback_fetch(job_id, expanded_url, wav_output)

                if hls_success:
                    success = True
                    out_file = wav_output
                    metadata = {"_filename": str(wav_output), "extractor": "hls_fallback"}
                    selected_selector = "hls_last_resort"
                else:
                    await db.update_status(job_id, "FAILED", error_message="tiktok_download_empty")
                    raise FetchError("tiktok_download_empty")
        
        # Validate the downloaded file
        if not await validate_audio_file(job_id, out_file, db):
            raise FetchError("audio_validation_failed")
        
        # Check if we already have a WAV file from HLS fallback
        if out_file.suffix.lower() == '.wav' and metadata.get("extractor") == "hls_fallback":
            # Already have the final WAV format from HLS fallback
            logger.info("using WAV from HLS fallback", extra={"component": "fetch", "job_id": job_id, "wav_size": out_file.stat().st_size})
            data = out_file.read_bytes()
            await db.update_status(job_id, "MEDIA_READY")
            return data, metadata
        
        # Transcode to final WAV format
        wav_output = tmp_dir / "audio.wav"
        transcode_cmd = [
            "ffmpeg", "-nostdin", "-y",
            "-i", str(out_file),
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
            str(wav_output)
        ]
        
        logger.info("transcoding to WAV", extra={"component": "fetch", "job_id": job_id})
        proc = await asyncio.create_subprocess_exec(
            *transcode_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        
        if proc.returncode != 0:
            stderr_text = stderr.decode("utf-8", "ignore")
            await db.update_status(job_id, "FAILED", error_message=f"transcode_failed: {stderr_text.strip()}")
            logger.error("ffmpeg transcode failed", extra={"component": "fetch", "job_id": job_id, "stderr": stderr_text})
            raise FetchError(f"transcode_failed: {stderr_text.strip()}")
        
        if not wav_output.exists() or wav_output.stat().st_size < 1024:
            await db.update_status(job_id, "FAILED", error_message="transcode_output_invalid")
            logger.error("transcode produced invalid output", extra={"component": "fetch", "job_id": job_id})
            raise FetchError("transcode_output_invalid")
        
        logger.info("transcode successful", extra={"component": "fetch", "job_id": job_id, "wav_size": wav_output.stat().st_size})
        data = wav_output.read_bytes()
        await db.update_status(job_id, "MEDIA_READY")
        return data, metadata

