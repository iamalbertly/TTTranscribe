import os, sys, json, time, tempfile, subprocess, shlex, traceback
from collections import deque
import httpx
import gradio as gr

# ===============  A) Live logging to console + UI  =================
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

# ===============  B) Helpers  ======================================
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

# ===============  C) Transcription  =================================
# Use faster-whisper for speed and stability on Spaces CPU
# Model is downloaded to the ephemeral cache; HF Spaces will cache layers
from faster_whisper import WhisperModel

WHISPER_MODEL_NAME = os.environ.get("WHISPER_MODEL", "medium")  # "small" if you hit RAM limits
# load once
logger.log("info", "loading whisper model", model=WHISPER_MODEL_NAME)
_whisper = WhisperModel(WHISPER_MODEL_NAME, device="cpu", compute_type="int8")

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

# ===============  D) Gradio UI  =====================================
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

    go.click(fn=transcribe_url, inputs=[url_in], outputs=[transcript, status])
    gr.Poll(fn=read_logs, outputs=[logs], every=0.5)

demo.queue(concurrency_count=1, max_size=8)
demo.launch()
