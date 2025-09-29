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

Dependency map (pinned minimal):
- fastapi, uvicorn → API server with lifespan hooks
- yt-dlp → TikTok fetch to audio (m4a)
- openai-whisper → CPU transcription (tiny)
- ffmpeg-python → normalization; system ffmpeg/ffprobe required
- python-dotenv, pydantic → config
- httpx → Supabase Storage REST
- asyncpg → Postgres access

Key modules:
- app/core/config.py → AppSettings, env defaults, whisper cache dir
- app/core/logging.py → JSON logs with job_id and component
- app/api/main.py → FastAPI app, startup tool checks, model preload
- app/services/fetchers.py → yt-dlp audio fetch with HLS fallback
- app/services/normalize.py → ffmpeg to wav 16k mono + hash + duration cap
- app/services/transcribe.py → async transcription wrapper
- app/services/worker.py → job processing with graceful error handling
- app/store/db.py → asyncpg pool, schema, upsert_job
- app/store/storage.py → Supabase Storage upload REST

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

Last updated: 2025-09-29 (refactor consolidation)

Refactor summary (no new bottlenecks):
- Removed duplicate Gradio modules; canonical `gradio_simple_fixed.py` mounted in `app/api/main.py`.
- Removed obsolete endpoint `transcribeOrGet`; single path via `TranscribeRequest` flow.
- Database now supports `DATABASE_URL=memory://*` for tests; avoids asyncpg in tests.
- Matplotlib usage made optional to reduce test/runtime deps.
- Error responses for failed jobs are now top-level `{code, message, status, job_id}` (not nested in `detail`).


