# TTTranscribe Testing Guide

## Quick Start

1. **Build the project:**
   ```bash
   npm run build
   ```

2. **Start the server:**
   ```bash
   npm run test:start
   ```

3. **Test the API (in another terminal):**
   ```bash
   npm test
   ```

## Manual Testing with curl

### 1. Health Check
```bash
curl http://localhost:8788/health
```

### 2. Submit Transcription Job
```bash
curl -H "X-Engine-Auth: super-long-random" \
  -d '{"url":"https://www.tiktok.com/@garyvee/video/7308801293029248299"}' \
  -H "content-type: application/json" \
  http://localhost:8788/transcribe
```

**Expected Response:**
```json
{
  "request_id": "uuid-here",
  "status": "accepted"
}
```

### 3. Check Job Status
```bash
curl -H "X-Engine-Auth: super-long-random" \
  http://localhost:8788/status/<request_id>
```

**Expected Response:**
```json
{
  "phase": "TRANSCRIBING",
  "percent": 35,
  "note": "asr",
  "text": "transcribed text here"
}
```

## Status Phases

The job progresses through these exact phases:

1. `REQUEST_SUBMITTED` (5%) - Job queued
2. `DOWNLOADING` (15%) - Fetching TikTok audio  
3. `TRANSCRIBING` (35%) - Running ASR
4. `SUMMARIZING` (75%) - Generating summary
5. `COMPLETED` (100%) - Job finished with text

Or `FAILED` if an error occurs.

## Logging Format

Watch the console for structured logs:

```
ttt:accepted req=<id> url=<short-id>
ttt:phase req=<id> phase=<PHASE> pct=<n> note=<short-string>
ttt:error req=<id> where=<component> msg=<error>
```

## Environment Configuration

Create a `.env` file with:

```env
PORT=8788
ENGINE_SHARED_SECRET=super-long-random
ASR_PROVIDER=hf
HF_API_KEY=your-huggingface-api-key-here
TMP_DIR=/tmp/ttt
KEEP_TEXT_MAX=10000
```

## Troubleshooting

- **401 Unauthorized**: Check `X-Engine-Auth` header matches `ENGINE_SHARED_SECRET`
- **400 Bad Request**: Ensure URL is a valid TikTok URL
- **500 Server Error**: Check environment variables and API keys
- **Build Errors**: Run `npm install` and `npm run build`

## Production Deployment

For production deployment:

1. Set proper environment variables
2. Use a real HF_API_KEY for Hugging Face
3. Consider using Redis for job queue persistence
4. Implement proper error handling and retries
5. Add monitoring and health checks
