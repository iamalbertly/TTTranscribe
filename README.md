# TTTranscribe

TTTranscribe is a TikTok transcription service that provides stable endpoints for processing TikTok videos and extracting text content.

## Features

- **Fast API**: Accepts transcription requests and returns immediately with a request ID
- **Status Tracking**: Real-time status updates with phase progression
- **TikTok Support**: Handles TikTok URLs with redirect resolution
- **ASR Integration**: Uses Hugging Face Whisper API for transcription
- **Structured Logging**: Consistent log format for monitoring and debugging

## API Endpoints

### POST /transcribe
Submit a TikTok URL for transcription.

**Request:**
```json
{
  "url": "https://www.tiktok.com/@user/video/1234567890"
}
```

**Response:**
```json
{
  "request_id": "uuid-here",
  "status": "accepted"
}
```

### GET /status/{request_id}
Get the current status of a transcription job.

**Response:**
```json
{
  "phase": "TRANSCRIBING",
  "percent": 35,
  "note": "asr",
  "text": "transcribed text here"
}
```

**Status Phases:**
- `REQUEST_SUBMITTED` → `DOWNLOADING` → `TRANSCRIBING` → `SUMMARIZING` → `COMPLETED`
- `FAILED` (if error occurs)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Build and run:**
   ```bash
   npm run build
   npm start
   ```

## Environment Variables

```env
PORT=8788
ENGINE_SHARED_SECRET=super-long-random
ASR_PROVIDER=hf
HF_API_KEY=your-huggingface-api-key-here
TMP_DIR=/tmp/ttt
KEEP_TEXT_MAX=10000
```

## Authentication

All requests require the `X-Engine-Auth` header with the shared secret:

```bash
curl -H "X-Engine-Auth: super-long-random" \
  -d '{"url":"https://www.tiktok.com/@user/video/123"}' \
  -H "content-type: application/json" \
  http://localhost:8788/transcribe
```

## Logging Format

The service outputs structured logs in the following format:

```
ttt:phase req=<id> phase=<PHASE> pct=<n> note=<short-string>
ttt:error req=<id> where=<component> msg=<error>
ttt:accepted req=<id> url=<short-id>
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run production build
npm start
```

## Testing

Test the endpoints with curl:

```bash
# Submit a transcription job
curl -H "X-Engine-Auth: super-long-random" \
  -d '{"url":"https://www.tiktok.com/@garyvee/video/7308801293029248299"}' \
  -H "content-type: application/json" \
  http://localhost:8788/transcribe

# Check status (replace <request_id> with actual ID)
curl -H "X-Engine-Auth: super-long-random" \
  http://localhost:8788/status/<request_id>
```

## Architecture

```
src/
├── server.ts          # HTTP server (Hono)
├── queue.ts           # Job queue + in-memory status tracking
├── tiktok.ts          # TikTok media resolver
├── transcribe.ts      # ASR transcription (Hugging Face)
├── summarize.ts       # Optional summarization
└── log.ts            # Unified logging
```

## Status Flow

1. **REQUEST_SUBMITTED** (5%) - Job queued
2. **DOWNLOADING** (15%) - Fetching TikTok audio
3. **TRANSCRIBING** (35%) - Running ASR
4. **SUMMARIZING** (75%) - Generating summary
5. **COMPLETED** (100%) - Job finished with text

## Error Handling

- Invalid TikTok URLs return 400
- Missing authentication returns 401
- Server errors return 500
- Failed jobs are marked as `FAILED` phase