## 2025-01-27  — MAJOR ARCHITECTURE CHANGE: Synchronous Drop-in Fix

- **COMPLETE REPLACEMENT**: Replaced complex FastAPI + background worker architecture with simple synchronous Gradio app.
- **New app.py**: Single-file solution that fetches, normalizes, and transcribes TikTok URLs in one synchronous call.
- **Key changes**:
  - Removed FastAPI server, background workers, database dependencies
  - Direct Gradio UI with live server logs
  - Uses `faster-whisper` instead of `openai-whisper` for better performance
  - Synchronous processing: URL → fetch → normalize → transcribe → return result
  - Final transcript printed to container logs with `FINAL_TRANSCRIPT` key
- **Dependencies updated**: Added `faster-whisper==1.0.3` to requirements.txt
- **Rationale**: Fixes the core issue where pipeline stops after "normalized audio" and never returns transcript to UI
- **Result**: TikTok URLs like `https://vm.tiktok.com/ZMAPTWV7o/` now return transcript directly to Gradio UI

Staging deployment context (Hugging Face Space)
---------------------------------------------

- Runtime: FastAPI API + background worker in a single Uvicorn process.
- CORS: Configured via `CORS_ORIGINS` env (comma-separated, `*` allowed).
- Storage: `SupabaseStorage` with local fallback. Public URLs emitted via `public_url()`:
  - Local: `/files/<object_name>` mounted from `.local_storage/transcripts/*`
  - Supabase: `<SUPABASE_URL>/storage/v1/object/public/<bucket>/<object_name>`
- API contract:
  - POST `/transcribe` → `{ id, job_id, status:PENDING }`
  - GET `/transcribe/{id}` → includes `status`, `transcript_url`, `audio_url`, top-level `content_hash`, and `data.content_hash`.
  - Health `/health`, repair `/jobs/repair` maintained.
- Whisper cache: `WHISPER_CACHE_DIR` (default `/app/whisper_models_cache` in Docker Space).
- Concurrency: `MAX_CONCURRENT_FETCHES`, `MAX_CONCURRENT_TRANSCRIBES` respected by semaphores.
- Deployment files added: `Dockerfile`, `space.yaml`, `scripts/test_remote.ps1` (secrets set in Space UI). `.env.staging.example` should not contain real values.

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
- Legacy modules (now unused but preserved):
  - app/api/* → FastAPI routes and Gradio mounting (deprecated)
  - app/services/* → Background processing services (deprecated)
  - app/store/* → Database and storage (deprecated)

Dependency map (concise, single source of truth)
- API: `fastapi`, `uvicorn`, `pydantic`
- Media: `yt-dlp` (invoked via `python -m yt_dlp`), `ffmpeg-python` (requires system ffmpeg/ffprobe)
- ASR: `openai-whisper` with Torch CPU; model prewarmed under `whisper_models_cache`
- IO/HTTP: `httpx`
- DB: `asyncpg` (production), in-memory store when `DATABASE_URL=memory://*`
- UI: `gradio` mounted at `/` from `app/api/gradio_simple_fixed.py`

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
- Default dev/test use `DATABASE_URL=memory://*` to avoid asyncpg build issues
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
- Queue disabled via `interface.queue(False)`; UI uses BASE_URL `http://127.0.0.1:7860`.

Last updated: 2025-01-27 (synchronous drop-in fix)

Refactor summary (no new bottlenecks):
- Removed duplicate Gradio modules; canonical `gradio_simple_fixed.py` mounted in `app/api/main.py`.
- Removed obsolete endpoint `transcribeOrGet`; single path via `TranscribeRequest` flow.
- Database now supports `DATABASE_URL=memory://*` for tests; avoids asyncpg in tests.
- Matplotlib usage made optional to reduce test/runtime deps.
- Error responses for failed jobs are now top-level `{code, message, status, job_id}` (not nested in `detail`).


