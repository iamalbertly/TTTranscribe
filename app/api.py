import os, json, time, tempfile, hashlib, uuid, subprocess, traceback
from datetime import datetime, timezone

import gradio as gr
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.responses import JSONResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware

from .logging_utils import UILogHandler, GCP_LOGGER
from .auth import API_SECRET, ALLOWED_API_KEYS, API_KEYS_OWNER_MAP, verify_signature_shared, verify_timestamp
from .rate_limit import get_rate_limiter
from .network import expand_tiktok_url
from .media import yt_dlp_m4a, to_wav_normalized
from .transcription import transcribe_wav
from .jobs import JobsRegistry, mount_job_endpoints
from .ui import build_gradio_ui
from .cache import read_cache, write_cache
from .types import TranscribeResponse


logger = UILogHandler("tttranscribe")
try:
    from .build_info import GIT_SHA as _STAMPED_SHA, BUILD_TIME as _STAMPED_TIME
except Exception:
    _STAMPED_SHA, _STAMPED_TIME = None, None

def _git_sha() -> str:
    if _STAMPED_SHA:
        return _STAMPED_SHA
    env_sha = os.getenv("GIT_REV")
    if env_sha:
        return env_sha
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except Exception:
        return "unknown"

GIT_REV = _git_sha()



def process_tiktok_url(url: str) -> TranscribeResponse:
    start_time = time.time()
    request_id = str(uuid.uuid4())
    try:
        logger.log("info", "processing tiktok url", request_id=request_id, url=url)
        expanded = expand_tiktok_url(url)

        # Check cache before heavy work
        cached = read_cache(expanded, logger)
        if cached:
            # Return cached response while preserving a new request_id and elapsed timing
            elapsed_ms = int((time.time() - start_time) * 1000)
            return TranscribeResponse(
                request_id=request_id,
                status=cached.get("status", "ok"),
                lang=cached.get("lang", "en"),
                duration_sec=float(cached.get("duration_sec", 0.0)),
                transcript=cached.get("transcript", ""),
                transcript_sha256=cached.get("transcript_sha256", ""),
                source=cached.get("source", {"canonical_url": expanded, "video_id": "unknown"}),
                billed_tokens=0,
                elapsed_ms=elapsed_ms,
                ts=datetime.now(timezone.utc).isoformat(),
            )

        with tempfile.TemporaryDirectory(dir="/tmp", prefix="tiktok_") as tmpd:
            m4a = yt_dlp_m4a(expanded, tmpd)
            logger.log("info", "stored locally", request_id=request_id, object=os.path.basename(m4a), path=m4a)

            wav = os.path.join(tmpd, "audio.wav")
            to_wav_normalized(m4a, wav)

            transcript, language, duration = transcribe_wav(wav)

        transcript_sha256 = hashlib.sha256(transcript.encode("utf-8")).hexdigest()
        video_id = "unknown"
        canonical_url = expanded
        if "tiktok.com" in expanded and "/video/" in expanded:
            try:
                video_id = expanded.split("/video/")[1].split("?")[0]
            except Exception:
                pass

        elapsed_ms = int((time.time() - start_time) * 1000)
        logger.log(
            "info",
            "transcription_complete",
            request_id=request_id,
            duration=duration,
            language=language,
            transcript_length=len(transcript),
            elapsed_ms=elapsed_ms,
        )

        result = TranscribeResponse(
            request_id=request_id,
            status="ok",
            lang=language,
            duration_sec=duration,
            transcript=transcript,
            transcript_sha256=transcript_sha256,
            source={"canonical_url": canonical_url, "video_id": video_id},
            billed_tokens=1,
            elapsed_ms=elapsed_ms,
            ts=datetime.now(timezone.utc).isoformat(),
        )

        # Persist to cache for future requests
        write_cache(
            expanded,
            {
                "status": result.status,
                "lang": result.lang,
                "duration_sec": result.duration_sec,
                "transcript": result.transcript,
                "transcript_sha256": result.transcript_sha256,
                "source": result.source,
            },
            logger,
        )

        return result
    except subprocess.CalledProcessError as e:
        logger.log("error", "subprocess failed", request_id=request_id, cmd=e.cmd, code=e.returncode, out=(e.stdout or "")[-1000:])
        raise HTTPException(status_code=500, detail={"stage": "subprocess", "code": e.returncode, "out": (e.stdout or "")[-1000:]})
    except HTTPException:
        raise
    except Exception as e:
        logger.log("error", "exception", request_id=request_id, error=str(e), tb=traceback.format_exc())
        raise HTTPException(status_code=500, detail={"stage": "unknown", "error": str(e)})


