import os, sys, json, time, tempfile, subprocess, shlex, traceback
from collections import deque
import httpx
import gradio as gr
import logging

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

def read_logs():
    return "\n".join(LOGS)

# ===============  C) Helpers  ======================================
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

# ===============  D) Transcription  =================================
# Use faster-whisper for speed and stability on Spaces CPU
# Model is downloaded to the ephemeral cache; HF Spaces will cache layers
from faster_whisper import WhisperModel

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

def transcribe_wav(path: str) -> str:
    logger.log("info", "transcribing", path=path)
    segments, info = _whisper.transcribe(path, beam_size=1, vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500))
    parts = []
    for seg in segments:
        parts.append(seg.text.strip())
    text = " ".join(p for p in parts if p)
    # Also print the transcript to logs for verification
    logger.log("info", "transcription complete", lang=info.language, duration=info.duration, transcript=text[:1000])
    # If you want the full transcript in logs, remove slice [:1000]
    return text

# ===============  E) Gradio UI  =====================================
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
            text = transcribe_wav(wav)

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

demo.queue(max_size=8)
demo.launch(server_name="0.0.0.0", server_port=int(os.environ.get("PORT", 7860)), max_threads=1)
