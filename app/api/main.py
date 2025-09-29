from __future__ import annotations

import asyncio
import shutil
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.services.fetchers import expand_tiktok_url
from app.services.normalize import cache_key_for_url
from app.api.routes import (
    TranscribeRequest, UploadResponse,
    start_transcription, get_transcription, upload_and_transcribe, get_transcript_text,
    get_failed_jobs, clear_failed_jobs, cleanup_old_failed_jobs,
    clear_all_jobs, get_all_jobs_info, clear_jobs_alias,
    get_jobs_summary, get_stuck_jobs, repair_stuck_jobs
)


logger = get_logger(__name__)


state: Dict[str, Any] = {}


def _check_tool_available(binary: str) -> bool:
    if binary == "yt-dlp":
        # Check if yt-dlp is available via python -m yt_dlp
        try:
            import subprocess
            import sys
            # Use the same Python interpreter that's running the server
            result = subprocess.run([sys.executable, "-m", "yt_dlp", "--version"], 
                                  capture_output=True, text=True, timeout=5)
            return result.returncode == 0
        except:
            return False
    path = shutil.which(binary)
    return path is not None


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    logger.info("starting app", extra={"component": "api", "job_id": "startup"})

    # Verify required tools
    yt_ok = _check_tool_available("yt-dlp")
    ffprobe_ok = _check_tool_available("ffprobe")
    logger.info(
        "tool check",
        extra={
            "component": "startup",
            "job_id": "startup",
            "yt_dlp": yt_ok,
            "ffprobe": ffprobe_ok,
        },
    )

    # Initialize DB and storage clients once
    from app.store.db import Database
    from app.store.storage import SupabaseStorage
    from httpx import AsyncClient

    db = Database()
    await db.connect()
    await db.init_schema()
    state["db"] = db

    storage = SupabaseStorage(AsyncClient(timeout=60))
    state["storage"] = storage

    # Load Whisper model once - use pre-warmed model from Dockerfile
    import whisper  # type: ignore
    import os
    # Matplotlib is optional; only configure if present
    try:
        import matplotlib
        matplotlib.use('Agg')  # Use non-interactive backend
        try:
            matplotlib.get_configdir = lambda: '/tmp/matplotlib'
        except Exception:
            pass
    except Exception:
        pass
    model_name = settings.whisper_model
    
    # Set up environment to avoid permission issues
    os.environ['XDG_CACHE_HOME'] = '/tmp/whisper-cache'
    os.environ['HOME'] = '/tmp'
    os.environ['MPLCONFIGDIR'] = '/tmp/matplotlib'
    
    # Matplotlib config handled above when available
    
    # Try to load the pre-warmed model first
    whisper_model = None
    try:
        # Check if the pre-warmed model exists
        model_path = f"/app/whisper_models_cache/{model_name}.pt"
        if os.path.exists(model_path):
            # Load directly from the pre-warmed file
            whisper_model = whisper.load_model(model_path)
            logger.info("whisper model loaded from pre-warmed file", extra={"component": "startup", "job_id": "startup", "model": model_name, "path": model_path})
        else:
            # Fallback to normal loading with cache directory
            whisper_model = whisper.load_model(model_name, download_root="/app/whisper_models_cache")
            logger.info("whisper model loaded with cache", extra={"component": "startup", "job_id": "startup", "model": model_name, "cache_dir": "/app/whisper_models_cache"})
    except Exception as e:
        logger.warning(f"Failed to load model with pre-warmed cache: {e}")
        # Final fallback: try in-memory mode
        try:
            whisper_model = whisper.load_model(model_name, in_memory=True)
            logger.info("whisper model loaded in-memory", extra={"component": "startup", "job_id": "startup", "model": model_name})
        except Exception as final_error:
            logger.error(f"Failed to load whisper model: {final_error}")
            raise RuntimeError(f"Could not load Whisper model {model_name}: {final_error}")
    
    state["whisper_model"] = whisper_model

    # Start worker loop
    from app.services.worker import run_worker_loop
    fetch_sem = asyncio.Semaphore(max(1, settings.max_concurrent_fetches))
    transcribe_sem = asyncio.Semaphore(max(1, settings.max_concurrent_transcribes))
    state["fetch_sem"] = fetch_sem
    state["transcribe_sem"] = transcribe_sem
    worker_task = asyncio.create_task(run_worker_loop(db, storage, whisper_model, settings, fetch_sem=fetch_sem, transcribe_sem=transcribe_sem))
    state["worker_task"] = worker_task

    # Rebuild URL→hash aliases from existing transcripts (dev speed boost)
    # Skip in production environments like Hugging Face Spaces
    if settings.environment != "production":
        try:
            root = Path(get_settings().local_storage_root)
            aliases_dir = root / "transcripts" / "keys"
            aliases_dir.mkdir(parents=True, exist_ok=True)
            transcripts_dir = root / "transcripts" / "transcripts"
            if transcripts_dir.exists():
                import json
                for p in transcripts_dir.glob("*.json"):
                    try:
                        payload = json.loads(p.read_text(encoding="utf-8"))
                        src = payload.get("source_url")
                        ch = payload.get("content_hash")
                        if src and ch:
                            expanded = await expand_tiktok_url(str(src))
                            url_key = cache_key_for_url(expanded)
                            alias_file = aliases_dir / f"{url_key}.txt"
                            if not alias_file.exists():
                                alias_file.write_text(ch, encoding="utf-8")
                    except Exception:
                        pass
        except Exception:
            pass

    try:
        yield
    finally:
        # Stop worker gracefully
        task = state.get("worker_task")
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        # Close any async clients tracked in state
        for key in ["storage", "db"]:
            value = state.get(key)
            close = getattr(value, "aclose", None)
            if callable(close):
                try:
                    await close()
                except Exception:
                    pass
        logger.info("shutdown complete", extra={"component": "api", "job_id": "shutdown"})


