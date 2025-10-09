## 2025-10-03 — Modularization & Duplication Cleanup

- Consolidated monolithic server into modules under `app/`:
  - `app/api.py` → FastAPI/Gradio app factory (`create_app`), endpoint handlers (kept <300 LOC)
  - `app/auth.py` → Auth config and HMAC/timestamp verification
  - `app/rate_limit.py` → Token bucket per API key
  - `app/network.py` → URL expansion via `httpx`
  - `app/media.py` → `ffmpeg`/`yt-dlp` helpers
  - `app/transcription.py` → `faster-whisper` load + `transcribe_wav`
  - `app/logging_utils.py` → JSON log + optional GCP mirror
  - `app/cache.py` → Transcript cache read/write utilities (filesystem cache)
  - `app/types.py` → Pydantic request/response models for API
- Single entrypoint: `main.py` imports `create_app()`; removed duplicate `app.py`.
- Kept files <300 LOC by separation of concerns; removed obsolete/duplicate modules.

Dependency map (SSoT)
- fastapi, gradio, httpx, yt-dlp, ffmpeg, faster-whisper

Routes
- POST `/api/transcribe` (HMAC auth, rate-limited)
- GET `/health`
- GET `/version`
- GET `/jobs`, GET `/jobs/failed`, POST `/jobs/repair`, GET `/queue/status`
- Gradio UI mounted at `/`

Config (env)
- `API_SECRET`, `API_KEYS_JSON`, `RATE_LIMIT_CAPACITY`, `RATE_LIMIT_REFILL_PER_MIN`, whisper model via `WHISPER_MODEL`.

Notes
- Avoided circular imports by isolating concerns.
- Testing scripts consolidated: canonical is `scripts/test_e2e.py`; `scripts/test_local.ps1` wraps it for local runs. Legacy testers removed.

Last validated: 2025-10-09 (post cache/types extraction)


- **NEW PUBLIC API**: Implemented FastAPI-based public API with HMAC-SHA256 authentication and rate limiting.
- **Dual Interface**: Maintains Gradio UI for direct user interaction while adding REST API for programmatic access.
- **Key features**:
  - POST /api/transcribe endpoint with full authentication
  - HMAC-SHA256 signature verification with timestamp validation
  - Token bucket rate limiting (5 requests/minute per API key)
  - Comprehensive error handling with proper HTTP status codes
  - TikTok URL processing: expand → fetch → normalize → transcribe
  - Returns structured JSON with transcript, metadata, and billing info
- **Authentication**: X-API-Key, X-Timestamp, X-Signature headers required
- **Rate Limiting**: 5 requests per minute per API key with Retry-After headers
- **Dependencies updated**: Added fastapi==0.104.1, uvicorn==0.24.0, pydantic==2.5.0
- **Result**: Full public API specification implemented with secure authentication

Staging deployment context (Hugging Face Space)
---------------------------------------------

- Runtime: FastAPI + Gradio hybrid with synchronous processing.
- API endpoints: POST /api/transcribe with full authentication
- CORS enabled: Supports cross-origin requests for API access
- Dual interface: REST API for programmatic access + Gradio UI for direct use
- API contract:
  - POST /api/transcribe with X-API-Key, X-Timestamp, X-Signature headers
  - Returns structured JSON with transcript, metadata, billing info
  - Rate limited: 5 requests/minute per API key
  - Error responses: 400, 401, 403, 408, 429, 500 with proper status codes
- UI contract (legacy):
  - Single function: `transcribe_url(url)` → `(transcript_text, status)`
  - Progress updates: "Expanding URL", "Fetching audio", "Converting to WAV", "Transcribing", "Done"
  - Live logs: Ring buffer polled every 500ms for real-time feedback
- Whisper cache: Model loaded once at startup using `faster-whisper` with int8 quantization.
- Concurrency: API requests processed with rate limiting, UI requests single-threaded
- Deployment files: `Dockerfile`, `space.yaml` (app_port: 7860).

Last updated: 2025-09-21

Project: tiktok-transcriber-mvp (lean monolith)

Dependency map (NEW API ARCHITECTURE):
- fastapi → REST API with authentication and rate limiting
- gradio → Direct UI with live logging (mounted on FastAPI)
- yt-dlp → TikTok fetch to audio (m4a) via subprocess
- faster-whisper → CPU transcription (medium model, int8)
- httpx → URL expansion and HTTP requests
- ffmpeg/ffprobe → Audio normalization (system binaries)
- tempfile → Temporary file handling
- hmac/hashlib → HMAC-SHA256 signature verification
- uvicorn → ASGI server for FastAPI

Key modules (NEW API ARCHITECTURE):
- app.py → FastAPI + Gradio hybrid with synchronous processing
  - FastAPI app → POST /api/transcribe endpoint with full authentication
  - TokenBucket → Rate limiting implementation
  - verify_signature() → HMAC-SHA256 signature verification
  - process_tiktok_url() → Main API processing function
  - UILogHandler → Live logging to console + UI
  - expand_tiktok_url() → URL expansion with proper headers
  - yt_dlp_m4a() → Audio download via yt-dlp subprocess
  - to_wav_normalized() → FFmpeg audio conversion
  - transcribe_wav() → faster-whisper transcription
  - transcribe_url() → Legacy UI processing function
- test_api.py → API testing script with curl example
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


