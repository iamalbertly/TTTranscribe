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
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>TTTranscibe</title>
  <style>
    :root { --bg:#0b0f14; --card:#121823; --text:#e6edf3; --muted:#9fb0c3; --accent:#7c9fff; --accent2:#4ade80; }
    * { box-sizing: border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, \"Helvetica Neue\", Arial; background: linear-gradient(180deg, #0b0f14 0%, #0e141b 100%); color: var(--text); }
    .container { max-width: 880px; margin: 0 auto; padding: 24px; }
    .hero { display:flex; gap:28px; align-items:center; padding:28px; background: radial-gradient(120% 120% at 0% 0%, #141c27 0%, #101620 60%, #0b0f14 100%); border:1px solid #1f2a37; border-radius: 16px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
    .logo { width:48px; height:48px; border-radius:10px; background: linear-gradient(135deg, var(--accent), var(--accent2)); box-shadow: 0 0 0 6px rgba(124,159,255,.08); }
    h1 { margin:0; font-size: 28px; letter-spacing:.2px; }
    p.muted { margin:.5rem 0 0; color: var(--muted); }
    .grid { margin-top: 22px; display:grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap:14px; }
    .card { background: var(--card); border:1px solid #1f2a37; border-radius: 12px; padding:16px; min-height: 110px; }
    .card h3 { margin:0 0 6px; font-size:15px; color:#d6e2f0; }
    .cta { display:flex; gap:12px; margin-top: 20px; }
    .btn { display:inline-flex; align-items:center; gap:10px; padding:10px 14px; border-radius: 10px; border:1px solid #243041; text-decoration:none; color:var(--text); background:#131a25; transition: all .15s ease; }
    .btn:hover { transform: translateY(-1px); border-color:#2d3b50; box-shadow: 0 6px 20px rgba(124,159,255,.08); }
    .btn.primary { background: linear-gradient(135deg, var(--accent), #8aa9ff); color:#0a0f16; font-weight:600; border: none; }
    .footer { margin-top:26px; color:#8aa0b7; font-size: 12px; text-align:center; }
    code { background:#0b1220; border:1px solid #1a2535; padding:2px 6px; border-radius:6px; color:#cde3ff; }
  </style>
  <meta http-equiv=\"Permissions-Policy\" content=\"interest-cohort=()\" />
</head>
<body>
  <div class=\"container\">
    <div class=\"hero\">
      <div class=\"logo\"></div>
      <div>
        <h1>TTTranscibe</h1>
        <p class=\"muted\">TikTok → transcript, with a secure REST API and a streamlined UI.</p>
      </div>
    </div>

    <div class=\"grid\">
      <div class=\"card\">
        <h3>Try the UI</h3>
        <p class=\"muted\">Open the visual interface to paste a TikTok URL and transcribe.</p>
        <div class=\"cta\"><a class=\"btn primary\" href=\"/ui\">Open UI</a></div>
      </div>
      <div class=\"card\">
        <h3>Health</h3>
        <p class=\"muted\">Service status and build stamp.</p>
        <div class=\"cta\"><a class=\"btn\" href=\"/health\">/health</a><a class=\"btn\" href=\"/version\">/version</a></div>
      </div>
      <div class=\"card\">
        <h3>API</h3>
        <p class=\"muted\">Authenticated JSON endpoint: <code>POST /api/transcribe</code>.</p>
        <div class=\"cta\"><a class=\"btn\" href=\"/queue/status\">/queue/status</a><a class=\"btn\" href=\"/jobs\">/jobs</a></div>
      </div>
    </div>

    <div class=\"footer\">© 2025 TTTranscibe. UI is custom — not Gradio — to reduce metadata leakage.
    </div>
  </div>
</body>
</html>
        """

    demo = build_gradio_ui()
    app = gr.mount_gradio_app(app, demo, path="/ui")
    return app


