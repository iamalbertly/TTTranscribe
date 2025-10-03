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

# Run locally
python main.py
```

The application will be available at `http://localhost:7860`

## Deployment

### Hugging Face Spaces

The application is deployed to Hugging Face Spaces with the following environment variables:

- `API_SECRET`: Shared HMAC secret
- `API_KEYS_JSON`: JSON map of API keys to owners
- `RATE_LIMIT_CAPACITY`: Token bucket capacity (default: 60)
- `RATE_LIMIT_REFILL_PER_MIN`: Tokens per minute refill (default: 1)
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

- **FastAPI**: REST API with authentication and rate limiting
- **Gradio**: Web UI for testing and demonstration
- **faster-whisper**: CPU-optimized transcription
- **yt-dlp**: TikTok video audio extraction
- **ffmpeg**: Audio processing and normalization

## Testing

### Health Check

```bash
curl https://iamromeoly-tttranscibe.hf.space/health
```

### API Test

Use the provided examples above or run the test scripts in the `scripts/` directory.

## License

MIT License