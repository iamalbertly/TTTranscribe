from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Dict, Tuple

from app.core.logging import get_logger


logger = get_logger(__name__)


async def try_download(job_id: str, cmd: list, tmp_dir: Path, db) -> Tuple[bool, Path, Dict]:
    """Try downloading with the given command. Returns (success, file_path, metadata)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        
        if proc.returncode != 0:
            stderr_text = stderr.decode("utf-8", "ignore")
            logger.warning("yt-dlp failed", extra={"component": "fetch", "job_id": job_id, "stderr": stderr_text})
            return False, None, {}
        
        # Parse metadata
        try:
            metadata = json.loads(stdout.decode("utf-8", "ignore").splitlines()[-1])
        except Exception:
            metadata = {}
        
        # Find the downloaded file
        filename = metadata.get("_filename") or metadata.get("requested_downloads", [{}])[0].get("_filename")
        if not filename:
            logger.warning("no filename in metadata", extra={"component": "fetch", "job_id": job_id})
            return False, None, metadata
        
        out_file = Path(filename)
        if not out_file.exists():
            logger.warning("downloaded file not found", extra={"component": "fetch", "job_id": job_id, "filename": filename})
            return False, None, metadata
        
        # Check if the file is too small (likely a failed download)
        file_size = out_file.stat().st_size
        if file_size < 100 * 1024:  # Less than 100KB is suspicious
            logger.warning("downloaded file too small", extra={"component": "fetch", "job_id": job_id, "size": file_size})
            return False, None, metadata
        
        return True, out_file, metadata
        
    except Exception as e:
        logger.warning("download attempt failed", extra={"component": "fetch", "job_id": job_id, "error": str(e)})
        return False, None, {}


async def hls_fallback_fetch(job_id: str, url: str, output_path: Path) -> bool:
    """Dead-simple fallback: get JSON metadata and stream direct URL to FFmpeg."""
    try:
        logger.info("attempting hls fallback", extra={"component": "fetch", "job_id": job_id})
        
        # Get JSON metadata to find direct audio URL
        import sys
        json_cmd = [
            sys.executable, "-m", "yt_dlp",
            "--dump-json", "--no-warnings", "--quiet",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
            url
        ]
        
        proc = await asyncio.create_subprocess_exec(
            *json_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        
        if proc.returncode != 0:
            logger.error("hls fallback failed to get JSON", extra={"component": "fetch", "job_id": job_id, "stderr": stderr.decode()})
            return False
        
        try:
            metadata = json.loads(stdout.decode())
        except json.JSONDecodeError:
            logger.error("hls fallback got invalid JSON", extra={"component": "fetch", "job_id": job_id})
            return False
        
        # Find best audio format URL
        formats = metadata.get("formats", [])
        audio_url = None
        
        # Look for audio-only formats first
        for fmt in formats:
            if fmt.get("acodec") != "none" and fmt.get("vcodec") == "none":
                audio_url = fmt.get("url")
                if audio_url:
                    break
        
        # Fallback to any format with audio
        if not audio_url:
            for fmt in formats:
                if fmt.get("acodec") != "none":
                    audio_url = fmt.get("url")
                    if audio_url:
                        break
        
        if not audio_url:
            logger.error("hls fallback found no audio URL", extra={"component": "fetch", "job_id": job_id})
            return False
        
        # Stream directly to FFmpeg
        ffmpeg_cmd = [
            "ffmpeg", "-nostdin", "-y",
            "-i", audio_url,
            "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            str(output_path)
        ]
        
        logger.info("hls fallback streaming to ffmpeg", extra={"component": "fetch", "job_id": job_id, "audio_url": audio_url[:100] + "..."})
        proc = await asyncio.create_subprocess_exec(
            *ffmpeg_cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        
        if proc.returncode != 0:
            logger.error("hls fallback ffmpeg failed", extra={"component": "fetch", "job_id": job_id, "stderr": stderr.decode()})
            return False
        
        # Validate the output
        if output_path.exists() and output_path.stat().st_size > 1024:
            logger.info("hls fallback succeeded", extra={"component": "fetch", "job_id": job_id, "size": output_path.stat().st_size})
            return True
        else:
            logger.error("hls fallback produced invalid output", extra={"component": "fetch", "job_id": job_id})
            return False
            
    except Exception as e:
        logger.error("hls fallback exception", extra={"component": "fetch", "job_id": job_id, "error": str(e)})
        return False
