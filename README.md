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

### Android App Integration

For Android apps, use this pattern to get TikTok transcripts:

1. **Submit transcription job:**
   ```http
   POST https://iamromeoly-TTTranscibe.hf.space/transcribe
   Content-Type: application/json
   
   {
     "url": "https://vm.tiktok.com/ZMADQVF4e/"
   }
   ```

2. **Poll for completion:**
   ```http
   GET https://iamromeoly-TTTranscibe.hf.space/transcribe/{job_id}
   ```

3. **Get full transcript (when status is "COMPLETE"):**
   ```http
   GET https://iamromeoly-TTTranscibe.hf.space/transcript/{job_id}
   ```

**Response format for completed transcription:**
```json
{
  "job_id": "3181c7f6-31b9-468e-9b4f-8a2d35cf6bd8",
  "text": "After a man cheats, the first thing that changes is how he sees his wife, everything she does starts to annoy him. Her voice grates on him, her habits discuss him. Even her kindness makes him roll his eyes...",
  "source_url": "https://www.tiktok.com/@user/video/1234567890",
  "created_at": "2025-09-27T21:35:14Z",
  "model": "tiny",
  "content_hash": "810009481bd1f8fa608195aad7c85d2bc7e43dfa03e14cfc675434de6e070649"
}
```

**Alternative: Get transcript from main endpoint:**
The `/transcribe/{job_id}` endpoint now includes the full transcript in the `text` field when status is "COMPLETE":

```json
{
  "status": "COMPLETE",
  "job_id": "3181c7f6-31b9-468e-9b4f-8a2d35cf6bd8",
  "text": "Full transcript text here...",
  "text_preview": "After a man cheats, the first thing...",
  "audio_url": "/files/audio/810009481bd1f8fa608195aad7c85d2bc7e43dfa03e14cfc675434de6e070649.wav",
  "transcript_url": "/files/transcripts/810009481bd1f8fa608195aad7c85d2bc7e43dfa03e14cfc675434de6e070649.json"
}
```

### Android Integration Example

Here's a complete example of how to integrate with the API from an Android app:

```kotlin
// Android Kotlin example
class TikTokTranscriber {
    private val baseUrl = "https://iamromeoly-TTTranscibe.hf.space"
    
    suspend fun transcribeTikTok(url: String): String? {
        // Step 1: Submit transcription job
        val jobId = submitTranscription(url)
        if (jobId == null) return null
        
        // Step 2: Poll for completion
        return pollForCompletion(jobId)
    }
    
    private suspend fun submitTranscription(url: String): String? {
        try {
            val response = httpClient.post("$baseUrl/transcribe") {
                contentType(ContentType.Application.Json)
                setBody("""{"url": "$url"}""")
            }
            
            if (response.status.isSuccess()) {
                val result = response.body<Map<String, Any>>()
                return result["job_id"] as? String
            }
        } catch (e: Exception) {
            Log.e("Transcriber", "Failed to submit transcription", e)
        }
        return null
    }
    
    private suspend fun pollForCompletion(jobId: String): String? {
        var attempts = 0
        val maxAttempts = 60 // 3 minutes with 3-second intervals
        
        while (attempts < maxAttempts) {
            try {
                val response = httpClient.get("$baseUrl/transcribe/$jobId")
                val result = response.body<Map<String, Any>>()
                val status = result["status"] as? String
                
                when (status) {
                    "COMPLETE" -> {
                        // Get full transcript
                        val transcriptResponse = httpClient.get("$baseUrl/transcript/$jobId")
                        val transcript = transcriptResponse.body<Map<String, Any>>()
                        return transcript["text"] as? String
                    }
                    "FAILED" -> {
                        Log.e("Transcriber", "Transcription failed: ${result["message"]}")
                        return null
                    }
                    else -> {
                        // Still processing, wait and retry
                        delay(3000) // 3 seconds
                        attempts++
                    }
                }
            } catch (e: Exception) {
                Log.e("Transcriber", "Failed to check status", e)
                delay(3000)
                attempts++
            }
        }
        
        Log.e("Transcriber", "Transcription timed out")
        return null
    }
}
```

### Error Handling

The API returns structured error responses:

```json
{
  "status": "FAILED",
  "job_id": "job-id-here",
  "code": "extraction_error",
  "message": "Failed to extract audio from the video. This may be due to TikTok's content protection or network issues.",
  "raw_error": "yt-dlp failed with exit code 1"
}
```

Common error codes:
- `invalid_url`: Not a valid TikTok URL
- `extraction_error`: Failed to download/extract audio
- `transcription_error`: Whisper transcription failed
- `media_too_long`: Audio exceeds maximum duration
- `service_busy`: Rate limit exceeded (includes `Retry-After` header)

### Dev endpoints

- `POST /jobs/repair`: repair stuck leases; returns count repaired
- `GET /jobs`: queue summary + recent failed and stuck lists
- `DELETE /jobs/failed`: clear all failed jobs
- `DELETE /jobs/all`: clear all jobs (dev only)
- `GET /jobs/all`: returns counts and a tip to use DELETE
- `GET|POST /jobs/clear`: alias to clear all jobs

### Static file mounts (dev)

- `/files/audio` → `.local_storage/transcripts/audio`
- `/files/transcripts` → `.local_storage/transcripts/transcripts`

### Caching

- After a successful run, artifacts are written:
  - `.local_storage/transcripts/audio/{content_hash}.wav`
  - `.local_storage/transcripts/transcripts/{content_hash}.json` (includes `source_url`, `content_hash`, `created_at`, `model`, `text`)
  - `.local_storage/transcripts/keys/{url_key}.txt` mapping normalized TikTok URL → `content_hash`
- On server startup, alias files are rebuilt from existing transcripts to enable instant cache hits after restarts.

Client guidance: poll every 2–3s with exponential backoff (cap 30s), overall timeout 2–5 minutes depending on audio length and cold starts.

### Error model (stable, client-mappable)

Codes returned in error responses (as `code` and human `message`):
- invalid_url: Provided URL is not a TikTok URL
- service_busy: Global RPM limit exceeded; includes `Retry-After` header
- media_too_long: Audio exceeds `MAX_AUDIO_SECONDS`
- extraction_error: yt-dlp failed to extract audio
- transcription_error: Whisper transcription failed
- unexpected_error: Unhandled error, retry later

## Notes

- Designed for Windows 11 local dev and Hugging Face CPU Basic. Whisper runs on CPU; tiny model loaded once at startup.
- Logging is JSON and always includes `job_id` and `component` to trace workflows end-to-end.
- This is a lean monolith: modular folders, single deployable.


