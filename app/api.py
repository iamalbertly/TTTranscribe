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


logger = UILogHandler("tttranscribe")


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


def process_tiktok_url(url: str) -> TranscribeResponse:
    start_time = time.time()
    request_id = str(uuid.uuid4())
    try:
        logger.log("info", "processing tiktok url", request_id=request_id, url=url)
        expanded = expand_tiktok_url(url)

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
            "transcription complete",
            request_id=request_id,
            duration=duration,
            language=language,
            transcript_length=len(transcript),
        )

        return TranscribeResponse(
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
    except subprocess.CalledProcessError as e:
        logger.log("error", "subprocess failed", request_id=request_id, cmd=e.cmd, code=e.returncode, out=e.stdout)
        raise HTTPException(status_code=408, detail="Upstream fetch timeout")
    except HTTPException:
        raise
    except Exception as e:
        logger.log("error", "exception", request_id=request_id, error=str(e), tb=traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Processing error: {str(e)}")


def create_app() -> FastAPI:
    app = FastAPI(title="TTTranscibe API", version="1.0.0")
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

        rate_limiter = get_rate_limiter(x_api_key)
        if not rate_limiter.consume():
            retry_after = max(1, int(1 / rate_limiter.refill_rate))
            return JSONResponse(status_code=429, content={"error": "Rate limit exceeded"}, headers={"Retry-After": str(retry_after)})

        start_ms = int(time.time() * 1000)
        result = process_tiktok_url(url)
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
        return result

    @app.get("/health")
    async def health():
        return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

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


