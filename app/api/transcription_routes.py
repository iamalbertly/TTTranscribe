from __future__ import annotations

import asyncio
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel, HttpUrl, field_validator

from app.core.config import get_settings
from app.core.logging import get_logger
from app.utils.rate_limit import allow_request
from app.services.normalize import cache_key_for_url
from app.services.fetchers import expand_tiktok_url


logger = get_logger(__name__)


class TranscribeRequest(BaseModel):
    url: HttpUrl
    idempotency_key: Optional[str] = None

    @field_validator("url")
    @classmethod
    def _ensure_tiktok(cls, v: HttpUrl):
        if "tiktok.com" not in v.host and "tiktok" not in v.host:
            raise ValueError("Only TikTok URLs are accepted")
        return v


class UploadResponse(BaseModel):
    job_id: str
    status: str


def _rate_limit_or_429():
    allowed, retry_after = allow_request()
    if not allowed:
        headers = {"Retry-After": str(retry_after)}
        raise HTTPException(status_code=429, detail={"code": "service_busy", "message": "Please try again later."}, headers=headers)


async def start_transcription(req: TranscribeRequest, state: Dict[str, Any]) -> Dict[str, Any]:
    _rate_limit_or_429()
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    
    # Fast path: check local cache for pre-existing transcript by URL key
    try:
        # Expand vm.tiktok short links before keying
        expanded = await expand_tiktok_url(str(req.url))
        key = cache_key_for_url(expanded)
    except Exception:
        key = None

    if key:
        # If we previously aliased this exact normalized URL, resolve to content hash
        root = Path(get_settings().local_storage_root)
        alias_file = root / "transcripts" / "keys" / f"{key}.txt"
        if alias_file.exists():
            try:
                resolved_hash = alias_file.read_text(encoding="utf-8").strip()
                key = resolved_hash or key
            except Exception:
                pass
        # Check local storage files
        audio_path = root / "transcripts" / "audio" / f"{key}.wav"
        transcript_path = root / "transcripts" / "transcripts" / f"{key}.json"
        if audio_path.exists() and transcript_path.exists():
            # Insert a synthetic COMPLETE job for traceability
            job_id = await db.insert_job(status="COMPLETE", request_url=str(req.url), idempotency_key=req.idempotency_key, content_hash=key)
            await db.set_storage_keys(job_id, f"audio/{key}.wav", f"transcripts/{key}.json")
            await db.set_cache_hit(job_id, True)
            return {"job_id": job_id}

    job_id = await db.insert_job(status="PENDING", request_url=str(req.url), idempotency_key=req.idempotency_key, content_hash=None)
    return {"job_id": job_id, "id": job_id, "status": "PENDING"}


async def get_transcription(job_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    
    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail={"status": "NOT_FOUND", "message": "job not found"})
    
    status = job["status"]
    if status in ("PENDING",):
        return {"status": "PENDING", "job_id": job_id, "id": job_id}
    if status in ("FETCHING_MEDIA", "NORMALIZING_MEDIA", "MEDIA_READY", "TRANSCRIBING"):
        return {"status": "RUNNING", "job_id": job_id, "id": job_id}
    if status == "FAILED":
        return _handle_failed_job(job, job_id)
    
    # COMPLETE → return direct links and preview (prefer public URLs when available)
    return await _handle_complete_job(job, job_id, state)


