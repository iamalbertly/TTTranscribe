---
title: TTTranscibe - TikTok Video Transcription API
emoji: 🎧
colorFrom: blue
colorTo: purple
sdk: docker
sdk_version: "1.0"
app_file: app.py
pinned: false
---

# TTTranscibe - TikTok Video Transcription API

A FastAPI + Gradio hybrid application that transcribes TikTok videos to text using faster-whisper.

## Features

- **REST API**: Public API with HMAC-SHA256 authentication
- **Web UI**: Gradio interface for easy testing
- **Rate Limiting**: Token bucket algorithm per API key
- **Structured Logging**: JSON logs with request tracking
- **Cloud Logging**: Optional Google Cloud Logging integration

## Public API

### Base URLs

- **Remote**: `https://iamromeoly-tttranscibe.hf.space`
- **Local dev**: `http://localhost:7860`

### Endpoint

**POST** `/api/transcribe`

### Headers

- `Content-Type: application/json`
- `X-API-Key: <your-api-key>`
- `X-Timestamp: <unix-ms>`
- `X-Signature: <hex-hmac-sha256>`

### Request Body

```json
{
  "url": "https://vm.tiktok.com/ZMAPTWV7o/"
}
```

### Signature Generation

```python
stringToSign = method + "\n" + path + "\n" + body + "\n" + timestamp
signature = hex(HMAC_SHA256(API_SECRET, stringToSign))
```

### Success Response (200)

```json
{
  "request_id": "uuid",
  "status": "ok",
  "lang": "en",
  "duration_sec": 112.55,
  "transcript": "Full transcript text...",
  "transcript_sha256": "f4ab5d3c...",
  "source": {
    "canonical_url": "https://www.tiktok.com/@its.factsonly/video/7554590723895594258",
    "video_id": "7554590723895594258"
  },
  "billed_tokens": 1,
  "elapsed_ms": 3270,
  "ts": "2025-10-02T18:01:00Z"
}
```

### Error Responses

- **400**: Malformed JSON
- **401**: Missing/unknown X-API-Key
- **403**: Bad signature or clock skew > 5 minutes
- **408**: Upstream fetch timeout
- **429**: Rate limit exceeded (includes Retry-After header)
- **500**: Internal server error (includes request_id)

### Rate Limits

- **Capacity**: 60 requests per API key
- **Refill**: 1 token per minute
- **Retry-After**: Seconds until at least 1 token refills

## Usage Examples

### Shell (macOS/Linux)

```bash
# Set variables
API_KEY="key_live_89f590e1f8cd3e4b19cfcf14"
API_SECRET="b0b5638935304b247195ff2cece8ed3bb307e1728397fce07bd2158866c73fa6"
BASE_URL="https://iamromeoly-tttranscibe.hf.space"
TS=$(python - <<'PY'
import time; print(int(time.time()*1000))
PY
)
BODY='{"url":"https://vm.tiktok.com/ZMAPTWV7o/"}'

# Generate signature
SIGN_INPUT="POST
/api/transcribe
$BODY
$TS"
SIG=$(printf "%s" "$SIGN_INPUT" | openssl dgst -sha256 -mac HMAC -macopt key:$API_SECRET | awk '{print $2}')

# Make request
curl -sS "$BASE_URL/api/transcribe" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -H "X-Timestamp: $TS" \
  -H "X-Signature: $SIG" \
  -d "$BODY"
```

### PowerShell (Windows)

```powershell
$BaseUrl = "https://iamromeoly-tttranscibe.hf.space"
$ApiKey  = "key_live_89f590e1f8cd3e4b19cfcf14"
$Secret  = "b0b5638935304b247195ff2cece8ed3bb307e1728397fce07bd2158866c73fa6"
$Ts      = [int64]((Get-Date).ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds
$Body    = '{"url":"https://vm.tiktok.com/ZMAPTWV7o/"}'
$String  = "POST`n/api/transcribe`n$Body`n$Ts"

