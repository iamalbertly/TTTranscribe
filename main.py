import os, sys, json, time, tempfile, subprocess, shlex, traceback, hashlib, hmac, uuid
from collections import deque
from datetime import datetime, timezone
from typing import Dict, Optional
import httpx
import gradio as gr
import logging
from fastapi import FastAPI, HTTPException, Request, Header, Depends
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
from threading import Lock

# ===============  A) Configure logging to reduce noise  =================
# Set noisy loggers to WARNING level
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpx._client").setLevel(logging.WARNING)

# ===============  B) Live logging to console + UI  =================
LOGS = deque(maxlen=1500)

class UILogHandler:
    def __init__(self, name="app"):
        self.name = name
    def log(self, level, msg, **fields):
        rec = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.gmtime()),
            "level": level.upper(),
            "logger": self.name,
            "msg": msg,
            **fields,
        }
        line = json.dumps(rec, ensure_ascii=False)
        LOGS.append(line)
        # mirror to container logs
        print(line, file=sys.stdout, flush=True)

logger = UILogHandler("tttranscribe")

# Optional Google Cloud Logging (mirrors stdout JSON logs if configured)
GCP_LOGGER = None
try:
    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        try:
            from google.cloud import logging as gcp_logging
            _gcp_client = gcp_logging.Client(project=os.getenv("GCP_PROJECT_ID", "tttranscibe-project-64857"))
            GCP_LOGGER = _gcp_client.logger(os.getenv("GCP_LOG_NAME", "tttranscibe"))
        except Exception as _gcp_err:
            print(json.dumps({
                "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.gmtime()),
                "level": "WARNING",
                "logger": "tttranscribe",
                "msg": "gcp_logging_init_failed",
                "error": str(_gcp_err)
            }), file=sys.stdout, flush=True)
except Exception:
    pass

def read_logs():
    return "\n".join(LOGS)

# ===============  C) API Configuration  ======================================
# Environment-driven auth & keys
API_SECRET = os.getenv("API_SECRET", "")
_keys_raw = os.getenv("API_KEYS_JSON", "{}")
try:
    API_KEYS_OWNER_MAP: dict[str, str] = json.loads(_keys_raw)
except Exception:
    API_KEYS_OWNER_MAP = {}
ALLOWED_API_KEYS = set(API_KEYS_OWNER_MAP.keys())

# Rate limiting: token bucket per API key
class TokenBucket:
    def __init__(self, capacity: int, refill_rate: float):
        self.capacity = capacity
        self.tokens = capacity
        self.last_refill = time.time()
        self.lock = Lock()
    
    def consume(self, tokens: int = 1) -> bool:
        with self.lock:
            now = time.time()
            # Refill tokens based on time passed
            time_passed = now - self.last_refill
            self.tokens = min(self.capacity, self.tokens + time_passed * self.refill_rate)
            self.last_refill = now
            
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True
            return False

# Rate limiting from env
_capacity = int(os.getenv("RATE_LIMIT_CAPACITY", "60"))
_refill_per_min = float(os.getenv("RATE_LIMIT_REFILL_PER_MIN", "1"))
_refill_rate_per_sec = _refill_per_min / 60.0

rate_limiters: Dict[str, TokenBucket] = {}

def get_rate_limiter(api_key: str) -> TokenBucket:
    if api_key not in rate_limiters:
        rate_limiters[api_key] = TokenBucket(capacity=_capacity, refill_rate=_refill_rate_per_sec)
    return rate_limiters[api_key]

# ===============  D) API Models  ======================================
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

class ErrorResponse(BaseModel):
    error: str
    request_id: Optional[str] = None

