## 2025-01-27  — MAJOR ARCHITECTURE CHANGE: Synchronous Drop-in Fix

- **COMPLETE REPLACEMENT**: Replaced complex FastAPI + background worker architecture with simple synchronous Gradio app.
- **New app.py**: Single-file solution that fetches, normalizes, and transcribes TikTok URLs in one synchronous call.
- **Key changes**:
  - Removed FastAPI server, background workers, database dependencies
  - Direct Gradio UI with live server logs
  - Uses `faster-whisper` instead of `openai-whisper` for better performance
  - Synchronous processing: URL → fetch → normalize → transcribe → return result
  - Final transcript printed to container logs with `FINAL_TRANSCRIPT` key
  - Eliminated all loopback calls to 127.0.0.1
  - Throttled noisy logs (uvicorn.access, httpx to WARNING)
- **Dependencies updated**: Pinned gradio==4.44.1, yt-dlp==2024.8.6, faster-whisper==1.0.3
- **Rationale**: Fixes the core issue where pipeline stops after "normalized audio" and never returns transcript to UI
- **Result**: TikTok URLs like `https://vm.tiktok.com/ZMAPTWV7o/` now return transcript directly to Gradio UI

Staging deployment context (Hugging Face Space)
---------------------------------------------

- Runtime: Simple Gradio app with synchronous processing.
- No CORS needed: Direct Gradio UI without API endpoints.
- No storage: Transcripts returned directly to UI, no file persistence.
- UI contract:
  - Single function: `transcribe_url(url)` → `(transcript_text, status)`
  - Progress updates: "Expanding URL", "Fetching audio", "Converting to WAV", "Transcribing", "Done"
  - Live logs: Ring buffer polled every 500ms for real-time feedback
- Whisper cache: Model loaded once at startup using `faster-whisper` with int8 quantization.
- No concurrency limits: Single-threaded processing per request.
- Deployment files: `Dockerfile`, `space.yaml` (app_port: 7860).

Last updated: 2025-09-21

Project: tiktok-transcriber-mvp (lean monolith)

Dependency map (NEW SIMPLIFIED ARCHITECTURE):
- gradio → Direct UI with live logging
- yt-dlp → TikTok fetch to audio (m4a) via subprocess
- faster-whisper → CPU transcription (medium model, int8)
- httpx → URL expansion and HTTP requests
- ffmpeg/ffprobe → Audio normalization (system binaries)
- tempfile → Temporary file handling

Key modules (NEW ARCHITECTURE):
- app.py → Single-file Gradio app with synchronous processing
  - UILogHandler → Live logging to console + UI
  - expand_tiktok_url() → URL expansion with proper headers
  - yt_dlp_m4a() → Audio download via yt-dlp subprocess
  - to_wav_normalized() → FFmpeg audio conversion
  - transcribe_wav() → faster-whisper transcription
  - transcribe_url() → Main processing function with progress
- Legacy modules (REMOVED):
  - app/api/* → FastAPI routes and Gradio mounting (deleted)
  - app/services/* → Background processing services (deleted)
  - app/store/* → Database and storage (deleted)

Dependency map (concise, single source of truth)
- UI: `gradio` for direct user interface
- Media: `yt-dlp` (invoked via `python -m yt_dlp`), `ffmpeg-python` (requires system ffmpeg/ffprobe)
- ASR: `faster-whisper` with Torch CPU; model prewarmed under `whisper_models_cache`
- IO/HTTP: `httpx` for URL expansion

Naming conventions (enforced moving forward)
- Files reflect purpose and module (no duplicates). Example: `api/transcription_routes.py` (SSoT for request/response contract)
- Helper modules by concern: `services/*`, `store/*`, `core/*`, `utils/*`
- Avoid parallel implementations; consolidate into canonical module and re-export from `app/api/routes.py` when needed
- Mark frozen artifacts with suffix `_vX.Y_frozen` only when explicitly required (none currently)

Duplication/circulars status
- Legacy Gradio variants removed; canonical UI is `gradio_simple_fixed.py`
- Route callables consolidated under `app/api/routes.py`; no broken references detected
- Store split: `core_db.py` (connection/mode) + `db_operations.py` (CRUD) + `job_manager.py` (lifecycle) + `db.py` (facade)
- No circular imports found across `api/services/store`

Operational notes
- No database dependencies - simple synchronous processing
- Health, queue, and lease stats surfaced via `GET /health`
- Static mounts in dev at `/files/audio` and `/files/transcripts`

Line-length/size guardrails
- Aim to keep important files under 300 LOC; split by logical concern if exceeded

Last validated: 2025-10-01
Naming convention: module files reflect purpose; avoid duplicates; frozen marker not used yet.

Recent fixes:
- Fixed critical error handling in worker.py - no longer shuts down server on fetch failures in development
- Enhanced fetchers.py with HLS fallback for better TikTok download success rate
- Improved error logging to continue processing other jobs when individual jobs fail

Notes:
- Ensure ffmpeg/ffprobe and yt-dlp on PATH. Whisper cache dir: whisper-cache/
- MAX_AUDIO_SECONDS default 120; ALLOW_TIKTOK_ADAPTER default true; RPM default 5.
- Development mode now gracefully handles fetch failures without server shutdown.

### Deploy scripts (updated)
- `scripts/deploy_remote.ps1` now requires token via param or `HUGGINGFACE_HUB_TOKEN` env; no hardcoded secrets. It auto-commits/stashes, rebases, and on conflicts aborts and retries with `--force-with-lease`. It temporarily moves only `scripts/*.local.ps1` during rebase and restores afterward.
- `scripts/deploy_remote.local.ps1` is ignored by git and serves as a local wrapper: it sets the env token and delegates to `deploy_remote.ps1`.
- If remote rejects pushes due to secret history, create and push a clean branch (orphan) and point the Space to it.

UI Single Source of Truth (SSoT):
- Canonical UI: `app/api/gradio_simple_fixed.py` mounted in `app/api/main.py`.
- Removed obsolete/broken UI variants to prevent duplication: `gradio_ui.py`, `gradio_simple.py`, `gradio_debug.py`, `gradio_fixed.py`, `gradio_ui_simple.py`, `gradio_test.py`, `gradio_working.py` (pending deletion if not referenced).
- Direct Gradio interface with no API endpoints or queue management.

Last updated: 2025-01-27 (synchronous drop-in fix)

Refactor summary (no new bottlenecks):
- Removed duplicate Gradio modules; canonical `gradio_simple_fixed.py` mounted in `app/api/main.py`.
- Removed obsolete endpoint `transcribeOrGet`; single path via `TranscribeRequest` flow.
- No database dependencies - direct processing without persistence
- Matplotlib usage made optional to reduce test/runtime deps.
- Error responses for failed jobs are now top-level `{code, message, status, job_id}` (not nested in `detail`).


