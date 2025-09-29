from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Dict

from app.core.logging import get_logger


logger = get_logger(__name__)


async def validate_audio_file(job_id: str, out_file: Path, db) -> bool:
    """Validate the audio file has proper size and duration. Returns True if valid."""
    try:
        # Check file size
        file_size = out_file.stat().st_size
        if file_size == 0:
            await db.update_status(job_id, "FAILED", error_message="downloaded_file_empty")
            return False
        
        if file_size < 300 * 1024:  # Less than 300KB is suspicious
            logger.warning("file too small", extra={"component": "fetch", "job_id": job_id, "size": file_size})
            return False
        
        # Use ffprobe to validate audio and duration
        probe_cmd = [
            "ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(out_file)
        ]
        result = subprocess.run(probe_cmd, capture_output=True, text=True, timeout=10)
        if result.returncode != 0:
            logger.warning("ffprobe failed", extra={"component": "fetch", "job_id": job_id})
            return False
        
        probe_data = json.loads(result.stdout)
        format_info = probe_data.get("format", {})
        streams = probe_data.get("streams", [])
        
        # Check for audio stream and duration
        has_audio = any(stream.get("codec_type") == "audio" for stream in streams)
        duration = float(format_info.get("duration", 0))
        
        if not has_audio:
            await db.update_status(job_id, "FAILED", error_message="no_audio_stream")
            return False
        
        if duration < 5.0:  # Less than 5 seconds is suspicious
            logger.warning("audio too short", extra={"component": "fetch", "job_id": job_id, "duration": duration})
            return False
            
        logger.info("file validated with ffprobe", extra={
            "component": "fetch", 
            "job_id": job_id, 
            "duration": duration, 
            "has_audio": has_audio,
            "streams_count": len(streams),
            "file_size": file_size
        })
        
        return True
        
    except Exception as e:
        logger.warning("audio validation failed", extra={"component": "fetch", "job_id": job_id, "error": str(e)})
        return False
