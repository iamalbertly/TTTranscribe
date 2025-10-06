import os, json, time, tempfile, hashlib, uuid, subprocess, traceback
from datetime import datetime, timezone
from typing import Optional

import gradio as gr
from fastapi import FastAPI, HTTPException, Request, Header
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .logging_utils import UILogHandler, read_logs, GCP_LOGGER
from .auth import API_SECRET, ALLOWED_API_KEYS, API_KEYS_OWNER_MAP, verify_signature_shared, verify_timestamp
from .rate_limit import get_rate_limiter
from .network import expand_tiktok_url
from .media import yt_dlp_m4a, to_wav_normalized
from .transcription import transcribe_wav

# Simple filesystem cache to avoid regenerating recent transcripts
CACHE_DIR = os.environ.get("TRANSCRIPT_CACHE_DIR", "/data/transcripts_cache")
CACHE_TTL_SEC = int(os.environ.get("TRANSCRIPT_CACHE_TTL_SEC", "86400"))  # 24h default

def _safe_mkdir(path: str) -> None:
    os.makedirs(path, exist_ok=True)

def _cache_key_for_url(expanded_url: str) -> str:
    # Prefer video_id when present; fallback to sha256 of canonical url
    vid = "unknown"
    if "tiktok.com" in expanded_url and "/video/" in expanded_url:
        try:
            vid = expanded_url.split("/video/")[1].split("?")[0]
        except Exception:
            vid = "unknown"
    if vid and vid != "unknown":
        return f"video_{vid}.json"
    return hashlib.sha256(expanded_url.encode("utf-8")).hexdigest() + ".json"

def _read_cache(expanded_url: str) -> Optional[dict]:
    _safe_mkdir(CACHE_DIR)
    key = _cache_key_for_url(expanded_url)
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

