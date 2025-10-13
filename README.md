---
title: TTTranscribe
emoji: 🎧
colorFrom: blue
colorTo: indigo
sdk: docker
pinned: false
license: apache-2.0
short_description: Transcribe TikTok videos to text using AI
app_port: 8788
tags:
  - transcription
  - tiktok
  - asr
  - whisper
  - audio
  - ai
---

# TTTranscribe

TTTranscribe is a TikTok transcription service that provides stable endpoints for processing TikTok videos and extracting text content using AI.

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

## Usage

### Authentication
All requests require the `X-Engine-Auth` header with the shared secret:

```bash
curl -H "X-Engine-Auth: your-secret-key" \
  -d '{"url":"https://www.tiktok.com/@user/video/123"}' \
  -H "content-type: application/json" \
  https://your-space-url.hf.space/transcribe
```

### Example Workflow

1. **Submit a job:**
   ```bash
   curl -H "X-Engine-Auth: your-secret" \
     -d '{"url":"https://www.tiktok.com/@garyvee/video/7308801293029248299"}' \
     -H "content-type: application/json" \
     https://your-space-url.hf.space/transcribe
   ```

2. **Check status:**
   ```bash
   curl -H "X-Engine-Auth: your-secret" \
     https://your-space-url.hf.space/status/<request_id>
   ```

## Environment Variables

Configure the service using these environment variables:

- `ENGINE_SHARED_SECRET`: Authentication secret for API access
- `HF_API_KEY`: Hugging Face API key for transcription
- `ASR_PROVIDER`: ASR provider (default: "hf")
- `TMP_DIR`: Temporary directory for audio files (default: "/tmp/ttt")
- `KEEP_TEXT_MAX`: Maximum text length (default: 10000)

## Architecture

The service is built with:

- **Node.js + TypeScript**: Modern JavaScript runtime
- **Hono**: Fast, lightweight web framework
- **yt-dlp**: TikTok audio extraction
- **Hugging Face API**: Whisper transcription
- **Docker**: Containerized deployment

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

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server
npm start

# Run tests
npm test
```

## License

Apache 2.0