app = FastAPI(title="tiktok-transcriber-mvp", lifespan=lifespan)

# CORS
settings_for_cors = get_settings()
origins = [o.strip() for o in (settings_for_cors.cors_origins or "").split(",") if o.strip()]
allow_all = (not origins) or (origins == ["*"])
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all else origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve local storage in development for easy access to audio/transcripts
try:
    _root = Path(get_settings().local_storage_root)
    app.mount("/files/audio", StaticFiles(directory=str(_root / "transcripts" / "audio")), name="audio")
    app.mount("/files/transcripts", StaticFiles(directory=str(_root / "transcripts" / "transcripts")), name="transcripts")
except Exception:
    # Ignore mount errors if directories don't exist yet
    pass


@app.get("/health")
async def health() -> Dict[str, Any]:
    settings = get_settings()
    # check DB connectivity if Database in state
    db_ok = state.get("db") is not None
    worker_task = state.get("worker_task")
    worker_active = bool(worker_task and not worker_task.done())
    queue_counts = {}
    lease_stats = {}
    last_error = None
    db = state.get("db")
    if db is not None:
        try:
            queue_counts = await db.queue_counts_per_status()
            # Get lease statistics
            stuck_jobs = await db.get_stuck_jobs()
            lease_stats = {
                "stuck_jobs_count": len(stuck_jobs),
                "oldest_stuck_age_minutes": 0
            }
            if stuck_jobs:
                import datetime as dt
                now = dt.datetime.utcnow()
                oldest_updated = min(job.get("updated_at", now) for job in stuck_jobs)
                if isinstance(oldest_updated, str):
                    oldest_updated = dt.datetime.fromisoformat(oldest_updated.replace('Z', '+00:00'))
                lease_stats["oldest_stuck_age_minutes"] = int((now - oldest_updated).total_seconds() / 60)
            
            # Get last error from failed jobs
            failed_jobs = await db.get_failed_jobs(limit=1)
            if failed_jobs:
                last_error = failed_jobs[0].get("error_message")
        except Exception as e:
            logger.warning("health check failed to get queue stats", extra={"error": str(e)})
            queue_counts = {}
            lease_stats = {}
    
    fetch_sem = state.get("fetch_sem")
    transcribe_sem = state.get("transcribe_sem")
    fetch_stats = None
    transcribe_stats = None
    if fetch_sem:
        fetch_stats = {"current": fetch_sem._value if hasattr(fetch_sem, "_value") else None, "max": settings.max_concurrent_fetches}
    if transcribe_sem:
        transcribe_stats = {"current": transcribe_sem._value if hasattr(transcribe_sem, "_value") else None, "max": settings.max_concurrent_transcribes}
    
    return {
        "status": "ok",
        "environment": settings.environment,
        "worker_active": worker_active,
        "db_ok": db_ok,
        "yt_dlp_ok": _check_tool_available("yt-dlp"),
        "ffmpeg_ok": _check_tool_available("ffprobe"),
        "whisper_model": settings.whisper_model,
        "queue_counts": queue_counts,
        "lease_stats": lease_stats,
        "last_error": last_error,
        "semaphores": {
            "fetch": fetch_stats,
            "transcribe": transcribe_stats,
        },
    }