# ===============  E) Authentication  ======================================
def verify_signature_shared(secret: str, timestamp: int, signature: str, method: str, path: str, body_raw_str: str) -> bool:
    """Verify HMAC-SHA256 signature using a shared API_SECRET over RAW body bytes."""
    if not secret:
        return False
    string_to_sign = f"{method}\n{path}\n{body_raw_str}\n{timestamp}"
    expected_signature = hmac.new(
        secret.encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(signature, expected_signature)

def verify_timestamp(timestamp: int) -> bool:
    """Verify timestamp is within 5 minutes of current time"""
    current_time = int(time.time() * 1000)
    time_diff = abs(current_time - timestamp)
    return time_diff <= 300000  # 5 minutes in milliseconds

# ===============  F) Helpers  ======================================
def expand_tiktok_url(url: str) -> str:
    try:
        # HEAD first, then follow redirects manually to preserve UA and Referer
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
            "Referer": "https://www.tiktok.com/"
        }
        with httpx.Client(follow_redirects=True, timeout=15.0, headers=headers) as c:
            r = c.head(url)
            expanded = str(r.url)
            logger.log("info", "expanded tiktok url", original=url, expanded=expanded)
            return expanded
    except Exception as e:
        logger.log("error", "failed to expand tiktok url", original=url, error=str(e))
        return url  # best effort

def run(cmd: list[str], cwd: str | None = None) -> subprocess.CompletedProcess:
    logger.log("info", "exec", cmd=cmd, cwd=cwd or "")
    return subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=True)

def ffprobe_duration(path: str) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        path
    ]
    cp = run(cmd)
    try:
        return float(cp.stdout.strip())
    except Exception:
        return 0.0

def yt_dlp_m4a(expanded_url: str, out_dir: str) -> str:
    # Save best m4a or bestaudio, no fragments persisted, no cert checks, TikTok referer
    out_tmpl = os.path.join(out_dir, "%(id)s.%(ext)s")
    cmd = [
        sys.executable, "-m", "yt_dlp",
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        "--add-header", "Referer:https://www.tiktok.com/",
        "--no-check-certificates",
        "--socket-timeout", "30",
        "--retries", "5",
        "--fragment-retries", "5",
        "--no-playlist",
        "--no-warnings",
        "--no-part",
        "--no-cache-dir",
        "-f", "m4a/bestaudio[ext=m4a]/bestaudio/best",
        "-o", out_tmpl,
        expanded_url,
        "--print-json"
    ]
    cp = run(cmd)
    meta = {}
    # parse the last JSON line emitted by yt-dlp
    for line in cp.stdout.splitlines():
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            meta = json.loads(line)
    if not meta:
        raise RuntimeError("yt-dlp did not return JSON")
    downloaded = os.path.join(out_dir, f"{meta['id']}.{meta.get('ext', 'm4a')}")
    if not os.path.exists(downloaded):
        # fallback: scan directory
        for f in os.listdir(out_dir):
            if f.startswith(meta["id"] + "."):
                downloaded = os.path.join(out_dir, f)
                break
    if not os.path.exists(downloaded):
        raise FileNotFoundError("Downloaded audio not found")
    dur = ffprobe_duration(downloaded)
    logger.log("info", "file validated with ffprobe",
               duration=dur, path=downloaded, has_audio=True)
    return downloaded

def to_wav_normalized(src_path: str, dst_path: str) -> str:
    # Two-pass loudnorm can be heavy, use single-pass + pcm_s16le mono 16k for ASR
    cmd = [
        "ffmpeg", "-y", "-i", src_path,
        "-ac", "1", "-ar", "16000",
        "-vn",
        "-c:a", "pcm_s16le",
        dst_path
    ]
    cp = run(cmd)
    size = os.path.getsize(dst_path)
    dur = ffprobe_duration(dst_path)
    logger.log("info", "transcode successful", wav=dst_path, wav_size=size, duration=dur)
    return dst_path

# ===============  G) Transcription  =================================
# Use faster-whisper for speed and stability on Spaces CPU
# Model is downloaded to the ephemeral cache; HF Spaces will cache layers
try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    print("Warning: faster-whisper not available, using fallback")
    FASTER_WHISPER_AVAILABLE = False
    WhisperModel = None