def _handle_failed_job(job: Dict[str, Any], job_id: str):
    """Handle failed job response."""
    error_message = job.get("error_message") or "unexpected_error"
    
    # Extract the actual error code from the error message
    if ":" in error_message:
        code = error_message.split(":", 1)[0]
        actual_error = error_message.split(":", 1)[1].strip()
    else:
        code = error_message
        actual_error = error_message
    
    # Clean up the error message for better readability
    if actual_error.startswith("ERROR:"):
        actual_error = actual_error[6:].strip()
    if actual_error.startswith("WARNING:"):
        actual_error = actual_error[8:].strip()
    
    # Map specific error codes to user-friendly messages
    error_messages = {
        "downloaded_file_too_small": "The downloaded audio file is too small or corrupted. This may be due to TikTok's content protection or network issues.",
        "downloaded_file_empty": "The downloaded file is empty. This may be due to TikTok's content protection or network issues.",
        "downloaded_file_not_found": "The downloaded file was not found. This may be due to TikTok's content protection or network issues.",
        "no_audio_stream": "No audio stream found in the downloaded file. This may be due to TikTok's content protection.",
        "audio_too_short": "The audio is too short to process. This may be due to TikTok's content protection.",
        "corrupted_audio_file": "The downloaded audio file is corrupted. This may be due to TikTok's content protection or network issues.",
        "transcode_failed": "Failed to process the audio file. This may be due to TikTok's content protection or network issues.",
        "yt_dlp_failed": "Failed to download the video. This may be due to TikTok's content protection or network issues.",
        "ffprobe_failed": "Failed to analyze the audio file. This may be due to TikTok's content protection or network issues.",
        "no_filename_in_metadata": "Failed to extract filename from download metadata. This may be due to TikTok's content protection.",
        "transcode_output_invalid": "Failed to process the audio file. This may be due to TikTok's content protection or network issues.",
        "tiktok_download_empty": "Failed to download TikTok video. This may be due to TikTok's content protection or the video being unavailable.",
        "audio_validation_failed": "The downloaded audio file failed validation. This may be due to TikTok's content protection or network issues.",
        "adapter_disabled": "TikTok adapter is disabled in configuration.",
        "extraction_error": "Failed to extract audio from the video. This may be due to TikTok's content protection or network issues.",
        "fetch_error": "Failed to fetch the video. This may be due to TikTok's content protection or network issues.",
        "normalize_error": "Failed to normalize the audio file. This may be due to TikTok's content protection or network issues.",
        "transcription_error": "Failed to transcribe the audio. This may be due to audio quality issues or network problems.",
        "pipeline_error": "Pipeline processing failed. This may be due to TikTok's content protection or network issues."
    }
    
    # Use user-friendly message if available, otherwise use the code
    user_message = error_messages.get(code, code.replace('_', ' ').title())
    
    http_status = 400 if code in ("invalid_url", "media_too_long") else 500
    # Return top-level fields to match client/test expectations
    return JSONResponse(
        status_code=http_status,
        content={
            "status": "FAILED",
            "job_id": job_id,
            "code": code,
            "message": user_message,
            "raw_error": actual_error if actual_error != code else None,
        },
    )


async def _handle_complete_job(job: Dict[str, Any], job_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """Handle complete job response."""
    audio_key = job.get("audio_storage_key")
    transcript_key = job.get("transcription_storage_key")
    content_hash = job.get("content_hash")
    storage = state.get("storage")
    audio_url = None
    transcript_url = None
    full_text = None
    text_preview = None
    
    if audio_key:
        try:
            audio_url = storage.public_url(audio_key) if storage else f"/files/{audio_key}"
        except Exception:
            audio_url = f"/files/{audio_key}"
    if transcript_key:
        try:
            transcript_url = storage.public_url(transcript_key) if storage else f"/files/{transcript_key}"
        except Exception:
            transcript_url = f"/files/{transcript_key}"
    
    # Try to get the full transcript text
    try:
        if transcript_key:
            # Try local storage first (for development)
            root = Path(get_settings().local_storage_root)
            local_path = root / "transcripts" / transcript_key
            if local_path.exists():
                import json
                payload = json.loads(local_path.read_text(encoding="utf-8"))
                full_text = payload.get("text", "") or ""
                text_preview = full_text[:200] if full_text else None
            else:
                # Try Supabase storage (for production)
                try:
                    if storage:
                        transcript_data = await storage.get(transcript_key)
                        import json
                        payload = json.loads(transcript_data.decode('utf-8'))
                        full_text = payload.get("text", "") or ""
                        text_preview = full_text[:200] if full_text else None
                except Exception:
                    # If both fail, we'll just return None for full_text
                    pass
    except Exception:
        text_preview = None
        full_text = None

    result = {
        "status": "COMPLETE",
        "job_id": job_id,
        "id": job_id,
        "audio_url": audio_url,
        "transcript_url": transcript_url,
        "text_preview": text_preview,
        "text": full_text,  # Include full transcript text
        "data": {
            "transcription_storage_key": transcript_key,
            "cache_hit": job.get("cache_hit", False),
            "content_hash": content_hash,
        },
    }
    # Back-compat top-level content_hash
    if content_hash:
        result["content_hash"] = content_hash
    return result


async def get_transcript_text(job_id: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """Get the full transcript text for a completed job."""
    db: Any = state.get("db")
    if db is None:
        raise HTTPException(status_code=503, detail={"code": "unexpected_error", "message": "service not ready"})
    
    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail={"status": "NOT_FOUND", "message": "job not found"})
    
    if job["status"] != "COMPLETE":
        raise HTTPException(status_code=400, detail={"status": "NOT_READY", "message": "transcript not ready yet"})
    
    transcript_key = job.get("transcription_storage_key")
    if not transcript_key:
        raise HTTPException(status_code=404, detail={"status": "NOT_FOUND", "message": "transcript not found"})
    
    try:
        # Try local storage first (for development)
        root = Path(get_settings().local_storage_root)
        local_path = root / "transcripts" / transcript_key
        if local_path.exists():
            import json
            payload = json.loads(local_path.read_text(encoding="utf-8"))
            return {
                "job_id": job_id,
                "text": payload.get("text", ""),
                "source_url": payload.get("source_url", ""),
                "created_at": payload.get("created_at", ""),
                "model": payload.get("model", ""),
                "content_hash": payload.get("content_hash", "")
            }
        else:
            # Try Supabase storage (for production)
            storage = state.get("storage")
            if storage:
                try:
                    transcript_data = await storage.get(transcript_key)
                    import json
                    payload = json.loads(transcript_data.decode('utf-8'))
                    return {
                        "job_id": job_id,
                        "text": payload.get("text", ""),
                        "source_url": payload.get("source_url", ""),
                        "created_at": payload.get("created_at", ""),
                        "model": payload.get("model", ""),
                        "content_hash": payload.get("content_hash", "")
                    }
                except Exception as storage_error:
                    raise HTTPException(status_code=404, detail={"status": "NOT_FOUND", "message": f"transcript file not found in storage: {str(storage_error)}"})
            else:
                raise HTTPException(status_code=404, detail={"status": "NOT_FOUND", "message": "transcript file not found"})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail={"status": "ERROR", "message": f"Failed to read transcript: {str(e)}"})