def _write_cache(expanded_url: str, payload: dict) -> None:
    _safe_mkdir(CACHE_DIR)
    key = _cache_key_for_url(expanded_url)
    fp = os.path.join(CACHE_DIR, key)
    try:
        with open(fp, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        logger.log("info", "cache_write_ok", cache_key=key, size=len(json.dumps(payload)))
    except Exception as e:
        logger.log("warning", "cache_write_failed", error=str(e))


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



class TranscribeRequest(BaseModel):
    url: str


class TranscribeResponse(BaseModel):
    request_id: str
    status: str
    lang: str
    duration_sec: float
    transcript: str
    transcript_sha256: str
    source: dict
    billed_tokens: int
    elapsed_ms: int
    ts: str
    job_id: Optional[str] = None


def process_tiktok_url(url: str) -> TranscribeResponse:
    start_time = time.time()
    request_id = str(uuid.uuid4())
    try:
        logger.log("info", "processing tiktok url", request_id=request_id, url=url)
        expanded = expand_tiktok_url(url)

        # Check cache before heavy work
        cached = _read_cache(expanded)
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
        _write_cache(
            expanded,
            {
                "status": result.status,
                "lang": result.lang,
                "duration_sec": result.duration_sec,
                "transcript": result.transcript,
                "transcript_sha256": result.transcript_sha256,
                "source": result.source,
            },
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
    # In-memory jobs ledger for simple observability
    from threading import Lock
    from collections import deque

    JOBS = {}
    JOBS_ORDER = deque(maxlen=500)
    JOBS_LOCK = Lock()

    def _new_job(url: str) -> str:
        jid = str(uuid.uuid4())
        with JOBS_LOCK:
            JOBS[jid] = {
                "job_id": jid,
                "status": "PENDING",
                "created_at": time.time(),
                "updated_at": time.time(),
                "url": url,
                "cache_hit": False,
                "elapsed_ms": None,
                "error": None,
            }
            JOBS_ORDER.appendleft(jid)
        return jid

    def _set_job(jid: str, **fields) -> None:
        with JOBS_LOCK:
            if jid in JOBS:
                JOBS[jid].update(fields)
                JOBS[jid]["updated_at"] = time.time()

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
        job_id = _new_job(url)
        _set_job(job_id, status="RUNNING")

        start_ms = int(time.time() * 1000)
        try:
            result = process_tiktok_url(url)
        except HTTPException as he:
            _set_job(job_id, status="FAILED", error=str(he.detail))
            raise
        except Exception as e:
            _set_job(job_id, status="FAILED", error=str(e))
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
        _set_job(job_id, status="COMPLETE", cache_hit=(result.billed_tokens == 0), elapsed_ms=elapsed_ms)
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

    @app.get("/queue/status")
    async def queue_status():
        try:
            with JOBS_LOCK:
                qsize = sum(1 for j in JOBS.values() if j["status"] in ("PENDING", "RUNNING"))
                active = sum(1 for j in JOBS.values() if j["status"] == "RUNNING")
            return {
                "status": "ok",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "msg": "estimation",
                "event_id": None,
                "rank": None,
                "queue_size": qsize,
                "rank_eta": None,
                "queue": {
                    "queue_size": qsize,
                    "active_jobs": active,
                    "estimated_wait_time": 0 if qsize == 0 else 5 * qsize,
                    "status": "idle" if qsize == 0 else "busy",
                },
            }
        except Exception as e:
            logger.log("error", "queue_status_failed", error=str(e))
            return {"status": "error", "error": str(e), "timestamp": datetime.now(timezone.utc).isoformat()}

    @app.get("/jobs")
    async def jobs_summary():
        with JOBS_LOCK:
            total = len(JOBS)
            counts = {"PENDING": 0, "RUNNING": 0, "COMPLETE": 0, "FAILED": 0}
            for j in JOBS.values():
                if j["status"] in counts:
                    counts[j["status"]] += 1
            recent = [JOBS[jid] for jid in list(JOBS_ORDER)[:25]]
        return {
            "total": total,
            "pending": counts["PENDING"],
            "running": counts["RUNNING"],
            "complete": counts["COMPLETE"],
            "failed": counts["FAILED"],
            "recent": recent,
        }

    @app.get("/jobs/failed")
    async def jobs_failed():
        with JOBS_LOCK:
            items = [j for j in JOBS.values() if j["status"] == "FAILED"]
        return {"jobs": items}

    @app.post("/jobs/repair")
    async def jobs_repair():
        now = time.time()
        repaired = 0
        with JOBS_LOCK:
            for j in JOBS.values():
                if j["status"] == "PENDING" and (now - j["created_at"]) > 600:
                    j["status"] = "FAILED"
                    j["updated_at"] = now
                    repaired += 1
        return {"status": "ok", "repaired": repaired}

    def transcribe_url(url: str, progress=gr.Progress()):
        try:
            if not url or not url.strip():
                return "Provide a TikTok URL", "No URL"
            url = url.strip()
            from .logging_utils import LOGS  # lazy to avoid circulars

            LOGS.clear()
            logger.log("info", "submit", url=url)

            progress(0.05, desc="Expanding URL")
            expanded = expand_tiktok_url(url)

            with tempfile.TemporaryDirectory(dir="/tmp", prefix="tiktok_") as tmpd:
                progress(0.15, desc="Fetching audio")
                m4a = yt_dlp_m4a(expanded, tmpd)
                logger.log("info", "stored locally", object=os.path.basename(m4a), path=m4a)

                progress(0.40, desc="Converting to WAV")
                wav = os.path.join(tmpd, "audio.wav")
                to_wav_normalized(m4a, wav)

                progress(0.70, desc="Transcribing")
                text, _, _ = transcribe_wav(wav)

            progress(1.0, desc="Done")
            logger.log("info", "FINAL_TRANSCRIPT", transcript=text)
            return text, "Done"
        except subprocess.CalledProcessError as e:
            logger.log("error", "subprocess failed", cmd=e.cmd, code=e.returncode, out=e.stdout)
            return f"[Error] command failed: {e.returncode}\n{e.stdout}", "Error"
        except Exception as e:
            logger.log("error", "exception", error=str(e), tb=traceback.format_exc())
            return f"[Exception] {e}", "Error"

    with gr.Blocks(title="TTTranscibe") as demo:
        gr.Markdown("### TikTok → Transcript, with live server logs")
        url_in = gr.Textbox(label="TikTok URL", placeholder="https://vm.tiktok.com/...")
        with gr.Row():
            go = gr.Button("Transcribe", variant="primary")
            status = gr.Textbox(label="Status", value="Idle", interactive=False)
        transcript = gr.Textbox(label="Transcript", lines=12)
        logs = gr.Textbox(label="Server log (live)", lines=16, interactive=False)
        go.click(fn=transcribe_url, inputs=[url_in], outputs=[transcript, status], concurrency_limit=1)
        try:
            demo.poll(fn=read_logs, outputs=[logs], every=0.5)
        except Exception:
            pass

    app = gr.mount_gradio_app(app, demo, path="/")
    return app