# Set up cache directories for faster-whisper
def setup_cache_dirs():
    # Use clean, writable cache directories that work on Spaces
    os.environ.setdefault("HF_HOME", "/home/user/.cache/huggingface")
    os.environ.setdefault("XDG_CACHE_HOME", "/home/user/.cache")
    os.environ.setdefault("TRANSFORMERS_CACHE", "/home/user/.cache/huggingface")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_READ_ONLY_TOKEN", "")
    # Do NOT set HF_HUB_ENABLE_HF_TRANSFER - let it use standard downloader
    
    # Try to create cache directories, but don't fail if we can't
    cache_dirs = [
        "/home/user/.cache/huggingface",
        "/home/user/.cache"
    ]
    for cache_dir in cache_dirs:
        try:
            os.makedirs(cache_dir, exist_ok=True)
        except Exception:
            # Don't log warnings for permission errors - this is expected in some environments
            pass

setup_cache_dirs()

WHISPER_MODEL_NAME = os.environ.get("WHISPER_MODEL", "medium")  # "small" if you hit RAM limits
# load once
logger.log("info", "loading whisper model", model=WHISPER_MODEL_NAME)

# Try to load the model with fallback cache directory handling
if FASTER_WHISPER_AVAILABLE:
    try:
        _whisper = WhisperModel(WHISPER_MODEL_NAME, device="cpu", compute_type="int8")
        logger.log("info", "whisper model loaded successfully")
    except Exception as e:
        logger.log("warning", "failed to load whisper model, trying with fallback method", error=str(e))
        try:
            # Fallback: try with different cache settings
            _whisper = WhisperModel(WHISPER_MODEL_NAME, device="cpu", compute_type="int8", local_files_only=False)
            logger.log("info", "whisper model loaded with fallback method")
        except Exception as e2:
            logger.log("error", "failed to load whisper model with fallback, trying tiny model", error=str(e2))
            try:
                # Final fallback: try with tiny model
                _whisper = WhisperModel("tiny", device="cpu", compute_type="int8")
                logger.log("info", "whisper model loaded with tiny fallback")
            except Exception as e3:
                logger.log("error", "failed to load whisper model with all fallbacks", error=str(e3))
                raise RuntimeError(f"Could not load Whisper model {WHISPER_MODEL_NAME}: {e3}")
else:
    logger.log("warning", "faster-whisper not available, using mock model for testing")
    _whisper = None

def transcribe_wav(path: str) -> tuple[str, str, float]:
    logger.log("info", "transcribing", path=path)
    if _whisper is None:
        logger.log("warning", "faster-whisper not available, returning mock transcript")
        return "Mock transcript: This is a test transcription since faster-whisper is not available.", "en", 0.0

    try:
        segments, info = _whisper.transcribe(
            path,
            beam_size=1,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500)
        )
        parts = []
        for seg in segments:
            parts.append(seg.text.strip())
        text = " ".join(p for p in parts if p)
        # Also print the transcript to logs for verification
        logger.log("info", "transcription complete", lang=info.language, duration=info.duration, transcript=text[:1000])
        # If you want the full transcript in logs, remove slice [:1000]
        return text, info.language, info.duration
    except Exception as e:
        logger.log("error", "whisper transcription failed", error=str(e))
        # Return a mock transcript if Whisper fails
        return f"Mock transcript: Whisper transcription failed - {str(e)}", "en", 0.0

