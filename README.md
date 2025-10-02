---
title: TTTranscibe
emoji: 🎧
colorFrom: indigo
colorTo: gray
sdk: docker
sdk_version: "4.4.0"
app_file: app.py
pinned: false
license: mit
---

# tiktok-transcriber-mvp

A lean-monolith FastAPI application for fetching TikTok audio, normalizing it with ffmpeg, transcribing with Whisper (CPU-friendly), and persisting metadata to Supabase Postgres and Storage. The project simulates modularity using clear package boundaries without microservices.

## Architecture Overview

- app/api: FastAPI app and HTTP routes. Loads the Whisper tiny model on startup (CPU) using a fixed cache directory for faster cold starts. Performs tool availability checks for `yt-dlp` and `ffprobe` and logs results.
- app/services: Background-friendly services.
  - fetchers.py: Resolve TikTok URL to audio using `yt-dlp`. Obeys kill-switch `ALLOW_TIKTOK_ADAPTER`.
  - normalize.py: Normalize audio via `ffmpeg-python`, enforce duration limits, and compute content hashes.
  - transcribe.py: Async coroutine to run Whisper on normalized audio and return results.
- app/store: Data layer abstractions.
  - db.py: Async Postgres access with `asyncpg` for job CRUD.
  - storage.py: Minimal Supabase Storage wrapper using `httpx` and REST API.
- app/core: Cross-cutting concerns.
  - config.py: Environment loading, defaults, and typed settings.
  - logging.py: Structured JSON logging with mandatory fields `job_id` and `component`.
- app/utils: Space for helpers shared across modules.

### Async Pattern

Requests enqueue or trigger an async workflow:
1) Fetch audio from TikTok via `yt-dlp` → write to temp file.
2) Normalize audio with `ffmpeg`; enforce MAX_AUDIO_SECONDS; compute hash for idempotency.
3) Transcribe using Whisper tiny (CPU) with cached model weights.
4) Persist job status and transcript to Postgres via `asyncpg`; store artifacts in Supabase Storage via REST.

The app uses FastAPI lifespan events to initialize shared clients, model, and logging once, and to cleanly close resources on shutdown.

## Getting Started

1) Create `.env` from `.env.example` and fill Supabase settings.
2) Install Python 3.10+ and ffmpeg (ffmpeg/ffprobe must be on PATH). Install `yt-dlp`.
3) Create and activate a venv, then install requirements:
```
pip install -r requirements.txt
```
4) Run the app:
```
python main.py
```

## Windows 11 quickstart (recommended Python 3.11)

For reliable local E2E on Windows:

1) Create venv on Python 3.11 and upgrade pip
```
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
```

2) Install core web deps and tools using constraints for Torch CPU
```
pip install -r requirements.txt -c constraints.win-py311.txt
```

3) Install faster-whisper after Torch is in place
```
pip install faster-whisper==1.0.3
```

4) Start the app:
```
$env:WHISPER_MODEL='tiny'
$env:WHISPER_CACHE_DIR="$PWD\whisper_models_cache"
python main.py
```

5) Test the app by opening http://127.0.0.1:7860 in your browser and entering a TikTok URL

Notes:
- `WHISPER_CACHE_DIR` defaults to `whisper-cache/` if not set.
- `/health` is fast and non-blocking; it does not wait for model downloads or network checks.

## Deploy to Hugging Face Spaces (Docker)

1) Create a new public Space with the Docker runtime.
2) Push this repo to the Space (or connect via GitHub).
3) In Space Settings → Secrets, set:
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY
   - SUPABASE_STORAGE_BUCKET
   - Optionally ALLOW_TIKTOK_ADAPTER=false to disable TikTok fetcher
   - Optionally ALLOW_UPLOAD_ADAPTER=true to enable file uploads
4) The container serves on port 7860. Open the URL in your browser to use the Gradio interface.

The app now uses a simple synchronous approach - no database or external services required.

## Database Schema (No longer needed)

The app now uses a simple synchronous approach without database dependencies.

### Safe deploy using env token (no secrets in repo)

- Preferred: set token in env and run the tracked deploy script:
  - PowerShell: `$env:HUGGINGFACE_HUB_TOKEN='hf_...'`
  - Then: `.\u0063scripts\deploy_remote.ps1`
- Or use the ignored local wrapper that stores your default token locally:
  - `.\u0073ripts\deploy_remote.local.ps1`

The deploy script will:
- Auto-commit dirty changes (if `-AutoCommit`) and stash remaining, rebase, and if conflicts occur it aborts rebase and retries with `--force-with-lease`.
- Temporarily move only `scripts/*.local.ps1` files to avoid rebase overwriting and restore them afterward.
- Print a clear error if push still fails.

If the Space rejects pushes because history contains a token in `scripts/deploy_remote.ps1`, fix by pushing a clean branch with no secret history:

Fastest path (new clean branch):
```powershell
git checkout --orphan deploy-clean
git add -A
git commit -m "chore(deploy): clean branch without secrets"
git push origin deploy-clean --force-with-lease
```
Point the Space to `deploy-clean` or push to the Space remote from this branch.

Alternative (keep branch name but purge history):
```powershell
git checkout --orphan main-clean
git add -A
git commit -m "chore(deploy): clean history"
git branch -M main-clean main
git push origin main --force-with-lease
```
After the remote branch no longer contains token-bearing commits, deploys will succeed using env-based token.

## Simple Gradio Interface

The app now uses a direct Gradio interface where users can:
- Enter a TikTok URL
- Click "Transcribe" 
- See the transcript appear immediately
- No API endpoints or polling required

### Web Interface

The app provides a simple web interface where users can:
- Enter a TikTok URL in the text box
- Click the "Transcribe" button
- Watch progress updates: "Expanding URL" → "Fetching audio" → "Converting to WAV" → "Transcribing" → "Done"
- See the full transcript appear in the text area
- Copy the transcript text directly from the interface

## Notes

- Designed for Windows 11 local dev and Hugging Face CPU Basic. Whisper runs on CPU; tiny model loaded once at startup.
- Logging is JSON and always includes `job_id` and `component` to trace workflows end-to-end.
- This is a lean monolith: modular folders, single deployable.