def create_app() -> FastAPI:
    app = FastAPI(title="TTTranscibe API", version="1.0.0")
    print(f"===== Application Startup (git {GIT_REV}) =====", flush=True)
    registry = JobsRegistry()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.post("/api/transcribe", response_model=TranscribeResponse)
    async def transcribe(
        request: Request,
        x_api_key: str = Header(..., alias="X-API-Key"),
        x_timestamp: str = Header(..., alias="X-Timestamp"),
        x_signature: str = Header(..., alias="X-Signature"),
    ):
        if x_api_key not in ALLOWED_API_KEYS:
            raise HTTPException(status_code=401, detail="Unknown API key")
        try:
            ts_val = int(x_timestamp)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid timestamp header")
        if not verify_timestamp(ts_val):
            raise HTTPException(status_code=403, detail="Timestamp skew too large")

        raw_bytes = await request.body()
        try:
            raw_str = raw_bytes.decode("utf-8")
        except Exception:
            raise HTTPException(status_code=400, detail="Malformed body encoding")

        if not verify_signature_shared(API_SECRET, ts_val, x_signature, "POST", "/api/transcribe", raw_str):
            raise HTTPException(status_code=403, detail="Invalid signature")

        try:
            payload = json.loads(raw_str)
            url = payload["url"]
        except Exception:
            raise HTTPException(status_code=400, detail="Malformed JSON body")

        # Global token bucket (per Space); for per-key buckets, shard by key in rate_limit module
        rate_limiter = get_rate_limiter()
        if not rate_limiter.consume():
            retry_after = max(1, int(1 / rate_limiter.refill_rate))
            return JSONResponse(status_code=429, content={"error": "Rate limit exceeded"}, headers={"Retry-After": str(retry_after)})

        # Observe basic job lifecycle alongside synchronous flow
        job_id = str(uuid.uuid4())
        registry.new_job(job_id, url)
        registry.set_job(job_id, status="RUNNING")

        start_ms = int(time.time() * 1000)
        try:
            result = process_tiktok_url(url)
        except HTTPException as he:
            registry.set_job(job_id, status="FAILED", error=str(he.detail))
            raise
        except Exception as e:
            registry.set_job(job_id, status="FAILED", error=str(e))
            raise
        elapsed_ms = int(time.time() * 1000) - start_ms
        owner = API_KEYS_OWNER_MAP.get(x_api_key, "unknown")
        logger.log(
            "info",
            "api_transcribe_ok",
            request_id=result.request_id,
            key_owner=owner,
            duration_ms=elapsed_ms,
            transcript_sha12=result.transcript_sha256[:12],
        )
        # Update job completion status
        registry.set_job(job_id, status="COMPLETE", cache_hit=(result.billed_tokens == 0), elapsed_ms=elapsed_ms)
        if GCP_LOGGER is not None:
            try:
                GCP_LOGGER.log_struct(
                    {
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.gmtime()),
                        "level": "INFO",
                        "logger": "tttranscribe",
                        "msg": "api_transcribe_ok",
                        "request_id": result.request_id,
                        "key_owner": owner,
                        "duration_ms": elapsed_ms,
                        "transcript_sha12": result.transcript_sha256[:12],
                    },
                    severity="INFO",
                )
            except Exception:
                pass
        # Attach job_id for observability (now part of response model)
        try:
            result.job_id = job_id  # type: ignore[attr-defined]
        except Exception:
            pass
        return result

    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "build": {"git_sha": GIT_REV, "time": _STAMPED_TIME or "unknown"},
        }

    @app.get("/version")
    async def version():
        return {"git_sha": GIT_REV, "started_at": datetime.now(timezone.utc).isoformat(), "build_time": _STAMPED_TIME or "unknown"}

    # Aliases for robustness (some proxies may strip root paths)
    @app.get("/api/health")
    async def health_alias():
        return await health()  # type: ignore[misc]

    @app.get("/api/version")
    async def version_alias():
        return await version()  # type: ignore[misc]

    mount_job_endpoints(app, registry, logger)

    # Root landing route (kept simple, includes the word 'gradio' for tests)
    @app.get("/", response_class=HTMLResponse)
    async def root():
        return """
        <!doctype html>
        <html><head><title>TTTranscibe</title></head>
        <body>
            <h1>TTTranscibe</h1>
            <p>gradio UI is available at <a href=\"/ui\">/ui</a>.</p>
        </body></html>
        """

    demo = build_gradio_ui()
    app = gr.mount_gradio_app(app, demo, path="/ui")
    return app


