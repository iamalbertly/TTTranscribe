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

TTTranscribe is a production-ready TikTok transcription service that provides stable endpoints for processing TikTok videos and extracting text content using AI. Built with TypeScript, Hono, and optimized for both local development and Hugging Face Spaces deployment.

## Features

- **🚀 Fast API**: Accepts transcription requests and returns immediately with a request ID
- **📊 Status Tracking**: Real-time status updates with phase progression
- **🎵 TikTok Support**: Handles TikTok URLs with redirect resolution and audio extraction
- **🤖 ASR Integration**: Uses Hugging Face Whisper API for high-quality transcription
- **📝 Structured Logging**: Consistent log format for monitoring and debugging
- **🌍 Environment Adaptive**: Automatically detects and adapts to local vs. Hugging Face Spaces
- **💪 Production Ready**: Comprehensive error handling, fallbacks, and resilience

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
  "id": "uuid-here",
  "status": "queued",
  "submittedAt": "2024-10-15T03:30:00.000Z",
  "estimatedProcessingTime": 300,
  "url": "https://www.tiktok.com/@user/video/1234567890"
}
```

### GET /status/{id}
Get the current status of a transcription job.

**Response:**
```json
{
  "id": "uuid-here",
  "status": "completed",
  "progress": 100,
  "submittedAt": "2024-10-15T03:30:00.000Z",
  "completedAt": "2024-10-15T03:33:45.000Z",
  "currentStep": "completed",
  "result": {
    "transcription": "This is the full transcription text...",
    "confidence": 0.95,
    "language": "en",
    "duration": 30.5,
    "wordCount": 45,
    "speakerCount": 1,
    "audioQuality": "high",
    "processingTime": 225
  },
  "metadata": {
    "title": "TikTok Video Title",
    "author": "username",
    "description": "Video description",
    "url": "https://www.tiktok.com/@user/video/1234567890"
  }
}
```

**Status Values:**
- `queued` - Job accepted and waiting to be processed
- `processing` - Job is currently being processed
- `completed` - Job completed successfully
- `failed` - Job failed with error

## Usage

### Authentication
All requests require the `X-Engine-Auth` header with the shared secret:

```bash
curl -H "X-Engine-Auth: hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU" \
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
   curl -H "X-Engine-Auth: hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU" \
     https://your-space-url.hf.space/status/<job_id>
   ```

## Environment Variables

Configure the service using these environment variables:

- `ENGINE_SHARED_SECRET`: Authentication secret for API access (default: protocol-compliant value)
- `HF_API_KEY`: Hugging Face API key for transcription
- `ASR_PROVIDER`: ASR provider (default: "hf")
- `TMP_DIR`: Temporary directory for audio files (default: platform-aware)
- `KEEP_TEXT_MAX`: Maximum text length (default: 10000)
- `ALLOW_PLACEHOLDER_TRANSCRIPTION`: If `true`, returns placeholder text when `HF_API_KEY` is missing (default: true in local/dev)

## Caching

TTTranscribe implements intelligent caching to improve performance and reduce processing costs:

- **48-hour TTL**: Results are cached for 48 hours to avoid re-transcribing the same TikTok videos
- **URL normalization**: Similar URLs (with query parameters) hit the same cache entry
- **Automatic cleanup**: Expired cache entries are cleaned up every hour
- **Cache statistics**: Monitor cache performance via `/health` endpoint

### Cache Behavior

- **Cache Hit**: Returns completed result immediately (status: `completed`)
- **Cache Miss**: Processes normally through all phases
- **Cache Stats**: Available in health endpoint response

## Secret Management

### Hugging Face Spaces Deployment

Use the provided script to set secrets programmatically:

```bash
# Install huggingface-cli
pip install huggingface-hub

# Login to Hugging Face
huggingface-cli login

# Set secrets using PowerShell script
.\scripts\setup-hf-secrets.ps1 -HfApiKey "your-hf-api-key" -EngineSecret "hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU"
```

### Manual Secret Setup

Alternatively, set secrets via Hugging Face Spaces web interface:
1. Go to your Space settings
2. Navigate to "Variables and secrets"
3. Add secrets:
   - `HF_API_KEY`: Your Hugging Face API key
   - `ENGINE_SHARED_SECRET`: `hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU`

## Architecture

The service is built with:

- **Node.js + TypeScript**: Modern JavaScript runtime with full type safety
- **Hono**: Fast, lightweight web framework for high-performance APIs
- **yt-dlp**: TikTok audio extraction (with Windows/Linux compatibility)
- **Hugging Face API**: Whisper transcription with fallback handling
- **Docker**: Containerized deployment optimized for Hugging Face Spaces
- **Environment Detection**: Automatic adaptation between local and remote environments

## File Structure

```
src/
├── TTTranscribe-Server-Main-Entry.ts          # Main server (144 lines)
├── TTTranscribe-Queue-Job-Processing.ts      # Job queue (85 lines)
├── TTTranscribe-Media-TikTok-Download.ts     # TikTok download (129 lines)
├── TTTranscribe-ASR-Whisper-Transcription.ts # Transcription (81 lines)
├── TTTranscribe-AI-Text-Summarization.ts     # Summarization (67 lines)
└── TTTranscribe-Config-Environment-Settings.ts # Environment config (118 lines)
```

**Design Principles:**
- ✅ Single source of truth for each responsibility
- ✅ Maximum 300 lines per file
- ✅ Consistent naming convention: `[Project]-[ParentScope]-[ChildScope]-[CoreResponsibility]`
- ✅ Zero technical debt and duplications
- ✅ Environment-adaptive configuration

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

### Local Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start server (uses .env.local)
npm start

# Run tests
npm test
```

### Environment Setup

**Local Development (.env.local):**
```env
PORT=8788
ENGINE_SHARED_SECRET=super-long-random
HF_API_KEY=your-huggingface-api-key-here # optional in dev
TMP_DIR=./tmp # recommended on Windows
KEEP_TEXT_MAX=10000
ALLOW_PLACEHOLDER_TRANSCRIPTION=true
BASE_URL=http://localhost:8788
TEST_URL=https://www.tiktok.com/@test/video/1234567890
```

**Hugging Face Spaces:**
- Set secrets in Hugging Face Spaces settings
- Service automatically detects environment and adapts
- Uses `/tmp` directory for file operations
- Optimized for containerized deployment

### Testing

```bash
# Test API endpoints and protocol compliance
node test-contract.js

# Test cache functionality
node test-cache.js

# Test with curl
curl -H "X-Engine-Auth: hf_sUP3rL0nGrANd0mAp1K3yV4xYb2pL6nM8zJ9fQ1cD5eS7tT0rW3gU" \
  -d '{"url":"https://www.tiktok.com/@test/video/1234567890"}' \
  -H "content-type: application/json" \
  http://localhost:8788/transcribe
```

### Deployment

**Hugging Face Spaces:**
- Automatic deployment on git push
- Docker container with optimized build
- Environment variables via secrets
- Health checks and monitoring
- Base URL is auto-detected: set `HF_SPACE_URL` (recommended) or `HF_SPACE_ID` and we derive `https://{org}-{space}.hf.space`.

**Local Docker:**
```bash
docker build -t tttranscribe .
docker run -p 8788:8788 tttranscribe
```

## License

Apache 2.0