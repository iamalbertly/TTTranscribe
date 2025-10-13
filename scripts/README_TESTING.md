# TTTranscribe API Testing Guide

## Overview

The TTTranscribe API has been successfully implemented with the following features:

- **POST /api/transcribe** - Main transcription endpoint with HMAC-SHA256 authentication
- **GET /health** - Health check endpoint
- **GET /** - Gradio UI interface
- **Rate limiting** - 5 requests per minute per API key
- **Error handling** - Comprehensive HTTP status codes

## API Specification

### Base URL
- **Remote**: `https://iamromeoly-tttranscibe.hf.space`
- **Local**: `http://localhost:7860`

### Authentication
All API requests require:
- `X-API-Key`: Your API key
- `X-Timestamp`: Unix timestamp in milliseconds
- `X-Signature`: HMAC-SHA256 signature

### Signature Generation
```python
import hmac
import hashlib
import time

api_key = "CLIENT_A_KEY_123"
api_secret = "CLIENT_A_SECRET_ABC"
timestamp = int(time.time() * 1000)
body = '{"url":"https://vm.tiktok.com/ZMAPTWV7o/"}'

string_to_sign = f"POST\n/api/transcribe\n{body}\n{timestamp}"
signature = hmac.new(
    api_secret.encode('utf-8'),
    string_to_sign.encode('utf-8'),
    hashlib.sha256
).hexdigest()
```

## Testing Scripts

### Unified Orchestrator (Recommended)
```bash
python scripts/test_e2e.py --remote --url "https://vm.tiktok.com/ZMAPTWV7o/" \
  --key <API_KEY> --secret <API_SECRET>
```

Optional local run (auto-start server, verify cache on second call):
```powershell
python scripts/test_e2e.py --local --url "https://vm.tiktok.com/ZMAPTWV7o/" \
  --key CLIENT_A_KEY_123 --secret CLIENT_A_SECRET_ABC --start-local \
  --env API_SECRET=CLIENT_A_SECRET_ABC --env API_KEYS_JSON={"CLIENT_A_KEY_123":"test-client"}
```

## Manual Testing

### 1. Health Check
```bash
curl https://iamromeoly-tttranscibe.hf.space/health
```

### 2. API Test with curl
```bash
# Generate timestamp
TS=$(python -c "import time; print(int(time.time()*1000))")

# Create signature
API_KEY="CLIENT_A_KEY_123"
API_SECRET="CLIENT_A_SECRET_ABC"
BODY='{"url":"https://vm.tiktok.com/ZMAPTWV7o/"}'
SIGN_INPUT="POST\n/api/transcribe\n$BODY\n$TS"
SIG=$(printf "%s" "$SIGN_INPUT" | openssl dgst -sha256 -mac HMAC -macopt key:$API_SECRET | awk '{print $2}')

# Make request
curl -sS https://iamromeoly-tttranscibe.hf.space/api/transcribe \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -H "X-Timestamp: $TS" \
  -H "X-Signature: $SIG" \
  -d "$BODY"
```

### 3. Gradio UI Test
Open in browser: https://iamromeoly-tttranscibe.hf.space/

## Expected Response Format

### Success Response (200)
```json
{
  "request_id": "b9a1d1d6-0c8f-4f91-92e1-9d18b0a1d2e7",
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
- **400**: Bad request, missing/invalid body or headers
- **401**: Missing/unknown X-API-Key
- **403**: Bad X-Signature or timestamp skew > 5 minutes
- **408**: Upstream fetch timeout
- **429**: Rate limit exceeded (includes Retry-After header)
- **500**: Internal server error

## Rate Limiting

- **Limit**: 5 requests per minute per API key
- **Response**: 429 status code with Retry-After header
- **Reset**: Automatic token bucket refill

## Environment Detection

The test scripts automatically detect the environment:
1. Try local first (http://localhost:7860)
2. Fall back to remote (https://iamromeoly-tttranscibe.hf.space)

## Troubleshooting

### Common Issues

1. **Network connectivity**: Ensure you can reach the Hugging Face Space
2. **Authentication**: Verify API key and secret are correct
3. **Timestamp**: Ensure system clock is synchronized
4. **Rate limiting**: Wait for token bucket to refill

### Debug Steps

1. Test health endpoint first
2. Verify signature generation
3. Check timestamp accuracy
4. Monitor rate limiting

## Files Structure

```
scripts/
├── test_e2e.py                  # Unified orchestrator (preferred)
├── test_api_comprehensive.py    # Legacy (kept for reference)
├── test_api_simple.py           # Legacy (kept for reference)
├── test_api.ps1                 # PowerShell (legacy)
└── README_TESTING.md            # This file
```

## Deployment Status

The API has been deployed to Hugging Face Spaces and should be accessible at:
- **URL**: https://iamromeoly-tttranscibe.hf.space
- **Status**: Deployed and running
- **Features**: Full API + Gradio UI