@app.post("/transcribe", status_code=202)
async def transcribe_endpoint(req: TranscribeRequest) -> Dict[str, Any]:
    try:
        return await start_transcription(req, state)
    except Exception as e:
        # Provide a stable error body instead of empty 500s during development
        from fastapi.responses import JSONResponse
        logger.exception("transcribe submit failed", extra={"component": "api", "job_id": "submit"})
        return JSONResponse(status_code=500, content={
            "status": "FAILED",
            "code": "unexpected_error",
            "message": "Submit failed",
            "raw_error": str(e),
        })


@app.get("/transcribe/{job_id}")
async def get_transcription_endpoint(job_id: str) -> Dict[str, Any]:
    return await get_transcription(job_id, state)


@app.get("/transcript/{job_id}")
async def get_transcript_text_endpoint(job_id: str) -> Dict[str, Any]:
    return await get_transcript_text(job_id, state)


@app.post("/transcribe/upload", status_code=202)
async def upload_and_transcribe_endpoint(file: UploadFile = File(...)) -> Dict[str, Any]:
    return await upload_and_transcribe(file, state)


# Job management endpoints
@app.get("/jobs/failed")
async def get_failed_jobs_endpoint(limit: int = 50) -> Dict[str, Any]:
    return await get_failed_jobs(limit, state)


@app.delete("/jobs/failed")
async def clear_failed_jobs_endpoint() -> Dict[str, Any]:
    return await clear_failed_jobs(state)


@app.delete("/jobs/failed/old")
async def cleanup_old_failed_jobs_endpoint(hours_old: int = 24) -> Dict[str, Any]:
    return await cleanup_old_failed_jobs(hours_old, state)


@app.delete("/jobs/all")
async def clear_all_jobs_endpoint() -> Dict[str, Any]:
    return await clear_all_jobs(state)


@app.get("/jobs/all")
async def get_all_jobs_info_endpoint() -> Dict[str, Any]:
    return await get_all_jobs_info(state)


@app.get("/jobs/clear")
@app.post("/jobs/clear")
async def clear_jobs_alias_endpoint() -> Dict[str, Any]:
    return await clear_jobs_alias(state)


@app.get("/jobs")
async def get_jobs_summary_endpoint() -> Dict[str, Any]:
    return await get_jobs_summary(state)


@app.get("/jobs/stuck")
async def get_stuck_jobs_endpoint() -> Dict[str, Any]:
    return await get_stuck_jobs(state)


@app.post("/jobs/repair")
async def repair_stuck_jobs_endpoint() -> Dict[str, Any]:
    return await repair_stuck_jobs(state)


# Removed obsolete transcribeOrGet endpoint from previous merge to avoid duplication and broken refs


# Mount Gradio UI for Hugging Face Space
try:
    import gradio as gr
    # Use the simple fixed interface as the single source of truth to avoid arg mismatches
    from .gradio_simple_fixed import simple_fixed_interface
    # Ensure Gradio is mounted at root and avoid extra arguments via queue/API panel
    app = gr.mount_gradio_app(app, simple_fixed_interface, path="/")
    logger.info("Gradio transcription UI mounted successfully")
except Exception as e:
    # If mounting fails, log but don't break the API
    logger.warning(f"Failed to mount Gradio UI: {e}")
    pass

