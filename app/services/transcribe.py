from __future__ import annotations

from pathlib import Path
from typing import Dict, Any, Optional

from app.core.logging import get_logger
from app.core.config import get_settings
from app.services.normalize import cache_key_for_url
from app.services.fetchers import expand_tiktok_url


logger = get_logger(__name__)


async def run_transcription_stage(job_id: str, db, storage, whisper_model, settings) -> Dict[str, Any]:
    await db.update_status(job_id, "TRANSCRIBING")
    job = await db.get_job(job_id)
    audio_key = job.get("audio_storage_key")
    content_hash = job.get("content_hash")
    if not audio_key or not content_hash:
        await db.update_status(job_id, "FAILED", error_message="unexpected_error")
        raise RuntimeError("missing audio key or content hash")

    # Download normalized audio
    from pathlib import Path
    import json
    import tempfile
    with tempfile.TemporaryDirectory(prefix="trans_") as tmpdir:
        tmp_dir = Path(tmpdir)
        wav_path = tmp_dir / "audio.wav"
        wav_bytes = await storage.get(audio_key)
        wav_path.write_bytes(wav_bytes)

        try:
            result = await _run_in_threadpool(whisper_model.transcribe, str(wav_path), fp16=False)
        except Exception as e:
            await db.update_status(job_id, "FAILED", error_message="transcription_error")
            raise

        text = result.get("text", "").strip()
        transcript_key = f"transcripts/{content_hash}.json"
        tmp_json = tmp_dir / "transcript.json"
        # Include rich metadata for reference
        meta = {
            "text": text,
            "source_url": job.get("request_url"),
            "content_hash": content_hash,
            "created_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "model": settings.whisper_model,
        }
        tmp_json.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        uploaded_transcript_key = await storage.put(tmp_json, transcript_key)

        # Upsert asset and mark complete
        await db.set_storage_keys(job_id, audio_key, uploaded_transcript_key)
        await db.upsert_asset(content_hash, audio_key, uploaded_transcript_key)
        await db.set_cache_hit(job_id, False)
        await db.update_status(job_id, "COMPLETE")
        # Write URL→hash alias to speed up future identical URL requests (local dev storage)
        # Skip in production environments like Hugging Face Spaces
        if settings.environment != "production":
            try:
                request_url = job.get("request_url")
                if request_url:
                    expanded_url = await expand_tiktok_url(str(request_url))
                    url_key = cache_key_for_url(expanded_url)
                    from pathlib import Path as _Path
                    alias_dir = _Path(".local_storage") / "transcripts" / "keys"
                    alias_dir.mkdir(parents=True, exist_ok=True)
                    (alias_dir / f"{url_key}.txt").write_text(content_hash, encoding="utf-8")
            except Exception:
                pass
        logger.info("transcription complete", extra={"component": "transcribe", "job_id": job_id, "text_len": len(text)})
        return {"text": text}


async def _run_in_threadpool(func, *args, **kwargs):
    import asyncio
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: func(*args, **kwargs))


async def transcribe_audio(audio_path: Path, job_id: str, model=None) -> Dict[str, Any]:
    """Transcribe audio file using Whisper model."""
    if model is None:
        from app.core.config import get_settings
        import whisper
        settings = get_settings()
        model = whisper.load_model(settings.whisper_model)
    
    try:
        result = await _run_in_threadpool(model.transcribe, str(audio_path), fp16=False)
        return result
    except Exception as e:
        logger.error("transcription failed", extra={"component": "transcribe", "job_id": job_id, "error": str(e)})
        raise




