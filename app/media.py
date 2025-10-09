import os, sys, json, subprocess
from .logging_utils import UILogHandler
from typing import Optional


logger = UILogHandler("tttranscribe")


def run(cmd: list[str], cwd: str | None = None, timeout_sec: Optional[int] = None) -> subprocess.CompletedProcess:
    logger.log("info", "exec", cmd=cmd, cwd=cwd or "", timeout_sec=timeout_sec or 0)
    try:
        return subprocess.run(
            cmd,
            cwd=cwd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=True,
            timeout=timeout_sec,
        )
    except subprocess.TimeoutExpired as te:
        raise RuntimeError(f"command timed out after {timeout_sec}s: {' '.join(cmd)}\n{te.output or ''}")


def ffprobe_duration(path: str) -> float:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    ]
    cp = run(cmd)
    try:
        return float(cp.stdout.strip())
    except Exception:
        return 0.0


def yt_dlp_m4a(expanded_url: str, out_dir: str, timeout_sec: int = 90) -> str:
    out_tmpl = os.path.join(out_dir, "%(id)s.%(ext)s")
    base = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        "--add-header",
        "Referer:https://www.tiktok.com/",
        "--no-check-certificates",
        "--force-ipv4",
        "--geo-bypass",
        "--socket-timeout",
        "30",
        "--retries",
        "5",
        "--fragment-retries",
        "5",
        "--no-playlist",
        "--no-warnings",
        "--no-part",
        "--no-cache-dir",
        "-o", out_tmpl,
        expanded_url,
        "--print-json",
    ]
    # First attempt: prefer m4a
    cmd1 = base[:]
    cmd1[cmd1.index("-o")-1:cmd1.index("-o")-1] = ["-f", "m4a/bestaudio[ext=m4a]/bestaudio/best"]
    try:
        cp = run(cmd1, timeout_sec=timeout_sec)
    except Exception as e1:
        logger.log("warning", "yt_dlp_first_attempt_failed", error=str(e1))
        # Second attempt: more permissive format
        cmd2 = base[:]
        cmd2[cmd2.index("-o")-1:cmd2.index("-o")-1] = ["-f", "bestaudio/best"]
        cp = run(cmd2, timeout_sec=timeout_sec)
    meta: dict = {}
    for line in cp.stdout.splitlines():
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            meta = json.loads(line)
    if not meta:
        raise RuntimeError("yt-dlp did not return JSON")
    downloaded = os.path.join(out_dir, f"{meta['id']}.{meta.get('ext', 'm4a')}")
    if not os.path.exists(downloaded):
        for f in os.listdir(out_dir):
            if f.startswith(meta["id"] + "."):
                downloaded = os.path.join(out_dir, f)
                break
    if not os.path.exists(downloaded):
        raise FileNotFoundError("Downloaded audio not found")
    dur = ffprobe_duration(downloaded)
    logger.log("info", "file validated with ffprobe", duration=dur, path=downloaded, has_audio=True)
    return downloaded


def to_wav_normalized(src_path: str, dst_path: str, timeout_sec: int = 90) -> str:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        src_path,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-vn",
        "-c:a",
        "pcm_s16le",
        dst_path,
    ]
    run(cmd, timeout_sec=timeout_sec)
    size = os.path.getsize(dst_path)
    dur = ffprobe_duration(dst_path)
    logger.log("info", "transcode successful", wav=dst_path, wav_size=size, duration=dur)
    return dst_path


