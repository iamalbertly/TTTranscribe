import os, time
from .logging_utils import UILogHandler


logger = UILogHandler("tttranscribe")


try:
    from faster_whisper import WhisperModel  # type: ignore
    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    print("Warning: faster-whisper not available, using fallback")
    FASTER_WHISPER_AVAILABLE = False
    WhisperModel = None  # type: ignore


def _setup_cache_dirs():
    os.environ.setdefault("HF_HOME", "/home/user/.cache/huggingface")
    os.environ.setdefault("XDG_CACHE_HOME", "/home/user/.cache")
    os.environ.setdefault("TRANSFORMERS_CACHE", "/home/user/.cache/huggingface")
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("HF_HUB_READ_ONLY_TOKEN", "")
    for cache_dir in ["/home/user/.cache/huggingface", "/home/user/.cache"]:
        try:
            os.makedirs(cache_dir, exist_ok=True)
        except Exception:
            pass


_setup_cache_dirs()

WHISPER_MODEL_NAME = os.environ.get("WHISPER_MODEL", "medium")
logger.log("info", "loading whisper model", model=WHISPER_MODEL_NAME)

if FASTER_WHISPER_AVAILABLE:
    try:
        _whisper = WhisperModel(WHISPER_MODEL_NAME, device="cpu", compute_type="int8")
        logger.log("info", "whisper model loaded successfully")
    except Exception as e:
        logger.log("warning", "failed to load whisper model, trying with fallback method", error=str(e))
        try:
            _whisper = WhisperModel(WHISPER_MODEL_NAME, device="cpu", compute_type="int8", local_files_only=False)
            logger.log("info", "whisper model loaded with fallback method")
        except Exception as e2:
            logger.log("error", "failed to load whisper model with fallback, trying tiny model", error=str(e2))
            try:
                _whisper = WhisperModel("tiny", device="cpu", compute_type="int8")
                logger.log("info", "whisper model loaded with tiny fallback")
            except Exception as e3:
                logger.log("error", "failed to load whisper model with all fallbacks", error=str(e3))
                _whisper = None
else:
    logger.log("warning", "faster-whisper not available, using mock model for testing")
    _whisper = None


def transcribe_wav(path: str) -> tuple[str, str, float]:
    logger.log("info", "transcribing", path=path)
    if _whisper is None:
        logger.log("warning", "faster-whisper not available, returning mock transcript")
        return (
            "Mock transcript: This is a test transcription since faster-whisper is not available.",
            "en",
            0.0,
        )

    try:
        segments, info = _whisper.transcribe(
            path, beam_size=1, vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500)
        )
        parts: list[str] = []
        for seg in segments:
            parts.append(seg.text.strip())
        text = " ".join(p for p in parts if p)
        logger.log("info", "transcription complete", lang=info.language, duration=info.duration, transcript=text[:1000])
        return text, info.language, info.duration
    except Exception as e:
        logger.log("error", "whisper transcription failed", error=str(e))
        return f"Mock transcript: Whisper transcription failed - {str(e)}", "en", 0.0