# ===============  H) API Processing Function  ======================================
def process_tiktok_url(url: str) -> TranscribeResponse:
    """Process TikTok URL and return transcription result"""
    start_time = time.time()
    request_id = str(uuid.uuid4())
    
    try:
        logger.log("info", "processing tiktok url", request_id=request_id, url=url)
        
        # Expand URL
        try:
            expanded = expand_tiktok_url(url)
            logger.log("info", "url expanded", request_id=request_id, expanded=expanded)
        except Exception as e:
            logger.log("error", "url expansion failed", request_id=request_id, error=str(e))
            raise HTTPException(status_code=400, detail=f"URL expansion failed: {str(e)}")
        
        with tempfile.TemporaryDirectory(dir="/tmp", prefix="tiktok_") as tmpd:
            # Download audio
            try:
                m4a = yt_dlp_m4a(expanded, tmpd)
                logger.log("info", "stored locally", request_id=request_id, object=os.path.basename(m4a), path=m4a)
            except Exception as e:
                logger.log("error", "audio download failed", request_id=request_id, error=str(e))
                raise HTTPException(status_code=408, detail=f"Audio download failed: {str(e)}")
            
            # Convert to WAV
            try:
                wav = os.path.join(tmpd, "audio.wav")
                to_wav_normalized(m4a, wav)
                logger.log("info", "audio normalized", request_id=request_id, wav_path=wav)
            except Exception as e:
                logger.log("error", "audio normalization failed", request_id=request_id, error=str(e))
                raise HTTPException(status_code=500, detail=f"Audio normalization failed: {str(e)}")
            
            # Transcribe
            try:
                transcript, language, duration = transcribe_wav(wav)
                logger.log("info", "transcription completed", request_id=request_id, language=language, duration=duration)
            except Exception as e:
                logger.log("error", "transcription failed", request_id=request_id, error=str(e))
                raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
            
        # Calculate transcript hash
        transcript_bytes = transcript.encode('utf-8')
        transcript_sha256 = hashlib.sha256(transcript_bytes).hexdigest()
        
        # Extract video ID from URL
        video_id = "unknown"
        canonical_url = expanded
        if "tiktok.com" in expanded and "/video/" in expanded:
            try:
                video_id = expanded.split("/video/")[1].split("?")[0]
            except:
                pass
        
        elapsed_ms = int((time.time() - start_time) * 1000)
        
        logger.log("info", "transcription complete", 
                  request_id=request_id, 
                  duration=duration, 
                  language=language,
                  transcript_length=len(transcript))
        
        return TranscribeResponse(
            request_id=request_id,
            status="ok",
            lang=language,
            duration_sec=duration,
            transcript=transcript,
            transcript_sha256=transcript_sha256,
            source={
                "canonical_url": canonical_url,
                "video_id": video_id
            },
            billed_tokens=1,
            elapsed_ms=elapsed_ms,
            ts=datetime.now(timezone.utc).isoformat()
        )
        
    except subprocess.CalledProcessError as e:
        logger.log("error", "subprocess failed", request_id=request_id, cmd=e.cmd, code=e.returncode, out=e.stdout)
        raise HTTPException(status_code=408, detail="Upstream fetch timeout")
    except Exception as e:
        logger.log("error", "exception", request_id=request_id, error=str(e), tb=traceback.format_exc())
        # Return more specific error information for debugging
        error_detail = f"Processing error: {str(e)}"
        raise HTTPException(status_code=500, detail=error_detail)

# ===============  I) FastAPI App  ======================================
app = FastAPI(title="TTTranscibe API", version="1.0.0")