async def upload_and_transcribe(file: UploadFile, state: Dict[str, Any]) -> Dict[str, Any]:
    settings = get_settings()
    if os.getenv("ALLOW_UPLOAD_ADAPTER", "false").lower() != "true":
        raise HTTPException(status_code=404, detail={"code": "unexpected_error", "message": "not enabled"})

    _rate_limit_or_429()

    # Save upload to temp
    tmp_dir = Path("/tmp")
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tmp_path = tmp_dir / f"upload_{int(time.time())}_{file.filename}"
    data = await file.read()
    tmp_path.write_bytes(data)

    # Initialize DB
    from app.store.db import Database
    db: Any = state.get("db")
    if db is None:
        db = Database()
        await db.connect()
        state["db"] = db
    await db.init_schema()

    # Normalize and proceed from there using existing pipeline pieces
    from app.services.normalize import normalize_audio, NormalizeError
    try:
        norm_path, content_hash, duration = normalize_audio(tmp_path, job_id="upload")
    except NormalizeError as e:
        code = str(e)
        raise HTTPException(status_code=400, detail={"code": code, "message": code.replace('_', ' ')})

    # If asset exists, reuse; else upload audio and transcribe
    job_id = await db.insert_job(status="PENDING", request_url="upload", idempotency_key=None, content_hash=content_hash)

    async def proceed(job_id_local: str, norm_path_local: Path, content_hash_local: str):
        from httpx import AsyncClient
        from app.store.storage import SupabaseStorage
        from app.services.transcribe import transcribe_audio

        await db.update_status(job_id_local, "RUNNING")
        existing = await db.get_job_by_hash(content_hash_local)
        if existing and existing.get("transcription_storage_key"):
            await db.set_storage_keys(job_id_local, existing.get("audio_storage_key"), existing.get("transcription_storage_key"))
            await db.update_status(job_id_local, "COMPLETE")
            return

        storage = state.get("storage") or SupabaseStorage(AsyncClient(timeout=60))
        state["storage"] = storage
        audio_key = f"audio/{content_hash_local}.wav"
        uploaded_audio_key = await storage.put(norm_path_local, audio_key)
        await db.set_storage_keys(job_id_local, uploaded_audio_key, None)

        model = state.get("whisper_model")
        result = await transcribe_audio(norm_path_local, job_id_local, model=model)
        text = result.get("text", "").strip()
        transcript_key = f"transcripts/{content_hash_local}.json"
        tmp_json = Path(norm_path_local.parent) / "transcript.json"
        import json
        tmp_json.write_text(json.dumps({"text": text}, ensure_ascii=False), encoding="utf-8")
        uploaded_transcript_key = await storage.put(tmp_json, transcript_key)
        await db.set_storage_keys(job_id_local, uploaded_audio_key, uploaded_transcript_key)
        await db.upsert_asset(content_hash_local, uploaded_audio_key, uploaded_transcript_key)
        await db.update_status(job_id_local, "COMPLETE")

    asyncio.create_task(proceed(job_id, norm_path, content_hash))
    return {"job_id": job_id, "id": job_id, "status": "PENDING"}