$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secret)
$Sig = ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($String)) | ForEach-Object ToString x2) -join ""
$hmac.Dispose()

Invoke-WebRequest -Uri "$BaseUrl/api/transcribe" -Method POST `
  -Headers @{ "X-API-Key"=$ApiKey; "X-Timestamp"=$Ts; "X-Signature"=$Sig } `
  -ContentType "application/json" -Body $Body | Select-Object -ExpandProperty Content
```

### Python

```python
import hmac
import hashlib
import json
import time
import requests

# Configuration
API_KEY = "key_live_89f590e1f8cd3e4b19cfcf14"
API_SECRET = "b0b5638935304b247195ff2cece8ed3bb307e1728397fce07bd2158866c73fa6"
BASE_URL = "https://iamromeoly-tttranscibe.hf.space"

# Generate signature
timestamp = int(time.time() * 1000)
body = {"url": "https://vm.tiktok.com/ZMAPTWV7o/"}
body_json = json.dumps(body)

string_to_sign = f"POST\n/api/transcribe\n{body_json}\n{timestamp}"
signature = hmac.new(
    API_SECRET.encode('utf-8'),
    string_to_sign.encode('utf-8'),
    hashlib.sha256
).hexdigest()

# Make request
headers = {
    "Content-Type": "application/json",
    "X-API-Key": API_KEY,
    "X-Timestamp": str(timestamp),
    "X-Signature": signature
}

response = requests.post(f"{BASE_URL}/api/transcribe", headers=headers, json=body)
print(response.json())
```

## Local Development

### Prerequisites

- Python 3.11+
- ffmpeg
- yt-dlp

### Installation

```bash
# Clone repository
git clone <repository-url>
cd tiktok-transciber-mvp

# Install dependencies
pip install -r requirements.txt
<<<<<<< HEAD

# Run locally (single entrypoint)
uvicorn app:app --host 0.0.0.0 --port 7860
=======
```
4) Run the app:
```
python main.py
>>>>>>> b5b28564 (CI deploy - 2025-10-02 21:20:45)
```

The application will be available at `http://localhost:7860`

## Deployment

### Hugging Face Spaces

The application is deployed to Hugging Face Spaces with the following environment variables:

- `API_SECRET`: Shared HMAC secret
- `API_KEYS_JSON`: JSON map of API keys to owners
- `RATE_LIMIT_CAPACITY`: Token bucket capacity (default: 60)
- `RATE_LIMIT_REFILL_PER_SEC`: Tokens per second refill (default: 1.0)
- `TRANSCRIPT_CACHE_DIR`: Persistent cache directory (default: /data/transcripts_cache)
- `GOOGLE_APPLICATION_CREDENTIALS`: Path to GCP service account key
- `GCP_PROJECT_ID`: Google Cloud project ID
- `GCP_LOG_NAME`: Cloud logging log name

### Docker

```bash
# Build image
docker build -t tiktok-transcriber .

# Run container
docker run -p 7860:7860 tiktok-transcriber
```

## Architecture

- **FastAPI**: REST API with authentication and rate limiting (see `app/api.py`)
- **Gradio**: Web UI mounted on FastAPI root
- **Auth**: HMAC + timestamp (`app/auth.py`)
- **Rate limiting**: Token bucket (`app/rate_limit.py`)
- **Networking**: URL expansion (`app/network.py`)
- **Media**: `yt-dlp` + `ffmpeg` helpers (`app/media.py`)
- **ASR**: `faster-whisper` (`app/transcription.py`)
- **Logging**: JSON logs + optional GCP (`app/logging_utils.py`)

## Testing

### Health Check

```bash
curl https://iamromeoly-tttranscibe.hf.space/health
```

<<<<<<< HEAD
### API Test

Use the provided examples above or run the test scripts in the `scripts/` directory.
=======
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
>>>>>>> b5b28564 (CI deploy - 2025-10-02 21:20:45)

## License

MIT License