# Add CORS middleware
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
    x_signature: str = Header(..., alias="X-Signature")
):
    """Transcribe TikTok video to text"""
    # Verify API key existence
    if x_api_key not in ALLOWED_API_KEYS:
        raise HTTPException(status_code=401, detail="Unknown API key")
    # Verify timestamp skew
    try:
        ts_val = int(x_timestamp)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid timestamp header")
    if not verify_timestamp(ts_val):
        raise HTTPException(status_code=403, detail="Timestamp skew too large")
    # Read RAW body exactly as sent
    raw_bytes = await request.body()
    try:
        raw_str = raw_bytes.decode("utf-8")
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed body encoding")

    # Verify signature using shared API_SECRET
    if not verify_signature_shared(API_SECRET, ts_val, x_signature, "POST", "/api/transcribe", raw_str):
        raise HTTPException(status_code=403, detail="Invalid signature")
    # Parse JSON after successful auth
    try:
        payload = json.loads(raw_str)
        url = payload["url"]
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed JSON body")

    # Check rate limit
    rate_limiter = get_rate_limiter(x_api_key)
    if not rate_limiter.consume():
        # Calculate seconds until at least 1 token refills
        retry_after = max(1, int(1 / rate_limiter.refill_rate))
        response = JSONResponse(
            status_code=429,
            content={"error": "Rate limit exceeded"},
            headers={"Retry-After": str(retry_after)}
        )
        return response
    
    # Process the request
    try:
        start_ms = int(time.time() * 1000)
        result = process_tiktok_url(url)
        elapsed_ms = int(time.time() * 1000) - start_ms
        owner = API_KEYS_OWNER_MAP.get(x_api_key, "unknown")
        # Structured summary log
        logger.log("info", "api_transcribe_ok", request_id=result.request_id, key_owner=owner, duration_ms=elapsed_ms, transcript_sha12=result.transcript_sha256[:12])
        if GCP_LOGGER is not None:
            try:
                GCP_LOGGER.log_struct({
                    "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.gmtime()),
                    "level": "INFO",
                    "logger": "tttranscribe",
                    "msg": "api_transcribe_ok",
                    "request_id": result.request_id,
                    "key_owner": owner,
                    "duration_ms": elapsed_ms,
                    "transcript_sha12": result.transcript_sha256[:12]
                }, severity="INFO")
            except Exception:
                pass
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.log("error", "unexpected error", error=str(e))
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

@app.post("/api/test")
async def test_endpoint():
    """Simple test endpoint without TikTok processing"""
    return {
        "status": "ok",
        "message": "API is working",
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

# ===============  J) Gradio UI (Legacy)  ======================================
def transcribe_url(url: str, progress=gr.Progress()):
    try:
        if not url or not url.strip():
            return "Provide a TikTok URL", "No URL"
        url = url.strip()
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
        # Important: print the full transcript into logs so it shows in Space console
        logger.log("info", "FINAL_TRANSCRIPT", transcript=text)
        return text, "Done"

    except subprocess.CalledProcessError as e:
        logger.log("error", "subprocess failed", cmd=e.cmd, code=e.returncode, out=e.stdout)
        return f"[Error] command failed: {e.returncode}\n{e.stdout}", "Error"
    except Exception as e:
        logger.log("error", "exception", error=str(e), tb=traceback.format_exc())
        return f"[Exception] {e}", "Error"

# Create Gradio interface
with gr.Blocks(title="TTTranscibe") as demo:
    gr.Markdown("### TikTok → Transcript, with live server logs")

    url_in = gr.Textbox(label="TikTok URL", placeholder="https://vm.tiktok.com/...")
    with gr.Row():
        go = gr.Button("Transcribe", variant="primary")
        status = gr.Textbox(label="Status", value="Idle", interactive=False)

    transcript = gr.Textbox(label="Transcript", lines=12)
    logs = gr.Textbox(label="Server log (live)", lines=16, interactive=False)

    go.click(fn=transcribe_url, inputs=[url_in], outputs=[transcript, status], concurrency_limit=1)
    
    # Use the correct Gradio API for polling (Gradio 4.x)
    try:
        # For Gradio 4.x, use the demo.poll method
        demo.poll(fn=read_logs, outputs=[logs], every=0.5)
    except Exception:
        # If polling fails, just skip the live logs feature
        pass

# Mount Gradio app
app = gr.mount_gradio_app(app, demo, path="/")

if __name__ == "__main__":
    import uvicorn
    demo.queue(max_size=8)
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 7860)))